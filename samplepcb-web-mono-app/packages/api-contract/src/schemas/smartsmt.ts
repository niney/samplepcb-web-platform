import { z } from 'zod';
import { AdminSmtReview } from './smartsmt-review';

// SmartSMT 연동 — 견적서 수신 계약 (docs/SMARTSMT_INTEGRATION.md).
//
// SmartSMT(바깥의 SMT 견적 계산 서버)가 확정한 견적서를 multipart 로 보낸다. 보내는 쪽은 재시도가 없고
// 실패하면 담당자가 다시 보내야 하므로, 받는 스키마는 **느슨하게** 둔다 — 꼭 필요한 칸만 검사하고
// 나머지는 모르는 칸까지 그대로 통과시킨다. 코드 값(basis·status·reason …)을 enum 으로 막지 않는다.

/** multipart 파트 이름 — 견적서 전송 양식 0.3 의 "Multipart 파트 목록". */
/** 이름을 아는 파일 파트 — 화면 라벨과 보관 종류를 정해 둔 것. 이 밖의 이름도 아래 규칙에 맞으면 받는다. */
export const SMARTSMT_FILE_PARTS = ['gerber_archive', 'bom', 'cpl'] as const;
export type SmartsmtFilePart = (typeof SMARTSMT_FILE_PARTS)[number];
/**
 * 파일 파트의 이름 규칙 — 소문자로 시작하고 소문자 · 숫자 · 밑줄, 32자까지(packing · stackup · report 처럼).
 * SmartSMT 가 파트를 늘려도 우리 코드를 고치지 않고 받기 위한 규칙이다. 이름이 규칙에 맞지 않는 파일은 읽지 않는다.
 */
export const SMARTSMT_FILE_PART_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
/** 견적서 하나에 딸려 오는 파일 수의 한도. 넘는 파일은 읽지 않는다. */
export const SMARTSMT_MAX_FILE_PARTS = 12;
/** 작업 상태(state 파트)의 한도 — 8MB. 넘으면 견적서를 받지 않는다(413). */
export const SMARTSMT_MAX_STATE_BYTES = 8 * 1024 * 1024;

/** 견적서(envelope) — 수신 때 꼭 있어야 하는 칸만. 나머지는 passthrough. */
export const SmartsmtEnvelope = z
  .object({
    kind: z.literal('smartsmt.quote'),
    envelope_version: z.string().min(1).max(16),
    header: z
      .object({
        quote_id: z.string().min(1).max(100),
        order_id: z.string().min(1).max(100),
        made_at: z.string().min(1),
      })
      .passthrough(),
    quote: z.object({}).passthrough(),
  })
  .passthrough();
export type SmartsmtEnvelopeType = z.infer<typeof SmartsmtEnvelope>;

/**
 * 수신 응답의 사유 코드 — 실패 응답 본문 `detail.reason` 과 수신 기록(sp_smt_receive_log.reason)에 같은 값으로 남는다.
 * 인증 4종은 SmartSMT 전달 규격(docs/SMARTSMT_AUTH_REQUEST.html 3.4)과 같다.
 */
export const SMARTSMT_INBOUND_REASONS = [
  'NO_TOKEN',
  'BAD_TOKEN',
  'WRONG_AUDIENCE',
  'EXPIRED',
  /** 우리 쪽 공유 비밀이 설정되지 않음(503). */
  'NOT_CONFIGURED',
  /** multipart 가 아니거나 파트를 읽을 수 없음. */
  'INVALID_REQUEST',
  /** 파일·값 파트가 한도를 넘음(413). */
  'TOO_LARGE',
  /** envelope 파트가 없거나 꼭 있어야 하는 칸이 없음. */
  'INVALID_ENVELOPE',
  /** multipart 의 quote_id·order_id 가 견적서 안 값과 다름. */
  'ID_MISMATCH',
  /** 읽기 주소 — 그런 의뢰 · 파일이 없거나 주인이 다름(404). */
  'NOT_FOUND',
  /** 동봉 파일의 크기·해시가 견적서의 파일 목록과 다름. */
  'FILE_MISMATCH',
  /** 파일서버 저장 실패(502) — 다시 보내면 된다. */
  'FILE_STORE_FAILED',
] as const;
export type SmartsmtInboundReason = (typeof SMARTSMT_INBOUND_REASONS)[number];

