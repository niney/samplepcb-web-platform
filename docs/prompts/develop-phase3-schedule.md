# 지시서 — 개발의뢰(sp-develop) P3: AI 검토서 "개발 일정(예상)" 섹션 (worker C1)

리포 `D:\work\workspace_other\samplepcb-web-platform`. 브랜치 `feat/develop-mvp`(체크아웃됨 — 브랜치 변경·커밋 금지, 트리는 클린 상태에서 시작).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · 정본 `docs/DEVELOP_FLOW.md`(§6 AI·§7.3 관리자 상세·§11.1) · 이전 지시서 `docs/prompts/develop-phase2b-admin.md`(규칙 동일).

## 0. 한 줄 요약
AI 사전 검토서(`MarketDevReview`)에 **개발 일정(예상)** 섹션을 붙인다 — 개발의뢰(develop)에서만 LLM 이 만들고, 관리자가 편집하고, 고객 공개본에도 실리며, 견적 편집기가 "검토서 일정 가져오기"로 기간·마일스톤 초안을 끌어온다. **검토서의 일정은 예상, 견적서의 기간은 약속**(2026-09-05 사용자 결정) — 두 문서의 역할을 문구로 분명히 한다.

## 1. 불변식(어기면 되돌린다)
- 스키마는 **additive**: `MarketDevReview` 에 `schedule` 선택 필드 추가, `DEV_REVIEW_VERSION` 은 4 유지(옛 저장분·마켓 검토서가 그대로 파싱돼야 한다). 마켓 프롬프트·마켓 후처리 결과는 **바이트 단위 무변경**(마켓 e2e 148/0 회귀).
- 일정 수치는 **범위(최소~최대 주)** 만 받는다. 점 추정 필드 금지. 합계는 항상 단계에서 **재계산**(LLM 이 준 합계는 버린다).
- 고객 희망 완료 시점 대조("맞는지")는 **LLM 판단이 아니라 순수 함수**로 낸다(아래 §3.3).
- 공유 DB — `prisma migrate reset/dev` 금지. 이 작업엔 DB 변경이 없다(검토서는 JSON 컬럼).
- 커밋 금지. 워크트리에 남기고 보고.
- 파일 스코프: `packages/api-contract/src/schemas/market-dev-review.ts`(+ 필요시 `develop.ts`), `packages/utils/src/dev-review-view.ts`(필요시), `packages/ui/src/components/DevReviewView.vue`, `apps/api/src/lib/ai/{dev-review.ts,runner.ts,dev-review.test.ts}`, `apps/web/src/components/admin/develop/{DevelopReviewEditor.vue,develop-review-edit.ts,DevelopQuoteEditor.vue,DevelopQuoteSection.vue}`, i18n `ko.ts`/`en.ts`(`admin.develop.review.schedule.*`·`admin.develop.quote.fromSchedule*`), `ops/scripts/e2e-develop.mts`, `docs/DEVELOP_FLOW.md`. 그 밖은 손대지 말 것(특히 `apps/market`·`apps/develop` 화면은 공용 `DevReviewView` 로 자동 반영된다).

