import { describe, expect, it } from 'vitest';
import {
  isCatalogInquiryOffer,
  isCatalogProvenanceOffer,
  partOfferDerivedFrom,
  partOfferKind,
  partOffersForDisplay,
} from './parts-offer-kind';

describe('partOfferKind', () => {
  it('명시적인 제조사 카탈로그 오퍼를 문의 대상으로 판정한다', () => {
    expect(partOfferKind({ offer_kind: 'manufacturer_catalog' })).toBe('manufacturer_catalog');
  });

  it('기존 catalog_metadata 기반 오퍼도 문의 대상으로 복원한다', () => {
    const raw = {
      catalog_metadata: {
        catalogOnly: true,
        commercialDataAvailable: false,
      },
    };
    expect(partOfferKind(raw)).toBe('manufacturer_catalog');
    expect(isCatalogInquiryOffer(raw)).toBe(true);
  });

  it('상업 정보가 있는 일반 공급사 오퍼는 기존 종류를 유지한다', () => {
    expect(partOfferKind({ catalog_metadata: { catalogOnly: true, commercialDataAvailable: true } }))
      .toBe('supplier_offer');
    expect(partOfferKind(null)).toBe('supplier_offer');
  });

  it('SamplePCB 취급 카탈로그의 제조사 원천만 공급사 표시에서 제외한다', () => {
    const preferredCatalog = {
      supplier: 'walsin',
      catalog_metadata: {
        catalogOnly: true,
        commercialDataAvailable: false,
        samplepcbPreferred: true,
      },
    };
    const offers = [
      { supplier: 'walsin', rawJson: preferredCatalog },
      { supplier: 'samplepcb', rawJson: preferredCatalog },
      { supplier: 'digikey', rawJson: {} },
    ];

    expect(isCatalogProvenanceOffer('walsin', preferredCatalog)).toBe(true);
    expect(isCatalogProvenanceOffer('samplepcb', preferredCatalog)).toBe(false);
    expect(partOffersForDisplay(offers).map((offer) => offer.supplier)).toEqual([
      'samplepcb',
      'digikey',
    ]);
  });

  it('SamplePCB 취급 표식이 없는 기존 제조사 카탈로그는 표시를 유지한다', () => {
    const legacyCatalog = {
      supplier: 'yeonho',
      catalog_metadata: {
        catalogOnly: true,
        commercialDataAvailable: false,
      },
    };
    expect(isCatalogProvenanceOffer('yeonho', legacyCatalog)).toBe(false);
  });

  it('기존 파생 오퍼와 카탈로그 가격 오버레이의 원천을 모두 읽는다', () => {
    const derivedFrom = {
      supplier: 'digikey',
      supplierSku: '123-ND',
      fetchedAt: '2026-07-26T00:00:00.000Z',
    };
    expect(partOfferDerivedFrom({ derivedFrom })).toEqual(derivedFrom);
    expect(partOfferDerivedFrom({
      samplepcbPricing: { derivedFrom, policyVersion: 1 },
    })).toEqual(derivedFrom);
    expect(partOfferDerivedFrom({})).toBeNull();
  });
});
