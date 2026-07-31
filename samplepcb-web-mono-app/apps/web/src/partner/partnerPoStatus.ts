import type { BomPoStatusType, BomShipmentStatusType } from '@sp/api-contract';

// 협력사 관점 발주서 상태(§6.11) — 관리자 문서 상태(발행됨/협력사 확인/마감)를 그대로
// 노출하지 않고 "내가 뭘 해야 하나"로 번역한다. '마감'은 관리자 내부 용어라 협력사
// 화면에서 사라진다(마감돼도 물류는 진행 가능 — 발송 대기로 보이는 것이 자연).

export interface PartnerPoDisplayInput {
  poStatus: BomPoStatusType;
  /** 발송(박스)에 담겨 있는가 — 목록 shipmentAttached / 상세 shipment !== null. */
  attached: boolean;
  shipmentStatus: BomShipmentStatusType | null;
  received: boolean;
}

export interface PartnerPoDisplayStatus {
  label: string;
  cls: string;
}

export const partnerPoDisplayStatus = (input: PartnerPoDisplayInput): PartnerPoDisplayStatus => {
  if (input.received) return { label: '입고 완료', cls: 'bg-emerald-100 text-emerald-700' };
  if (input.poStatus === 'issued') return { label: '확인 필요', cls: 'bg-blue-100 text-blue-700' };
  if (!input.attached) return { label: '발송 대기', cls: 'bg-amber-100 text-amber-700' };
  if (input.shipmentStatus === 'preparing') {
    return { label: '발송 준비 중', cls: 'bg-indigo-100 text-indigo-700' };
  }
  return { label: '발송 중', cls: 'bg-blue-100 text-blue-700' };
};
