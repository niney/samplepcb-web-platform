import { z } from 'zod';
import { DateOnly } from './common';

// ── 결제 후 부품 확인 요청(D43) — 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39 ──────────
// 결제 뒤 구매 단계에서 재고 소진·MOQ 증가처럼 **고객 결과(부품·금액·납기·수량)** 가
// 바뀌는 일이 생기면 관리자가 품목을 지정해 선택지를 보내고, 고객이 마이페이지에서
// 고르고, 관리자가 그 결과를 적용·정산한다. 원 주문은 1건 그대로 두고 차액만 오간다.
//
// 고객 DTO 에는 협력사명·원가·내부 키(후보 키·발주·RFQ id)를 싣지 않는다(여정 43호 관례).
// PCB 의 제조 확인(pcb-eq-review.ts)과 값이 닮아도 따로 선다 — 트랙 간 어휘 격리.

const IdString = z.string().regex(/^\d+$/);

// ── 코드 사전 ────────────────────────────────────────────────────────────────

export const BOM_CONFIRM_REQUEST_STATUSES = ['requested', 'answered', 'resolved', 'canceled'] as const;
export type BomConfirmRequestStatusType = (typeof BOM_CONFIRM_REQUEST_STATUSES)[number];
export const BomConfirmRequestStatus = z.enum(BOM_CONFIRM_REQUEST_STATUSES);

/** 관리자 어휘 — 누구 차례인지가 드러나게. */
export const BOM_CONFIRM_REQUEST_STATUS_LABELS = {
  requested: '고객 확인 대기',
  answered: '고객 회신 — 처리 중',
  resolved: '처리 완료',
  canceled: '요청 취소',
} as const satisfies Record<BomConfirmRequestStatusType, string>;

/** 고객 어휘 — PHP 사전(sp_bom_confirm_status_label)과 수동 동기. */
export const BOM_CONFIRM_REQUEST_CUSTOMER_LABELS = {
  requested: '확인 대기',
  answered: '처리 중',
  resolved: '처리 완료',
  canceled: '요청 취소',
} as const satisfies Record<BomConfirmRequestStatusType, string>;

export const BOM_CONFIRM_ISSUE_TYPES = ['stock_out', 'moq_increase'] as const;
export type BomConfirmIssueTypeType = (typeof BOM_CONFIRM_ISSUE_TYPES)[number];
export const BomConfirmIssueType = z.enum(BOM_CONFIRM_ISSUE_TYPES);

export const BOM_CONFIRM_ISSUE_TYPE_LABELS = {
  stock_out: '재고 소진',
  moq_increase: 'MOQ 증가',
} as const satisfies Record<BomConfirmIssueTypeType, string>;

/** 요청 작성 화면의 문제 설명 기본 문구(관리자가 고쳐 보낼 수 있다). */
export const BOM_CONFIRM_ISSUE_DEFAULT_DESCRIPTIONS = {
  stock_out: '주문 확정 후 지정 부품의 공급사 재고가 소진되었습니다.',
  moq_increase: '실제 공급사 MOQ(최소 주문 수량)가 계약 수량보다 많습니다.',
} as const satisfies Record<BomConfirmIssueTypeType, string>;

export const BOM_CONFIRM_OPTION_KINDS = [
  'substitute',
  'wait_restock',
  'customer_supply',
  'moq_purchase',
  'alt_supplier',
  'consult',
] as const;
export type BomConfirmOptionKindType = (typeof BOM_CONFIRM_OPTION_KINDS)[number];
export const BomConfirmOptionKind = z.enum(BOM_CONFIRM_OPTION_KINDS);

export const BOM_CONFIRM_OPTION_KIND_LABELS = {
  substitute: '대체품 승인',
  wait_restock: '입고 대기',
  customer_supply: '고객 사급',
  moq_purchase: 'MOQ 구매 승인',
  alt_supplier: '다른 공급사',
  consult: '상담 요청',
} as const satisfies Record<BomConfirmOptionKindType, string>;

/**
 * 유형별 선택지 프리셋 — 배열 순서가 곧 A·B·C 순서다(사용자 확정 형식 2026-09-30).
 * 상담 요청(consult)은 유형과 무관하게 서버가 마지막에 붙인다.
 * MOQ 증가의 사급은 '부족분'이 아니라 **해당 부품 전량 사급**(사용자 결정)이다.
 */
export const BOM_CONFIRM_TYPE_OPTION_KINDS = {
  stock_out: ['substitute', 'wait_restock', 'customer_supply'],
  moq_increase: ['moq_purchase', 'alt_supplier', 'customer_supply'],
} as const satisfies Record<BomConfirmIssueTypeType, readonly Exclude<BomConfirmOptionKindType, 'consult'>[]>;

/** 선택지 기본 제목 — 유형에 따라 같은 종류도 문구가 다르다(MOQ 사급 = 전량). */
export function bomConfirmOptionDefaultTitle(
  issueType: BomConfirmIssueTypeType,
  kind: BomConfirmOptionKindType,
): string {
  if (kind === 'customer_supply' && issueType === 'moq_increase') return '고객 사급(해당 부품 전량)';
  return BOM_CONFIRM_OPTION_KIND_LABELS[kind];
}

