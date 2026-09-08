# 개발의뢰 AI 후속 질문 — 관리자(apps/web) 워커 브리프 (2026-09-08)

당신은 `samplepcb-web-mono-app/apps/web`(sp-vue, Vue3 + vue-i18n + Tailwind v4)의 **개발의뢰 관리자 화면·AI 설정만** 고치는 워커다.
계약·서버·DB 는 이미 끝났다(Fable). 계약이나 서버에 빈틈이 보이면 고치지 말고 최종 보고에 "계약 갭"으로 적어라.

## 0. 무엇이 생겼나
- 새 AI 유스케이스 `develop.followup`(개발의뢰 위저드 3스텝에서 AI 가 자료를 읽고 견적에 필요한 질문만 고른다). 관리자 AI 설정에 카드가 하나 더 필요하다.
- 의뢰 상세 응답(`AdminDevelopRequestDetail`)에 `aiQuestions: DevelopAiQuestions | null` 이 생겼다(`packages/api-contract/src/schemas/develop-followup.ts`):
  `{ jobId, model, generatedAt, understood, questions: [{ id, question, why, options:{code,label}[], answer: {choice, text} | null }] }`.
  헬퍼 `developFollowupAnswerText(q)` · `isDevelopFollowupAnswered(q)` · `isDevelopFollowupUnknown(q)`.
- AI 설정 응답 `AiSettingsResponse.data.developFollowup`(모양은 `developDiagram` 과 같다: enabled·model·think·extraInstructions·promptVersion·updatedAt),
  저장 `AiSettingsUpdate.developFollowup`(enabled·model·think·extraInstructions).

## 1. 파일별 할 일
- `src/components/admin/AiSettingsForm.vue` — 기존 "⑤ 개발의뢰 구성도" 카드(`develop.dev-diagram`) 바로 아래에 같은 모양의 **⑥ 개발의뢰 후속 질문** 카드(`develop.followup`): 사용 토글·모델(datalist `ai-models`)·thinking 단계·추가 지침·promptVersion/updatedAt. 상태 ref(`devfEnabled` 등)·로드·저장 payload 에 `developFollowup` 을 더한다.
  i18n `admin.settings.ai.developFollowup.*`(ko/en): title '개발의뢰 후속 질문' / enabled / enabledHint '켜면 개발의뢰 위저드에서 고객이 「몇 가지 질문에 답하기」를 고를 때 AI 가 설명·첨부를 읽고 견적에 필요한 질문만 고릅니다. 꺼져 있으면 고정 3문항을 씁니다. 고객이 기다리는 잡이라 빠른 설정을 권합니다.' / model / modelHint '질문을 고르는 텍스트 모델. 기본 kimi-k3.' / think / extraInstructions / extraInstructionsHint '프롬프트 끝에 붙는 운영 지침입니다. 질문 개수 상한·출력 형식은 코드가 고정합니다.'
- `src/components/admin/develop/DevelopRequestContent.vue` — 답변 표 **앞**에 "AI 추가 질문" 블록: `aiQuestions` 가 null 이면 블록 없음. 있으면 understood 한 줄(회색) + 질문/답 행(값은 `developFollowupAnswerText`, 미응답은 '—' 회색, `unknown` 선택은 amber), 블록 제목 옆에 모델·생성 시각 작은 글씨. i18n `admin.develop.content.aiQuestions`('AI 추가 질문 {count}개')·`aiUnderstood`('AI 가 이해한 내용')·`aiUnanswered`('답하지 않음').
- 실행 이력(`admin.settings.ai.jobs`)에 유스케이스 라벨 사전이 있으면 `develop.followup` 라벨('개발의뢰 후속 질문')을 더한다(`grep -rn "dev-diagram" src/i18n src/components/admin` 로 찾아라).
- 두 로케일 키 집합이 같아야 한다(실제로 두 파일을 평가해 대조하라).

## 2. 규율
- 네이티브 confirm/alert 금지. 계약·서버·`packages/*` 는 건드리지 않는다. 파일은 CRLF.
- 검증(전부 0): `pnpm --filter web typecheck` · `pnpm --filter web lint`. 커밋하지 않는다.

## 3. 최종 보고
바꾼 파일 · 검증 결과 · 계약 갭 · 판단이 필요했던 지점.
