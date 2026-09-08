# 개발의뢰 위저드 v2 — 고객 앱(apps/develop) 워커 브리프 (2026-09-08)

당신은 `samplepcb-web-mono-app/apps/develop`(Vue3 + Vite + Tailwind v4, 포트 5177, base `/develop/`)의 화면을 고치는 워커다.
계약·서버·DB·공용 패키지는 **이미 끝났다**(Fable 담당). 당신은 **고객 앱 화면만** 바꾼다. 계약이나 서버에 빈틈이 보이면
고치지 말고 최종 보고에 "계약 갭"으로 적어라.

## 0. 배경 — 무엇이 바뀌었나

프로토타입(ChatGPT toolgate `samplepcb-development-request`)을 기준으로 개발의뢰 위저드를 **3스텝 → 5스텝**으로 재편했다.
정본 문서는 `docs/DEVELOP_FLOW.md` §7.2(브리프 작성 시점엔 아직 v1 서술 — 이 브리프가 우선). 사용자 결정 4건:

1. 개별 메뉴에서 **회로·펌웨어를 뺀다**. 개별 견적은 PCB설계·기구설계·앱개발·서버개발 4개만 복수 선택. 회로·펌웨어는
   「시스템개발」 안에서만 다룬다.
2. 스텝은 **5개**: ① 개발 메뉴 ② 의뢰 내용 ③ 세부 질문 ④ 제작 계획 ⑤ 검토·접수(연락처 + 요약 + 동의).
3. 분야별 질문은 **선택지 + 서술 혼합**(레지스트리가 정한다 — 화면은 `QuestionField` 하나로 그린다. `kind:'text'` 문항은
   `QuestionField` 가 textarea 로 알아서 그린다).
4. 예산 사전은 마켓과 **분리**(`DEVELOP_BUDGET_RANGES`, 1천만 미만 ~ 1억 이상 + 견적 후 결정).

## 1. 계약(이미 구현됨) — 여기서만 라벨·코드를 가져온다

`packages/api-contract/src/schemas/`:

- `develop-areas.ts` — 개발의뢰 전용 분야 레지스트리 `DEVELOP_REGISTRY`(6분야: circuit·pcb·firmware·mech·app·server).
  - `DEVELOP_INDIVIDUAL_AREAS`(개별 메뉴 카드 4개, 순서 = 화면 순서: pcb·mech·app·server, 각 `label`·`hint`·`tools`·`attachmentSlots`·`questions`)
  - `DEVELOP_INDIVIDUAL_AREA_CODES`, `DEVELOP_SYSTEM_MENU = { label:'시스템개발', hint, tag }`, `DEVELOP_INDIVIDUAL_TAG = '전문 질문 제공'`
  - `DEVELOP_SYSTEM_QUESTIONS`(시스템개발 3문항, 전부 `kind:'text'`)
  - 함수: `developArea(code)`, `developAreaLabel`, `developAreaBadge(codes)`(전 분야면 '시스템개발'), `sortDevelopAreas`,
    `developQuestionsFor(areas)`(시스템개발=6분야 전부를 넘기면 시스템 3문항만, 개별이면 고른 분야의 문항), `developAreaQuestionsFor`,
    `developRequiredMissing(answers, areas)`, `developAnswerIssues`, `developAnswerText(answer)`, `developToolRows(tools, areas)`,
    `developSlotLabel(area, slot)`, `parseDevelopAttachmentField`.
- `area-registry.ts` — 공통 자료형. `MarketQuestionDef.kind?: 'choice'|'text'`, `isTextQuestion(q)`, `isMarketAnswered(q, state)`,
  `MarketAnswer`(choices 는 빈 배열 허용 — text 문항은 `choices: []` + `note`), `marketAttachmentField(area, slot)`,
  `MARKET_EXPERT_PICK_LABEL`.