export const BOM_CONFIRM_OPTION_CODES = ['A', 'B', 'C', 'D', 'E'] as const;
export type BomConfirmOptionCodeType = (typeof BOM_CONFIRM_OPTION_CODES)[number];
export const BomConfirmOptionCode = z.enum(BOM_CONFIRM_OPTION_CODES);

export const BOM_CONFIRM_ISSUE_STATUSES = ['pending', 'decided', 'applied', 'closed', 'canceled'] as const;
export type BomConfirmIssueStatusType = (typeof BOM_CONFIRM_ISSUE_STATUSES)[number];
export const BomConfirmIssueStatus = z.enum(BOM_CONFIRM_ISSUE_STATUSES);

export const BOM_CONFIRM_ISSUE_STATUS_LABELS = {
  pending: '고객 선택 대기',
  decided: '적용 대기',
  applied: '적용 완료',
  closed: '변경 없이 종결',
  canceled: '취소',
} as const satisfies Record<BomConfirmIssueStatusType, string>;

/** 열린 이슈 — 발주·배송 게이트가 보는 상태. */
export const BOM_CONFIRM_OPEN_ISSUE_STATUSES = ['pending', 'decided'] as const satisfies readonly BomConfirmIssueStatusType[];

export const BOM_CONFIRM_SHIP_PREFERENCES = ['together', 'split'] as const;
export type BomConfirmShipPreferenceType = (typeof BOM_CONFIRM_SHIP_PREFERENCES)[number];
export const BomConfirmShipPreference = z.enum(BOM_CONFIRM_SHIP_PREFERENCES);

export const BOM_CONFIRM_SHIP_PREFERENCE_LABELS = {
  together: '모두 모아서 한 번에 받기',
  split: '먼저 온 부품 먼저 받기',
} as const satisfies Record<BomConfirmShipPreferenceType, string>;

export const BOM_CONFIRM_ANSWER_CHANNELS = ['web', 'phone', 'email', 'other'] as const;
export type BomConfirmAnswerChannelType = (typeof BOM_CONFIRM_ANSWER_CHANNELS)[number];
export const BomConfirmAnswerChannel = z.enum(BOM_CONFIRM_ANSWER_CHANNELS);

export const BOM_CONFIRM_ANSWER_CHANNEL_LABELS = {
  web: '고객 직접(웹)',
  phone: '전화',
  email: '메일',
  other: '기타',
} as const satisfies Record<BomConfirmAnswerChannelType, string>;

export const BOM_CONFIRM_SETTLEMENT_MODES = ['difference'] as const;
export const BomConfirmSettlementMode = z.enum(BOM_CONFIRM_SETTLEMENT_MODES);

// ── 정산 원장(Case 단위) ─────────────────────────────────────────────────────

export const BOM_SETTLEMENT_KINDS = ['charge', 'refund'] as const;
export type BomSettlementKindType = (typeof BOM_SETTLEMENT_KINDS)[number];
export const BomSettlementKind = z.enum(BOM_SETTLEMENT_KINDS);

export const BOM_SETTLEMENT_KIND_LABELS = {
  charge: '추가결제',
  refund: '환불',
} as const satisfies Record<BomSettlementKindType, string>;

/**
 * charge: pending(결제 대기) → paid(결제 완료)
 * refund: pending(감액 대기) → reduced(주문 금액 감액 — 환불 대기) → refunded(환불 완료)
 * 공통: canceled
 */
export const BOM_SETTLEMENT_STATUSES = ['pending', 'paid', 'reduced', 'refunded', 'canceled'] as const;
export type BomSettlementStatusType = (typeof BOM_SETTLEMENT_STATUSES)[number];
export const BomSettlementStatus = z.enum(BOM_SETTLEMENT_STATUSES);

export function bomSettlementStatusLabel(
  kind: BomSettlementKindType,
  status: BomSettlementStatusType,
): string {
  if (status === 'canceled') return '정산 취소';
  if (kind === 'charge') return status === 'paid' ? '추가결제 완료' : '추가결제 대기';
  if (status === 'refunded') return '환불 완료';
  if (status === 'reduced') return '환불 진행 중';
  return '환불 예정';
}

/** 추가결제 카트행 io_id — BOM 주문 시도 키(`bom-{quoteId}`)와 겹치면 주문 축이 재주문으로 오인한다. */
export const bomSettlementChargeKey = (settlementId: string | number | bigint): string =>
  `bomx-${String(settlementId)}`;

// ── 품목 조달 상태 ───────────────────────────────────────────────────────────

export const BOM_ITEM_FULFILLMENTS = ['normal', 'customer_supply', 'backorder'] as const;
export type BomItemFulfillmentType = (typeof BOM_ITEM_FULFILLMENTS)[number];
export const BomItemFulfillment = z.enum(BOM_ITEM_FULFILLMENTS);

