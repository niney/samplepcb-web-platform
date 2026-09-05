import { z } from 'zod';
import {
  MARKET_AREAS,
  MARKET_AREA_CODES,
  MarketAnswers,
  MarketAreaCodeLoose,
  MarketAreaCodes,
  marketAnswerIssues,
  marketQuestion,
} from './market-areas';

// ── AI 사전 검토서 v4 (docs/AI_DEV_REVIEW.md §13·§13.7, 2026-09-04) ─────────────
// 재능마켓 의뢰의 AI 산출물 1(즉시, 위저드 대기 안). 고객·전문가·관리자가 같은 JSON 을 같은 뷰로
// 본다. "확정된 것만" — 항목마다 근거(고객 원문 인용)가 붙고, 근거가 코퍼스에 없거나 자료에 없는
// 수치·품번을 품은 항목은 서버 후처리(apps/api lib/ai/dev-review.ts)가 **삭제**한다. 정해지지
// 않은 것은 "전문가와 상의할 항목"(≤6) 한 목록으로만 남는다. 가격·주수·판정어·리스크 등급 없음.
//
// v3: 분야·질문은 레지스트리(market-areas.ts)에서 온다 — 분야 코드는 z.enum 이 아니라 문자열(레지스트리
// 검증)이라 분야가 늘거나 빠져도 저장분 파싱이 깨지지 않는다.
// v4(§13.7): 검토서 안의 3열 카드 구성도를 뺐다 — "시스템 구성도"는 market-dev-diagram.ts 의 산출물(kimi 자유
// SVG, 3단계에서 병렬 시작·비동기 완성) 하나뿐이다.

export const DEV_REVIEW_VERSION = 4 as const;

// ── 검토서 항목 — 근거 붙은 사실(확정만) ────────────────────────────────────────
const nullableShort = (max: number) => z.string().trim().max(max).nullable().catch(null);

export const DevReviewFact = z.object({
  text: z.string().trim().min(1).max(200),
  evidence: nullableShort(200), // 고객 원문 인용 — 후처리가 코퍼스 대조, 없으면 항목 삭제
});
export type DevReviewFactType = z.infer<typeof DevReviewFact>;

// 개발명세서 행 = 항목명 + 사실(평면 — 중첩 객체는 모델이 문자열로 뭉개는 것이 v1 프로빙 실측).
export const DevReviewSpecRow = DevReviewFact.extend({
  item: z.string().trim().min(1).max(30),
});
export type DevReviewSpecRowType = z.infer<typeof DevReviewSpecRow>;

// 검토 관찰 — 자료의 사실 둘을 잇는 전문가식 한 줄. 사실과 같은 근거 규칙(R1·R2·R8)을 받고,
// 권장·판정 어휘는 후처리가 버린다(§12.10).
export const DevReviewObservation = DevReviewFact;
export type DevReviewObservationType = z.infer<typeof DevReviewObservation>;

export const DevReviewAreaReview = z.object({
  area: MarketAreaCodeLoose, // 레지스트리 코드 — 후처리가 선택 분야로 정렬·보충한다
  summary: z.string().trim().max(160).catch(''), // 이 분야에서 무엇을 구현하는지 한 줄
  spec: z.array(DevReviewSpecRow).max(6),
  observations: z.array(DevReviewObservation).max(2).catch([]),
});
export type DevReviewAreaReviewType = z.infer<typeof DevReviewAreaReview>;

// 상의 항목의 분야 — 분야 코드 또는 'general'(자료 간 불일치·답변↔자료 정합처럼 분야에 안 속하는 것).
export const DEV_REVIEW_GENERAL_AREA = 'general';
export const DevReviewQuestionArea = z.string().max(32).catch(DEV_REVIEW_GENERAL_AREA);

export const DevReviewOpenQuestion = z.object({
  question: z.string().trim().min(1).max(120),
  why: z.string().trim().max(120).catch(''),
  area: DevReviewQuestionArea,
  // 개발의뢰(docs/DEVELOP_FLOW.md §6) — 담당자가 상담 뒤 적는 "확인 결과". 마켓 저장분엔 없다(additive).
  resolution: z.string().trim().max(500).nullable().optional(),
});
export type DevReviewOpenQuestionType = z.infer<typeof DevReviewOpenQuestion>;

// 답변↔자료 정합 — 공통 질문 답과 설명·첨부가 범주 수준에서 어긋난 것(R9).
export const DEV_REVIEW_CHECK_CODES = ['stage', 'external'] as const;
export const DevReviewCheck = z.object({
  code: z.enum(DEV_REVIEW_CHECK_CODES),
  answer: z.string().max(60), // 고객이 고른 답 라벨
  found: z.array(z.string().max(30)).min(1).max(6), // 자료에서 발견한 단서(원문 표기)
  text: z.string().max(200), // 화면 문장
});
export type DevReviewCheckType = z.infer<typeof DevReviewCheck>;

