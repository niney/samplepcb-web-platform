import { PCB_REMITTANCE_STATUS_LABELS, type PcbRemittanceStatusType } from '@sp/api-contract';
import type { PcbBadge } from '@/next/components/pcb/pcb-badges';

// 송금 화면 배지 사전 — 키트(pcb-badges.ts)와 같은 뜻 규칙: warning=기다림·주의, success=끝남,
// danger=문제, secondary=중립. 송금 원장(목록·패널)만 쓰므로 송금 폴더에 둔다.

const STATUS_VARIANT: Record<PcbRemittanceStatusType, PcbBadge['variant']> = {
  unpaid: 'secondary',
  partial: 'warning',
  paid: 'success',
  over: 'danger',
};

/** 발주서 1건의 지급 상태(서버 summarizePcbRemittances 판정). */
export const pcbRemittanceStatusBadge = (status: PcbRemittanceStatusType): PcbBadge => ({
  label: PCB_REMITTANCE_STATUS_LABELS[status],
  variant: STATUS_VARIANT[status],
});

/** 무상 A/S 재생산 회차 — 지급 대상이 아니다(잔액 0 취급). 지급 상태 대신 이 배지를 세운다. */
export const PCB_FREE_AS_BADGE: PcbBadge = { label: '무상 A/S', variant: 'success' };

/** 같은 프로젝트가 A/S 회차만큼 여러 줄로 선다 — Case·포털과 같은 회차 표지. */
export const pcbReorderRoundBadge = (round: number): PcbBadge => ({
  label: `${String(round)}차`,
  variant: 'danger',
});