export const BOM_ITEM_FULFILLMENT_LABELS = {
  normal: '당사 조달',
  customer_supply: '고객 사급',
  backorder: '입고 대기',
} as const satisfies Record<BomItemFulfillmentType, string>;

// ── 엔진 필수조건 키 라벨 — 근거 박제 시 서버가 라벨까지 굳혀 PHP 가 그대로 그린다 ──
export const BOM_REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  mount_style: '실장 방식',
  package: '패키지',
  diameter_mm: '직경',
  capacitance_f: '정전용량',
  voltage_v: '정격전압',
  tolerance_percent: '허용오차',
  dielectric: '유전체',
  resistance_ohm: '저항값',
  power_w: '정격전력',
  inductance_h: '인덕턴스',
  impedance_ohm: '임피던스',
  impedance_frequency_hz: '임피던스 기준 주파수',
  current_a: '정격전류',
  frequency_hz: '주파수',
  color: '발광색',
  pin_count: '핀 수',
  row_count: '열 수',
  pitch_mm: '피치',
  part_type: '부품 유형',
  manufacturer: '제조사',
  part_number: '품번',
};

export const bomRequirementLabel = (key: string): string => BOM_REQUIREMENT_LABELS[key] ?? key;

// ── 근거 박제(요청 시점) ─────────────────────────────────────────────────────

/** 원 부품 — 고객이 이미 견적에서 본 값만. 공급처는 유통사명 또는 '당사 협력 공급처'. */
export const BomConfirmPartSnapshot = z.object({
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  packageCode: z.string().nullable(),
  neededQty: z.number().int(),
  orderQty: z.number().int(),
  unitPriceKrw: z.number().nullable(),
  lineTotalKrw: z.number().nullable(),
  supplierLabel: z.string().nullable(),
  /** BOM 위치 — 시트·행 번호(고객이 자기 BOM 에서 찾는 단서). */
  location: z.string().nullable(),
});
export type BomConfirmPartSnapshotType = z.infer<typeof BomConfirmPartSnapshot>;

