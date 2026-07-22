import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  partUpsert: vi.fn(),
  partFindUnique: vi.fn(),
  ingestRunUpsert: vi.fn(),
  ingestRunFindUnique: vi.fn(),
  ingestRunFindUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
  indexQueueFindMany: vi.fn(),
  indexQueueCount: vi.fn(),
  indexQueueFindFirst: vi.fn(),
  indexQueueCreate: vi.fn(),
  indexQueueUpdateMany: vi.fn(),
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
    spPartIndexQueue: {
      findMany: prismaMocks.indexQueueFindMany,
      count: prismaMocks.indexQueueCount,
      findFirst: prismaMocks.indexQueueFindFirst,
      create: prismaMocks.indexQueueCreate,
      updateMany: prismaMocks.indexQueueUpdateMany,
    },
    $transaction: prismaMocks.transaction,
  },
}));

import {
  canonicalPriceBreaks,
  drainIndexQueue,
  ingestSupplierSearchResult,
  ingestSupplierSearchResultOnce,
  queuePartIndex,
} from './parts-ingest';

describe('공급사 가격 구간 정규화', () => {
  it('동일 수량 구간은 가장 낮은 단가 하나만 저장 대상으로 남긴다', () => {
    expect(canonicalPriceBreaks([
      { quantity: 10_000, unit_price: 0.002, currency: 'USD' },
      { quantity: 1, unit_price: 0.01, currency: 'USD' },
      { quantity: 10_000, unit_price: 0.0018, currency: 'USD' },
    ])).toEqual([
      { quantity: 1, unit_price: 0.01, currency: 'USD' },
      { quantity: 10_000, unit_price: 0.0018, currency: 'USD' },
    ]);
  });
});

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
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        factsFingerprint: 'current-facts',
        indexFingerprint: 'current-index',
        indexedAt: new Date('2026-07-22T00:00:00.000Z'),
      }),
    },
    spPartIndexQueue: { findFirst: vi.fn().mockResolvedValue(null) },
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

describe('색인 큐 poison 정책', () => {
  it('드레인은 살아있는 행만 attempts 오름차순으로 조회하고 dead 카운트를 함께 보고한다', async () => {
    // live 행이 없으면 per-part 처리는 건너뛰고 remaining/dead 집계만 반환한다.
    prismaMocks.indexQueueFindMany.mockResolvedValueOnce([]);
    prismaMocks.indexQueueCount
      .mockResolvedValueOnce(3) // remaining = attempts < 상한(살아있는 행)
      .mockResolvedValueOnce(7); // dead = attempts >= 상한(dead-letter)

    await expect(drainIndexQueue()).resolves.toEqual({ drained: 0, remaining: 3, dead: 7 });

    // 신규 행(attempts 0)이 늘 먼저 오도록 attempts→queuedAt 오름차순, 상한 미만만 조회한다.
    expect(prismaMocks.indexQueueFindMany).toHaveBeenCalledWith({
      where: { attempts: { lt: 20 } },
      orderBy: [{ attempts: 'asc' }, { queuedAt: 'asc' }],
      take: 200,
    });
    expect(prismaMocks.indexQueueCount).toHaveBeenNthCalledWith(1, { where: { attempts: { lt: 20 } } });
    expect(prismaMocks.indexQueueCount).toHaveBeenNthCalledWith(2, { where: { attempts: { gte: 20 } } });
  });

  it('queuePartIndex: 큐 행이 없으면 새로 만든다', async () => {
    prismaMocks.indexQueueFindFirst.mockResolvedValueOnce(null);

    await queuePartIndex(11n, 'first failure');

    expect(prismaMocks.indexQueueCreate).toHaveBeenCalledWith({
      data: { partId: 11n, reason: 'first failure' },
    });
    expect(prismaMocks.indexQueueUpdateMany).not.toHaveBeenCalled();
  });

  it('queuePartIndex: 살아있는(attempts<상한) 행은 건드리지 않는다(no-op)', async () => {
    prismaMocks.indexQueueFindFirst.mockResolvedValueOnce({ id: 5n, attempts: 3 });

    await queuePartIndex(11n, 'drain failure retry');

    expect(prismaMocks.indexQueueCreate).not.toHaveBeenCalled();
    expect(prismaMocks.indexQueueUpdateMany).not.toHaveBeenCalled();
  });

  it('queuePartIndex: dead-letter(attempts>=상한) 행은 attempts를 0으로 되돌려 부활시킨다', async () => {
    // queuedAt은 new Date()라 시스템 시각을 고정해 전체 인자를 정확히 단언한다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    prismaMocks.indexQueueFindFirst.mockResolvedValueOnce({ id: 5n, attempts: 20 });

    await queuePartIndex(11n, 'new change evidence');

    // update가 아닌 updateMany — 드레인 deleteMany와 경합해도 P2025를 던지지 않는다.
    expect(prismaMocks.indexQueueUpdateMany).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { attempts: 0, reason: 'new change evidence', queuedAt: new Date('2026-07-22T00:00:00.000Z') },
    });
    expect(prismaMocks.indexQueueCreate).not.toHaveBeenCalled();
  });
});
