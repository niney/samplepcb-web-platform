import { describe, expect, it } from 'vitest';
import type { BusinessInfo } from './g5-db';
import {
  buildPartnerQuotationDocument,
  type TradePartnerProfile,
  type TradeQuotationSource,
} from './bom-trade-documents';

const business: BusinessInfo = {
  companyName: '주식회사 샘플피씨비',
  ownerName: '대표자',
  businessNo: '000-00-00000',
  tel: '02-000-0000',
  fax: '',
  mailOrderNo: '',
  bugaNo: '',
  zip: '00000',
  addr: '서울시',
  infoManagerName: '담당자',
  infoManagerEmail: 'info@example.com',
};

const partner = (country: string): TradePartnerProfile => ({
  name: '협력사',
  country,
  contactName: '파트너 담당자',
  contactPhone: '010-0000-0000',
  contactEmail: 'partner@example.com',
  businessNo: '111-11-11111',
  ownerName: '협력사 대표',
  businessZip: '12345',
  businessAddress: '부품로 1',
  businessType: '도소매',
  businessItem: '전자부품',
  fax: null,
});

const source = (country: string): TradeQuotationSource => ({
  id: 12n,
  quoteId: 34n,
  quoteTitle: 'BOM Case',
  issuedAt: new Date('2026-08-02T00:00:00.000Z'),
  currency: 'KRW',
  totalAmount: 1000,
  quotationDeliveryDate: new Date('2026-08-20T00:00:00.000Z'),
  quotationMemo: '납기 협의',
  partner: partner(country),
  items: [
    {
      id: 56n,
      mpn: 'RC0603FR-0710KL',
      manufacturerName: 'Yageo',
      description: '10kΩ resistor',
      qty: 10,
      unitPrice: 100,
      lineTotal: 1000,
      moq: 10,
      stock: 500,
      dateCode: '25+',
      leadTime: '2 weeks',
      quotationMemo: null,
    },
  ],
});

describe('buildPartnerQuotationDocument', () => {
  it('국내 협력사는 공급가액에 부가세 10%를 분리한다', () => {
    const result = buildPartnerQuotationDocument(
      source('KR'),
      business,
      new Date('2026-08-02T01:00:00.000Z'),
    );

    expect(result.quotationNo).toBe('PQT-SPB-12');
    expect(result.vatAmount).toBe(100);
    expect(result.totalAmount).toBe(1100);
    expect(result.items[0]).toMatchObject({ moq: 10, dateCode: '25+', leadTime: '2 weeks' });
    expect(result.recipient.companyName).toBe('주식회사 샘플피씨비');
  });

  it('해외 협력사 견적에는 국내 부가세를 임의 적용하지 않는다', () => {
    const result = buildPartnerQuotationDocument(source('US'), business);

    expect(result.vatAmount).toBe(0);
    expect(result.totalAmount).toBe(1000);
  });
});
