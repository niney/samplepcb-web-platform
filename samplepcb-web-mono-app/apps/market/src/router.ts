import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import MarketLayout from './layouts/MarketLayout.vue';
import Home from './pages/Home.vue';
import Projects from './pages/Projects.vue';
import ProjectDetail from './pages/ProjectDetail.vue';
import Experts from './pages/Experts.vue';
import ExpertDetail from './pages/ExpertDetail.vue';
import RequestWizard from './pages/RequestWizard.vue';
import ExpertRegister from './pages/ExpertRegister.vue';
import Me from './pages/Me.vue';

// sp-market 은 고객 대면 재능마켓 SPA — 관리자 가드 없음(관리 화면은 sp-vue /app/admin).
// 로그인이 필요한 액션은 라우트 가드가 아니라 각 화면이 그누보드 로그인으로 보낸다
// (/bbs/login.php?url=… — 같은 오리진 왕복 후 auth.bootstrap() 이 세션을 JWT 로 교환).
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: MarketLayout,
    children: [
      { path: '', name: 'home', component: Home },
      { path: 'projects', name: 'projects', component: Projects },
      { path: 'projects/:id(\\d+)', name: 'project-detail', component: ProjectDetail },
      { path: 'experts', name: 'experts', component: Experts },
      { path: 'experts/:id(\\d+)', name: 'expert-detail', component: ExpertDetail },
      { path: 'request', name: 'request', component: RequestWizard },
      { path: 'expert/register', name: 'expert-register', component: ExpertRegister },
      { path: 'me', name: 'me', component: Me },
    ],
  },
];

// 그누보드와 같은 도메인에서 /market 으로 마운트되므로 base 를 고정한다.
export const router = createRouter({
  history: createWebHistory('/market/'),
  routes,
  scrollBehavior(to) {
    if (to.hash !== '') return { el: to.hash, behavior: 'smooth' };
    return { top: 0 };
  },
});
