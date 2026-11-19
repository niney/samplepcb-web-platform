import { z } from 'zod';

// SmartSMT 의뢰 읽기 — samplepcb 가 보관한 의뢰를 내주는 주소의 계약 (docs/SMARTSMT_INTEGRATION.md §10).
//
// 의뢰 데이터(견적서 · 원본 파일 · 작업 상태 · 담당자 확정)는 samplepcb 한 곳에 둔다. 읽는 쪽은 둘이다.
//   ① SmartSMT 서버 — `/api/smartsmt/orders…` (SmartSMT 전용 토큰, 회원 아이디를 owner 로 넘긴다)
//      내 의뢰 목록 · 다시 부르기 · 검토서/견적서가 이 주소에서 읽는다. 전달 규격은 docs/SMARTSMT_REPLY.html 6장.
//   ② samplepcb 고객 화면 — `/api/smt/orders` (회원 JWT, 본인 것만). 마이페이지 견적관리의 SMT 행.
//
// ①의 칸 이름은 견적서(envelope)와 같은 밑줄 표기다 — 응답 안에 견적서가 그대로 실리고, 받는 쪽(SmartSMT)의 표기다.
// 견적서 전송의 응답(`data.quoteId`)은 이미 쓰이고 있어 그대로 둔다. ②는 다른 고객 API 와 같은 표기(camelCase).

/** 담당자 처리 상태 — 임시 저장은 밖에 알리지 않는다(REVIEWING). */
export const SMARTSMT_PUBLIC_REVIEW_STATUSES = ['REVIEWING', 'CONFIRMED'] as const;
export type SmartsmtPublicReviewStatus = (typeof SMARTSMT_PUBLIC_REVIEW_STATUSES)[number];

/** 회원 아이디 — 로그인 인계 토큰의 sub. SmartSMT 가 세션에서 꺼내 넘긴다. */
const Owner = z.string().trim().min(1).max(60);

export const SmartsmtOrderOwnerQuery = z.object({ owner: Owner });
export const SmartsmtOrderListQuery = z.object({
  owner: Owner,
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type SmartsmtOrderListQueryType = z.infer<typeof SmartsmtOrderListQuery>;

export const SmartsmtOrderListItem = z.object({
  order_id: z.string(),
  /** 의뢰 이름 — header.title, 없으면 올린 파일 이름, 그것도 없으면 주문 번호. */
  title: z.string(),
  processes: z.array(z.string()),
  /** samplepcb 가 보관한 견적번호(그 주문의 마지막 견적). */
  quote_id: z.string(),
  requested_at: z.string(),
  review_status: z.enum(SMARTSMT_PUBLIC_REVIEW_STATUSES),
  /** 받은 가견적 합계(부가세 포함). 오지 않았으면 null. */
  estimated_total: z.number().nullable(),
  /** 담당자가 확정한 합계(부가세 포함). 확정 전에는 null. */
  confirmed_total: z.number().nullable(),
  currency: z.string().nullable(),
});
export type SmartsmtOrderListItemType = z.infer<typeof SmartsmtOrderListItem>;

export const SmartsmtOrderListResponse = z.object({
  result: z.literal(true),
  data: z.object({ total: z.number(), items: z.array(SmartsmtOrderListItem) }),
});
export type SmartsmtOrderListResponseType = z.infer<typeof SmartsmtOrderListResponse>;

/** 보관한 원본 파일 한 줄 — `…/files/{part}` 로 내려받는다. */
export const SmartsmtOrderFile = z.object({
  part: z.string(),
  name: z.string(),
  bytes: z.number(),
  sha256: z.string().nullable(),
});
export type SmartsmtOrderFileType = z.infer<typeof SmartsmtOrderFile>;

export const SmartsmtOrderDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({
    order_id: z.string(),
    title: z.string(),
    quote_id: z.string(),
    requested_at: z.string(),
    review_status: z.enum(SMARTSMT_PUBLIC_REVIEW_STATUSES),
    confirmed_at: z.string().nullable(),
    /** 고객 안내 글. 없으면 빈 글자. */
    customer_note: z.string(),
    /** 받은 견적서 그대로. */
    envelope: z.record(z.string(), z.unknown()),
    /** 확정 금액을 채운 견적서(applySmartsmtReview). 확정 전에는 null. */
    confirmed_envelope: z.record(z.string(), z.unknown()).nullable(),
    /** 받은 작업 상태 그대로. 오지 않았으면 null. */
    state: z.unknown(),
    files: z.array(SmartsmtOrderFile),
  }),
});
export type SmartsmtOrderDetailResponseType = z.infer<typeof SmartsmtOrderDetailResponse>;

// ── 고객 화면 — GET /api/smt/orders (본인 의뢰만) ────────────────────────────────────────

export const SmtMyOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const SmtMyOrder = z.object({
  orderId: z.string(),
  title: z.string(),
  processes: z.array(z.string()),
  quoteId: z.string(),
  requestedAt: z.string(),
  reviewStatus: z.enum(['reviewing', 'confirmed']),
  /** 가견적 합계(부가세 포함). */
  estimatedTotal: z.number().nullable(),
  /** 확정 합계(부가세 포함). 확정 전에는 null. */
  confirmedTotal: z.number().nullable(),
  currency: z.string().nullable(),
  /** SmartSMT 화면으로 가는 주소. 설정이 없으면 null(링크를 걸지 않는다). */
  openUrl: z.string().nullable(),
});
export type SmtMyOrderType = z.infer<typeof SmtMyOrder>;

export const SmtMyOrderListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(SmtMyOrder), total: z.number() }),
});
export type SmtMyOrderListResponseType = z.infer<typeof SmtMyOrderListResponse>;
