import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 연구용 독립 SPA. 통합 개발 호스트에서는 /rnd/ 경로로 제공한다.
export default defineConfig({
  plugins: [vue()],
  base: '/rnd/',
  server: {
    port: 5177,
    strictPort: true,
    // Windows에서 nginx의 IPv4 프록시와 일치하도록 명시한다.
    host: '127.0.0.1',
    allowedHosts: ['local-web.samplepcb.co.kr'],
  },
});
