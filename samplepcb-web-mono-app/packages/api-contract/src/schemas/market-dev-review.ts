import { z } from 'zod';
import { DIAGRAM_SPEC_JSON_SCHEMA, DiagramSpec } from './diagram-spec';
import { MARKET_ACTIVE_SERVICE_AREAS } from './market';

// ── AI 사전 검토서 (docs/AI_DEV_REVIEW.md) ───────────────────────────────────
// 재능마켓 의뢰의 단일 AI 산출물. 고객·전문가·관리자가 같은 JSON 을 같은 뷰로 본다.
// 항목은 확정(confirmed)/확인 필요(needs_confirmation) 2상태 — 근거(고객 원문 인용) 없는
// 확정은 서버 후처리(apps/api lib/ai/dev-review.ts)가 강등·삭제한다. 가격·주수·판정어 없음.

export const DEV_REVIEW_AREAS = MARKET_ACTIVE_SERVICE_AREAS;
export const DevReviewArea = z.enum(DEV_REVIEW_AREAS);
export type DevReviewAreaType = z.infer<typeof DevReviewArea>;

// ── 질문 9문항 — 고정, 한 화면, 전부 "잘 모르겠어요" 탈출구 ────────────────────
export const DEV_REVIEW_QUESTION_CODES = [
  'stage', 'deliverables', 'quantity', 'power', 'connectivity',
  'external', 'constraints', 'certification', 'timeline',
] as const;
export const DevReviewQuestionCode = z.enum(DEV_REVIEW_QUESTION_CODES);
export type DevReviewQuestionCodeType = z.infer<typeof DevReviewQuestionCode>;
export const DEV_REVIEW_UNKNOWN_CHOICE = 'unknown';
export const DEV_REVIEW_UNKNOWN_LABEL = '잘 모르겠어요 — 전문가와 상의';

export interface DevReviewQuestionOption {
  readonly code: string;
  readonly label: string;
}
export interface DevReviewQuestion {
  readonly code: DevReviewQuestionCodeType;
  readonly label: string; // 질문 문장
  readonly short: string; // 브리프 행 라벨
  readonly multi: boolean;
  readonly options: readonly DevReviewQuestionOption[]; // unknown 은 자동 부착
  readonly notePlaceholder?: string;
  readonly noteRequiredFor?: readonly string[]; // 이 선택지를 고르면 메모 필수
}

const withUnknown = (options: readonly DevReviewQuestionOption[]): readonly DevReviewQuestionOption[] => [
  ...options,
  { code: DEV_REVIEW_UNKNOWN_CHOICE, label: DEV_REVIEW_UNKNOWN_LABEL },
];

