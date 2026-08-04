import { z } from 'zod';

// ── PCB 주문·결제 워크큐(P3.5 — /api/admin/pcb-orders) ───────────────────────
// 주문 축 조감(SmartBOM 주문·결제와 같은 역할, 구현은 PCB 전용): sp_order_spec 의
// 주문 연결분(ctId→cart→od)을 od 상태 탭으로 나눈다. 레거시 이관 주문 2만여 건이
// 이 워크큐의 이력 모수라 **서버(SQL) 페이지네이션이 전제**다(BOM 의 메모리 방식 금지).

export const ADMIN_PCB_ORDER_TABS = ['awaiting', 'active', 'done', 'canceled', 'all'] as const;
export type AdminPcbOrderTabType = (typeof ADMIN_PCB_ORDER_TABS)[number];

export const ADMIN_PCB_ORDER_TAB_LABELS: Record<AdminPcbOrderTabType, string> = {
  awaiting: '입금 대기',
  active: '진행 중',
  done: '완료',
  canceled: '취소',
  all: '전체',
};

export const AdminPcbOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(ADMIN_PCB_ORDER_TABS).default('awaiting'),
  q: z.string().optional(), // 프로젝트명·회원ID·주문번호 contains
});
export type AdminPcbOrderListQueryType = z.infer<typeof AdminPcbOrderListQuery>;

export const AdminPcbOrderItem = z.object({
  specId: z.number(),
  projectName: z.string(),
  mbId: z.string().nullable(),
  qty: z.number(),
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  finalPrice: z.number().nullable(),
  odId: z.string(),
  odStatus: z.string(), // '주문'(미입금)|'입금'|'준비'|'파일검사'|'생산중'|…|'완료'|'취소'
  isPaid: z.boolean(),
  settleCase: z.string(), // od_settle_case — 무통장만 관리자 수동 입금확인 대상(서버 가드 동일)
  receiptPrice: z.number(), // od_receipt_price 수납액(주문 헤더 단위)
  orderedAt: z.string().nullable(),
  poCount: z.number().int(), // 이 스펙의 협력사 발주서 수(전 회차)
});
export type AdminPcbOrderItemType = z.infer<typeof AdminPcbOrderItem>;

export const AdminPcbOrderListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbOrderItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: z.object({
      awaiting: z.number().int(),
      active: z.number().int(),
      done: z.number().int(),
      canceled: z.number().int(),
      all: z.number().int(),
    }),
  }),
});
export type AdminPcbOrderListResponseType = z.infer<typeof AdminPcbOrderListResponse>;
