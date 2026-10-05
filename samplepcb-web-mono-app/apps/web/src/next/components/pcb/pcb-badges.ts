import { PCB_STEPS } from '@sp/api-contract';
import type { BadgeVariants } from '@/next/components/ui/badge';

// PCB 목록 배지 사전 — 옛 화면의 색 클래스(bg-amber-100 …) 대신 Badge variant 로 말한다.
// 색은 뜻으로 고른다: warning=기다림·주의, info=진행, success=끝남·확정, danger=문제,
// secondary=중립·이력, outline=부가 표지. 같은 뜻은 화면이 달라도 같은 variant 를 쓴다.
// <Badge :variant="b.variant">{{ b.label }}</Badge>

export type BadgeVariant = NonNullable<BadgeVariants['variant']>;

export interface PcbBadge {
  label: string;
  variant: BadgeVariant;
}

// 제작 분류(sp_order_spec.category, 4종 고정). standard 와 advance 는 공정·단가·리드타임이 다른
// 물건이라 행을 훑을 때 바로 갈려야 한다 — 기본(standard)은 중립, advance 는 주의를 끈다.
const CATEGORY: Record<string, PcbBadge> = {
  standard: { label: 'Standard', variant: 'secondary' },
  advance: { label: 'Advance', variant: 'warning' },
  metalMask: { label: 'Metal Mask', variant: 'outline' },
  flexible: { label: 'FPCB', variant: 'info' },
};

/** 모르는 분류는 원문 그대로 — 사전에 없다고 값을 숨기면 화면이 거짓말을 한다. */
export const pcbCategoryBadge = (category: string): PcbBadge =>
  CATEGORY[category] ?? { label: category, variant: 'outline' };

// 고객 견적 상태(sp_order_spec.quoteStatus).
const QUOTE: Record<string, PcbBadge> = {
  rfq: { label: '견적 대기', variant: 'warning' },
  priced: { label: '자동견적', variant: 'info' },
  quoted: { label: '견적 확정', variant: 'success' },
};

export const pcbQuoteBadge = (status: string): PcbBadge =>
  QUOTE[status] ?? { label: status, variant: 'secondary' };

/** 협력사 RFQ 회신 진척 — 전부 회신이면 끝남, 아니면 진행. */
export const pcbRfqReplyBadge = (quoted: number, total: number): PcbBadge => ({
  label: `회신 ${String(quoted)}/${String(total)}`,
  variant: quoted >= total ? 'success' : 'info',
});

/** 12단계 파생 단계 칩 — 구간별 색: 견적(1~5) → 주문·결제(6~7) → 발주·생산(8~10) → 선적·완료(11~12). */
export const pcbStepBadge = (step: number): PcbBadge => ({
  label: `${String(step)}. ${PCB_STEPS[step - 1] ?? ''}`,
  variant: step <= 5 ? 'secondary' : step <= 7 ? 'warning' : step <= 10 ? 'info' : 'success',
});

/** A/S 회차 — 진행 중이면 문제 신호, 종결이면 이력. */
export const pcbAsRoundBadge = (round: number, open: boolean): PcbBadge => ({
  label: `A/S ${String(round)}차${open ? ' 진행' : ''}`,
  variant: open ? 'danger' : 'secondary',
});

// 고객 주문 상태(od_status 원문, 정본은 g5) — 라벨은 그대로 두고 색만 구간으로 묶는다:
// 입금 대기=기다림, 입금 뒤 진행=진행, 완료=끝남, 취소·반품·품절·삭제=이력. 모르는 상태는 원문 + 중립.
// 진행현황·주문 화면·Case 상세가 같은 함수를 쓴다(같은 상태가 화면마다 다른 색이 되지 않게).
const OD_STATUS: Record<string, BadgeVariant> = {
  주문: 'warning',
  입금: 'info',
  준비: 'info',
  파일검사: 'info',
  생산중: 'info',
  생산완료: 'info',
  배송: 'info',
  완료: 'success',
  취소: 'secondary',
};

export const pcbOrderStatusBadge = (odStatus: string): PcbBadge => ({
  label: odStatus,
  variant: OD_STATUS[odStatus] ?? 'secondary',
});

// 발주 상태 — 관리자 승인을 기다리는 EQ 요청만 주의, 생산완료는 끝남, 나머지는 진행.
const PO_STATUS: Record<string, BadgeVariant> = {
  issued: 'info',
  eq_requested: 'warning',
  eq_done: 'info',
  producing: 'info',
  produced: 'success',
};

export const pcbPoStatusVariant = (status: string): BadgeVariant => PO_STATUS[status] ?? 'secondary';

// 선적 상태 — 진행 중은 info 하나로 묶고 단계는 라벨 글자가 말한다. 통관만 사람 손이 갈 수 있어 주의.
const SHIPMENT_STATUS: Record<string, BadgeVariant> = {
  preparing: 'secondary',
  requested: 'info',
  shipped: 'info',
  arrived: 'info',
  customs: 'warning',
  done: 'success',
  shipping: 'info',
  delivered: 'success',
};

export const pcbShipmentStatusVariant = (status: string): BadgeVariant => SHIPMENT_STATUS[status] ?? 'secondary';
