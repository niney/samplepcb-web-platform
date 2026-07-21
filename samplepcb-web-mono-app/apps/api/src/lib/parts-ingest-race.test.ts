import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  partUpsert: vi.fn(),
  partFindUnique: vi.fn(),
  ingestRunUpsert: vi.fn(),
  ingestRunFindUnique: vi.fn(),
  ingestRunFindUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spPart: {
      upsert: prismaMocks.partUpsert,
      findUnique: prismaMocks.partFindUnique,
    },
    spPartIngestRun: {
      upsert: prismaMocks.ingestRunUpsert,
      findUnique: prismaMocks.ingestRunFindUnique,
      findUniqueOrThrow: prismaMocks.ingestRunFindUniqueOrThrow,
    },
    $transaction: prismaMocks.transaction,
  },
}));

import { ingestSupplierSearchResult, ingestSupplierSearchResultOnce } from './parts-ingest';

function uniqueConflict(modelName: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique race', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { modelName },
  });
}

function deadlock(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('deadlock', {
    code: 'P2034',
    clientVersion: '6.19.3',
    meta: { modelName: 'SpPartPriceBreak' },
  });
}

function supplierEnvelope(): unknown {
  return {
    search: {
      components: [{
        candidates: [{
          product: {
            supplier: 'mouser',
            manufacturer_part_number: 'RACE-PART-1',
            manufacturer: 'Yageo',
            normalized_specs: {},
            offers: [{
              supplier: 'mouser',
              supplier_sku: 'RACE-SKU',
              stock: 10,
              fetched_at: '2026-07-21T00:00:00.000Z',
              price_breaks: [],
            }],
          },
        }],
      }],
    },
  };
}

function mockCurrentOfferTransaction(): void {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
    spPart: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ factsFingerprint: 'current-facts' }),
    },
    spPartOffer: {
      findUnique: vi.fn().mockResolvedValue({
        id: 21n,
        fetchedAt: new Date('2026-07-22T00:00:00.000Z'),
        contentFingerprint: 'current-offer',
      }),
    },
  };
  prismaMocks.transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation !== 'function') throw new Error('unexpected transaction form');
    return (operation as (client: typeof tx) => Promise<unknown>)(tx);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parts ingest P2002 race recovery', () => {
  it('신규 part upsert 경합은 승자가 만든 행을 재조회해 계속 처리한다', async () => {
    prismaMocks.partUpsert.mockRejectedValueOnce(uniqueConflict('SpPart'));
    prismaMocks.partFindUnique.mockResolvedValueOnce({ id: 11n });
    mockCurrentOfferTransaction();

    await expect(ingestSupplierSearchResult(supplierEnvelope())).resolves.toMatchObject({
      parts: 0,
      offers: 0,
      skippedParts: 1,
      skippedOffers: 1,
    });
    expect(prismaMocks.partFindUnique).toHaveBeenCalledTimes(1);
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('신규 ingest run upsert 경합은 기존 원장을 재조회해 완료 결과를 재사용한다', async () => {
    prismaMocks.ingestRunUpsert.mockRejectedValueOnce(uniqueConflict('SpPartIngestRun'));
    prismaMocks.ingestRunFindUnique.mockResolvedValueOnce({ id: 31n });
    prismaMocks.ingestRunFindUniqueOrThrow.mockResolvedValueOnce({
      id: 31n,
      status: 'completed',
      stats: { parts: 2, offers: 3, indexed: 2, queued: 0, skippedParts: 0, skippedOffers: 0 },
      timing: { dbElapsedMs: 10, indexElapsedMs: 5, elapsedMs: 15 },
    });

    await expect(ingestSupplierSearchResultOnce(supplierEnvelope(), 'race-job')).resolves.toMatchObject({
      runId: '31',
      reused: true,
      stats: { parts: 2, offers: 3 },
    });
    expect(prismaMocks.ingestRunFindUnique).toHaveBeenCalledTimes(1);
    expect(prismaMocks.ingestRunFindUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('운영 부하에서 네 번 연속 P2034가 발생해도 지수 백오프 뒤 다시 시도해 수렴한다', async () => {
    vi.useFakeTimers();
    prismaMocks.partUpsert.mockResolvedValueOnce({ id: 11n });
    prismaMocks.transaction
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock());
    mockCurrentOfferTransaction();

    const resultPromise = ingestSupplierSearchResult(supplierEnvelope());
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({
      parts: 0,
      offers: 0,
      skippedParts: 1,
      skippedOffers: 1,
    });
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(5);
    expect(prismaMocks.transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: 10_000,
        timeout: 30_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }),
    );
  });
});
