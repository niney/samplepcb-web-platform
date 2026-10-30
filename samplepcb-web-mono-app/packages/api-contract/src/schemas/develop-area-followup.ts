import { z } from 'zod';
import {
  DEVELOP_FOLLOWUP_MAX_QUESTIONS,
  DEVELOP_FOLLOWUP_VERSION,
  DevelopAreaFollowupCovered,
  DevelopFollowupQuestion,
  mergeDevelopFollowupAnswers,
} from './develop-followup';
import type {
  DevelopAiQuestionsType,
  DevelopAreaAiMetaType,
  DevelopAreaFollowupCoveredType,
  DevelopFollowupAnswerType,
} from './develop-followup';

// ── 개발의뢰 개별 메뉴 AI 맞춤 질문(develop.area-followup, docs/DEVELOP_FLOW.md §7.2.4, 2026-10-30) ─────────────
// 시스템개발 후속 질문(develop-followup.ts)은 무엇을 물을지부터 AI 가 정한다. 개별 메뉴는 물을 거리가 정해져 있다(검토 끝난
// 기본 질문). AI 는 기본 질문마다 ① 자료에 답이 있으면 채우고(covered) ② 없으면 이 제품에 맞게 고쳐 묻고(asked)
// ③ 기본 질문 밖에서 꼭 필요한 것만 메뉴당 2개까지 더한다(added).
// 답의 코드는 잃지 않는다 — asked 의 선택지마다 원래 선택지 코드(maps)가 붙어 있어 위저드가 지금과 같은 코드 답(answers)으로
// 저장한다. added 는 레지스트리에 없는 질문이라 시스템개발 AI 질문과 같은 저장분(sp_develop_request.aiQuestions)에 담는다.
// 분기·필수에 쓰이는 질문(개발 범위·권리 확인·필요 작업)은 AI 에 맡기지 않는다. 모델이 빠뜨린 기본 질문은 원래 문구로 묻는다
// (결과에 없으면 위저드가 기본 질문을 그대로 그린다).

export const DEVELOP_AREA_FOLLOWUP_VERSION = 1 as const;
// 원래 선택지에 없는 선택지(maps null)의 위저드 상태 표기 — 레지스트리 코드와 섞이지 않게 접두를 붙여 둔다. 저장 땐 'other' + 메모.
export const DEVELOP_AREA_CUSTOM_PREFIX = '~';

export const DevelopAreaFollowupOption = z.object({
  code: z.string().max(40), // o1… · unknown
  label: z.string().max(80),
  maps: z.string().max(40).nullable(), // 원래 선택지 코드(없으면 새 선택지 — 저장 땐 'other' + 메모)
  preset: z.boolean(), // 자료에서 확인돼 미리 체크(여러 개 선택 질문만)
});
export type DevelopAreaFollowupOptionType = z.infer<typeof DevelopAreaFollowupOption>;

// 고쳐 묻는 기본 질문 — 선택지가 비면 서술형(기본 질문도 서술형).
export const DevelopAreaFollowupAsked = z.object({
  area: z.string().max(20),
  base: z.string().max(40),
  question: z.string().max(200),
  why: z.string().max(200),
  options: z.array(DevelopAreaFollowupOption).max(20),
});
export type DevelopAreaFollowupAskedType = z.infer<typeof DevelopAreaFollowupAsked>;

// 기본 질문 밖 새 질문 — 시스템개발 AI 질문과 같은 모양(하나 선택 또는 서술) + 묶음을 정할 분야.
export const DevelopAreaFollowupAdded = DevelopFollowupQuestion.extend({ area: z.string().max(20) });
export type DevelopAreaFollowupAddedType = z.infer<typeof DevelopAreaFollowupAdded>;

// 잡 결과(sp_ai_job.resultJson) — 후처리(코드 검증·되살림·상한)까지 끝난 것.
export const DevelopAreaFollowupResult = z.object({
  version: z.literal(DEVELOP_AREA_FOLLOWUP_VERSION),
  understood: z.string().max(300),
  covered: z.array(DevelopAreaFollowupCovered).max(64),
  asked: z.array(DevelopAreaFollowupAsked).max(64),
  added: z.array(DevelopAreaFollowupAdded).max(DEVELOP_FOLLOWUP_MAX_QUESTIONS),
  meta: z.object({
    jobId: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    generatedAt: z.string(),
    areas: z.array(z.string().max(20)).max(16),
    attachmentFiles: z.array(z.string().max(300)).max(20),
  }),
});
export type DevelopAreaFollowupResultType = z.infer<typeof DevelopAreaFollowupResult>;

