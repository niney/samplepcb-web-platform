import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  BomEngineCapabilities,
  BomSupplierResult,
  type BomQuoteConfigType,
  type BomSupplierSearchOperationsType,
} from '@sp/api-contract';
import { engineFetch } from './engine-client';
import { prisma } from './prisma';

const StoredPreflight = z.object({
  plan: z.object({
    component_count: z.number().int().nonnegative().optional(),
    estimated_api_calls: z.number().int().nonnegative().optional(),
    job_call_limit: z.number().int().positive().optional(),
  }).passthrough(),
}).passthrough();

const StoredResultSummary = z.object({
  componentCount: z.number().int().nonnegative(),
  apiCalls: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  budgetExhaustedCount: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  engineElapsedMs: z.number().nonnegative().optional(),
  quoteApplyMs: z.number().nonnegative().optional(),
  wallElapsedMs: z.number().nonnegative().optional(),
  catalogElapsedMs: z.number().nonnegative().optional(),
  catalogDbElapsedMs: z.number().nonnegative().optional(),
  catalogIndexElapsedMs: z.number().nonnegative().optional(),
  catalogQueued: z.number().int().nonnegative().optional(),
  catalogReused: z.boolean().optional(),
  statusCounts: z.record(z.string(), z.number().int().nonnegative()),
});

const StoredOptions = z.object({
  max_calls: z.number().int().positive().optional(),
}).passthrough();

const StoredIngestTiming = z.object({
  dbElapsedMs: z.number().nonnegative(),
  indexElapsedMs: z.number().nonnegative(),
  elapsedMs: z.number().nonnegative(),
});

const ENGINE_STATUS_TIMEOUT_MS = 3_000;

export type SupplierRunSummarySnapshot = z.infer<typeof StoredResultSummary>;

export function kstDayKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function supplierRunSummarySnapshot(envelope: unknown): SupplierRunSummarySnapshot | null {
  const parsed = BomSupplierResult.safeParse(envelope);
  if (!parsed.success) return null;
  const data = parsed.data;
  const budgetExhaustedCount = data.search.components.filter((component) =>
    component.warnings?.some((warning) => warning.includes('job_call_limit_exhausted')) ?? false,
  ).length;
  return {
    componentCount: data.summary.component_count,
    apiCalls: data.summary.api_calls,
    cacheHits: data.summary.cache_hits,
    budgetExhaustedCount,
    elapsedMs: data.timing.known_pipeline_elapsed_ms,
    engineElapsedMs: data.timing.known_pipeline_elapsed_ms,
    statusCounts: data.summary.status_counts,
  };
}

export async function reserveDailySupplierSearch(mbId: string, limit: number): Promise<boolean> {
  const dayKey = kstDayKey();
  await prisma.spBomSupplierDailyUsage.upsert({
    where: { mbId_dayKey: { mbId, dayKey } },
    create: { mbId, dayKey, searchCount: 0 },
    update: { updatedAt: new Date() },
  });
  const reserved = await prisma.spBomSupplierDailyUsage.updateMany({
    where: { mbId, dayKey, searchCount: { lt: limit } },
    data: { searchCount: { increment: 1 } },
  });
  return reserved.count === 1;
}

type EngineStatus = BomSupplierSearchOperationsType['engine'];

export async function getSupplierEngineStatus(): Promise<EngineStatus> {
  try {
    const response = await engineFetch('/capabilities', undefined, ENGINE_STATUS_TIMEOUT_MS);
    if (!response.ok) {
      return unavailableEngineStatus(`BOM_ENGINE_HTTP_${String(response.status)}`);
    }
    const parsed = BomEngineCapabilities.safeParse(await response.json());
    if (!parsed.success) return unavailableEngineStatus('BOM_ENGINE_CAPABILITIES_INVALID');
    const supplierSearch = parsed.data.supplier_search;
    return {
      available: true,
      maxCallsPerJob: supplierSearch.max_calls_per_job,
      error: null,
      suppliers: supplierSearch.suppliers,
      cache: {
        mode: supplierSearch.cache.mode,
        entryCount: supplierSearch.cache.entry_count,
        rawTtlSeconds: supplierSearch.cache.raw_ttl_seconds,
        keywordTtlSeconds: supplierSearch.cache.keyword_ttl_seconds,
        staleTtlSeconds: supplierSearch.cache.stale_ttl_seconds,
        staleIfError: supplierSearch.cache.stale_if_error,
      },
    };
  } catch {
    return unavailableEngineStatus('BOM_ENGINE_UNREACHABLE');
  }
}

function unavailableEngineStatus(error: string): EngineStatus {
  return {
    available: false,
    maxCallsPerJob: null,
    error,
    suppliers: [],
    cache: null,
  };
}

type CatalogStatus = BomSupplierSearchOperationsType['recentRuns'][number]['catalogStatus'];

