import {
  PCB_PACKAGE_STATUS_LABELS,
  PCB_PO_STATUS_LABELS,
  type AdminPcbPackageDetailType,
  type PcbPoEqAiSummaryType,
  type PcbPoEqReviewSummaryType,
  type PcbPoStatusType,
  type PcbPoTrackType,
} from '@sp/api-contract';
import {
  PCB_EQ_AI_CHIP_LABELS,
  pcbEqAiState,
  pcbEqAiTitle,
  pcbEqReviewBadgeLabel,
  pcbEqReviewState,
  pcbEqReviewTitle,
  pcbEqRoundChipLabel,
  pcbEqRoundState,
  type PcbEqAiDisplay,
  type PcbEqReviewDisplay,
  type PcbEqRoundDisplay,
} from '@/lib/pcb-eq-review';
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

// D20 문항형 회차 — 작성 중(중립) · AI 초안·검토 필요(주의 — 아직 아무도 안 읽은 초안) · 회신 대기(진행 —
// 우리가 보낸 물음) · 기한 지남(문제) · 회신 도착·전달 필요(주의 — 관리자 차례) · 전달됨(끝남). Case 행 칩과 같은 색.
export const EQ_ROUND_VARIANT: Record<PcbEqRoundDisplay, BadgeVariant> = {
  draft: 'secondary',
  ai_draft: 'warning',
  pending: 'info',
  overdue: 'danger',
  needs_forward: 'warning',
  forwarded: 'success',
};

// D20 P2 AI 분석 — 분석 중(진행) · 분석 안 됨(주의 — 직접 쓰거나 다시 분석할 관리자 차례).
const EQ_AI_VARIANT: Record<PcbEqAiDisplay, BadgeVariant> = {
  ai_running: 'info',
  ai_failed: 'warning',
};

/**
 * 행 칩 — 회차 요약이 있으면 그것(문항형 회차 칩·문구형 배지)이 우선이고, 요약이 없을 때만 AI 분석 상태
 * (분석 중·안 됨)를 말한다: 초안이 생겼으면 'AI 초안 · 검토 필요'가, 관리자가 직접 쓰기 시작했으면 '작성 중'이
 * 더 맞는 말이다. 둘 다 없으면 '고객 미요청'.
 */
export const pcbEqReviewBadge = (
  review: PcbPoEqReviewSummaryType | null,
  eqAi: PcbPoEqAiSummaryType | null = null,
): PcbBadge => {
  const round = pcbEqRoundState(review);
  const roundLabel = pcbEqRoundChipLabel(review);
  if (round !== null && roundLabel !== null) return { label: roundLabel, variant: EQ_ROUND_VARIANT[round] };
  const ai = review === null ? pcbEqAiState(eqAi) : null;
  if (ai !== null) return { label: PCB_EQ_AI_CHIP_LABELS[ai], variant: EQ_AI_VARIANT[ai] };
  return {
    label: pcbEqReviewBadgeLabel(review),
    variant: EQ_REVIEW_VARIANT[pcbEqReviewState(review)],
  };
};

// 발주접수로 **돌아온 이유**(D20 후속) — 관리자 반려(우리가 돌려보냄: 문제색)와 협력사 추가 EQ 요청(승인 뒤 협력사가
// 다시 연 것: 주의색)을 가른다. 둘 다 같은 '발주접수'라 배지가 없으면 발주 직후인 건과도 구분되지 않는다.
// 판정은 계약 lastPcbEqReworkBoundary(이력이 있는 Case)·행 요약의 reopenedAt/rejectedAt(워크큐).
export type PcbEqReworkKind = 'reject' | 'reopen';

export const pcbEqReworkBadge = (track: PcbPoTrackType, kind: PcbEqReworkKind): PcbBadge =>
  kind === 'reopen'
    ? { label: track === 'stencil' ? '추가 확인 요청' : '추가 EQ 요청', variant: 'warning' }
    : { label: track === 'stencil' ? '보완 요청됨' : '반려됨', variant: 'danger' };

/** 경계 뒤로 새 파일 없이 다시 승인요청이 왔을 때의 경고 문구(승인 버튼 옆). */
export const pcbEqUnfixedLabel = (track: PcbPoTrackType, kind: PcbEqReworkKind): string =>
  kind === 'reopen' ? '추가 EQ 요청 후 새 파일 없음' : track === 'stencil' ? '보완 요청 후 새 파일 없음' : '반려 후 새 파일 없음';

export const pcbEqUnfixedTitle = (track: PcbPoTrackType, kind: PcbEqReworkKind): string =>
  kind === 'reopen'
    ? '협력사가 추가 EQ 를 요청한 뒤로 새로 올라온 EQ 첨부가 없습니다 — 같은 파일로 다시 승인요청됐을 수 있습니다.'
    : track === 'stencil'
      ? '직전 보완 요청 이후 새로 올라온 첨부가 없습니다 — 같은 파일로 다시 확인 요청됐을 수 있습니다.'
      : '직전 반려 이후 새로 올라온 EQ 첨부가 없습니다 — 같은 도면으로 다시 승인요청됐을 수 있습니다.';

/** 경계 뒤에 올라온 첨부의 툴팁 덧말(파일 버튼). */
export const pcbEqAfterReworkNote = (kind: PcbEqReworkKind): string =>
  kind === 'reopen' ? ' · 추가 EQ 요청 뒤 새로 올라온 파일입니다.' : ' · 반려 뒤 새로 올라온 보완분입니다.';

/** 행 칩 툴팁 — 칩과 같은 우선순위(회차 요약 > AI 분석 상태). 실패면 사유 문구가 여기 실린다. */
export const pcbEqRowTitle = (
  review: PcbPoEqReviewSummaryType | null,
  eqAi: PcbPoEqAiSummaryType | null = null,
): string => (review === null && eqAi !== null ? pcbEqAiTitle(eqAi) : pcbEqReviewTitle(review));

// QR 패키지 상태 — 무효는 문제, 입고는 끝남, 그 밖(인쇄·선적 중)은 기다림.
export const pcbPackageStatusBadge = (status: AdminPcbPackageDetailType['status']): PcbBadge => ({
  label: PCB_PACKAGE_STATUS_LABELS[status],
  variant: status === 'voided' ? 'danger' : status === 'received' ? 'success' : 'warning',
});
