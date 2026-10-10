# 관리자 리뉴얼(shadcn-vue) — `src/next`

sp-vue 관리자 화면을 shadcn-vue로 다시 짓는 작업의 정본 문서. PCB 모듈부터 시작했고(2026-10-06), SmartBOM 모듈(§10)과 통합 모듈(§11, 견적관리 제외)까지 지었다. 개발 모듈 포함 **2026-10-10 컷오버 완료** — 아래 §0.

## 0. 컷오버(2026-10-10) — 지금의 경로·이름

- **리뉴얼 화면이 정식**: `/app/admin/*`, 이름 `admin`·`admin-*`(통합·PCB·SmartBOM·BOM·개발). `NEXT_*_ROUTES` 값과 `NEXT_*_BASE_PATH` 가 옛 값을 이어받았다. 메일 딥링크·QR·바깥 링크는 고치지 않고 새 화면으로 열린다.
- **옛 화면은 지우지 않고 물러났다**: `/app/admin/legacy/*`, 이름 `admin-legacy`·`admin-legacy-*`(옛 셸 `AdminLayout`). 새 화면의 '이전 화면' 버튼(`legacyNextRoute`)이 열고, 옛 셸 헤더의 '새 화면' 버튼이 같은 화면의 리뉴얼판으로 돌아간다. 옛 화면 코드 안의 라우트 이름도 `admin-legacy-*` 로 바꿔 옛 화면끼리 잇는다.
- **리뉴얼하지 않은 화면은 그대로**: 견적관리(`/admin/quotes`, `admin-quotes`)·재능마켓(`/admin/market/*`, `admin-market-*`)은 정식 경로·이름 그대로 옛 셸에 남는다. 옛 셸은 이 화면들에서 메뉴·스위처를 정식(리뉴얼) 화면으로, 옛 화면 안에서는 옛 화면으로 건다(`admin/menu.ts` 의 `legacyAdminTo`·`canonicalAdminRouteName`).
- 컷오버 전 경로 `/app/admin/next/*` 는 접두만 걷어 정식 경로로 리다이렉트한다(북마크).
- **e2e 남은 일**: `/app/admin/{pcb,smartbom,bom,develop,…}` 를 옛 화면 선택자로 보던 스펙은 이제 새 화면을 연다 — 선택자를 새 화면에 맞추거나(정석) 옛 화면 대조가 목적이면 `/app/admin/legacy/…` 로 옮긴다. `e2e/helpers/develop-admin.ts` 의 `DEVELOP_ADMIN_UI=old` 는 legacy 경로를 본다.

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
| 밀도 | 기본 컨트롤 높이 32px(Button/Input/Select `h-8`), Button `sm` 28px. **셸 헤더만 한 단 크게**(2026-10-07 사용자 결정 — 옛 헤더 체감): 홈·테마 `icon-md` 36px·아이콘 20px(선 1.75), 프로필 `md` 36px·아바타 32px, 모듈 전환 36px·활성 글자 주 색, 사이드바 열기 32px·아이콘 18px. **사이드바 메뉴**도 레거시 간격(2026-10-07 사용자 결정): 한 줄 36px(`h-9 px-3`, 줄 간격 40px), 접힌 아이콘 모드는 32px 유지(접힌 폭 48px) |
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
- `QueueTabs` — `v-model`(탭 key), `tabs: QueueTab<T>[]`(`key`·`label`·`count?`(null=모름)·`attention?`(건수를 경고 배지로)) · 슬롯 `#end`(검색 등 — 탭과 같은 줄 오른쪽). 타입은 `common/queue-tabs.ts`. 모양은 밑줄 탭(아래 '탭 모양').
- **탭 모양**(2026-10-06 사용자 결정 — 옛 관리자 화면의 밑줄 탭으로): `ui/tabs` 의 `TabsList` `variant` — `line`(기본: 활성 = 주 색 글자+2px 밑줄, 건수는 알약, 넘치면 다음 줄로)·`segment`(shadcn 기본 회색 알약 — 좁은 칸 안의 보기 전환만, 예: 부품 확인 작성/고객 미리보기). 줄 전체의 밑줄은 **감싸는 쪽이 `border-b`** 로 그린다(QueueTabs·설정 화면·후보 서랍 nav). 모양은 `TabsList` 가 provide 하고 `TabsTrigger` 가 따른다(`ui/tabs/context.ts`).
- `SearchInput` — `v-model`(입력 중 글자), `placeholder` · `@search`(Enter 확정). 키 입력마다 조회하지 않는다.
- `TableCard` — 표를 담는 테두리 상자(shadcn Card 대신 — Card 의 py-6 여백 없음, 첫·끝 열 안쪽 여백). `bare` 면 테두리 없이 여백만(이미 카드 안인 표).
- `TableEmptyRow` — `colspan`, `text`, `loading?`(스피너+'불러오는 중…'). `TableBody` 안 마지막 줄.
- `RowCheckbox` — `checked: boolean | 'indeterminate'`, `label`(aria), `disabled?` · `@change(boolean)`. 클릭이 행 클릭으로 번지지 않는다. 머리 칸은 `allSelected ? true : someSelected ? 'indeterminate' : false`.
- `ListPagination` — `page`, `pageSize`, `total` · `@update:page`. 왼쪽 '총 N건'(`#summary` 로 교체), 한 쪽이면 번호 숨김.
- `SectionCard` — 화면 안 섹션. `title`, `collapsible`(+`v-model:open`), `closable`(false=펼치기 전용), `flush`(표를 담을 때 본문 여백 없이 양끝만) · 슬롯 `#title`·`#meta`·`#actions`·`#collapsed`·`#notice`(머리 아래 안내 띠)·기본(본문 — 없으면 머리만). 제목은 h2 text-sm. 접힌 모양은 점선 한 줄.
- `NoticeBand` — 섹션 안 전폭 안내 띠(`#notice` 에). `tone` muted|info|warning|success|destructive.
- `Panel` — 섹션·대화상자 안의 작은 테두리 상자. `size`('xs'=표 칸 안·'sm'=p-3·'md'=p-4), `tone`(default|card|muted|info|warning|success|destructive — 값에 따라 색이 바뀌는 결론 칸·칸 안 메모, `card` 는 회색 바탕 위에 띄우는 카드 바탕 상자. `class="bg-card"` 로 손칠하지 않는다). 문장으로 상태를 알리면 Panel 이 아니라 Alert.
- `DialogScrollBody` — 대화상자 본문 스크롤(높이 65vh 한 값).
- (ui) `Alert` — 상태 알림 상자. `variant` default|muted|info|warning|success|destructive, `size` default|sm, `AlertTitle`·`AlertDescription`. `RadioGroup`·`RadioGroupItem` — 라디오.

