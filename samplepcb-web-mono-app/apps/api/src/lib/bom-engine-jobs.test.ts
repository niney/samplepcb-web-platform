import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineFetch } from './engine-client';
import { ingestSupplierSearchResultOnce } from './parts-ingest';
import { ingestJobResult, startIngestPoller } from './bom-engine-jobs';

vi.mock('./engine-client', () => ({ engineFetch: vi.fn() }));
vi.mock('./parts-ingest', () => ({ ingestSupplierSearchResultOnce: vi.fn() }));

const engineFetchMock = vi.mocked(engineFetch);
const ingestSupplierSearchResultOnceMock = vi.mocked(ingestSupplierSearchResultOnce);
const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BOM 공급사 결과 인제스트 동시성', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingestSupplierSearchResultOnceMock.mockResolvedValue({
      runId: '1',
      fingerprint: 'fingerprint',
      reused: false,
      stats: { parts: 3, offers: 5, indexed: 3, queued: 0, skippedParts: 0, skippedOffers: 0 },
      timing: { dbElapsedMs: 10, indexElapsedMs: 5, elapsedMs: 15 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('같은 잡의 동시 호출은 첫 인제스트가 끝날 때까지 같은 Promise를 기다린다', async () => {
    const resultResponse = deferred<Response>();
    engineFetchMock.mockReturnValueOnce(resultResponse.promise);

    const first = ingestJobResult('concurrent-job', log);
    const second = ingestJobResult('concurrent-job', log);
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    await Promise.resolve();
    expect(engineFetchMock).toHaveBeenCalledTimes(1);
    expect(secondSettled).toBe(false);
    expect(ingestSupplierSearchResultOnceMock).not.toHaveBeenCalled();

    resultResponse.resolve(jsonResponse({ search: { components: [] } }));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(ingestSupplierSearchResultOnceMock).toHaveBeenCalledTimes(1);

    await expect(ingestJobResult('concurrent-job', log)).resolves.toBe(true);
    expect(engineFetchMock).toHaveBeenCalledTimes(1);
  });

  it('결과가 아직 없으면 완료로 캐시하지 않고 다음 호출에서 다시 시도한다', async () => {
    engineFetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'not ready' }, 404))
      .mockResolvedValueOnce(jsonResponse({ search: { components: [] } }));

    await expect(ingestJobResult('retry-job', log)).resolves.toBe(false);
    expect(ingestSupplierSearchResultOnceMock).not.toHaveBeenCalled();

    await expect(ingestJobResult('retry-job', log)).resolves.toBe(true);
    expect(engineFetchMock).toHaveBeenCalledTimes(2);
    expect(ingestSupplierSearchResultOnceMock).toHaveBeenCalledTimes(1);
  });

  it('완료 폴러는 견적 결과를 먼저 반영하고 카탈로그 인제스트는 뒤에서 완료한다', async () => {
    vi.useFakeTimers();
    let resultCalls = 0;
    engineFetchMock.mockImplementation((path) => {
      if (path.endsWith('/supplier-search')) return Promise.resolve(jsonResponse({ status: 'completed' }));
      resultCalls += 1;
      return Promise.resolve(
        resultCalls === 1
          ? jsonResponse({ detail: 'not ready' }, 404)
          : jsonResponse({ search: { components: [] } }),
      );
    });
    const catalog = deferred<Awaited<ReturnType<typeof ingestSupplierSearchResultOnce>>>();
    ingestSupplierSearchResultOnceMock.mockReturnValueOnce(catalog.promise);
    const onResult = vi.fn(() => Promise.resolve());
    const onCatalogIngested = vi.fn(() => Promise.resolve());

    startIngestPoller('poller-retry-job', log, { onResult, onCatalogIngested });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resultCalls).toBe(1);
    expect(onResult).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(resultCalls).toBe(2);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(ingestSupplierSearchResultOnceMock).toHaveBeenCalledTimes(1);
    expect(onCatalogIngested).not.toHaveBeenCalled();

    catalog.resolve({
      runId: '2',
      fingerprint: 'poller-fingerprint',
      reused: false,
      stats: { parts: 1, offers: 1, indexed: 1, queued: 0, skippedParts: 0, skippedOffers: 0 },
      timing: { dbElapsedMs: 3, indexElapsedMs: 2, elapsedMs: 5 },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onCatalogIngested).toHaveBeenCalledTimes(1);
  });
});