/** 실패 응답 본문 — SmartSMT 서버가 쓰는 모양(`{"detail":{"reason","message"}}`)에 맞춘다. */
export const SmartsmtErrorBody = z.object({
  detail: z.object({ reason: z.string(), message: z.string() }),
});
export type SmartsmtErrorBodyType = z.infer<typeof SmartsmtErrorBody>;

// ── 견적서 가져오기 (관리자) — POST /api/admin/smt/pull ─────────────────────────────────────
// 관리자가 주문 번호로 SmartSMT 에서 견적서를 당겨 온다(GET {SmartSMT}/api/pricing/envelope). 파일은 오지 않는다.
// 전송을 놓쳤을 때의 보완 수단이다 — SmartSMT 의 보관 기간(24시간)이 지나면 가져올 수 없다.

export const AdminSmtPullBody = z.object({
  orderId: z.string().trim().min(1).max(100),
});
export type AdminSmtPullBodyType = z.infer<typeof AdminSmtPullBody>;

/** duplicate=true 는 SmartSMT 가 준 견적(quote_id)을 이미 갖고 있는 경우 — 새로 저장하지 않는다. */
export const AdminSmtPullResponse = z.object({
  result: z.literal(true),
  data: z.object({
    quoteId: z.string(),
    orderId: z.string(),
    duplicate: z.boolean(),
  }),
});
export type AdminSmtPullResponseType = z.infer<typeof AdminSmtPullResponse>;

/**
 * 가져오기 실패 코드 — 응답 `{error, message}` 의 error.
 *  SMARTSMT_NOT_CONFIGURED  503  우리 쪽 SmartSMT 주소 또는 공유 비밀 미설정
 *  SMARTSMT_UNREACHABLE     502  접속 실패 · 응답 시간 초과
 *  SMARTSMT_AUTH_REJECTED   502  SmartSMT 가 우리 토큰을 받지 않음(비밀이 서로 다르거나 SmartSMT 가 아직 토큰 방식이 아님)
 *  SMARTSMT_NOT_FOUND       404  주문 없음 또는 보관 기간(24시간) 만료
 *  SMARTSMT_NOT_READY       409  담당자 계산 전(NO_INPUTS) 또는 확정 전 견적(NOT_PUBLISHABLE)
 *  SMARTSMT_BAD_RESPONSE    502  견적서가 아닌 응답 · 다른 주문의 견적서 · 예상하지 못한 상태 코드
 */
export const SMARTSMT_PULL_ERRORS = [
  'SMARTSMT_NOT_CONFIGURED',
  'SMARTSMT_UNREACHABLE',
  'SMARTSMT_AUTH_REJECTED',
  'SMARTSMT_NOT_FOUND',
  'SMARTSMT_NOT_READY',
  'SMARTSMT_BAD_RESPONSE',
] as const;
export type SmartsmtPullError = (typeof SMARTSMT_PULL_ERRORS)[number];

// ── 관리자 화면 — /api/admin/smt/* (모듈 SMT) ───────────────────────────────────────────────
// 금액 칸은 number | null 이다. **null = 미정, 0 = 0원** — 화면에서 둘을 섞지 않는다.

/** 받은 견적 목록의 탭. undetermined = 최종 금액이 미정(합계가 막혔거나 금액이 오지 않음). */
export const ADMIN_SMT_ORDER_TABS = ['all', 'review', 'undetermined'] as const;
export type AdminSmtOrderTab = (typeof ADMIN_SMT_ORDER_TABS)[number];

export const AdminSmtOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(ADMIN_SMT_ORDER_TABS).default('all'),
  /** 주문 번호 · 고객 아이디 · 고객 이름 부분 일치. */
  search: z.string().trim().min(1).max(100).optional(),
});
export type AdminSmtOrderListQueryType = z.infer<typeof AdminSmtOrderListQuery>;