/** 관리자가 확인한 문제 근거 — 재고·MOQ 는 바뀌므로 확인 시각과 함께 굳힌다. */
export const BomConfirmObservation = z.object({
  checkedAt: z.string(),
  sourceLabel: z.string().nullable(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  leadTime: z.string().nullable(),
  note: z.string().nullable(),
});
export type BomConfirmObservationType = z.infer<typeof BomConfirmObservation>;

export const BomConfirmEvidence = z.object({
  part: BomConfirmPartSnapshot,
  observation: BomConfirmObservation,
});
export type BomConfirmEvidenceType = z.infer<typeof BomConfirmEvidence>;

export const BomConfirmRequirementRow = z.object({
  key: z.string(),
  label: z.string(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  state: z.enum(['match', 'mismatch', 'missing', 'not_applicable', 'unverified']),
});
export type BomConfirmRequirementRowType = z.infer<typeof BomConfirmRequirementRow>;

/** 엔진 판정 박제 — 후보 스냅샷에서 고른 대체품만. 카탈로그 선택은 null(= 엔진 비교 없음). */
export const BomConfirmEngineVerdict = z.object({
  selectionMode: z.enum(['exact', 'variant', 'spec-compatible', 'review']),
  safety: z.enum(['safe', 'caution', 'blocked']),
  requirements: z.array(BomConfirmRequirementRow),
  conflicts: z.array(z.string()),
});
export type BomConfirmEngineVerdictType = z.infer<typeof BomConfirmEngineVerdict>;

/** 대체품·다른 공급사 — 관리자 전용 키(supplier·supplierSku·partId·candidateKey·offerKey·rfqItemId)는 고객 DTO 에서 뺀다. */
export const BomConfirmReplacement = z.object({
  source: z.enum(['candidate', 'catalog', 'rfq']),
  candidateKey: z.string().nullable(),
  offerKey: z.string().nullable(),
  partId: z.string().nullable(),
  rfqItemId: z.string().nullable(),
  supplier: z.string().nullable(),
  supplierSku: z.string().nullable(),
  supplierLabel: z.string(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  packageCode: z.string().nullable(),
  lifecycleCode: z.string().nullable(),
  datasheetUrl: z.string().nullable(),
  unitPriceKrw: z.number().nullable(),
  orderQty: z.number().int(),
  lineTotalKrw: z.number().nullable(),
  moq: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  leadTime: z.string().nullable(),
  engine: BomConfirmEngineVerdict.nullable(),
});
export type BomConfirmReplacementType = z.infer<typeof BomConfirmReplacement>;

export const BomConfirmMoqPlan = z.object({
  neededQty: z.number().int(),
  orderQty: z.number().int(),
  surplusQty: z.number().int(),
  unitPriceKrw: z.number().nullable(),
  lineTotalKrw: z.number().nullable(),
});
export type BomConfirmMoqPlanType = z.infer<typeof BomConfirmMoqPlan>;

export const BomConfirmRestockPlan = z.object({
  expectedOn: DateOnly,
  basis: z.string(),
  maxWaitOn: DateOnly.nullable(),
  splitAllowed: z.boolean(),
  /** 분할 발송을 고르면 붙는 두 번째 배송비(VAT 포함, 0=당사 부담). */
  splitShippingFee: z.number().int().min(0),
});
export type BomConfirmRestockPlanType = z.infer<typeof BomConfirmRestockPlan>;

/** 저장·관리자 DTO 공용 선택지. */
export const BomConfirmOption = z.object({
  code: BomConfirmOptionCode,
  kind: BomConfirmOptionKind,
  title: z.string(),
  detail: z.string().nullable(),
  /** VAT 포함 원 — +추가결제 · −환불 · 0=변동 없음(당사 부담 포함). 관리자 입력이 최종. */
  priceDelta: z.number().int(),
  /** 서버 참고값(새 라인 − 원 라인, 공급가×1.1). 계산 불가면 null. */
  referenceDelta: z.number().int().nullable(),
  replacement: BomConfirmReplacement.nullable(),
  moq: BomConfirmMoqPlan.nullable(),
  restock: BomConfirmRestockPlan.nullable(),
});
export type BomConfirmOptionType = z.infer<typeof BomConfirmOption>;

// ── 이벤트 ───────────────────────────────────────────────────────────────────

export const BOM_CONFIRM_EVENT_ACTIONS = [
  'requested',
  'answered',
  'proxy_answered',
  'applied',
  'closed',
  'followup_shipped',
  'settlement_created',
  'settlement_paid',
  'settlement_reduced',
  'settlement_refunded',
  'settlement_canceled',
  'resolved',
  'canceled',
] as const;
export type BomConfirmEventActionType = (typeof BOM_CONFIRM_EVENT_ACTIONS)[number];
export const BomConfirmEventAction = z.enum(BOM_CONFIRM_EVENT_ACTIONS);

export const BOM_CONFIRM_EVENT_ACTION_LABELS = {
  requested: '확인 요청 발송',
  answered: '고객 회신',
  proxy_answered: '관리자 대리 회신',
  applied: '적용',
  closed: '변경 없이 종결',
  followup_shipped: '나머지 부품 발송',
  settlement_created: '정산 생성',
  settlement_paid: '추가결제 확인',
  settlement_reduced: '주문 금액 감액',
  settlement_refunded: '환불 기록',
  settlement_canceled: '정산 취소',
  resolved: '처리 완료',
  canceled: '요청 취소',
} as const satisfies Record<BomConfirmEventActionType, string>;

export const BomConfirmEvent = z.object({
  id: z.string(),
  issueId: z.string().nullable(),
  action: BomConfirmEventAction,
  actorRole: z.enum(['customer', 'admin', 'system']),
  actorMbId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type BomConfirmEventType = z.infer<typeof BomConfirmEvent>;

// ── 정산 DTO ─────────────────────────────────────────────────────────────────

export const BomSettlement = z.object({
  id: z.string(),
  quoteId: z.string(),
  requestId: z.string().nullable(),
  kind: BomSettlementKind,
  status: BomSettlementStatus,
  statusLabel: z.string(),
  /** VAT 포함 원(양수). */
  amount: z.number().int().positive(),
  chargeKey: z.string().nullable(),
  ctId: z.number().int().nullable(),
  paidOdId: z.string().nullable(),
  paidAt: z.string().nullable(),
  /** 환불 대상 원 주문. */
  odId: z.string().nullable(),
  reducedAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type BomSettlementType = z.infer<typeof BomSettlement>;

// ── 관리자 DTO ───────────────────────────────────────────────────────────────

export const BomConfirmFollowup = z.object({
  carrier: z.string(),
  invoice: z.string(),
  shippedAt: z.string(),
});
export type BomConfirmFollowupType = z.infer<typeof BomConfirmFollowup>;

/** 적용 가능 여부 판단에 쓰는 품목의 현재 상태(요청 시점 박제가 아니라 지금 값). */
export const AdminBomConfirmItemState = z.object({
  exists: z.boolean(),
  fulfillment: BomItemFulfillment,
  mpn: z.string().nullable(),
  /** 이 품목이 든 발주서 — 있으면 적용 전에 정리해야 한다(D43-10). */
  po: z
    .object({ poId: z.string(), status: z.string(), partnerName: z.string(), supplier: z.boolean() })
    .nullable(),
});
export type AdminBomConfirmItemStateType = z.infer<typeof AdminBomConfirmItemState>;

export const AdminBomConfirmIssue = z.object({
  id: z.string(),
  quoteItemId: z.string(),
  sortOrder: z.number().int(),
  issueType: BomConfirmIssueType,
  status: BomConfirmIssueStatus,
  description: z.string(),
  evidence: BomConfirmEvidence,
  options: z.array(BomConfirmOption),
  chosenCode: BomConfirmOptionCode.nullable(),
  shipPreference: BomConfirmShipPreference.nullable(),
  appliedAt: z.string().nullable(),
  appliedBy: z.string().nullable(),
  applyNote: z.string().nullable(),
  followup: BomConfirmFollowup.nullable(),
  itemState: AdminBomConfirmItemState,
});
export type AdminBomConfirmIssueType = z.infer<typeof AdminBomConfirmIssue>;

export const AdminBomConfirmRequest = z.object({
  id: z.string(),
  quoteId: z.string(),
  odId: z.string(),
  ctId: z.number().int(),
  status: BomConfirmRequestStatus,
  settlementMode: BomConfirmSettlementMode,
  message: z.string().nullable(),
  dueOn: z.string().nullable(),
  overdue: z.boolean(),
  version: z.number().int().positive(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  answeredAt: z.string().nullable(),
  answeredBy: z.string().nullable(),
  answeredRole: z.enum(['customer', 'admin']).nullable(),
  answerChannel: BomConfirmAnswerChannel.nullable(),
  customerNote: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** 고객 선택 기준 순액(VAT 포함, +추가결제 · −환불). 회신 전 null. */
  netDelta: z.number().int().nullable(),
  settlement: BomSettlement.nullable(),
  issues: z.array(AdminBomConfirmIssue),
  events: z.array(BomConfirmEvent),
});
export type AdminBomConfirmRequestType = z.infer<typeof AdminBomConfirmRequest>;

export const AdminBomConfirmEligibilityReason = z.enum([
  'NOT_ORDERED',
  'NOT_PAID',
  'ORDER_CLOSED',
]);
export type AdminBomConfirmEligibilityReasonType = z.infer<typeof AdminBomConfirmEligibilityReason>;

export const ADMIN_BOM_CONFIRM_ELIGIBILITY_LABELS = {
  NOT_ORDERED: '고객 주문이 없어 확인 요청을 보낼 수 없습니다.',
  NOT_PAID: '결제 확인 뒤에 보낼 수 있습니다. 결제 전이면 품목 교체 후 다시 회신하세요.',
  ORDER_CLOSED: '배송이 시작됐거나 닫힌 주문입니다. 배송 뒤 문제는 클레임으로 처리합니다.',
} as const satisfies Record<AdminBomConfirmEligibilityReasonType, string>;

/** 요청 작성 모달의 품목 선택표 — 현재 상태 기준. */
export const AdminBomConfirmItemRow = z.object({
  quoteItemId: z.string(),
  rowIdx: z.number().int(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  neededQty: z.number().int(),
  orderQty: z.number().int(),
  lineTotalKrw: z.number().nullable(),
  supplierLabel: z.string().nullable(),
  offerStock: z.number().int().nullable(),
  offerMoq: z.number().int().nullable(),
  fulfillment: BomItemFulfillment,
  activeIssueId: z.string().nullable(),
  po: AdminBomConfirmItemState.shape.po,
});
export type AdminBomConfirmItemRowType = z.infer<typeof AdminBomConfirmItemRow>;

export const AdminBomConfirmCaseResponse = z.object({
  result: z.literal(true),
  data: z.object({
    eligibility: z.object({
      canCreate: z.boolean(),
      reason: AdminBomConfirmEligibilityReason.nullable(),
      odId: z.string().nullable(),
      ctId: z.number().int().nullable(),
    }),
    items: z.array(AdminBomConfirmItemRow),
    requests: z.array(AdminBomConfirmRequest),
  }),
});
export type AdminBomConfirmCaseResponseType = z.infer<typeof AdminBomConfirmCaseResponse>;

// ── 관리자: 요청 작성 ────────────────────────────────────────────────────────

export const BomConfirmReplacementPick = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('candidate'),
    candidateKey: z.string().trim().min(1).max(64),
    offerKey: z.string().trim().min(1).max(200).nullable(),
  }),
  z.object({
    source: z.literal('catalog'),
    partId: IdString,
    offer: z
      .object({ supplier: z.string().trim().min(1).max(40), supplierSku: z.string().trim().min(1).max(191) })
      .nullable(),
  }),
  z.object({ source: z.literal('rfq'), rfqItemId: IdString }),
]);
export type BomConfirmReplacementPickType = z.infer<typeof BomConfirmReplacementPick>;

export const AdminBomConfirmRestockInput = z.object({
  expectedOn: DateOnly,
  basis: z.string().trim().min(1).max(200),
  maxWaitOn: DateOnly.nullable().optional(),
  splitAllowed: z.boolean().default(false),
  splitShippingFee: z.number().int().min(0).max(1_000_000).default(0),
});
export type AdminBomConfirmRestockInputType = z.infer<typeof AdminBomConfirmRestockInput>;

export const AdminBomConfirmOptionInput = z.object({
  kind: BomConfirmOptionKind.exclude(['consult']),
  title: z.string().trim().min(1).max(60).optional(),
  detail: z.string().trim().max(500).optional(),
  priceDelta: z.number().int().min(-100_000_000).max(100_000_000),
  /** substitute·alt_supplier 필수. */
  replacement: BomConfirmReplacementPick.optional(),
  /** moq_purchase 필수 — 실제로 살 수량(보통 공급사 MOQ). */
  moqOrderQty: z.number().int().positive().max(10_000_000).optional(),
  /** wait_restock 필수. */
  restock: AdminBomConfirmRestockInput.optional(),
});
export type AdminBomConfirmOptionInputType = z.infer<typeof AdminBomConfirmOptionInput>;

export const AdminBomConfirmIssueInput = z
  .object({
    quoteItemId: IdString,
    issueType: BomConfirmIssueType,
    description: z.string().trim().min(5).max(1000),
    observation: z.object({
      sourceLabel: z.string().trim().max(60).nullable().optional(),
      stock: z.number().int().min(0).nullable().optional(),
      moq: z.number().int().min(1).nullable().optional(),
      leadTime: z.string().trim().max(60).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    }),
    /** 순서가 곧 A·B·C 코드다. 상담 요청은 서버가 마지막에 붙인다. */
    options: z.array(AdminBomConfirmOptionInput).min(1).max(4),
  })
  .superRefine((issue, ctx) => {
    const allowed: readonly string[] = BOM_CONFIRM_TYPE_OPTION_KINDS[issue.issueType];
    const seen = new Set<string>();
    issue.options.forEach((option, index) => {
      if (!allowed.includes(option.kind)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', index, 'kind'],
          message: `${BOM_CONFIRM_ISSUE_TYPE_LABELS[issue.issueType]}에는 '${BOM_CONFIRM_OPTION_KIND_LABELS[option.kind]}' 선택지를 쓸 수 없습니다.`,
        });
      }
      if (seen.has(option.kind)) {
        ctx.addIssue({ code: 'custom', path: ['options', index, 'kind'], message: '같은 종류의 선택지가 중복되었습니다.' });
      }
      seen.add(option.kind);
      if ((option.kind === 'substitute' || option.kind === 'alt_supplier') && option.replacement === undefined) {
        ctx.addIssue({ code: 'custom', path: ['options', index, 'replacement'], message: '대체 부품 또는 공급처를 골라 주세요.' });
      }
      if (option.kind === 'moq_purchase' && option.moqOrderQty === undefined) {
        ctx.addIssue({ code: 'custom', path: ['options', index, 'moqOrderQty'], message: '구매할 수량(MOQ)을 입력해 주세요.' });
      }
      if (option.kind === 'wait_restock' && option.restock === undefined) {
        ctx.addIssue({ code: 'custom', path: ['options', index, 'restock'], message: '예상 입고일과 근거를 입력해 주세요.' });
      }
    });
  });
export type AdminBomConfirmIssueInputType = z.infer<typeof AdminBomConfirmIssueInput>;

export const AdminBomConfirmCreateBody = z.object({
  message: z.string().trim().max(2000).optional(),
  dueOn: DateOnly.nullable().optional(),
  sendMail: z.boolean().default(true),
  issues: z.array(AdminBomConfirmIssueInput).min(1).max(20),
});
export type AdminBomConfirmCreateBodyType = z.infer<typeof AdminBomConfirmCreateBody>;

export const AdminBomConfirmMailDelivery = z.object({
  status: z.enum(['sent', 'skipped', 'failed']),
  reason: z.string().nullable(),
});
export type AdminBomConfirmMailDeliveryType = z.infer<typeof AdminBomConfirmMailDelivery>;

export const AdminBomConfirmCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({ request: AdminBomConfirmRequest, mail: AdminBomConfirmMailDelivery }),
});
export type AdminBomConfirmCreateResponseType = z.infer<typeof AdminBomConfirmCreateResponse>;

// ── 회신(고객·대리 공용) ──────────────────────────────────────────────────────

export const BomConfirmChoiceInput = z.object({
  issueId: IdString,
  code: BomConfirmOptionCode,
  shipPreference: BomConfirmShipPreference.optional(),
});
export type BomConfirmChoiceInputType = z.infer<typeof BomConfirmChoiceInput>;

export const BomConfirmAnswerBody = z.object({
  expectedVersion: z.number().int().positive(),
  choices: z.array(BomConfirmChoiceInput).min(1).max(20),
  note: z.string().trim().max(2000).optional(),
});
export type BomConfirmAnswerBodyType = z.infer<typeof BomConfirmAnswerBody>;

export const AdminBomConfirmProxyAnswerBody = BomConfirmAnswerBody.extend({
  channel: BomConfirmAnswerChannel.exclude(['web']),
});
export type AdminBomConfirmProxyAnswerBodyType = z.infer<typeof AdminBomConfirmProxyAnswerBody>;

// ── 관리자: 전이 ─────────────────────────────────────────────────────────────

export const AdminBomConfirmCancelBody = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(2).max(500),
});
export type AdminBomConfirmCancelBodyType = z.infer<typeof AdminBomConfirmCancelBody>;

