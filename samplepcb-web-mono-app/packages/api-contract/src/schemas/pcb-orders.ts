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
  /** od_name 주문자명 — 큐의 '고객' 열 식별용(mb_id 는 로그인 아이디라 송장에 못 쓴다). */
  odName: z.string(),
  /** 고객 표시명 — od_name 이 비면 회원 mb_name 으로 메운다(lib/pcb-customer 단일 사전).
   *  '고객명' 열은 PCB 목록 전부가 이 필드 하나만 읽는다(odName 은 모달 라벨 등 기존 소비처). */
  customerName: z.string(),
  qty: z.number(),
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  finalPrice: z.number().nullable(),
  odId: z.string(),
  odStatus: z.string(), // '주문'(미입금)|'입금'|'준비'|'파일검사'|'생산중'|…|'완료'|'취소'
  /**
   * 이 스펙의 **주문 줄**이 취소류인가(줄 축 — od_status 와 다르다). 영카트는 줄 단위로
   * 취소하고 전량일 때만 od_status='취소' 라, 부분 취소된 줄은 odStatus 로는 살아 있는 줄과
   * 똑같이 보인다. 서버 가드와 고객 화면은 이미 줄 축을 보므로(08-11) 관리자 목록만 못 보면
   * "화면은 진행 중인데 서버는 409" 가 된다.
   */
  lineCanceled: z.boolean(),
  ctStatus: z.string(), // 이 PCB 스펙의 카트행 상태 — 부분취소면 odStatus 와 다를 수 있다.
  isPaid: z.boolean(),
  settleCase: z.string(), // od_settle_case — 무통장만 관리자 수동 입금확인 대상(서버 가드 동일)
  /** 이 PCB 카트행의 주문 시점 금액(io_type·수량 반영). */
  lineAmount: z.number(),
  /** 취소·쿠폰·배송비를 반영한 주문 전체 결제 대상액. */
  orderAmount: z.number(),
  /** 같은 주문에 포함된 PCB 줄 수. 주문 단위 액션의 영향 범위를 설명하는 값이다. */
  orderPcbCount: z.number().int().positive(),
  receiptPrice: z.number(), // od_receipt_price 현금 수납액(주문 헤더 단위)
  receiptPoint: z.number(), // od_receipt_point 사용 포인트(주문 헤더 단위)
  refundPrice: z.number(), // od_refund_price 환불 누계(주문 헤더 단위)
  /** 수납액 + 사용 포인트 - 환불 누계. */
  netReceipt: z.number(),
  /**
   * od_misu 잔여 미수금. isPaid 는 od_status 파생이라 '상태만 올린' 주문(force-status)도
   * 결제됨으로 보인다 — 그 어긋남을 화면에서 잡아내려면 이 값이 필요하다.
   */
  misu: z.number(),
  orderedAt: z.string().nullable(),
  poCount: z.number().int(), // 이 스펙의 협력사 발주서 수(전 회차)
  /** 관리자 수신 선적으로 입고확인이 끝난 발주서 수(입고 n/m 표시·미입고 발송 경고). */
  receivedPoCount: z.number().int(),
  /**
   * 직송지(D5) — **입고된**(receiverKind='admin' 선적의 receivedAt) 최상위 발주의
   * destinationCountry. non-null 이면 실물이 자사를 거치지 않고 이 나라의 고객에게 갔다 —
   * 고객 배송 큐는 운송장 입력 대신 [직송 완료](force-status '완료')가 od 종결 창구다
   * (정책 확정 08-10). 판정 축은 큐 소속 판정(PCB_TO_SHIP)과 같은 발주다 — 종결 대상이
   * 그 발주이기 때문. 입고분이 여럿이고 직송지가 섞이면 보수적으로 null(=[배송 처리]) —
   * 규칙 본문은 resolvePcbDirectShipCountry(판정 축 교정 08-11, 여정 11호 X9).
   */
  directShipCountry: z.string().nullable(),
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

// ── PCB 주문 취소 ────────────────────────────────────────────────────────────
// 영카트 orderformcartupdate.php 의 카트행 취소를 재사용하되, PCB 협력사 발주와 결제
// 상태를 먼저 확인한다. 미입금·무통장·발주 전만 sp-vue 에서 즉시 취소하며, PG/수납
// 주문은 원본 영카트의 승인취소·환불 경로로 보낸다.
export const PCB_ORDER_CANCEL_BLOCK_REASONS = [
  'ALREADY_CANCELED',
  'ORDER_CLOSED',
  'PARTNER_PROCESS_EXISTS',
  'PAYMENT_RECEIVED',
  'YOUNGCART_REQUIRED',
  'ORDER_STATE_CHANGED',
] as const;
export const PcbOrderCancelBlockReason = z.enum(PCB_ORDER_CANCEL_BLOCK_REASONS);
export type PcbOrderCancelBlockReasonType = z.infer<typeof PcbOrderCancelBlockReason>;

export const PCB_ORDER_CANCEL_BLOCK_LABELS: Record<PcbOrderCancelBlockReasonType, string> = {
  ALREADY_CANCELED: '이미 취소된 PCB 주문입니다.',
  ORDER_CLOSED: '완료된 주문은 취소 대신 반품 또는 A/S로 처리해야 합니다.',
  PARTNER_PROCESS_EXISTS: '협력사 발주가 있어 PCB Case에서 발주·선적을 먼저 정리해야 합니다.',
  PAYMENT_RECEIVED: '입금 또는 수납 내역이 있어 환불 확인과 함께 취소해야 합니다.',
  YOUNGCART_REQUIRED:
    '무통장 외 결제는 결제사 승인 취소가 필요해 영카트 주문관리에서 처리해야 합니다.',
  ORDER_STATE_CHANGED: '주문 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.',
};

export const AdminPcbOrderCancelPreviewResponse = z.object({
  result: z.literal(true),
  data: z.object({
    specId: z.number().int().positive(),
    projectName: z.string(),
    odId: z.string(),
    odStatus: z.string(),
    ctStatus: z.string(),
    settleCase: z.string(),
    receiptPrice: z.number(),
    poCount: z.number().int(),
    rfqCount: z.number().int(),
    activeSiblingCount: z.number().int(),
    cancelsWholeOrder: z.boolean(),
    cancelable: z.boolean(),
    blockReason: PcbOrderCancelBlockReason.nullable(),
    youngcartOrderUrl: z.string(),
  }),
});
export type AdminPcbOrderCancelPreviewResponseType = z.infer<
  typeof AdminPcbOrderCancelPreviewResponse
>;

export const AdminPcbOrderCancelRequest = z.object({
  reason: z.string().trim().min(2).max(500),
});
export type AdminPcbOrderCancelRequestType = z.infer<typeof AdminPcbOrderCancelRequest>;

export const AdminPcbOrderCancelResponse = z.object({
  result: z.literal(true),
  data: z.object({
    specId: z.number().int().positive(),
    ctId: z.number().int().positive(),
    odId: z.string(),
    odStatus: z.string(),
    orderCancelled: z.boolean(),
  }),
});
export type AdminPcbOrderCancelResponseType = z.infer<typeof AdminPcbOrderCancelResponse>;
