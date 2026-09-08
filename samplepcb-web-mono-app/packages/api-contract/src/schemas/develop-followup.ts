import { z } from 'zod';

// ── 개발의뢰 AI 후속 질문(develop.followup, docs/DEVELOP_FLOW.md §7.2.2, 2026-09-08) ─────────────
// 시스템개발 위저드 3스텝 "몇 가지 질문에 답하기" — AI 가 설명문과 첨부(읽을 수 있는 것 전부: 문서 텍스트 + 이미지 판독)를
// 읽고 **견적 산출에 꼭 필요한데 자료에서 확인되지 않는 것만** 쉬운 말로 묻는다. 의뢰자는 비전문가라는 전제(기술값 금지).
// 흐름: 2→3스텝 전환 때 run(비동기 잡) → 폴링 → 질문 표시 → 답은 등록 payload `aiQuestions` 로. 서버는 잡에서 질문을 다시
// 읽어(클라이언트가 문항을 지어내지 못한다) 답만 합쳐 `sp_develop_request.aiQuestions` 에 박제한다.
// 유스케이스가 꺼져 있거나 실패·시간 초과면 위저드는 고정 서술 3문항(DEVELOP_SYSTEM_QUESTIONS)으로 조용히 폴백한다.
// 이 파일은 leaf 다 — zod 외에 아무것도 import 하지 않는다(ai.ts 가 가져다 쓴다).

export const DEVELOP_FOLLOWUP_VERSION = 1 as const;
export const DEVELOP_FOLLOWUP_MAX_QUESTIONS = 8; // 설계 숫자가 아니라 폭주 방어(모델이 필요한 만큼만 낸다)
export const DEVELOP_FOLLOWUP_MAX_OPTIONS = 6;
export const DEVELOP_FOLLOWUP_UNKNOWN_CHOICE = 'unknown';
export const DEVELOP_FOLLOWUP_UNKNOWN_LABEL = '잘 모르겠음';

export const DevelopFollowupOption = z.object({
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
});
export type DevelopFollowupOptionType = z.infer<typeof DevelopFollowupOption>;

// 질문 하나 — options 가 비어 있으면 서술형. 선택지형이면 서버가 '잘 모르겠음'(unknown)을 맨 뒤에 붙여 둔다.
export const DevelopFollowupQuestion = z.object({
  id: z.string().trim().min(1).max(40), // q1…(서버 부여)
  question: z.string().trim().min(1).max(200),
  why: z.string().trim().max(200).catch(''),
  options: z.array(DevelopFollowupOption).max(DEVELOP_FOLLOWUP_MAX_OPTIONS + 1),
});
export type DevelopFollowupQuestionType = z.infer<typeof DevelopFollowupQuestion>;

// 잡 결과(sp_ai_job.resultJson) — 후처리(상한·중복 제거·unknown 부착)까지 끝난 것.
export const DevelopFollowupResult = z.object({
  version: z.literal(DEVELOP_FOLLOWUP_VERSION),
  understood: z.string().trim().max(300).catch(''), // 모델이 자료에서 파악한 제품 한 문장 — 고객이 "맞게 읽었나" 확인
  questions: z.array(DevelopFollowupQuestion).max(DEVELOP_FOLLOWUP_MAX_QUESTIONS),
  meta: z.object({
    jobId: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    generatedAt: z.string(),
    attachmentFiles: z.array(z.string().max(300)).max(20),
  }),
});
export type DevelopFollowupResultType = z.infer<typeof DevelopFollowupResult>;

// 고객 답 하나 — 선택지형은 choice(옵션 코드), 서술형은 text. 둘 다 비면 미응답.
export const DevelopFollowupAnswer = z.object({
  id: z.string().trim().min(1).max(40),
  choice: z.string().trim().max(40).nullable().default(null),
  text: z.string().trim().max(500).default(''),
});
export type DevelopFollowupAnswerType = z.infer<typeof DevelopFollowupAnswer>;

// 등록 payload 조각 — 잡 id 로 서버가 질문을 되읽는다.
export const DevelopFollowupAnswersInput = z.object({
  jobId: z.string().uuid(),
  answers: z.array(DevelopFollowupAnswer).max(DEVELOP_FOLLOWUP_MAX_QUESTIONS),
});
export type DevelopFollowupAnswersInputType = z.infer<typeof DevelopFollowupAnswersInput>;

