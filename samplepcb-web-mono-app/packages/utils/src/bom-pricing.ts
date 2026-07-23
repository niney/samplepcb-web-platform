// BOM 견적 가격·수량 순수 로직 — 색인·화면·서버 재계산이 같은 함수를 쓴다.
// 레거시(vueline spSmartBomV2 priceService/useEstimate) 규칙을 검증 가능하게 재구현:
//  - 가격구간 선택: 주문수량 이상 구간 중 최대, 최소구간 미달 시 최소구간 단가(보존)
//  - 수량 박제: orderQty = max(BOM수량×(세트+예비), MOQ) → 주문배수 올림(배수는 신규 보정)
//  - 합계: Σ(단가×orderQty, included 라인) + 운송료 + 관리비, VAT 별도(보존)
//  - 오퍼 선정: 실효 총비용(해당 오퍼의 실효수량×적용단가, KRW 환산) 최저 — 신규.
//    MOQ 4000 오퍼는 100개 필요여도 4000개 비용으로 비교한다(발주 현실 반영).
// samplepcb 파생 오퍼는 선정 후보에서 제외(자기 자신 재선택 순환 방지).

export const BOM_SAMPLEPCB_SUPPLIER = 'samplepcb';

/** 레거시 패키지 우선순위(Cut > Digi > Bulk > Tape) — 동률 tie-break 용. */
const PKG_PRIORITY = ['cut', 'digi', 'bulk', 'tape'];

export interface BomPriceBreak {
  qty: number;
  price: number;
  currency?: string;
}

export interface BomOfferInput {
  supplier: string;
  supplierSku: string;
  packaging: string | null;
  currency: string | null;
  stock: number | null;
  moq: number | null;
  orderMultiple: number | null;
  fetchedAt: string; // ISO
  priceBreaks: BomPriceBreak[];
}

export interface OfferPick {
  offer: BomOfferInput;
  /** 이 오퍼로 발주 시 실효 주문수량(MOQ·배수 보정). */
  orderQty: number;
  breakQty: number;
  unitPrice: number;
  currency: string;
  /** KRW 환산 단가(비KRW + 환율 없음 → null = 미환산). */
  unitPriceKrw: number | null;
  /** 재고 부족 상태로 선정됨(전 오퍼 재고 부족 시 완화 선택). */
  stockShort: boolean;
}

function pkgRank(packaging: string | null): number {
  if (packaging === null) return PKG_PRIORITY.length;
  const p = packaging.toLowerCase();
  const i = PKG_PRIORITY.findIndex((k) => p.includes(k));
  return i === -1 ? PKG_PRIORITY.length : i;
}

/** 필요수량 = BOM 수량 × (세트수량 + 예비수량). */
export function neededQty(bomQty: number, setQty: number, spareQty: number): number {
  return Math.max(1, bomQty) * Math.max(1, setQty + spareQty);
}

/** 주문수량 박제 — MOQ 바닥 + 주문배수 올림. 저장된 orderQty 가 단일 진실. */
export function stampOrderQty(needed: number, moq: number | null, orderMultiple: number | null): number {
  const base = Math.max(needed, moq !== null && moq > 0 ? moq : 1);
  const mult = orderMultiple !== null && orderMultiple > 1 ? orderMultiple : 1;
  return Math.ceil(base / mult) * mult;
}

/** 수량에 적용되는 가격구간 — 이상 구간 중 최대, 최소구간 미달 시 최소구간(레거시 보존). */
export function pickBreak(breaks: BomPriceBreak[], qty: number): BomPriceBreak | null {
  if (breaks.length === 0) return null;
  const sorted = [...breaks].sort((a, b) => b.qty - a.qty);
  for (const step of sorted) {
    if (qty >= step.qty) return step;
  }
  return sorted[sorted.length - 1] ?? null; // 최소구간
}

/** 통화 → KRW 환산(예상치). KRW 그대로, USD 는 환율 필요, 그 외 미환산(null). */
export function toKrw(amount: number, currency: string, usdKrwRate: number | null): number | null {
  const c = currency.toUpperCase();
  if (c === 'KRW') return amount;
  if (c === 'USD' && usdKrwRate !== null && usdKrwRate > 0) return amount * usdKrwRate;
  return null;
}