// ── 개발 일정(예상) — 개발의뢰(sp-develop) 전용 additive 블록(docs/DEVELOP_FLOW.md §6) ──────
// **검토서의 일정은 예상, 견적서의 기간은 약속**(2026-09-05 결정). 그래서 여기 수치는 점 추정이 아니라
// 범위(최소~최대 주)만 받고, 합계는 저장하지 않고 언제나 단계에서 재계산한다(LLM 이 준 합계는 버린다).
// 마켓 검토서엔 이 블록이 없다 — 프롬프트·JSON 스키마·후처리가 develop 타깃일 때만 켜진다.

export const DEV_REVIEW_SCHEDULE_MAX_PHASES = 8;
export const DEV_REVIEW_SCHEDULE_MAX_WEEKS = 104;

export const DevReviewSchedulePhase = z.object({
  name: z.string().trim().min(1).max(40), // 단계명(회로 설계·PCB 아트웍·시제품 제작·펌웨어 1차 …)
  minWeeks: z.number().int().min(1).max(DEV_REVIEW_SCHEDULE_MAX_WEEKS),
  maxWeeks: z.number().int().min(1).max(DEV_REVIEW_SCHEDULE_MAX_WEEKS), // 후처리가 min ≤ max 로 보정
  output: z.string().trim().max(120).catch(''), // 이 단계가 끝나면 나오는 것
  prerequisite: z.string().trim().max(120).catch(''), // 고객이 먼저 줘야 할 자료·결정(없으면 '')
  note: z.string().trim().max(120).catch(''),
});
export type DevReviewSchedulePhaseType = z.infer<typeof DevReviewSchedulePhase>;

// 고객이 고른 완료 시점 — 공통 조건 질문 'timeline' 의 선택지와 같아야 한다(어긋나면 dev-review.test.ts
// 가 잡는다). 'unknown'(협의해서 정할게요)은 담지 않는다 → wishCode = null.
export const DEV_REVIEW_TIMELINE_WISH_CODES = ['within_1m', 'm2_3', 'm4_6', 'over_6m'] as const;
export type DevReviewTimelineWishCodeType = (typeof DEV_REVIEW_TIMELINE_WISH_CODES)[number];

export const DevReviewSchedule = z.object({
  phases: z.array(DevReviewSchedulePhase).max(DEV_REVIEW_SCHEDULE_MAX_PHASES),
  wishCode: z.enum(DEV_REVIEW_TIMELINE_WISH_CODES).nullable(),
  assumptions: z.string().trim().max(300).catch(''), // 일정 전제(고객 자료 회신 3일 이내·시제품 1회전 …)
});
export type DevReviewScheduleType = z.infer<typeof DevReviewSchedule>;

// LLM 출력용 느슨한 버전 — 합계 필드는 아예 받지 않는다(서버가 계산). 깨진 원소는 파서가 버린다.
export const DevReviewScheduleLlm = z.object({
  phases: z.array(z.object({
    name: z.string().trim().max(200).catch(''),
    minWeeks: z.number().int().catch(0),
    maxWeeks: z.number().int().catch(0),
    output: z.string().trim().max(400).catch(''),
    prerequisite: z.string().trim().max(400).catch(''),
    note: z.string().trim().max(400).catch(''),
  })).max(20).catch([]),
  assumptions: z.string().trim().max(1000).catch(''),
});
export type DevReviewScheduleLlmType = z.infer<typeof DevReviewScheduleLlm>;

// ── 일정 순수 함수(화면·서버 공용) ────────────────────────────────────────────────
export interface DevReviewScheduleTotals { minWeeks: number; maxWeeks: number }

/** 단계 합 — 저장하지 않는 파생값. 표시하는 자리마다 이 함수를 쓴다. */
export function devReviewScheduleTotals(schedule: DevReviewScheduleType | null | undefined): DevReviewScheduleTotals {
  const phases = schedule?.phases ?? [];
  return {
    minWeeks: phases.reduce((sum, p) => sum + p.minWeeks, 0),
    maxWeeks: phases.reduce((sum, p) => sum + p.maxWeeks, 0),
  };
}

/** 희망 완료 시점의 상한(주) — 'over_6m' 은 상한 없음(null). */
export const DEV_REVIEW_TIMELINE_WISH_LIMIT_WEEKS: Readonly<Record<DevReviewTimelineWishCodeType, number | null>> = {
  within_1m: 4,
  m2_3: 13,
  m4_6: 26,
  over_6m: null,
};

