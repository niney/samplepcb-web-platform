import type {
  AdminBomCaseDeleteBlockerType,
  AdminBomCaseDeleteWarningType,
  BomQuoteStatusType,
} from '@sp/api-contract';

// 스마트 BOM 모듈 공용 표시 규칙 — docs/SMARTBOM_PARTNER_RFQ.md §3.
// 12단계는 저장 상태가 아니라 상태 계층(quote.status → 이후 RFQ·주문·선적)에서
// 계산하는 "파생 표시 타임라인"이다(시안 채택 §8 조정 ①).

// ⑦·⑧ 순서는 시안(발주→결제)을 우리 프로세스(결제 확인 후 발주 — D18-7)에 맞게 스왑.
export const SMARTBOM_STEPS = [
  'BOM 견적요청',
  '견적접수',
  '파트너 견적요청',
  '파트너 견적회신',
  '고객 견적서 발송',
  '주문서 접수',
  '결제',
  '파트너 발주',
  '선적',
  '검수',
  '국내배송',
  '완료',
] as const;

/** 파생 입력 — 전부 선택적: 모르는 값은 생략하면 그 단계까지만 계산된다(목록 vs 상세).
 * `| undefined` 명시는 exactOptionalPropertyTypes 에서 `a ?? undefined` 전달을 허용하기 위함. */
export interface SmartbomDerived {
  orderState?: 'none' | 'cart' | 'ordered' | undefined;
  isPaid?: boolean | undefined;
  poCount?: number | undefined;
  poReceivedCount?: number | undefined;
  /** 선적 문서 1건 이상 존재(⑨). */
  hasShipment?: boolean | undefined;
  /** 영카트 od_status 원문('배송'|'완료' 만 해석 — ⑪⑫). */
  odStatus?: string | undefined;
}

/**
 * 현재 단계(1-base). 0 = 미진입(draft). ③④(RFQ)·⑥~⑫ 전부 파생 표시(저장 상태 아님):
 * ⑥주문 ⑦결제 ⑧발주 ⑨선적 ⑩검수(전 발주 입고) ⑪배송(od) ⑫완료(od).
 */
export const smartbomStepOf = (
  status: BomQuoteStatusType,
  derived: SmartbomDerived = {},
): number => {
  if (derived.orderState === 'ordered') {
    if (derived.odStatus === '완료') return 12;
    if (derived.odStatus === '배송') return 11;
    const poCount = derived.poCount ?? 0;
    if (poCount > 0 && (derived.poReceivedCount ?? 0) >= poCount) return 10;
    if (derived.hasShipment === true) return 9;
    if (poCount > 0) return 8;
    if (derived.isPaid === true) return 7;
    return 6;
  }
  switch (status) {
    case 'requested':
      return 1;
    case 'reviewing':
      return 2;
    case 'answered':
    case 'closed':
      return 5;
    default:
      return 0;
  }
};

export const SMARTBOM_STATUS_META: Record<BomQuoteStatusType, { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: 'bg-gray-100 text-gray-600' },
  requested: { label: '견적요청', cls: 'bg-blue-100 text-blue-700' },
  reviewing: { label: '검토 중', cls: 'bg-amber-100 text-amber-700' },
  answered: { label: '회신 완료', cls: 'bg-emerald-100 text-emerald-700' },
  closed: { label: '종료', cls: 'bg-gray-200 text-gray-600' },
  canceled: { label: '취소', cls: 'bg-red-100 text-red-600' },
};

/** 단건·일괄 영구 삭제 경고 레이어가 공유하는 서버 판정 설명. */
export const SMARTBOM_DELETE_BLOCKER_TEXT: Record<AdminBomCaseDeleteBlockerType, string> = {
  PAID_ORDER: '결제 이력이 있는 주문입니다. 별도 강제 삭제 확인 시 로컬 주문·결제 기록까지 삭제할 수 있습니다.',
  SHARED_ORDER: '같은 주문에 다른 품목 또는 Case가 함께 있어 단건 삭제할 수 없습니다.',
  ORDER_LINK_INCONSISTENT: 'Case와 영카트 품목의 연결 정보가 일치하지 않습니다. 주문 연결을 먼저 점검해 주세요.',
  ENGINE_JOB_IN_PROGRESS: 'BOM 분석 또는 공급사 검색이 진행 중입니다. 완료·실패 상태가 된 뒤 다시 확인해 주세요.',
  SHIPMENT_LINK_INCONSISTENT: '선적 대표 발주서와 소속 정보가 일치하지 않습니다. 물류 연결을 먼저 점검해 주세요.',
};

export const SMARTBOM_DELETE_WARNING_TEXT: Record<AdminBomCaseDeleteWarningType, string> = {
  SENT_EMAILS_REMAIN: '이미 발송된 협력사·고객 이메일은 회수되지 않습니다.',
  EXTERNAL_ACTIONS_REMAIN: '외부 공급사 장바구니·발급 링크는 외부 시스템에 남을 수 있습니다.',
  SHARED_SHIPMENT_PRESERVED: '다른 Case와 공유 중인 선적은 삭제하지 않고 이 Case의 발주서만 분리합니다.',
  UNPAID_ORDER_DELETED: '단독 미입금 주문과 연결 장바구니 행도 함께 영구 삭제합니다.',
  PAID_ORDER_PERMANENTLY_DELETED: '로컬 결제 주문·쿠폰·PG 로그·포인트 원장까지 삭제합니다. 외부 PG 승인 취소나 환불은 실행하지 않습니다.',
  SHIPMENT_HISTORY_PERMANENTLY_DELETED: '진행 또는 완료된 선적 이력도 이 Case 소유분은 함께 영구 삭제합니다.',
  FILES_PERMANENTLY_DELETED: '원본 BOM, 엔진 임시 잡과 이 Case만 소유한 선적 첨부가 영구 삭제됩니다.',
};

/** 표시용 파생 Case 번호(저장 키 아님) — CASE-B-YYMMDD-{id}. */
export const smartbomCaseNo = (
  id: string,
  requestedAt: string | null,
  createdAt: string,
): string => {
  const base = new Date(requestedAt ?? createdAt);
  const yy = String(base.getFullYear() % 100).padStart(2, '0');
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `CASE-B-${yy}${mm}${dd}-${id}`;
};

export const smartbomFmtWon = (v: number | null): string =>
  v === null ? '—' : `${v.toLocaleString('ko-KR')}원`;

export const smartbomFmtDate = (iso: string | null): string =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
