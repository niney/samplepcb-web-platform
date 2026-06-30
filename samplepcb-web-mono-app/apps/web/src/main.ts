import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { useAuthStore } from '@sp/shared';
import App from './App.vue';
import { router } from './router';
import './style.css';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(VueQueryPlugin);
  app.use(router);

  // 마운트 전에 그누보드 인증 브리지로 세션을 복원한다.
  // (pinia 인스턴스를 명시해 컴포넌트 밖에서도 안전하게 store 를 쓴다.)
  await useAuthStore(pinia).bootstrap();

  app.mount('#app');
}

void bootstrap();
