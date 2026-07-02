import cfg from '@sp/config/eslint/node';

export default [
  ...cfg,
  {
    // 마이그레이션/검증 CLI 스크립트는 콘솔 출력이 결과물이다.
    files: ['src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
