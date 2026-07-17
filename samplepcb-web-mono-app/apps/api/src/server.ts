import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifySensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import authPlugin from './plugins/auth';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { pcbProjectRoutes } from './routes/pcb-projects';
import { pcbThumbRoutes } from './routes/pcb-thumbs';
import { marketExpertRoutes } from './routes/market-experts';
import { marketProjectRoutes } from './routes/market-projects';
import { marketBidRoutes } from './routes/market-bids';
import { marketContractRoutes } from './routes/market-contracts';
import { marketSettingsRoutes } from './routes/market-settings';
import { adminPcbProjectRoutes } from './routes/admin-pcb-projects';
import { adminMemberRoutes } from './routes/admin-members';
import { adminOrderRoutes } from './routes/admin-orders';
import { adminSettingsRoutes } from './routes/admin-settings';
import { aiRoutes } from './routes/ai';
import { rndAiRoutes } from './routes/rnd-ai';
import { adminSlidesRoutes } from './routes/admin-slides';
import { adminSeoRoutes } from './routes/admin-seo';
import { adminMarketExpertRoutes } from './routes/admin-market-experts';
import { adminMarketProjectRoutes } from './routes/admin-market-projects';
import { adminMarketContractRoutes } from './routes/admin-market-contracts';
import { adminMarketSettingsRoutes } from './routes/admin-market-settings';

const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

// Zod 를 req/res 검증 + 직렬화의 단일 진실원본으로 연결.
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// httpErrors/assert 등 유틸. 개발 시 web(:5173)과 api(:3333)는 다른 origin 이라 CORS 허용.
await app.register(fastifySensible);
await app.register(fastifyCors, { origin: true });
// 거버 zip 업로드 수신 (pcb-projects). 거버 최대 크기 여유 있게 100MB.
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } });

// 그누보드 발급 JWT 검증(데코레이터 authenticate 등록).
await app.register(authPlugin);

// nginx 가 /api → 이 서버로 프록시. 라우트 prefix '/api'.
await app.register(healthRoutes, { prefix: '/api' });
await app.register(meRoutes, { prefix: '/api' });
await app.register(pcbProjectRoutes, { prefix: '/api' });
await app.register(pcbThumbRoutes, { prefix: '/api' });
// 재능마켓 — 전문가 등록·본인 관리·공개 프로필
await app.register(marketExpertRoutes, { prefix: '/api' });
// 재능마켓 — 프로젝트 의뢰·NDA·첨부·내 의뢰
await app.register(marketProjectRoutes, { prefix: '/api' });
// 재능마켓 — 입찰 제출·수정·철회·소유자 비교·채택
await app.register(marketBidRoutes, { prefix: '/api' });
// 재능마켓 — 계약(결제·납품·검수·취소·산출물)
await app.register(marketContractRoutes, { prefix: '/api' });
// 재능마켓 — 공개 설정(수수료율 읽기 전용)
await app.register(marketSettingsRoutes, { prefix: '/api' });
// AI 유스케이스(범용 실행 — 현재 market.request-diagram)
await app.register(aiRoutes, { prefix: '/api' });
// 로그인·영구 저장 없는 로컬 연구용 파일 분류 AI.
await app.register(rndAiRoutes, { prefix: '/api' });
// 관리자 전용(requireAdmin) — 견적 관리 목록·상세·가격 확정·원본 다운로드
await app.register(adminPcbProjectRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 회원 관리 목록·상세·차단/레벨·회사명 프로필
await app.register(adminMemberRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 주문내역 목록·상세(읽기)
await app.register(adminOrderRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 설정(사업자정보 등, g5_shop_default 읽기/쓰기)
await app.register(adminSettingsRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 홈 메인 슬라이드 관리(g5_shop_banner '메인' read/write + 로컬 이미지)
await app.register(adminSlidesRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 페이지별 SEO 메타 관리(sp_seo read/write, 소비는 sp-php head.sub.php)
await app.register(adminSeoRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 재능마켓: 전문가 심사·프로젝트 모니터·설정·파일
await app.register(adminMarketExpertRoutes, { prefix: '/api/admin' });
await app.register(adminMarketProjectRoutes, { prefix: '/api/admin' });
await app.register(adminMarketContractRoutes, { prefix: '/api/admin' });
await app.register(adminMarketSettingsRoutes, { prefix: '/api/admin' });

try {
  // 기본은 로컬 전용(127.0.0.1). nginx(443)가 같은 호스트에서 /api 를 프록시하므로
  // 0.0.0.0(외부/인터넷 노출)은 불필요하다. 컨테이너 등 외부 바인딩이 필요하면
  // 환경변수 HOST=0.0.0.0 으로 override.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port: Number(process.env.PORT ?? 3333), host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
