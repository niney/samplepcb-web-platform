import { PCB_RFQ_STATUS_LABELS } from '@sp/api-contract';
import type { BadgeVariant, PcbBadge } from '@/next/components/pcb/pcb-badges';
import type { PcbEqReviewDisplay } from '@/lib/pcb-eq-review';

// Case 상세 전용 배지 사전 — 옛 화면의 색 클래스 사전(STATUS_CLS·PO_STATUS_CLS·SHIP_STATUS_CLS·
// PCB_EQ_REVIEW_BTN_CLS)을 Badge variant 로 옮겼다. 뜻은 키트 pcb-badges.ts 와 같다:
// warning=기다림·주의, info=진행, success=끝남·확정, danger=문제, secondary=중립·이력, outline=부가 표지.

const RFQ_STATUS: Record<string, BadgeVariant> = {
  requested: 'info',
  quoted: 'success',
  // 선정은 이 견적의 결론이라 강조(채움)로 — 회신 완료(success)와 갈려야 한다.
  selected: 'default',
  unselected: 'secondary',
};

export const rfqStatusBadge = (status: keyof typeof PCB_RFQ_STATUS_LABELS): PcbBadge => ({
  label: PCB_RFQ_STATUS_LABELS[status],
  variant: RFQ_STATUS[status] ?? 'secondary',
});

// 발주·선적 상태 색은 목록 화면과 같아야 해서 키트(pcb-badges.ts)의 pcbPoStatusVariant·pcbShipmentStatusVariant 를 쓴다.

/** EQ 고객 확인 상태 → 버튼 안 점(dot)의 색 토큰 클래스. 버튼 자체는 outline 이라 색을 덮지 않는다. */
export const EQ_REVIEW_DOT: Record<PcbEqReviewDisplay, string> = {
  none: 'bg-info',
  pending: 'bg-warning',
  overdue: 'bg-destructive',
  approved: 'bg-success',
  rejected: 'bg-destructive',
};