- `develop.ts`:
  - 사전: `DEVELOP_REQUEST_MODES/_LABELS`(system·individual) · `DEVELOP_BUDGET_RANGES/_LABELS` · `DEVELOP_CURRENT_STAGES/_LABELS`
    (아이디어/요구사항 정리/설계 진행/시제품 제작/시험·검증/양산 준비) · `DEVELOP_TARGET_STAGES/_LABELS`(사양 확정/기능 검증/시제품
    완성/양산 준비 완료/초도 생산) · `DEVELOP_PROTOTYPE_MODES/_LABELS`(none 제작 없음·undecided 수량 미정·count 직접 입력) ·
    `DEVELOP_PRODUCTION_SCOPES/_LABELS`(PCB 제작·부품 구매·SMT·수삽·완제품 조립·범위 협의) · `DEVELOP_PRIORITIES/_LABELS` ·
    `DEVELOP_SOURCING_MODES/_LABELS` · `DEVELOP_DELIVERY_FORMS/_LABELS`.
  - `DevelopProductionPlan`(`{ prototype, prototypeQty, scopes, annualQty, priority, sourcing, delivery }`) · `EMPTY_DEVELOP_PRODUCTION` ·
    `developProductionSummary(plan)`(검토 카드 한 줄) · `developWishLabel(wishDate, wishNote)` · `resolveDevelopServiceAreas(mode, picks)`
    (시스템개발 → 6분야 전부).
  - 등록 payload `DevelopRequestCreatePayloadType`:
    ```
    { requestMode, title, serviceAreas(개별일 때 고른 것 / 시스템이면 []), tools, description, answers,
      currentStage, targetStage, wishDate(YYYY-MM-DD|null), wishNote(string|null — 둘 중 하나 필수),
      budgetRange, expertDelegate(시스템개발 "전문가에게 맡김"), production, ndaWanted, aiConsent, contact }
    ```
  - 수정 `DevelopRequestUpdateBodyType` = 위 필드의 partial(+contact). 분야를 바꾸면 `requestMode`·`serviceAreas` 를 같이 보내라.
  - 상세 `DevelopRequestDetailType` 에 `requestMode`·`currentStage`·`targetStage`·`wishDate`·`wishNote`·`expertDelegate`·`production`
    (옛 행은 null 가능)이 추가됐다. `budgetRange` 는 이제 `DevelopBudgetRangeType`.
- `packages/ui`(`@sp/ui`): `QuestionField`(text 문항 지원), `AreaIcon`(mech 아이콘 추가), `FileDropZone`, `DevReviewView` 에
  `registry` prop 추가 — 개발의뢰 화면은 **반드시** `:registry="DEVELOP_REGISTRY"` 를 넘겨라(기구 라벨·시스템 문항 라벨).
- `packages/utils`: `buildDevReviewBriefRows(answers, DEVELOP_REGISTRY)` — 두 번째 인자로 레지스트리를 넘긴다.
- 서버: `POST /api/develop/requests`(multipart `payload` + `attachment` + `attachment:<area>:<slot>`) — 기존과 같다.
  시스템개발이면 서버가 `serviceAreas` 를 6분야로 채운다. `expertDelegate=true` 면 답변을 버린다.

`MARKET_*`·`marketArea*`·`MARKET_BUDGET_RANGE_LABELS`·`marketAreaBadge`·`marketToolRows`·`marketSlotLabel` 는 **개발의뢰 화면에서
전부 걷어낸다**(마켓 사전 = 다른 상품).

## 2. 프로토타입 사양(이 순서·이 문구로 만든다)

상단 액션 2개: **임시저장** / **처음부터**. 왼쪽 사이드(≥lg, sticky)에 5스텝 내비 + 도움 카드 `?` "기술 내용을 잘 모르시나요? —
아는 내용만 작성하고 '전문가에게 맡김'을 선택하셔도 됩니다." 하단 고정 바: 이전 / 진행 표시 / 다음 단계 →(5스텝에선 "개발의뢰 접수").
사이드 내비는 **지나온 스텝으로만** 이동. 모바일은 상단 진행 표시(현행 방식 유지).

### ① 개발 메뉴 — "어떤 개발이 필요하신가요?" (필수)
부제 "시스템개발은 제품 개발에 필요한 전체 업무를 분석합니다. 개별 견적은 여러 분야를 함께 선택할 수 있습니다."
카드 5장(2열): **시스템개발**(featured — `DEVELOP_SYSTEM_MENU`, 꼬리표 tag) + `DEVELOP_INDIVIDUAL_AREAS` 4장(AreaIcon + label + hint +
꼬리표 `DEVELOP_INDIVIDUAL_TAG`). 규칙: 시스템개발을 고르면 나머지 해제, 개별을 고르면 시스템개발 해제.
안내: "**시스템개발**은 다른 메뉴와 동시에 선택하지 않습니다. PCB·기구·앱·서버는 복수 선택할 수 있습니다."
검증: 아무것도 없으면 "견적을 요청할 개발 메뉴를 선택해 주세요."

