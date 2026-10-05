import cfg from '@sp/config/eslint/vue';
import { plugin as shadcn } from '@shadcn/lint';

// @shadcn/lint — 관리자 리뉴얼(src/next) 디자인 시스템 규칙.
// 공용 설정(@sp/config)은 손대지 않고 이 앱에만 붙인다(sp-market·sp-develop 무영향).
// 규칙은 새 코드(src/next)에만 건다 — 옛 화면은 컷오버 때 지울 코드라 경고만 쌓인다.
// 테마·컴포넌트 위치는 components.json(테마 = src/next/theme.css, ui = @/next/components/ui)에서 읽는다.
export default [
  ...cfg,
  { files: ['**/*.vue', '**/*.ts'], plugins: { shadcn } },
  {
    files: ['src/next/**/*.{vue,ts}'],
    rules: {
      'shadcn/no-restyle': ['error', { allow: ['layout'] }],
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-arbitrary-values': ['error', { allow: ['layout'] }],
      'shadcn/no-inline-styles': 'error',
      'shadcn/require-static-classes': 'error',
      'shadcn/no-unknown-classes': 'warn',
    },
  },
  {
    // shadcn 원본 컴포넌트(CLI 가 복사해 넣은 업스트림 코드) — 남의 코드처럼 다룬다.
    // ① 자기 모양을 직접 정의하므로 restyle 계열 규칙은 끈다(문서 권장 예외).
    // ② 업스트림 문체와 충돌하는 엄격 TS·Vue 규칙은 끈다 — 고쳐 두면 `shadcn-vue add --overwrite`
    //    때마다 되돌아가 diff 만 남는다. no-unsafe-argument 는 .vue 가 export 한 타입을 ESLint 가
    //    error 타입으로 보는 알려진 한계(SidebarMenuButtonProps) 때문이다. 우리 코드에는 그대로 건다.
    files: ['src/next/components/ui/**'],
    rules: {
      'shadcn/no-restyle': 'off',
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/require-static-classes': 'off',
      'shadcn/no-unknown-classes': 'off',
      'vue/require-default-prop': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-function-type': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
];
