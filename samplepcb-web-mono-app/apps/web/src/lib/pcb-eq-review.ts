import type { PcbPoEqReviewSummaryType } from '@sp/api-contract';
import { fmtKstDate, kstDateOnly, kstToday } from '@sp/utils';

// EQ 고객 확인 표시(P4.4, docs/PCB_PARTNER_TRACK.md D16) — Case 상세(버튼)와 발주 워크큐
// (배지)가 **같은 상태를 같은 색으로** 말해야 해서 판정·팔레트·툴팁을 여기 하나에 둔다.
// 열람 여부는 다루지 않는다 — 메일 스캐너가 링크를 자동 GET 해 열람 신호는 오염된다.

export type PcbEqReviewDisplay = 'none' | 'pending' | 'overdue' | 'approved' | 'rejected';

export const pcbEqReviewState = (r: PcbPoEqReviewSummaryType | null): PcbEqReviewDisplay => {
  // D20 — 작성 중(draft)은 고객에게 아직 안 간 것이라 '미요청'과 같은 칸, 문항형 회신(answered)은
  // 고객이 답한 것이라 승인 칸의 색을 빌린다(전용 표시는 문항형 작업공간 몫).
  if (r === null || r.status === 'draft' || r.status === 'canceled') return 'none';
  if (r.status === 'requested') return r.overdue ? 'overdue' : 'pending';
  return r.status === 'rejected' ? 'rejected' : 'approved';
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
      return r?.status === 'answered' ? '고객 회신' : '고객 승인';
    case 'rejected':
      return '고객 반려';
    default:
      return r?.status === 'draft' ? '작성 중' : '고객 미요청';
  }
};

/** 툴팁 — 짧은 배지·버튼이 못 담는 것(요청일·기한·고객 의견 원문). */
export const pcbEqReviewTitle = (r: PcbPoEqReviewSummaryType | null): string => {
  // 트랙 중립 문구 — 스텐실 발주에도 이 축(고객 확인)은 그대로 쓰인다(EQ 라는 말만 뺀다).
  if (r === null) return '고객에게 제작 확인을 요청합니다';
  // D20 작성 중 — 아직 고객에게 안 갔다(요청일은 초안을 만든 시각이라 싣지 않는다).
  if (r.status === 'draft') return '관리자가 문항을 작성 중입니다 — 고객에게는 아직 보이지 않습니다';
  const parts = [`요청 ${fmtKstDate(r.requestedAt)}`];
  if (r.dueOn !== null) parts.push(`기한 ${fmtKstDate(r.dueOn)}`);
  if (r.status === 'answered') parts.push(`회신 ${fmtKstDate(r.decidedAt)}`);
  if (r.forwardedAt !== null) parts.push(`협력사 전달 ${fmtKstDate(r.forwardedAt)}`);
  if (r.decisionNote !== null && r.decisionNote !== '') parts.push(`고객 의견: ${r.decisionNote}`);
  return parts.join(' · ');
};

// ── D20 문항형 회차 칩 — "EQ 2차 · 회신 대기 D+2" / "회신 도착 · 전달 필요" ─────────────
// 문항형은 '답했다'로 끝나지 않는다 — 회신을 협력사에 **전달**해야 공장이 움직인다. 그래서 승인/반려
// 두 칸 대신 작성 중 → 회신 대기 → 전달 필요 → 전달됨 네 칸으로 말한다(Case 행·워크큐 같은 판정).

export type PcbEqRoundDisplay = 'draft' | 'pending' | 'overdue' | 'needs_forward' | 'forwarded';

/** 문항형 회차의 표시 상태 — 문구형(D16)·요약 없음이면 null(옛 표시를 쓴다). */
export const pcbEqRoundState = (r: PcbPoEqReviewSummaryType | null): PcbEqRoundDisplay | null => {
  if (r?.format !== 'items') return null;
  switch (r.status) {
    case 'draft':
      return 'draft';
    case 'requested':
      return r.overdue ? 'overdue' : 'pending';
    case 'answered':
      return r.forwardedAt === null ? 'needs_forward' : 'forwarded';
    default:
      return null;
  }
};

/** KST 달력 날짜 차(일) — 'YYYY-MM-DD' 둘. 발송일 당일이 D+0. */
export const kstDayDiff = (fromYmd: string, toYmd: string): number =>
  Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);

/** 회신 대기 경과 — 보낸 날(KST)부터 오늘까지. "D+2" = 이틀째 답이 없다. */
export const pcbEqWaitDays = (requestedAt: string, today: string = kstToday()): number =>
  Math.max(0, kstDayDiff(kstDateOnly(requestedAt) ?? today, today));

/** 칩 문구의 상태 부분(회차 번호 없이) — 작업공간 머리의 배지와 같은 말. */
export const pcbEqRoundStateLabel = (
  state: PcbEqRoundDisplay,
  r: Pick<PcbPoEqReviewSummaryType, 'requestedAt'>,
  today: string = kstToday(),
): string => {
  switch (state) {
    case 'draft':
      return '작성 중';
    case 'pending':
      return `회신 대기 D+${String(pcbEqWaitDays(r.requestedAt, today))}`;
    case 'overdue':
      return '기한 지남';
    case 'needs_forward':
      return '회신 도착 · 전달 필요';
    case 'forwarded':
      return '전달됨';
  }
};

/** 행 칩 문구 — "EQ 2차 · 작성 중". 문항형이 아니면 null. */
export const pcbEqRoundChipLabel = (r: PcbPoEqReviewSummaryType | null, today: string = kstToday()): string | null => {
  const state = pcbEqRoundState(r);
  if (state === null || r === null) return null;
  const round = r.roundNo === null ? 'EQ' : `EQ ${String(r.roundNo)}차`;
  return `${round} · ${pcbEqRoundStateLabel(state, r, today)}`;
};