// 수정 본문 조각 — 저장된 질문의 답만 바꾼다(질문은 불변).
export const DevelopFollowupAnswersPatch = z.object({
  answers: z.array(DevelopFollowupAnswer).max(DEVELOP_FOLLOWUP_MAX_QUESTIONS),
});
export type DevelopFollowupAnswersPatchType = z.infer<typeof DevelopFollowupAnswersPatch>;

// 저장분(sp_develop_request.aiQuestions) — 질문 + 답.
export const DevelopAiAnswer = z.object({
  choice: z.string().max(40).nullable(),
  text: z.string().max(500),
});
export type DevelopAiAnswerType = z.infer<typeof DevelopAiAnswer>;
export const DevelopAiQuestion = DevelopFollowupQuestion.extend({ answer: DevelopAiAnswer.nullable() });
export type DevelopAiQuestionType = z.infer<typeof DevelopAiQuestion>;
export const DevelopAiQuestions = z.object({
  version: z.literal(DEVELOP_FOLLOWUP_VERSION),
  jobId: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  understood: z.string().max(300),
  questions: z.array(DevelopAiQuestion).max(DEVELOP_FOLLOWUP_MAX_QUESTIONS),
});
export type DevelopAiQuestionsType = z.infer<typeof DevelopAiQuestions>;

// 답 정규화 — 선택지형은 옵션 코드에 있는 것만(아니면 null), 서술형은 choice 무시. 둘 다 비면 미응답(null).
const normalizeAnswer = (q: DevelopFollowupQuestionType, a: DevelopFollowupAnswerType | undefined): DevelopAiAnswerType | null => {
  if (a === undefined) return null;
  const hasOptions = q.options.length > 0;
  const choice = hasOptions && a.choice !== null && q.options.some((o) => o.code === a.choice) ? a.choice : null;
  const text = a.text.trim();
  if (choice === null && text === '') return null;
  return { choice, text };
};

// 잡 결과 + 고객 답 → 저장분. 잡에 없는 id 의 답은 버린다.
export function mergeDevelopFollowupAnswers(
  result: DevelopFollowupResultType,
  answers: readonly DevelopFollowupAnswerType[],
): DevelopAiQuestionsType {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return {
    version: DEVELOP_FOLLOWUP_VERSION,
    jobId: result.meta.jobId,
    model: result.meta.model,
    generatedAt: result.meta.generatedAt,
    understood: result.understood,
    questions: result.questions.map((q) => ({ ...q, answer: normalizeAnswer(q, byId.get(q.id)) })),
  };
}

// 저장분에 답만 다시 입힌다(수정 화면). 보내지 않은 문항의 답은 그대로 둔다.
export function applyDevelopFollowupAnswers(
  stored: DevelopAiQuestionsType,
  answers: readonly DevelopFollowupAnswerType[],
): DevelopAiQuestionsType {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return {
    ...stored,
    questions: stored.questions.map((q) => (byId.has(q.id) ? { ...q, answer: normalizeAnswer(q, byId.get(q.id)) } : q)),
  };
}

export const isDevelopFollowupAnswered = (q: DevelopAiQuestionType): boolean =>
  q.answer !== null && (q.answer.choice !== null || q.answer.text !== '');

// 표시·프롬프트용 답 문자열 — "선택지 라벨 (메모)" / 서술 / '' (미응답).
export function developFollowupAnswerText(q: DevelopAiQuestionType): string {
  if (q.answer === null) return '';
  const label = q.answer.choice === null ? '' : (q.options.find((o) => o.code === q.answer?.choice)?.label ?? q.answer.choice);
  const text = q.answer.text;
  if (label === '') return text;
  return text === '' ? label : `${label} (${text})`;
}
export const isDevelopFollowupUnknown = (q: DevelopAiQuestionType): boolean => q.answer?.choice === DEVELOP_FOLLOWUP_UNKNOWN_CHOICE;

// ── 실행(위저드 2→3스텝, multipart payload + attachment[]) ───────────────────────
export const DevelopFollowupRunPayload = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(20000),
});
export type DevelopFollowupRunPayloadType = z.infer<typeof DevelopFollowupRunPayload>;

export const DevelopFollowupRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string(), cached: z.boolean() }),
});
export type DevelopFollowupRunResponseType = z.infer<typeof DevelopFollowupRunResponse>;
