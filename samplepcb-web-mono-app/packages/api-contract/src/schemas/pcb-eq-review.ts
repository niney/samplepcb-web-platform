import { z } from 'zod';

// ── PCB EQ 고객 확인 계약(P4.1) — 정본 docs/PCB_PARTNER_TRACK.md D16 ─────────
// 협력사 EQ(제조 확인 사항)를 **고객에게 물어보는** 축. EQ 전이 머신 옆에 붙으며
// 고객이 승인해도 eq_done 전이는 관리자 몫이다(고객 확인 = 관리자 승인의 근거).
//
// 고객은 발주서를 모른다 — 화면에는 "내 주문의 확인 요청"으로만 보이고 협력사명은
// 어디에도 나오지 않는다("제조사"로 표기). 공개 파일은 관리자가 고른 것만이다.

// 상태 — D20(문항형 회차)이 둘을 더한다:
//  · draft    = 관리자가 문항을 다듬는 중(고객에게 안 보이고 배지에도 안 든다)
//  · answered = 고객이 문항별로 회신하고 "이 답변대로 제작 진행"에 동의했다
// approved/rejected 는 D16 문구형(format='message')의 결정이다 — 문항형에는 통째 반려가 없고
// 반대 뜻은 문항마다 선택지·의견으로 말한다.
export const PCB_EQ_REVIEW_STATUSES = [
  'draft',
  'requested',
  'answered',
  'approved',
  'rejected',
  'canceled',
] as const;
export type PcbEqReviewStatusType = (typeof PCB_EQ_REVIEW_STATUSES)[number];
export const PcbEqReviewStatus = z.enum(PCB_EQ_REVIEW_STATUSES);

export const PCB_EQ_REVIEW_STATUS_LABELS = {
  draft: '작성 중',
  requested: '확인 대기',
  answered: '고객 회신',
  approved: '고객 승인',
  rejected: '고객 반려',
  canceled: '요청 취소',
} as const satisfies Record<PcbEqReviewStatusType, string>;

/** 고객이 답한 상태인가(문구형 승인·반려 + 문항형 회신) — 관리자 승인 전 확인창의 판정. */
export const isPcbEqReviewDecided = (s: PcbEqReviewStatusType): boolean =>
  s === 'answered' || s === 'approved' || s === 'rejected';

/** 형식 — message=D16 문구 1개 + 승인/반려 · items=D20 문항별 선택지 회신. */
export const PCB_EQ_REVIEW_FORMATS = ['message', 'items'] as const;
export type PcbEqReviewFormatType = (typeof PCB_EQ_REVIEW_FORMATS)[number];
export const PcbEqReviewFormat = z.enum(PCB_EQ_REVIEW_FORMATS);

/** 고객에게 공개된 첨부 — 관리자가 고른 것만. 협력사명이 든 파일은 애초에 안 담는다. */
export const PcbEqReviewFile = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
});
export type PcbEqReviewFileType = z.infer<typeof PcbEqReviewFile>;

// ── D20 문항형 회차 — 공장 EQ 표(문항 N개 × 선택지 A/B/C × 그림)를 고객이 문항별로 답한다 ──
// 정본 docs/PCB_PARTNER_TRACK.md D20. 회차 = sp_pcb_eq_review 한 행(format='items'),
// 문항 = sp_pcb_eq_review_item. 발주 상태 머신은 건드리지 않는다(D16 ①과 같다).

/** 문항 유형 — 중국 공장 EQ 표의 '问题类型' 12종 + 자주 나오는 4종. 화면 라벨은 아래 사전. */
export const PCB_EQ_ITEM_CATEGORIES = [
  'impedance',
  'marking',
  'pad',
  'soldermask_dam',
  'circuit',
  'via',
  'soldermask',
  'legend',
  'drill',
  'outline',
  'panel',
  'stackup',
  'material',
  'surface_finish',
  'indication',
  'other',
] as const;
export type PcbEqItemCategoryType = (typeof PCB_EQ_ITEM_CATEGORIES)[number];
export const PcbEqItemCategory = z.enum(PCB_EQ_ITEM_CATEGORIES);

