import {
  bomShipmentStatusLabel,
  type BomShipmentModeType,
  type BomShipmentStatusType,
} from '@sp/api-contract';

// ── PCB 선적 상태 라벨 — BOM 코드사전 무접촉 표시층 래퍼(정책 확정 08-10) ─────
// 직송(destinationCountry 가 관리자 소재 KR 이 아닌) **국제** 체인의 'arrived' 는 실물이
// 한국에 오지 않는다 — '국내도착'이 거짓말이 되므로 표시만 '현지도착'으로 치환한다.
// 상태 코드·전이 사전(bom-po.ts §D22)은 BOM 트랙과 공유 그대로다(수정 금지). 소비처
// (AdminPcbCase 선적 행·AdminPcbShipments 큐·PcbShipmentCard)는 각자 아는 직송 신호
// (shipment/po 의 destinationCountry)를 isPcbDirectShipIntl 로 접어 directShip 을 넘긴다.

/** 직송 국제 체인 판정 — 직송지가 있고 그것이 관리자 소재(KR)가 아닐 때. */
export const isPcbDirectShipIntl = (destinationCountry: string | null | undefined): boolean =>
  destinationCountry !== null && destinationCountry !== undefined && destinationCountry !== 'KR';

/** 직송 국제 'arrived' 표시 라벨 — 다음 단계 버튼('~ 진행')·스텝퍼가 같이 쓴다. */
export const PCB_DIRECT_ARRIVED_LABEL = '현지도착';

export const pcbShipmentStatusLabel = (
  mode: BomShipmentModeType,
  status: BomShipmentStatusType,
  opts?: { directShip?: boolean },
): string =>
  opts?.directShip === true && mode === 'international' && status === 'arrived'
    ? PCB_DIRECT_ARRIVED_LABEL
    : bomShipmentStatusLabel(mode, status);
