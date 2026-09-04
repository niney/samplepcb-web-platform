import { z } from 'zod';
import {
  MARKET_AREAS,
  MARKET_AREA_CODES,
  MarketAnswers,
  MarketAreaCodeLoose,
  MarketAreaCodes,
  marketAnswerIssues,
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

// ── LLM 출력 / 저장 검토서 ──────────────────────────────────────────────────
export const DevReviewLlmOutput = z.object({
  summary: z.string().trim().max(200).catch(''),
  requirements: z.array(DevReviewFact).max(5),
  areas: z.array(DevReviewAreaReview).max(MARKET_AREAS.length),
  openQuestions: z.array(DevReviewOpenQuestion).max(6),
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
