import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import DevelopLayout from './layouts/DevelopLayout.vue';

// sp-develop 은 고객 대면 개발의뢰 SPA(docs/DEVELOP_FLOW.md §7.2) — 공개 목록이 없고 모든 의뢰 화면은 소유자만.
// 로그인이 필요한 화면은 라우트 가드가 아니라 각 화면이 그누보드 로그인으로 보낸다(/bbs/login.php?url=… 왕복).
const children: RouteRecordRaw[] = [
  { path: '', name: 'home', component: () => import('./pages/Home.vue') },
  { path: 'request', name: 'request', component: () => import('./pages/RequestWizard.vue') },
  { path: 'me', name: 'me', component: () => import('./pages/Me.vue') },
  { path: 'requests/:id(\\d+)', name: 'request-detail', component: () => import('./pages/RequestDetail.vue') },
  { path: 'requests/:id(\\d+)/edit', name: 'request-edit', component: () => import('./pages/RequestEdit.vue') },
  {
    path: 'requests/:id(\\d+)/quotes/:qid(\\d+)/print',
    name: 'quote-print',
    component: () => import('./pages/QuotePrint.vue'),
    meta: { bare: true }, // 인쇄용 — 헤더·푸터 없이
  },
];

const routes: RouteRecordRaw[] = [{ path: '/', component: DevelopLayout, children }];

export const router = createRouter({
  history: createWebHistory('/develop/'),
  routes,
  scrollBehavior(to) {
    if (to.hash !== '') return { el: to.hash, behavior: 'smooth' };
    return { top: 0 };
  },
});
