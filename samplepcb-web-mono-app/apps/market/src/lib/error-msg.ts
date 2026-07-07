import { ApiRequestError } from '@sp/shared';

// 서버 비즈니스 에러 코드 → 사용자 메시지(단일 맵 — 전 화면 공유).
// 코드 정본은 sp-node market 라우트들의 { result:false, error:'CODE' } 응답.
const CODE_MESSAGES: Record<string, string> = {
  // 전문가
  ALREADY_APPLIED: '이미 전문가 등록 이력이 있습니다. 마이페이지에서 상태를 확인해 주세요.',
  BIZREG_REQUIRED: '기업(파트너사)은 사업자등록증 파일을 첨부해야 합니다.',
  NOT_REGISTERED: '전문가 등록 이력이 없습니다.',
  NOT_EDITABLE: '지금 상태에서는 수정할 수 없습니다.',
  CATEGORY_OR_CADTOOL_REQUIRED: '전문 분야 또는 CAD 툴을 1개 이상 선택해 주세요.',
  EXPERT_NOT_APPROVED: '승인된 전문가만 이용할 수 있는 기능입니다.',
  // 프로젝트
  DEADLINE_PAST: '견적 마감일이 이미 지났습니다. 날짜를 다시 선택해 주세요.',
  TARGET_EXPERT_REQUIRED: '지정견적은 대상 전문가를 선택해야 합니다.',
  TARGET_EXPERT_INVALID: '지정한 전문가를 찾을 수 없거나 활동 중이 아닙니다.',
  SELF_TARGET_FORBIDDEN: '본인을 지정견적 대상으로 선택할 수 없습니다.',
  HAS_BIDS: '이미 견적이 제출된 프로젝트는 수정할 수 없습니다.',
  NOT_BIDDING: '입찰 중 상태가 아닙니다.',
  NOT_CANCELLABLE: '취소할 수 없는 상태입니다.',
  NOT_AVAILABLE: '진행할 수 없는 프로젝트입니다.',
  // 입찰·NDA
  SELF_BID_FORBIDDEN: '내가 등록한 프로젝트에는 견적을 제출할 수 없습니다.',
  TARGETED_ONLY: '지정견적 프로젝트는 지정된 전문가만 참여할 수 있습니다.',
  BIDDING_CLOSED: '견적 접수가 마감된 프로젝트입니다.',
  ALREADY_BID: '이미 견적을 제출했습니다. 기존 견적을 수정해 주세요.',
  BID_FINALIZED: '이미 확정된 견적이라 변경할 수 없습니다.',
  NOT_AWARDABLE: '채택할 수 없는 상태입니다. 새로고침 후 다시 확인해 주세요.',
  BID_NOT_AWARDABLE: '채택할 수 없는 견적입니다(철회·종결됨).',
  NDA_REQUIRED: 'NDA 서명 후 열람할 수 있습니다.',
  NDA_NOT_REQUIRED: '이 프로젝트는 NDA 서명이 필요하지 않습니다.',
  FORBIDDEN: '접근 권한이 없습니다.',
  // 공통
  PAYLOAD_SCHEMA_MISMATCH: '입력값 형식이 올바르지 않습니다. 항목을 확인해 주세요.',
  FILE_UPLOAD_FAILED: '파일 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  FILE_DELETE_FAILED: '파일 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.',
};

export function errorMessage(
  err: unknown,
  fallback = '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.',
): string {
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined) {
      const mapped = CODE_MESSAGES[code];
      if (mapped !== undefined) return mapped;
    }
    if (err.status === 401) return '로그인이 필요합니다.';
    if (err.status === 404) return '대상을 찾을 수 없습니다.';
  }
  return fallback;
}