**pcb**
- `pcb-badges.ts` — `pcbCategoryBadge`·`pcbQuoteBadge`·`pcbRfqReplyBadge`·`pcbStepBadge`·`pcbAsRoundBadge`·`pcbOrderStatusBadge` → `{ label, variant }`. `<Badge :variant="b.variant">{{ b.label }}</Badge>`. 뜻별 variant: warning=기다림·주의, info=진행, success=끝남, danger=문제, secondary=중립·이력, outline=부가 표지. 새 사전도 여기에 더한다.
- `CustomerCell` — `name`, `mbId`(이름 앞세우고 아이디 병기, 빈 이름='이름 없음', 비회원).
- `SelectionBar` — `count` · `@delete`. 항상 보이고, 고른 게 있을 때만 버튼이 붉어진다.
- `DeleteQuoteDialog` — `ids` · `@close`·`@deleted`. `v-if` 로 띄운다(열린 채 마운트). 옛 DeleteQuoteModal 의 3단(영향→최종 확인→결과) 그대로.
- `TodoQueue` — `kind`('todo_rfq'|'todo_po'), `from`(PcbAdminSection), `actionLabel`(화살표 아이콘 자동 — 문구에 → 넣지 말 것), `emptyText`. 발주 화면 첫 탭도 이것.

