import { ApiRequestError } from '@sp/shared';
import { apiErrorMessage } from '@sp/ui';

// 서버 비즈니스 에러 코드 → 사용자 메시지(단일 맵). 코드 정본은 sp-node develop 라우트들의 { result:false, error:'CODE' }.
const CODE_MESSAGES: Record<string, string> = {
  NOT_EDITABLE: '견적이 나간 뒤에는 의뢰 내용을 수정할 수 없습니다. 문의로 남겨 주세요.',
  NOT_CANCELLABLE: '개발이 시작된 의뢰는 여기서 취소할 수 없습니다. 담당자에게 문의해 주세요.',
  INVALID_TRANSITION: '지금 상태에서는 처리할 수 없습니다. 새로고침 후 다시 확인해 주세요.',
  ATTACHMENT_FIELD_INVALID: '첨부 자료의 분야·항목이 선택한 개발 분야와 맞지 않습니다.',
  PAYLOAD_SCHEMA_MISMATCH: '입력값 형식이 올바르지 않습니다. 항목을 확인해 주세요.',
  FILE_UPLOAD_FAILED: '파일 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  FILE_DELETE_FAILED: '파일 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  LOCKED_UNTIL_PAID: '잔금 결제가 확인되면 내려받을 수 있습니다.',
  FORBIDDEN: '접근 권한이 없습니다.',
  QUOTE_NOT_OPEN: '이미 처리된 견적입니다.',
  QUOTE_EXPIRED: '견적 유효기간이 지났습니다. 담당자에게 재견적을 요청해 주세요.',
  NOT_PAYABLE: '지금은 결제할 수 없는 단계입니다.',
  ALREADY_PAID: '이미 결제된 항목입니다.',
  ORDER_PENDING: '입금 대기 중인 주문이 있습니다. 입금이 확인되면 자동으로 반영됩니다.',
  NO_CART_ID: '결제 세션이 만료되었습니다. 새로고침 후 다시 시도해 주세요.',
  ANCHOR_ITEM_MISSING: '결제 준비가 되지 않았습니다. 담당자에게 문의해 주세요.',
};

export function errorMessage(err: unknown, fallback = '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.'): string {
  return apiErrorMessage(err, fallback, CODE_MESSAGES);
}

// 코드 자체가 필요한 자리(재시도 분기 등) — 문구 비교로 갈래를 나누면 사전이 바뀔 때 조용히 깨진다.
export function errorCode(err: unknown): string | null {
  return err instanceof ApiRequestError ? (err.payload?.error ?? null) : null;
}
