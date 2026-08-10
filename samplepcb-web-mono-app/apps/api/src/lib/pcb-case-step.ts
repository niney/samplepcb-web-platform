// ── PCB 진행현황 step·구간 판정(admin-pcb-cases) — 순수 함수 층 ───────────────
// 파생 단계(1~12)는 저장 상태가 아니라 표시 타임라인이다. 판정 축은 **최상위 발주
// (parentPartnerId 0)의 최신 회차(reorderRound max)** — A/S 회차가 진행 중이면 od 가
// 완료·취소여도 스펙은 '완료·취소'에 묻히지 않고 진행(발주·생산) 구간에 선다(정책
// 확정 08-10, lib/pcb-customer-progress 의 고객 카드와 같은 규칙). 원발주만 있는
// 스펙(reorderRound 0 이 최신)은 현행 판정과 완전히 동일해야 한다(회귀 무영향).

/** EQ 승인 이후로 본다 — issued·eq_requested 는 아직 ⑧발주 단계. */
export const PCB_EQ_DONE_STATUSES = new Set(['eq_done', 'producing', 'produced']);

export interface PcbStepInput {
  rfqTotal: number;
  rfqQuoted: number;
  rfqSelected: boolean;
  finalPrice: number | null;
  cartState: 'none' | 'cart' | 'ordered';
  isPaid: boolean;
  poCount: number;
  eqDone: boolean;
  produced: boolean;
  hasShipment: boolean;
  odStatus: string | null;
}

/** 파생 단계(1~12) — 저장 상태가 아니라 표시 타임라인. 도달한 최대 단계를 쓴다. */
export const pcbStepOf = (input: PcbStepInput): number => {
  if (input.odStatus === '배송' || input.odStatus === '완료') return 12;
  if (input.hasShipment) return 11;
  if (input.produced) return 10;
  if (input.eqDone) return 9;
  if (input.poCount > 0) return 8;
  if (input.isPaid) return 7;
  if (input.cartState === 'ordered') return 6;
  if (input.finalPrice !== null) return 5;
  if (input.rfqSelected) return 4;
  if (input.rfqQuoted > 0) return 3;
  if (input.rfqTotal > 0) return 2;
  return 1;
};

/** 발주에 걸린 관리자 수신 발송 신호 — 링크가 없거나 수신측이 admin 이 아니면 null. */
export interface PcbRoundShipmentSignal {
  status: string;
  receivedAt: Date | null;
}

export interface PcbTopPoSignal {
  reorderRound: number;
  status: string;
  shipment: PcbRoundShipmentSignal | null;
}

/** 회차 발주 종결 = 발송이 최종 상태(done|delivered) 도달 또는 입고확인(receivedAt). */
export const isPcbRoundResolved = (shipment: PcbRoundShipmentSignal | null): boolean =>
  shipment !== null &&
  (shipment.receivedAt !== null || shipment.status === 'done' || shipment.status === 'delivered');

export interface PcbAsRoundState {
  /** 최상위 발주 최신 회차(0=원발주만). */
  asRound: number;
  /** 회차(>0) 진행 중 — 최신 회차 발주가 종결 전. */
  asOpen: boolean;
}

/** 최상위 발주 목록 → 최신 회차·진행 여부. 원발주(round 0)뿐이면 항상 닫힘(현행 축). */
export const resolvePcbAsRoundState = (pos: readonly PcbTopPoSignal[]): PcbAsRoundState => {
  const asRound = pos.reduce((max, po) => Math.max(max, po.reorderRound), 0);
  if (asRound === 0) return { asRound: 0, asOpen: false };
  const roundPos = pos.filter((po) => po.reorderRound === asRound);
  return { asRound, asOpen: roundPos.some((po) => !isPcbRoundResolved(po.shipment)) };
};

/**
 * 스펙 step — A/S 회차 진행 중이면 판정 축을 최신 회차로 바꾼다: od 배송/완료의 12
 * 고정을 풀고(회차가 아직 굴러간다), EQ·생산·발송 신호도 그 회차 발주 것만 본다.
 * 회차가 없거나 종결됐으면 현행 전 회차 집계 그대로(원발주-only 판정 불변).
 */
export const pcbCaseStepOf = (
  base: PcbStepInput,
  asState: PcbAsRoundState,
  roundPos: readonly PcbTopPoSignal[],
): number => {
  if (!asState.asOpen) return pcbStepOf(base);
  return pcbStepOf({
    ...base,
    poCount: roundPos.length,
    eqDone: roundPos.some((po) => PCB_EQ_DONE_STATUSES.has(po.status)),
    produced: roundPos.some((po) => po.status === 'produced'),
    hasShipment: roundPos.some((po) => po.shipment !== null),
    odStatus: null, // 배송·완료 12 고정 해제 — 진행 중 회차의 실단계가 보여야 한다
  });
};
