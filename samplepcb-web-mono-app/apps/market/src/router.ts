import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import MarketLayout from './layouts/MarketLayout.vue';
import Home from './pages/Home.vue';

// sp-market 은 고객 대면 재능마켓 SPA — 관리자 가드 없음(관리 화면은 sp-vue /app/admin).
// 로그인이 필요한 액션은 라우트 가드가 아니라 각 화면이 그누보드 로그인으로 보낸다
// (/bbs/login.php?url=… — 같은 오리진 왕복 후 auth.bootstrap() 이 세션을 JWT 로 교환).
// 미구현 메뉴는 placeholder 라우트로 두지 않고, 기능이 생길 때 라우트·i18n 을 함께 추가한다.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: MarketLayout,
    children: [{ path: '', name: 'home', component: Home }],
  },
];

// 그누보드와 같은 도메인에서 /market 으로 마운트되므로 base 를 고정한다.
export const router = createRouter({
  history: createWebHistory('/market/'),
  routes,
});
