import { defineConfig } from 'tsup';

// 운영 빌드(node dist/server.js)용 설정.
// 워크스페이스 패키지 @sp/* 는 빌드 산출물 없이 src/index.ts(소스)만 노출하므로,
// external 로 두면 런타임에서 .ts 를 만나 ERR_UNKNOWN_FILE_EXTENSION 이 난다.
// → noExternal 로 번들에 포함시켜 dist/server.js 를 자기완결형으로 만든다.
// (fastify·prisma 등 실제 npm 의존성은 external 유지 = node_modules 에서 로드)
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  clean: true,
  noExternal: [/^@sp\//],
});
