import { describe, expect, it } from 'vitest';
import type { BomPartnerFxRateType } from '@sp/api-contract';
import {
  asBomPartnerCurrency,
  buildPartnerRfqOffer,
  parsePartnerFxRates,
  partnerUnitPriceKrw,
  poLineMoney,
  roundBomAmount,
  roundBomUnitPrice,
} from './bom-fx';
import { recalcItems } from './bom-quote';

// BOM 협력사 외화 — docs/SMARTBOM_PARTNER_RFQ.md "외화 회신".
// 고객가는 견적 고정 환율(안전 마진 포함), 발주 장부는 발행 시점 실제 환율.

const fx = (rate: number, sourceRate = rate): BomPartnerFxRateType => ({
  rate,
  sourceRate,
  safetyMarginPercent: 0,
  source: 'koreaexim',
  rateDate: '2026-10-08',
  frozenAt: '2026-10-09T00:00:00.000Z',
});

const reply = (currency: string, unitPrice: number) => ({
  rfqItemId: 77n,
  partnerName: '무대협력사',
  unitPrice,
  currency,
  replyQty: null,
  moq: 10,
  stock: 500,
  respondedAt: new Date('2026-10-09T01:00:00.000Z'),
});

describe('asBomPartnerCurrency', () => {
  it('모르는 값·빈 값은 원화로 본다', () => {
    expect(asBomPartnerCurrency('USD')).toBe('USD');
    expect(asBomPartnerCurrency('CNY')).toBe('CNY');
    expect(asBomPartnerCurrency('EUR')).toBe('KRW');
    expect(asBomPartnerCurrency(null)).toBe('KRW');
  });
});

describe('반올림', () => {
  it('금액 — 원화 0자리·외화 2자리', () => {
    expect(roundBomAmount(1234.5, 'KRW')).toBe(1235);
    expect(roundBomAmount(12.345, 'USD')).toBe(12.35);
    expect(roundBomAmount(12.344, 'CNY')).toBe(12.34);
  });

  it('단가 — 4자리, 부동소수 오차에 흔들리지 않는다', () => {
    expect(roundBomUnitPrice(0.035 * 1400)).toBe(49);
    expect(roundBomUnitPrice(0.12345 * 195.5)).toBe(24.1345);
  });
});

describe('parsePartnerFxRates', () => {
  it('비어 있거나 깨진 값은 통화별 null', () => {
    expect(parsePartnerFxRates(null)).toEqual({ USD: null, CNY: null });
    expect(parsePartnerFxRates({ USD: { rate: 'x' } })).toEqual({ USD: null, CNY: null });
  });

  it('굳힌 값은 그대로 읽는다', () => {
    const usd = fx(1400);
    expect(parsePartnerFxRates({ USD: usd })).toEqual({ USD: usd, CNY: null });
  });
});

describe('partnerUnitPriceKrw', () => {
  it('원화는 그대로, 외화는 고정 환율, 환율이 없으면 null', () => {
    const rates = { USD: fx(1400), CNY: null };
    expect(partnerUnitPriceKrw(120, 'KRW', rates)).toBe(120);
    expect(partnerUnitPriceKrw(0.035, 'USD', rates)).toBe(49);
    expect(partnerUnitPriceKrw(0.25, 'CNY', rates)).toBeNull();
  });
});

describe('buildPartnerRfqOffer', () => {
  it('원화 회신 — 환율 없이 그대로 박제하고 원본 표기는 남기지 않는다', () => {
    const offer = buildPartnerRfqOffer(reply('KRW', 120), 100, null);
    expect(offer).toMatchObject({
      offerKey: 'rfq:77',
      supplier: '무대협력사',
      unitPrice: 120,
      currency: 'KRW',
      unitPriceKrw: 120,
      breakQty: 100,
      priceBreaks: [{ qty: 1, price: 120 }],
      pinned: true,
    });
    expect(offer?.sourcePrice).toBeUndefined();
  });

  it('외화 회신 — 고정 환율로 원화 박제하고 원본(통화·단가·환율)을 남긴다', () => {
    const offer = buildPartnerRfqOffer(reply('USD', 0.035), 100, fx(1400));
    expect(offer).toMatchObject({
      unitPrice: 49,
      currency: 'KRW',
      unitPriceKrw: 49,
      priceBreaks: [{ qty: 1, price: 49 }],
      sourcePrice: { currency: 'USD', unitPrice: 0.035, rate: 1400 },
    });
  });

  it('외화 회신인데 환율이 없으면 박제하지 않는다(선정 불가)', () => {
    expect(buildPartnerRfqOffer(reply('CNY', 0.25), 100, null)).toBeNull();
  });

  it('수량이 바뀌어 다시 계산해도 원화 단가와 원본이 유지된다', () => {
    const offer = buildPartnerRfqOffer(reply('USD', 0.035), 100, fx(1400));
    if (offer === null) throw new Error('offer');
    const [computed] = recalcItems(
      [
        {
          rowIdx: 0,
          included: true,
          mpn: 'RC0402FR-0710KL',
          manufacturerName: 'YAGEO',
          description: null,
          bomQty: 1,
          orderQty: 250,
          matchStatus: 'manual' as const,
          matchEvidence: null,
          recommendedCandidateKey: null,
          selectedCandidateKey: null,
          selectionSource: 'partner' as const,
          partId: null,
          selectedOffer: offer,
          sourceRow: null,
          sourceSheetIndex: null,
          sourceSheetName: null,
        },
      ],
      // 달러 환율이 달라도 영향이 없어야 한다 — 박제는 이미 원화다.
      1500,
    );
    expect(computed?.selectedOffer.unitPriceKrw).toBe(49);
    expect(computed?.lineTotalKrw).toBe(12_250);
    expect(computed?.selectedOffer.sourcePrice).toEqual({
      currency: 'USD',
      unitPrice: 0.035,
      rate: 1400,
    });
  });
});

describe('poLineMoney', () => {
  it('원화 발주 — 결제통화 표기는 비운다', () => {
    expect(poLineMoney(120, 'KRW', 100, null)).toEqual({
      unitPrice: 120,
      lineTotal: 12_000,
      unitPriceOriginal: null,
      lineTotalOriginal: null,
    });
  });

  it('외화 발주 — 결제통화 금액을 먼저 굳히고 실제 환율로 원화 회계값을 만든다', () => {
    // 고객가는 1,400 원(마진 포함)으로 받았지만 장부에는 발행일 실제 환율 1,380 원으로 적는다.
    expect(poLineMoney(0.035, 'USD', 333, 1380)).toEqual({
      unitPrice: 48.3,
      lineTotal: Math.round(11.66 * 1380),
      unitPriceOriginal: 0.035,
      lineTotalOriginal: 11.66,
    });
  });
});
