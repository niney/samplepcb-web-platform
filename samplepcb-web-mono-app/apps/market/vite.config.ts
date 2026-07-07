import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// 그누보드(samplepcb-web)와 같은 도메인에서 nginx 로 합류한다.
// 재능마켓(sp-market)은 /market 으로 서빙되므로 base 를 고정하고, dev 에서는
// /api(Fastify)·/spcb(그누보드 인증 브리지) 를 프록시로 우회시킨다.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: '/market/',
  server: {
    // 5173=sp-vue, 5174·5175=git worktree 병렬 dev 대역 — 그 다음 번호를 쓴다.
    port: 5176,
    // IPv4 루프백에 바인딩. 기본값 'localhost'는 Windows에서 IPv6(::1)로만 열려
    // nginx의 proxy_pass http://127.0.0.1:5176 (IPv4)가 502(connection refused)가 된다.
    host: '127.0.0.1',
    // nginx(443)가 같은 도메인으로 /market 을 프록시 → Host: local-web.samplepcb.co.kr.
    // Vite 는 기본적으로 비허용 Host 를 403 차단하므로 명시 허용한다.
    allowedHosts: ['local-web.samplepcb.co.kr'],
    proxy: {
      '/api': 'http://127.0.0.1:3333',
      '/spcb': 'http://127.0.0.1:8888',
    },
  },
});
