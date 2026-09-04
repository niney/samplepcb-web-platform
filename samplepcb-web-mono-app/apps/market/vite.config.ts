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
    // 워크트리에서 두 번째 인스턴스를 띄울 땐 SP_MARKET_PORT/SP_API_TARGET 으로 옮긴다
    // (본 checkout 의 5176·3333 을 건드리지 않고 나란히 확인하기 위한 통로).
    port: Number(process.env.SP_MARKET_PORT ?? 5176),
    // nginx location /market/ 가 5176 고정 프록시 — 점유 시 조용히 다른 포트로
    // 밀리면(라우팅 무단절단) 원인 찾기 어려우므로 명시적으로 실패시킨다.
    strictPort: true,
    // IPv4 루프백에 바인딩. 기본값 'localhost'는 Windows에서 IPv6(::1)로만 열려
    // nginx의 proxy_pass http://127.0.0.1:5176 (IPv4)가 502(connection refused)가 된다.
    host: '127.0.0.1',
    // nginx(443)가 같은 도메인으로 /market 을 프록시 → Host: local-web.samplepcb.co.kr.
    // Vite 는 기본적으로 비허용 Host 를 403 차단하므로 명시 허용한다.
    allowedHosts: ['local-web.samplepcb.co.kr'],
    proxy: {
      '/api': process.env.SP_API_TARGET ?? 'http://127.0.0.1:3333',
      '/spcb': 'http://127.0.0.1:8888',
    },
  },
});