**표 작성 요령(린트가 잡는 것)**
- `TableCell`·`TableHead` 에는 배치·글자 모양·색까지 준다(lint 계약, §8). 여백(`px-*`)은 막힌다 — 표 밀도는 한 값.
- 말줄임은 `<span class="block max-w-xs truncate" :title="…">`.
- 행 선택 강조는 `TableRow` 에 `:data-state="selected ? 'selected' : undefined"`(클래스 아님), 행 클릭은 `class="cursor-pointer"` + `@click`.
- 툴팁을 쓰는 표는 `TooltipProvider` 로 한 번 감싼다. shadcn 컴포넌트의 간격(`gap-*`) 같은 모양은 바꿀 수 없으니 안쪽 span 으로 감싼다(예: `DialogTitle` 안 아이콘+글자).

## 8. 통합 때 정한 것 (2026-10-06)

- **lint 계약**: `TableCell`·`TableHead` 는 글자 모양·색 허용(여백은 막음 — 표 밀도), `Card`·`Card(Header|Content|Footer)` 는 여백 허용. `TableRow` 색·`Button`/`Input` 모양 덮어쓰기는 계속 막는다 — 옛 화면의 행 바탕 강조(내 차례 노랑·미입금 노랑)는 **배지로 옮겼다**.
- **인쇄·PDF 문서는 `print/` 폴더에** 둔다(라벨·인보이스 미리보기). 그 폴더만 `no-arbitrary-values`·`no-inline-styles`·`no-raw-colors` 를 끈다. 파일 안 `eslint-disable` 로 풀지 않는다. 옛 인쇄 문서(`EstimateSheet`·`usePrintIsolation`)는 그대로 import 해도 되는 유일한 예외.
- **라벨 QR 주소는 옛 경로(`/app/admin/pcb/packages/…`)를 찍는다** — 종이에 남는 주소라 리뉴얼 경로를 찍으면 컷오버 뒤 죽은 링크가 된다.
- **입력 대화상자에 저장이 따르면 `promptDialog({ …, submit, errorFallback })`** — 연 채로 저장하고 실패하면 입력을 둔 채 오류를 보인다. 닫은 뒤 저장하면 실패 시 입력이 사라진다.
- **상태 배지 색은 모듈마다 한 곳** — PCB 는 `components/pcb/pcb-badges.ts`(주문·발주·선적: `pcbOrderStatusBadge`·`pcbPoStatusVariant`·`pcbShipmentStatusVariant`), SmartBOM 은 `components/smartbom/smartbom-badges.ts`(견적·주문·발주·부품 확인·RFQ·클레임·선적·Case 상세 사전 전부, 작업대 `bom/workbench/workbench-badges.ts` 도 견적 색은 여기서), 공용은 `components/common/badge-types.ts`(`BadgeVariant`·`StatusBadge`)·`common/order-status.ts`(영카트 od 상태 색 — 두 모듈 공용). 화면 전용 사전(PCB `pos/`·`remittance/`·`claims/`·`case/case-badges.ts`)은 그 화면에만 있는 상태만 두고, 도메인 판정·글자색 헬퍼(`smartbom/po/mouser-cart.ts`·`smartbom/confirm/confirm-tones.ts`)는 각 폴더에 둔다.
- 확인 대화상자: `tone: 'danger'` 는 첫 포커스가 취소 버튼, 배경 클릭으로 닫히지 않는다(AlertDialog).
- 표 본문 글자는 14px(shadcn 기본) — 옛 PCB 화면의 `pcb-readable`(15px 확대)은 옮기지 않았다.

## 9. 일관성 점검 — `pnpm lint:next`