export const AdminBomConfirmApplyBody = z.object({
  expectedVersion: z.number().int().positive(),
  /** 추가결제가 아직 확인되지 않았어도 먼저 적용한다(관리자 명시 확인). */
  preApply: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});
export type AdminBomConfirmApplyBodyType = z.infer<typeof AdminBomConfirmApplyBody>;

export const AdminBomConfirmFollowupBody = z.object({
  expectedVersion: z.number().int().positive(),
  carrier: z.string().trim().min(1).max(40),
  invoice: z.string().trim().min(1).max(60),
  shippedAt: DateOnly.optional(),
});
export type AdminBomConfirmFollowupBodyType = z.infer<typeof AdminBomConfirmFollowupBody>;

export const AdminBomConfirmResolveBody = z.object({
  expectedVersion: z.number().int().positive(),
});
export type AdminBomConfirmResolveBodyType = z.infer<typeof AdminBomConfirmResolveBody>;

export const AdminBomSettlementActionBody = z.object({
  note: z.string().trim().max(500).optional(),
});
export type AdminBomSettlementActionBodyType = z.infer<typeof AdminBomSettlementActionBody>;

export const AdminBomSettlementCancelBody = z.object({
  reason: z.string().trim().min(2).max(500),
});
export type AdminBomSettlementCancelBodyType = z.infer<typeof AdminBomSettlementCancelBody>;

