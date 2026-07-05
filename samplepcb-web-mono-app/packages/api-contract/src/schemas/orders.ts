import { z } from 'zod';
import { AdminEstimateCompany } from './admin';

// ── 관리자 주문내역(/app/admin/orders, sp-vue) 계약 ─────────────────────────
// 레거시 /adm/shop_admin/orderlist.php(영카트 주문관리)를 sp-vue 로 마이그레이션.
// 이번 WP 는 **읽기 경로만**(목록/상세) — 상태 전이·삭제·엑셀배송은 다음 WP.
// 전 라우트가 requireAdmin(JWT isAdmin) 뒤에 있고, 백엔드는 g5_shop_order/g5_shop_cart
// read-only SELECT(한정 예외 ⑫, lib/g5-db.ts) + sp_order_spec/sp_file 조인(Prisma)으로
// 구현한다. 응답은 이 response 스키마로 직렬화되어 미선언 필드(민감 컬럼: od_pwd·
// od_cash·od_cash_info)가 구조적으로 탈락한다 — 단 민감 컬럼은 SELECT 자체에서도 배제.

// 쿼리스트링 boolean 플래그 — z.coerce.boolean() 은 'false' 문자열도 true 로 만드는
// 함정이 있어 명시적 토큰 비교로 강제한다. 미전달(undefined)은 그대로 통과(필터 미적용).
// 프런트는 체크 시에만 전송하지만, 오전송('false'/'0') 방어를 위해 파싱을 명시한다.
const orderBoolFlag = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1')
  .optional();

// 주문상태 탭 — 한글 리터럴 패스스루(DB 저장값 그대로, 매핑 금지). PHP 원본과 다른 점:
//   '취소' = od_status='취소'(스톡의 '전체취소' 라벨) · '부분취소' = od_status IN(진행상태들)
//   AND od_cancel_price>0. '전체' 는 상태 조건 없음.
export const AdminOrderTab = z.enum([
  '전체',
  '주문',
  '입금',
  '준비',
  '배송',
  '완료',
  '취소',
  '부분취소',
]);
export type AdminOrderTabType = z.infer<typeof AdminOrderTab>;

