# 지시서 — 개발의뢰(sp-develop) P2 관리자: 견적서 작성·발송·마일스톤 (worker B3)

리포 `D:\work\workspace_other\samplepcb-web-platform`. 브랜치 `feat/develop-mvp`(체크아웃됨 — 브랜치 변경·커밋 금지).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · 정본 `docs/DEVELOP_FLOW.md`(§4.2·§5·§8) · P1 지시서 `docs/prompts/develop-phase1b-admin.md`(규칙 동일).

## 0. 한 줄 요약
P1 관리자 화면(`apps/web` `/app/admin/develop/*`, typecheck/lint 0)에 **견적서 작성·발송·철회·마일스톤 수동 입금 확인**을 붙인다. 서버 라우트는 전부 있고 API 하네스 110/0 으로 검증됐다.

## 1. 불변식
P1 관리자 지시서 §1 과 같다. 파일 스코프: 신규 `apps/web/src/components/admin/develop/DevelopQuote*.vue`(+ 필요한 `develop-quote-edit.ts`), 수정은 `admin/useAdminDevelop.ts`·`components/admin/develop/DevelopSideCards.vue`·`pages/admin/AdminDevelopRequestDetail.vue`·i18n `ko.ts`/`en.ts`(`admin.develop.quote.*` 키 추가). 다른 워커가 `apps/develop`(고객 앱)에서 병렬 작업 중 — 손대지 말 것.

## 2. 서버 라우트(prefix `/api/admin`, requireAdmin) — `apps/api/src/routes/admin-develop-quotes.ts` 가 실체
| 행동 | 라우트 | body | 응답 |
|---|---|---|---|
| 초안 생성 | `POST /develop/requests/:id/quotes` | `AdminDevelopQuoteBody` | `AdminDevelopQuoteResponse`(견적 뷰 + internalNote). 409 `KIND_MISMATCH`(착수 전 change / 착수 뒤 initial·revision)·`INVALID_TRANSITION`(종결) |
| 초안 수정(전체 교체) | `PATCH /develop/quotes/:qid` | `AdminDevelopQuoteBody` | 409 `QUOTE_NOT_DRAFT` |
| 초안 삭제 | `DELETE /develop/quotes/:qid` | | `{result:true}` |
| 발송 | `POST /develop/quotes/:qid/send` | | 견적 뷰. 금액 확정·이전 sent superseded·의뢰 quoted·고객 메일 |
| 철회 | `POST /develop/quotes/:qid/withdraw` | | sent 만 |
| 마일스톤 수동 입금 확인 | `POST /develop/milestones/:mid/mark-paid` | `AdminDevelopMilestoneMarkPaidBody` `{note?}` | `{result:true}`. 409 `NOT_PAYABLE`·`ALREADY_PAID` |
견적 목록은 상세(`AdminDevelopRequestDetail.quotes` — draft 포함, `internalNote` 포함)에 있다. 설정 기본값은 `GET /develop/settings`(`AdminDevelopSettings`: defaultTerms·defaultExclusions·defaultWarrantyDays·defaultReviewDays·defaultValidDays·defaultVatMode·defaultMilestones).

