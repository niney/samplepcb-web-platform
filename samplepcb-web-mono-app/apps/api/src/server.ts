import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import authPlugin from './plugins/auth';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';

const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

// Zod 를 req/res 검증 + 직렬화의 단일 진실원본으로 연결.
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// httpErrors/assert 등 유틸. 개발 시 web(:5173)과 api(:3000)는 다른 origin 이라 CORS 허용.
await app.register(fastifySensible);
await app.register(fastifyCors, { origin: true });

// 그누보드 발급 JWT 검증(데코레이터 authenticate 등록).
await app.register(authPlugin);

// nginx 가 /api → 이 서버로 프록시. 라우트 prefix '/api'.
await app.register(healthRoutes, { prefix: '/api' });
await app.register(meRoutes, { prefix: '/api' });

try {
  // 기본은 로컬 전용(127.0.0.1). nginx(443)가 같은 호스트에서 /api 를 프록시하므로
  // 0.0.0.0(외부/인터넷 노출)은 불필요하다. 컨테이너 등 외부 바인딩이 필요하면
  // 환경변수 HOST=0.0.0.0 으로 override.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port: Number(process.env.PORT ?? 3000), host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
