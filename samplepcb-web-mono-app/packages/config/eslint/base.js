import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// 매우 강함: 타입 인지(type-checked) 규칙 ON.
// no-floating-promises / no-misused-promises / no-unsafe-* / await-thenable 등 활성.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // 타입 인지 린트를 위해 프로젝트 서비스 사용
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // TS 컴파일러가 미정의 식별자를 잡으므로 no-undef 는 끈다(typescript-eslint 권장)
      'no-undef': 'off',
    },
  },
  {
    // 설정/선언 파일은 타입 인지 린트(projectService) 대상에서 제외
    ignores: [
      'dist/**',
      'build/**',
      '.turbo/**',
      'node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/*.config.cjs',
      '**/*.d.ts',
    ],
  },
);