// ── 실행(위저드 2→3스텝, multipart payload + attachment[]) ───────────────────────
// areas 는 1스텝에서 고른 카드의 분야 그대로('앱 및 서버'는 범위를 고르기 전이라 app·server 둘 다).
export const DevelopAreaFollowupRunPayload = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(20000),
  areas: z.array(z.string().max(20)).min(1).max(16),
});
export type DevelopAreaFollowupRunPayloadType = z.infer<typeof DevelopAreaFollowupRunPayload>;

// ── 저장분 메타(sp_develop_request.aiQuestions.area, 스키마는 develop-followup.ts) ─────────
// kept = 고객이 AI 가 채운 답을 고치지 않고 넘겼다(견적 담당이 믿을 정도를 가늠하는 표시). 서버가 등록·수정 때 답과 맞대 계산한다.
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

// 채운 답이 그대로인가 — 선택지 집합과 메모가 같으면 그대로다.
export function developAreaCoveredKept(
  covered: Pick<DevelopAreaFollowupCoveredType, 'base' | 'choices' | 'note'>,
  answers: readonly { code: string; choices: readonly string[]; note?: string | undefined }[],
): boolean {
  const a = answers.find((x) => x.code === covered.base);
  if (a === undefined) return false;
  return sameSet(a.choices, covered.choices) && (a.note ?? '').trim() === covered.note.trim();
}

// 잡 결과 + 최종 답 → 저장 메타.
export function buildDevelopAreaAiMeta(
  result: Pick<DevelopAreaFollowupResultType, 'covered' | 'asked'>,
  answers: readonly { code: string; choices: readonly string[]; note?: string | undefined }[],
): DevelopAreaAiMetaType {
  return {
    covered: result.covered.map((c) => ({ ...c, kept: developAreaCoveredKept(c, answers) })),
    asked: result.asked.map((q) => ({ code: q.base, question: q.question })),
  };
}

// 등록 저장분 — 새 질문(added)과 그 답은 시스템개발 AI 질문과 같은 모양으로, 채운 답·고쳐 물은 문장은 area 메타로.
// newAnswers = 새 질문의 답(잡에 없는 id 는 버린다) · answers = 최종 코드 답(kept 계산용).
export function mergeDevelopAreaFollowup(
  result: DevelopAreaFollowupResultType,
  newAnswers: readonly DevelopFollowupAnswerType[],
  answers: readonly { code: string; choices: readonly string[]; note?: string | undefined }[],
): DevelopAiQuestionsType {
  const merged = mergeDevelopFollowupAnswers(
    {
      version: DEVELOP_FOLLOWUP_VERSION,
      understood: result.understood,
      questions: result.added.map(({ area: _area, ...q }) => q),
      meta: result.meta,
    },
    newAnswers,
  );
  const areaOf = new Map(result.added.map((q) => [q.id, q.area]));
  return {
    ...merged,
    questions: merged.questions.map((q) => {
      const area = areaOf.get(q.id);
      return area === undefined ? q : { ...q, area };
    }),
    area: buildDevelopAreaAiMeta(result, answers),
  };
}

// 답이 바뀐 뒤(수정 화면) kept 를 다시 계산한다.
export function refreshDevelopAreaAiMeta(
  meta: DevelopAreaAiMetaType,
  answers: readonly { code: string; choices: readonly string[]; note?: string | undefined }[],
): DevelopAreaAiMetaType {
  return { ...meta, covered: meta.covered.map((c) => ({ ...c, kept: developAreaCoveredKept(c, answers) })) };
}

// 위저드 상태(원래 코드 + 새 선택지 표기) → 저장 답. 새 선택지는 'other' 로 모으고 라벨을 메모 앞에 붙인다.
// 'other' 가 없는 질문에는 새 선택지가 오지 않는다(서버 정규화가 막는다) — 그래도 오면 라벨만 메모로 남긴다.
export function developAreaStateToAnswer(
  state: { readonly choices: readonly string[]; readonly note: string },
  hasOther: boolean,
): { choices: string[]; note: string } {
  const custom = state.choices.filter((c) => c.startsWith(DEVELOP_AREA_CUSTOM_PREFIX)).map((c) => c.slice(DEVELOP_AREA_CUSTOM_PREFIX.length));
  const codes = state.choices.filter((c) => !c.startsWith(DEVELOP_AREA_CUSTOM_PREFIX));
  if (custom.length > 0 && hasOther && !codes.includes('other')) codes.push('other');
  const note = [custom.join(', '), state.note.trim()].filter((s) => s !== '').join(' / ');
  return { choices: codes, note };
}
