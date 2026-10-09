import { describe, expect, it } from 'vitest';
import { Prisma, type SpBomRfqItem } from '@prisma/client';
import type { BomRfqChildViewType } from '@sp/api-contract';
import { childSelectionOf } from './bom-rfq';
import { resolveChildCapabilities, rfqTracksOf } from './partner-children';

// BOM 마스터딜러 중개(견적 단계) — docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개".

const child = (unitPrice: number | null): BomRfqChildViewType => ({
  rfqId: 50,
  partnerId: 9,
  partnerName: '무대하위',
  status: unitPrice === null ? 'requested' : 'quoted',
  currency: 'CNY',
  rateToParent: 0.138486,
  totalAmount: null,
  deliveryDate: null,
  memo: null,
  requestedAt: '2026-10-09T00:00:00.000Z',
  respondedAt: null,
  repliedItemCount: unitPrice === null ? 0 : 1,
  requestedItemIds: null,
  magicToken: null,
  hasPortalAccount: false,
  items:
    unitPrice === null
      ? []
      : [
          {
            rfqItemId: 501,
            quoteItemId: '7',
            unitPrice,
            unitPriceInParent: null,
            replyQty: null,
            moq: null,
            stock: null,
            dateCode: null,
            leadTime: null,
            memo: null,
          },
        ],
});

const mdRow = (over: Partial<SpBomRfqItem> = {}): SpBomRfqItem => ({
  id: 1n,
  rfqId: 40n,
  quoteItemId: 7n,
  source: 'manual',
  unitPrice: new Prisma.Decimal('0.0045'),
  currency: 'USD',
  replyQty: null,
  moq: null,
  stock: null,
  dateCode: null,
  leadTime: null,
  memo: null,
  offerId: null,
  selectedChildRfqId: 50n,
  marginRate: new Prisma.Decimal('8'),
  sourceCurrency: 'CNY',
  sourceUnitPrice: new Prisma.Decimal('0.03'),
  sourceRate: new Prisma.Decimal('0.138486'),
  createdAt: new Date('2026-10-09T00:00:00.000Z'),
  updatedAt: new Date('2026-10-09T00:00:00.000Z'),
  ...over,
});

describe('childSelectionOf', () => {
  it('직접 회신 행은 근거가 없다', () => {
    expect(childSelectionOf(mdRow({ selectedChildRfqId: null }), [child(0.03)])).toBeNull();
  });

  it('하위 회신이 그대로면 근거를 싣고 stale 이 아니다', () => {
    expect(childSelectionOf(mdRow(), [child(0.03)])).toEqual({
      childRfqId: 50,
      childPartnerId: 9,
      childPartnerName: '무대하위',
      marginRate: 8,
      sourceCurrency: 'CNY',
      sourceUnitPrice: 0.03,
      sourceRate: 0.138486,
      stale: false,
    });
  });

  it('하위가 다시 회신해 단가가 달라지면 stale', () => {
    expect(childSelectionOf(mdRow(), [child(0.035)])?.stale).toBe(true);
  });

  it('하위가 회신을 거뒀거나 재요청이 회수됐어도 박제는 남고 stale 로 알린다', () => {
    expect(childSelectionOf(mdRow(), [child(null)])?.stale).toBe(true);
    const gone = childSelectionOf(mdRow(), []);
    expect(gone?.stale).toBe(true);
    expect(gone?.sourceUnitPrice).toBe(0.03);
  });
});

describe('하위에게 맡길 일(견적 트랙)', () => {
  it('조직의 견적 트랙만 추린다', () => {
    expect(rfqTracksOf(['bom_rfq', 'part_sale'])).toEqual(['bom_rfq']);
    expect(rfqTracksOf(['pcb_rfq', 'bom_rfq'])).toEqual(['pcb_rfq', 'bom_rfq']);
    expect(rfqTracksOf(null)).toEqual([]);
  });

  it('생략하면 내 트랙 전부', () => {
    expect(resolveChildCapabilities(['pcb_rfq', 'bom_rfq'], undefined).capabilities).toEqual([
      'pcb_rfq',
      'bom_rfq',
    ]);
    expect(resolveChildCapabilities(['pcb_rfq'], undefined).capabilities).toEqual(['pcb_rfq']);
  });

  it('내게 없는 트랙은 줄 수 없다', () => {
    expect(resolveChildCapabilities(['pcb_rfq'], ['bom_rfq']).tracks).toEqual([]);
    expect(resolveChildCapabilities(['pcb_rfq', 'bom_rfq'], ['bom_rfq']).capabilities).toEqual([
      'bom_rfq',
    ]);
  });

  it('견적 트랙이 아닌 능력은 수정해도 보존한다', () => {
    expect(
      resolveChildCapabilities(['pcb_rfq', 'bom_rfq'], ['pcb_rfq'], ['bom_rfq', 'part_sale']).capabilities,
    ).toEqual(['pcb_rfq', 'part_sale']);
  });
});
