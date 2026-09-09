import type { RouteRecordRaw } from 'vue-router';
export const developCChildren: RouteRecordRaw[] = [
  { path: '', name: 'c-home', component: () => import('./c/pages/Home.vue') },
  { path: 'request', name: 'c-request', component: () => import('./c/pages/RequestWizard.vue') },
  { path: 'me', name: 'c-me', component: () => import('./c/pages/Me.vue') },
  { path: 'requests/:id(\\d+)', name: 'c-request-detail', component: () => import('./c/pages/RequestDetail.vue') },
  { path: 'requests/:id(\\d+)/edit', name: 'c-request-edit', component: () => import('./c/pages/RequestEdit.vue') },
  {
    path: 'requests/:id(\\d+)/quotes/:qid(\\d+)/print',
    name: 'c-quote-print',
    component: () => import('./c/pages/QuotePrint.vue'),
    meta: { bare: true }, // 인쇄용 — 헤더·푸터 없이
  },
  {
    path: 'requests/:id(\\d+)/documents/:docId(\\d+)/print',
    name: 'c-document-print',
    component: () => import('./c/pages/DocumentPrint.vue'),
    meta: { bare: true }, // 프로젝트 문서 인쇄용 — 견적서 인쇄 라우트와 같은 관례
  },
];