// 목록 쿼리. qField+q 는 둘 다 있을 때만 LIKE '%q%'(escape 필수). from/to 는 od_time
// 범위(KST native 문자열 비교). settleCase '간편결제' 는 IN 확장. 플래그 5종은 조건부.
export const AdminOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: AdminOrderTab.default('전체'),
  qField: z
    .enum([
      'od_id',
      'mb_id',
      'od_name',
      'od_tel',
      'od_hp',
      'od_b_name',
      'od_b_tel',
      'od_b_hp',
      'od_deposit_name',
      'od_invoice',
    ])
    .optional(),
  q: z.string().optional(), // qField 대상 contains (qField 와 동반 필수)
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // od_time >= 'from 00:00:00'
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // od_time <= 'to 23:59:59'
  settleCase: z.string().optional(), // 결제수단 등호(‘간편결제’만 IN 확장)
  misu: orderBoolFlag, // od_misu <> 0 (미수금)
  cancelled: orderBoolFlag, // od_cancel_price <> 0 (반품/품절)
  refund: orderBoolFlag, // od_refund_price <> 0 (환불)
  point: orderBoolFlag, // od_receipt_point <> 0 (포인트주문)
  coupon: orderBoolFlag, // od_cart_coupon+od_coupon+od_send_coupon > 0 (쿠폰)
  sort: z
    .enum(['od_id', 'od_cart_price', 'od_receipt_price', 'od_cancel_price', 'od_misu', 'od_time'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type AdminOrderListQueryType = z.infer<typeof AdminOrderListQuery>;

// 탭 카운트 — 검색·기간·결제수단·플래그 필터는 반영, 탭 자체는 미반영(배타 집계).
// 8키 전부(= 현재 필터 집합에서 각 탭이 잡는 건수). total 은 선택 탭의 카운트와 동일.
export const AdminOrderCounts = z.object({
  전체: z.number(),
  주문: z.number(),
  입금: z.number(),
  준비: z.number(),
  배송: z.number(),
  완료: z.number(),
  취소: z.number(),
  부분취소: z.number(),
});
export type AdminOrderCountsType = z.infer<typeof AdminOrderCounts>;

// 목록·상세 공용 코어(주문 헤더 요약). status 는 z.string() — od_status 는 운영이 커스텀
// 값을 넣을 수 있어(메모: 운영 커스텀 상태) enum 으로 좁히면 직렬화가 500 날 위험이 있다.
// 입력측 tab 만 고정 enum 이고, 출력 status 는 DB 값 패스스루(방어적 선택).
export const AdminOrderCore = z.object({
  odId: z.string(), // od_id (varchar — bigint 정밀도 방어 목적의 string 표현)
  odName: z.string(), // 주문자
  mbId: z.string(), // '' = 비회원
  odTel: z.string(),
  odHp: z.string(),
  odBName: z.string(), // 받는분
  status: z.string(), // od_status 한글 패스스루
  settleCase: z.string(), // od_settle_case
  orderPrice: z.number(), // od_cart_price+od_send_cost+od_send_cost2 (SQL 계산)
  receiptPrice: z.number(), // od_receipt_price
  cancelPrice: z.number(), // od_cancel_price
  couponPrice: z.number(), // od_cart_coupon+od_coupon+od_send_coupon (SQL 계산)
  misu: z.number(), // od_misu
  cartCount: z.number(), // od_cart_count
  deliveryCompany: z.string().nullable(), // od_delivery_company, ''→null
  invoiceNo: z.string().nullable(), // od_invoice, ''→null
  invoiceTime: z.string().nullable(), // od_invoice_time, zero-date→null
  receiptTime: z.string().nullable(), // od_receipt_time, zero-date→null
  odTime: z.string(), // od_time (KST native 문자열)
  isMobile: z.boolean(), // od_mobile
  isTest: z.boolean(), // od_test
});
export type AdminOrderCoreType = z.infer<typeof AdminOrderCore>;

// 목록 행 = 코어 + 회원 누적주문수(비회원 0). 누적주문수는 페이지 mbId 배치 GROUP BY.
export const AdminOrderListItem = AdminOrderCore.extend({
  memberOrderCount: z.number(), // 회원의 전체 주문 건수(필터 무관), 비회원 0
});
export type AdminOrderListItemType = z.infer<typeof AdminOrderListItem>;

export const AdminOrderListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminOrderListItem),
    total: z.number(), // 탭 포함 필터 적용 건수(페이지네이션용)
    page: z.number(),
    pageSize: z.number(),
    counts: AdminOrderCounts,
  }),
});
export type AdminOrderListResponseType = z.infer<typeof AdminOrderListResponse>;

// 주소(주문자/받는분 공통 형태) — 값은 DB 원본 그대로(빈 값 판정은 FE).
export const AdminOrderAddress = z.object({
  zip1: z.string(),
  zip2: z.string(),
  addr1: z.string(),
  addr2: z.string(),
  addr3: z.string(),
  jibeon: z.string(), // *_addr_jibeon
});
export type AdminOrderAddressType = z.infer<typeof AdminOrderAddress>;

