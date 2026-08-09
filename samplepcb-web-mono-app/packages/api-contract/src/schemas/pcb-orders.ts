import { z } from 'zod';

// ── PCB 주문·결제 워크큐(P3.5 — /api/admin/pcb-orders) ───────────────────────
// 주문 축 조감(SmartBOM 주문·결제와 같은 역할, 구현은 PCB 전용): sp_order_spec 의
// 주문 연결분(ctId→cart→od)을 od 상태 탭으로 나눈다. 레거시 이관 주문 2만여 건이
// 이 워크큐의 이력 모수라 **서버(SQL) 페이지네이션이 전제**다(BOM 의 메모리 방식 금지).

export const ADMIN_PCB_ORDER_TABS = ['awaiting', 'active', 'done', 'canceled', 'all'] as const;

// 고객 배송 큐(P4.6) — 선적·배송 화면의 주문 축 마지막 구간. 협력 축은 입고확인이
// 종점이라 "입고 끝난 주문을 고객에게 발송"하는 대기가 어느 워크큐에도 없었다
// (SmartBOM 물류 ② 섹션의 PCB 대응). 판정은 od 상태 문자열이 아니라 협력 축
// 입고확인(관리자 수신 선적 receivedAt)이 정본 신호다 — force-status 혼용 대비.
export const ADMIN_PCB_ORDER_DELIVERY_TABS = ['to_ship', 'shipping'] as const;

const ADMIN_PCB_ORDER_ALL_TABS = [
  ...ADMIN_PCB_ORDER_TABS,
  ...ADMIN_PCB_ORDER_DELIVERY_TABS,
] as const;
export type AdminPcbOrderTabType = (typeof ADMIN_PCB_ORDER_ALL_TABS)[number];

export const ADMIN_PCB_ORDER_TAB_LABELS: Record<AdminPcbOrderTabType, string> = {
  awaiting: '입금 대기',
  active: '진행 중',
  done: '완료',
  canceled: '취소',
  all: '전체',
  to_ship: '고객 배송 대기',
  shipping: '고객 배송 중',
};

export const AdminPcbOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(ADMIN_PCB_ORDER_ALL_TABS).default('awaiting'),
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
  /** 관리자 수신 선적으로 입고확인이 끝난 발주서 수(입고 n/m 표시·미입고 발송 경고). */
  receivedPoCount: z.number().int(),
  deliveryCompany: z.string(), // od_delivery_company — 배송 처리 후 표시(없으면 '')
  invoiceNo: z.string(), // od_invoice
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
      toShip: z.number().int(), // 고객 배송 대기(입고확인 완료·배송 전)
      shipping: z.number().int(), // 고객 배송 중(od=배송·협력 선적 보유)
    }),
  }),
});
export type AdminPcbOrderListResponseType = z.infer<typeof AdminPcbOrderListResponse>;
