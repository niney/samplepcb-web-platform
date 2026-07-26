import { describe, expect, it } from 'vitest';
import { isCatalogInquiryOffer, partOfferKind } from './parts-offer-kind';

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
});
