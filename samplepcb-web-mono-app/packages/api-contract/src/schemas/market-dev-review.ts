import { z } from 'zod';
import { MARKET_ACTIVE_SERVICE_AREAS } from './market';

// ── AI 사전 검토서 v2 (docs/AI_DEV_REVIEW.md §12, 2026-09-02) ─────────────────
// 재능마켓 의뢰의 단일 AI 산출물. 고객·전문가·관리자가 같은 JSON 을 같은 뷰로 본다.
// v2 는 "확정된 것만" 담는다 — 항목마다 근거(고객 원문 인용)가 붙고, 근거가 코퍼스에
// 없거나 자료에 없는 수치·품번을 품은 항목은 서버 후처리(apps/api lib/ai/dev-review.ts)가
// **삭제**한다(v1 의 확정/확인 필요 2상태·강등은 사라졌다). 정해지지 않은 것은
// "전문가와 상의할 항목"(≤6) 한 목록으로만 남는다. 가격·주수·판정어·리스크 등급 없음.

export const DEV_REVIEW_AREAS = MARKET_ACTIVE_SERVICE_AREAS;
export const DevReviewArea = z.enum(DEV_REVIEW_AREAS);
export type DevReviewAreaType = z.infer<typeof DevReviewArea>;

// ── 질문 — 활성 4문항(위저드 1단계에 인라인), 옛 9문항 코드는 읽기 호환 ───────────
// v1 의 9문항 중 전원·통신·인증·제약·결과물 문항은 비전문가 의뢰자가 답하기 어려워 뺐다
// (설명에 적었으면 검토서가 쓰고, 없으면 전문가와 상의할 항목으로 흐른다). 저장된 옛
// 답변(interviewAnswers·검토서 brief)을 그대로 보여주기 위해 사전은 9개를 유지한다.
export const DEV_REVIEW_QUESTION_CODES = [
  'stage', 'deliverables', 'quantity', 'power', 'connectivity',
  'external', 'constraints', 'certification', 'timeline',
] as const;
export const DevReviewQuestionCode = z.enum(DEV_REVIEW_QUESTION_CODES);
export type DevReviewQuestionCodeType = z.infer<typeof DevReviewQuestionCode>;
export const DEV_REVIEW_ACTIVE_QUESTION_CODES = ['stage', 'quantity', 'external', 'timeline'] as const;
export type DevReviewActiveQuestionCodeType = (typeof DEV_REVIEW_ACTIVE_QUESTION_CODES)[number];
export const DEV_REVIEW_UNKNOWN_CHOICE = 'unknown';
export const DEV_REVIEW_UNKNOWN_LABEL = '잘 모르겠어요';

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
    code: 'stage', label: '지금 어떤 상태인가요?', short: '현재 상태', multi: false,
    options: withUnknown([
      { code: 'idea', label: '아이디어만 있어요' },
      { code: 'spec', label: '원하는 기능을 정리한 자료가 있어요' },
      { code: 'schematic', label: '회로도가 있어요' },
      { code: 'pcb', label: 'PCB 설계 파일이 있어요' },
      { code: 'production', label: '이미 만든 제품을 고치고 싶어요' },
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
    code: 'quantity', label: '몇 개나 필요한가요?', short: '수량', multi: false,
    options: withUnknown([
      { code: 'proto_1_10', label: '시제품 1~10개' },
      { code: 'proto_11_100', label: '11~100개' },
      { code: 'mass', label: '양산(대량 생산) 예정' },
    ]),
    notePlaceholder: '예: 먼저 3개, 이후 월 200개',
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
    code: 'external', label: '함께 쓰는 것이 있나요?', short: '함께 쓰는 것', multi: true,
    options: withUnknown([
      { code: 'none', label: '없어요(장치 단독)' },
      { code: 'mobile_app', label: '스마트폰 앱' },
      { code: 'server_cloud', label: '서버·웹(클라우드)' },
      { code: 'pc_software', label: 'PC 프로그램' },
      { code: 'existing_device', label: '기존 장비·설비' },
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
    code: 'timeline', label: '언제까지 필요한가요?', short: '목표 시점', multi: false,
    options: withUnknown([
      { code: 'asap', label: '가능한 빨리' },
      { code: 'within_1m', label: '1개월 안' },
      { code: 'within_3m', label: '3개월 안' },
      { code: 'flexible', label: '여유 있어요' },
    ]),
    notePlaceholder: '예: 10월 전시회 전까지',
  },
];

export const DEV_REVIEW_QUESTION_MAP: Readonly<Record<DevReviewQuestionCodeType, DevReviewQuestion>> =
  Object.fromEntries(DEV_REVIEW_QUESTIONS.map((q) => [q.code, q])) as Record<DevReviewQuestionCodeType, DevReviewQuestion>;

// 위저드·실행 payload 가 쓰는 활성 문항(사전 순서 유지).
export const DEV_REVIEW_ACTIVE_QUESTIONS: readonly DevReviewQuestion[] = DEV_REVIEW_QUESTIONS.filter((q) =>
  (DEV_REVIEW_ACTIVE_QUESTION_CODES as readonly string[]).includes(q.code),
);
export const isDevReviewActiveQuestionCode = (code: string): code is DevReviewActiveQuestionCodeType =>
  (DEV_REVIEW_ACTIVE_QUESTION_CODES as readonly string[]).includes(code);

export const DevReviewAnswer = z.object({
  code: DevReviewQuestionCode,
  choices: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  note: z.string().trim().max(500).optional(),
});
export type DevReviewAnswerType = z.infer<typeof DevReviewAnswer>;

// 답변 묶음(읽기 호환 — 옛 9문항 코드 허용) — 코드 중복·미지 선택지·단일 선택 위반·메모 필수
// 위반을 거부한다.
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

// 신규 입력(실행 payload·의뢰 등록)은 활성 4문항만 받는다.
export const DevReviewActiveAnswers = DevReviewAnswers.superRefine((answers, ctx) => {
  answers.forEach((answer, index) => {
    if (!isDevReviewActiveQuestionCode(answer.code)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INACTIVE_QUESTION', path: [index, 'code'] });
    }
  });
});

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

export const DevReviewAreaReview = z.object({
  area: DevReviewArea,
  summary: z.string().trim().max(160).catch(''), // 이 분야에서 무엇을 구현하는지 한 줄
  spec: z.array(DevReviewSpecRow).max(6),
});
export type DevReviewAreaReviewType = z.infer<typeof DevReviewAreaReview>;

export const DevReviewOpenQuestion = z.object({
  question: z.string().trim().min(1).max(120),
  why: z.string().trim().max(120).catch(''),
});
export type DevReviewOpenQuestionType = z.infer<typeof DevReviewOpenQuestion>;

// ── 제안 시스템 구성도 — 입력 → 메인 보드 → 출력·연동 3열 고정 레이아웃 ──────────
// 그룹·id·연결 그래프(v1 DiagramSpec)를 버리고, 렌더러(@sp/utils renderDevReviewDiagramHtml)가
// 3열 카드로 고정 배치한다. LLM 은 카드 내용만 쓴다 — 구조 결함(끊긴 참조)이 생길 수 없다.
export const DEV_REVIEW_DIAGRAM_ICONS = [
  'sensor', 'signal', 'power', 'button', 'display', 'motor', 'relay', 'wireless',
  'phone', 'cloud', 'pc', 'device', 'chip', 'storage', 'other',
] as const;
export const DevReviewDiagramIcon = z.enum(DEV_REVIEW_DIAGRAM_ICONS);
export type DevReviewDiagramIconType = z.infer<typeof DevReviewDiagramIcon>;

export const DevReviewDiagramNode = z.object({
  label: z.string().trim().min(1).max(30),
  detail: z.string().trim().max(40).catch(''),
  icon: DevReviewDiagramIcon.catch('other'),
  // 미정 — 고객이 "종류·방식은 정하지 않았다"고 말한 항목만(모델 판단 아님). 렌더러가 점선+미정 표시.
  tbd: z.boolean().catch(false),
});
export type DevReviewDiagramNodeType = z.infer<typeof DevReviewDiagramNode>;

export const DEV_REVIEW_DIAGRAM_DEFAULT_COLUMNS = { inputs: '입력', board: '메인 보드', outputs: '출력·연동' } as const;

export const DevReviewDiagram = z.object({
  columns: z
    .object({
      inputs: z.string().trim().max(16).catch(DEV_REVIEW_DIAGRAM_DEFAULT_COLUMNS.inputs),
      board: z.string().trim().max(16).catch(DEV_REVIEW_DIAGRAM_DEFAULT_COLUMNS.board),
      outputs: z.string().trim().max(16).catch(DEV_REVIEW_DIAGRAM_DEFAULT_COLUMNS.outputs),
    })
    .catch({ ...DEV_REVIEW_DIAGRAM_DEFAULT_COLUMNS }),
  inputs: z.array(DevReviewDiagramNode).max(5).catch([]),
  board: z
    .object({
      label: z.string().trim().min(1).max(30).catch('메인 컨트롤러'),
      detail: z.string().trim().max(40).catch(''),
      chips: z.array(z.string().trim().min(1).max(16)).max(8).catch([]),
      tbd: z.boolean().catch(false), // 보드·부품이 미정이라고 고객이 말한 경우
    })
    .catch({ label: '메인 컨트롤러', detail: '', chips: [], tbd: false }),
  outputs: z.array(DevReviewDiagramNode).max(5).catch([]),
  linkIn: z.string().trim().max(24).catch(''), // 입력→보드 연결 라벨(고객 자료에 있는 것만)
  linkOut: z.string().trim().max(24).catch(''), // 보드→출력·연동 연결 라벨
  notes: z
    .object({
      flow: z.string().trim().max(50).catch(''), // 데이터 흐름
      design: z.string().trim().max(50).catch(''), // 핵심 설계
      extension: z.string().trim().max(50).catch(''), // 확장 방향(고객이 말한 것만)
    })
    .catch({ flow: '', design: '', extension: '' }),
});
export type DevReviewDiagramType = z.infer<typeof DevReviewDiagram>;

// ── LLM 출력 / 저장 검토서 ──────────────────────────────────────────────────
// LLM 이 반환하는 부분 — 서버 파서는 배열 원소를 개별 검증해 깨진 원소만 버린다.
export const DevReviewLlmOutput = z.object({
  summary: z.string().trim().max(200).catch(''),
  requirements: z.array(DevReviewFact).max(5),
  diagram: DevReviewDiagram,
  areas: z.array(DevReviewAreaReview).max(3),
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
});
export type DevReviewMetaType = z.infer<typeof DevReviewMeta>;

export const DEV_REVIEW_VERSION = 2 as const;

export const MarketDevReview = z.object({
  version: z.literal(DEV_REVIEW_VERSION), // v1 저장분은 파싱 실패 → 검토서 없음으로 취급(재생성)
  brief: z.object({
    serviceAreas: z.array(DevReviewArea).min(1).max(DEV_REVIEW_AREAS.length),
    answers: DevReviewAnswers,
  }),
  summary: z.string().max(200),
  requirements: z.array(DevReviewFact).max(5),
  diagram: DevReviewDiagram,
  areas: z.array(DevReviewAreaReview).max(3),
  openQuestions: z.array(DevReviewOpenQuestion).max(6),
  meta: DevReviewMeta,
});
export type MarketDevReviewType = z.infer<typeof MarketDevReview>;

export const DEV_REVIEW_DISCLAIMER =
  '고객이 적어 주신 내용과 자료만으로 만든 AI 사전 검토입니다. 정해지지 않은 부분은 전문가 상담에서 함께 확정합니다.';

// ── 실행 입력(위저드 → /api/ai/market.dev-review/run multipart payload) ─────────
export const DevReviewRunPayload = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(DevReviewArea).min(1).max(DEV_REVIEW_AREAS.length),
  description: z.string().trim().min(10).max(20000),
  answers: DevReviewActiveAnswers,
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

const NODE_JSON_SCHEMA = {
  type: 'object',
  required: ['label', 'detail', 'icon', 'tbd'],
  properties: {
    label: { type: 'string' },
    detail: { type: 'string' },
    icon: { type: 'string', enum: [...DEV_REVIEW_DIAGRAM_ICONS] },
    tbd: { type: 'boolean' },
  },
} as const;

export const DEV_REVIEW_LLM_JSON_SCHEMA = {
  type: 'object',
  required: ['summary', 'requirements', 'diagram', 'areas', 'openQuestions'],
  properties: {
    summary: { type: 'string' },
    requirements: { type: 'array', items: FACT_JSON_SCHEMA },
    diagram: {
      type: 'object',
      required: ['columns', 'inputs', 'board', 'outputs', 'linkIn', 'linkOut', 'notes'],
      properties: {
        columns: {
          type: 'object',
          required: ['inputs', 'board', 'outputs'],
          properties: { inputs: { type: 'string' }, board: { type: 'string' }, outputs: { type: 'string' } },
        },
        inputs: { type: 'array', items: NODE_JSON_SCHEMA },
        board: {
          type: 'object',
          required: ['label', 'detail', 'chips', 'tbd'],
          properties: {
            label: { type: 'string' },
            detail: { type: 'string' },
            chips: { type: 'array', items: { type: 'string' } },
            tbd: { type: 'boolean' },
          },
        },
        outputs: { type: 'array', items: NODE_JSON_SCHEMA },
        linkIn: { type: 'string' },
        linkOut: { type: 'string' },
        notes: {
          type: 'object',
          required: ['flow', 'design', 'extension'],
          properties: { flow: { type: 'string' }, design: { type: 'string' }, extension: { type: 'string' } },
        },
      },
    },
    areas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['area', 'summary', 'spec'],
        properties: {
          area: { type: 'string', enum: [...DEV_REVIEW_AREAS] },
          summary: { type: 'string' },
          spec: {
            type: 'array',
            items: {
              type: 'object',
              required: ['item', 'text', 'evidence'],
              properties: { item: { type: 'string' }, ...FACT_JSON_SCHEMA.properties },
            },
          },
        },
      },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'why'],
        properties: { question: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
} as const;
