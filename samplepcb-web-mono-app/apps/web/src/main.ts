import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { useAuthStore } from '@sp/shared';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import 'pretendard/dist/web/variable/pretendardvariable.css'; // 기본 폰트(전 굵기 커버 variable)
import './style.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(i18n);
  app.use(VueQueryPlugin);

  // 마운트 전에 그누보드 인증 브리지로 세션을 복원한다.
  // (pinia 인스턴스를 명시해 컴포넌트 밖에서도 안전하게 store 를 쓴다.)
  // ⚠ 순서 중요: vue-router 는 install(app.use) 시점에 초기 네비게이션을 시작하므로
  // router 설치는 복원 **뒤**여야 한다 — 아니면 /app/admin/* 딥링크가 빈 auth 상태의
  // 가드에 걸려 홈으로 튕긴다(2026-07-03 관리자 견적 관리에서 실측).
  await useAuthStore(pinia).bootstrap();

  app.use(router);
  app.mount('#app');
}

void bootstrap();
