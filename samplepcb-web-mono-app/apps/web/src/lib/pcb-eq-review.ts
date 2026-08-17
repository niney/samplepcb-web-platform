import type { PcbPoEqReviewSummaryType } from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';

// EQ 고객 확인 표시(P4.4, docs/PCB_PARTNER_TRACK.md D16) — Case 상세(버튼)와 발주 워크큐
// (배지)가 **같은 상태를 같은 색으로** 말해야 해서 판정·팔레트·툴팁을 여기 하나에 둔다.
// 열람 여부는 다루지 않는다 — 메일 스캐너가 링크를 자동 GET 해 열람 신호는 오염된다.

export type PcbEqReviewDisplay = 'none' | 'pending' | 'overdue' | 'approved' | 'rejected';

export const pcbEqReviewState = (r: PcbPoEqReviewSummaryType | null): PcbEqReviewDisplay => {
  if (r === null) return 'none';
  if (r.status === 'requested') return r.overdue ? 'overdue' : 'pending';
  return r.status === 'approved' ? 'approved' : 'rejected';
};

/** 버튼(Case 상세) — 누를 수 있는 자리라 테두리형. */
export const PCB_EQ_REVIEW_BTN_CLS: Record<PcbEqReviewDisplay, string> = {
  none: 'border-sky-300 text-sky-700 hover:bg-sky-50',
  pending: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
  overdue: 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100',
  approved: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  rejected: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100',
};

/** 배지(워크큐 목록) — 읽기 전용이라 채움형. 색 뜻은 버튼과 같다. */
export const PCB_EQ_REVIEW_BADGE_CLS: Record<PcbEqReviewDisplay, string> = {
  none: 'bg-sky-100 text-sky-700',
  pending: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

/** 목록 배지 문구 — 행 폭이 좁아 일자·사유는 툴팁으로 뺀다. */
export const pcbEqReviewBadgeLabel = (r: PcbPoEqReviewSummaryType | null): string => {
  switch (pcbEqReviewState(r)) {
    case 'pending':
      return '고객 확인중';
    case 'overdue':
      return '고객 기한초과';
    case 'approved':
      return '고객 승인';
    case 'rejected':
      return '고객 반려';
    default:
      return '고객 미요청';
  }
};

/** 툴팁 — 짧은 배지·버튼이 못 담는 것(요청일·기한·고객 의견 원문). */
export const pcbEqReviewTitle = (r: PcbPoEqReviewSummaryType | null): string => {
  // 트랙 중립 문구 — 스텐실 발주에도 이 축(고객 확인)은 그대로 쓰인다(EQ 라는 말만 뺀다).
  if (r === null) return '고객에게 제작 확인을 요청합니다';
  const parts = [`요청 ${fmtKstDate(r.requestedAt)}`];
  if (r.dueOn !== null) parts.push(`기한 ${fmtKstDate(r.dueOn)}`);
  if (r.decisionNote !== null && r.decisionNote !== '') parts.push(`고객 의견: ${r.decisionNote}`);
  return parts.join(' · ');
};