// 상세 헤더 = 코어 + 주문자 이메일/주소 + 받는분 전체 + 메모 + 금액 분해 + 결제 참조.
// 민감 컬럼(od_pwd·od_cash·od_cash_info)은 스키마에도 SELECT 에도 없다.
export const AdminOrderDetailOrder = AdminOrderCore.extend({
  email: z.string(), // od_email
  addr: AdminOrderAddress, // 주문자 주소(od_zip1/2·od_addr1~3·od_addr_jibeon)
  receiver: z.object({
    name: z.string(), // od_b_name
    tel: z.string(), // od_b_tel
    hp: z.string(), // od_b_hp
    zip1: z.string(),
    zip2: z.string(),
    addr1: z.string(),
    addr2: z.string(),
    addr3: z.string(),
    jibeon: z.string(), // od_b_addr_jibeon
  }),
  depositName: z.string(), // od_deposit_name
  memo: z.string(), // od_memo (주문자 요청)
  shopMemo: z.string(), // od_shop_memo (관리자 메모)
  hopeDate: z.string().nullable(), // od_hope_date, zero-date→null
  amounts: z.object({
    sendCost: z.number(), // od_send_cost
    sendCost2: z.number(), // od_send_cost2
    sendCoupon: z.number(), // od_send_coupon
    cartCoupon: z.number(), // od_cart_coupon
    coupon: z.number(), // od_coupon
    refundPrice: z.number(), // od_refund_price
    receiptPoint: z.number(), // od_receipt_point
    taxMny: z.number(), // od_tax_mny
    vatMny: z.number(), // od_vat_mny
    freeMny: z.number(), // od_free_mny
  }),
  payment: z.object({
    pg: z.string(), // od_pg
    tno: z.string(), // od_tno
    appNo: z.string(), // od_app_no
  }),
  ip: z.string(), // od_ip
});
export type AdminOrderDetailOrderType = z.infer<typeof AdminOrderDetailOrder>;

// 카트행(ct_id) 단위 라인 — GROUP BY 없이 실물 그대로. sp_order_spec 조인 시 quote 채움.
export const AdminOrderItemQuote = z.object({
  projectId: z.string(), // sp_order_spec.id (bigint → string)
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  specSummary: z.string(), // option-summary.ts 재사용(수량 포함 요약)
  thumbUrl: z.string().nullable(), // sp_file thumbnail 서명 URL(만료 있음), 없으면 null
  finalPrice: z.number().nullable(), // 관리자 확정가
});
export type AdminOrderItemQuoteType = z.infer<typeof AdminOrderItemQuote>;

export const AdminOrderCartItem = z.object({
  ctId: z.number(),
  itId: z.string(),
  itName: z.string(),
  ctOption: z.string(), // ct_option (사양 요약 스냅샷)
  ctQty: z.number(),
  ctPrice: z.number(),
  ioId: z.string(),
  ioType: z.number(),
  ioPrice: z.number(),
  ctStatus: z.string(), // ct_status (쇼핑/주문/…)
  ctSelect: z.number(), // ct_select 0/1
  quote: AdminOrderItemQuote.nullable(),
});
export type AdminOrderCartItemType = z.infer<typeof AdminOrderCartItem>;

export const AdminOrderDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({
    order: AdminOrderDetailOrder,
    items: z.array(AdminOrderCartItem),
    memberOrderCount: z.number(), // 회원 누적주문수(비회원 0)
  }),
});
export type AdminOrderDetailResponseType = z.infer<typeof AdminOrderDetailResponse>;

// ── 상태 전이·선택삭제 쓰기 계약 (WP: adm/shop_admin/orderlistupdate.php·orderlistdelete.php 이식) ─
// 레거시 일괄 상태 전이(주문→입금→준비→배송→완료)와 미입금 선택삭제를 sp-node 로 이식한다.
// 메일/SMS 는 Node 재구현이 아니라 PHP 브리지(spcb/api/order-notify.php) 재사용 — 커스텀된
// 주문 메일 템플릿(ordermail.mail.php, 견적 건별 표시)의 드리프트를 막기 위한 아키텍처 결정.
// 전이는 od 단위 독립 처리(하나 실패해도 나머지 진행) — 성공은 processed, 가드 위반은 skipped(reason).

// 배송 처리 입력 행 — target='배송'일 때 od 별 운송장 정보(코어 order_update_delivery 미러).
// invoiceTime 은 g5 관례상 'YYYY-MM-DD HH:MM:SS' KST native 문자열.
export const AdminOrderDeliveryRow = z.object({
  odId: z.string().min(1).max(20),
  deliveryCompany: z.string().min(1), // od_delivery_company
  invoiceNo: z.string().min(1), // od_invoice
  invoiceTime: z.string().min(1), // od_invoice_time
});
export type AdminOrderDeliveryRowType = z.infer<typeof AdminOrderDeliveryRow>;

