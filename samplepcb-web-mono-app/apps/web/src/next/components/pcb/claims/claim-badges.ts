import { PCB_CLAIM_STATUS_LABELS, type PcbClaimStatusType } from '@sp/api-contract';
import type { PcbBadge } from '@/next/components/pcb/pcb-badges';

// A/S·클레임 상태 배지 — pcb-badges.ts 와 같은 뜻별 variant(warning=기다림, info=진행,
// success=끝남, secondary=중립·이력). 새 접수는 관리자가 움직일 차례라 경고색이다.
const CLAIM_STATUS_VARIANT: Record<PcbClaimStatusType, PcbBadge['variant']> = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'success',
  rejected: 'secondary',
};

export const pcbClaimStatusBadge = (status: PcbClaimStatusType): PcbBadge => ({
  label: PCB_CLAIM_STATUS_LABELS[status],
  variant: CLAIM_STATUS_VARIANT[status],
});
