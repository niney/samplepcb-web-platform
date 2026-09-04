import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// 개발의뢰(sp-develop, docs/DEVELOP_FLOW.md) — 그누보드(samplepcb-web)와 같은 도메인에서 nginx 로 합류한다.
// /develop 으로 서빙되므로 base 를 고정하고, dev 에서는 /api(Fastify)·/spcb(그누보드 인증 브리지)를 프록시로 우회시킨다.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: '/develop/',
  server: {
    // 5173=sp-vue, 5174·5175=worktree 병렬 대역, 5176=sp-market — 그 다음 번호.
    port: Number(process.env.SP_DEVELOP_PORT ?? 5177),
    // nginx location /develop/ 가 5177 고정 프록시 — 점유 시 조용히 밀리면 라우팅이 끊기므로 명시적으로 실패시킨다.
    strictPort: true,
    // IPv4 루프백 — 기본 'localhost' 는 Windows 에서 IPv6(::1)로만 열려 nginx(IPv4) 가 502.
    host: '127.0.0.1',
    allowedHosts: ['local-web.samplepcb.co.kr'],
    proxy: {
      '/api': process.env.SP_API_TARGET ?? 'http://127.0.0.1:3333',
      '/spcb': 'http://127.0.0.1:8888',
    },
  },
});
