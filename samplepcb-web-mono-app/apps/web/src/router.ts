import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import DefaultLayout from './layouts/DefaultLayout.vue';
import AdminLayout from './layouts/AdminLayout.vue';
import BomLayout from './layouts/BomLayout.vue';
import PartnerLayout from './layouts/PartnerLayout.vue';
import Home from './pages/Home.vue';
import BomHome from './pages/bom/BomHome.vue';
import BomHistory from './pages/bom/BomHistory.vue';
import BomSearch from './pages/bom/BomSearch.vue';
import BomQuote from './pages/bom/BomQuote.vue';
import { appPath, loginUrl } from './lib/auth-urls';
import AdminDashboard from './pages/admin/AdminDashboard.vue';
import AdminQuotes from './pages/admin/AdminQuotes.vue';
import AdminOrders from './pages/admin/AdminOrders.vue';
import AdminMembers from './pages/admin/AdminMembers.vue';
import AdminSettings from './pages/admin/AdminSettings.vue';
import AdminSlides from './pages/admin/AdminSlides.vue';
import AdminSeo from './pages/admin/AdminSeo.vue';
import AdminParts from './pages/admin/AdminParts.vue';
import AdminMarketExperts from './pages/admin/AdminMarketExperts.vue';
import AdminMarketProjects from './pages/admin/AdminMarketProjects.vue';
import AdminMarketContracts from './pages/admin/AdminMarketContracts.vue';
import AdminMarketSettings from './pages/admin/AdminMarketSettings.vue';

// 라우트 meta 타입 보강
declare module 'vue-router' {
  interface RouteMeta {
    requiresAdmin?: boolean;
    /** 회원 전용 화면 — 비로그인은 그누보드 로그인으로 왕복. */
    requiresMember?: boolean;
    /** 넓은 본문 레이아웃(BOM 워크벤치 등 테이블 중심 화면). */
    wide?: boolean;
    /** 관리자 셸의 기본 본문 여백을 제거하고 페이지가 전체 높이를 사용한다. */
    adminContentFlush?: boolean;
  }
}