/** 견적 한 건의 요약(목록용으로 뽑아 올린 값). id 는 sp_smt_quote 의 행 번호 — 상세 주소에 쓴다. */
export const AdminSmtQuoteSummary = z.object({
  id: z.number(),
  quoteId: z.string(),
  /** push = SmartSMT 가 보냄, pull = 관리자가 가져옴(파일 없음). */
  source: z.string(),
  madeAt: z.string().nullable(),
  receivedAt: z.string(),
  currency: z.string().nullable(),
  strategy: z.string().nullable(),
  quoteStatus: z.string().nullable(),
  quantity: z.number().nullable(),
  /** SMT 작업비만(quote.total). */
  smtTotal: z.number().nullable(),
  /** 최종 금액(quote.integrated.totals.total). */
  finalTotal: z.number().nullable(),
  /**
   * 추정 금액 — 확정 금액이 미정(null)일 때 SmartSMT 가 따로 싣는 가견적이다. 고객 화면의 "최종합계"가 이 값이다.
   * smtEstimatedTotal = quote.estimated_total(SMT 작업비만), finalEstimatedTotal = quote.integrated.totals.estimated_total.
   * **확정 금액이 아니다** — 화면에서 "추정"이라고 이름을 붙여 보인다.
   */
  smtEstimatedTotal: z.number().nullable(),
  finalEstimatedTotal: z.number().nullable(),
  /**
   * 관리자 확정(항목별 가격 수정, smartsmt-review.ts) — draft 임시 저장 · confirmed 확정. 손대지 않았으면 null.
   * reviewTotal 은 그때 계산한 합계(부가세 포함).
   */
  reviewStatus: z.string().nullable(),
  reviewTotal: z.number().nullable(),
  /** 합계를 막은 블록 이름. 비어 있지 않으면 합계 미확정. */
  blockedBy: z.array(z.string()),
});
export type AdminSmtQuoteSummaryType = z.infer<typeof AdminSmtQuoteSummary>;

export const AdminSmtOrder = z.object({
  id: z.number(),
  orderId: z.string(),
  ownerMbId: z.string().nullable(),
  ownerName: z.string().nullable(),
  /** 견적서의 owner_mb_id 가 우리 회원인가. 아이디가 오지 않았으면 null. */
  ownerIsMember: z.boolean().nullable(),
  quoteCount: z.number(),
  firstReceivedAt: z.string(),
  lastReceivedAt: z.string(),
});
export type AdminSmtOrderType = z.infer<typeof AdminSmtOrder>;

export const AdminSmtOrderItem = AdminSmtOrder.extend({
  /** 마지막에 받은 견적. */
  latest: AdminSmtQuoteSummary.nullable(),
});
export type AdminSmtOrderItemType = z.infer<typeof AdminSmtOrderItem>;

export const AdminSmtOrderListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminSmtOrderItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    /** 검색어를 뺀 탭별 주문 수. */
    counts: z.object({ all: z.number(), review: z.number(), undetermined: z.number() }),
  }),
});
export type AdminSmtOrderListResponseType = z.infer<typeof AdminSmtOrderListResponse>;

/** 동봉 파일 한 줄. fileId 가 있으면 내려받을 수 있다(GET /api/admin/smt/files/:fileId). */
export const AdminSmtQuoteFile = z.object({
  part: z.string(),
  name: z.string().nullable(),
  bytes: z.number().nullable(),
  sha256: z.string().nullable(),
  /** match | unlisted | missing — SMARTSMT_FILE_CHECK_LABELS */
  check: z.string(),
  fileId: z.number().nullable(),
});
export type AdminSmtQuoteFileType = z.infer<typeof AdminSmtQuoteFile>;

export const AdminSmtQuoteDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({
    order: AdminSmtOrder,
    quote: AdminSmtQuoteSummary.extend({
      envelopeVersion: z.string(),
      lang: z.string().nullable(),
      finalSupplyPrice: z.number().nullable(),
      finalVat: z.number().nullable(),
      /** 이 주문의 마지막 견적인가. */
      isLatest: z.boolean(),
    }),
    /**
     * 받은 견적서 전체(관리자 전용). 칸 구성은 SmartSMT 「견적서 전송 양식」을 따르고 모르는 칸도 그대로 온다 —
     * 화면은 아는 칸만 골라 보이고 나머지는 원문으로 보인다. labor_charge · user_edits 는 고객 화면에 내보내지 않는 값이다.
     */
    envelope: z.record(z.string(), z.unknown()),
    files: z.array(AdminSmtQuoteFile),
    /** 관리자가 항목 금액을 고쳐 저장한 것. 없으면 null. */
    review: AdminSmtReview.nullable(),
    /** 같은 주문의 견적들(최근 것부터). */
    history: z.array(AdminSmtQuoteSummary.extend({ isLatest: z.boolean() })),
  }),
});
export type AdminSmtQuoteDetailResponseType = z.infer<typeof AdminSmtQuoteDetailResponse>;

