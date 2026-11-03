import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import AppShellLayout from './layouts/AppShellLayout.vue';
import DevelopLayout from './layouts/DevelopLayout.vue';

// sp-develop 은 고객 대면 개발의뢰 SPA(docs/DEVELOP_FLOW.md §7.2) — 공개 목록이 없고 모든 의뢰 화면은 소유자만.
// 로그인이 필요한 화면은 라우트 가드가 아니라 각 화면이 그누보드 로그인으로 보낸다(/bbs/login.php?url=… 왕복).
// 2026-09-10 G/C 공존(/develop/c) 종료 — C 구현이 루트 경로의 정본이다. 옛 /c/* 주소는 같은 화면으로 돌려보낸다.
// 셸은 둘이다(사용자 결정 2026-11-03): 사이트 셸(DevelopLayout — 흰 헤더·푸터) = 랜딩, 앱 셸(AppShellLayout — 피그마 01-x 의
// 어두운 틀·사이드바) = 로그인한 고객이 쓰는 화면 전부. 목록↔상세를 오갈 때 틀이 바뀌지 않게 상세·수정도 앱 셸이다.

// meta.bg — 사이트 셸은 페이지 바탕, 앱 셸은 본문 판 바탕. 'white' = 흰 바탕(랜딩·내 의뢰 — 피그마 시안대로),
// 'soft' = #fdfdfd(의뢰 상세 — 디자인 체크리스트 9번). 없으면 사이트 셸은 종이색, 앱 셸은 위저드 그라데이션.
const siteChildren: RouteRecordRaw[] = [
  { path: '', name: 'home', component: () => import('./pages/Home.vue'), meta: { bg: 'white' } },
  {
    path: 'requests/:id(\\d+)/print',
    name: 'request-print',
    component: () => import('./pages/RequestPrint.vue'),
    meta: { bare: true }, // 의뢰 출력물('출력하기') — 견적서 인쇄 라우트와 같은 관례
  },
  {
    path: 'requests/:id(\\d+)/quotes/:qid(\\d+)/print',
    name: 'quote-print',
    component: () => import('./pages/QuotePrint.vue'),
    meta: { bare: true }, // 인쇄용 — 헤더·푸터 없이
  },
  {
    path: 'requests/:id(\\d+)/documents/:docId(\\d+)/print',
    name: 'document-print',
    component: () => import('./pages/DocumentPrint.vue'),
    meta: { bare: true }, // 프로젝트 문서 인쇄용 — 견적서 인쇄 라우트와 같은 관례
  },
];

const appChildren: RouteRecordRaw[] = [
  { path: 'request', name: 'request', component: () => import('./pages/RequestWizard.vue') },
  { path: 'me', name: 'me', component: () => import('./pages/Me.vue'), meta: { bg: 'white' } },
  { path: 'requests/:id(\\d+)', name: 'request-detail', component: () => import('./pages/RequestDetail.vue'), meta: { bg: 'soft' } },
  { path: 'requests/:id(\\d+)/edit', name: 'request-edit', component: () => import('./pages/RequestEdit.vue') },
];

const routes: RouteRecordRaw[] = [
  { path: '/c/:rest(.*)*', redirect: (to) => `/${Array.isArray(to.params.rest) ? to.params.rest.join('/') : (to.params.rest ?? '')}` },
  { path: '/', component: DevelopLayout, children: siteChildren },
  { path: '/', component: AppShellLayout, children: appChildren },
];

export const router = createRouter({
  history: createWebHistory('/develop/'),
  routes,
  scrollBehavior(to, from) {
    // 의뢰 상세는 해시가 탭이다(#quotes 등 — 화면이 해시로 탭을 고른다). 같은 의뢰 안 탭 전환은 제자리, 들어올 때는 맨 위.
    if (to.name === 'request-detail') return to.path === from.path ? false : { top: 0 };
    // 사이트 셸 고정 헤더(72px) 아래로 40px 띄워 멈춘다 — vue-router 는 CSS scroll-margin 을 보지 않는다.
    if (to.hash !== '') return { el: to.hash, top: 112, behavior: 'smooth' };
    return { top: 0 };
  },
});
