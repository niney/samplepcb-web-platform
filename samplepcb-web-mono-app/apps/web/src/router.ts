import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import DefaultLayout from './layouts/DefaultLayout.vue';
import AdminLayout from './layouts/AdminLayout.vue';
import Home from './pages/Home.vue';
import AdminDashboard from './pages/admin/AdminDashboard.vue';
import AdminQuotes from './pages/admin/AdminQuotes.vue';
import AdminOrders from './pages/admin/AdminOrders.vue';
import AdminMembers from './pages/admin/AdminMembers.vue';
import AdminSettings from './pages/admin/AdminSettings.vue';
import AdminMarketExperts from './pages/admin/AdminMarketExperts.vue';
import AdminMarketProjects from './pages/admin/AdminMarketProjects.vue';
import AdminMarketSettings from './pages/admin/AdminMarketSettings.vue';

// 라우트 meta 타입 보강
declare module 'vue-router' {
  interface RouteMeta {
    requiresAdmin?: boolean;
  }
}

// sp-vue 는 사실상 관리자 앱 — 고객 대면 화면은 sp-php(`/`) 담당이라 /admin 하위가
// 실질 본문이다. 미구현 메뉴(주문/상품/통계/설정)는 placeholder 로 두지 않고 제거,
// 기능이 생길 때 라우트·메뉴·i18n 을 함께 추가한다.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: DefaultLayout,
    children: [{ path: '', name: 'home', component: Home }],
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
      { path: 'market/settings', name: 'admin-market-settings', component: AdminMarketSettings },
      { path: 'settings', name: 'admin-settings', component: AdminSettings },
    ],
  },
];

// 그누보드와 같은 도메인에서 /app 으로 마운트되므로 base 를 고정한다.
export const router = createRouter({
  history: createWebHistory('/app/'),
  routes,
});

// 관리자 접근 가드 — UX용. 실제 보안은 sp-node 가 JWT 의 isAdmin 을 검증한다.
router.beforeEach((to) => {
  if (!to.meta.requiresAdmin) return true;
  const auth = useAuthStore();
  if (!auth.isLoggedIn) return { name: 'home' };
  if (!auth.me?.isAdmin) return { name: 'home' };
  return true;
});
