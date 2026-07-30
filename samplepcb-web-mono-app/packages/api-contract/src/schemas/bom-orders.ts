import { z } from 'zod';

// ── 스마트 BOM 주문·결제(주문 축) — 계약 (D19, docs/SMARTBOM_PARTNER_RFQ.md §6.2) ──
// 전부 파생(저장 없음): sp_bom_quote.ctId → 카트(od_id) → od 헤더. D17 배치 주문으로
// 주문:Case = 1:N — 입금확인 같은 주문 단위 업무의 워크큐. 입금확인 액션 자체는
// 기존 PATCH /api/admin/orders/status(target='입금')를 재사용한다.

export const AdminBomOrderCase = z.object({
  quoteId: z.string(),
  title: z.string(),
  requestedAt: z.string().nullable(),
  createdAt: z.string(),
  confirmedTotal: z.number().nullable(),
  poCount: z.number().int(), // 발주서 수 — "발주 대기" 판정
});
export type AdminBomOrderCaseType = z.infer<typeof AdminBomOrderCase>;

export const AdminBomOrderListItem = z.object({
  odId: z.string(),
  orderedAt: z.string().nullable(),
  mbId: z.string(),
  odStatus: z.string(), // 영카트 od_status 원문(주문|입금|준비|…)
  isPaid: z.boolean(),
  settleCase: z.string(),
  cartPrice: z.number(), // 주문 금액(VAT 포함 — 카트 전환 시 확정가×1.1)
  receiptPrice: z.number(),
  misu: z.number(),
  cases: z.array(AdminBomOrderCase), // 연결 Case(배치 주문이면 여러 개)
});
export type AdminBomOrderListItemType = z.infer<typeof AdminBomOrderListItem>;

export const AdminBomOrderCounts = z.object({
  all: z.number().int(),
  awaitingPayment: z.number().int(), // od_status='주문'
  paidUnissued: z.number().int(), // 결제완료 + 발주서 없는 Case 존재
  done: z.number().int(),
});
export type AdminBomOrderCountsType = z.infer<typeof AdminBomOrderCounts>;

export const AdminBomOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'awaiting_payment', 'paid_unissued', 'done']).default('all'),
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