// ── 관리자 워크큐 ────────────────────────────────────────────────────────────

export const ADMIN_BOM_CONFIRM_TABS = [
  'needs_action',
  'awaiting_customer',
  'awaiting_payment',
  'awaiting_refund',
  'backorder',
  'done',
  'canceled',
] as const;
export type AdminBomConfirmTabType = (typeof ADMIN_BOM_CONFIRM_TABS)[number];

export const ADMIN_BOM_CONFIRM_TAB_LABELS = {
  needs_action: '처리 필요',
  awaiting_customer: '고객 회신 대기',
  awaiting_payment: '추가결제 대기',
  awaiting_refund: '환불 대기',
  backorder: '입고 대기',
  done: '완료',
  canceled: '취소',
} as const satisfies Record<AdminBomConfirmTabType, string>;

export const AdminBomConfirmListQuery = z.object({
  tab: z.enum(ADMIN_BOM_CONFIRM_TABS).default('needs_action'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});
export type AdminBomConfirmListQueryType = z.infer<typeof AdminBomConfirmListQuery>;

export const AdminBomConfirmListRow = z.object({
  id: z.string(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  mbId: z.string(),
  customerName: z.string().nullable(),
  odId: z.string(),
  status: BomConfirmRequestStatus,
  dueOn: z.string().nullable(),
  overdue: z.boolean(),
  issueCount: z.number().int(),
  issueTypes: z.array(BomConfirmIssueType),
  pendingApplyCount: z.number().int(),
  backorderCount: z.number().int(),
  netDelta: z.number().int().nullable(),
  settlement: BomSettlement.nullable(),
  requestedAt: z.string(),
  answeredAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type AdminBomConfirmListRowType = z.infer<typeof AdminBomConfirmListRow>;

export const AdminBomConfirmCounts = z.object({
  needs_action: z.number().int().nonnegative(),
  awaiting_customer: z.number().int().nonnegative(),
  awaiting_payment: z.number().int().nonnegative(),
  awaiting_refund: z.number().int().nonnegative(),
  backorder: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
});
export type AdminBomConfirmCountsType = z.infer<typeof AdminBomConfirmCounts>;

export const AdminBomConfirmListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomConfirmListRow),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    counts: AdminBomConfirmCounts,
  }),
});
export type AdminBomConfirmListResponseType = z.infer<typeof AdminBomConfirmListResponse>;