// 상태 전이 요청 — target(전이 후 상태)·odIds(선택)·알림 플래그. 배송이면 delivery 필수(refine).
// sendMail/sendSms 는 성공 전이 건에 한해 PHP 브리지로 발송(입금·배송 전이만 — 코어가 준비·완료
// 전이에선 알림을 보내지 않음. 브리지 gating 은 라우트가 담당).
export const AdminOrderStatusRequest = z
  .object({
    target: z.enum(['입금', '준비', '배송', '완료']),
    odIds: z.array(z.string().min(1).max(20)).min(1),
    sendMail: z.boolean().default(false),
    sendSms: z.boolean().default(false),
    delivery: z.array(AdminOrderDeliveryRow).optional(),
  })
  .refine((v) => v.target !== '배송' || (v.delivery !== undefined && v.delivery.length > 0), {
    message: 'target=배송 이면 delivery 가 필요합니다',
    path: ['delivery'],
  });
export type AdminOrderStatusRequestType = z.infer<typeof AdminOrderStatusRequest>;

// 선택삭제 요청 — 미입금(od_status='주문')만 대상(코어 orderlistdelete.php: 백업→cart 삭제→order DELETE).
export const AdminOrderDeleteRequest = z.object({
  odIds: z.array(z.string().min(1).max(20)).min(1),
});
export type AdminOrderDeleteRequestType = z.infer<typeof AdminOrderDeleteRequest>;

// 전이/삭제 공통 응답 — processed(성공 od), skipped(가드 위반 od+reason), notify(성공 od별 발송 결과).
// reason 코드: NOT_FOUND · NOT_ORDER_STATUS · NOT_DEPOSIT_STATUS · NOT_READY_STATUS ·
//   NOT_SHIPPING_STATUS · NOT_BANK_TRANSFER · MISSING_INVOICE. notify 상태: sent|failed|skipped.
export const AdminOrderNotifyStatus = z.enum(['sent', 'failed', 'skipped']);
export type AdminOrderNotifyStatusType = z.infer<typeof AdminOrderNotifyStatus>;

export const AdminOrderActionResponse = z.object({
  result: z.literal(true),
  data: z.object({
    processed: z.array(z.string()),
    skipped: z.array(z.object({ odId: z.string(), reason: z.string() })),
    notify: z.array(
      z.object({
        odId: z.string(),
        mail: AdminOrderNotifyStatus.optional(),
        sms: AdminOrderNotifyStatus.optional(),
      }),
    ),
  }),
});
export type AdminOrderActionResponseType = z.infer<typeof AdminOrderActionResponse>;

// ── 주문 상세 편집 + 입금 조정 + 인쇄 계약 (adm/shop_admin/orderformupdate.php·
// orderformreceiptupdate.php·orderprint 이식) ───────────────────────────────────
// info/memo 는 상태 무관(코어 orderformupdate.php 동일). 입금 조정은 무통장 한정·3필드로
// 좁혀 이식(코어 receiptupdate 의 배송/에스크로/재고/상태전이/메일 부수효과는 스코프 밖 — WP3
// 전이·배송이 담당). 부분 갱신 응답은 회원 ⑨-b 관례(에코 대신 { odId } → FE refetch).

// 주소 형식 플래그 — 'R'(도로명)·'J'(지번)·''(미상). 회원 mb_addr_jibeon 과 동일 의미.
const AddrJibeonFlag = z.enum(['R', 'J', '']);

// 주문자/받는분/배송지/희망일 부분 편집 — 전부 optional, 최소 1개(refine). zip 은 상세 스키마와
// 동일하게 zip1/zip2 분리 입력(코어는 합본 od_zip 을 서버가 분해 — FE 분리로 상위 이관).
export const AdminOrderInfoBody = z
  .object({
    odName: z.string().max(255).optional(),
    odEmail: z.string().max(255).optional(),
    odTel: z.string().max(255).optional(),
    odHp: z.string().max(255).optional(),
    zip1: z.string().max(10).optional(),
    zip2: z.string().max(10).optional(),
    addr1: z.string().max(255).optional(),
    addr2: z.string().max(255).optional(),
    addr3: z.string().max(255).optional(),
    addrJibeon: AddrJibeonFlag.optional(),
    bName: z.string().max(255).optional(),
    bTel: z.string().max(255).optional(),
    bHp: z.string().max(255).optional(),
    bZip1: z.string().max(10).optional(),
    bZip2: z.string().max(10).optional(),
    bAddr1: z.string().max(255).optional(),
    bAddr2: z.string().max(255).optional(),
    bAddr3: z.string().max(255).optional(),
    bAddrJibeon: AddrJibeonFlag.optional(),
    depositName: z.string().max(255).optional(),
    hopeDate: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: '수정할 필드가 최소 1개 필요합니다',
  });
