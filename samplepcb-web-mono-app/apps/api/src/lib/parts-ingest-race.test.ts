import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  partUpsert: vi.fn(),
  partFindUnique: vi.fn(),
  partFindMany: vi.fn(),
  partUpdateMany: vi.fn(),
  ingestRunUpsert: vi.fn(),
  ingestRunFindUnique: vi.fn(),
  ingestRunFindUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
  indexQueueFindMany: vi.fn(),
  indexQueueCount: vi.fn(),
  indexQueueFindFirst: vi.fn(),
  indexQueueCreate: vi.fn(),
  indexQueueUpdateMany: vi.fn(),
  indexQueueDeleteMany: vi.fn(),
}));

const esMocks = vi.hoisted(() => ({
  bulk: vi.fn(),
  index: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spPart: {
      upsert: prismaMocks.partUpsert,
      findUnique: prismaMocks.partFindUnique,
      findMany: prismaMocks.partFindMany,
      updateMany: prismaMocks.partUpdateMany,
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
      deleteMany: prismaMocks.indexQueueDeleteMany,
    },
    $transaction: prismaMocks.transaction,
  },
}));

vi.mock('../es/client', () => ({
  esClient: () => ({
    bulk: esMocks.bulk,
    index: esMocks.index,
    indices: { refresh: esMocks.refresh },
  }),
}));

