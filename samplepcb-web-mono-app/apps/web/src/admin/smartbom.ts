import type { BomQuoteStatusType } from '@sp/api-contract';

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