export const DEV_REVIEW_QUESTIONS: readonly DevReviewQuestion[] = [
  {
    code: 'stage', label: '현재 어느 단계인가요?', short: '현재 단계', multi: false,
    options: withUnknown([
      { code: 'idea', label: '아이디어·요구사항만 있음' },
      { code: 'spec', label: '사양서·블록도가 있음' },
      { code: 'schematic', label: '회로도가 있음' },
      { code: 'pcb', label: 'PCB 설계본이 있음' },
      { code: 'production', label: '양산 중인 제품의 개선·재설계' },
    ]),
  },
  {
    code: 'deliverables', label: '어떤 결과물을 받고 싶나요?', short: '원하는 결과물', multi: true,
    options: withUnknown([
      { code: 'schematic', label: '회로도' },
      { code: 'bom', label: 'BOM(부품 목록)' },
      { code: 'artwork', label: 'PCB 아트웍·거버' },
      { code: 'prototype', label: '시제품 조립·검증' },
      { code: 'firmware', label: '펌웨어 소스·바이너리' },
      { code: 'docs', label: '제작사양서·시험 기록' },
    ]),
  },
  {
    code: 'quantity', label: '필요한 수량은 어느 정도인가요?', short: '수량', multi: false,
    options: withUnknown([
      { code: 'proto_1_10', label: '시제품 1~10대' },
      { code: 'proto_11_100', label: '11~100대' },
      { code: 'mass', label: '양산 예정' },
    ]),
    notePlaceholder: '예: 1차 5대, 이후 월 200대',
  },
  {
    code: 'power', label: '전원은 어떻게 공급되나요?', short: '전원', multi: true,
    options: withUnknown([
      { code: 'battery', label: '배터리' },
      { code: 'usb', label: 'USB' },
      { code: 'adapter_dc', label: 'DC 어댑터' },
      { code: 'mains_ac', label: '상용 AC 전원' },
      { code: 'industrial_24v', label: '산업용 24V' },
      { code: 'poe', label: 'PoE(이더넷 전원)' },
    ]),
    notePlaceholder: '예: 12V 어댑터, 3.7V 리튬 배터리',
  },
  {
    code: 'connectivity', label: '통신·연결 방식은 무엇인가요?', short: '통신·연결', multi: true,
    options: withUnknown([
      { code: 'none', label: '없음(단독 동작)' },
      { code: 'ble', label: 'Bluetooth(BLE)' },
      { code: 'wifi', label: 'Wi-Fi' },
      { code: 'lte', label: 'LTE·셀룰러' },
      { code: 'ethernet', label: '유선 이더넷' },
      { code: 'usb', label: 'USB' },
      { code: 'rs485_rs232', label: 'RS-485 / RS-232' },
      { code: 'can', label: 'CAN' },
      { code: 'lora', label: 'LoRa·Sub-GHz' },
    ]),
  },
  {
    code: 'external', label: '함께 동작하는 외부 시스템이 있나요?', short: '외부 연동', multi: true,
    options: withUnknown([
      { code: 'none', label: '없음' },
      { code: 'mobile_app', label: '스마트폰 앱' },
      { code: 'server_cloud', label: '서버·클라우드' },
      { code: 'pc_software', label: 'PC 프로그램' },
      { code: 'existing_device', label: '기존 장비·PLC' },
    ]),
  },
  {
    code: 'constraints', label: '크기·설치 환경 제약이 있나요?', short: '크기·환경 제약', multi: false,
    options: withUnknown([
      { code: 'none', label: '특별한 제약 없음' },
      { code: 'has', label: '있음(아래에 적어 주세요)' },
    ]),
    notePlaceholder: '예: 80×50mm 이내, 옥외 -20~60°C, 방수 필요',
    noteRequiredFor: ['has'],
  },
  {
    code: 'certification', label: '필요한 인증·규격이 있나요?', short: '인증·규격', multi: true,
    options: withUnknown([
      { code: 'none', label: '없음' },
      { code: 'kc', label: 'KC' },
      { code: 'ce_fcc', label: 'CE / FCC' },
      { code: 'ul', label: 'UL' },
      { code: 'medical_auto', label: '의료·자동차 규격' },
    ]),
  },
  {
    code: 'timeline', label: '목표 시점은 언제인가요?', short: '목표 시점', multi: false,
    options: withUnknown([
      { code: 'asap', label: '가능한 빨리' },
      { code: 'within_1m', label: '1개월 이내' },
      { code: 'within_3m', label: '3개월 이내' },
      { code: 'flexible', label: '여유 있음' },
    ]),
    notePlaceholder: '예: 10월 전시회 전까지 시제품',
  },
];

export const DEV_REVIEW_QUESTION_MAP: Readonly<Record<DevReviewQuestionCodeType, DevReviewQuestion>> =
  Object.fromEntries(DEV_REVIEW_QUESTIONS.map((q) => [q.code, q])) as Record<DevReviewQuestionCodeType, DevReviewQuestion>;

export const DevReviewAnswer = z.object({
  code: DevReviewQuestionCode,
  choices: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  note: z.string().trim().max(500).optional(),
});
export type DevReviewAnswerType = z.infer<typeof DevReviewAnswer>;

