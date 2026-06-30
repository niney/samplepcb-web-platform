import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import Home from './pages/Home.vue';

const routes: RouteRecordRaw[] = [{ path: '/', component: Home }];

// 그누보드와 같은 도메인에서 /app 으로 마운트되므로 base 를 고정한다.
export const router = createRouter({
  history: createWebHistory('/app/'),
  routes,
});