import {
  canonicalPriceBreaks,
  drainIndexQueue,
  ingestSupplierSearchResult,
  ingestSupplierSearchResultOnce,
  indexChangedParts,
  isTransientPartIngestError,
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

describe('부품 저장 일시 장애 분류', () => {
  it('연결 종료와 데드락은 같은 부품을 안전하게 재시도한다', () => {
    expect(isTransientPartIngestError(new Prisma.PrismaClientKnownRequestError('connection closed', {
      code: 'P1017',
      clientVersion: '6.19.3',
    }))).toBe(true);
    expect(isTransientPartIngestError(deadlock())).toBe(true);
  });

  it('데이터 불일치는 자동 재시도하지 않는다', () => {
    expect(isTransientPartIngestError(new Prisma.PrismaClientKnownRequestError('invalid data', {
      code: 'P2023',
      clientVersion: '6.19.3',
    }))).toBe(false);
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

function partRow(id: bigint) {
  return {
    id,
    mpn: `PART-${String(id)}`,
    mpnNorm: `part${String(id)}`,
    manufacturerName: 'Test Manufacturer',
    manufacturerNorm: 'testmanufacturer',
    description: null,
    category: null,
    packageCode: null,
    lifecycle: null,
    imageUrl: null,
    specsSi: {},
    specConflicts: {},
    lastSeenAt: new Date('2026-07-23T00:00:00.000Z'),
    factsFingerprint: `facts-${String(id)}`,
    indexFingerprint: null,
    indexedAt: null,
    offers: [],
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
  vi.resetAllMocks();
  esMocks.bulk.mockResolvedValue({ errors: false, items: [] });
  esMocks.refresh.mockResolvedValue({});
  prismaMocks.partFindMany.mockImplementation(
    (args: { where: { id: { in: bigint[] } } }) => Promise.resolve(args.where.id.in.map(partRow)),
  );
  prismaMocks.partUpdateMany.mockResolvedValue({ count: 1 });
  prismaMocks.indexQueueFindFirst.mockResolvedValue(null);
  prismaMocks.indexQueueCreate.mockResolvedValue({ id: 1n });
  prismaMocks.indexQueueUpdateMany.mockResolvedValue({ count: 1 });
  prismaMocks.indexQueueDeleteMany.mockResolvedValue({ count: 1 });
  prismaMocks.indexQueueCount.mockResolvedValue(0);
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

describe('부품 bulk 색인 refresh 경계', () => {
  it('모든 배치를 refresh 없이 보낸 뒤 성공 배치만 단 한 번 refresh하고 확정한다', async () => {
    const partIds = Array.from({ length: 401 }, (_, index) => BigInt(index + 1));
    esMocks.bulk
      .mockResolvedValueOnce({ errors: false, items: [] })
      .mockResolvedValueOnce({ errors: true, items: [{ index: { error: { type: 'rejected' } } }] })
      .mockResolvedValueOnce({ errors: false, items: [] });

    await expect(indexChangedParts(partIds)).resolves.toEqual({ indexed: 201, queued: 200 });

    expect(esMocks.bulk).toHaveBeenCalledTimes(3);
    for (const [request] of esMocks.bulk.mock.calls) {
      expect(request).toEqual(expect.objectContaining({ refresh: false }));
    }
    expect(esMocks.refresh).toHaveBeenCalledOnce();
    expect(esMocks.refresh).toHaveBeenCalledWith({ index: 'sp-parts-write' });
    expect(esMocks.refresh.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...esMocks.bulk.mock.invocationCallOrder),
    );
    expect(prismaMocks.partUpdateMany).toHaveBeenCalledTimes(201);
    expect(prismaMocks.indexQueueDeleteMany).toHaveBeenCalledTimes(201);
    expect(prismaMocks.indexQueueCreate).toHaveBeenCalledTimes(200);
  });

  it('마지막 refresh가 실패하면 bulk 성공 항목 전원을 큐에 넣고 색인 완료로 기록하지 않는다', async () => {
    const partIds = Array.from({ length: 201 }, (_, index) => BigInt(index + 1));
    esMocks.refresh.mockRejectedValueOnce(new Error('refresh unavailable'));

    await expect(indexChangedParts(partIds)).resolves.toEqual({ indexed: 0, queued: 201 });

    expect(esMocks.bulk).toHaveBeenCalledTimes(2);
    expect(esMocks.refresh).toHaveBeenCalledOnce();
    expect(prismaMocks.indexQueueCreate).toHaveBeenCalledTimes(201);
    expect(prismaMocks.partUpdateMany).not.toHaveBeenCalled();
    expect(prismaMocks.indexQueueDeleteMany).not.toHaveBeenCalled();
  });

  it('큐 드레인도 모든 bulk 뒤 한 번만 refresh하고 성공 항목의 큐를 정리한다', async () => {
    const partIds = Array.from({ length: 401 }, (_, index) => BigInt(index + 1));
    prismaMocks.indexQueueFindMany.mockResolvedValueOnce(
      partIds.map((partId) => ({ partId, attempts: 0, queuedAt: new Date('2026-07-23T00:00:00.000Z') })),
    );

    await expect(drainIndexQueue(401)).resolves.toEqual({ drained: 401, remaining: 0, dead: 0 });

    expect(esMocks.bulk).toHaveBeenCalledTimes(3);
    for (const [request] of esMocks.bulk.mock.calls) {
      expect(request).toEqual(expect.objectContaining({ refresh: false }));
    }
    expect(esMocks.refresh).toHaveBeenCalledOnce();
    expect(esMocks.index).not.toHaveBeenCalled();
    expect(prismaMocks.partUpdateMany).toHaveBeenCalledTimes(401);
    expect(prismaMocks.indexQueueDeleteMany).toHaveBeenCalledTimes(401);
  });

  it('큐 드레인의 refresh가 실패하면 완료 메타데이터와 큐를 그대로 두고 호출부 로그로 넘긴다', async () => {
    const partIds = [1n, 2n];
    prismaMocks.indexQueueFindMany.mockResolvedValueOnce(
      partIds.map((partId) => ({ partId, attempts: 0, queuedAt: new Date('2026-07-23T00:00:00.000Z') })),
    );
    prismaMocks.indexQueueFindFirst.mockResolvedValue({ id: 1n, attempts: 0 });
    esMocks.refresh.mockRejectedValueOnce(new Error('refresh unavailable'));

    await expect(drainIndexQueue(2)).rejects.toThrow('refresh unavailable');

    expect(esMocks.bulk).toHaveBeenCalledOnce();
    expect(esMocks.refresh).toHaveBeenCalledOnce();
    expect(prismaMocks.indexQueueUpdateMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.indexQueueCreate).not.toHaveBeenCalled();
    expect(prismaMocks.partUpdateMany).not.toHaveBeenCalled();
    expect(prismaMocks.indexQueueDeleteMany).not.toHaveBeenCalled();
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
