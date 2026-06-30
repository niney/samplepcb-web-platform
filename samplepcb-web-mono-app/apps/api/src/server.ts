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
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
