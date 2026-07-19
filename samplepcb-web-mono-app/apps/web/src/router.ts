import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import DefaultLayout from './layouts/DefaultLayout.vue';
import AdminLayout from './layouts/AdminLayout.vue';
import BomLayout from './layouts/BomLayout.vue';
import Home from './pages/Home.vue';
import BomHome from './pages/bom/BomHome.vue';
import BomQuote from './pages/bom/BomQuote.vue';
import { appPath, loginUrl } from './lib/auth-urls';
import AdminDashboard from './pages/admin/AdminDashboard.vue';
import AdminQuotes from './pages/admin/AdminQuotes.vue';
import AdminOrders from './pages/admin/AdminOrders.vue';
import AdminMembers from './pages/admin/AdminMembers.vue';
import AdminSettings from './pages/admin/AdminSettings.vue';
import AdminSlides from './pages/admin/AdminSlides.vue';
import AdminSeo from './pages/admin/AdminSeo.vue';
import AdminBom from './pages/admin/AdminBom.vue';
import AdminBomQuotes from './pages/admin/AdminBomQuotes.vue';
import AdminParts from './pages/admin/AdminParts.vue';
import AdminBomJob from './pages/admin/AdminBomJob.vue';
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
      { path: ':id', name: 'bom-quote', component: BomQuote, meta: { requiresMember: true } },
    ],
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
      // 재능마켓(/market) 관리 — 전문가 심사·프로젝트 모니터·설정
      { path: 'market/experts', name: 'admin-market-experts', component: AdminMarketExperts },
      { path: 'market/projects', name: 'admin-market-projects', component: AdminMarketProjects },
      { path: 'market/contracts', name: 'admin-market-contracts', component: AdminMarketContracts },
      { path: 'market/settings', name: 'admin-market-settings', component: AdminMarketSettings },
      { path: 'slides', name: 'admin-slides', component: AdminSlides },
      { path: 'seo', name: 'admin-seo', component: AdminSeo },
      { path: 'bom', name: 'admin-bom', component: AdminBom },
      { path: 'bom-quotes', name: 'admin-bom-quotes', component: AdminBomQuotes },
      { path: 'parts', name: 'admin-parts', component: AdminParts },
      { path: 'bom/:id', name: 'admin-bom-job', component: AdminBomJob },
      { path: 'settings', name: 'admin-settings', component: AdminSettings },
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