## 2. 현재 구조(읽고 시작)
- 계약 `market-dev-review.ts`: `MarketDevReview`(version 4, brief·summary·requirements·areas·openQuestions·checks(.catch([]))·meta·adminComment), `DevReviewLlmOutput`, `DEV_REVIEW_LLM_JSON_SCHEMA`, `DEV_REVIEW_DISCLAIMER`.
- 프롬프트·후처리 `apps/api/src/lib/ai/dev-review.ts`: `DEV_REVIEW_PROMPT_VERSION='dev-review.v5'`, `buildDevReviewPrompt(source, extraInstructions)`, `parseDevReviewLlmOutput(raw)`, `postProcessDevReview(output, source, meta)`(R1·R2·R8·R9 후처리, `checks` 를 만들어 붙인다). 공통 조건 질문은 `MARKET_COMMON_CONDITIONS`(market-areas.ts) — 완료 시점 코드 `timeline` 선택지 `within_1m|m2_3|m4_6|over_6m`, 답변 shape `MarketAnswer{code, choices[], note?}`.
- 러너 `runner.ts` `StartDevReviewJobOptions` 에 `target: {kind:'market',projectId} | {kind:'develop',requestId}` 가 있다(`develop-ai.ts` 가 develop 타깃으로 호출). 프롬프트/JSON 스키마/후처리는 아직 타깃을 모른다 → **여기서 갈라라**: `target.kind === 'develop'` 일 때만 일정 블록·스키마·후처리를 켠다.
- 관리자 편집기 `DevelopReviewEditor.vue`(`local = cloneDevelopReview(source)`, 섹션별 추가/삭제, `emit('update', review, dirty)`), 한도·검증 `develop-review-edit.ts`(`DEVELOP_REVIEW_LIMITS`, `cloneDevelopReview`, `developReviewIssues`).
- 공용 뷰 `packages/ui/src/components/DevReviewView.vue`(고객 앱·마켓·관리자 미리보기 공용; `buildDevReviewView(review)` 는 `@sp/utils`). 섹션 순서: 요약·확정 요구 → 상의 항목 → 기술개발 검토 결과 → 개발명세서 → 담당자 의견.
- 견적 편집기 `DevelopQuoteEditor.vue`: `form.durationDays`(일), `form.milestones[{title, percent, trigger, unlocksDeliverables}]`(`DEVELOP_QUOTE_LIMITS.milestones` 상한, 트리거 `on_accept|on_delivery|on_completion|manual`). 부모 `DevelopQuoteSection.vue` 가 `detail`(review.working/draft/publicReview 포함)을 가진다.
- API 하네스 `ops/scripts/e2e-develop.mts`(`run`→`cleanup`, develop.* 유스케이스를 꺼서 실 LLM 0; 관리자 `PUT /api/admin/develop/requests/:id/review` body `{review}` 와 `POST …/review/publish` 가 있다). 관리자 `ai/review` 는 force 라 **호출 금지**.

## 3. 확정 설계

### 3.1 계약(`market-dev-review.ts`)
```ts
export const DEV_REVIEW_SCHEDULE_MAX_PHASES = 8;
export const DEV_REVIEW_SCHEDULE_MAX_WEEKS = 104;
export const DevReviewSchedulePhase = z.object({
  name: z.string().trim().min(1).max(40),          // 단계명(예: 회로 설계·PCB 아트웍·시제품 제작·펌웨어 1차)
  minWeeks: z.number().int().min(1).max(104),
  maxWeeks: z.number().int().min(1).max(104),      // 후처리가 min ≤ max 보정
  output: z.string().trim().max(120).catch(''),    // 이 단계가 끝나면 나오는 것
  prerequisite: z.string().trim().max(120).catch(''), // 고객이 먼저 줘야 할 자료·결정(없으면 '')
  note: z.string().trim().max(120).catch(''),
});
export const DEV_REVIEW_TIMELINE_WISH_CODES = ['within_1m','m2_3','m4_6','over_6m'] as const; // market-areas 의 timeline 선택지와 같아야 한다 — 그쪽 상수를 재사용할 수 있으면 재사용
export const DevReviewSchedule = z.object({
  phases: z.array(DevReviewSchedulePhase).max(DEV_REVIEW_SCHEDULE_MAX_PHASES),
  wishCode: z.enum(DEV_REVIEW_TIMELINE_WISH_CODES).nullable(), // 고객이 고른 완료 시점(후처리가 source.answers 에서 채움)
  assumptions: z.string().trim().max(300).catch(''),           // 일정 전제(예: 고객 자료 회신 3일 이내·시제품 1회전)
});
// MarketDevReview 에 추가: schedule: DevReviewSchedule.nullable().optional().catch(null)
// DevReviewLlmOutput 에 추가: schedule: <LLM 출력용 느슨한 버전>.optional()  — 합계 필드는 받지 않는다
```
- `DEV_REVIEW_LLM_JSON_SCHEMA` 는 그대로 두고, **`DEV_REVIEW_LLM_JSON_SCHEMA_WITH_SCHEDULE`** 을 새로 export(`required` 에 `schedule` 포함 — 모델이 항상 내게).
- 순수 함수(계약, 화면·서버 공용):
  - `devReviewScheduleTotals(schedule) → { minWeeks, maxWeeks }`(단계 합).
  - `devReviewScheduleFit(schedule) → { status: 'ok'|'tight'|'over'|'unknown', wishLabel: string, text: string }` — §3.3 규칙. `wishCode===null` 이면 `unknown`.
  - `DEV_REVIEW_SCHEDULE_CAPTION = '이 일정은 자료만으로 낸 예상입니다. 확정 일정은 견적서의 기간을 따릅니다.'`

