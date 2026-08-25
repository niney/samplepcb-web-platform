import { z } from 'zod';

// 배송·완료 후 Smart BOM 고객 문제 접수(D37). 주문 취소·환불을 자동 실행하지 않고
// 별도 서비스 원장에서 접수→검토→해결/반려를 추적한다.

export const BomClaimStatus = z.enum(['open', 'reviewing', 'resolved', 'rejected']);
export type BomClaimStatusType = z.infer<typeof BomClaimStatus>;

export const BOM_CLAIM_STATUS_LABELS: Record<BomClaimStatusType, string> = {
  open: '접수됨',
  reviewing: '검토 중',
  resolved: '해결 완료',
  rejected: '처리 불가',
};

export const BomClaimKind = z.enum(['missing', 'damaged', 'wrong_part', 'quality', 'other']);
export type BomClaimKindType = z.infer<typeof BomClaimKind>;

export const BOM_CLAIM_KIND_LABELS: Record<BomClaimKindType, string> = {
  missing: '수량 누락',
  damaged: '파손',
  wrong_part: '다른 부품 도착',
  quality: '품질·동작 이상',
  other: '기타',
};

export const BomClaimResolutionKind = z.enum([
  'replacement',
  'refund_coordination',
  'credit',
  'guidance',
]);
export type BomClaimResolutionKindType = z.infer<typeof BomClaimResolutionKind>;

export const BOM_CLAIM_RESOLUTION_LABELS: Record<BomClaimResolutionKindType, string> = {
  replacement: '대체품 발송',
  refund_coordination: '환불 별도 협의',
  credit: '차감·보상 협의',
  guidance: '사용·기술 안내',
};

export const BomClaimEligibilityReason = z.enum([
  'NO_ORDER',
  'ORDER_NOT_FOUND',
  'NOT_DELIVERED',
  'LINE_CLOSED',
  'ACTIVE_CLAIM',
]);
export type BomClaimEligibilityReasonType = z.infer<typeof BomClaimEligibilityReason>;

export const BOM_CLAIM_ELIGIBILITY_LABELS: Record<BomClaimEligibilityReasonType, string> = {
  NO_ORDER: '주문이 완료된 뒤 문제를 접수할 수 있습니다.',
  ORDER_NOT_FOUND: '연결된 주문 정보를 찾을 수 없습니다. 고객센터에 문의해 주세요.',
  NOT_DELIVERED: '배송이 시작된 뒤 누락·파손·오배송 문제를 접수할 수 있습니다.',
  LINE_CLOSED: '취소·반품·품절 처리된 주문행에서는 새 문제를 접수할 수 없습니다.',
  ACTIVE_CLAIM: '처리 중인 접수가 있습니다. 기존 접수 결과를 먼저 확인해 주세요.',
};

export const BomClaimOrderSnapshot = z.object({
  odId: z.string(),
  odStatus: z.string(),
  ctStatus: z.string(),
  settleCase: z.string(),
  receiptPrice: z.number(),
});
export type BomClaimOrderSnapshotType = z.infer<typeof BomClaimOrderSnapshot>;

export const BomClaimItem = z.object({
  id: z.string(),
  quoteItemId: z.string(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  orderedQty: z.number().int().positive(),
  affectedQty: z.number().int().positive(),
});
export type BomClaimItemType = z.infer<typeof BomClaimItem>;

export const BomClaimEventAction = z.enum([
  'submitted',
  'review_started',
  'resolved',
  'rejected',
]);
export type BomClaimEventActionType = z.infer<typeof BomClaimEventAction>;

export const BomClaimEvent = z.object({
  id: z.string(),
  action: BomClaimEventAction,
  actorRole: z.enum(['customer', 'admin']),
  actorMbId: z.string(),
  fromStatus: BomClaimStatus.nullable(),
  toStatus: BomClaimStatus,
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type BomClaimEventType = z.infer<typeof BomClaimEvent>;

export const BomClaim = z.object({
  id: z.string(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  mbId: z.string(),
  odId: z.string(),
  ctId: z.number().int(),
  status: BomClaimStatus,
  kind: BomClaimKind,
  subject: z.string(),
  description: z.string(),
  orderSnapshot: BomClaimOrderSnapshot,
  version: z.number().int().positive(),
  adminMbId: z.string().nullable(),
  adminResponse: z.string().nullable(),
  resolutionKind: BomClaimResolutionKind.nullable(),
  submittedAt: z.string().datetime(),
  reviewStartedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  items: z.array(BomClaimItem),
  events: z.array(BomClaimEvent),
});
export type BomClaimType = z.infer<typeof BomClaim>;

export const BomClaimEligibility = z.object({
  canSubmit: z.boolean(),
  reason: BomClaimEligibilityReason.nullable(),
  activeClaimId: z.string().nullable(),
  order: BomClaimOrderSnapshot.nullable(),
});
export type BomClaimEligibilityType = z.infer<typeof BomClaimEligibility>;

export const BomClaimListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    eligibility: BomClaimEligibility,
    claims: z.array(BomClaim),
  }),
});
export type BomClaimListResponseType = z.infer<typeof BomClaimListResponse>;

