# 개발의뢰 위저드 v2 — 관리자(apps/web `/app/admin/develop`) 워커 브리프 (2026-09-08)

당신은 `samplepcb-web-mono-app/apps/web`(sp-vue, Vue3 + vue-i18n + Tailwind v4)의 **개발의뢰 관리자 화면만** 고치는 워커다.
계약·서버·DB·공용 패키지는 이미 끝났다(Fable 담당). 계약이나 서버에 빈틈이 보이면 고치지 말고 최종 보고에 "계약 갭"으로 적어라.

## 0. 무엇이 바뀌었나

개발의뢰 위저드가 v2(5스텝, 프로토타입 기준)가 됐다. 관리자 입장에서 달라진 것:

- 의뢰 방식 `requestMode`: `system`(시스템개발 — 분야는 6개 전부: circuit·pcb·firmware·**mech**·app·server) / `individual`(개별 견적 — pcb·mech·app·server 중 복수).
- 분야 레지스트리가 **개발의뢰 전용** `DEVELOP_REGISTRY`(`packages/api-contract/src/schemas/develop-areas.ts`)로 바뀌었다. 기구설계(mech)가 새로 생겼고,
  PCB·앱·서버의 질문이 프로토타입 문안(선택지+서술 혼합, `kind:'text'` 문항은 choices 빈 배열 + note)으로 바뀌었다. 시스템개발은 분야별 질문 대신
  `system.use`·`system.io`·`system.safety` 3문항(서술).
- 예산 사전 분리: `DEVELOP_BUDGET_RANGES/_LABELS`(`develop.ts`). `MARKET_BUDGET_RANGE_LABELS` 는 개발의뢰 화면에서 쓰면 안 된다(타입도 안 맞는다).
- 새 컬럼(상세·목록 응답에 포함): `currentStage`·`targetStage`(null 가능, 라벨 `DEVELOP_CURRENT_STAGE_LABELS`·`DEVELOP_TARGET_STAGE_LABELS`),
  `wishDate`·`wishNote`(`developWishLabel(date, note)`), `expertDelegate`(시스템개발 "전문가에게 맡김"), `production`(`DevelopProductionPlan | null`:
  prototype/prototypeQty/scopes/annualQty/priority/sourcing/delivery — 라벨 사전 `DEVELOP_PROTOTYPE_MODE_LABELS`·`DEVELOP_PRODUCTION_SCOPE_LABELS`·
  `DEVELOP_PRIORITY_LABELS`·`DEVELOP_SOURCING_MODE_LABELS`·`DEVELOP_DELIVERY_FORM_LABELS`, 요약 `developProductionSummary(plan)`).
  목록 행(`AdminDevelopRequestListItem`)에는 `requestMode` 가 추가됐다.

계약 함수(전부 `@sp/api-contract`): `developAreaBadge(codes)`(전 분야면 '시스템개발'), `developAreaLabel`, `developQuestionsFor(areas)`,
`developAnswerText(answer)`, `developToolRows(tools, areas)`, `developSlotLabel(area, slot)`, `isMarketAnswerUnknown`, `DEVELOP_REQUEST_MODE_LABELS`, `DEVELOP_REGISTRY`.
`@sp/ui` `DevReviewView` 에 `registry` prop 이 생겼다 — 개발의뢰 화면에서 쓰는 곳은 **전부** `:registry="DEVELOP_REGISTRY"` 를 넘겨라(안 넘기면 기구 분야가
"mech(종료)" 로 보이고 시스템 문항 라벨이 코드로 나온다). `AreaIcon` 은 mech 를 안다.

## 1. 파일별 할 일

- `pages/admin/AdminDevelopRequests.vue` — `marketAreaBadge` → `developAreaBadge`, `MARKET_BUDGET_RANGE_LABELS` → `DEVELOP_BUDGET_RANGE_LABELS`.
  제목 아래 줄에 의뢰 방식 칩(`DEVELOP_REQUEST_MODE_LABELS[r.requestMode]`, 시스템개발은 파란 배지·개별은 회색) + 분야 배지 + 예산.
- `pages/admin/AdminDevelopRequestDetail.vue` — 헤더 배지 `developAreaBadge` + 의뢰 방식 칩. `DevReviewView`/검토서 관련 컴포넌트에 registry 전달.
- `components/admin/develop/DevelopRequestContent.vue` — 
  - 상단 dl: 의뢰 방식 · 예산(`DEVELOP_BUDGET_RANGE_LABELS`) · 현재 단계 → 목표 단계 · 희망 완료 시기 · 비밀유지 · AI 동의 · 희망 툴(`developToolRows`).
  - 새 블록 "시제품·생산 계획": production 이 null 이면 "—"(v1 행), 있으면 요약 한 줄 + 우선순위/자재 조달/납품 형태 행. 시스템개발+expertDelegate 면
    "전문가 맡김(기술 사양 미입력)" 배지.
  - 답변 표: `developQuestionsFor(detail.serviceAreas)` 순서로, 값은 `developAnswerText`. text 문항은 서술이 그대로 값이다(줄바꿈 유지 `whitespace-pre-line`).
    사전에 없는 옛 코드(v1: `timeline`·`stage`…)는 지금처럼 코드 라벨로 뒤에 붙인다.
  - 첨부 슬롯 라벨 `developAreaLabel` · `developSlotLabel`.
- `components/admin/develop/DevelopReviewEditor.vue` — `marketAreaLabel` → `developAreaLabel`. 그 밖에 `DevelopReviewPanel.vue`·`DevelopReviewDiff.vue`·
  버전 탭 등에서 `DevReviewView` 를 그리는 자리 전부 `:registry="DEVELOP_REGISTRY"`. `grep -rn "DevReviewView\|marketArea\|MARKET_" src/components/admin/develop src/pages/admin/AdminDevelop*` 로 전수 확인.
- i18n: `src/i18n/locales/ko.ts`·`en.ts` 의 `admin.develop.content.*` 에 필요한 키를 더한다(의뢰 방식·현재/목표 단계·희망 완료 시기·시제품·생산 계획·
  우선순위·자재 조달·납품 형태·전문가 맡김·계획 없음). 도메인 라벨(사전 값)은 계약 상수를 그대로 쓰고 **키로 복제하지 않는다**(기존 관례).
  두 로케일의 키 집합이 같아야 한다 — 리포에 키 누락 검사 스크립트가 있으면(`ops/scripts` 또는 `apps/web/scripts` 에서 `i18n` 로 찾아라) 돌려라.
- 마켓 관리자 화면(`AdminMarket*`)은 건드리지 않는다.

## 2. 규율

- 네이티브 `confirm/alert/prompt` 금지. 라벨은 계약 상수. Tailwind 클래스는 이 앱의 관례(gray-*·blue-* 유틸리티) 그대로.
- 계약·서버·`packages/*` 는 건드리지 않는다. 파일은 CRLF.
- 검증(전부 0): `pnpm --filter web typecheck` · `pnpm --filter web lint`. (빌드는 무겁다 — 요청 시만.)
- 커밋하지 않는다. 브라우저 검증은 Fable 이 한다.

## 3. 최종 보고

바꾼 파일 · 검증 결과 · 계약 갭 · 판단이 필요했던 지점 3개 이내.
