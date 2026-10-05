import {
  PCB_PACKAGE_STATUS_LABELS,
  PCB_PO_STATUS_LABELS,
  type AdminPcbPackageDetailType,
  type PcbPoEqReviewSummaryType,
  type PcbPoStatusType,
  type PcbPoTrackType,
} from '@sp/api-contract';
import { pcbEqReviewBadgeLabel, pcbEqReviewState, type PcbEqReviewDisplay } from '@/lib/pcb-eq-review';
import { pcbPoStatusVariant, type BadgeVariant, type PcbBadge } from '../pcb-badges';

// 발주·EQ 화면 배지 — 옛 화면의 색 클래스(STATUS_CLS·PCB_EQ_REVIEW_BADGE_CLS) 대신 variant 로 말한다.
// 뜻은 키트(pcb-badges.ts)와 같다: warning=기다림·주의, info=진행, success=끝남, danger=문제.

/** 라벨은 트랙별 사전(스텐실이면 '확인 요청') — flat 사전을 쓰면 스텐실에 'EQ'가 새어 나간다. */
export const pcbPoStatusBadge = (track: PcbPoTrackType, status: PcbPoStatusType): PcbBadge => ({
  label: PCB_PO_STATUS_LABELS[track][status],
  variant: pcbPoStatusVariant(status),
});

// EQ 고객 확인(D16) — 판정·문구는 옛 lib/pcb-eq-review 가 정본(Case 상세와 같은 말), 색만 variant 로.
const EQ_REVIEW_VARIANT: Record<PcbEqReviewDisplay, BadgeVariant> = {
  none: 'outline',
  pending: 'warning',
  overdue: 'danger',
  approved: 'success',
  rejected: 'danger',
};

export const pcbEqReviewBadge = (review: PcbPoEqReviewSummaryType | null): PcbBadge => ({
  label: pcbEqReviewBadgeLabel(review),
  variant: EQ_REVIEW_VARIANT[pcbEqReviewState(review)],
});

// QR 패키지 상태 — 무효는 문제, 입고는 끝남, 그 밖(인쇄·선적 중)은 기다림.
export const pcbPackageStatusBadge = (status: AdminPcbPackageDetailType['status']): PcbBadge => ({
  label: PCB_PACKAGE_STATUS_LABELS[status],
  variant: status === 'voided' ? 'danger' : status === 'received' ? 'success' : 'warning',
});
