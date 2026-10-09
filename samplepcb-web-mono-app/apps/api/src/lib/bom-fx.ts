import type { Prisma, SpBomQuote, SpPartner } from '@prisma/client';
import {
  BomPartnerFxRate,
  BomQuoteExchangeRateSnapshot,
  type BomPartnerCurrencyType,
  type BomPartnerFxCurrencyType,
  type BomPartnerFxRateType,
  type BomPartnerFxRatesType,
  type BomQuoteSelectedOfferType,
} from '@sp/api-contract';
import {
  getCachedCnhExchangeRate,
  getCachedUsdExchangeRate,
  getPcbExchangeRate,
  resolveUsdExchangeRate,
  roundPcbAmount,
} from './exchange-rate';
import { prisma } from './prisma';
import { getBomQuoteConfig } from './sp-config';

// ── BOM 협력사 외화 — docs/SMARTBOM_PARTNER_RFQ.md "외화 회신" ────────────────
// PCB 트랙의 통화 규칙(D2)을 BOM 에 가져온다: 링크 하나 = 결제통화 하나(KRW|USD|CNY), 협력사는
// 자기 통화 단가만 말하고 환율은 변환점에서만 등장한다. 다른 점은 **언제 굳히느냐**다.
//   · PCB  — 선정할 때 행마다 확정한다(가격이 사양당 하나).
//   · BOM  — 견적마다 통화별로 한 번 굳힌다. 품목이 수십 줄이고 공급사 달러 가격과 같은 표에서
//            비교하므로, 고르는 날마다 환율이 달라지면 같은 견적 안의 비교가 어긋난다.
// 고객가에는 굳힌 환율(안전 마진 포함)을 쓰고, 발주 장부에는 발행 시점의 실제 환율을 쓴다.
// 계산 엔진(@sp/utils bom-pricing)은 원화·달러만 안다 — 그래서 협력사 회신은 선정 시점에 원화로
// 환산해 박제하고 원본(결제통화 단가·환율)을 selectedOffer.sourcePrice 로 함께 남긴다.

export const asBomPartnerCurrency = (v: string | null | undefined): BomPartnerCurrencyType =>
  v === 'USD' ? 'USD' : v === 'CNY' ? 'CNY' : 'KRW';

type RelationClient = Pick<Prisma.TransactionClient, 'spPartnerRelation'>;

/** 링크 결제통화 — **배정(견적요청 생성) 시점에만** 불러 행에 박제한다. */
export const resolveBomLinkCurrency = async (
  parentPartnerId: bigint,
  partner: Pick<SpPartner, 'id' | 'defaultCurrency'>,
  db: RelationClient = prisma,
): Promise<BomPartnerCurrencyType> => {
  if (parentPartnerId === 0n) return asBomPartnerCurrency(partner.defaultCurrency);
  const relation = await db.spPartnerRelation.findUnique({
    where: { parentPartnerId_childPartnerId: { parentPartnerId, childPartnerId: partner.id } },
  });
  // PCB 와 같은 기본값 — 마스터딜러↔하위 링크 통화가 비어 있으면 USD.
  return asBomPartnerCurrency(relation?.settlementCurrency ?? 'USD');
};

/** 금액 반올림 — 원화 0자리·외화 2자리(HALF_UP). */
export const roundBomAmount = (amount: number, currency: string): number =>
  roundPcbAmount(amount, asBomPartnerCurrency(currency));

/** 단가 반올림 — 4자리(sp_bom_*.unitPrice Decimal(14,4)). 부품 단가는 원화도 소수가 흔하다. */
export const roundBomUnitPrice = (value: number): number =>
  Math.round(Number((value * 10_000).toPrecision(12))) / 10_000;

const roundRate = (value: number): number => Math.round(value * 10_000) / 10_000;

export const parsePartnerFxRates = (json: unknown): BomPartnerFxRatesType => {
  const obj =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const pick = (key: BomPartnerFxCurrencyType): BomPartnerFxRateType | null => {
    const parsed = BomPartnerFxRate.safeParse(obj[key]);
    return parsed.success ? parsed.data : null;
  };
  return { USD: pick('USD'), CNY: pick('CNY') };
};

const toStoredFxRates = (rates: BomPartnerFxRatesType): Prisma.InputJsonObject => ({
  ...(rates.USD === null ? {} : { USD: { ...rates.USD } }),
  ...(rates.CNY === null ? {} : { CNY: { ...rates.CNY } }),
});

type QuoteFxSource = Pick<SpBomQuote, 'usdKrwRateUsed' | 'exchangeRateSnapshot'>;

