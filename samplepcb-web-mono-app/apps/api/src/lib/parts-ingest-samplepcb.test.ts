import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    spPart: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    spPartOffer: {
      deleteMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    spPartPriceBreak: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  };
  return {
    tx,
    transaction: vi.fn(
      async (run: (value: typeof tx) => Promise<unknown>) => run(tx),
    ),
  };
});

vi.mock('./prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  applyPartFacts,
  shouldRestoreSamplepcbCatalogOffer,
} from './parts-ingest';

function catalogRaw(): Record<string, unknown> {
  return {
    supplier: 'walsin',
    manufacturer_part_number: 'WR06X1002FTL',
    manufacturer: 'Walsin',
    description: 'Chip Resistor',
    category: 'Chip Resistor',
    package: '0603',
    normalized_specs: {
      part_type: 'resistor',
      resistance_ohm: 10_000,
      tolerance_percent: 1,
      package: '0603',
    },
    catalog_metadata: {
      catalogOnly: true,
      commercialDataAvailable: false,
      samplepcbPreferred: true,
      autoQuoteEligible: true,
    },
  };
}

function offer(
  supplier: string,
  rawJson: Record<string, unknown>,
  prices: { qty: number; price: number; currency: string }[] = [],
): Record<string, unknown> {
  return {
    id: supplier === 'samplepcb' ? 20n : 10n,
    partId: 1n,
    supplier,
    supplierSku: 'WR06X1002FTL',
    productUrl: null,
    stock: supplier === 'samplepcb' ? null : 500,
    moq: null,
    orderMultiple: null,
    packaging: null,
    currency: prices[0]?.currency ?? null,
    leadTime: null,
    rawJson,
    fetchedAt: new Date('2026-07-26T00:00:00Z'),
    priceBreaks: prices,
  };
}

function part(realPrices: { qty: number; price: number; currency: string }[] = []): Record<string, unknown> {
  const raw = catalogRaw();
  return {
    id: 1n,
    mpn: 'WR06X1002FTL',
    mpnNorm: 'WR06X1002FTL',
    manufacturerName: 'Walsin',
    manufacturerNorm: 'walsin',
    description: null,
    category: null,
    packageCode: null,
    lifecycle: null,
    datasheetUrl: null,
    imageUrl: null,
    specsJson: {},
    specsSi: {},
    specConflicts: null,
    factsFingerprint: null,
    offers: [
      offer('walsin', raw, realPrices),
      offer('samplepcb', raw),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.spPart.update.mockResolvedValue({});
  mocks.tx.spPartOffer.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.spPartOffer.update.mockResolvedValue({});
  mocks.tx.spPartOffer.upsert.mockResolvedValue({ id: 20n });
  mocks.tx.spPartPriceBreak.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.spPartPriceBreak.createMany.mockResolvedValue({ count: 0 });
});

describe('SamplePCB 자체 카탈로그 오퍼 보존', () => {
  it('가격이 원장보다 먼저 저장된 중단 상태만 카탈로그 정본으로 복구한다', () => {
    const incoming = catalogRaw();
    const directPrice = {
      derivedFrom: {
        supplier: 'digikey',
        supplierSku: '123-ND',
        fetchedAt: '2026-07-26T00:00:00.000Z',
      },
      policyVersion: 1,
    };
    const normalOverlay = {
      ...incoming,
      samplepcbPricing: directPrice,
    };

    expect(shouldRestoreSamplepcbCatalogOffer('samplepcb', incoming, directPrice)).toBe(true);
    expect(shouldRestoreSamplepcbCatalogOffer('samplepcb', incoming, normalOverlay)).toBe(false);
    expect(shouldRestoreSamplepcbCatalogOffer('digikey', incoming, directPrice)).toBe(false);
    expect(shouldRestoreSamplepcbCatalogOffer('samplepcb', incoming, { manuallyEntered: true })).toBe(false);
  });

  it('외부 가격이 없어도 자체 취급 오퍼를 삭제하지 않는다', async () => {
    mocks.tx.spPart.findUnique.mockResolvedValue(part());

    await applyPartFacts(1n);

    expect(mocks.tx.spPartOffer.deleteMany).toHaveBeenCalledWith({
      where: {
        partId: 1n,
        supplier: 'samplepcb',
        NOT: { id: 20n },
      },
    });
    const updateCall = mocks.tx.spPartOffer.update.mock.calls[0]?.[0] as
      | { where: { id: bigint }; data: { stock: number | null } }
      | undefined;
    expect(updateCall).toMatchObject({
      where: { id: 20n },
      data: { stock: null },
    });
    expect(mocks.tx.spPartPriceBreak.deleteMany).toHaveBeenCalledWith({
      where: { offerId: 20n },
    });
    expect(mocks.tx.spPartOffer.upsert).not.toHaveBeenCalled();
  });

  it('공급사 가격은 복사하되 자체 재고는 null로 유지한다', async () => {
    mocks.tx.spPart.findUnique.mockResolvedValue(
      part([{ qty: 1, price: 12.5, currency: 'KRW' }]),
    );

    await applyPartFacts(1n);

    const call = mocks.tx.spPartOffer.upsert.mock.calls[0]?.[0] as {
      update: { stock: number | null; rawJson: Record<string, unknown> };
    };
    expect(call.update.stock).toBeNull();
    expect(call.update.rawJson).toMatchObject({
      catalog_metadata: { samplepcbPreferred: true },
      samplepcbPricing: {
        derivedFrom: { supplier: 'walsin', supplierSku: 'WR06X1002FTL' },
      },
    });
    expect(mocks.tx.spPartPriceBreak.createMany).toHaveBeenCalledWith({
      data: [{ offerId: 20n, qty: 1, price: 12.5, currency: 'KRW' }],
    });
  });
});
