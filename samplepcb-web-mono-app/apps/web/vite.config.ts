import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// 그누보드(samplepcb-web)와 같은 도메인에서 nginx 로 합류한다.
// Vue 는 /app 으로 서빙되므로 base 를 고정하고, dev 에서는 /api(Fastify)·
// /spcb(그누보드 인증 브리지) 를 프록시로 우회시킨다.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: '/app/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/spcb': 'http://localhost:8888',
    },
  },
});
