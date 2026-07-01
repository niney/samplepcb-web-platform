import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import DefaultLayout from './layouts/DefaultLayout.vue';
import AdminLayout from './layouts/AdminLayout.vue';
import Home from './pages/Home.vue';
import AdminDashboard from './pages/admin/AdminDashboard.vue';
import AdminPlaceholder from './pages/admin/AdminPlaceholder.vue';

// 라우트 meta 타입 보강
declare module 'vue-router' {
  interface RouteMeta {
    requiresAdmin?: boolean;
    titleKey?: string;
  }
}

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
      {
        path: 'quotes',
        name: 'admin-quotes',
        component: AdminPlaceholder,
        meta: { titleKey: 'admin.menu.quotes' },
      },
      {
        path: 'orders',
        name: 'admin-orders',
        component: AdminPlaceholder,
        meta: { titleKey: 'admin.menu.orders' },
      },
      {
        path: 'products',
        name: 'admin-products',
        component: AdminPlaceholder,
        meta: { titleKey: 'admin.menu.products' },
      },
      {
        path: 'stats',
        name: 'admin-stats',
        component: AdminPlaceholder,
        meta: { titleKey: 'admin.menu.stats' },
      },
      {
        path: 'settings',
        name: 'admin-settings',
        component: AdminPlaceholder,
        meta: { titleKey: 'admin.menu.settings' },
      },
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
