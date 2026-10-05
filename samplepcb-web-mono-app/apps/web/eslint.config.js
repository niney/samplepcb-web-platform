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
      'shadcn/no-restyle': [
        'error',
        {
          allow: ['layout'],
          contracts: [
            // 표 칸은 내용(숫자·코드·보조 글자)에 따라 글자 모양·색을 칸마다 정한다 — 칸을 span 으로
            // 한 겹 더 감싸지 않게 허용한다. 여백은 표 밀도를 지키려고 열지 않는다.
            { pattern: '^Table(Cell|Head)$', allow: ['layout', 'typography', 'color'] },
            // 카드 안쪽 여백은 담는 내용(표·폼)에 따라 화면이 정한다(문서 권장 예).
            { pattern: '^Card$|^Card(Header|Content|Footer)$', allow: ['layout', 'spacing'] },
          ],
        },
      ],
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-arbitrary-values': ['error', { allow: ['layout'] }],
      'shadcn/no-inline-styles': 'error',
      'shadcn/require-static-classes': 'error',
      'shadcn/no-unknown-classes': 'warn',
    },
  },
  {
    // 인쇄·PDF 문서(라벨·인보이스·견적서) — 화면이 아니라 종이 서류라 디자인 시스템 밖이다.
    // 실측 글자 크기(8~10px)·테마와 무관한 흰 종이·검은 글자, PDF 캡처(html2canvas)가 읽는 인라인
    // 스타일을 그대로 쓴다. 이런 문서는 반드시 `print/` 폴더에 둔다(파일 안 disable 주석으로 풀지 않는다).
    files: ['src/next/**/print/**'],
    rules: {
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/no-inline-styles': 'off',
      'shadcn/no-raw-colors': 'off',
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