// ── 고객: 견적을 가로지르는 "내 문제 접수"(마이페이지 /shop/as 부품 탭) ────────
// 위 목록은 견적 하나(quoteId)의 뷰다. 이쪽은 회원 전체 — 접수할 수 있는 배송 완료
// 주문과 낸 접수 내역. 접수 폼은 여기 없다(/app/bom/:id 한 곳). PCB 계약과 값이 비슷해도
// 여기 따로 선다(트랙 간 어휘 격리 관례).
export const BomClaimMineQuery = z.object({
  scope: z.enum(['open', 'all']).default('open'),
});
export type BomClaimMineQueryType = z.infer<typeof BomClaimMineQuery>;

export const BomClaimableRow = z.object({
  quoteId: z.string(),
  ctId: z.number().int(),
  odId: z.string(),
  title: z.string(),
  orderedAt: z.string(),
});
export type BomClaimableRowType = z.infer<typeof BomClaimableRow>;

export const BomClaimMineResponse = z.object({
  result: z.literal(true),
  data: z.object({
    claimable: z.array(BomClaimableRow),
    claimableTruncated: z.boolean(),
    claims: z.array(BomClaim),
    openCount: z.number().int(),
  }),
});
export type BomClaimMineResponseType = z.infer<typeof BomClaimMineResponse>;

export const BomClaimCreateRequest = z.object({
  kind: BomClaimKind,
  subject: z.string().trim().min(5).max(120),
  description: z.string().trim().min(10).max(2_000),
  items: z.array(z.object({
    quoteItemId: z.string().regex(/^\d+$/),
    affectedQty: z.number().int().positive(),
  })).min(1).max(200),
  /** 접수는 주문 취소·환불을 자동 실행하지 않는다는 고객의 명시 확인. */
  acknowledgeNoAutomaticRefund: z.literal(true),
});
export type BomClaimCreateRequestType = z.infer<typeof BomClaimCreateRequest>;

export const BomClaimCreateResponse = z.object({ result: z.literal(true), data: BomClaim });
export type BomClaimCreateResponseType = z.infer<typeof BomClaimCreateResponse>;

export const AdminBomClaimListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['all', 'pending', 'open', 'reviewing', 'resolved', 'rejected']).default('pending'),
  search: z.string().trim().max(100).optional(),
});
export type AdminBomClaimListQueryType = z.infer<typeof AdminBomClaimListQuery>;

export const AdminBomClaimCounts = z.object({
  all: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  reviewing: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});
export type AdminBomClaimCountsType = z.infer<typeof AdminBomClaimCounts>;

export const AdminBomClaimListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(BomClaim),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    counts: AdminBomClaimCounts,
  }),
});
export type AdminBomClaimListResponseType = z.infer<typeof AdminBomClaimListResponse>;

export const AdminBomClaimDetailResponse = z.object({ result: z.literal(true), data: BomClaim });
export type AdminBomClaimDetailResponseType = z.infer<typeof AdminBomClaimDetailResponse>;

const ExpectedClaimVersion = z.number().int().positive();

export const AdminBomClaimTransitionRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_review'), expectedVersion: ExpectedClaimVersion }),
  z.object({
    action: z.literal('resolve'),
    expectedVersion: ExpectedClaimVersion,
    resolutionKind: BomClaimResolutionKind,
    response: z.string().trim().min(10).max(2_000),
  }),
  z.object({
    action: z.literal('reject'),
    expectedVersion: ExpectedClaimVersion,
    response: z.string().trim().min(10).max(2_000),
  }),
]);
export type AdminBomClaimTransitionRequestType = z.infer<typeof AdminBomClaimTransitionRequest>;

export const AdminBomClaimTransitionResponse = z.object({ result: z.literal(true), data: BomClaim });
export type AdminBomClaimTransitionResponseType = z.infer<typeof AdminBomClaimTransitionResponse>;