### ② 의뢰 내용 — "의뢰 내용을 알려주세요"
부제 "기술용어보다 개발 목적과 사용 상황을 중심으로 작성해도 충분합니다."
- 의뢰 제목 *(placeholder "예: 매장용 자동 음료 디스펜서 개발", maxlength 200)
- "무엇을 개발하고 어떤 문제를 해결하고 싶으신가요?" * textarea 7행, 카운터 `n / 3,000`(maxlength 3000 — 계약 상한 20000 이내),
  placeholder "예: 여러 센서의 값을 수집하고 설정 범위를 벗어나면 펌프와 솔레노이드 밸브를 자동으로 제어하는 장비가 필요합니다. 스마트폰에서 상태 확인과 설정 변경도 가능해야 합니다."
- 현재 개발단계 *(라디오 칩 `DEVELOP_CURRENT_STAGES`) · 목표 개발단계 *(`DEVELOP_TARGET_STAGES`) — 2열
- 희망 완료 시기 *: `<input type="date">` "또는" 텍스트(placeholder "계약 후 3개월") — 둘 중 하나
- 예상 개발 예산 *: select `DEVELOP_BUDGET_RANGES`(첫 옵션 "선택해 주세요" disabled) — 프로토타입은 선택이었지만 서버가 필수라 필수
- 업로드 존 "개발명세서와 참고자료를 올려주세요" / "회로도, PCB 원본, Gerber, DXF·STEP, BOM, 데이터시트, 사진·영상 등을 한 번만 등록합니다."
  (기존 `FileDropZone` variant panel + 파일 목록) + **AI 사전 검토 동의** 체크(기존 문구 유지)
- 비밀유지 계약(NDA) 체크(기존 문구 유지)
- **후속 질문 방식**(시스템개발일 때만 표시) 라디오 2개: 「몇 가지 질문에 답하기 — 사용 상황·입출력·장애 시 동작 3가지만 묻습니다.」(기본) /
  「전문가에게 맡김 — 기술값을 묻지 않고 담당자가 제안합니다.」 → `expertDelegate`
- 검증 순서: 제목·설명(≥10자) → 단계 둘 → 희망 시기 → 예산. 오류 문구는 프로토타입 문구를 따른다
  ("의뢰 제목과 개발 목적을 입력해 주세요." / "현재 단계와 목표 단계를 선택해 주세요." / "희망 완료일 또는 기간을 입력해 주세요." / "예상 개발 예산을 선택해 주세요.")

### ③ 세부 질문
- 시스템개발: 제목 "시스템개발 추가 확인", 부제 "입력 내용과 등록자료에서 확인되지 않은 핵심 사항만 질문합니다." 칩 = '시스템개발'.
  `expertDelegate` 면 박스 "**전문가 검토로 접수합니다** — 기술 사양을 추가로 입력하지 않아도 됩니다. 담당자가 요구사항과 자료를 검토해
  필요한 개발 분야, 제안 사양과 견적 전제를 정리합니다." 만 보이고 입력 없음. 아니면 `DEVELOP_SYSTEM_QUESTIONS` 3문항(그룹 제목 "분석 후 추가 확인").
- 개별 견적: 제목 "개별 개발 전문 질문", 부제 "선택한 분야의 견적에 필요한 전문 사양입니다. 모르는 값은 담당자 제안 필요로 작성할 수 있습니다."
  칩 = 고른 분야명. 분야마다 카드: AreaIcon + label → `developAreaQuestionsFor([code])` 문항(QuestionField) → 희망 툴(details, 기존 방식:
  "전문가 추천" 기본) → "있으면 좋은 자료" 슬롯(FileDropZone variant slot, `showSlots` prop 으로 수정 화면에선 끈다).
- 프로토타입의 "입력 분석 완료" 가짜 배지·키워드 정규식 칩은 **만들지 않는다**.
- 3스텝은 검증 없음(전부 선택). 단 선택지 문항의 `noteRequiredFor` 메모 필수는 기존대로 막는다.
- **재진입해도 답변이 남아야 한다**(프로토타입 결함 — 상태는 폼 컴포저블이 들고 있고 컴포넌트는 그리기만).