// 답변 묶음 — 코드 중복·미지 선택지·단일 선택 위반·메모 필수 위반을 거부한다.
export const DevReviewAnswers = z
  .array(DevReviewAnswer)
  .max(DEV_REVIEW_QUESTION_CODES.length)
  .superRefine((answers, ctx) => {
    const seen = new Set<string>();
    answers.forEach((answer, index) => {
      if (seen.has(answer.code)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DUPLICATE_CODE', path: [index, 'code'] });
      }
      seen.add(answer.code);
      const question = DEV_REVIEW_QUESTION_MAP[answer.code];
      const valid = new Set(question.options.map((o) => o.code));
      if (answer.choices.some((c) => !valid.has(c))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_CHOICE', path: [index, 'choices'] });
      }
      if (!question.multi && answer.choices.length > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SINGLE_CHOICE', path: [index, 'choices'] });
      }
      const noteRequired = question.noteRequiredFor?.some((c) => answer.choices.includes(c)) ?? false;
      if (noteRequired && (answer.note ?? '') === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NOTE_REQUIRED', path: [index, 'note'] });
      }
    });
  });
export type DevReviewAnswersType = z.infer<typeof DevReviewAnswers>;

export const isDevReviewAnswerUnknown = (answer: DevReviewAnswerType): boolean =>
  answer.choices.length === 1 && answer.choices[0] === DEV_REVIEW_UNKNOWN_CHOICE;

// 선택 라벨(+메모) 문자열 — 브리프 행·프롬프트·근거 코퍼스가 같은 문자열을 쓴다.
export function devReviewAnswerText(answer: DevReviewAnswerType): string {
  const question = DEV_REVIEW_QUESTION_MAP[answer.code];
  const labels = answer.choices
    .map((c) => question.options.find((o) => o.code === c)?.label ?? c)
    .join(', ');
  const note = answer.note?.trim() ?? '';
  return note === '' ? labels : `${labels} (${note})`;
}

// ── 검토서 항목 ─────────────────────────────────────────────────────────────
export const DEV_REVIEW_ITEM_STATUSES = ['confirmed', 'needs_confirmation'] as const;
export const DevReviewItemStatus = z.enum(DEV_REVIEW_ITEM_STATUSES);
export type DevReviewItemStatusType = z.infer<typeof DevReviewItemStatus>;

const nullableShort = (max: number) => z.string().trim().max(max).nullable().catch(null);

export const GroundedItem = z.object({
  text: z.string().trim().min(1).max(300),
  status: DevReviewItemStatus.catch('needs_confirmation'),
  evidence: nullableShort(200), // 고객 원문 인용(확정의 근거) — 후처리가 코퍼스 대조
  question: nullableShort(200), // 확인 필요 시 고객에게 물을 한 문장
  why: nullableShort(200), // 왜 필요한지 한 문장
});
export type GroundedItemType = z.infer<typeof GroundedItem>;

export const DevReviewRisk = z.object({
  text: z.string().trim().min(1).max(300),
  evidence: nullableShort(200),
});
export type DevReviewRiskType = z.infer<typeof DevReviewRisk>;

// 개발명세서 행 = 항목명 + GroundedItem(평면) — 중첩 객체는 모델이 문자열로 뭉개는 것이 프로빙 실측.
export const DevReviewSpecRow = GroundedItem.extend({
  item: z.string().trim().min(1).max(60),
});
export type DevReviewSpecRowType = z.infer<typeof DevReviewSpecRow>;

export const DevReviewAreaReview = z.object({
  area: DevReviewArea,
  scope: z.array(GroundedItem).max(8),
  risks: z.array(DevReviewRisk).max(6),
  spec: z.array(DevReviewSpecRow).max(15),
});
export type DevReviewAreaReviewType = z.infer<typeof DevReviewAreaReview>;

export const DevReviewOpenQuestion = z.object({
  topic: z.string().trim().max(60).catch(''),
  question: z.string().trim().min(1).max(200),
  why: z.string().trim().max(200).catch(''),
  area: DevReviewArea.nullable().catch(null),
});
export type DevReviewOpenQuestionType = z.infer<typeof DevReviewOpenQuestion>;