`@shadcn/lint` 는 토큰 사용과 shadcn 컴포넌트 restyle 만 본다. 일반 div 에 토큰 색을 칠해 알림 상자·섹션 상자·접힘 토글을 화면마다 새로 지어도 통과한다(2026-10-06 실측 123건). 그래서 `scripts/next-ui-audit.mjs` 를 붙였다.

```bash
cd samplepcb-web-mono-app/apps/web
pnpm lint:next                     # eslint src/next(수 분) → next-ui-audit
node scripts/next-ui-audit.mjs     # 점검만(1초)
```

| 규칙 | 잡는 것 | 대신 쓸 것 |
|---|---|---|
| alert | `bg-*-soft` + 테두리 | `<Alert variant size="sm">` |
| tint | `bg-*-soft`(테두리 없음) | `NoticeBand`·`Badge`·`Panel tone` |
| box | `rounded-* border p-*` | `Panel`·`SectionCard`·`TableCard` |
| max-h | 대화상자 높이 임의값 | `DialogScrollBody` |
| raw-control | `<button>`·`<input type=radio|checkbox>` | `Button`·`RadioGroup`·`Checkbox` |
| heading | h2 에 text-base 이상 | `SectionCard` 제목·`PageHeader` |

정적 `class` 와 동적 `:class`(삼항·배열 안의 문자열 조각까지) 모두 본다. 불가피한 곳은 윗줄에 `<!-- ui-audit-allow: 사유 -->`(현재 3곳 — 사양 수정 대화상자의 2단 스크롤 2곳, 콤보 입력 목록 팝업 1곳). 키트 파일(스크립트의 `KIT_FILES`)·`components/ui`·`print/` 는 검사하지 않는다. 새 키트 컴포넌트를 만들면 `KIT_FILES` 에 더한다.

## 10. SmartBOM 모듈 (2026-10-06)

- **범위**: 관리자 SmartBOM 목록 8화면(진행현황·견적관리·주문·결제·발주·부품 확인·선적·배송·완료·클레임·패키지 QR) + Case 상세 + 관리자 BOM 업로드·작업대. 고객 BOM(`/app/bom`, 피그마 시안)은 대상이 아니다.
- **경로·이름**: `/app/admin/next/smartbom/*`·`/app/admin/next/bom/*`, 이름은 옛 이름의 `admin-` → `admin-next-`(`next/smartbom-navigation.ts` 의 `NEXT_SMARTBOM_ROUTES`). 컷오버는 PCB 와 같다 — 값만 옛 이름으로.
- **셸**: `next/admin-menu.ts` 의 `nextModules` 에 모듈을 더하면 사이드바·모듈 스위처·'이전 화면'이 따라온다. 배지는 `components/app/useNextMenuBadges.ts`(옛 셸과 같은 훅·합산식). 작업대처럼 본문을 꽉 채우는 화면은 라우트 `meta.adminContentFlush`.
- **공용으로 올린 것**: 목록 주소 상태 `next/lib/list-query.ts`, 고객 칸·선택 삭제 바(`common/`), 배지 타입 `common/badge-types.ts`, 주문(od) 상태 색 `common/order-status.ts`(PCB·SmartBOM 공용). SmartBOM 배지 사전은 `components/smartbom/smartbom-badges.ts` 한 곳.
- **부품 위치**: SmartBOM 업무 부품 `components/smartbom/`, BOM 부품·검색·후보 서랍·작업대 행 `components/bom/`. 옛 컴포넌트와 같은 props·emits.
- **작업대 성능**: 표 행(`bom/QuoteRow.vue`)은 키트 컴포넌트 대신 `buttonVariants()`·`badgeVariants()` 클래스를 준 네이티브 원소다 — 행마다 컴포넌트 인스턴스가 붙으면 스크롤 마운트 비용이 3배가 된다(실측 근거 `bom/workbench/row-classes.ts`). 이 8곳은 `ui-audit-allow` 사유를 달았다. 옛 화면 대비 스크롤 +7%, 다시 열기 +12ms. 후보 서랍은 열기 첫 페인트 10.0ms(옛 11.1ms), 스크롤 최악 프레임 7.3ms(옛 44ms).
- **확정가**: Case 상세 검토 패널의 확정가는 체크박스 없이 바로 입력(옛 화면에도 같은 날 반영 — `docs/SMARTBOM_PARTNER_RFQ.md` §6).
- **키트 보강**(이 모듈 하며): `Alert`·`NoticeBand`·`Panel tone/xs`·`SectionCard #notice·closable`, Button `warning`·`success` 변형, Badge 는 `as`·`asChild` 가 없으면 `span` 하나(배지가 많은 화면의 열기 비용), Sheet 열림 250ms·닫힘 200ms, 오버레이 `black/50`, `Item` 버튼 hover, lint 계약 `Badge`(tabular-nums)·`Input`(text-right·tabular-nums·font-mono).