/**
 * 카탈로그 인제스트 원장 상태를 운영 화면용으로 정직화한다. 클레임은 항상 lease를 걸므로,
 * lease가 만료됐거나(now 이후 아님) 없는 running은 프로세스 크래시 잔재다. 재청구자는 동일
 * fingerprint 재호출뿐이라 화면에는 failed로 보이는 게 정직하다(계약 4리터럴 내 매핑).
 * now는 매핑 직전 1회 캡처해 recentRuns 전체에 같은 기준을 적용한다.
 */
export function deriveCatalogStatus(
  catalog: { status: string; leaseUntil: Date | null } | null,
  now: Date,
): CatalogStatus {
  if (catalog === null) return null;
  if (catalog.status === 'running' && (catalog.leaseUntil === null || catalog.leaseUntil < now)) {
    return 'failed';
  }
  if (
    catalog.status === 'queued'
    || catalog.status === 'running'
    || catalog.status === 'completed'
    || catalog.status === 'failed'
  ) {
    return catalog.status;
  }
  return null;
}

export async function getBomSupplierSearchOperations(
  config: BomQuoteConfigType,
): Promise<BomSupplierSearchOperationsType> {
  const dayKey = kstDayKey();
  const [engine, recentRuns, usageAggregate, memberCount] = await Promise.all([
    getSupplierEngineStatus(),
    prisma.spBomSupplierSearchRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        quote: { select: { title: true, mbId: true } },
        catalogIngestRun: { select: { status: true, timing: true, leaseUntil: true } },
      },
    }),
    prisma.spBomSupplierDailyUsage.aggregate({
      where: { dayKey },
      _sum: { searchCount: true },
      _max: { searchCount: true },
    }),
    prisma.spBomSupplierDailyUsage.count({ where: { dayKey } }),
  ]);

  // lease 만료 판정 기준시각은 recentRuns 전체에 동일하게 적용되도록 매핑 직전 1회만 캡처한다.
  const now = new Date();
  return {
    configuredMaxCalls: config.supplierSearchMaxCalls,
    effectiveMaxCalls: engine.maxCallsPerJob === null
      ? null
      : Math.min(config.supplierSearchMaxCalls, engine.maxCallsPerJob),
    engine,
    todayUsage: {
      dayKey,
      totalSearches: usageAggregate._sum.searchCount ?? 0,
      memberCount,
      maxMemberSearches: usageAggregate._max.searchCount ?? 0,
    },
    recentRuns: recentRuns.map((run) => {
      const preflight = StoredPreflight.safeParse(run.preflight);
      const summary = StoredResultSummary.safeParse(run.resultSummary);
      const options = StoredOptions.safeParse(run.options);
      const ingestTiming = StoredIngestTiming.safeParse(run.catalogIngestRun?.timing);
      const fallbackElapsed = run.startedAt !== null && run.completedAt !== null
        ? Math.max(0, run.completedAt.getTime() - run.startedAt.getTime())
        : null;
      return {
        id: String(run.id),
        quoteId: String(run.quoteId),
        quoteTitle: run.quote.title,
        memberId: run.quote.mbId,
        status: run.status,
        componentCount: summary.success
          ? summary.data.componentCount
          : (preflight.success ? preflight.data.plan.component_count ?? null : null),
        estimatedApiCalls: preflight.success
          ? preflight.data.plan.estimated_api_calls ?? null
          : null,
        actualApiCalls: summary.success ? summary.data.apiCalls : null,
        cacheHits: summary.success ? summary.data.cacheHits : null,
        maxCalls: options.success ? options.data.max_calls ?? null : null,
        budgetExhaustedCount: summary.success ? summary.data.budgetExhaustedCount : null,
        elapsedMs: summary.success ? summary.data.elapsedMs : fallbackElapsed,
        engineElapsedMs: summary.success
          ? summary.data.engineElapsedMs ?? summary.data.elapsedMs
          : null,
        quoteApplyMs: summary.success ? summary.data.quoteApplyMs ?? null : null,
        wallElapsedMs: summary.success ? summary.data.wallElapsedMs ?? fallbackElapsed : fallbackElapsed,
        catalogStatus: deriveCatalogStatus(run.catalogIngestRun ?? null, now),
        catalogElapsedMs: summary.success
          ? summary.data.catalogElapsedMs ?? (ingestTiming.success ? ingestTiming.data.elapsedMs : null)
          : (ingestTiming.success ? ingestTiming.data.elapsedMs : null),
        catalogDbElapsedMs: summary.success
          ? summary.data.catalogDbElapsedMs ?? (ingestTiming.success ? ingestTiming.data.dbElapsedMs : null)
          : (ingestTiming.success ? ingestTiming.data.dbElapsedMs : null),
        catalogIndexElapsedMs: summary.success
          ? summary.data.catalogIndexElapsedMs ?? (ingestTiming.success ? ingestTiming.data.indexElapsedMs : null)
          : (ingestTiming.success ? ingestTiming.data.indexElapsedMs : null),
        catalogQueued: summary.success ? summary.data.catalogQueued ?? null : null,
        catalogReused: summary.success ? summary.data.catalogReused ?? null : null,
        error: run.error,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      };
    }),
  };
}

export function inputJson(value: SupplierRunSummarySnapshot): Prisma.InputJsonValue {
  return value;
}