export const PCB_EQ_ITEM_CATEGORY_LABELS = {
  impedance: '임피던스',
  marking: '마킹(UL·주기)',
  pad: '패드',
  soldermask_dam: '솔더마스크 댐',
  circuit: '회로 패턴',
  via: '비아 처리',
  soldermask: '솔더마스크',
  legend: '실크(문자)',
  drill: '드릴(홀)',
  outline: '외형',
  panel: '패널(배열)',
  stackup: '적층 구조',
  material: '원자재',
  surface_finish: '표면처리',
  indication: '표기·도면',
  other: '기타',
} as const satisfies Record<PcbEqItemCategoryType, string>;

/** 문항 변화(직전 회차 대비) — 개정 EQ 에서 고객이 바뀐 것만 보면 되게. 첫 회차는 null. */
export const PCB_EQ_ITEM_CHANGES = ['new', 'changed', 'same'] as const;
export type PcbEqItemChangeType = (typeof PCB_EQ_ITEM_CHANGES)[number];
export const PcbEqItemChange = z.enum(PCB_EQ_ITEM_CHANGES);

export const PCB_EQ_ITEM_CHANGE_LABELS = {
  new: '신규',
  changed: '변경',
  same: '동일',
} as const satisfies Record<PcbEqItemChangeType, string>;

/**
 * 선택지 — `key` 는 **공장 원문 기호 그대로**(A/B/C). 협력사는 회신을 이 기호로 읽는다
 * (번역이 어긋나도 "B 를 골랐다"는 사실은 어긋나지 않는다).
 */
export const PcbEqItemOption = z.object({
  key: z.string().trim().min(1).max(4),
  /** 고객에게 보이는 한국어 문구. */
  label: z.string().trim().min(1).max(500),
  /** 공장 원문(중국어·영어) — 관리자·협력사만 본다. */
  labelOrig: z.string().trim().max(1000).nullable(),
  /** 제조사 권장 — 고객 화면 배지. 공장 표의 첫 선택지가 대개 권장안이지만 판정은 사람이 한다. */
  recommended: z.boolean(),
  /** '贵司指示(지시해 주세요)' 류 — 고르면 의견이 필수다. */
  requiresComment: z.boolean(),
});
export type PcbEqItemOptionType = z.infer<typeof PcbEqItemOption>;

/** 문항 초안의 공통 몸통 — AI 분석 결과(PcbEqDraft)와 관리자 편집 입력이 같은 모양이다. */
export const PcbEqDraftItem = z.object({
  /** 공장 원문 번호('1', '2.0' 등) — 협력사 회신서·개정 회차 연결의 키. */
  factoryNo: z.string().trim().max(32).nullable(),
  category: PcbEqItemCategory,
  /** 고객에게 보이는 한국어 질문(번역·다듬은 문장). */
  question: z.string().trim().min(1).max(4000),
  /** 공장 원문 질문 — 관리자·협력사만. */
  questionOrig: z.string().trim().max(8000).nullable(),
  options: z.array(PcbEqItemOption).min(1).max(8),
});
export type PcbEqDraftItemType = z.infer<typeof PcbEqDraftItem>;

/**
 * AI 분석 산출물(D20 P2) — 추출기(셀·그림) → LLM 구조화·번역의 결과. 그림은 LLM 이 아니라
 * 추출기가 꺼내므로 여기엔 **참조**(`figureRefs` = 추출기 이미지 id)만 있다.
 */
