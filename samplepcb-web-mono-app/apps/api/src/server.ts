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
import { pcbPricingRoutes } from './routes/pcb-pricing';
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
import { adminSlidesRoutes } from './routes/admin-slides';
import { adminSeoRoutes } from './routes/admin-seo';
import { adminBomRoutes } from './routes/admin-bom';
import { adminPartsRoutes } from './routes/admin-parts';
import { adminBomQuoteRoutes } from './routes/admin-bom-quotes';
import { adminBomRfqRoutes } from './routes/admin-bom-rfqs';
import { adminBomPoRoutes } from './routes/admin-bom-pos';
import { adminBomReceivingRoutes } from './routes/admin-bom-receiving';
import { adminDigikeyRoutes, digikeyOauthCallbackRoutes } from './routes/admin-digikey';
import { adminBomOrderRoutes } from './routes/admin-bom-orders';
import { bomClaimRoutes } from './routes/bom-claims';
import { adminBomClaimRoutes } from './routes/admin-bom-claims';
import { adminMailRoutes } from './routes/admin-mail';
import { adminPartnerRoutes } from './routes/admin-partners';
import { adminPartnerPartRoutes } from './routes/admin-partner-parts';
import { partnerRfqRoutes } from './routes/partner-rfqs';
import { partnerPoRoutes } from './routes/partner-pos';
import { partnerAccessRoutes } from './routes/partner-access';
import { partnerPartRoutes } from './routes/partner-parts';
import { rfqReplyRoutes } from './routes/rfq-reply';
import { adminPcbRfqRoutes } from './routes/admin-pcb-rfqs';
import { partnerPcbRfqRoutes } from './routes/partner-pcb-rfqs';
import { pcbRfqReplyRoutes } from './routes/pcb-rfq-reply';
import { adminPcbPoRoutes } from './routes/admin-pcb-pos';
import { adminPcbRemittanceRoutes } from './routes/admin-pcb-remittances';
import { adminPcbEqReviewRoutes } from './routes/admin-pcb-eq-reviews';
import { pcbEqReviewRoutes } from './routes/pcb-eq-reviews';
import { adminPcbOrderRoutes } from './routes/admin-pcb-orders';
import { adminPcbCaseRoutes } from './routes/admin-pcb-cases';
import { adminPcbAsCaseRoutes } from './routes/admin-pcb-as-cases';
import { partnerPcbAsCaseRoutes } from './routes/partner-pcb-as-cases';
import { adminPcbClaimRoutes } from './routes/admin-pcb-claims';
import { pcbClaimRoutes } from './routes/pcb-claims';
import { partnerPcbPoRoutes } from './routes/partner-pcb-pos';
import { partnerPcbShipmentRoutes } from './routes/partner-pcb-shipments';
import { adminPcbPackageRoutes } from './routes/admin-pcb-packages';
import { bomRoutes } from './routes/bom';
import { bomQuoteRoutes } from './routes/bom-quotes';
import { bootstrapPartsIndex } from './es/sp-parts-index';
import { drainIndexQueue } from './lib/parts-ingest';
import { recoverSupplierResultArtifacts } from './lib/bom-part-data';
import { cleanupExpiredMailLogs } from './lib/mail-log';
import { adminMarketExpertRoutes } from './routes/admin-market-experts';
import { adminMarketProjectRoutes } from './routes/admin-market-projects';
import { adminMarketContractRoutes } from './routes/admin-market-contracts';
import { adminMarketSettingsRoutes } from './routes/admin-market-settings';
import { scheduleKoreaEximExchangeRateRefresh } from './lib/exchange-rate';

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
// 레거시 가격 API 호환(무인증·계산 전용·저장 없음) — 거버 뷰어 실시간 표시가의
// 레거시 ↔ sp-node 스위칭 비교용. docs/pricing-engine-parity.md
await app.register(pcbPricingRoutes, { prefix: '/api' });
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
// AI 사전 검토서(실행·폴링) — docs/AI_DEV_REVIEW.md
await app.register(aiRoutes, { prefix: '/api' });
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
// 관리자 전용(requireAdmin) — BOM 추출 + 공급사 검색 (sp-engine Python 프록시)
await app.register(bomRoutes, { prefix: '/api' });
await app.register(bomQuoteRoutes, { prefix: '/api' });
// 사내 서비스용 BOM API — 같은 라우트를 서비스 액터로 한 번 더 등록한다(docs/BOM_SERVICE_API.md).
// 인증 없이 열리므로 배포 시 nginx 에서 /api/svc 를 호출 서비스 IP 로 제한할 것.
await app.register(bomRoutes, { prefix: '/api/svc', actor: 'service' });
await app.register(bomQuoteRoutes, { prefix: '/api/svc', actor: 'service' });
await app.register(bomClaimRoutes, { prefix: '/api' });
await app.register(adminBomRoutes, { prefix: '/api/admin' });
await app.register(adminBomQuoteRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 협력사 RFQ 발송·현황·대리 입력 (docs/SMARTBOM_PARTNER_RFQ.md)
await app.register(adminBomRfqRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 협력사 발주서(D18)
await app.register(adminBomPoRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 입고 스캔(D42): 공급사 봉투 라벨 2D 바코드 → 발주 품목 입고 원장
await app.register(adminBomReceivingRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — DigiKey 3-legged OAuth 연결 상태·시작·해제(D42)
await app.register(adminDigikeyRoutes, { prefix: '/api/admin' });
// 무인증 — DigiKey OAuth 콜백(앱에 등록한 Redirect URI). state 가 맞을 때만 code 교환.
await app.register(digikeyOauthCallbackRoutes, { prefix: '/api' });
// 관리자 전용(requireAdmin) — 스마트 BOM 주문·결제(주문 축 파생, D19)
await app.register(adminBomOrderRoutes, { prefix: '/api/admin' });
// 배송·완료 후 고객 문제 접수와 관리자 완료·클레임 워크큐(D37)
await app.register(adminBomClaimRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 빠른 메일(§6.15): 템플릿 + Case 컨텍스트 발송·이력
await app.register(adminMailRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 공용 파트너(조직) 관리
await app.register(adminPartnerRoutes, { prefix: '/api/admin' });
// 협력사 보유 부품 원장(docs/PARTNER_PARTS.md) — 관리자 뒤처리 도구·대행 업로드
await app.register(adminPartnerPartRoutes, { prefix: '/api/admin' });
// 협력사 포털(requirePartner) — 받은 RFQ 워크큐·회신 + 받은 발주 확인
await app.register(partnerAccessRoutes, { prefix: '/api' });
// 협력사 보유 부품 — 포털 공통 영역(part_sale capability 는 라우트가 매 요청 재확인)
await app.register(partnerPartRoutes, { prefix: '/api' });
await app.register(partnerRfqRoutes, { prefix: '/api' });
await app.register(partnerPoRoutes, { prefix: '/api' });
// 매직링크 무로그인 회신(§6.9) — 인증 = 토큰(메일함 소유), 권한은 RFQ 1건 스코프
await app.register(rfqReplyRoutes, { prefix: '/api' });
// PCB 파트너 트랙 P1(docs/PCB_PARTNER_TRACK.md) — 견적행 RFQ: 관리자·포털·매직링크
await app.register(adminPcbRfqRoutes, { prefix: '/api/admin' });
await app.register(partnerPcbRfqRoutes, { prefix: '/api' });
await app.register(pcbRfqReplyRoutes, { prefix: '/api' });
// PCB 파트너 트랙 P2 — 발주서·EQ 5단계(관리자 승인/반려 + 포털 진행·MD 하위 발주)
await app.register(adminPcbPoRoutes, { prefix: '/api/admin' });
await app.register(adminPcbOrderRoutes, { prefix: '/api/admin' });
// PCB 송금 원장(P3.11) — 지급 워크큐·협력사별 잔액·증빙
await app.register(adminPcbRemittanceRoutes, { prefix: '/api/admin' });
// PCB EQ 고객 확인(P4.1) — 관리자 요청 발송 + 고객 승인/반려(소비처 = sp-php 주문내역)
await app.register(adminPcbEqReviewRoutes, { prefix: '/api/admin' });
await app.register(pcbEqReviewRoutes, { prefix: '/api' });
// PCB 진행현황(구간 조감) + 역할별 대기 큐(요청 대기·발주 대기)
await app.register(adminPcbCaseRoutes, { prefix: '/api/admin' });
await app.register(adminPcbAsCaseRoutes, { prefix: '/api/admin' });
await app.register(partnerPcbAsCaseRoutes, { prefix: '/api' });
await app.register(adminPcbClaimRoutes, { prefix: '/api/admin' });
await app.register(pcbClaimRoutes, { prefix: '/api' });
await app.register(partnerPcbPoRoutes, { prefix: '/api' });
// PCB 보내기 보드(§9 묶음 재구성) — 선반·박스 담기(발송 문서 자체는 발주서 경유 라우트)
await app.register(partnerPcbShipmentRoutes, { prefix: '/api' });
// PCB Case QR — 관리자 라벨 재인쇄·스캔 조회(고객 신원은 이 관리자 경계에서만 노출).
await app.register(adminPcbPackageRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 부품 카탈로그 검색(ES sp-parts) + 상세(DB sp_part*)
await app.register(adminPartsRoutes, { prefix: '/api/admin' });
// 관리자 전용(requireAdmin) — 재능마켓: 전문가 심사·프로젝트 모니터·설정·파일
await app.register(adminMarketExpertRoutes, { prefix: '/api/admin' });
await app.register(adminMarketProjectRoutes, { prefix: '/api/admin' });
await app.register(adminMarketContractRoutes, { prefix: '/api/admin' });
await app.register(adminMarketSettingsRoutes, { prefix: '/api/admin' });

// ES sp-parts 부트스트랩 + 색인 실패 큐 드레인 — ES 다운이어도 앱은 뜬다(검색만 축퇴).
// 기동 시 1회에 그치면 장기 실행 서버의 일시 실패가 재시작 전까지 남으므로 1분마다 수렴시킨다.
let partsIndexDrainRunning = false;
async function drainPartsIndexQueue(): Promise<void> {
  if (partsIndexDrainRunning) return;
  partsIndexDrainRunning = true;
  try {
    await bootstrapPartsIndex(app.log);
    const result = await drainIndexQueue();
    if (result.drained > 0) {
      app.log.info(`sp-parts 색인 큐 드레인: ${String(result.drained)}건 (잔여 ${String(result.remaining)})`);
    }
    // poison 행은 분당 최대 1줄이라 스팸이 아니다. 신규 변경 인제스트가 자동 부활시키므로 운영 경고로 남긴다.
    if (result.dead > 0) {
      app.log.warn(
        `sp-parts 색인 큐 dead-letter ${String(result.dead)}건 — 신규 변경 인제스트 시 자동 부활, 그 외는 수동 정리 필요`,
      );
    }
  } catch (error) {
    app.log.warn(`sp-parts 색인 큐 드레인 실패: ${String(error)}`);
  } finally {
    partsIndexDrainRunning = false;
  }
}

void drainPartsIndexQueue();
const partsIndexDrainTimer = setInterval(() => void drainPartsIndexQueue(), 60_000);
partsIndexDrainTimer.unref();

// 공급사 결과는 DB에 압축 보존되므로 요청·프로세스 수명과 무관하게 후처리를 재개한다.
// 한 번에 10건을 직렬 처리해 운영 DB와 ES에 복구 트래픽이 몰리지 않게 한다.
let partDataRecoveryRunning = false;
async function recoverPartData(): Promise<void> {
  if (partDataRecoveryRunning) return;
  partDataRecoveryRunning = true;
  try {
    const result = await recoverSupplierResultArtifacts(app.log);
    if (result.completed > 0 || result.scheduled > 0) {
      app.log.info({ ...result }, '부품 정보 백그라운드 복구 실행');
    }
    if (result.dead > 0) {
      app.log.warn({ ...result }, '부품 정보 백그라운드 복구 한도 초과');
    }
  } catch (error) {
    app.log.warn({ err: String(error) }, '부품 정보 백그라운드 복구 워커 실패');
  } finally {
    partDataRecoveryRunning = false;
  }
}

void recoverPartData();
const partDataRecoveryTimer = setInterval(() => void recoverPartData(), 30_000);
partDataRecoveryTimer.unref();

// 발송 이력 보존 기간 정리 — sp_config mail_log_retention_days(기본 180일, 0=무제한).
// 청크 삭제(회당 최대 5만 행)라 6시간 주기면 잔여도 금방 소진된다(docs/MAIL_LOG.md).
let mailLogCleanupRunning = false;
async function cleanupMailLogHistory(): Promise<void> {
  if (mailLogCleanupRunning) return;
  mailLogCleanupRunning = true;
  try {
    const removed = await cleanupExpiredMailLogs(app.log);
    if (removed > 0) {
      app.log.info({ removed }, '발송 이력 보존 기간 경과 행 정리');
    }
  } finally {
    mailLogCleanupRunning = false;
  }
}

void cleanupMailLogHistory();
const mailLogCleanupTimer = setInterval(() => void cleanupMailLogHistory(), 6 * 3_600_000);
mailLogCleanupTimer.unref();

try {
  // 기본은 로컬 전용(127.0.0.1). nginx(443)가 같은 호스트에서 /api 를 프록시하므로
  // 0.0.0.0(외부/인터넷 노출)은 불필요하다. 컨테이너 등 외부 바인딩이 필요하면
  // 환경변수 HOST=0.0.0.0 으로 override.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port: Number(process.env.PORT ?? 3333), host });
  scheduleKoreaEximExchangeRateRefresh(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
