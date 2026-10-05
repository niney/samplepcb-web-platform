# 관리자 리뉴얼(shadcn-vue) — `src/next`

sp-vue 관리자 화면을 shadcn-vue로 다시 짓는 작업의 정본 문서. **PCB 모듈부터** 시작한다(2026-10-06).

## 1. 방식 — 나란히 짓고 한 번에 넘긴다

- 새 화면은 `apps/web/src/next/` 에만 만든다. 옛 화면(`pages/admin/AdminPcb*.vue`, `components/admin/pcb/*`)은 **건드리지 않는다**.
- 경로: `/app/admin/next/pcb/*` (셸 `next/layouts/AdminNextLayout.vue`, 지연 로딩).
- 라우트 이름은 `next/pcb-navigation.ts` 의 `NEXT_PCB_ROUTES` 로만 부른다. 화면 코드에 문자열로 쓰지 않는다.
- **컷오버**: `NEXT_PCB_ROUTES` 값을 `admin-pcb-*` 로, `NEXT_PCB_BASE_PATH` 를 `/admin/pcb` 로 바꾸고 라우트를 옛 경로로 옮긴 뒤 옛 파일을 지운다. 바깥 링크(`menu.ts`·메일 딥링크·e2e URL 517곳)는 고치지 않는다. e2e 는 선택자만 고친다.
- 레이아웃(화면 배치·정보 순서)은 옛 화면과 같게, 디자인(색·컴포넌트·간격)만 새로 한다.

## 2. 디자인 결정 (권장값으로 확정)

| 항목 | 결정 |
|---|---|
| 스타일 | shadcn-vue `new-york`, 기본 색조 slate |
| 주 색상 | 브랜드 파랑 — 라이트 `#1e64fd`(흰 글자 AA), 다크 `#5c9bff` |
| 상태색 | `success`·`warning`·`info`·`destructive` + 각 `*-soft`(배지·알림 바탕). Badge 변형 `success`·`warning`·`info`·`danger` |
| 모서리 | Tailwind 기본값 유지 — `--radius-*` 재정의 금지(옛 `rounded-*` 2,022곳 보호) |
| 밀도 | 기본 컨트롤 높이 32px(Button/Input/Select `h-8`), Button `sm` 28px |
| 다크 | `<html data-theme="dark">` 하나로(기존과 동일). `dark:` 변형은 `[data-theme=dark]` 에 연결 |
| 글꼴 | Pretendard(기존) |
| 아이콘 | `@lucide/vue` |

## 3. Tailwind 영향 범위

- Tailwind 는 한 벌(`style.css`)이고 `next/theme.css` 를 불러온다.
- shadcn 토큰(`--primary` 등)은 `:root`·`[data-theme="dark"]` 에 둔다 — 기존 코드가 같은 이름을 한 번도 쓰지 않아 옛 화면은 그대로다(실측 0곳). 포털(Dialog·Popover)도 같은 값을 받는다.
- 전역 기본 스타일(`* { border-color }`, `body` 배경)은 `html.sp-next` 아래로만 — 새 셸이 마운트될 때 붙고 떠날 때 뗀다.
- `shadcn-vue init` 은 쓰지 않는다(전역 base 레이어·radius 를 CSS 에 써넣는다). `components.json` 은 직접 관리하고 `add` 만 쓴다.

## 4. 컴포넌트 추가 절차

```bash
cd samplepcb-web-mono-app/apps/web
pnpm dlx shadcn-vue@latest add <name> -y
node scripts/next-ui-expect-errors.mjs   # exactOptionalPropertyTypes 충돌에 사유 주석
npx vue-tsc --noEmit
```

- 우리 tsconfig 의 `exactOptionalPropertyTypes` 와 reka-ui prop 타입이 파일마다 한 줄씩 충돌한다(런타임 무해). 스크립트가 해당 줄 위에 `@vue-expect-error`/`@ts-expect-error` + 사유를 단다(AGENTS.md "불가피하면 expect-error + 사유").
- 관리자 밀도(32px)는 생성 코드의 기본 높이를 고친 것이다 — `add --overwrite` 하면 되돌아가니 다시 맞출 것(button·input·input-group·native-select·select·tabs·ellipsis 2종).

## 5. 린트 — `@shadcn/lint` 0.2.0 (고정)

- `apps/web/eslint.config.js` 에만 붙였다(공용 `@sp/config` 무수정 → market·develop 무영향).
- 규칙은 `src/next/**` 에만 `error`: `no-restyle`(layout 허용)·`no-raw-colors`·`no-arbitrary-values`(layout 허용)·`no-inline-styles`·`require-static-classes`, `no-unknown-classes` 는 `warn`. 옛 코드는 끈다.
- `src/next/components/ui/**`(업스트림 코드)는 restyle 계열과 업스트림 문체와 충돌하는 엄격 TS 규칙을 끈다.
- 테마는 `components.json` → `src/next/theme.css`. 린터는 여기 선언된 색만 토큰으로 알아서, 새 코드에 옛 토큰(`ink-*`·`surface-*`·`brand-*`)·Tailwind 팔레트(`gray-*`)가 들어오면 잡는다(2026-10-06 실측). 실행마다 "theme.css 가 Tailwind 를 import 하지 않아 style.css 로 클래스를 판정한다"는 안내가 한 줄 나오는데 의도된 동작이다.
- 린터가 못 보는 곳: `<style>` 블록, 부모 선택자(`[&_button]:`), 다른 파일에서 import 한 class 값, `<component :is>`. → **새 코드에 `<style>` 블록을 두지 않는다.**