export const PcbEqDraft = z.object({
  header: z.object({
    customerPartNo: z.string().nullable(),
    factoryPartNo: z.string().nullable(),
    /** 공장 표의 작성일(YYYY-MM-DD) — 없으면 null. */
    issuedOn: z.string().nullable(),
  }),
  items: z.array(PcbEqDraftItem.extend({ figureRefs: z.array(z.string()).max(10) })).max(60),
});
export type PcbEqDraftType = z.infer<typeof PcbEqDraft>;

/** 문항 그림 — sp_file(refType 'sp_pcb_eq_review'). `shared` 인 것만 고객에게 내려간다. */
export const PcbEqItemFigure = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  shared: z.boolean(),
});
export type PcbEqItemFigureType = z.infer<typeof PcbEqItemFigure>;

/** 고객(또는 대리) 답 — 문항 하나에 하나. */
export const PcbEqItemAnswer = z.object({
  key: z.string(),
  comment: z.string().nullable(),
});
export type PcbEqItemAnswerType = z.infer<typeof PcbEqItemAnswer>;

/** 직전 회차의 같은 문항과 그 답 — 개정 회차에서 "이전 답 유지"의 근거. */
export const PcbEqPrevItem = z.object({
  itemId: z.number(),
  question: z.string(),
  answer: PcbEqItemAnswer.nullable(),
  /** 고른 선택지의 한국어 문구(답이 있을 때). */
  answerLabel: z.string().nullable(),
});
export type PcbEqPrevItemType = z.infer<typeof PcbEqPrevItem>;

/** 관리자 화면 문항 — 원문·전체 그림(공개 여부 포함)·이전 회차 연결을 안다. */
export const AdminPcbEqItem = PcbEqDraftItem.extend({
  id: z.number(),
  seq: z.number().int(),
  figures: z.array(PcbEqItemFigure),
  prevItemId: z.number().nullable(),
  change: PcbEqItemChange.nullable(),
  prev: PcbEqPrevItem.nullable(),
  answer: PcbEqItemAnswer.nullable(),
});
export type AdminPcbEqItemType = z.infer<typeof AdminPcbEqItem>;

/** 고객 화면 문항 — 원문·비공개 그림·공장 원문 선택지는 없다(공급망 미노출). */
export const CustomerPcbEqItem = z.object({
  id: z.number(),
  seq: z.number().int(),
  category: PcbEqItemCategory,
  question: z.string(),
  options: z.array(PcbEqItemOption.omit({ labelOrig: true })),
  figures: z.array(PcbEqReviewFile),
  change: PcbEqItemChange.nullable(),
  prev: PcbEqPrevItem.nullable(),
  answer: PcbEqItemAnswer.nullable(),
});
export type CustomerPcbEqItemType = z.infer<typeof CustomerPcbEqItem>;

/** 협력사 포털 문항 — **전달된 회차만**. 원문·선택지 기호·고객 답(기호+의견)을 본다. */
export const PartnerPcbEqItem = z.object({
  id: z.number(),
  factoryNo: z.string().nullable(),
  category: PcbEqItemCategory,
  questionOrig: z.string().nullable(),
  question: z.string(),
  options: z.array(PcbEqItemOption.pick({ key: true, label: true, labelOrig: true })),
  answer: PcbEqItemAnswer.nullable(),
});
export type PartnerPcbEqItemType = z.infer<typeof PartnerPcbEqItem>;

export const PartnerPcbEqRound = z.object({
  reviewId: z.number(),
  roundNo: z.number().int(),
  answeredAt: z.string().nullable(),
  forwardedAt: z.string(),
  items: z.array(PartnerPcbEqItem),
});
export type PartnerPcbEqRoundType = z.infer<typeof PartnerPcbEqRound>;

// ── 회신 주체·채널·이벤트 ────────────────────────────────────────────────────

export const PCB_EQ_ANSWER_CHANNELS = ['web', 'phone', 'email', 'other'] as const;
export type PcbEqAnswerChannelType = (typeof PCB_EQ_ANSWER_CHANNELS)[number];
export const PcbEqAnswerChannel = z.enum(PCB_EQ_ANSWER_CHANNELS);