### 3.2 프롬프트·후처리(`dev-review.ts`·`runner.ts`)
- `buildDevReviewPrompt(source, extraInstructions, features = { schedule: false })`. `features.schedule` 이 참일 때만 `[개발 일정]` 블록을 규칙 뒤에 넣는다. 블록 요지: "단계 3~8개, 각 단계 최소·최대 주(정수), 산출물, 고객 선행 조건, 비고. 분야(회로/PCB/펌웨어/앱/서버)마다 통상 단계를 쓰되 **고객 자료에 없는 분야 단계는 만들지 말 것**. 시제품 제작·부품 수급처럼 외부 리드타임이 드는 단계는 비고에 그 이유. 합계는 쓰지 않는다(서버가 계산). 확정 어휘 금지 — 전부 예상." + `assumptions` 한 줄.
- `DEV_REVIEW_PROMPT_VERSION = 'dev-review.v6'` (09-05: develop 일정 블록 옵션). 마켓은 features 기본값이라 프롬프트 문자열이 v5 와 **완전히 같아야** 한다(테스트로 박제: 기존 프롬프트 스냅샷 테스트가 있으면 유지, 없으면 `features` 미지정 프롬프트에 `[개발 일정]` 이 없음을 단언).
- `parseDevReviewLlmOutput` 이 `schedule` 을 느슨하게 받는다(깨진 단계 원소만 버림, 숫자 문자열 → 정수).
- `postProcessDevReview(output, source, meta, features)`: features.schedule 참일 때 `normalizeDevReviewSchedule(raw, source)`:
  - 단계: 이름 빈 것 삭제, `minWeeks/maxWeeks` 를 1..104 로 클램프하고 `min>max` 면 교환, 최대 8개(초과는 뒤에서 자름), 텍스트는 기존 `cleanText`(품번·수치 스트립은 적용하지 **않는다** — 일정은 근거 인용 대상이 아니다).
  - `wishCode` 는 `source.answers` 중 `code==='timeline'` 의 첫 choice(코드가 4종 중 하나일 때만, 아니면 null).
  - 단계가 0개면 `schedule = null`.
  - 진단 `diag.schedulePhasesDropped` 추가.
  - features 거짓이면 `schedule` 을 넣지 않는다(마켓 결과 무변경).
- `runner.ts`: develop 타깃일 때 `features={schedule:true}` 와 `_WITH_SCHEDULE` JSON 스키마를 쓴다. 마켓은 기존 그대로.

### 3.3 희망 완료 시점 대조(순수 함수, 계약)
- 희망 상한(주): `within_1m`=4 · `m2_3`=13 · `m4_6`=26 · `over_6m`=null(상한 없음).
- 판정: 상한 없음 → `ok`("6개월 이상 여유"); `maxWeeks ≤ 상한` → `ok`; `minWeeks ≤ 상한 < maxWeeks` → `tight`; `minWeeks > 상한` → `over`.
- `text` 예: `희망 "2~3개월" ↔ 예상 10~14주 — 최대 기준으로 넘어갈 수 있습니다(단계 조정·병행 필요)`. 라벨은 `MARKET_COMMON_CONDITIONS` 의 timeline 선택지 라벨을 재사용.

### 3.4 공용 뷰(`DevReviewView.vue`)
- "기술개발 검토 결과" 섹션 **뒤, 개발명세서 앞**에 `<section v-if="schedule && schedule.phases.length>0">` "개발 일정(예상)": 표(단계·기간(주)·산출물·선행 조건·비고, 좁은 폰 폭에선 카드형으로 접힘 — 기존 명세 표의 반응형 관례를 따르라), 합계 줄 `예상 합계 n~m주`, 대조 줄(status 색: ok=emerald·tight=amber·over=red·unknown=회색 "희망 완료 시점 미응답"), 전제(assumptions) 한 줄, 캡션 `DEV_REVIEW_SCHEDULE_CAPTION`. 시맨틱 토큰만(brand-*/ink-*/paper/line/tx-*/text-body·label). 
- `schedule` 이 없거나 단계 0 → 섹션 자체 미표시(마켓·옛 저장분).

