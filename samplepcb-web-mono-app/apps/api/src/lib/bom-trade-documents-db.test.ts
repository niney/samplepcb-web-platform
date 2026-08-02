import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findPo: vi.fn(),
  findShipment: vi.fn(),
  getBusinessInfo: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spBomPo: { findUnique: mocks.findPo },
    spBomShipment: { findUnique: mocks.findShipment },
  },
}));
vi.mock('./g5-db', () => ({ getBusinessInfo: mocks.getBusinessInfo }));

import {
  loadPartnerQuotationDocument,
  loadShipmentStatementDocument,
} from './bom-trade-documents';

const partner = {
  id: 8n,
  name: '국내 부품사',
  country: 'KR',
  defaultCurrency: 'KRW',
  contactName: '담당자',
  contactPhone: '02-0000-0000',
  contactEmail: 'partner@example.com',
  businessNo: '111-11-11111',
  ownerName: '파트너 대표',
  businessZip: '12345',
  businessAddress: '서울시 부품로 1',
  businessType: '도소매',
  businessItem: '전자부품',
  fax: null,
};

const po = {
  id: 12n,
  quoteId: 34n,
  partnerId: 8n,
  currency: 'KRW',
  quotationData: null,
  partner,
  quote: { title: '테스트 Case' },
  items: [
    {
      id: 56n,
      mpn: 'RC0603FR-0710KL',
      manufacturerName: 'Yageo',
      description: '10kΩ resistor',
      qty: 10,
      unitPrice: 100,
    },
  ],
};

describe('loadShipmentStatementDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPo.mockResolvedValue(po);
    mocks.getBusinessInfo.mockResolvedValue({
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
    });
    mocks.findShipment.mockResolvedValue({
      id: 77n,
      mode: 'domestic',
      packingRevision: 3,
      packingFinalizedAt: new Date('2026-08-02T01:00:00.000Z'),
      packingUpdatedAt: new Date('2026-08-02T00:30:00.000Z'),
      shipDate: new Date('2026-08-03T00:00:00.000Z'),
      carrier: 'CJ대한통운',
      trackingNumber: '1234567890',
      po,
      pos: [{ po }],
      packingItems: [
        {
          poItemId: 56n,
          packages: [
            { quantity: 4, lotNo: 'LOT-A', dateCode: '25+' },
            { quantity: 6, lotNo: 'LOT-B', dateCode: '25+' },
          ],
        },
      ],
    });
  });

  it('확정 Packing List 수량과 추적값으로 국내 거래명세서를 합산한다', async () => {
    const result = await loadShipmentStatementDocument(77n, 8n);

    expect(result).toMatchObject({
      statementNo: 'STMT-SPB-77-R3',
      isDraft: false,
      totalQuantity: 10,
      supplyAmount: 1000,
      vatAmount: 100,
      totalAmount: 1100,
    });
    expect(result?.items[0]).toMatchObject({
      shippedQty: 10,
      lineTotal: 1000,
      lotNos: ['LOT-A', 'LOT-B'],
      dateCodes: ['25+'],
    });
  });

  it('다른 협력사의 선적은 조회하지 않는다', async () => {
    await expect(loadShipmentStatementDocument(77n, 999n)).resolves.toBeNull();
    expect(mocks.getBusinessInfo).not.toHaveBeenCalled();
  });

  it('국외 발송에는 국내 거래명세서를 제공하지 않는다', async () => {
    mocks.findShipment.mockResolvedValueOnce({
      ...(await mocks.findShipment()),
      mode: 'international',
    });

    await expect(loadShipmentStatementDocument(77n, 8n)).resolves.toBeNull();
    expect(mocks.getBusinessInfo).not.toHaveBeenCalled();
  });

  it('국외 협력사 PO에는 국내 견적서를 제공하지 않는다', async () => {
    mocks.findPo.mockResolvedValueOnce({
      ...po,
      partner: { ...partner, country: 'US' },
    });

    await expect(loadPartnerQuotationDocument(12n, 8n)).resolves.toBeNull();
    expect(mocks.getBusinessInfo).not.toHaveBeenCalled();
  });
});