export type DevReviewScheduleFitStatus = 'ok' | 'tight' | 'over' | 'unknown';
export interface DevReviewScheduleFit {
  status: DevReviewScheduleFitStatus;
  wishLabel: string;
  text: string;
}

const timelineWishLabel = (code: DevReviewTimelineWishCodeType): string =>
  marketQuestion('timeline')?.options.find((o) => o.code === code)?.label ?? code;

/**
 * 고객 희망 완료 시점 ↔ 예상 일정 대조 — **LLM 판단이 아니라 순수 함수**다.
 * 상한 없음 → ok · 최대 ≤ 상한 → ok · 최소 ≤ 상한 < 최대 → tight · 최소 > 상한 → over.
 */
export function devReviewScheduleFit(schedule: DevReviewScheduleType | null | undefined): DevReviewScheduleFit {
  const { minWeeks, maxWeeks } = devReviewScheduleTotals(schedule);
  const span = `예상 ${String(minWeeks)}~${String(maxWeeks)}주`;
  const wishCode = schedule?.wishCode ?? null;
  if (wishCode === null) {
    return { status: 'unknown', wishLabel: '', text: `희망 완료 시점 미응답 — ${span}` };
  }
  const wishLabel = timelineWishLabel(wishCode);
  const head = `희망 "${wishLabel}" ↔ ${span}`;
  const limit = DEV_REVIEW_TIMELINE_WISH_LIMIT_WEEKS[wishCode];
  if (limit === null) return { status: 'ok', wishLabel, text: `${head} — 희망 시점에 여유가 있습니다` };
  if (maxWeeks <= limit) return { status: 'ok', wishLabel, text: `${head} — 희망 시점 안에 듭니다` };
  if (minWeeks <= limit) {
    return { status: 'tight', wishLabel, text: `${head} — 최대 기준으로 넘어갈 수 있습니다(단계 조정·병행 필요)` };
  }
  return { status: 'over', wishLabel, text: `${head} — 희망 시점을 넘습니다(범위를 함께 조정해야 합니다)` };
}

/**
 * 고객이 고른 완료 시점 — 공통 조건 'timeline' 의 첫 선택지가 4종 중 하나일 때만.
 * '협의해서 정할게요'(unknown)·미응답은 null 이고 대조가 'unknown' 으로 난다.
 * 후처리(서버)와 관리자 편집기(화면)가 같은 함수를 써야 wishCode 가 갈리지 않는다.
 */
export function devReviewTimelineWishCode(
  answers: readonly MarketAnswerTypeForWish[],
): DevReviewTimelineWishCodeType | null {
  const choice = answers.find((a) => a.code === 'timeline')?.choices[0];
  if (choice === undefined) return null;
  return DEV_REVIEW_TIMELINE_WISH_CODES.find((c) => c === choice) ?? null;
}
interface MarketAnswerTypeForWish { readonly code: string; readonly choices: readonly string[] }

export const DEV_REVIEW_SCHEDULE_CAPTION =
  '이 일정은 자료만으로 낸 예상입니다. 확정 일정은 견적서의 기간을 따릅니다.';

// ── LLM 출력 / 저장 검토서 ──────────────────────────────────────────────────
export const DevReviewLlmOutput = z.object({
  summary: z.string().trim().max(200).catch(''),
  requirements: z.array(DevReviewFact).max(5),
  areas: z.array(DevReviewAreaReview).max(MARKET_AREAS.length),
  openQuestions: z.array(DevReviewOpenQuestion).max(6),
  // 개발의뢰 전용(features.schedule) — 마켓 실행에선 모델이 내지 않고 후처리도 넣지 않는다.
  schedule: DevReviewScheduleLlm.optional(),
});
export type DevReviewLlmOutputType = z.infer<typeof DevReviewLlmOutput>;

export const DevReviewMeta = z.object({
  jobId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  inputHash: z.string(),
  generatedAt: z.string(), // ISO
  attachmentFiles: z.array(z.string().max(300)).max(20),
  // 개발의뢰 관리자 편집 흔적(additive) — 마켓 저장분엔 없다.
  editedAt: z.string().nullable().optional(),
  editedBy: z.string().max(191).nullable().optional(),
});
export type DevReviewMetaType = z.infer<typeof DevReviewMeta>;