export type AdminOrderInfoBodyType = z.infer<typeof AdminOrderInfoBody>;

// 관리자 메모(od_shop_memo) — ''=비움. od_memo(주문자 요청사항)는 편집 대상 아님(코어 동일).
export const AdminOrderMemoBody = z.object({ shopMemo: z.string().max(65535) });
export type AdminOrderMemoBodyType = z.infer<typeof AdminOrderMemoBody>;

// 무통장 입금 수동 조정 — 입금액·입금일시·입금자명. 수정 후 미수금 자동 재계산(recomputeOrderMoney).
export const AdminOrderReceiptBody = z.object({
  receiptPrice: z.number().int().min(0),
  receiptTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  depositName: z.string().max(255),
});
export type AdminOrderReceiptBodyType = z.infer<typeof AdminOrderReceiptBody>;

// 부분 편집 공통 응답 — 에코 대신 { odId }(FE refetch). 회원 ⑨-b 관례 미러.
export const AdminOrderEditResponse = z.object({
  result: z.literal(true),
  data: z.object({ odId: z.string() }),
});
export type AdminOrderEditResponseType = z.infer<typeof AdminOrderEditResponse>;

// 주문서 인쇄 데이터 — 상세(order+items) + 발신처(seller, 견적서 발신처 스키마 재사용).
export const AdminOrderPrintResponse = z.object({
  result: z.literal(true),
  data: z.object({
    order: AdminOrderDetailOrder,
    items: z.array(AdminOrderCartItem),
    seller: AdminEstimateCompany,
  }),
});
export type AdminOrderPrintResponseType = z.infer<typeof AdminOrderPrintResponse>;

// ── 카트행 단위 취소/반품/품절 (adm/shop_admin/orderformcartupdate.php 이식, 무통장 한정) ──
// 주문의 개별 카트행(ct_id)을 취소/반품/품절로 전환. 부수효과: 재고 복원(ct_stock_use=1 행만)·
// 미수금/취소금액 재계산·전량 취소류면 od_status='취소'. PG 결제건은 무통장 guard(409)로 제외
// (PG 부분취소는 PHP 도메인 존치). 취소된 견적행은 주문내역에 남고 견적관리로 되돌리지 않는다
// (독립 모델 — sp_order_spec/sp_quote 무접촉). ct 단위 독립 처리(processed/skipped).
export const AdminOrderItemStatusRequest = z.object({
  ctIds: z.array(z.number().int().positive()).min(1),
  target: z.enum(['취소', '반품', '품절']),
});
export type AdminOrderItemStatusRequestType = z.infer<typeof AdminOrderItemStatusRequest>;

// reason 코드: NOT_IN_ORDER(ct 가 이 주문 소속 아님) · ALREADY_CANCELLED(이미 취소류) ·
//   HAS_POINT(포인트 딸린 행 — PCB 는 ct_point=0 이라 미발생, 구주문 유입 대비 안전판 → PHP 관리자로).
// odStatus: 재계산 후 주문 상태 · orderCancelled: 전량 취소류로 od_status='취소' 전환됐는지(FE 헤더 반영).
export const AdminOrderItemActionResponse = z.object({
  result: z.literal(true),
  data: z.object({
    processed: z.array(z.number()),
    skipped: z.array(z.object({ ctId: z.number(), reason: z.string() })),
    odStatus: z.string(),
    orderCancelled: z.boolean(),
  }),
});
export type AdminOrderItemActionResponseType = z.infer<typeof AdminOrderItemActionResponse>;