### ④ 제작 계획 — "시제품과 생산 계획"
부제 "개발 과정의 시제품과 개발 완료 후 생산 계획을 나누어 확인합니다."
- "개발 과정에서 시제품을 몇 개 제작해야 하나요?" *: 라디오 `DEVELOP_PROTOTYPE_MODES`(none 제작 없음 / undecided 수량 미정 / count 직접입력 + number min 1 "수량" "개")
- "시제품 제작 범위를 선택해 주세요": 체크 칩 `DEVELOP_PRODUCTION_SCOPES`
- 개발 완료 후 예상 연간 생산수량(number, placeholder "예: 5,000") · 가장 중요한 우선순위(select `DEVELOP_PRIORITIES`, 첫 옵션 "선택해 주세요") — 2열
- **제조 연계 확인**(제작 범위 1개 이상일 때만): 자재 조달 방식(select `DEVELOP_SOURCING_MODES`) · 납품 형태(select `DEVELOP_DELIVERY_FORMS`)
- 검증: prototype 미선택 "시제품 제작 수량을 선택해 주세요." · count 인데 수량 없음 "시제품 수량을 입력해 주세요."

### ⑤ 검토·접수 — "입력 내용을 확인해 주세요"
부제 "접수 후 담당자가 개발 범위·일정·비용을 검토하여 견적제안서를 전달합니다."
- **연락처 블록**(기존 `ContactFields` 그대로, 필수) — 프로토타입은 2스텝에 있었지만 여기 둔다(사용자 결정).
- 검토 카드: 선택 메뉴(배지 `developAreaBadge` 또는 개별 분야 태그) · 의뢰 정보(제목 / 의뢰자·연락처) · 개발 목적(줄바꿈 유지) ·
  개발단계(현재 → 목표) · 일정·예산(`developWishLabel` · 예산 라벨) · 첨부자료(파일명 나열 / "등록된 파일 없음") ·
  **세부 질문 답변**(`buildDevReviewBriefRows(buildAnswers(), DEVELOP_REGISTRY)` 행 전부 — 프로토타입은 빠뜨렸다, 넣는다) ·
  희망 툴(있을 때) · 시제품·제조(`developProductionSummary` + 우선순위·조달·납품형태) · 비밀유지·AI 동의.
  각 섹션에 "고치기" 링크(해당 스텝으로 이동).
- 동의 체크 *: "입력한 내용과 자료를 견적 검토 목적으로 사용하는 것에 동의합니다." (UI 게이트만 — 서버 필드 없음)
- 안내 박스 "다음 단계 — AI 검토 초안 작성 → 담당자 기술검토 → 개발 범위·일정·비용 제안"
- 접수 버튼 "개발의뢰 접수". 완료 화면(기존 카드 재사용): "개발의뢰가 접수되었습니다" / "담당자가 입력 내용과 첨부자료를 검토한 뒤 견적제안서를
  전달드리겠습니다." / 접수번호 `DEV-{requestId}`(랜덤 금지) / 의뢰 보기·내 의뢰.

### 임시저장 · 처음부터
- 임시저장: 폼 값(파일 제외)을 `localStorage['sp-develop-request-draft']` 에 저장. 우상단에 "저장됨 · HH:MM" 표시.
  위저드 진입 시 초안이 있으면 **인라인 패널**("이어서 작성할까요?" 이어쓰기 / 버리기)로 복원. 파일은 저장되지 않는다는 안내 한 줄.
  등록 성공 시 초안 삭제.
- 처음부터: 인라인 확인 패널(네이티브 confirm 금지) → 폼 초기화 + 초안 삭제 + 1스텝.

## 3. 파일별 할 일

- `composables/useRequestForm.ts` — **재작성**. 상태: `fields { requestMode: 'system'|'individual'|null, serviceAreas(개별 선택), title,
  description, currentStage|null, targetStage|null, wishDate(''|YYYY-MM-DD), wishNote, budgetRange|null, expertDelegate, production(EMPTY_DEVELOP_PRODUCTION 복사),
  ndaWanted, aiConsent, agree }`, `contact`, 첨부·슬롯, 질문 상태(`QuestionState`), 툴.
  파생: `effectiveAreas = resolveDevelopServiceAreas(mode, picks)`(mode null 이면 []), `activeQuestions = developQuestionsFor(effectiveAreas)`,
  `areaQuestionsOf(code)`, `isSystem`, `buildAnswers()`(choice 문항은 choices>0, text 문항은 note 비어 있지 않을 때 `{code, choices: [], note}` —
  `isMarketAnswered` 사용; expertDelegate 면 []), `buildTools()`(개별 분야만), `buildProduction()`(normalize: count 아니면 qty null, scopes 없으면
  sourcing/delivery null), `buildPayload()`, `hydrate(detail)`, `stepValid` 5개, `steps`(key: menu·describe·questions·production·review, label:
  개발 메뉴/의뢰 내용/세부 질문/제작 계획/검토·접수, sub: 필요한 업무 선택/목적·단계·자료/선택 분야 확인/시제품·생산/입력 내용 확인),
  `errorMessageOfStep`(위 검증 문구), 초안 `saveDraft/loadDraft/clearDraft`.
  **파일 이름·export 이름은 자유지만 `useRequestForm` 과 `DevelopRequestForm` 타입은 유지**(RequestEdit 이 쓴다).