// sp-vue 는 관리자 콘솔 + 일반(회원) 화면을 함께 담는다(2026-07-19 스마트 BOM 부터
// 공개 라우트 그룹 신설 — 이전의 "관리자 전용" 전제 변경). 고객 단순 화면은 여전히
// sp-php(`/`) 담당, SPA 급 인터랙션이 필요한 화면만 여기(/app) 또는 sp-market.
// 미구현 메뉴는 placeholder 로 두지 않고 제거, 기능이 생길 때 라우트·메뉴·i18n 동시 추가.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: DefaultLayout,
    children: [{ path: '', name: 'home', component: Home }],
  },
  // 고객 스마트 BOM 견적 — 회원 전용, Parts Eyes 전용 셸(Figma Smart BOM_Web 2.0 이식).
  // 레거시 spSmartBomV2 재설계(docs/BOM_QUOTE.md).
  {
    path: '/bom',
    component: BomLayout,
    meta: { requiresMember: true },
    children: [
      { path: '', name: 'bom', component: BomHome, meta: { requiresMember: true } },
      // 정적 세그먼트가 ':id' 보다 먼저 — 검색·목록 경로가 견적 id 로 매칭되지 않게 한다
      { path: 'search', name: 'bom-search', component: BomSearch, meta: { requiresMember: true } },
      { path: 'history', name: 'bom-history', component: BomHistory, meta: { requiresMember: true } },
      { path: ':id', name: 'bom-quote', component: BomQuote, meta: { requiresMember: true } },
    ],
  },
  // 협력사 포털(포털 재설계 R1 — 관리자 콘솔 미러의 모듈 분리) — 로그인만 프론트에서
  // 보장하고, 파트너 소속·승인은 서버 requirePartner 가 매 요청 판정한다(403 → 안내).
  // 모듈(BOM/PCB) 노출·진입 근거 = 서버 tracks(조직 capabilities). 모듈 간 화면 공유
  // 금지(관리자 D9 미러) — 수금처럼 모듈 무관 화면만 공통 영역에 둔다.
  {
    path: '/partner',
    component: PartnerLayout,
    meta: { requiresMember: true },
    children: [
      {
        // 진입 리졸버 — 정식 진입점(포털 메일이 전부 이 URL). 트랙 0=안내/1=그 모듈/2=기억
        path: '',
        name: 'partner',
        component: () => import('./pages/partner/PartnerEntry.vue'),
        meta: { requiresMember: true },
      },
      // ── BOM 부품 모듈 ──────────────────────────────────────────────────────
      {
        path: 'bom',
        name: 'partner-bom',
        component: () => import('./pages/partner/PartnerBomHome.vue'),
        meta: { requiresMember: true },
      },
      {
        path: 'bom/rfqs/:id',
        name: 'partner-bom-rfq',
        component: () => import('./pages/partner/PartnerRfqDetail.vue'),
        meta: { requiresMember: true },
      },
      {
        path: 'bom/pos/:id',
        name: 'partner-bom-po',
        component: () => import('./pages/partner/PartnerPoDetail.vue'),
        meta: { requiresMember: true },
      },
      {
        // [📦 보내기](§6.11) — 발주서를 박스에 담아 발송을 만드는 순방향 플로우
        path: 'bom/ship',
        name: 'partner-bom-ship',
        component: () => import('./pages/partner/PartnerShip.vue'),
        meta: { requiresMember: true },
      },
      {
        // 완료된 발송(§6.11 분리) — 누적 아카이브, 페이지네이션
        path: 'bom/shipments/done',
        name: 'partner-bom-shipments-done',
        component: () => import('./pages/partner/PartnerShipmentsDone.vue'),
        meta: { requiresMember: true },
      },
      // ── PCB 제작 모듈 ──────────────────────────────────────────────────────
      {
        path: 'pcb',
        name: 'partner-pcb',
        component: () => import('./pages/partner/PartnerPcbHome.vue'),
        meta: { requiresMember: true },
      },
      {
        // PCB 견적요청 상세(docs/PCB_PARTNER_TRACK.md P1) — 회신 + MD 하위 재요청·선정
        path: 'pcb/rfqs/:id',
        name: 'partner-pcb-rfq',
        component: () => import('./pages/partner/PartnerPcbRfqDetail.vue'),
        meta: { requiresMember: true },
      },
      {
        // PCB 발주서 상세(P2) — EQ 5단계 진행 + MD 하위 발주, 발송은 읽기 요약
        path: 'pcb/pos/:id',
        name: 'partner-pcb-po',
        component: () => import('./pages/partner/PartnerPcbPoDetail.vue'),
        meta: { requiresMember: true },
      },
      {
        // PCB A/S(P4) — 재생산 검토 요청 회신(가능/불가+사유·첨부), MD 중계 열람
        path: 'pcb/as',
        name: 'partner-pcb-as',
        component: () => import('./pages/partner/PartnerPcbAs.vue'),
        meta: { requiresMember: true },
      },
      {
        // [📦 PCB 보내기](PCB §9 묶음 재구성) — 받는 곳별 박스에 담아 묶어 발송
        path: 'pcb/ship',
        name: 'partner-pcb-ship',
        component: () => import('./pages/partner/PartnerPcbShip.vue'),
        meta: { requiresMember: true },
      },
      {
        // PCB 완료된 발송(R2 — BOM done 분리 미러) — 누적 아카이브, 페이지네이션
        path: 'pcb/shipments/done',
        name: 'partner-pcb-shipments-done',
        component: () => import('./pages/partner/PartnerPcbShipmentsDone.vue'),
        meta: { requiresMember: true },
      },
      // ── 공통 영역(모듈 밖) ─────────────────────────────────────────────────
      {
        // 수금 현황(P3.11) — 모듈 소속이 본질이 아닌 돈 화면. 현재 데이터는 PCB 발주 대금
        path: 'remittances',
        name: 'partner-remittances',
        component: () => import('./pages/partner/PartnerPcbRemittances.vue'),
        meta: { requiresMember: true },
      },
    ],
  },
  // 매직링크 무로그인 회신(§6.9) — 공개 라우트(가드 없음). 인증은 URL 토큰이 담당하며
  // 서버가 매 요청 검증한다(무효 404). 권한은 그 RFQ 1건 스코프.
  {
    path: '/rfq-reply/:token',
    name: 'rfq-reply',
    component: () => import('./pages/PublicRfqReply.vue'),
  },
  {
    // PCB 매직링크 무로그인 회신(docs/PCB_PARTNER_TRACK.md P1) — 동일 원칙(토큰=인증)
    path: '/pcb-rfq-reply/:token',
    name: 'pcb-rfq-reply',
    component: () => import('./pages/PublicPcbRfqReply.vue'),
  },
  {
    path: '/admin',
    component: AdminLayout,
    meta: { requiresAdmin: true },
    children: [
      { path: '', name: 'admin', component: AdminDashboard },
      { path: 'quotes', name: 'admin-quotes', component: AdminQuotes },
      { path: 'orders', name: 'admin-orders', component: AdminOrders },
      { path: 'members', name: 'admin-members', component: AdminMembers },
      {
        path: 'partners',
        name: 'admin-partners',
        component: () => import('./pages/admin/AdminPartners.vue'),
      },
      // 재능마켓(/market) 관리 — 전문가 심사·프로젝트 모니터·설정
      { path: 'market/experts', name: 'admin-market-experts', component: AdminMarketExperts },
      { path: 'market/projects', name: 'admin-market-projects', component: AdminMarketProjects },
      { path: 'market/contracts', name: 'admin-market-contracts', component: AdminMarketContracts },
      { path: 'market/settings', name: 'admin-market-settings', component: AdminMarketSettings },
      { path: 'slides', name: 'admin-slides', component: AdminSlides },
      { path: 'seo', name: 'admin-seo', component: AdminSeo },
      {
        // 발송 이력(메일·알림톡·SMS 공용 원장) — 코어 모듈 전역 조회
        path: 'mail-logs',
        name: 'admin-mail-logs',
        component: () => import('./pages/admin/AdminMailLogs.vue'),
      },
      {
        path: 'bom',
        name: 'admin-bom',
        component: () => import('./pages/admin/AdminBomUpload.vue'),
        meta: { adminContentFlush: true },
      },
      {
        path: 'bom/:id',
        name: 'admin-bom-quote',
        component: () => import('./pages/admin/AdminBomQuote.vue'),
        meta: { adminContentFlush: true },
      },
      {
        path: 'bom-quotes',
        name: 'admin-bom-quotes',
        component: () => import('./pages/admin/AdminBomQuotes.vue'),
      },
      { path: 'parts', name: 'admin-parts', component: AdminParts },
      { path: 'settings', name: 'admin-settings', component: AdminSettings },
      // 스마트 BOM 모듈(docs/SMARTBOM_PARTNER_RFQ.md §3) — 헤더 모듈 스위처의 두 번째
      // 모듈. 라우트 이름 prefix 'admin-smartbom' 이 모듈 소속 판정 기준(admin/menu.ts).
      {
        path: 'smartbom',
        name: 'admin-smartbom',
        component: () => import('./pages/admin/AdminSmartbomCases.vue'),
      },
      {
        path: 'smartbom/cases/:id',
        name: 'admin-smartbom-case',
        component: () => import('./pages/admin/AdminSmartbomCase.vue'),
      },
      {
        path: 'smartbom/quotes',
        name: 'admin-smartbom-quotes',
        component: () => import('./pages/admin/AdminSmartbomQuotes.vue'),
      },
      {
        path: 'smartbom/orders',
        name: 'admin-smartbom-orders',
        component: () => import('./pages/admin/AdminSmartbomOrders.vue'),
      },
      {
        path: 'smartbom/pos',
        name: 'admin-smartbom-pos',
        component: () => import('./pages/admin/AdminSmartbomPos.vue'),
      },
      {
        path: 'smartbom/logistics',
        name: 'admin-smartbom-logistics',
        component: () => import('./pages/admin/AdminSmartbomLogistics.vue'),
      },
      {
        path: 'smartbom/claims',
        name: 'admin-smartbom-claims',
        component: () => import('./pages/admin/AdminSmartbomClaims.vue'),
      },
      {
        // 입고 스캔(D42)은 선적·배송의 통합 스캔 박스로 합쳤다 — 옛 링크·OAuth 복귀는 그대로 보낸다.
        path: 'smartbom/receiving',
        name: 'admin-smartbom-receiving',
        redirect: (to) => ({ name: 'admin-smartbom-logistics', query: to.query }),
      },
      {
        // 선적 리스트 QR 스캔 도착점(D24) — token은 식별자, 실제 접근은 관리자 가드.
        path: 'smartbom/packages/:code',
        name: 'admin-smartbom-package',
        component: () => import('./pages/admin/AdminSmartbomPackage.vue'),
      },
      {
        // 2026-08-06 통합 관리로 이동. 기존 북마크·외부 링크는 정식 경로로 보낸다.
        path: 'smartbom/partners',
        name: 'admin-smartbom-partners',
        redirect: { name: 'admin-partners' },
      },
      // ── PCB 협력 모듈(docs/PCB_PARTNER_TRACK.md P1) — 라우트 이름 prefix
      // 'admin-pcb' 가 모듈 소속 판정 기준(admin/menu.ts resolveAdminModuleKey).
      {
        path: 'pcb/cases',
        name: 'admin-pcb-cases',
        component: () => import('./pages/admin/AdminPcbCases.vue'),
      },
      {
        path: 'pcb/rfqs',
        name: 'admin-pcb-rfqs',
        component: () => import('./pages/admin/AdminPcbRfqs.vue'),
      },
      {
        path: 'pcb/orders',
        name: 'admin-pcb-orders',
        component: () => import('./pages/admin/AdminPcbOrders.vue'),
      },
      {
        path: 'pcb/pos',
        name: 'admin-pcb-pos',
        component: () => import('./pages/admin/AdminPcbPos.vue'),
      },
      {
        // 송금 워크큐(P3.11) — 지급 대기·부분 송금·협력사별 잔액
        path: 'pcb/remittances',
        name: 'admin-pcb-remittances',
        component: () => import('./pages/admin/AdminPcbRemittances.vue'),
      },
      {
        path: 'pcb/shipments',
        name: 'admin-pcb-shipments',
        component: () => import('./pages/admin/AdminPcbShipments.vue'),
      },
      {
        // PCB 고객 클레임(A/S 접수) 워크큐(P5) — SmartBOM 클레임 미러.
        path: 'pcb/claims',
        name: 'admin-pcb-claims',
        component: () => import('./pages/admin/AdminPcbClaims.vue'),
      },
      {
        // PCB Case QR 스캔 도착점 — token은 식별자, 접근은 관리자 가드와 API 인증이 담당.
        path: 'pcb/packages/:code',
        name: 'admin-pcb-package',
        component: () => import('./pages/admin/AdminPcbPackage.vue'),
      },
      {
        path: 'pcb/cases/:id',
        name: 'admin-pcb-case',
        component: () => import('./pages/admin/AdminPcbCase.vue'),
      },
    ],
  },
];

// 그누보드와 같은 도메인에서 /app 으로 마운트되므로 base 를 고정한다.
export const router = createRouter({
  history: createWebHistory('/app/'),
  routes,
});

// 접근 가드 — UX용. 실제 보안은 sp-node 가 JWT(isAdmin·mbId)를 검증한다.
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAdmin) {
    if (!auth.isLoggedIn) return { name: 'home' };
    if (!auth.me?.isAdmin) return { name: 'home' };
    return true;
  }
  if (to.meta.requiresMember && !auth.isLoggedIn) {
    // 그누보드 로그인 왕복 — 로그인 후 원래 경로로 복귀(auth.bootstrap 이 JWT 재교환)
    window.location.href = loginUrl(appPath(to.fullPath));
    return false;
  }
  return true;
});