export const MarketDevReview = z.object({
  version: z.literal(DEV_REVIEW_VERSION), // 옛 버전 저장분은 파싱 실패 → 검토서 없음으로 취급(재생성)
  brief: z.object({
    serviceAreas: z.array(MarketAreaCodeLoose).min(1).max(MARKET_AREAS.length + 4),
    answers: MarketAnswers,
  }),
  summary: z.string().max(200),
  requirements: z.array(DevReviewFact).max(5),
  areas: z.array(DevReviewAreaReview).max(MARKET_AREAS.length + 4),
  openQuestions: z.array(DevReviewOpenQuestion).max(6),
  checks: z.array(DevReviewCheck).max(4).catch([]),
  meta: DevReviewMeta,
  // 개발의뢰 담당자 의견 블록(자유 서술, 줄바꿈 유지) — 공용 뷰어가 있으면 마지막 섹션으로 그린다(additive).
  adminComment: z.string().trim().max(4000).nullable().optional(),
  // 개발의뢰 개발 일정(예상) — 마켓 저장분엔 없다. **저장분 읽기는 관대하게**(깨져 있어도 null 로 살려 둔다),
  // 관리자 입력은 엄격하게(develop.ts AdminDevelopReviewPutBody 가 catch 를 벗겨 400 을 낸다).
  schedule: DevReviewSchedule.nullable().optional().catch(null),
});
export type MarketDevReviewType = z.infer<typeof MarketDevReview>;

export const DEV_REVIEW_DISCLAIMER =
  '고객이 적어 주신 내용과 자료만으로 만든 AI 사전 검토입니다. 정해지지 않은 부분은 전문가 상담에서 함께 확정합니다.';

// ── 실행 입력(위저드 → /api/ai/market.dev-review/run multipart payload) ─────────
// 답변은 공통 4문항 + 선택 분야의 분야별 질문(레지스트리 검증). 희망 툴은 검토서 입력이 아니다
// (전문가 힌트라 검토서 근거가 아니고, 바꿔도 검토서가 오래되지 않는다).
export const DevReviewRunPayload = z
  .object({
    title: z.string().trim().min(2).max(200),
    serviceAreas: MarketAreaCodes,
    description: z.string().trim().min(10).max(20000),
    answers: MarketAnswers.default([]),
  })
  .superRefine((p, ctx) => {
    for (const issue of marketAnswerIssues(p.answers, p.serviceAreas)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ['answers'] });
    }
  });
export type DevReviewRunPayloadType = z.infer<typeof DevReviewRunPayload>;

// ── Ollama `format` 용 JSON 스키마 — 위 zod(DevReviewLlmOutput)와 같은 형태 유지 ──
const FACT_JSON_SCHEMA = {
  type: 'object',
  required: ['text', 'evidence'],
  properties: {
    text: { type: 'string' },
    evidence: { type: ['string', 'null'] },
  },
} as const;

const SCHEDULE_JSON_SCHEMA = {
  type: 'object',
  required: ['phases', 'assumptions'],
  properties: {
    phases: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'minWeeks', 'maxWeeks', 'output', 'prerequisite', 'note'],
        properties: {
          name: { type: 'string' },
          minWeeks: { type: 'integer' },
          maxWeeks: { type: 'integer' },
          output: { type: 'string' },
          prerequisite: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    assumptions: { type: 'string' },
  },
} as const;

export const DEV_REVIEW_LLM_JSON_SCHEMA = {
  type: 'object',
  required: ['summary', 'requirements', 'areas', 'openQuestions'],
  properties: {
    summary: { type: 'string' },
    requirements: { type: 'array', items: FACT_JSON_SCHEMA },
    areas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['area', 'summary', 'spec', 'observations'],
        properties: {
          area: { type: 'string', enum: [...MARKET_AREA_CODES] },
          summary: { type: 'string' },
          spec: {
            type: 'array',
            items: {
              type: 'object',
              required: ['item', 'text', 'evidence'],
              properties: { item: { type: 'string' }, ...FACT_JSON_SCHEMA.properties },
            },
          },
          observations: { type: 'array', items: FACT_JSON_SCHEMA },
        },
      },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'why', 'area'],
        properties: {
          question: { type: 'string' },
          why: { type: 'string' },
          area: { type: 'string', enum: [...MARKET_AREA_CODES, DEV_REVIEW_GENERAL_AREA] },
        },
      },
    },
  },
} as const;

// 개발의뢰용 — 위 스키마에 개발 일정 블록을 더한 것. `required` 에 schedule 을 넣어 모델이 항상 내게 한다.
// 마켓은 DEV_REVIEW_LLM_JSON_SCHEMA 를 그대로 쓴다(바이트 무변경).
export const DEV_REVIEW_LLM_JSON_SCHEMA_WITH_SCHEDULE = {
  ...DEV_REVIEW_LLM_JSON_SCHEMA,
  required: [...DEV_REVIEW_LLM_JSON_SCHEMA.required, 'schedule'],
  properties: { ...DEV_REVIEW_LLM_JSON_SCHEMA.properties, schedule: SCHEDULE_JSON_SCHEMA },
} as const;