/** 수신 기록의 결과 — accepted 받음 · duplicate 이미 받은 견적 · rejected 거절(4xx) · failed 실패(5xx). */
export const SMARTSMT_RECEIVE_RESULTS = ['accepted', 'duplicate', 'rejected', 'failed'] as const;
export type SmartsmtReceiveResult = (typeof SMARTSMT_RECEIVE_RESULTS)[number];

export const AdminSmtReceiveLogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  result: z.enum(SMARTSMT_RECEIVE_RESULTS).optional(),
});
export type AdminSmtReceiveLogQueryType = z.infer<typeof AdminSmtReceiveLogQuery>;

export const AdminSmtReceiveLogItem = z.object({
  id: z.number(),
  result: z.string(),
  reason: z.string().nullable(),
  httpStatus: z.number(),
  quoteId: z.string().nullable(),
  orderId: z.string().nullable(),
  bytes: z.number().nullable(),
  durationMs: z.number(),
  remoteAddr: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminSmtReceiveLogItemType = z.infer<typeof AdminSmtReceiveLogItem>;

export const AdminSmtReceiveLogResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminSmtReceiveLogItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export type AdminSmtReceiveLogResponseType = z.infer<typeof AdminSmtReceiveLogResponse>;

/** 연동 상태 — 설정 여부만 알린다. 공유 비밀의 값은 어떤 응답에도 싣지 않는다. */
export const AdminSmtLinkStatusResponse = z.object({
  result: z.literal(true),
  data: z.object({
    /** 공유 비밀이 쓸 수 있는 값으로 설정돼 있는가(없음 · 너무 짧음 · JWT_SECRET 과 같음 = false). */
    secretConfigured: z.boolean(),
    /** 가져오기가 부르는 SmartSMT 주소. 미설정이면 null. */
    baseUrl: z.string().nullable(),
    timeoutMs: z.number(),
    /** SmartSMT 가 견적서를 보내는 우리 경로. */
    inboundPath: z.string(),
    /** SmartSMT 가 회원 브라우저를 보내는 우리 경로(로그인 인계 — 설정은 sp-php 쪽에 있다). */
    ssoPath: z.string(),
    fileServiceType: z.string(),
    /** 마지막으로 견적서를 받은 시각. */
    lastAcceptedAt: z.string().nullable(),
    /** 최근 24시간의 수신 시도 수. */
    last24h: z.object({ accepted: z.number(), duplicate: z.number(), rejected: z.number(), failed: z.number() }),
  }),
});
export type AdminSmtLinkStatusResponseType = z.infer<typeof AdminSmtLinkStatusResponse>;

// ── 라벨 사전 — SmartSMT 「견적서 전송 양식 0.3」의 코드 값을 한국어로 ─────────────────────────
// 화면은 사전에 없는 코드를 **코드 그대로** 보인다(SmartSMT 가 값을 늘려도 깨지지 않게).

/** 사전에 있으면 라벨, 없으면 코드 그대로. 빈 값은 fallback. */
export const smartsmtLabel = (
  labels: Readonly<Record<string, string>>,
  code: string | null | undefined,
  fallback = '—',
): string => (code === null || code === undefined || code === '' ? fallback : (labels[code] ?? code));

export const SMARTSMT_QUOTE_STATUS_LABELS: Readonly<Record<string, string>> = {
  CALCULATED: '계산 완료',
  REVIEW_REQUIRED: '검토 필요',
};
export const SMARTSMT_STRATEGY_LABELS: Readonly<Record<string, string>> = { SAMPLE: '샘플', MASS: '양산' };
export const SMARTSMT_SOURCE_LABELS: Readonly<Record<string, string>> = { push: '전송', pull: '가져오기' };
export const SMARTSMT_ORDER_SCENARIO_LABELS: Readonly<Record<string, string>> = {
  NEW_OR_CHANGED: '신규 · 변경',
  REORDER_SAME_REVISION: '재주문 (동일 리비전)',
};
export const SMARTSMT_ASSEMBLY_SIDES_LABELS: Readonly<Record<string, string>> = { SINGLE: '단면', DOUBLE: '양면' };
export const SMARTSMT_REFLOW_LABELS: Readonly<Record<string, string>> = { AIR: '대기', N2: '질소(N₂)' };
/** 조달 구분 — parts_supply · metal_mask_supply · lines[].supply. */
export const SMARTSMT_SUPPLY_LABELS: Readonly<Record<string, string>> = {
  TURNKEY: '도급',
  CUSTOMER: '사급',
  REUSE: '재사용',
};

/** lines[].basis — 세는 기준. */
export const SMARTSMT_BASIS_LABELS: Readonly<Record<string, string>> = {
  FIXED: '고정 금액',
  PER_EA: '보드 1장당',
  PER_SET: 'SET 당',
  PER_POINT: '실장점당',
  PER_COMPONENT: '부품 개수당',
  PER_COMPONENT_TYPE: '부품 종수당',
  PER_PIN: '핀당',
  PER_SLOT: '피더 칸당',
  PER_CUT_TAPE_TYPE: '컷테이프 종수당',
  PER_EA_WITH_LOT_MINIMUM: '보드 1장당 (최소금액 적용)',
  PER_TYPE_WITH_LOT_MINIMUM: '종수당 (최소금액 적용)',
  PER_DAY: '일수당',
  PER_REEL: '릴당',
  PER_PCBA: 'PCBA 1장당',
  PER_PCBA_WITH_LOT_MINIMUM: 'PCBA 1장당 (최소금액 적용)',
  VALUE: '값 그대로',
  LEGACY_LOT: '견적 당 한 번 (구 모델)',
  LEGACY_TOTAL: '수량이 든 총액 (구 모델)',
};

/** lines[].status — 빈 글자는 확정. */
export const SMARTSMT_LINE_STATUS_LABELS: Readonly<Record<string, string>> = {
  UNKNOWN_RATE: '요율 없음',
  REVIEW_REQUIRED: '검토 필요',
  UNKNOWN_TYPE: '부품 종류 미상',
  UNKNOWN_INPUT: '입력값 없음',
  ESTIMATED_PITCH: '피치 추정',
};

// ── 실제 견적서(envelope_version 9, 2026-11-18 수신분)에서 본 코드 ─────────────────────────────
// 「견적서 전송 양식 0.3」에는 값 목록이 없다 — 아래 라벨은 값의 쓰임을 보고 **우리가 붙인 이름**이다.
// SmartSMT 가 값 목록을 주면 그 뜻으로 고친다. 사전에 없는 코드는 화면에 코드 그대로 나온다.

/**
 * 통합 합계의 블록 이름 — blocks[].block · blocked_by · known.blocks · estimated_blocks.
 * DETAIL 은 blocks 배열에는 없다: SMT 작업비(이 견적서의 lines) 자신을 가리킨다.
 */
export const SMARTSMT_BLOCK_LABELS: Readonly<Record<string, string>> = {
  PCB: 'PCB',
  PARTS: '부품',
  SHIPPING: '배송',
  DETAIL: 'SMT 작업비',
};
/** blocks[].source — 금액을 낸 곳. */
export const SMARTSMT_BLOCK_SOURCE_LABELS: Readonly<Record<string, string>> = {
  GERBEREYE: 'GerberEye',
  PARTSEYES: 'PartsEyes',
  MANUAL: '사람이 입력',
};
export const SMARTSMT_REQUEST_STATUS_LABELS: Readonly<Record<string, string>> = {
  DONE: '받음',
  WAITING_INPUT: '입력 대기',
  SKIPPED: '건너뜀',
};
export const SMARTSMT_VALUATION_LABELS: Readonly<Record<string, string>> = {
  CONFIRMED: '확정',
  ESTIMATED: '추정',
  NA: '해당 없음',
};
export const SMARTSMT_COMPLETENESS_LABELS: Readonly<Record<string, string>> = {
  COMPLETE: '전부',
  PARTIAL: '일부',
  NA: '해당 없음',
};
/** lines[].group — 공정 묶음. */
export const SMARTSMT_LINE_GROUP_LABELS: Readonly<Record<string, string>> = {
  PREP: '작업 준비',
  PLACEMENT: '실장',
  REFLOW: '리플로우',
  POST: '후공정',
  QA: '검사',
  ASSEMBLY: '조립 · 포장',
};
/** header.processes — 고객이 이 주문에서 시킨 공정. */
export const SMARTSMT_PROCESS_LABELS: Readonly<Record<string, string>> = {
  pcb: 'PCB',
  parts: '부품',
  stencil: '메탈마스크',
  smt: 'SMT',
};
export const SMARTSMT_PACKING_MODE_LABELS: Readonly<Record<string, string>> = { STANDARD: '기본 포장' };
/** header.quantities 의 칸 이름 — 판 9 의 이름(…_set_qty)과 양식 0.3 의 이름을 함께 둔다. */
export const SMARTSMT_QUANTITY_LABELS: Readonly<Record<string, string>> = {
  make_set_qty: '제작 수량 (SET)',
  spare_set_qty: '예비 수량 (SET)',
  total_set_qty: '합계 수량 (SET)',
  price_set_qty: '가격 기준 수량 (SET)',
  order_type: '주문 구분',
  set_qty: '세트 (한 판의 PCB 수)',
  panel_qty: '제작 (PCBA 판 수)',
  spare_qty: '예비 (낱장 PCB)',
  pcb_qty: 'PCB 장 수',
  pcb_price_qty: 'PCB 가격 기준 장 수',
  assembled_qty: '조립 보드 수',
};

/**
 * integrated.blocks[].reason — 사유와 "합계에 드는가".
 *  counted: no = 안 든다 · amount_only = 금액은 있지만 안 든다 · na = 해당 없음(이 주문에서 사지 않음)
 * 사유가 없으면(null) 정상이고 합계에 든다.
 */
export const SMARTSMT_BLOCK_REASONS: Readonly<
  Record<string, { label: string; counted: 'no' | 'amount_only' | 'na' }>
> = {
  NO_REQUEST: { label: '아직 요청하지 않음', counted: 'no' },
  MISSING_INPUT: { label: '사람이 적을 값이 오지 않음', counted: 'no' },
  EMPTY_RESULT: { label: '호출했으나 금액이 0', counted: 'no' },
  CALL_FAILED: { label: '출처 호출 실패', counted: 'no' },
  QTY_UNVERIFIED: { label: '몇 장분인지 확인되지 않음', counted: 'amount_only' },
  QTY_MISMATCH: { label: '수량이 어긋남', counted: 'amount_only' },
  CURRENCY_UNVERIFIED: { label: '통화를 확인할 수 없음', counted: 'amount_only' },
  CUSTOMER_SUPPLIED: { label: '고객이 지급함', counted: 'na' },
  PCB_ONLY: { label: 'PCB 만 주문', counted: 'na' },
  NOT_ORDERED: { label: '주문하지 않은 공정', counted: 'na' },
};

export const SMARTSMT_FILE_PART_LABELS: Readonly<Record<string, string>> = {
  gerber_archive: '제조 파일 묶음',
  bom: 'BOM',
  cpl: '좌표 파일 (CPL)',
  stackup: 'Stackup',
};
export const SMARTSMT_FILE_CHECK_LABELS: Readonly<Record<string, string>> = {
  match: '일치',
  unlisted: '목록에 없음',
  missing: '파일 없음',
};
export const SMARTSMT_RECEIVE_RESULT_LABELS: Readonly<Record<string, string>> = {
  accepted: '받음',
  duplicate: '이미 받은 견적',
  rejected: '거절',
  failed: '실패',
};

/** 수신 성공. duplicate=true 는 같은 quote_id 를 이미 받아 둔 경우(덮어쓰지 않는다). */
export const SmartsmtInboundAccepted = z.object({
  result: z.literal(true),
  data: z.object({
    quoteId: z.string(),
    orderId: z.string(),
    duplicate: z.boolean(),
  }),
});
export type SmartsmtInboundAcceptedType = z.infer<typeof SmartsmtInboundAccepted>;
