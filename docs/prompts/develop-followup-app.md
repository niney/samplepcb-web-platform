# 개발의뢰 AI 후속 질문 — 고객 앱(apps/develop) 워커 브리프 (2026-09-08)

당신은 `samplepcb-web-mono-app/apps/develop`(Vue3 + Vite + Tailwind v4, 포트 5177, base `/develop/`)의 화면을 고치는 워커다.
계약·서버·DB 는 **이미 끝났다**(Fable). 당신은 고객 앱 화면만 바꾼다. 계약이나 서버에 빈틈이 보이면 고치지 말고 최종 보고에 "계약 갭"으로 적어라.
작업 전에 현재 위저드 코드(`src/composables/useRequestForm.ts` · `src/components/request/*.vue` · `src/pages/RequestWizard.vue` · `RequestEdit.vue` ·
`src/components/detail/RequestContent.vue` · `src/api/useDevelopRequests.ts`)와 아래 계약 파일을 끝까지 읽어라.

## 0. 무엇을 바꾸나

시스템개발의 후속 질문 방식 "몇 가지 질문에 답하기"가 **AI 가 자료를 읽고 고른 질문**으로 바뀐다(사용자 결정):
- 2→3스텝 전환 때 설명문 + 첨부를 서버에 보내 AI 잡을 시작하고, 3스텝은 완료될 때까지 진행 상태를 보인다.
- 완료되면 AI 가 만든 질문(개수·형태는 AI 가 정한다: 선택지형/서술형 혼합, 최대 8)을 보이고 답을 받는다.
- 유스케이스가 꺼져 있거나 실패·시간 초과면 **지금의 고정 서술 3문항으로 조용히 폴백**한다.
- 자료가 AI 로 나가는 시점이 2→3 전환이므로 **AI 동의 체크를 2스텝 업로드 존 아래로 되돌린다**(모든 의뢰 공통, 5스텝 동의 체크는 없앤다. NDA 체크는 5스텝에 그대로).
- 협업 범위 3문항(`askOnDelegate`)은 AI 질문 아래에 고정으로 그대로 보인다.

## 1. 계약·API (구현 완료 — 여기서만 가져다 쓴다)

`packages/api-contract/src/schemas/develop-followup.ts`:
- `DevelopFollowupRunPayload { title, description }` · `DevelopFollowupRunResponse { data: { jobId, cached } }`
- `DevelopFollowupResult { version:1, understood, questions: DevelopFollowupQuestion[], meta }` — 잡 완료 결과. `DevelopFollowupQuestion { id, question, why, options: {code,label}[] }` (options 가 비면 서술형, 있으면 맨 뒤가 `unknown`/"잘 모르겠음").
- `DevelopFollowupAnswer { id, choice: string|null, text: string }` · `DevelopFollowupAnswersInput { jobId, answers }`(등록 payload `aiQuestions`) · `DevelopFollowupAnswersPatch { answers }`(수정 body `aiQuestions`).
- 저장분 `DevelopAiQuestions { jobId, model, generatedAt, understood, questions: (question + answer{choice,text}|null)[] }` — 상세 `detail.aiQuestions`(null 가능).
- 헬퍼: `developFollowupAnswerText(q)`, `isDevelopFollowupAnswered(q)`, `DEVELOP_FOLLOWUP_UNKNOWN_CHOICE`.
- `ai.ts`: `AiUsecaseStatusResponse`, `AiJobResponse`(`data.status` running|done|error, `data.stage` 'attachments'|'followup'|…, `data.followup: DevelopFollowupResult|null`, `data.elapsedSecs`).

API(`apiRoutes.ai` = `/api/ai`):
- `GET /api/ai/develop.followup/status` → `{ data: { enabled } }` (공개). 꺼져 있으면 AI 를 부르지 말고 고정 3문항.
- `POST /api/ai/develop.followup/run` — multipart: `payload`(JSON 문자열 `{title, description}`) + `attachment`(파일 여러 개, 2스텝 첨부 그대로). 로그인 필요. 200 `{ jobId, cached }` · 409 `USECASE_DISABLED`.
- `GET /api/ai/jobs/:jobId` — 폴링(running 동안 3~5초 간격). done 이면 `followup` 에 질문. error 면 폴백.
- 등록 `POST /api/develop/requests` payload 에 `aiQuestions: { jobId, answers } | null` 추가(시스템개발 + 맡김 아님 + AI 질문을 썼을 때만). 폴백이면 `null` 이고 고정 3문항 답은 지금처럼 `answers` 로.
- 수정 `PATCH` body `aiQuestions: { answers }` (저장분이 있을 때만, 질문은 못 바꾼다).

마켓 앱에 같은 패턴의 훅이 있다: `apps/market/src/api/useAi.ts`(`useDevReviewStatus` · `useRunDevReview` · `useAiJob`). 개발의뢰 앱에 `src/api/useDevelopAi.ts` 를 만들어
같은 모양으로 `useDevelopFollowupStatus` · `useRunDevelopFollowup` · `useAiJob` 을 둔다(`apiGet`/`apiSendForm` 은 `@sp/shared`).

## 2. 화면 사양

