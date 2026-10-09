// 마스터딜러 회신 — 품목별로 고를 수 있는 하위 회신(docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개").
// .vue 가 export 한 타입은 ESLint 프로그램에서 error 타입이 되므로 .ts 에 둔다.

export interface RfqReplyChildOffer {
  /** 하위에게 보낸 재요청 문서 — 저장할 때 이 값을 보낸다. */
  childRfqId: number;
  partnerName: string;
  /** 하위 회신가(하위 통화). */
  currency: string;
  unitPrice: number;
  /** 내 결제통화로 환산한 단가(지금 환율) — 환율을 못 구했으면 null. 선택지 표기용. */
  unitPriceInMine: number | null;
  /** 하위 통화 → 내 통화의 지금 환율 — 미리보기 계산용(서버와 같은 식). */
  rateToMine: number | null;
  replyQty: number | null;
  moq: number | null;
  stock: number | null;
  dateCode: string | null;
  leadTime: string | null;
}

/** quoteItemId → 그 품목에 단가를 회신한 하위들. */
export type RfqReplyChildOffers = Record<string, RfqReplyChildOffer[]>;

/** 저장돼 있는 하위 선정(내 회신 행의 근거). */
export interface RfqReplyChildSelection {
  childRfqId: number;
  childPartnerName: string;
  marginRate: number;
  sourceCurrency: string;
  sourceUnitPrice: number;
  sourceRate: number;
  stale: boolean;
}

/** 서버(bom-fx roundBomUnitPrice)와 같은 자릿수 — 단가 4자리. */
export const roundUnitPrice4 = (value: number): number =>
  Math.round(Number((value * 10_000).toPrecision(12))) / 10_000;

/**
 * 상위 회신가 미리보기 = 하위 회신가 × 환율 × (1 + 마진%), 끝에서 한 번만 반올림한다(서버와 같은 식).
 * 이미 고른 하위·같은 회신가면 그때 굳힌 환율(kept)을 쓴다 — 서버도 그 환율을 물려받는다.
 * 환산 단가(unitPriceInMine)에 마진을 곱하지 않는다: 이미 4자리로 반올림된 값이라 작은 단가에서
 * 0.0039 가 0.004 로 어긋난다(2026-10-09 상세 여정 D03 이 잡았다).
 */
export const mdUnitPricePreview = (
  offer: RfqReplyChildOffer,
  marginRate: number,
  kept: RfqReplyChildSelection | null,
): number | null => {
  const factor = 1 + marginRate / 100;
  if (
    kept !== null &&
    kept.childRfqId === offer.childRfqId &&
    kept.sourceUnitPrice === offer.unitPrice &&
    kept.sourceCurrency === offer.currency
  ) {
    return roundUnitPrice4(offer.unitPrice * kept.sourceRate * factor);
  }
  return offer.rateToMine === null ? null : roundUnitPrice4(offer.unitPrice * offer.rateToMine * factor);
};