```bash
npx eslint src/next/<경로>     # 수정한 파일만 — 전체는 수 분 걸린다(타입 인지 린트)
```

## 6. 화면 작성 규약 (PCB 리뉴얼)

- **import**: UI 는 `@/next/components/ui/*`, `cn` 은 `@/next/lib/utils`, 라우트는 `@/next/pcb-navigation`. 데이터 훅(`@/admin/useAdminPcb*`)·계약(`@sp/api-contract`)·순수 함수(`@/lib/pcb-money` 등)는 옛 것을 그대로 쓴다.
- **옛 컴포넌트를 import 하지 않는다**(`@/components/**`). 옛 lib 중 **class 문자열을 돌려주는 것**(`pcbCategoryBadge().cls` 등)은 쓰지 않고 `next/` 쪽 매핑을 쓴다.
- 금지: `<style>` 블록, 인라인 style, 임의값(배치 외), Tailwind 기본 팔레트, 옛 토큰. 색은 토큰으로만.
- 확인·입력 대화상자: `@/next/lib/dialog` 의 `confirmDialog`·`promptDialog`(셸이 호스트를 띄운다). 옛 `@/lib/confirmDialog` 를 부르면 옛 모양이 뜬다.
- 숫자는 `tabular-nums`, 보조 글자는 `text-muted-foreground`, 표 본문 `text-sm`.
- 화면 골격: 머리(제목·설명·우측 동작) → 탭(건수 배지)+검색 → 카드 안의 표 → 페이지네이션. 공용 조각은 `next/components/pcb/`.

## 7. 키트 (`next/components/common`·`next/components/pcb`)

기준 화면: `pages/pcb/PcbRfqsPage.vue`(탭+대기 큐+표+선택 삭제), `PcbCasesPage.vue`(구간 탭+단계 칩). 새 목록 화면은 이 둘을 본떠 쓴다.

**common** (모듈 무관)
- `PageHeader` — `title`, `description?` · 슬롯 `#description`(마크업 설명), `#actions`(우측 버튼).
- `QueueTabs` — `v-model`(탭 key), `tabs: QueueTab<T>[]`(`key`·`label`·`count?`(null=모름)·`attention?`(건수를 경고 배지로)) · 슬롯 `#end`(검색 등). 타입은 `common/queue-tabs.ts`.
- `SearchInput` — `v-model`(입력 중 글자), `placeholder` · `@search`(Enter 확정). 키 입력마다 조회하지 않는다.
- `TableCard` — 표를 담는 테두리 상자(shadcn Card 대신 — Card 의 py-6 여백 없음, 첫·끝 열 안쪽 여백).
- `TableEmptyRow` — `colspan`, `text`, `loading?`(스피너+'불러오는 중…'). `TableBody` 안 마지막 줄.
- `RowCheckbox` — `checked: boolean | 'indeterminate'`, `label`(aria), `disabled?` · `@change(boolean)`. 클릭이 행 클릭으로 번지지 않는다. 머리 칸은 `allSelected ? true : someSelected ? 'indeterminate' : false`.
- `ListPagination` — `page`, `pageSize`, `total` · `@update:page`. 왼쪽 '총 N건', 한 쪽이면 번호 숨김.

**pcb**
- `pcb-badges.ts` — `pcbCategoryBadge`·`pcbQuoteBadge`·`pcbRfqReplyBadge`·`pcbStepBadge`·`pcbAsRoundBadge`·`pcbOrderStatusBadge` → `{ label, variant }`. `<Badge :variant="b.variant">{{ b.label }}</Badge>`. 뜻별 variant: warning=기다림·주의, info=진행, success=끝남, danger=문제, secondary=중립·이력, outline=부가 표지. 새 사전도 여기에 더한다.
- `CustomerCell` — `name`, `mbId`(이름 앞세우고 아이디 병기, 빈 이름='이름 없음', 비회원).
- `SelectionBar` — `count` · `@delete`. 항상 보이고, 고른 게 있을 때만 버튼이 붉어진다.
- `DeleteQuoteDialog` — `ids` · `@close`·`@deleted`. `v-if` 로 띄운다(열린 채 마운트). 옛 DeleteQuoteModal 의 3단(영향→최종 확인→결과) 그대로.
- `TodoQueue` — `kind`('todo_rfq'|'todo_po'), `from`(PcbAdminSection), `actionLabel`(화살표 아이콘 자동 — 문구에 → 넣지 말 것), `emptyText`. 발주 화면 첫 탭도 이것.

**표 작성 요령(린트가 잡는 것)**
- `TableCell`·`TableHead` 에는 배치 클래스(`text-right`·`w-10`·`max-w-*` 등)만 — 글자 모양·색(`font-mono`·`text-muted-foreground`·`truncate`·`tabular-nums`)은 안쪽 `<span>` 에 준다.
- 말줄임은 `<span class="block max-w-xs truncate" :title="…">`.
- 행 선택 강조는 `TableRow` 에 `:data-state="selected ? 'selected' : undefined"`(클래스 아님), 행 클릭은 `class="cursor-pointer"` + `@click`.
- 툴팁을 쓰는 표는 `TooltipProvider` 로 한 번 감싼다. shadcn 컴포넌트의 간격(`gap-*`) 같은 모양은 바꿀 수 없으니 안쪽 span 으로 감싼다(예: `DialogTitle` 안 아이콘+글자).
