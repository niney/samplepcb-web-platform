import { defineConfig } from 'vitest/config';

// 파트너 포털 E2E 러너 — 옵트인(PORTAL_E2E=1) 없이는 전 스펙이 skip 되므로
// turbo test/CI 에서는 무해하게 통과한다(apps/api 의 PARTS_IT=1 관례 미러).
// 공유 DB(sp_* = 그누보드 동거)라 파일 간 병렬을 금지한다 — 시드·정리가 겹치면
// "협력2 PO 0건" 같은 전제가 깨진다. 파일 안 test 는 원래 정의 순서대로 직렬.
export default defineConfig({
  test: {
    include: ['specs/**/*.e2e.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