/** 지금 굳힌다면 어떤 값인가 — 저장하지 않는다. 환율원을 못 구하면 null. */
export const resolvePartnerFxNow = async (
  quote: QuoteFxSource,
  currency: BomPartnerFxCurrencyType,
): Promise<BomPartnerFxRateType | null> => {
  const frozenAt = new Date().toISOString();
  if (currency === 'USD') {
    // 달러는 이 견적이 공급사 가격에 이미 쓰는 환율을 그대로 따른다 — 한 견적 안에서 달러는 한 값.
    if (quote.usdKrwRateUsed !== null) {
      const rate = Number(quote.usdKrwRateUsed);
      const snapshot = BomQuoteExchangeRateSnapshot.safeParse(quote.exchangeRateSnapshot);
      return {
        rate,
        sourceRate: snapshot.success ? snapshot.data.sourceRate : rate,
        safetyMarginPercent: snapshot.success ? snapshot.data.safetyMarginPercent : 0,
        source: 'quote-usd',
        rateDate: snapshot.success ? snapshot.data.rateDate : null,
        frozenAt,
      };
    }
    const [config, cache] = await Promise.all([getBomQuoteConfig(), getCachedUsdExchangeRate()]);
    const snapshot = resolveUsdExchangeRate(config, cache);
    if (snapshot === null) return null;
    return {
      rate: snapshot.appliedRate,
      sourceRate: snapshot.sourceRate,
      safetyMarginPercent: snapshot.safetyMarginPercent,
      source: snapshot.source === 'manual' ? 'manual' : 'koreaexim',
      rateDate: snapshot.rateDate,
      frozenAt,
    };
  }
  // 위안 — 수출입은행 CNH 고시. 달러 자동 환율과 같은 기준(tts|매매기준율)·같은 안전 마진을 쓴다.
  const [config, cnh] = await Promise.all([getBomQuoteConfig(), getCachedCnhExchangeRate()]);
  if (cnh === null) return null;
  const sourceRate = config.usdKrwAutoRateType === 'tts' ? cnh.tts : cnh.dealBasR;
  const safetyMarginPercent =
    config.usdKrwRateMode === 'manual' ? 0 : config.usdKrwSafetyMarginPercent;
  return {
    rate: roundRate(sourceRate * (1 + safetyMarginPercent / 100)),
    sourceRate,
    safetyMarginPercent,
    source: 'koreaexim',
    rateDate: cnh.rateDate,
    frozenAt,
  };
};

type QuoteFxClient = Pick<Prisma.TransactionClient, 'spBomQuote'>;

/**
 * 견적의 통화별 고정 환율 — 이미 굳힌 값이 있으면 그것, 없으면 지금 굳혀 저장한다.
 * 환율원을 못 구하면 null(굳히지 않는다) — 관리자가 직접 입력해 굳힐 수 있다(setQuotePartnerFx).
 */
export const ensureQuotePartnerFx = async (
  quoteId: bigint,
  currency: BomPartnerFxCurrencyType,
  db: QuoteFxClient = prisma,
): Promise<BomPartnerFxRateType | null> => {
  const quote = await db.spBomQuote.findUnique({
    where: { id: quoteId },
    select: { partnerFxRates: true, usdKrwRateUsed: true, exchangeRateSnapshot: true },
  });
  if (quote === null) return null;
  const rates = parsePartnerFxRates(quote.partnerFxRates);
  const existing = rates[currency];
  if (existing !== null) return existing;
  const fresh = await resolvePartnerFxNow(quote, currency);
  if (fresh === null) return null;
  await db.spBomQuote.update({
    where: { id: quoteId },
    data: { partnerFxRates: toStoredFxRates({ ...rates, [currency]: fresh }) },
  });
  return fresh;
};

/** 관리자 입력으로 굳힌다(덮어쓰기). 이미 그 통화로 선정된 품목의 재환산은 호출부 몫이다. */
export const setQuotePartnerFx = async (
  quoteId: bigint,
  currency: BomPartnerFxCurrencyType,
  rate: number,
  db: QuoteFxClient = prisma,
): Promise<BomPartnerFxRateType | null> => {
  const quote = await db.spBomQuote.findUnique({
    where: { id: quoteId },
    select: { partnerFxRates: true },
  });
  if (quote === null) return null;
  const manual: BomPartnerFxRateType = {
    rate,
    sourceRate: rate,
    safetyMarginPercent: 0,
    source: 'manual',
    rateDate: null,
    frozenAt: new Date().toISOString(),
  };
  await db.spBomQuote.update({
    where: { id: quoteId },
    data: {
      partnerFxRates: toStoredFxRates({ ...parsePartnerFxRates(quote.partnerFxRates), [currency]: manual }),
    },
  });
  return manual;
};

