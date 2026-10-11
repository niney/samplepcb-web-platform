import {
  bomShipmentStatusesOf,
  type BomShipmentStatusType,
  type PcbShipmentViewType,
} from '@sp/api-contract';

// PCB 발송 스텝퍼(협력사 포털) — 보내기 카드와 발주 상세가 같은 단계를 그린다.
//
// 국제 발송은 '선적'부터 받는 쪽(샘플피씨비·MD) 단계다. 보내는 쪽의 마지막 일은 "실제로 넘겼다"를 남기는
// [선적 완료] 확인이고, 이것은 **상태 사전에 없는 가상 단계**다(계약 pcbShipConfirmPending). 그 뒤의
// 국내도착·통관·완료는 보여 주기만 한다 — 흐린 점선(theirs-*)으로 갈라 그린다(2026-10-11).

export type PcbShipStepKey = BomShipmentStatusType | 'ship_confirm';
export type PcbShipStepState = 'done' | 'current' | 'todo' | 'theirs-done' | 'theirs-current' | 'theirs-todo';
export interface PcbShipStep {
  key: PcbShipStepKey;
  label: string;
  state: PcbShipStepState;
}

export const PCB_SHIP_STEP_CLS: Record<PcbShipStepState, string> = {
  done: 'bg-emerald-50 text-emerald-700',
  current: 'bg-teal-600 text-white',
  todo: 'bg-gray-100 text-gray-400',
  'theirs-done': 'border border-dashed border-gray-300 text-gray-500',
  'theirs-current': 'border border-dashed border-gray-400 bg-gray-100 text-gray-600',
  'theirs-todo': 'border border-dashed border-gray-200 text-gray-300',
};

type StepSubject = Pick<PcbShipmentViewType, 'mode' | 'status' | 'shipConfirmedAt'>;

export const pcbShipSteps = (
  shipment: StepSubject,
  labelOf: (status: BomShipmentStatusType) => string,
  confirmLabel: string,
): PcbShipStep[] => {
  const chain = bomShipmentStatusesOf(shipment.mode);
  const at = chain.indexOf(shipment.status);
  const shippedAt = shipment.mode === 'international' ? chain.indexOf('shipped') : -1;
  const out: PcbShipStep[] = [];
  chain.forEach((step, i) => {
    const base: 'done' | 'current' | 'todo' = at > i ? 'done' : at === i ? 'current' : 'todo';
    // 지금이 '선적'이면 강조는 그 다음 칸([선적 완료])이 받는다 — '선적' 자체는 끝난 일이다.
    const own = i === shippedAt && at === i ? 'done' : base;
    // '선적'을 지난 단계는 받는 쪽이 진행한다 — 보내는 쪽에는 참고용.
    out.push({ key: step, label: labelOf(step), state: shippedAt >= 0 && i > shippedAt ? `theirs-${own}` : own });
    if (i === shippedAt) {
      // 확인이 없어도 받는 쪽이 다음 단계로 넘겼다면 물건은 떠난 것이다(계약 pcbShipmentSenderDone 과 같은 판정).
      const confirmed = shipment.shipConfirmedAt !== null || at > i;
      out.push({ key: 'ship_confirm', label: confirmLabel, state: confirmed ? 'done' : at === i ? 'current' : 'todo' });
    }
  });
  return out;
};
