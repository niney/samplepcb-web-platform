import { z } from 'zod';

// ── 스마트 BOM 주문·결제(주문 축) — 계약 (D19, docs/SMARTBOM_PARTNER_RFQ.md §6.2) ──
// 전부 파생(저장 없음): sp_bom_quote.ctId → 카트(od_id) → od 헤더. D17 배치 주문으로
// 주문:Case = 1:N — 입금확인 같은 주문 단위 업무의 워크큐. 입금확인 액션 자체는
// 기존 PATCH /api/admin/orders/status(target='입금')를 재사용한다.

export const AdminBomOrderCase = z.object({
  quoteId: z.string(),
  ctId: z.number().int().positive(),
  title: z.string(),
  requestedAt: z.string().nullable(),
  createdAt: z.string(),
  confirmedTotal: z.number().nullable(),
  /** 이 주문 시도에 박제된 영카트 카트행 상태. */
  ctStatus: z.string(),
  /** quote.ctId가 현재 가리키는 최신 주문 시도인지 여부. */
  isCurrentAttempt: z.boolean(),
  /** 취소·반품·품절·삭제로 이행이 끝난 주문행인지 여부. */
  isCanceled: z.boolean(),
  poCount: z.number().int(), // 발주서 수 — "발주 대기" 판정
  poReceivedCount: z.number().int(), // 입고 확인된 발주서 수(D21) — "입고 완료" 표시
});
export type AdminBomOrderCaseType = z.infer<typeof AdminBomOrderCase>;

export const AdminBomOrderListItem = z.object({
  odId: z.string(),
  orderedAt: z.string().nullable(),
  mbId: z.string(),
  /** 주문 시점 주문자 정보 — 배송 안내 메일 수신처를 관리자에게 명시한다. */
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string(),
  /** 주문 시점 받는 분·배송지 스냅샷(g5_shop_order od_b_*). */
  recipientName: z.string(),
  recipientPhone: z.string(),
  recipientZip: z.string(),
  recipientAddress: z.string(),
  odStatus: z.string(), // 영카트 od_status 원문(주문|입금|준비|…)
  isPaid: z.boolean(),
  settleCase: z.string(),
  /** 상품 합계(od_cart_price). 배송비를 포함한 실제 주문 합계가 아니다. */
  cartPrice: z.number(),
  /** 취소·반품·품절 처리된 상품 금액(od_cancel_price). */
  cancelPrice: z.number(),
  /** 기본·추가 배송비 합계(od_send_cost + od_send_cost2). */
  shippingPrice: z.number(),
  /** 현재 결제 대상 합계(상품 합계 - 취소 금액 + 기본·추가 배송비). */
  orderPrice: z.number(),
  receiptPrice: z.number(),
  misu: z.number(),
  cases: z.array(AdminBomOrderCase), // 연결 Case(배치 주문이면 여러 개)
});
export type AdminBomOrderListItemType = z.infer<typeof AdminBomOrderListItem>;

// 탭은 역할별 메뉴가 나눠 쓴다(관리자 메뉴 재편): 주문·결제=awaiting_payment|paid|
// completed, 발주=paid_unissued, 선적·배송(고객 배송 큐)=to_ship|shipping.
export const AdminBomOrderCounts = z.object({
  all: z.number().int(),
  awaitingPayment: z.number().int(), // od_status='주문'
  paid: z.number().int(), // 결제 완료(취소 제외 — 배송·완료 포함 조회)
  paidUnissued: z.number().int(), // 결제완료 + 발주서 없는 Case 존재 → 발주 메뉴 큐
  toShip: z.number().int(), // 결제완료 + od_status 입금|준비 — 고객 배송 처리 대상
  shipping: z.number().int(), // od_status='배송' — 구매확정 대상
  completed: z.number().int(), // od_status='완료'
});
export type AdminBomOrderCountsType = z.infer<typeof AdminBomOrderCounts>;

export const AdminBomOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z
    .enum(['all', 'awaiting_payment', 'paid', 'paid_unissued', 'to_ship', 'shipping', 'completed'])
    .default('all'),
});
export type AdminBomOrderListQueryType = z.infer<typeof AdminBomOrderListQuery>;

export const AdminBomOrderListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomOrderListItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: AdminBomOrderCounts,
  }),
});
export type AdminBomOrderListResponseType = z.infer<typeof AdminBomOrderListResponse>;

// ── 스마트 BOM 주문 취소·재주문(D30) ───────────────────────────────────────
// 영카트 카트행 취소를 재사용하되, 즉시 취소는 미입금 무통장·발주 전으로 제한한다.
// 취소된 견적은 answered 상태와 과거 주문행을 보존하고 새 ct 행으로 재주문할 수 있다.
export const BOM_ORDER_CANCEL_BLOCK_REASONS = [
  'ALREADY_CANCELED',
  'ORDER_CLOSED',
  'PARTNER_PROCESS_EXISTS',
  'PAYMENT_RECEIVED',
  'YOUNGCART_REQUIRED',
  'ORDER_STATE_CHANGED',
] as const;
export const BomOrderCancelBlockReason = z.enum(BOM_ORDER_CANCEL_BLOCK_REASONS);
export type BomOrderCancelBlockReasonType = z.infer<typeof BomOrderCancelBlockReason>;

export const BOM_ORDER_CANCEL_BLOCK_LABELS: Record<BomOrderCancelBlockReasonType, string> = {
  ALREADY_CANCELED: '이미 취소된 BOM 주문입니다.',
  ORDER_CLOSED: '완료된 주문은 취소 대신 반품 또는 별도 고객 대응으로 처리해야 합니다.',
  PARTNER_PROCESS_EXISTS: '협력사·공급사 발주가 있어 Case에서 발주·선적을 먼저 확인해야 합니다.',
  PAYMENT_RECEIVED: '입금 또는 수납 내역이 있어 환불 확인과 함께 취소해야 합니다.',
  YOUNGCART_REQUIRED:
    '무통장 외 결제는 결제사 승인 취소가 필요해 영카트 주문관리에서 처리해야 합니다.',
  ORDER_STATE_CHANGED: '주문 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.',
};

export const AdminBomOrderCancelPreviewResponse = z.object({
  result: z.literal(true),
  data: z.object({
    quoteId: z.string(),
    title: z.string(),
    ctId: z.number().int().positive(),
    odId: z.string(),
    odStatus: z.string(),
    ctStatus: z.string(),
    settleCase: z.string(),
    receiptPrice: z.number(),
    poCount: z.number().int(),
    activeSiblingCount: z.number().int(),
    cancelsWholeOrder: z.boolean(),
    cancelable: z.boolean(),
    blockReason: BomOrderCancelBlockReason.nullable(),
    youngcartOrderUrl: z.string(),
  }),
});
export type AdminBomOrderCancelPreviewResponseType = z.infer<
  typeof AdminBomOrderCancelPreviewResponse
>;

export const AdminBomOrderCancelRequest = z.object({
  reason: z.string().trim().min(2).max(500),
});
export type AdminBomOrderCancelRequestType = z.infer<typeof AdminBomOrderCancelRequest>;

export const AdminBomOrderCancelResponse = z.object({
  result: z.literal(true),
  data: z.object({
    quoteId: z.string(),
    ctId: z.number().int().positive(),
    odId: z.string(),
    odStatus: z.string(),
    orderCancelled: z.boolean(),
  }),
});
export type AdminBomOrderCancelResponseType = z.infer<typeof AdminBomOrderCancelResponse>;
