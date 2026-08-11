import type {
  BomClaimEligibilityReasonType,
  BomClaimEventActionType,
  BomClaimStatusType,
} from '@sp/api-contract';

const CLOSED_ORDER_LINE_STATUSES = new Set(['취소', '반품', '품절', '삭제']);
const CLAIMABLE_ORDER_STATUSES = new Set(['배송', '완료']);

export interface BomClaimEligibilityInput {
  ctId: number | null;
  order: { odStatus: string; ctStatus: string } | null;
  hasActiveClaim: boolean;
}

/** 배송이 시작된 활성 주문행만 접수 가능하다. 주문·환불 상태 판단은 항상 서버가 한다. */
export function resolveBomClaimEligibilityReason(
  input: BomClaimEligibilityInput,
): BomClaimEligibilityReasonType | null {
  if (input.ctId === null) return 'NO_ORDER';
  if (input.order === null) return 'ORDER_NOT_FOUND';
  if (CLOSED_ORDER_LINE_STATUSES.has(input.order.ctStatus)) return 'LINE_CLOSED';
  if (
    !CLAIMABLE_ORDER_STATUSES.has(input.order.odStatus)
    || !CLAIMABLE_ORDER_STATUSES.has(input.order.ctStatus)
  ) return 'NOT_DELIVERED';
  if (input.hasActiveClaim) return 'ACTIVE_CLAIM';
  return null;
}

export type BomClaimAdminAction = Exclude<BomClaimEventActionType, 'submitted'>;

const CLAIM_TRANSITIONS: Record<
  BomClaimAdminAction,
  { from: BomClaimStatusType; to: BomClaimStatusType }
> = {
  review_started: { from: 'open', to: 'reviewing' },
  resolved: { from: 'reviewing', to: 'resolved' },
  rejected: { from: 'reviewing', to: 'rejected' },
};

/** 관리자 전이는 접수→검토→해결/반려 단방향이다. */
export function resolveBomClaimTransition(
  status: BomClaimStatusType,
  action: BomClaimAdminAction,
): BomClaimStatusType | null {
  const transition = CLAIM_TRANSITIONS[action];
  return transition.from === status ? transition.to : null;
}

export interface ClaimableQuoteItem {
  id: bigint;
  orderQty: number;
}

export interface RequestedClaimItem {
  quoteItemId: string;
  affectedQty: number;
}

export type BomClaimItemValidationError =
  | 'DUPLICATE_ITEM'
  | 'ITEM_NOT_FOUND'
  | 'AFFECTED_QTY_EXCEEDS_ORDER';

/** 선택 품목의 소유·중복·영향 수량을 서버 스냅샷과 대조한다. */
export function validateBomClaimItems(
  claimableItems: ClaimableQuoteItem[],
  requestedItems: RequestedClaimItem[],
): BomClaimItemValidationError | null {
  const byId = new Map(claimableItems.map((item) => [String(item.id), item]));
  const seen = new Set<string>();
  for (const requested of requestedItems) {
    if (seen.has(requested.quoteItemId)) return 'DUPLICATE_ITEM';
    seen.add(requested.quoteItemId);
    const item = byId.get(requested.quoteItemId);
    if (item === undefined) return 'ITEM_NOT_FOUND';
    if (requested.affectedQty > item.orderQty) return 'AFFECTED_QTY_EXCEEDS_ORDER';
  }
  return null;
}

export const isBomClaimActive = (status: string): boolean =>
  status === 'open' || status === 'reviewing';