/** 결제통화 단가 → 원화 단가(견적 고정 환율). 원화는 그대로, 환율이 없으면 null. */
export const partnerUnitPriceKrw = (
  unitPrice: number,
  currency: string,
  rates: BomPartnerFxRatesType,
): number | null => {
  const c = asBomPartnerCurrency(currency);
  if (c === 'KRW') return unitPrice;
  const fx = rates[c];
  return fx === null ? null : roundBomUnitPrice(unitPrice * fx.rate);
};

export interface PartnerRfqOfferInput {
  rfqItemId: bigint;
  partnerName: string;
  unitPrice: number;
  currency: string;
  replyQty: number | null;
  moq: number | null;
  stock: number | null;
  respondedAt: Date | null;
}

/**
 * 협력사 회신 → 라인에 박제할 구매 조건. 회신엔 수량 구간이 없어 전 수량 단일가 사다리다.
 * 외화 회신은 고정 환율로 원화 환산해 박제하고 원본을 sourcePrice 에 남긴다 — 수량이 바뀌어
 * 엔진이 다시 계산해도 원화 단가가 유지된다. 환율이 아직 없으면 null(선정 불가).
 */
export const buildPartnerRfqOffer = (
  input: PartnerRfqOfferInput,
  neededQty: number,
  fx: BomPartnerFxRateType | null,
): BomQuoteSelectedOfferType | null => {
  const currency = asBomPartnerCurrency(input.currency);
  const base = {
    offerKey: `rfq:${String(input.rfqItemId)}`,
    supplier: input.partnerName, // 표시 어휘 — 협력사명(공급사 코드 사전과 분리)
    supplierSku: '',
    packaging: null,
    breakQty: Math.max(1, input.replyQty ?? neededQty),
    moq: input.moq,
    orderMultiple: null,
    stock: input.stock,
    fetchedAt: (input.respondedAt ?? new Date()).toISOString(),
    pinned: true, // 관리자 명시 선정 — 자동 갱신이 덮지 않는다
  };
  if (currency === 'KRW') {
    return {
      ...base,
      unitPrice: input.unitPrice,
      currency: 'KRW',
      unitPriceKrw: input.unitPrice,
      priceBreaks: [{ qty: 1, price: input.unitPrice }],
    };
  }
  if (fx === null) return null;
  const krw = roundBomUnitPrice(input.unitPrice * fx.rate);
  return {
    ...base,
    unitPrice: krw,
    currency: 'KRW',
    unitPriceKrw: krw,
    priceBreaks: [{ qty: 1, price: krw }],
    sourcePrice: { currency, unitPrice: input.unitPrice, rate: fx.rate },
  };
};

export interface PoLineMoney {
  /** 원화 단가·금액 — 원화 발주는 정본, 외화 발주는 회계값. */
  unitPrice: number;
  lineTotal: number;
  /** 결제통화 단가·금액(정본) — 원화 발주는 null. */
  unitPriceOriginal: number | null;
  lineTotalOriginal: number | null;
}

/**
 * 발주 품목 금액. 원화는 그대로다. 외화는 결제통화 금액을 먼저 굳히고(2자리), 그 금액에 실제 환율을
 * 곱해 원화 회계값을 만든다 — 단가부터 환산해 곱하면 반올림이 수량만큼 불어난다.
 */
export const poLineMoney = (
  unitPrice: number,
  currency: string,
  qty: number,
  rate: number | null,
): PoLineMoney => {
  if (asBomPartnerCurrency(currency) === 'KRW' || rate === null) {
    return {
      unitPrice,
      lineTotal: Math.round(unitPrice * qty),
      unitPriceOriginal: null,
      lineTotalOriginal: null,
    };
  }
  const lineTotalOriginal = roundBomAmount(unitPrice * qty, currency);
  return {
    unitPrice: roundBomUnitPrice(unitPrice * rate),
    lineTotal: Math.round(lineTotalOriginal * rate),
    unitPriceOriginal: unitPrice,
    lineTotalOriginal,
  };
};

/**
 * 발주 장부의 환율 — 발행 시점의 **실제** 환율(결제통화→KRW, 안전 마진 없음).
 * 고시 캐시가 없으면 견적에 굳힌 값의 마진 전 환율로 물러난다. 원화는 null.
 */
export const resolvePoExchangeRate = async (
  currency: string,
  frozen: BomPartnerFxRateType | null,
): Promise<number | null> => {
  const c = asBomPartnerCurrency(currency);
  if (c === 'KRW') return null;
  const live = await getPcbExchangeRate(c, 'KRW');
  return live?.rate ?? frozen?.sourceRate ?? null;
};
