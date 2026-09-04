import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { useAuthStore } from '@sp/shared';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import './style.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(i18n);
  app.use(VueQueryPlugin);
  // 마운트 전에 그누보드 인증 브리지로 세션을 복원한다 — router 설치는 복원 **뒤**(딥링크가 비로그인으로 첫 렌더되지 않게, 마켓 main.ts 관례).
  await useAuthStore(pinia).bootstrap();
  app.use(router);
  app.mount('#app');
}

void bootstrap();