// ── 고객 DTO ─────────────────────────────────────────────────────────────────

export const CustomerBomConfirmReplacement = BomConfirmReplacement.omit({
  candidateKey: true,
  offerKey: true,
  partId: true,
  rfqItemId: true,
  supplier: true,
  supplierSku: true,
});
export type CustomerBomConfirmReplacementType = z.infer<typeof CustomerBomConfirmReplacement>;

export const CustomerBomConfirmOption = BomConfirmOption.omit({ referenceDelta: true, replacement: true }).extend({
  replacement: CustomerBomConfirmReplacement.nullable(),
});
export type CustomerBomConfirmOptionType = z.infer<typeof CustomerBomConfirmOption>;

export const CustomerBomConfirmIssue = z.object({
  id: z.string(),
  sortOrder: z.number().int(),
  issueType: BomConfirmIssueType,
  issueTypeLabel: z.string(),
  status: BomConfirmIssueStatus,
  description: z.string(),
  evidence: BomConfirmEvidence,
  options: z.array(CustomerBomConfirmOption),
  chosenCode: BomConfirmOptionCode.nullable(),
  shipPreference: BomConfirmShipPreference.nullable(),
  applied: z.boolean(),
  followup: BomConfirmFollowup.nullable(),
});
export type CustomerBomConfirmIssueType = z.infer<typeof CustomerBomConfirmIssue>;

