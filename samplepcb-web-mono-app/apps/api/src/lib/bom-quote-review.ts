import type {
  AdminBomQuotePatchBodyType,
} from '@sp/api-contract';

// 고객에게 확정해 보낸 금액·문구는 주문 및 메일의 근거다. 완료 뒤에는 상태 전이만
// 허용하고, 내용을 바꾸려면 별도의 재검토 흐름으로 되돌리는 기능을 명시적으로 설계한다.
const REVIEW_FIELD_KEYS = [
  'adminMemo',
  'answerNote',
  'confirmedShippingFee',
  'confirmedManagementFee',
  'confirmedTotal',
] as const;

export const canEditBomQuoteReview = (status: string): boolean =>
  status === 'requested' || status === 'reviewing';

export const hasBomQuoteReviewChanges = (body: AdminBomQuotePatchBodyType): boolean =>
  REVIEW_FIELD_KEYS.some((key) => key in body);