### 컷오버 때 e2e 에서 고칠 것 (SmartBOM)

- 탭이 `role=tab`(QueueTabs) — `getByRole('button', { name: /배송 처리 대기/ })` 같은 탭 찾기는 `getByRole('tab', …)` 로.
- 체크박스가 shadcn Checkbox(`button role=checkbox`) — `locator('input[type=checkbox]').check()` 는 `getByRole('checkbox', …).click()` 로(부품 확인 작성 패널 등).
- Case 삭제가 머리로 옮겨졌다(PCB 와 같은 자리·모양, 2026-10-06 사용자 결정) — 버튼 이름 'Case 강제 영구 삭제' → 'Case 삭제'(journey-bom-case-deletion·demo-bom-confirm-keep·demo-bom-confirm-types-keep).
- 대화상자가 body 포털(reka) — 특정 섹션 안에서 대화상자를 찾던 선택자는 `getByRole('dialog')` 로.
- 유지한 것: `data-testid`(mouser-cart-*·digikey-list-* 등), 버튼 이름(입고 패널·배송 처리·미매칭으로 기록 등), `#bomc-*` 앵커, 상태 문구('✓ 일치' 등).

## 11. 통합 모듈 (2026-10-06)

- **범위**: 통합 메뉴 12개 중 **견적관리를 뺀 11화면** — 대시보드·주문관리·회원관리·협력사·협력사 보유 부품·부품 카탈로그·메인 슬라이드·SEO·발송 이력·삭제 기록·설정(탭 4개). 개발·마켓 모듈은 대상이 아니다(모듈 스위처가 옛 화면 홈으로 보낸다).
- **경로·이름**: `/app/admin/next`(대시보드)·`/app/admin/next/{orders,members,partners,partner-parts,parts,slides,seo,mail-logs,delete-audits,settings}`, 이름은 옛 이름의 `admin` → `admin-next`(`next/core-navigation.ts` 의 `NEXT_CORE_ROUTES`). `/app/admin/next` 는 원래 PCB 진행현황으로 보내던 자리였는데 통합 대시보드가 됐다. 컷오버는 PCB·SmartBOM 과 같다 — 값만 옛 이름으로.
- **견적관리**: 리뉴얼하지 않는다. 통합 메뉴의 자리·대기 배지(`rfqCount`)는 그대로 두고 옛 화면(`/app/admin/quotes`)으로 보낸다. 메뉴 항목의 `legacy: true` 가 이름 뒤에 '이전 화면'(History) 아이콘을 붙인다 — 누르면 옛 셸로 바뀌는 것을 미리 알린다.
- **부품 위치**: `next/components/core/{orders,members,partners,parts,settings,audit}/`. 주문 결과 패널(`core/orders/OrderActionResult.vue`)은 목록 액션바·삭제·엑셀·상세 서랍이 함께 쓴다. 주문 상태 배지 색은 `core/orders/order-badges.ts` 한 곳. 협력사 보유 부품 편집 창은 파트너 포털도 옛 것을 쓰므로 새 화면용을 따로 뒀다. 부품 사진은 `bom/PartImage.vue` 재사용.
- **주문 상세 서랍**: 쓰기 동작 9가지(주문자·받는분·메모·입금 조정·환불 기록·다음 단계·상태 직접 변경·행 취소/반품/품절·인쇄)를 옛 서랍과 같은 훅·같은 본문으로 옮겼다(코드 대조). 서랍 위에 확인 창이 떠 있으면 Esc·바깥 클릭이 서랍을 닫지 않는다. 인쇄 문서는 `core/orders/print/`.
- **주문 상태 탭**: 16칸도 QueueTabs 하나(밑줄 탭이 넘치면 줄바꿈 — 1440px 에서 2줄). 탭·쪽은 주소에 싣는다(`?tab=`, 옛 화면은 주소 상태 없음). 필터는 화면 안에만.
- **옛 화면과 달라진 동작**: 회원 차단/해제 확인이 인라인 2단계 → `confirmDialog`(문구·버튼 이름 같음). 협력사 검색·부품 행 검색은 `SearchInput`(Enter 확정 — 협력사 '검색' 버튼 없음). 설정의 사용 여부 체크박스 → `Switch`. BOM 견적 설정의 담당자 칸을 비용 `<form>` 밖으로 빼서, 담당자 칸 Enter 가 비용 설정을 저장하던 숨은 동작이 없어졌다.
- **옛 화면 결함(발견만, 옛 화면 미수정)**: `AdminPartnerParts.vue` 의 대행 업로드 협력사 목록이 `pageSize=200` 으로 요청해 서버 상한(100)에 400 으로 거절된다 → 목록이 늘 비어 있다. 새 화면은 100.
- **키트 보강**: `ui/switch`(켜기/끄기), `SearchInput` 에 `class`(폭 — `cn` 병합), `ui/native-select` emits 를 이름 붙은 튜플로(업스트림 선언은 핸들러 타입이 `() => any` 라 `@update:model-value` 가 타입 오류).