export const CustomerBomSettlement = BomSettlement.pick({
  id: true,
  kind: true,
  status: true,
  statusLabel: true,
  amount: true,
  paidAt: true,
  refundedAt: true,
}).extend({
  /** 추가결제 주문서로 갈 수 있는가(결제 대기 + 요청이 살아 있음 + 아직 주문서를 안 냄). */
  canCheckout: z.boolean(),
  /** 추가결제 주문서는 냈고 입금 전(무통장) — 다시 결제하게 하지 않고 '입금 확인 대기'로 보인다. */
  orderPending: z.boolean(),
});
export type CustomerBomSettlementType = z.infer<typeof CustomerBomSettlement>;

export const CustomerBomConfirmRequest = z.object({
  id: z.string(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  odId: z.string(),
  ctId: z.number().int(),
  status: BomConfirmRequestStatus,
  statusLabel: z.string(),
  message: z.string().nullable(),
  dueOn: z.string().nullable(),
  overdue: z.boolean(),
  version: z.number().int().positive(),
  requestedAt: z.string(),
  answeredAt: z.string().nullable(),
  answeredByAdmin: z.boolean(),
  customerNote: z.string().nullable(),
  netDelta: z.number().int().nullable(),
  settlement: CustomerBomSettlement.nullable(),
  issues: z.array(CustomerBomConfirmIssue),
});
export type CustomerBomConfirmRequestType = z.infer<typeof CustomerBomConfirmRequest>;

export const CustomerBomConfirmListQuery = z.object({
  odId: z.string().trim().min(1).max(32),
});
export type CustomerBomConfirmListQueryType = z.infer<typeof CustomerBomConfirmListQuery>;

export const CustomerBomConfirmListResponse = z.object({
  result: z.literal(true),
  data: z.object({ requests: z.array(CustomerBomConfirmRequest) }),
});
export type CustomerBomConfirmListResponseType = z.infer<typeof CustomerBomConfirmListResponse>;

export const CustomerBomConfirmMineQuery = z.object({
  scope: z.enum(['open', 'all']).default('open'),
});
export type CustomerBomConfirmMineQueryType = z.infer<typeof CustomerBomConfirmMineQuery>;

/** 목록 행 — 결정 UI 는 주문 상세 한 곳(#bomc-{id})에만 있다. */
export const CustomerBomConfirmMineRow = z.object({
  id: z.string(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  odId: z.string(),
  status: BomConfirmRequestStatus,
  statusLabel: z.string(),
  dueOn: z.string().nullable(),
  overdue: z.boolean(),
  issueCount: z.number().int(),
  issueSummary: z.string(),
  requestedAt: z.string(),
  answeredAt: z.string().nullable(),
  /** 고객이 할 일이 남았는가 — 확인 대기 또는 추가결제 대기. */
  customerTurn: z.boolean(),
  settlement: CustomerBomSettlement.nullable(),
});
export type CustomerBomConfirmMineRowType = z.infer<typeof CustomerBomConfirmMineRow>;

export const CustomerBomConfirmMineResponse = z.object({
  result: z.literal(true),
  data: z.object({
    requests: z.array(CustomerBomConfirmMineRow),
    /**
     * scope 와 무관하게 고객 차례 수(확인 대기 + 추가결제 대기) — 사이드바 배지와 같은 모수.
     * 입금 확인 대기(orderPending)는 고객이 더 할 일이 없어 세지 않는다.
     */
    openCount: z.number().int(),
  }),
});
export type CustomerBomConfirmMineResponseType = z.infer<typeof CustomerBomConfirmMineResponse>;

export const CustomerBomConfirmAnswerResponse = z.object({
  result: z.literal(true),
  data: z.object({ request: CustomerBomConfirmRequest }),
});
export type CustomerBomConfirmAnswerResponseType = z.infer<typeof CustomerBomConfirmAnswerResponse>;

export const CustomerBomSettlementCheckoutResponse = z.object({
  result: z.literal(true),
  data: z.object({ redirectUrl: z.string() }),
});
export type CustomerBomSettlementCheckoutResponseType = z.infer<typeof CustomerBomSettlementCheckoutResponse>;

// ── 순수 판정 ────────────────────────────────────────────────────────────────

/** 고객 선택 기준 순액 — 분할 발송을 고른 입고 대기는 두 번째 배송비가 더해진다. */
export function bomConfirmChosenDelta(
  option: Pick<BomConfirmOptionType, 'kind' | 'priceDelta' | 'restock'>,
  shipPreference: BomConfirmShipPreferenceType | null,
): number {
  const splitFee = option.kind === 'wait_restock' && shipPreference === 'split'
    ? option.restock?.splitShippingFee ?? 0
    : 0;
  return option.priceDelta + splitFee;
}

/** VAT 포함 금액 참고값 — 공급가 차이 × 1.1, 원 단위 반올림. */
export function bomConfirmVatDelta(nextLineKrw: number | null, previousLineKrw: number | null): number | null {
  if (nextLineKrw === null || previousLineKrw === null) return null;
  return Math.round((nextLineKrw - previousLineKrw) * 1.1);
}