function offerCurrencyOf(offer: BomOfferInput, step: BomPriceBreak): string {
  const c = step.currency !== undefined && step.currency !== '' ? step.currency : (offer.currency ?? '');
  return c.toUpperCase();
}

/** 특정 오퍼에 수량을 적용(구간·박제 재계산) — pinned 라인의 수량 변경에 사용. */
export function applyQtyToOffer(offer: BomOfferInput, needed: number, usdKrwRate: number | null): OfferPick | null {
  const orderQty = stampOrderQty(needed, offer.moq, offer.orderMultiple);
  const step = pickBreak(offer.priceBreaks, orderQty);
  if (step === null || step.price <= 0) return null;
  const currency = offerCurrencyOf(offer, step);
  return {
    offer,
    orderQty,
    breakQty: step.qty,
    unitPrice: step.price,
    currency,
    unitPriceKrw: toKrw(step.price, currency, usdKrwRate),
    stockShort: offer.stock !== null && offer.stock < orderQty,
  };
}

/**
 * 기본 오퍼 자동 선정 — 실효 총비용(실효수량 × 적용단가, KRW 환산) 최저.
 * 재고 충분 오퍼 우선(없으면 완화+stockShort), KRW 환산 가능 오퍼 우선.
 * 동률: 재고 많은 순 → 패키지 우선순위(Cut>Digi>Bulk>Tape) → 공급사명.
 */
export function pickDefaultOffer(
  offers: BomOfferInput[],
  needed: number,
  usdKrwRate: number | null,
): OfferPick | null {
  const picks: OfferPick[] = [];
  for (const offer of offers) {
    if (offer.supplier === BOM_SAMPLEPCB_SUPPLIER) continue;
    const pick = applyQtyToOffer(offer, needed, usdKrwRate);
    if (pick !== null) picks.push(pick);
  }
  if (picks.length === 0) return null;

  const enough = picks.filter((p) => !p.stockShort && p.offer.stock !== null);
  const pool = enough.length > 0 ? enough : picks;

  const comparable = pool.filter((p) => p.unitPriceKrw !== null);
  // 환산 가능한 오퍼가 하나도 없을 때 서로 다른 원통화 숫자를 직접 비교하지 않는다.
  // 같은 통화끼리는 원가격 비교가 가능하고, KRW 등 환산 가능 통화가 있으면 그 집합만 쓴다.
  const sourceCurrencies = new Set(pool.map((pick) => pick.currency));
  if (comparable.length === 0 && sourceCurrencies.size > 1) return null;
  const pool2 = comparable.length > 0 ? comparable : pool;

  const cost = (p: OfferPick): number => (p.unitPriceKrw ?? p.unitPrice) * p.orderQty;
  const sorted = [...pool2].sort(
    (a, b) =>
      cost(a) - cost(b) ||
      (b.offer.stock ?? 0) - (a.offer.stock ?? 0) ||
      pkgRank(a.offer.packaging) - pkgRank(b.offer.packaging) ||
      a.offer.supplier.localeCompare(b.offer.supplier),
  );
  return sorted[0] ?? null;
}

export interface BomTotalsInput {
  included: boolean;
  lineTotalKrw: number | null;
}

export interface BomTotals {
  /** 부품 합계(KRW, included·환산 가능 라인만). */
  itemsTotal: number;
  /** 부품 합계 + 운송료 + 관리비. VAT 별도(가산하지 않음 — 레거시 표기 보존). */
  finalTotal: number;
  /** included 인데 금액 미산정(오퍼 없음·미환산)인 라인 수 — 화면 경고용. */
  uncostedCount: number;
}

/** 합계 산출 — 저장 items 와 같은 기준(included)만 합산(레거시 불일치 결함 교정). */
export function computeTotals(lines: BomTotalsInput[], shippingFee: number, managementFee: number): BomTotals {
  let itemsTotal = 0;
  let uncostedCount = 0;
  for (const line of lines) {
    if (!line.included) continue;
    if (line.lineTotalKrw === null) uncostedCount += 1;
    else itemsTotal += line.lineTotalKrw;
  }
  itemsTotal = Math.round(itemsTotal);
  return { itemsTotal, finalTotal: itemsTotal + shippingFee + managementFee, uncostedCount };
}