### 2스텝
- 업로드 존 아래에 동의 체크(필수): "입력한 내용과 자료를 견적 검토와 AI 사전 검토 목적으로 사용하는 것에 동의합니다." + 보조문 "시스템개발에서 '몇 가지 질문에 답하기'를 고르면 다음 단계에서 AI 가 자료를 읽고 질문을 고릅니다." → `fields.aiConsent`. 미체크면 2스텝 "다음"이 막히고 오류 "입력 내용과 자료를 견적 검토와 AI 사전 검토에 사용하는 데 동의해 주세요."
- 후속 질문 방식(시스템개발만) 라디오 문구: 「AI 가 자료를 보고 몇 가지만 묻기 — 설명과 첨부에서 확인되지 않는 것만 묻습니다. 자료를 읽는 데 30초~3분 걸립니다.」(기본) / 「전문가에게 맡김 — 기술값을 묻지 않고 담당자가 제안합니다.」
- 5스텝: 동의 체크 제거(비밀유지 체크는 유지). 5스텝 검증은 연락처만.

### 3스텝(시스템개발, 맡김 아님)
1. 진입하면(또는 2스텝 "다음" 클릭 직후) 상태 조회 → enabled 가 아니면 **즉시 고정 3문항**(지금 화면) + 안내 한 줄 "지금은 AI 질문을 쓸 수 없어 기본 질문을 드립니다."
2. enabled 면 run 을 호출한다. 단 **같은 입력이면 다시 부르지 않는다**: 입력 키 = 제목 + 설명 + 첨부(name·size·lastModified) — 컴포저블이 `followupJobId` 와 `followupInputKey` 를 들고, 키가 같으면 기존 jobId 로 폴링만 한다(서버도 같은 입력의 완료 잡을 재사용하니 부담 없다).
3. 진행 패널: 단계별 문구 — `attachments` "첨부 자료를 읽는 중…" / `followup` "견적에 필요한 질문을 고르는 중…" / 그 밖 "준비 중…" + 경과 초 + 회전 표시. 아래에 버튼 **「기다리지 않고 전문가에게 맡김으로 진행」**(누르면 `fields.expertDelegate = true` → 맡김 화면(안내 박스 + 협업 3문항)). 진행 중엔 하단 "다음 단계" 버튼을 비활성.
4. done: `followup.understood` 가 비어 있지 않으면 맨 위에 "AI 가 이해한 내용: …" 한 줄(고객이 맞게 읽었나 확인) + 질문들. 질문은 **`QuestionField` 로 그린다** — `DevelopFollowupQuestion` 을 `MarketQuestionDef` 모양으로 바꿔서(코드 `ai:${id}`, label=question, short=question 앞 20자, multi=false, options 그대로(비면 `kind:'text'`), why=why, notePlaceholder 서술형이면 '아는 만큼만 적어 주세요'). 상태는 별도 `aiQuestionState: Record<id, QuestionState>` 로 든다(레지스트리 답변 `questionState` 와 섞지 않는다). 질문이 0개면 "자료가 충분해 추가 질문이 없습니다." 박스.
5. error(또는 클라이언트 타임아웃 5분): 고정 3문항으로 폴백 + 안내 한 줄 "자료를 읽지 못해 기본 질문을 드립니다." 폴백이면 등록 payload `aiQuestions: null`.
6. 협업 범위 3문항 섹션은 AI 질문 아래 그대로.
7. 3스텝은 필수 검증 없음(AI 질문도 전부 선택).

### 5스텝 검토 카드
- "세부 질문 답변"에 AI 질문 답도 함께(질문 문장 = 라벨, 답 = `developFollowupAnswerText` 와 같은 규칙 — 선택지 라벨(+메모) / 서술). 미응답은 표시하지 않는다. AI 질문을 썼으면 섹션 제목 옆에 작은 칩 "AI 질문".

### 등록 payload
- `buildPayload()`: 시스템개발 + 맡김 아님 + AI 질문 사용(폴백 아님)이면 `aiQuestions: { jobId, answers: [{ id, choice, text }] }`(답한 것만). 그 밖은 `null`.
- 임시저장(localStorage)에는 AI 질문·답을 넣지 않는다(잡은 1시간 재사용이라 복원 시 다시 부르면 된다).

### 수정 화면(RequestEdit)
- `detail.aiQuestions` 가 있으면 3스텝 자리에서 고정 3문항 대신 **저장된 AI 질문**(understood + 질문·답)을 QuestionField 로 편집(재생성 없음). `changedBody()` 에 `aiQuestions: { answers }`(바뀌었을 때만). 없으면 지금처럼.

### 상세(RequestContent)
- `detail.aiQuestions` 가 있으면 답변 표 앞에 "AI 추가 질문" 블록: understood 한 줄 + 질문/답 행(미응답은 "답하지 않음" 회색). 없으면 블록 없음.

## 3. 규율
- 네이티브 confirm/alert 금지. 라벨은 계약 상수. Tailwind 는 시맨틱 토큰만. 계약·서버·`packages/*` 는 건드리지 않는다. 파일은 CRLF.
- 검증(전부 0): `pnpm --filter develop typecheck` · `pnpm --filter develop lint` · `pnpm --filter develop build`. 커밋하지 않는다.
- 브라우저 검증은 Fable 이 한다(5177 dev 서버는 켜 둬도 된다).

## 4. 최종 보고
바꾼 파일 · 검증 결과 · 계약 갭 · 판단이 필요했던 지점 3개 이내.