- `components/request/StepMenu.vue`(신규) · `StepDescribe.vue`(재작성) · `StepQuestions.vue`(신규, 옛 `StepConditions.vue` 삭제) ·
  `StepProduction.vue`(신규) · `StepReview.vue`(신규, 옛 `StepContact.vue` 삭제 — `ContactFields.vue` 는 유지) · `WizardAside.vue`(5스텝 + 도움 카드 + 초안 요약).
- `pages/RequestWizard.vue` — 5스텝 셸, 상단 임시저장/처음부터, 초안 복원 패널, 하단 바 오류 문구(`role="alert"`), 완료 화면.
- `pages/RequestEdit.vue` — 스텝 없이 한 화면: StepMenu → StepDescribe(첨부 블록 끔) → StepQuestions(슬롯 끔) → StepProduction → 연락처.
  `changedBody()` 에 새 필드 비교 추가(requestMode/serviceAreas 는 같이, wishDate/wishNote, currentStage, targetStage, expertDelegate, production 은 JSON 비교).
- `components/detail/RequestContent.vue` — 조건 타일: 의뢰 방식(`DEVELOP_REQUEST_MODE_LABELS`) · 예산 · 현재→목표 단계 · 희망 완료 시기 ·
  시제품·제조(요약 + 우선순위/조달/납품형태 행) · 전문가 맡김 배지(있을 때). 답변 표는 `buildDevReviewBriefRows(detail.answers, DEVELOP_REGISTRY)`,
  툴은 `developToolRows`. 옛 행(v1: `timeline` 등 사전에 없는 코드)은 코드가 라벨로 그대로 보여도 된다.
- `pages/RequestDetail.vue` — `developAreaBadge`, `DevReviewView :registry="DEVELOP_REGISTRY"`. `pages/Me.vue` — `developAreaBadge`.
  `components/detail/AttachmentList.vue` — `developSlotLabel`.
- `pages/Home.vue` — 히어로 목록·분야 카드 섹션을 **메뉴 5개**(시스템개발 + 개별 4)로. 카피의 "회로·PCB·펌웨어·앱·서버" 는
  "회로·PCB·펌웨어·기구·앱·서버" 로. 진행 방식 7단계·FAQ 는 그대로.
- 문구는 ko 인라인(이 앱은 i18n 키를 쓰지 않는다 — `$t('common.loading')` 같은 기존 키만 유지).

## 4. 규율

- 네이티브 `confirm/alert/prompt` 금지 — 인라인 패널. 라벨·코드는 계약 상수에서만(한글 라벨을 새로 박지 않는다 — 화면 카피는 예외).
- Tailwind 는 시맨틱 토큰만(`brand-*`·`ink-*`·`paper`·`line`·`line-2`·`tx-1/2/3`·`text-label/body/title/…`). `AreaIcon` 색은 `--color-area-mech` 가 이미 있다.
- 계약·서버·`packages/*` 는 건드리지 않는다. 파일은 CRLF — 편집 도구가 알아서 한다.
- 검증(전부 0 이어야 한다): `pnpm --filter develop typecheck` · `pnpm --filter develop lint` · `pnpm --filter develop build`.
  ESLint 는 strict(`no-unsafe-*`, `prefer-optional-chain`, 미사용 import 0).
- 커밋하지 않는다. 브라우저 검증은 Fable 이 한다(5177 dev 서버는 켜 둬도 된다: `pnpm --filter develop dev`).

## 5. 최종 보고에 적을 것

바꾼 파일 목록 · 검증 명령 결과(typecheck/lint/build) · 계약 갭 · 판단이 필요했던 지점 3개 이내.