## 3. 확정 설계
- **견적 섹션**(`DevelopQuoteSection.vue`, 상세 본문 타임라인 위 또는 사이드 카드 자리 — 본문 쪽 권장, 사이드는 요약 링크만): 견적 목록(v·종류·상태·합계·유효기간·발송/수락/거절 시각) + `새 견적서`(상태에 따라 kind 기본값: received/reviewing/quoted → `initial`(이미 sent/superseded 가 있으면 `revision`), accepted/in_progress/delivered → `change`).
- **견적 편집기**(`DevelopQuoteEditor.vue`, draft 전용 — sent 이후는 읽기 전용 표시): 
  - 헤더: 제목·종류(select)·VAT 표기(select)·유효기간(date, 기본 오늘+`defaultValidDays`)·예상 기간(일)·검수 기간(기본 설정값)·하자보수 일수.
  - **항목표**: 행 = 이름·금액(원, 천단위 입력 보조)·설명(선택)·기간(선택) + 행 추가/삭제/순서. **붙여넣기로 채우기**: textarea 에 `H/W 회로·PCB 설계 3,600,000원` 줄들을 붙이면 계약 `parseDevelopQuoteLines(text)` 로 행 생성(`rejected` 줄은 경고로 표시). 합계 줄 = `computeDevelopQuoteAmounts(items.map(i=>i.amount), vatMode)` 로 공급가·VAT·합계 실시간.
  - **결제 조건(마일스톤)**: 행 = 명칭·비율(%)·시점(`DEVELOP_MILESTONE_TRIGGER_LABELS`)·산출물 해제 체크(하나만). 기본은 설정 `defaultMilestones`. 비율 합 100% 검증(빨간 표시), 각 행 금액 미리보기 = `splitDevelopMilestoneAmounts(total, ratios)`.
  - 산출물 목록(줄 단위) · 별도 실비(textarea, 기본 설정값) · 표준 조건(textarea, 기본 설정값 — 건별 수정) · 고객 비고 · 내부 메모.
  - 버튼: `초안 저장`(생성/PATCH) · `발송`(저장 뒤 send — 인라인 확인: 합계·마일스톤 요약 보여주고 확정) · `초안 삭제`(인라인 확인) · sent 견적엔 `철회`(인라인 확인). 에러 코드 → 문구(`apiErrorMessage` 사전).
- **마일스톤**(견적 카드 안): 상태·금액·시점·`payment`(od 파생: 주문번호·od 상태·수납) 표시. `pending` 행에 `입금 확인(수동)` 버튼(인라인 메모) → `mark-paid`. 이미 paid 는 결제일·주체(lazy/admin).
- `useAdminDevelop.ts` 에 훅 추가: `useAdminDevelopQuoteCreate/Patch/Delete/Send/Withdraw`, `useAdminDevelopMilestoneMarkPaid`. 성공 시 `['admin','develop']` invalidate.
- `DevelopSideCards.vue` 의 "견적서 작성은 다음 단계" 문구 제거 → 견적 요약 + 본문 견적 섹션 앵커.
- 라벨은 i18n(`admin.develop.quote.*`), 도메인 라벨은 계약 사전(`DEVELOP_QUOTE_*_LABELS`·`DEVELOP_MILESTONE_*_LABELS`·`DEVELOP_VAT_MODE_LABELS`).

## 4. 검증
1. `pnpm --filter web typecheck && pnpm --filter web lint` → 0.
2. 브라우저(sp-vue 5173 또는 nginx `/app/admin/develop/requests`, e2e helpers 스텁 관리자 로그인): 상세 → 새 견적서 → 붙여넣기 4줄(사용자 예시: `H/W 회로·PCB 설계 3,600,000원` / `펌웨어·BLE 통신 3,200,000원` / `Android 앱 2,800,000원` / `시제품·통합 검증 2,100,000원`) → 합계 12,870,000원(VAT 별도) 확인 → 저장 → 발송 → 목록에 sent. 데이터가 없으면 API 하네스로 `[e2e]` 의뢰를 만들고(P1 지시서 §4 참고) 끝나면 cleanup. **AI 실행 버튼은 누르지 말 것.** 콘솔 오류 0, i18n 키 원문 노출 0.

## 5. 함정
- `AdminDevelopQuoteBody` 는 `items ≥1`·`milestones ≥1`·비율 합 10000·해제 마일스톤 ≤1 을 zod 가 검사한다 — 화면이 먼저 막아야 400 이 안 난다.
- 금액은 정수(원). 입력은 콤마 허용, 저장 전 숫자로.
- `validUntil` 은 `YYYY-MM-DD`(KST). `kstToday`(`@sp/utils`) 로 기본값.
- `.vue` 발 타입 ESLint 오탐 — 추론 타입 + `as const`.

## 6. 문서·보고
`docs/DEVELOP_FLOW.md` §7.3 단락에 견적 화면 한두 줄 보강. 최종 보고 = 변경 파일 / 이탈 / 계약·서버 요청 / 검증 결과 / 남긴 이슈.