export const PCB_EQ_ANSWER_CHANNEL_LABELS = {
  web: '고객 직접(웹)',
  phone: '전화',
  email: '메일',
  other: '기타',
} as const satisfies Record<PcbEqAnswerChannelType, string>;

export const PCB_EQ_REVIEW_EVENT_ACTIONS = [
  'drafted',
  'sent',
  'answered',
  'proxy_answered',
  'forwarded',
  'canceled',
] as const;
export type PcbEqReviewEventActionType = (typeof PCB_EQ_REVIEW_EVENT_ACTIONS)[number];
export const PcbEqReviewEventAction = z.enum(PCB_EQ_REVIEW_EVENT_ACTIONS);

export const PCB_EQ_REVIEW_EVENT_ACTION_LABELS = {
  drafted: '문항 작성 시작',
  sent: '고객에게 발송',
  answered: '고객 회신',
  proxy_answered: '관리자 대리 회신',
  forwarded: '협력사에 전달',
  canceled: '요청 취소',
} as const satisfies Record<PcbEqReviewEventActionType, string>;

export const PcbEqReviewEvent = z.object({
  id: z.number(),
  action: PcbEqReviewEventAction,
  actorRole: z.enum(['customer', 'admin', 'system']),
  actorMbId: z.string().nullable(),
  channel: PcbEqAnswerChannel.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type PcbEqReviewEventType = z.infer<typeof PcbEqReviewEvent>;

/** 발주 행에 싣는 요약 — 모달을 열지 않아도 "보냈는지·답했는지"가 보이게(사용자 결정
 *  2026-08-07). 열린 요청이 있으면 그것, 없으면 마지막 결정. canceled 뿐이면 요약 없음
 *  (=미요청 취급 — 취소했으면 다시 물어봐야 한다). */
export const PcbPoEqReviewSummary = z.object({
  status: PcbEqReviewStatus,
  requestedAt: z.string(),
  dueOn: z.string().nullable(),
  overdue: z.boolean(),
  decidedAt: z.string().nullable(),
  /** 반려 사유 — 행 툴팁이 쓴다(관리자 화면 전용이라 원문 그대로). */
  decisionNote: z.string().nullable(),
  /** D20 — 행 칩 "EQ 2차 · 고객 회신 대기"용. 문구형이면 roundNo null. */
  format: PcbEqReviewFormat,
  roundNo: z.number().int().nullable(),
  /** 문항형 회신을 협력사에 전달한 시각 — 전달 전이면 '전달 필요' 배지. */
  forwardedAt: z.string().nullable(),
});
export type PcbPoEqReviewSummaryType = z.infer<typeof PcbPoEqReviewSummary>;

/** 관리자 화면용 — 발주서 컨텍스트를 안다. */
export const AdminPcbEqReviewView = z.object({
  id: z.number(),
  poId: z.number(),
  specId: z.number(),
  status: PcbEqReviewStatus,
  message: z.string(),
  dueOn: z.string().nullable(),
  files: z.array(PcbEqReviewFile),
  requestedBy: z.string(),
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  /** 기한이 지났는데 아직 답이 없다 — 관리자가 재촉해야 하는 신호. */
  overdue: z.boolean(),
  // ── D20 문항형 ──
  format: PcbEqReviewFormat,
  /** 낙관적 잠금 — 편집·발송·대리 회신은 expectedVersion 을 맞춰야 한다. */
  version: z.number().int(),
  /** 이 발주서의 문항형 회차 중 몇 번째인가(1부터). 문구형은 null. */
  roundNo: z.number().int().nullable(),
  /** 직전 문항형 회차 — 개정 EQ 의 연결. */
  prevReviewId: z.number().nullable(),
  /** 이 회차가 근거로 삼은 협력사 EQ 첨부(sp_pcb_po_eq) id. */
  sourceFileIds: z.array(z.number()),
  items: z.array(AdminPcbEqItem),
  answeredRole: z.enum(['customer', 'admin']).nullable(),
  answerChannel: PcbEqAnswerChannel.nullable(),
  forwardedAt: z.string().nullable(),
  forwardedBy: z.string().nullable(),
  events: z.array(PcbEqReviewEvent),
});
export type AdminPcbEqReviewViewType = z.infer<typeof AdminPcbEqReviewView>;

// ── 관리자: 문항형 회차(D20) ─────────────────────────────────────────────────

/** 초안 만들기 — 열린 회차(draft|requested)가 있으면 409 ALREADY_OPEN. */
export const AdminPcbEqDraftCreateBody = z.object({
  /** 직전 문항형 회차의 문항을 복사해 시작(개정 EQ) — change='same', prevItemId 연결. */
  fromPrevious: z.boolean().default(false),
  /** 근거 EQ 첨부 — 이 발주서의 eq/working 첨부만(서버 검증). */
  sourceFileIds: z.array(z.number().int().positive()).max(20).default([]),
});
export type AdminPcbEqDraftCreateBodyType = z.infer<typeof AdminPcbEqDraftCreateBody>;

/** 문항 편집 입력 — 저장은 **초안 통째 교체**(id 가 있으면 그 문항을 갱신, 없으면 새로, 빠진 건 삭제). */
export const AdminPcbEqItemInput = PcbEqDraftItem.extend({
  id: z.number().int().positive().optional(),
  /** 이 회차에 올린 그림(sp_file id)과 고객 공개 여부. */
  figures: z
    .array(z.object({ fileId: z.number().int().positive(), shared: z.boolean() }))
    .max(10)
    .default([]),
  prevItemId: z.number().int().positive().nullable().default(null),
  change: PcbEqItemChange.nullable().default(null),
});
export type AdminPcbEqItemInputType = z.input<typeof AdminPcbEqItemInput>;

export const AdminPcbEqDraftUpdateBody = z.object({
  expectedVersion: z.number().int().positive(),
  /** 고객에게 보일 머리말(선택) — 비우면 기본 안내문. */
  message: z.string().trim().max(2000).default(''),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  items: z.array(AdminPcbEqItemInput).max(60),
});
export type AdminPcbEqDraftUpdateBodyType = z.input<typeof AdminPcbEqDraftUpdateBody>;

/** 발송·전달·취소처럼 몸통 없이 버전만 맞추는 조작. */
export const AdminPcbEqVersionBody = z.object({
  expectedVersion: z.number().int().positive(),
});
export type AdminPcbEqVersionBodyType = z.infer<typeof AdminPcbEqVersionBody>;

/** 문항별 답 입력 — 고객 회신과 관리자 대리 회신이 같다. */
export const PcbEqAnswerInput = z.object({
  itemId: z.number().int().positive(),
  key: z.string().trim().min(1).max(4),
  comment: z.string().trim().max(2000).optional(),
});
export type PcbEqAnswerInputType = z.infer<typeof PcbEqAnswerInput>;

/**
 * 고객 회신 — **모든 문항**에 답하고 "이 답변대로 제작 진행"에 동의해야 한다(부분 제출 없음:
 * 공장은 한 문항이라도 비면 진행하지 못한다). requiresComment 선택지는 의견 2자 이상.
 */
export const CustomerPcbEqAnswerBody = z.object({
  expectedVersion: z.number().int().positive(),
  answers: z.array(PcbEqAnswerInput).min(1).max(60),
  agree: z.literal(true),
});
export type CustomerPcbEqAnswerBodyType = z.infer<typeof CustomerPcbEqAnswerBody>;

/** 관리자 대리 회신 — 채널(웹 제외)과 근거 메모가 필수(D43-8 관례). */
export const AdminPcbEqProxyAnswerBody = z.object({
  expectedVersion: z.number().int().positive(),
  answers: z.array(PcbEqAnswerInput).min(1).max(60),
  channel: PcbEqAnswerChannel.exclude(['web']),
  note: z.string().trim().min(2).max(2000),
});
export type AdminPcbEqProxyAnswerBodyType = z.infer<typeof AdminPcbEqProxyAnswerBody>;

export const AdminPcbEqReviewResponse = z.object({
  result: z.literal(true),
  data: z.object({ review: AdminPcbEqReviewView }),
});
export type AdminPcbEqReviewResponseType = z.infer<typeof AdminPcbEqReviewResponse>;

export const AdminPcbEqFigureUploadResponse = z.object({
  result: z.literal(true),
  data: z.object({ figure: PcbEqItemFigure }),
});
export type AdminPcbEqFigureUploadResponseType = z.infer<typeof AdminPcbEqFigureUploadResponse>;

// ── 관리자: 확인 요청 보내기 ─────────────────────────────────────────────────
export const AdminPcbEqReviewCreateBody = z.object({
  /** 고객에게 보낼 확인 문구. 협력사 EQ 원문을 그대로 넘기지 않는다. */
  message: z.string().trim().min(2).max(2000),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  /** 공개할 EQ 첨부 id — 이 발주서의 첨부만 허용(서버 검증). 비우면 문구만 나간다. */
  sharedFileIds: z.array(z.number().int().positive()).max(20).default([]),
});
export type AdminPcbEqReviewCreateBodyType = z.infer<typeof AdminPcbEqReviewCreateBody>;

export const AdminPcbEqReviewListResponse = z.object({
  result: z.literal(true),
  data: z.object({ reviews: z.array(AdminPcbEqReviewView) }),
});
export type AdminPcbEqReviewListResponseType = z.infer<typeof AdminPcbEqReviewListResponse>;

// ── 고객: 내 주문의 확인 요청 ────────────────────────────────────────────────
// 발주서·협력사·회차 어느 것도 노출하지 않는다. 고객이 아는 것은 자기 주문과 프로젝트뿐.
export const CustomerPcbEqReviewView = z.object({
  id: z.number(),
  projectName: z.string(),
  /** 주문 항목 식별 — sp-php 주문내역 상세가 행을 맞추는 키. */
  ctId: z.number().nullable(),
  status: PcbEqReviewStatus,
  message: z.string(),
  dueOn: z.string().nullable(),
  files: z.array(PcbEqReviewFile),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  overdue: z.boolean(),
  // ── D20 문항형 — draft 는 고객 응답에 절대 실리지 않는다 ──
  format: PcbEqReviewFormat,
  version: z.number().int(),
  /** 고객에게 보이는 회차 번호(문항형만). 첫 회차면 1 — 화면은 2 이상일 때만 "N차"를 붙인다. */
  roundNo: z.number().int().nullable(),
  items: z.array(CustomerPcbEqItem),
  /** 관리자가 대신 답했는가 — 고객 화면 "담당자가 전화로 확인한 답변입니다" 안내. */
  answeredByAdmin: z.boolean(),
});
export type CustomerPcbEqReviewViewType = z.infer<typeof CustomerPcbEqReviewView>;

export const CustomerPcbEqReviewListQuery = z.object({
  /** 주문번호 — 이 주문에 묶인 견적의 확인 요청만. 소유권은 서버가 판정한다. */
  odId: z.string().trim().min(1).max(32),
});
export type CustomerPcbEqReviewListQueryType = z.infer<typeof CustomerPcbEqReviewListQuery>;

export const CustomerPcbEqReviewListResponse = z.object({
  result: z.literal(true),
  data: z.object({ reviews: z.array(CustomerPcbEqReviewView) }),
});
export type CustomerPcbEqReviewListResponseType = z.infer<typeof CustomerPcbEqReviewListResponse>;

// ── 고객: 주문을 가로지르는 "내 확인 요청" 목록(마이페이지 진입점) ───────────
// 주문 상세 목록(위)과 모수가 다르다: 그쪽은 odId 한 건, 이쪽은 **회원의 전 주문**이다.
// 고객이 "지금 내가 답해야 할 게 있나"를 주문을 하나씩 열지 않고 알게 하는 것이 목적이라,
// 기본 모수는 열린 요청(open)이고 이력은 요청해야 나온다.
//
// 결정 UI 는 여기 없다 — 행은 주문 상세 딥링크로 보낸다. 승인·반려 폼이 두 벌이 되면
// 첨부·기한·경고(반려 후 새 파일 없음)까지 두 곳에서 갈린다.
export const CustomerPcbEqReviewMineQuery = z.object({
  /** open=확인 대기만(기본) · all=이력 포함. 배지 모수는 언제나 open 이다. */
  scope: z.enum(['open', 'all']).default('open'),
});
export type CustomerPcbEqReviewMineQueryType = z.infer<typeof CustomerPcbEqReviewMineQuery>;

/** 목록 행 — 주문번호가 붙는다(딥링크 대상). 주문이 지워진 건은 null 이라 링크가 없다. */
export const CustomerPcbEqReviewMineView = CustomerPcbEqReviewView.extend({
  odId: z.string().nullable(),
});
export type CustomerPcbEqReviewMineViewType = z.infer<typeof CustomerPcbEqReviewMineView>;

export const CustomerPcbEqReviewMineResponse = z.object({
  result: z.literal(true),
  data: z.object({
    reviews: z.array(CustomerPcbEqReviewMineView),
    /** scope 와 무관하게 열린 요청 수 — 사이드바 배지와 같은 수. */
    openCount: z.number().int(),
  }),
});
export type CustomerPcbEqReviewMineResponseType = z.infer<typeof CustomerPcbEqReviewMineResponse>;

// ── 고객 주문 상세의 PCB 진행 단계(P4.13) — od 상태와 별개의 협력 트랙 파생 표시 ──
// od 는 '입금'에 머물러도 실제 제작은 EQ→생산→입고로 움직인다(D6 1차 수동 유지 —
// od 를 안 바꾸고 sp 축을 그대로 보여준다). 협력사명·발주 정보는 노출하지 않는다.
// 라벨은 서버가 완성한다(PHP·화면은 그대로 출력).
// 확인(EQ) 구간은 세 칸이다(2026-08-25 실측 교정) — issued(협력사가 아직 안 올림)·
// eq_requested(검토 중)·eq_done(확인 끝, 생산 대기)이 한 문구로 뭉치면 고객은 몇 주를
// 같은 글자로 본다. 순서는 배열 순서가 곧 진행 순서다(느린 줄 판정에 쓴다).
export const PCB_PROGRESS_STAGES = [
  'eq_pending',
  'eq',
  'eq_done',
  'producing',
  'produced',
  'shipping',
  'received',
] as const;
export type PcbProgressStageType = (typeof PCB_PROGRESS_STAGES)[number];

export const CustomerPcbProgressItem = z.object({
  specId: z.number(),
  /** 이 스펙의 카트 줄 — 주문 상세가 줄 배지에 진행을 겹쳐 그릴 때의 조인 키. */
  ctId: z.number().nullable(),
  projectName: z.string(),
  reorderRound: z.number().int(), // 0=원주문, 1..=A/S 재생산 회차
  stage: z.enum(PCB_PROGRESS_STAGES),
  label: z.string(), // 예: '제조 확인(EQ) 진행 중' · 'A/S 재생산 — 생산 진행 중'
  /** 배지용 짧은 문구(목록·줄 상태 칸) — 긴 라벨은 상태 칸에서 잘린다(여정 10호 X7 실측). */
  shortLabel: z.string(),
  /**
   * 좌표파일(메탈마스크) — **통보 없는 열람**(사용자 결정 2026-08-16). 메일도 확인 요청도
   * 만들지 않고, 고객이 주문내역을 열면 여기 있다. 요청하는 고객이 종종 있어서다.
   *
   * 세 가지 제약이 붙는다:
   *  ① **관리자 확인(eq_done) 뒤에만** 뜬다 — 그 전엔 보완 요청으로 파일이 바뀔 수 있고,
   *     반려된 좌표로 고객이 SMT 설비를 잡는 것이 이 기능의 최악이다. 확인 뒤로는 첨부가
   *     영구 잠기므로(canEditPcbEqFile) 내려받은 것이 나중에 달라지지 않는다.
   *  ② **최신 1건만** — 보완 왕복이 있었으면 옛 회차 좌표는 고객이 볼 이유가 없다.
   *  ③ 이름은 **중립화**해 내려준다 — 협력사가 올린 원본 파일명에 협력사명이 박혀 있을 수
   *     있고, 고객 화면에 공급망을 드러내지 않는 것이 이 트랙의 관례다(여정 43호).
   */
  coordFile: z
    .object({ fileId: z.number(), name: z.string(), size: z.number() })
    .nullable()
    .default(null),
});
export type CustomerPcbProgressItemType = z.infer<typeof CustomerPcbProgressItem>;

// ── 주문내역 **목록**용 일괄 요약 — 주문마다 가장 느린 줄의 단계 하나 ─────────────
// 목록 배지가 od_status('입금완료')만 찍으면 협력 트랙이 입고까지 가도 고객은 몇 주를
// '입금완료'로 본다(2026-08-25 실측). 진행이 있는 주문만 돌려주고, 없는 주문은 od 매핑.
export const CustomerPcbProgressBatchBody = z.object({
  odIds: z.array(z.string().min(1).max(32)).min(1).max(50),
});
export type CustomerPcbProgressBatchBodyType = z.infer<typeof CustomerPcbProgressBatchBody>;

export const CustomerPcbProgressOrderSummary = z.object({
  odId: z.string(),
  stage: z.enum(PCB_PROGRESS_STAGES),
  label: z.string(),
  shortLabel: z.string(),
  /** 진행 카드가 있는 줄 수 — 여러 줄이면 목록 배지는 가장 느린 줄을 따른다. */
  lineCount: z.number().int(),
});
export type CustomerPcbProgressOrderSummaryType = z.infer<typeof CustomerPcbProgressOrderSummary>;

export const CustomerPcbProgressBatchResponse = z.object({
  result: z.literal(true),
  data: z.object({ orders: z.array(CustomerPcbProgressOrderSummary) }),
});
export type CustomerPcbProgressBatchResponseType = z.infer<typeof CustomerPcbProgressBatchResponse>;

export const CustomerPcbProgressResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(CustomerPcbProgressItem) }),
});
export type CustomerPcbProgressResponseType = z.infer<typeof CustomerPcbProgressResponse>;

/** 고객 결정 — 반려는 사유가 있어야 협력사에 되돌릴 근거가 된다. */
export const CustomerPcbEqDecisionBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === 'approve' || (v.note !== undefined && v.note.length >= 2), {
    message: '반려 사유를 입력해 주세요.',
    path: ['note'],
  });
export type CustomerPcbEqDecisionBodyType = z.infer<typeof CustomerPcbEqDecisionBody>;

export const CustomerPcbEqDecisionResponse = z.object({
  result: z.literal(true),
  data: z.object({ review: CustomerPcbEqReviewView }),
});
export type CustomerPcbEqDecisionResponseType = z.infer<typeof CustomerPcbEqDecisionResponse>;

/** 고객 문항형 회신(D20) 응답 — 결정 응답과 같은 모양(갱신된 회차 하나). */
export const CustomerPcbEqAnswerResponse = CustomerPcbEqDecisionResponse;
export type CustomerPcbEqAnswerResponseType = CustomerPcbEqDecisionResponseType;