### 컷오버 때 e2e 에서 고칠 것 (통합)

- 설정 탭이 `role=tab`(shadcn Tabs). 메인 슬라이드 순서 버튼은 '↑'·'↓' 글자 → 아이콘 + 이름 '위로'·'아래로'.
- 회원 차단/해제 확인이 대화상자(`getByRole('alertdialog')`/`dialog`) — 인라인 확인 버튼을 찾던 선택자.
- 협력사 목록 검색은 버튼 대신 Enter. 체크박스는 shadcn Checkbox(`role=checkbox`).
- 유지한 것: 삭제 기록의 `data-testid`(retention-*·audit-*·dashboard-retention), 버튼 이름 전부.

## 12. 개발 모듈 (2026-10-07)

- **범위**: 개발 메뉴 8개(진행현황·접수·검토·견적·계약·진행 프로젝트·납품·검수·문의·A/S·전체 의뢰·설정) + 의뢰 전면 상세(탭 6개: 의뢰 내용·AI 검토서·구성도·견적서·타임라인·프로젝트 문서). 마켓 모듈은 대상이 아니다.
- **경로·이름**: `/app/admin/next/develop/*`, 이름은 옛 이름의 `admin-` → `admin-next-`(`next/develop-navigation.ts` 의 `NEXT_DEVELOP_ROUTES`). 큐 ↔ 상세 왕복 규약(큐 상태를 URL 에, 상세 `?from=`+`lt/ls/lq/lp`, 「← 목록으로」)은 옛 `admin/develop-navigation.ts` 와 같고, 쿼리 해석 순수 함수는 그대로 다시 내보낸다. 상세는 떠나온 큐 메뉴를 켠다(옛 셸은 늘 '전체 의뢰'). '이전 화면'은 `from` 도 옛 큐 이름으로 바꿔 옛 화면의 복귀가 산다.
- **배지**: 옛 셸과 같은 매핑 6종(`useDevelopModuleSignals` 한 번, 60초). 배지 색 사전은 `components/develop/develop-badges.ts` 한 곳(남색 'AI 실행 중'은 진행색 info 로 합침).
- **고치지 않고 쓰는 것**: `@sp/ui` 의 고객 공용 문서 뷰(`DevReviewView`·`DevDiagramSection`·`FilePreviewModal`) — 관리자 미리보기가 고객이 받는 문서와 같아야 한다(견적서 인쇄 문서와 같은 예외). 옛 순수 로직 모듈(`components/admin/develop/{develop-queue,develop-quote-edit,develop-review-edit,develop-doc-edit,develop-files}.ts`)은 import 해서 재사용 — 컷오버 때 옛 폴더를 지우기 전에 `next/` 쪽으로 옮긴다.
- **e2e**: 화면 e2e 가 없던 모듈이라 같은 시나리오를 옛 화면·새 화면 양쪽에서 돌리는 `e2e/specs/admin-develop-journey.e2e.test.ts`(env `DEVELOP_ADMIN_UI=old|next`, 차이 어댑터 `e2e/helpers/develop-admin.ts`)를 같이 만들었다 — 옛 화면 green = 시나리오가 맞음, 새 화면 green = 동작이 같음. 2026-10-07 둘 다 9/9(접수→검토 시작→견적 붙여넣기·발송→고객 수락→수동 입금→업무표·착수 문서 발송→고객 결정→문의·답변→납품→검수 확정→큐 왕복). 고객 행동은 API, 의뢰는 e2e 계정이 만들고 지운다(발송 원장·Mailpit 수신분까지). 실행: e2e 폴더에서 `[DEVELOP_ADMIN_UI=next] PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca ./node_modules/.bin/vitest run admin-develop-journey`.
- **어댑터에 모은 옛/새 차이**(컷오버 때 옛 쪽 분기를 지운다): 큐 탭(옛 버튼 → `role=tab`), 사이드바(`aside` → `[data-sidebar=sidebar]`), 확인 단계(옛 인라인 패널 → 포털 대화상자 — 둘 다 "문구와 확인 버튼을 함께 품은 가장 안쪽 상자"로 찾는다), 선택 상자(네이티브 select·reka combobox), 설정 켜기/끄기(checkbox → `role=switch`).
- **공통화(합칠 때 리더가 한 것)**: 견적·결제 조건·문서·간트·의뢰 방식 색을 `develop-badges.ts` 한 곳으로, 첨부 한 줄 `components/develop/DevelopFileRow.vue`(의뢰·타임라인·문서 첨부 공용), 달성도 막대 `components/develop/DevelopProgressBar.vue`(큐·홈 카드·현황 띠). 키트 `Panel` 에 `tone="card"`(모듈 4개 22곳의 `class="bg-card"` 를 바꿈).
- **키트 후보(보류)**: 인라인 성공/실패 한 줄(`detail/ActionNotice.vue`), 인쇄 호스트(Teleport+`usePrintIsolation`+`print/` 문서), 행을 가로지르는 단일 선택 토글(`role=radio` 버튼), 목록 머리(제목·n/상한·추가), Label 작은 크기 변형.
- **신호 탭**(2026-10-07 사용자 결정): 상태가 하나뿐인 진행 프로젝트 큐는 상태 탭 줄 대신 신호(전체·고객 회신 대기·회신 기한 초과)가 밑줄 탭 줄이 된다 — 처음엔 버튼 묶음(ButtonGroup)이었는데 실행 버튼처럼 보이고 '전체'가 가장 눈에 띄어 바꿨다. 신호 건수는 서버가 활성 의뢰 전체로 세어 목록 수와 어긋나 붙이지 않는다(DEVELOP_FLOW §15 C-13 을 고칠 때 붙인다). 큐 검색 짝은 `queue/DevelopQueueSearch.vue`.
- **프로세스 검토 결과**는 도메인 정본 `docs/DEVELOP_FLOW.md` §15(미결).
