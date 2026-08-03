import { describe, expect, it } from 'vitest';
import {
  buildIcbanqMarketRecord,
  marketObservationToSnapshotProduct,
  parseElepartsMarketResponse,
  parseIcbanqMarketCandidates,
  parseIcbanqMarketDetail,
  summarizeCatalogMarketPriceRecords,
  type CatalogMarketPriceObservationType,
} from './catalog-market-price';
import type { CatalogPriceSnapshotTarget } from './catalog-price-snapshot';

const TARGET: CatalogPriceSnapshotTarget = {
  key: 'walsin:WR04X1001FTL',
  mpn: 'WR04X1001FTL',
  mpnNorm: 'WR04X1001FTL',
  manufacturerName: 'Walsin',
  manufacturerNorm: 'walsin',
};

function observation(
  partial: Partial<CatalogMarketPriceObservationType> = {},
): CatalogMarketPriceObservationType {
  return {
    site: 'icbanq',
    targetKey: TARGET.key,
    supplierSku: 'P0001',
    productUrl: 'https://www.icbanq.com/P0001',
    manufacturerName: TARGET.manufacturerName,
    manufacturerNorm: TARGET.manufacturerNorm,
    mpn: TARGET.mpn,
    mpnNorm: TARGET.mpnNorm,
    unitPriceKrw: 55,
    sourceLabel: 'digikey',
    fetchedAt: '2026-07-27T00:00:00.000Z',
    searchResponseSha256: 'a'.repeat(64),
    detailResponseSha256: 'b'.repeat(64),
    ...partial,
  };
}

describe('catalog-market-price', () => {
  it('Eleparts 제조사+MPN exact 결과 중 부가세 포함 최저가 SKU 하나만 보존한다', () => {
    const payload = JSON.stringify({
      page: { totalcount: 2 },
      list: [
        '<a href="/goods/view?no=101">',
        '<span class="cate">[WALSIN TECHNOLOGY]</span> WR04X1001FTL',
        '<i class="ico ico--mouser"></i>',
        '<span salep-val="73"></span>',
        '</a>',
        '<a href="/goods/view?no=103">',
        '<span class="cate">[WALSIN]</span> WR04X1001FTL',
        '<i class="ico ico--digikey"></i>',
        '<span salep-val="65"></span>',
        '</a>',
        '<a href="/goods/view?no=102">',
        '<span class="cate">[OTHER]</span> WR04X1001FTL',
        '<span salep-val="1"></span>',
        '</a>',
      ].join(''),
    });

    const record = parseElepartsMarketResponse(
      TARGET,
      payload,
      '2026-07-27T00:00:00.000Z',
    );

    expect(record.status).toBe('priced');
    expect(record.observations).toHaveLength(1);
    expect(record.observations[0]).toMatchObject({
      site: 'eleparts',
      supplierSku: '103',
      unitPriceKrw: 65,
      sourceLabel: 'digikey',
    });
  });

  it('Eleparts에서 동일 MPN의 타 제조사만 있으면 충돌로 남긴다', () => {
    const payload = JSON.stringify({
      list: [
        '<a href="/goods/view?no=102">',
        '<span class="cate">[OTHER]</span> WR04X1001FTL',
        '<span salep-val="1"></span>',
        '</a>',
      ].join(''),
    });

    expect(parseElepartsMarketResponse(TARGET, payload).status)
      .toBe('manufacturer_conflict');
  });

  it('ICBanQ 자동완성 exact MPN 후보를 가격순으로 중복 제거한다', () => {
    const payload = JSON.stringify({
      resultList: [
        {
          prod_code: 'P2',
          prod_name: 'WR04X1001FTL',
          prod_location: 'mouser',
          dmall_prices: '80',
        },
        {
          prod_code: 'P1',
          prod_name: 'WR04X1001FTL',
          prod_location: 'digikey',
          dmall_prices: '50',
        },
        {
          prod_code: 'P1',
          prod_name: 'WR04X1001FTL',
          prod_location: 'digikey',
          dmall_prices: '55',
        },
        {
          prod_code: 'P3',
          prod_name: 'WR04X1002FTL',
          dmall_prices: '1',
        },
      ],
    });

    expect(parseIcbanqMarketCandidates(TARGET, payload).map((candidate) => ({
      code: candidate.prodCode,
      price: candidate.unitPriceNetKrw,
    }))).toEqual([
      { code: 'P1', price: 50 },
      { code: 'P2', price: 80 },
    ]);
  });

  it('ICBanQ 상세의 제조사·MPN과 VAT 포함 가격을 모두 검증한다', () => {
    const payload = JSON.stringify({ resultList: [] });
    const candidate = {
      prodCode: 'P1',
      mpn: TARGET.mpn,
      mpnNorm: TARGET.mpnNorm,
      sourceLabel: 'digikey',
      unitPriceNetKrw: 52,
      productUrl: 'https://www.icbanq.com/P1',
    };
    const exact = parseIcbanqMarketDetail(
      TARGET,
      candidate,
      payload,
      [
        '<input type="hidden" name="prod_name" value="WR04X1001FTL" />',
        '<input type="hidden" name="prod_mfg" value="WALSIN TECH CORP." />',
        '<span id="Tax_Sales_Price"> 57원 </span>',
      ].join(''),
      '2026-07-27T00:00:00.000Z',
    );
    expect(exact.manufacturerConflict).toBe(false);
    expect(exact.observation?.unitPriceKrw).toBe(57);

    const conflict = parseIcbanqMarketDetail(
      TARGET,
      candidate,
      payload,
      [
        '<input type="hidden" name="prod_name" value="WR04X1001FTL" />',
        '<input type="hidden" name="prod_mfg" value="MULTICOMP PRO" />',
        '<span id="Tax_Sales_Price"> 22원 </span>',
      ].join(''),
    );
    expect(conflict).toEqual({
      observation: null,
      manufacturerConflict: true,
    });
  });

  it('시장가격 정보는 재고·MOQ를 만들지 않고 가격 증거만 저장한다', () => {
    const product = marketObservationToSnapshotProduct(observation());

    expect(product.supplier).toBe('icbanq');
    expect(product.offers[0]).toMatchObject({
      supplier: 'icbanq',
      stock: null,
      moq: null,
      order_multiple: null,
      price_breaks: [{ quantity: 1, unit_price: 55, currency: 'KRW' }],
    });
  });

  it('제조사별 가격 coverage를 결정적으로 집계한다', () => {
    const priced = buildIcbanqMarketRecord(
      TARGET,
      [observation()],
      1,
      0,
      2,
      '2026-07-27T00:00:00.000Z',
    );
    const missing = buildIcbanqMarketRecord(
      { ...TARGET, key: 'walsin:missing', mpn: 'MISSING', mpnNorm: 'MISSING' },
      [],
      0,
      0,
      1,
      '2026-07-27T00:00:00.000Z',
    );

    expect(summarizeCatalogMarketPriceRecords([priced, missing]))
      .toMatchObject({
        targets: 2,
        priced: 1,
        notFound: 1,
        observations: 1,
        requests: 3,
        manufacturerCounts: {
          walsin: { targets: 2, priced: 1, observations: 1 },
        },
      });
  });
});