// LLM 이 반환하는 부분 — 서버 파서는 배열 원소를 개별 검증해 깨진 원소만 버린다.
export const DevReviewLlmOutput = z.object({
  summary: z.string().trim().max(300).catch(''),
  requirements: z.array(GroundedItem).max(8),
  diagram: DiagramSpec,
  areas: z.array(DevReviewAreaReview).max(3),
  openQuestions: z.array(DevReviewOpenQuestion).max(15),
});
export type DevReviewLlmOutputType = z.infer<typeof DevReviewLlmOutput>;

export const DevReviewMeta = z.object({
  jobId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  inputHash: z.string(),
  generatedAt: z.string(), // ISO
  attachmentFiles: z.array(z.string().max(300)).max(20),
});
export type DevReviewMetaType = z.infer<typeof DevReviewMeta>;

export const DevReviewStats = z.object({
  confirmed: z.number().int().nonnegative(),
  needsConfirmation: z.number().int().nonnegative(),
});
export type DevReviewStatsType = z.infer<typeof DevReviewStats>;

export const MarketDevReview = z.object({
  version: z.literal(1),
  brief: z.object({
    serviceAreas: z.array(DevReviewArea).min(1).max(DEV_REVIEW_AREAS.length),
    answers: DevReviewAnswers,
  }),
  summary: z.string().max(300),
  requirements: z.array(GroundedItem).max(8),
  diagram: DiagramSpec,
  areas: z.array(DevReviewAreaReview).max(3),
  openQuestions: z.array(DevReviewOpenQuestion).max(20), // ③④ 확인 필요 + LLM 제안 병합본
  meta: DevReviewMeta,
  stats: DevReviewStats,
});
export type MarketDevReviewType = z.infer<typeof MarketDevReview>;

export const DEV_REVIEW_DISCLAIMER =
  "고객이 제공한 자료에 근거한 AI 사전 검토입니다. '확인 필요' 항목은 전문가 상담에서 확정됩니다.";

// ── 실행 입력(위저드 → /api/ai/market.dev-review/run multipart payload) ─────────
export const DevReviewRunPayload = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(DevReviewArea).min(1).max(DEV_REVIEW_AREAS.length),
  description: z.string().trim().min(10).max(20000),
  answers: DevReviewAnswers,
});
export type DevReviewRunPayloadType = z.infer<typeof DevReviewRunPayload>;

// ── Ollama `format` 용 JSON 스키마 — 위 zod(DevReviewLlmOutput)와 같은 형태 유지 ──
const GROUNDED_ITEM_JSON_SCHEMA = {
  type: 'object',
  required: ['text', 'status', 'evidence', 'question', 'why'],
  properties: {
    text: { type: 'string' },
    status: { type: 'string', enum: [...DEV_REVIEW_ITEM_STATUSES] },
    evidence: { type: ['string', 'null'] },
    question: { type: ['string', 'null'] },
    why: { type: ['string', 'null'] },
  },
} as const;

export const DEV_REVIEW_LLM_JSON_SCHEMA = {
  type: 'object',
  required: ['summary', 'requirements', 'diagram', 'areas', 'openQuestions'],
  properties: {
    summary: { type: 'string' },
    requirements: { type: 'array', items: GROUNDED_ITEM_JSON_SCHEMA },
    diagram: DIAGRAM_SPEC_JSON_SCHEMA,
    areas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['area', 'scope', 'risks', 'spec'],
        properties: {
          area: { type: 'string', enum: [...DEV_REVIEW_AREAS] },
          scope: { type: 'array', items: GROUNDED_ITEM_JSON_SCHEMA },
          risks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text', 'evidence'],
              properties: { text: { type: 'string' }, evidence: { type: ['string', 'null'] } },
            },
          },
          spec: {
            type: 'array',
            items: {
              type: 'object',
              required: ['item', ...GROUNDED_ITEM_JSON_SCHEMA.required],
              properties: { item: { type: 'string' }, ...GROUNDED_ITEM_JSON_SCHEMA.properties },
            },
          },
        },
      },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['topic', 'question', 'why', 'area'],
        properties: {
          topic: { type: 'string' },
          question: { type: 'string' },
          why: { type: 'string' },
          area: { type: ['string', 'null'], enum: [...DEV_REVIEW_AREAS, null] },
        },
      },
    },
  },
} as const;
