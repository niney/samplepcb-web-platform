// ── 국제 발송 운송회사 프리셋 — 표기 정본(2026-08-15) ────────────────────────
// carrier 는 큐 검색 축이자 운송장 표기의 절반인데 자유 텍스트는 "DHL/dhl/디에이치엘"로
// 표기가 흩어져 검색·추후 운송사별 조회 링크 생성을 막는다. 선택지를 정식 표기로 고정하고
// 목록 밖 운송사는 '직접입력'으로 연다. 저장은 어느 쪽이든 문자열 그대로
// (PcbShipmentAdvanceBody.carrier max 50 — 계약·서버 무변경, 기존 값과 공존).
// 소비처: PcbShipmentCard(협력사 직접 발송 갈래)·AdminPcbCase '선적' 프롬프트.
// 국내 체인의 택배사 입력(CJ대한통운 등)은 별개 — 이 목록을 쓰지 않는다.

export const PCB_INTL_CARRIERS = ['DHL', 'FedEx', 'UPS', 'SF Express'] as const;

/** 프리셋 판정 — 박제된 값으로 셀렉트를 되열 때 '직접입력' 갈래를 가른다. */
export const isPcbIntlCarrier = (value: string): boolean =>
  (PCB_INTL_CARRIERS as readonly string[]).includes(value);