### 3.5 관리자 편집기(`DevelopReviewEditor.vue`·`develop-review-edit.ts`)
- 새 섹션 "개발 일정(예상)": 단계 행 = 단계명 · 최소 주 · 최대 주(number input) · 산출물 · 선행 조건 · 비고 · ↑↓ · 삭제; `단계 추가`(8개 상한); 합계·대조 줄을 실시간 표시(계약 함수). `assumptions` 한 줄 입력. 일정 통째 삭제 버튼("일정 없이 공개") → `schedule=null`. 일정이 null 인데 관리자가 추가하려면 `단계 추가` 가 빈 schedule 을 만든다(wishCode 는 `detail.answers` 의 timeline 에서 — 편집기 props 로 `wishCode` 를 받거나 부모가 채운다; 부모 `DevelopReviewPanel.vue` 수정이 필요하면 최소로).
- `DEVELOP_REVIEW_LIMITS` 에 phases·name·output·prerequisite·note·weeks 한도, `cloneDevelopReview` 가 schedule 을 깊은 복사, `developReviewIssues` 에 "단계명 비었음"·"최소가 최대보다 큼"·"주는 1~104" 추가(저장 차단 규칙은 기존과 같은 결).
- 입력칸 폰트는 이 화면 관례(본문보다 한 단계 작게: `text-sm`/`text-xs`).

### 3.6 견적 편집기(`DevelopQuoteEditor.vue`·`DevelopQuoteSection.vue`)
- 부모가 `schedule`(working ?? draft ?? publicReview 의 schedule, 없으면 null)을 prop 으로 준다.
- 편집기 기간 입력 옆 버튼 **`검토서 일정 가져오기`**(schedule 있을 때만): `durationDays = totals.maxWeeks * 7`(보수적 — 툴팁에 "최대 주 × 7일"). 이미 값이 있으면 인라인 확인(덮어쓰기) — 네이티브 confirm 금지.
- 마일스톤 영역에 **`단계로 마일스톤 초안 만들기`**: 기존 마일스톤을 통째 교체(인라인 확인). 규칙: 단계가 1개면 [수락 시 50% / 검수 확정 시 50%(산출물 해제)]; 2개 이상이면 첫 행 `on_accept`(제목 "착수금"), 마지막 행 `on_completion` + `unlocksDeliverables`(제목 "잔금"), 중간 단계는 `manual`(제목 = 단계명). 비율은 균등 분할 정수(나머지는 마지막 행에), 합 100. `DEVELOP_QUOTE_LIMITS.milestones` 초과분은 중간 단계를 앞에서부터 묶어 상한에 맞춘다.
- 가져오기 결과 아래 회색 안내: "검토서의 예상 일정입니다. 확정 기간은 여기서 정합니다."

### 3.7 하네스·문서
- `e2e-develop.mts`: 관리자 `PUT …/review` 에 schedule(2단계) 포함 → 상세 `review.working.schedule.phases.length===2` · `POST …/review/publish` → `review.publicReview.schedule` 존재 · 잘못된 주(0, 200)는 400. 기존 케이스 순서·정리 관례 유지.
- `docs/DEVELOP_FLOW.md` §6(AI) 에 "개발 일정(예상)" 소절 — 역할 분리(예상 vs 약속)·범위 수치·대조 규칙·견적 가져오기 규칙·마켓 무영향. §11.1 구현 상태 갱신.

## 4. 검증(전부 그린이어야 보고)
```
pnpm --filter @sp/api-contract typecheck && pnpm --filter @sp/utils typecheck && pnpm --filter @sp/ui typecheck
pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test   (기존 lint 오류 order-progress·bom-claims·pcb-claims 3건은 손대지 말고 그 외 0)
pnpm --filter web typecheck && pnpm --filter web lint
pnpm --filter market typecheck && pnpm --filter develop typecheck
cd apps/api && npx tsx --env-file=.env ../../../ops/scripts/e2e-develop.mts run   → cleanup   (API 3333 이 떠 있어야 한다 — 이미 떠 있으면 그대로 쓰고, 없으면 띄운 뒤 끝나면 내려라)
cd apps/api && npx tsx --env-file=.env ../../../ops/scripts/e2e-market.mts run → cleanup   (148/0 회귀)
```
- 단위: `dev-review.test.ts` 에 (a) features 미지정 프롬프트에 `[개발 일정]` 없음 (b) 후처리 정규화(빈 이름 삭제·클램프·min/max 교환·8개 절단·wishCode 추출·0개→null) (c) 마켓 features 로는 `schedule` 키가 결과에 없음. 계약 순수 함수(totals·fit 4분기)는 계약 테스트 자리가 없으면 `dev-review.test.ts` 에 함께.
- 실 LLM 초안은 돌리지 않는다(사용자 육안 몫). 대신 프롬프트 문자열 전체를 보고서에 붙여라.

## 5. 보고 형식
변경 파일 목록 · 결정한 것(설계에서 벗어난 점은 이유와 함께) · 검증 결과 원문 숫자(테스트 수·e2e PASS/FAIL) · 남은 것. 커밋하지 말 것.
