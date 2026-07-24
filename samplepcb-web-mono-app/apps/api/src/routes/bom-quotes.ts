import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BomQuoteCandidateSelectionBody,
  BomQuoteBuildBody,
  BomQuoteComparisonResponse,
  BomQuoteCreateResponse,
  BomQuoteDeleteManyBody,
  BomQuoteDeleteManyResponse,
  BomQuoteDetailResponse,
  BomQuoteItemCandidatesResponse,
  BomQuoteListResponse,
  BomQuotePatchBody,
  BomQuotePassiveDefaultsBody,
  BomQuoteRequestBody,
  BomQuoteSearchRequirements,
  BomQuoteSearchRequirementsBody,
  BomQuoteSheetSelectionBody,
  BomQuoteStatus,
  BomSupplierStartResponse,
  BomSupplierView,
  type BomQuoteItemInputType,
  type BomQuoteItemType,
  type BomQuoteMatchEvidenceType,
  type BomQuotePassiveDefaultsBodyType,
  type BomQuoteSearchRequirementsType,
} from '@sp/api-contract';
import { neededQty, stampOrderQty } from '@sp/utils';
import { prisma } from '../lib/prisma';
import { collectMultipart } from '../lib/market';
import { deleteFromFileServer, uploadToFileServer } from '../lib/file-server';
import { engineFetch } from '../lib/engine-client';
import { decideAutomaticSupplierSearch } from '../lib/bom-supplier-search-policy';
import { getBomQuoteRuntimeConfig } from '../lib/exchange-rate';
import { buildEngineProcurementPolicy } from '../lib/bom-procurement-policy';
import {
  fetchSupplierSearchResult,
  ingestSupplierEnvelopeForJob,
  recordJobOwner,
  startIngestPoller,
} from '../lib/bom-engine-jobs';
import {
  completeCatalogIngest,
  hasSupplierResultArtifact,
  markCatalogPreparation,
  markSupplierResultArtifactCompleted,
  markSupplierResultArtifactRunning,
  persistSupplierResultArtifact,
  retrySupplierResultArtifactNow,
  scheduleSupplierResultArtifactRetry,
} from '../lib/bom-part-data';
import {
  inputJson,
  reserveDailySupplierSearch,
  supplierRunSummarySnapshot,
} from '../lib/bom-supplier-operations';
import {
  BomAnalysisContractError,
  loadActiveBomAnalysisResult,
  persistBomAnalysisResult,
} from '../lib/bom-analysis';
import {
  bomQuoteDeleteCounts,
  chunkBomQuoteDeletionIds,
  planBomQuoteDeletion,
  resolveDeletedBomQuoteIds,
} from '../lib/bom-quote-delete';
import {
  buildItemsFromEngineResult,
  backfillQuotePartIds,
  applyQuoteCandidateSelection,
  canTransition,
  catalogIngestRunReady,
  computeQuote,
  filterActiveQuoteItems,
  getQuoteItemCandidates,
  loadQuoteComparisonPage,
  loadSupplierSearchSummary,
  patchNeedsCandidateReprice,
  persistQuoteComputed,
  refreshQuoteFromSupplierResult,
  repriceCandidateSelections,
  replaceQuoteItems,
  toDetailDto,
  toItemDto,
  toSummaryDto,
} from '../lib/bom-quote';

// ── /api/bom/quotes — 고객(회원) BOM 견적 CRUD (설계: docs/BOM_QUOTE.md) ─────
// 업로드(견적+엔진 잡 생성) → build(파싱 결과→라인+필요수량) → 공급사 검색
// 결과 반영(엔진 기술·구매조건 판단) → 검토(PATCH 자동저장) → request(동결).
// 원본 파일은 파일서버(serviceType 'bom')+sp_file 로 보존 — 관리자 다운로드용.

const IdParams = z.object({ id: z.coerce.bigint() });
const ItemParams = IdParams.extend({ itemId: z.coerce.bigint() });
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(191).optional(),
  status: BomQuoteStatus.optional(),
});
const ComparisonQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(5),
  search: z.string().trim().max(191).optional(),
  sheet: z.string().trim().min(1).max(191).optional(),
  status: z.enum(['matched', 'attention', 'not_found']).optional(),
});

const ALLOWED_EXT = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'tsv']);
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 시안 카피("up to 50 MB")와 정합

const FILE_REF_TYPE = 'sp_bom_quote';
const BizError = z.object({ result: z.literal(false), error: z.string() });

function engineRequirementOverride(
  requirements: BomQuoteSearchRequirementsType,
): Record<string, unknown> {
  const common = {
    version: requirements.version,
    component_type: requirements.componentType,
    package: requirements.packageCode,
    tolerance: requirements.tolerance,
    mount_style: requirements.mountStyle,
  };
  return requirements.componentType === 'resistor'
    ? {
        ...common,
        resistance: requirements.resistance,
        power: requirements.power,
      }
    : {
        ...common,
        capacitor_type: requirements.capacitorType,
        capacitance: requirements.capacitance,
        voltage: requirements.voltage,
        dielectric: requirements.dielectric,
      };
}

const EnginePassiveDefaults = z.object({
  version: z.literal('passive-requirement-defaults-v1'),
  resistor_tolerance: z.string(),
  capacitor_tolerance: z.string(),
  capacitor_voltage: z.string(),
  capacitor_dielectric_policy: z.literal('capacitance-aware-conservative'),
}).strict();

function enginePassiveDefaults(
  defaults: BomQuotePassiveDefaultsBodyType,
): z.infer<typeof EnginePassiveDefaults> {
  return {
    version: 'passive-requirement-defaults-v1',
    resistor_tolerance: defaults.resistorTolerance,
    capacitor_tolerance: defaults.capacitorTolerance,
    capacitor_voltage: defaults.capacitorVoltage,
    capacitor_dielectric_policy: defaults.capacitorDielectricPolicy,
  };
}

function passiveDefaultsFromSearchOptions(
  options: Prisma.JsonValue | undefined,
): BomQuotePassiveDefaultsBodyType | null {
  if (options === undefined || options === null || typeof options !== 'object' || Array.isArray(options)) {
    return null;
  }
  const parsed = EnginePassiveDefaults.safeParse(options.passive_defaults);
  return parsed.success
    ? {
        resistorTolerance: parsed.data.resistor_tolerance,
        capacitorTolerance: parsed.data.capacitor_tolerance,
        capacitorVoltage: parsed.data.capacitor_voltage,
        capacitorDielectricPolicy: parsed.data.capacitor_dielectric_policy,
      }
    : null;
}

function supplierRunIsTargeted(options: Prisma.JsonValue): boolean {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) return false;
  const componentIds = options.component_ids;
  return Array.isArray(componentIds)
    && componentIds.some((componentId) => typeof componentId === 'string' && componentId !== '');
}

/** 파일서버 정리는 응답을 막지 않되 동시 요청을 5건으로 제한한다. */
async function deleteBomFiles(pathTokens: readonly string[]): Promise<void> {
  const batchSize = 5;
  for (let start = 0; start < pathTokens.length; start += batchSize) {
    await Promise.all(
      pathTokens.slice(start, start + batchSize).map((pathToken) =>
        deleteFromFileServer(pathToken).catch(() => undefined),
      ),
    );
  }
}

async function loadOwnQuote(id: bigint, mbId: string) {
  const quote = await prisma.spBomQuote.findUnique({ where: { id }, include: { items: true, sheets: true } });
  if (quote?.mbId !== mbId) return null; // 타인 견적은 404 로 은닉
  return quote;
}

// ── 조용한 자동 보강 — build 가 "시작"까지 동기 확정(응답 enriching 플래그) ─────
// 필요 조건: included 미매칭 라인 존재 OR 오퍼 데이터 나이 > freshnessHours.
// 비용 게이트: preflight 예상치는 관측·경고용이며 실제 호출 상한은 엔진 job budget이
// 강제한다. 회원 일일 한도 소진은 명시 실패로 남기고 cache_only로 의미를 바꾸지 않는다.
// 검색 시작을 응답 전에 확정하므로 FE 첫 상태 폴이 반드시 running
// 을 관측한다(폴링 경합 원천 제거). 완료 결과는 엔진 결정 그대로 반영한다.
// 반환: 검색을 실제로 시작했는지.
/** 보강 필요 판정 — included 미매칭 또는 오퍼 나이 > freshnessHours (build 선판정·autoEnrich 공용). */
function enrichNeeded(
  items: {
    included: boolean;
    matchStatus: string;
    matchEvidence: unknown;
    sourceRow: Record<string, unknown> | null;
    selectedOffer: { fetchedAt: string } | null;
  }[],
  freshnessHours: number,
): boolean {
  const now = Date.now();
  const freshMs = freshnessHours * 3_600_000;
  return items.some(
    (i) =>
      i.included &&
      (i.matchEvidence === null ||
        i.matchStatus === 'none' ||
        (i.selectedOffer !== null && now - new Date(i.selectedOffer.fetchedAt).getTime() > freshMs)),
  );
}

async function applyCompletedSupplierResult(
  quoteId: bigint,
  searchRunId: bigint,
  envelope: unknown,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const run = await prisma.spBomSupplierSearchRun.findUnique({
    where: { id: searchRunId },
    select: { startedAt: true, options: true },
  });
  const applyStartedAt = performance.now();
  const applied = await refreshQuoteFromSupplierResult(
    quoteId,
    envelope,
    searchRunId,
    log,
    { targeted: run !== null && supplierRunIsTargeted(run.options) },
  );
  const completedAt = new Date();
  const baseSummary = supplierRunSummarySnapshot(envelope);
  const summary = baseSummary === null
    ? null
    : {
        ...baseSummary,
        quoteApplyMs: Math.max(0, Math.round(performance.now() - applyStartedAt)),
        wallElapsedMs: run?.startedAt === null || run?.startedAt === undefined
          ? baseSummary.elapsedMs
          : Math.max(0, completedAt.getTime() - run.startedAt.getTime()),
      };
  if (applied) {
    await prisma.spBomSupplierSearchRun.updateMany({
      where: { id: searchRunId, quoteId },
      data: {
        status: 'completed',
        completedAt,
        error: null,
        ...(summary === null ? {} : { resultSummary: inputJson(summary) }),
      },
    });
  } else {
    await prisma.$transaction([
      prisma.spBomSupplierSearchRun.updateMany({
        where: { id: searchRunId, quoteId },
        data: {
          status: 'failed',
          completedAt,
          error: 'supplier_result_not_applied',
          ...(summary === null ? {} : { resultSummary: inputJson(summary) }),
        },
      }),
      prisma.spBomQuote.updateMany({
        where: { id: quoteId, status: 'draft', enrichStatus: 'searching' },
        data: { enrichStatus: 'failed' },
      }),
    ]);
  }
  return applied;
}

async function autoEnrichQuote(
  quoteId: bigint,
  mbId: string,
  log: Parameters<typeof startIngestPoller>[1],
  options: {
    force?: boolean;
    componentIds?: readonly string[];
    passiveDefaults?: BomQuotePassiveDefaultsBodyType;
  } = {},
): Promise<boolean> {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: {
      items: true,
      sheets: true,
      activeSupplierSearchRun: { select: { options: true } },
    },
  });
  if (quote?.status !== 'draft' || quote.activeAnalysisRunId === null) return false;
  const config = await getBomQuoteRuntimeConfig();
  const sheetIndexes = quote.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.sheetIndex);
  if (sheetIndexes.length === 0) return false;
  const procurement = buildEngineProcurementPolicy(
    config.usdKrwRate,
    config.exchangeRateSnapshot,
  );
  const passiveDefaults = options.passiveDefaults
    ?? passiveDefaultsFromSearchOptions(quote.activeSupplierSearchRun?.options);
  const passiveDefaultsPayload = passiveDefaults === null
    ? null
    : enginePassiveDefaults(passiveDefaults);
  const searchOptions = {
    max_calls: config.supplierSearchMaxCalls,
    cache_only: false,
    reset_cache: false,
    sheet_indexes: sheetIndexes,
    component_ids: [...(options.componentIds ?? [])],
    ...(passiveDefaultsPayload === null
      ? {}
      : { passive_defaults: passiveDefaultsPayload }),
    procurement: {
      ...procurement,
      currency_rates: procurement.currency_rates.map((rate) => ({ ...rate })),
      allowed_suppliers: [...procurement.allowed_suppliers],
    },
  } satisfies Prisma.InputJsonObject;

  const items = filterActiveQuoteItems(quote.items, quote.sheets).map((row) => toItemDto(row));
  if (options.force !== true && !enrichNeeded(items, config.freshnessHours)) {
    // 전부 신선 — 0콜로 끝. build 가 선점해 둔 searching 이 있으면 idle 로 되돌린다.
    if (quote.enrichStatus === 'searching') {
      await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'idle' } }).catch(() => undefined);
    }
    return false;
  }

  const searchRun = await prisma.spBomSupplierSearchRun.create({
    data: {
      quoteId,
      analysisRunId: quote.activeAnalysisRunId,
      status: 'preparing',
      options: searchOptions,
    },
  });
  const markFailed = async (error: string): Promise<false> => {
    await prisma.spBomSupplierSearchRun.update({
      where: { id: searchRun.id },
      data: { status: 'failed', error: error.slice(0, 500), completedAt: new Date() },
    }).catch(() => undefined);
    await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'failed' } }).catch(() => undefined);
    return false;
  };

  const analysis = await loadActiveBomAnalysisResult(quoteId, sheetIndexes);
  if (analysis === null) return markFailed('analysis_snapshot_not_found');
  const requiredQuantities = Object.fromEntries(items.flatMap((item) => {
    const componentId = item.sourceRow?.componentId;
    return typeof componentId === 'string' && componentId !== ''
      ? [[componentId, neededQty(item.bomQty, quote.setQty, quote.spareQty)] as const]
      : [];
  }));
  const activeRows = filterActiveQuoteItems(quote.items, quote.sheets);
  const requirementOverrides = Object.fromEntries(activeRows.flatMap((item) => {
    const componentId = toItemDto(item).sourceRow?.componentId;
    if (typeof componentId !== 'string' || componentId === '') return [];
    const parsed = BomQuoteSearchRequirements.safeParse(item.searchRequirements);
    return parsed.success
      ? [[componentId, engineRequirementOverride(parsed.data)] as const]
      : [];
  }));

  let jobId: string;
  try {
    const registered = await engineFetch('/supplier-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        analysis,
        required_quantities: requiredQuantities,
        requirement_overrides: requirementOverrides,
        requirement_defaults: passiveDefaultsPayload,
      }),
    });
    if (!registered.ok) return await markFailed(`supplier_job_registration_${String(registered.status)}`);
    const body = (await registered.json()) as { job_id?: unknown };
    if (typeof body.job_id !== 'string' || body.job_id === '') return await markFailed('supplier_job_id_missing');
    jobId = body.job_id;
    await prisma.spBomSupplierSearchRun.update({ where: { id: searchRun.id }, data: { engineJobId: jobId } });
  } catch (error) {
    return markFailed(`supplier_job_registration_failed: ${String(error)}`);
  }

  let estimatedApiCalls: number;
  let estimateExceedsJobLimit: boolean;
  try {
    const pfRes = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchOptions),
    });
    if (!pfRes.ok) return await markFailed(`supplier_preflight_${String(pfRes.status)}`);
    const pf = (await pfRes.json()) as { plan?: { estimated_within_job_limit?: boolean; estimated_api_calls?: number } };
    await prisma.spBomSupplierSearchRun.update({
      where: { id: searchRun.id },
      data: { preflight: pf },
    });
    const liveCalls = (pf.plan?.estimated_api_calls ?? 0) > 0;
    const dailySlotAvailable = !liveCalls
      || await reserveDailySupplierSearch(mbId, config.memberDailySearchLimit);
    const decision = decideAutomaticSupplierSearch(pf.plan, dailySlotAvailable);
    estimatedApiCalls = decision.estimatedApiCalls;
    estimateExceedsJobLimit = decision.estimateExceedsJobLimit;
    if (!decision.start) {
      return await markFailed(decision.blockedReason ?? 'supplier_search_policy_blocked');
    }
    if (decision.estimateExceedsJobLimit) {
      log.warn({
        quoteId: String(quoteId),
        searchRunId: String(searchRun.id),
        estimatedApiCalls: decision.estimatedApiCalls,
        maxCalls: searchOptions.max_calls,
      }, '공급사 예상 호출이 작업 한도를 초과하지만 실제 엔진 예산으로 검색을 계속합니다');
    }
  } catch {
    return await markFailed('supplier_preflight_unreachable');
  }

  try {
    const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchOptions),
    });
    if (res.status !== 202 && !res.ok) return await markFailed(`supplier_start_${String(res.status)}`);
  } catch (error) {
    return markFailed(`supplier_start_failed: ${String(error)}`);
  }
  // 응답 전에 searching 을 영속 — 이후 어떤 조회(새로고침·타기기)든 같은 진실을 본다
  await prisma.$transaction([
    prisma.spBomSupplierSearchRun.update({
      where: { id: searchRun.id },
      data: {
        status: 'running',
        options: searchOptions,
        startedAt: new Date(),
      },
    }),
    prisma.spBomQuote.update({
      where: { id: quoteId },
      data: { enrichStatus: 'searching', activeSupplierSearchRunId: searchRun.id },
    }),
  ]);
  log.info({
    quoteId: String(quoteId),
    searchRunId: String(searchRun.id),
    jobId,
    estimatedApiCalls,
    estimateExceedsJobLimit,
    maxCalls: searchOptions.max_calls,
  }, '영속 분석 기반 자동 보강 검색 시작');
  startIngestPoller(jobId, log, {
    onResult: async (envelope) => {
      await persistSupplierResultArtifact(searchRun.id, envelope);
      await applyCompletedSupplierResult(quoteId, searchRun.id, envelope, log);
    },
    onCatalogStarted: async () => {
      await markSupplierResultArtifactRunning(searchRun.id);
    },
    onCatalogIngested: async (result) => {
      const backfilled = await completeCatalogIngest(quoteId, searchRun.id, result);
      await markSupplierResultArtifactCompleted(searchRun.id);
      log.info({ quoteId: String(quoteId), searchRunId: String(searchRun.id), backfilled }, '견적 카탈로그 참조 보강 완료');
    },
    onCatalogIngestFailed: async (error) => {
      const scheduled = await scheduleSupplierResultArtifactRetry(searchRun.id, error);
      await markCatalogPreparation(quoteId, searchRun.id, scheduled ? 'preparing' : 'failed', error);
    },
  });
  return true;
}

// ── 게으른 치유 — searching 견적 조회 시 상태를 수렴시킨다(재시작·폴러 유실 내성) ──
// 엔진 running → 유지 · completed → 견적 반영(done)+백그라운드 인제스트 · 잡 소멸/엔진 다운 → failed.
// fire-and-forget: 고객의 3초 폴링이 곧 치유 트리거 — 다음 폴이 수렴된 상태를 받는다.
const healInFlight = new Set<string>();
const catalogHealInFlight = new Set<string>();

async function healEnrichment(
  quoteId: bigint,
  mbId: string,
  log: Parameters<typeof startIngestPoller>[1],
): Promise<void> {
  const key = String(quoteId);
  if (healInFlight.has(key)) return;
  healInFlight.add(key);
  try {
    const quote = await prisma.spBomQuote.findUnique({
      where: { id: quoteId },
      select: { activeSupplierSearchRun: true },
    });
    const run = quote?.activeSupplierSearchRun;
    if (run?.engineJobId === null || run?.engineJobId === undefined) {
      await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'failed' } });
      return;
    }
    const jobId = run.engineJobId;
    let status: string;
    try {
      const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        status = typeof body.status === 'string' ? body.status : 'unknown';
      } else {
        status = 'gone'; // 404 등 — 엔진 재시작으로 인메모리 잡 소실
      }
    } catch {
      status = 'gone'; // 엔진 다운
    }
    if (status === 'running' || status === 'unknown') return;
    if (status === 'completed') {
      const envelope = await fetchSupplierSearchResult(jobId);
      if (envelope === null) return; // 결과 준비 지연 — searching 유지, 다음 조회가 재시도
      await persistSupplierResultArtifact(run.id, envelope);
      await applyCompletedSupplierResult(quoteId, run.id, envelope, log);
      await markSupplierResultArtifactRunning(run.id);
      void ingestSupplierEnvelopeForJob(jobId, envelope, log).then(async (result) => {
        if (result === null) {
          await scheduleSupplierResultArtifactRetry(run.id);
          await markCatalogPreparation(quoteId, run.id, 'preparing');
          return;
        }
        const backfilled = await completeCatalogIngest(quoteId, run.id, result);
        await markSupplierResultArtifactCompleted(run.id);
        log.info({ quoteId: key, searchRunId: String(run.id), backfilled }, '치유 경로 카탈로그 참조 보강 완료');
      }).catch((error: unknown) => {
        void (async () => {
          const scheduled = await scheduleSupplierResultArtifactRetry(run.id, error);
          await markCatalogPreparation(quoteId, run.id, scheduled ? 'preparing' : 'failed', error);
        })().catch((recoveryError: unknown) => {
          log.warn({ quoteId: key, searchRunId: String(run.id), err: String(recoveryError) }, '치유 경로 자동 재시도 예약 실패');
        });
        log.warn({ quoteId: key, searchRunId: String(run.id), err: String(error) }, '치유 경로 카탈로그 후처리 실패');
      });
      return;
    }
    await prisma.spBomSupplierSearchRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: `engine_${status}`, completedAt: new Date() },
    });
    if (status === 'gone') {
      log.warn({ quoteId: key, searchRunId: String(run.id), jobId }, '엔진 잡 소멸 — 영속 분석으로 공급사 검색 재시작');
      await autoEnrichQuote(quoteId, mbId, log);
      return;
    }
    await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'failed' } });
    log.warn({ quoteId: key, searchRunId: String(run.id), jobId, engineStatus: status }, '자동 보강 치유 — failed 로 종결');
  } finally {
    healInFlight.delete(key);
  }
}

async function healCatalogPreparation(
  quoteId: bigint,
  searchRunId: bigint | null,
  log: Parameters<typeof startIngestPoller>[1],
): Promise<void> {
  if (searchRunId === null) return;
  const key = String(searchRunId);
  if (catalogHealInFlight.has(key)) return;
  catalogHealInFlight.add(key);
  try {
    const run = await prisma.spBomSupplierSearchRun.findUnique({
      where: { id: searchRunId },
      select: {
        engineJobId: true,
        catalogIngestRun: { select: { status: true, stats: true } },
        resultSummary: true,
      },
    });
    if (run === null || catalogIngestRunReady(run.catalogIngestRun)) return;
    // 영속 결과가 있으면 서버 주기 복구 워커가 소유한다. 상세 3초 폴링이 같은 작업을
    // 중복 실행하지 않게 하고, 사용자는 상태만 실시간으로 받는다.
    if (await hasSupplierResultArtifact(searchRunId)) return;
    const storedStatus = run.resultSummary !== null
      && typeof run.resultSummary === 'object'
      && !Array.isArray(run.resultSummary)
      ? run.resultSummary.catalogStatus
      : null;
    if (storedStatus === 'failed') return; // 명시적인 사용자 재시도 전에는 반복 부하를 만들지 않는다.
    if (run.engineJobId === null) {
      await markCatalogPreparation(quoteId, searchRunId, 'failed', 'supplier_result_gone');
      return;
    }
    const envelope = await fetchSupplierSearchResult(run.engineJobId);
    if (envelope === null) {
      await markCatalogPreparation(quoteId, searchRunId, 'failed', 'supplier_result_gone');
      return;
    }
    await persistSupplierResultArtifact(searchRunId, envelope);
    await markSupplierResultArtifactRunning(searchRunId);
    const result = await ingestSupplierEnvelopeForJob(run.engineJobId, envelope, log);
    if (result === null) {
      await scheduleSupplierResultArtifactRetry(searchRunId);
      await markCatalogPreparation(quoteId, searchRunId, 'preparing');
      return;
    }
    const backfilled = await completeCatalogIngest(quoteId, searchRunId, result);
    await markSupplierResultArtifactCompleted(searchRunId);
    log.info({ quoteId: String(quoteId), searchRunId: key, backfilled }, '부품 정보 준비 치유 완료');
  } catch (error) {
    const scheduled = await scheduleSupplierResultArtifactRetry(searchRunId, error).catch(() => false);
    await markCatalogPreparation(quoteId, searchRunId, scheduled ? 'preparing' : 'failed', error).catch(() => undefined);
    log.warn({ quoteId: String(quoteId), searchRunId: key, err: String(error) }, '부품 정보 준비 치유 실패');
  } finally {
    catalogHealInFlight.delete(key);
  }
}

export const bomQuoteRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // 업로드 → 견적(draft) + 엔진 파싱 잡 생성
  fastify.post('/bom/quotes', { schema: { response: { 201: BomQuoteCreateResponse, 502: BizError } } }, async (request, reply) => {
    if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
    const { files } = await collectMultipart(request);
    const file = files.find((f) => f.field === 'file') ?? files[0];
    if (file === undefined) return reply.badRequest('file 파트가 없습니다');
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXT.has(ext)) return reply.badRequest('지원하지 않는 파일 형식입니다 (xlsx/xlsm/xls/csv/tsv)');
    if (file.buffer.length > MAX_FILE_BYTES) return reply.badRequest('파일이 50MB 를 초과합니다');

    // 1) 엔진 파싱 잡 — 엔진 다운이면 여기서 즉시 실패(잔여물 없음)
    let jobId: string;
    try {
      const form = new FormData();
      form.append('file', new File([new Uint8Array(file.buffer)], file.filename, { type: file.mimetype }));
      form.append('engine', 'smartbom');
      const res = await engineFetch('/jobs', { method: 'POST', body: form });
      if (!res.ok) return await reply.status(502).send({ result: false, error: 'BOM_ENGINE_ERROR' });
      const body = (await res.json()) as { job_id?: string };
      if (typeof body.job_id !== 'string' || body.job_id === '') {
        return await reply.status(502).send({ result: false, error: 'BOM_ENGINE_ERROR' });
      }
      jobId = body.job_id;
    } catch {
      return reply.status(502).send({ result: false, error: 'BOM_ENGINE_UNREACHABLE' });
    }
    recordJobOwner(jobId, request.user.mbId);

    // 2) 원본 보존(파일서버) — 실패 시 견적 생성 중단(관리자 원본 접근 보장)
    const uploaded = await uploadToFileServer(
      [{ buffer: file.buffer, filename: file.filename, mimetype: file.mimetype }],
      'bom',
    );
    const stored = uploaded[0];
    if (stored === undefined) return reply.status(502).send({ result: false, error: 'FILE_SERVER_ERROR' });

    // 3) 견적 생성 — 비용은 sp_config 기본값 스냅샷("예상 — 확정 시 변동")
    const config = await getBomQuoteRuntimeConfig();
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    const quote = await prisma.$transaction(async (tx) => {
      const q = await tx.spBomQuote.create({
        data: {
          mbId: request.user.mbId,
          title: file.filename.slice(0, 191),
          fileName: file.filename.slice(0, 255),
          contentHash,
          engineJobId: jobId,
          buildStatus: 'parsing',
          shippingFee: config.defaultShippingFee,
          managementFee: config.defaultManagementFee,
          finalTotal: config.defaultShippingFee + config.defaultManagementFee,
          usdKrwRateUsed: config.usdKrwRate,
          exchangeRateSnapshot: config.exchangeRateSnapshot === null
            ? Prisma.DbNull
            : (config.exchangeRateSnapshot as Prisma.InputJsonValue),
        },
        select: { id: true },
      });
      await tx.spFile.create({
        data: {
          refType: FILE_REF_TYPE,
          refId: q.id,
          uploadFileName: stored.uploadFileName,
          originFileName: stored.originFileName,
          pathToken: stored.pathToken,
          size: BigInt(stored.size),
          writeDate: new Date(),
          fileType: 'bom',
        },
      });
      return q;
    });

    return reply.status(201).send({ result: true as const, data: { quoteId: String(quote.id), jobId } });
  });

  // 내 견적 목록
  fastify.get('/bom/quotes', { schema: { querystring: ListQuery, response: { 200: BomQuoteListResponse } } }, async (request) => {
    const { page, pageSize, search, status } = request.query;
    const where: Prisma.SpBomQuoteWhereInput = {
      mbId: request.user.mbId,
      ...(status === undefined ? {} : { status }),
      ...(search === undefined || search === ''
        ? {}
        : { OR: [{ title: { contains: search } }, { fileName: { contains: search } }] }),
    };
    const [rows, total, deletableCount] = await Promise.all([
      prisma.spBomQuote.findMany({
        where,
        include: {
          sheets: { select: { sheetIndex: true, selected: true } },
          items: { select: { sourceSheetIndex: true, included: true, matchStatus: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.spBomQuote.count({ where }),
      prisma.spBomQuote.count({ where: { mbId: request.user.mbId, status: 'draft' } }),
    ]);
    return {
      result: true as const,
      data: {
        items: rows.map((row) => {
          const activeItems = filterActiveQuoteItems(row.items, row.sheets);
          return toSummaryDto(row, {
            itemCount: activeItems.length,
            includedCount: activeItems.filter((item) => item.included).length,
            matchedCount: activeItems.filter((item) => item.matchStatus !== 'none').length,
          });
        }),
        total,
        deletableCount,
        page,
        pageSize,
      },
    };
  });

  // 목록 일괄 삭제 — 본인 draft만 삭제한다. scope=all도 요청·검토·답변 견적은 보존한다.
  fastify.post('/bom/quotes/delete', {
    schema: { body: BomQuoteDeleteManyBody, response: { 200: BomQuoteDeleteManyResponse } },
  }, async (request) => {
    const selectedIds = request.body.scope === 'selected'
      ? request.body.quoteIds.map((id) => BigInt(id))
      : null;

    const rows = await prisma.spBomQuote.findMany({
      where: {
        mbId: request.user.mbId,
        ...(selectedIds === null ? {} : { id: { in: selectedIds } }),
      },
      select: { id: true, mbId: true, status: true },
    });
    const { targets, deletableIds } = planBomQuoteDeletion(rows, request.user.mbId);
    const pathTokens: string[] = [];
    let deletedCount = 0;

    // cascade 자식(후보 스냅샷 등)이 견적당 수천 행이라 인터랙티브 트랜잭션(기본 5초)은
    // 규모에 따라 P2028로 전멸한다. 삭제 문장 자체가 원자적이고 status 가드도 WHERE에
    // 있으므로 트랜잭션 없이 청크별 autocommit으로 진행을 확정한다 — 중단돼도 재시도가 이어간다.
    for (const ids of chunkBomQuoteDeletionIds(deletableIds)) {
      await prisma.spBomQuote.deleteMany({
        where: { id: { in: ids }, mbId: request.user.mbId, status: 'draft' },
      });
      const survivors = await prisma.spBomQuote.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const deletedIds = resolveDeletedBomQuoteIds(ids, survivors.map((quote) => quote.id));
      deletedCount += deletedIds.length;
      if (deletedIds.length === 0) continue;

      // sp_file은 FK 없는 느슨한 참조라 견적 삭제 후에도 남는다 — 삭제 확정분만 정리한다.
      const files = await prisma.spFile.findMany({
        where: { refType: FILE_REF_TYPE, refId: { in: deletedIds } },
        select: { pathToken: true },
      });
      await prisma.spFile.deleteMany({ where: { refType: FILE_REF_TYPE, refId: { in: deletedIds } } });
      pathTokens.push(...files.map((file) => file.pathToken));
    }

    const deleted = bomQuoteDeleteCounts(selectedIds?.length ?? targets.length, targets.length, deletedCount);
    void deleteBomFiles(pathTokens);

    return {
      result: true as const,
      data: {
        requestedCount: deleted.requestedCount,
        deletedCount: deleted.deletedCount,
        retainedCount: deleted.retainedCount,
      },
    };
  });

  // 엔진 잡은 재시작 시 소멸한다. 전체 비교는 quoteId에 박제한 후보 스냅샷만 사용한다.
  fastify.get('/bom/quotes/:id/comparison', {
    schema: { params: IdParams, querystring: ComparisonQuery, response: { 200: BomQuoteComparisonResponse } },
  }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({
      where: { id: request.params.id },
      select: { mbId: true },
    });
    if (quote?.mbId !== request.user.mbId) return reply.notFound('견적을 찾을 수 없습니다');
    const data = await loadQuoteComparisonPage(request.params.id, request.query);
    if (data === null) return reply.notFound('견적을 찾을 수 없습니다');
    return {
      result: true as const,
      data,
    };
  });

  fastify.get('/bom/quotes/:id/supplier-search', {
    schema: { params: IdParams, response: { 200: BomSupplierStartResponse } },
  }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({
      where: { id: request.params.id },
      select: { mbId: true, activeSupplierSearchRun: true },
    });
    if (quote?.mbId !== request.user.mbId) return reply.notFound('견적을 찾을 수 없습니다');
    const run = quote.activeSupplierSearchRun;
    if (run === null) {
      return {
        result: true as const,
        data: { status: null, progress: 0, message: '', error: null, result_available: false },
      };
    }
    if (run.status === 'running' && run.engineJobId !== null) {
      try {
        const response = await engineFetch(`/jobs/${encodeURIComponent(run.engineJobId)}/supplier-search`);
        if (response.ok) {
          const parsed = BomSupplierView.safeParse(await response.json());
          if (parsed.success) return { result: true as const, data: parsed.data };
        }
      } catch {
        // 영속 상태로 축퇴하고 상세 조회의 heal 경로가 재시작을 담당한다.
      }
    }
    return {
      result: true as const,
      data: {
        status: run.status === 'completed' ? 'completed' as const : run.status === 'failed' ? 'failed' as const : 'running' as const,
        progress: run.status === 'completed' ? 100 : run.status === 'failed' ? 0 : 5,
        message: run.status === 'completed' ? '공급사 검색 완료' : run.status === 'failed' ? '공급사 검색 실패' : '공급사 검색 준비 중',
        error: run.error,
        result_available: run.status === 'completed',
      },
    };
  });

  fastify.get('/bom/quotes/:id', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    // 게으른 치유 — searching 견적은 조회가 곧 수렴 트리거(고객 폴링이 갭도 단축)
    if (quote.status === 'draft' && quote.enrichStatus === 'searching') {
      void healEnrichment(quote.id, request.user.mbId, request.log).catch((error: unknown) => {
        request.log.warn({ quoteId: String(quote.id), err: String(error) }, '자동 보강 치유 실패');
      });
    } else if (quote.status === 'draft' && quote.enrichStatus === 'done') {
      // 백그라운드 인제스트 직후 프로세스가 재시작돼도 다음 상세 조회에서 partId가 수렴한다.
      void backfillQuotePartIds(quote.id).catch((error: unknown) => {
        request.log.warn({ quoteId: String(quote.id), err: String(error) }, '견적 카탈로그 참조 지연 보강 실패');
      });
      // 공급사 결과 저장 뒤 프로세스가 재시작된 경우에도 DB·검색 준비를 다시 이어간다.
      void healCatalogPreparation(quote.id, quote.activeSupplierSearchRunId, request.log);
    }
    return { result: true as const, data: await toDetailDto(quote, quote.items, quote.sheets) };
  });

  // 후보 비교·부품 변경용 DB/검색 색인 준비 재시도. 사용자 화면에서는 내부 용어 대신
  // "부품 정보 준비"로 표현하며, 완료 응답 전에는 패널을 열지 않는다.
  fastify.post('/bom/quotes/:id/part-data/prepare', {
    schema: { params: IdParams, response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError } },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    const run = await prisma.spBomSupplierSearchRun.findUnique({
      where: { id: quote.activeSupplierSearchRunId ?? -1n },
      select: {
        id: true,
        engineJobId: true,
      },
    });
    if (run === null) return await reply.status(409).send({ result: false, error: 'PART_DATA_RESULT_GONE' });
    const partData = await loadSupplierSearchSummary(run.id, quote.enrichStatus);
    if (partData.partDataStatus === 'ready') {
      return { result: true as const, data: await toDetailDto(quote, quote.items, quote.sheets) };
    }

    await markCatalogPreparation(quote.id, run.id, 'preparing');
    try {
      let outcome = await retrySupplierResultArtifactNow(run.id, request.log);
      if (outcome === null) {
        if (run.engineJobId === null) {
          const restarted = await autoEnrichQuote(quote.id, request.user.mbId, request.log, { force: true });
          if (restarted) {
            const fresh = await loadOwnQuote(quote.id, request.user.mbId);
            if (fresh === null) return await reply.notFound('견적을 찾을 수 없습니다');
            return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
          }
          await markCatalogPreparation(quote.id, run.id, 'failed', 'supplier_result_gone');
          return await reply.status(409).send({ result: false, error: 'PART_DATA_RESULT_GONE' });
        }
        const envelope = await fetchSupplierSearchResult(run.engineJobId);
        if (envelope === null) {
          const restarted = await autoEnrichQuote(quote.id, request.user.mbId, request.log, { force: true });
          if (restarted) {
            const fresh = await loadOwnQuote(quote.id, request.user.mbId);
            if (fresh === null) return await reply.notFound('견적을 찾을 수 없습니다');
            return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
          }
          await markCatalogPreparation(quote.id, run.id, 'failed', 'supplier_result_gone');
          return await reply.status(409).send({ result: false, error: 'PART_DATA_RESULT_GONE' });
        }
        await persistSupplierResultArtifact(run.id, envelope);
        outcome = await retrySupplierResultArtifactNow(run.id, request.log);
      }
      if (outcome === null || outcome === 'dead') {
        await markCatalogPreparation(quote.id, run.id, 'failed', 'catalog_recovery_exhausted');
        return await reply.status(502).send({ result: false, error: 'PART_DATA_PREPARATION_FAILED' });
      }
      const fresh = await loadOwnQuote(quote.id, request.user.mbId);
      if (fresh === null) return await reply.notFound('견적을 찾을 수 없습니다');
      return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
    } catch (error) {
      await markCatalogPreparation(quote.id, run.id, 'failed', error).catch(() => undefined);
      request.log.warn({ quoteId: String(quote.id), searchRunId: String(run.id), err: String(error) }, '부품 정보 준비 재시도 실패');
      return await reply.status(502).send({ result: false, error: 'PART_DATA_PREPARATION_FAILED' });
    }
  });

  // 엔진 잡과 무관한 영속 후보 비교 — 요청 후에도 고객이 자신의 선정 근거를 조회할 수 있다.
  fastify.get('/bom/quotes/:id/items/:itemId/candidates', {
    schema: { params: ItemParams, response: { 200: BomQuoteItemCandidatesResponse } },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!filterActiveQuoteItems(quote.items, quote.sheets).some((item) => item.id === request.params.itemId)) {
      return reply.notFound('견적 항목을 찾을 수 없습니다');
    }
    const data = await getQuoteItemCandidates(quote.id, request.params.itemId);
    if (data === null) return reply.notFound('견적 항목을 찾을 수 없습니다');
    return { result: true as const, data };
  });

  // 원본 추출값은 불변으로 두고 사용자가 보완한 저항/캐패시터 조건으로 해당 행만 재검색한다.
  fastify.put('/bom/quotes/:id/items/:itemId/search-requirements', {
    schema: {
      params: ItemParams,
      body: BomQuoteSearchRequirementsBody,
      response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError },
    },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') {
      return reply.conflict('견적요청 후에는 검색조건을 변경할 수 없습니다');
    }
    if (quote.buildStatus !== 'ready') {
      return reply.conflict('시트 계산이 완료된 후 검색조건을 변경할 수 있습니다');
    }
    if (quote.enrichStatus === 'searching') {
      return reply.conflict('공급사 확인이 완료된 후 검색조건을 변경할 수 있습니다');
    }
    const item = filterActiveQuoteItems(quote.items, quote.sheets).find(
      (row) => row.id === request.params.itemId,
    );
    if (item === undefined) return reply.notFound('견적 항목을 찾을 수 없습니다');
    const componentId = toItemDto(item).sourceRow?.componentId;
    if (typeof componentId !== 'string' || componentId === '') {
      return reply.status(409).send({ result: false, error: 'SEARCH_COMPONENT_NOT_FOUND' });
    }

    const storedRequirements: BomQuoteSearchRequirementsType = {
      ...request.body,
      version: 'bom-user-search-requirements-v1',
      updatedAt: new Date().toISOString(),
      updatedBy: request.user.mbId,
    };
    const updated = await prisma.spBomQuoteItem.updateMany({
      where: { id: item.id, quoteId: quote.id },
      data: { searchRequirements: storedRequirements },
    });
    if (updated.count !== 1) {
      return reply.status(409).send({ result: false, error: 'SEARCH_REQUIREMENTS_UPDATE_LOST' });
    }

    try {
      const started = await autoEnrichQuote(
        quote.id,
        request.user.mbId,
        request.log,
        { force: true, componentIds: [componentId] },
      );
      if (!started) {
        return await reply.status(409).send({ result: false, error: 'SUPPLIER_SEARCH_NOT_STARTED' });
      }
    } catch (error) {
      request.log.warn({
        quoteId: String(quote.id),
        itemId: String(item.id),
        err: String(error),
      }, '사용자 검색조건 행 재검색 시작 실패');
      return reply.status(502).send({ result: false, error: 'SUPPLIER_SEARCH_FAILED' });
    }

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 누락 수동소자 조건을 견적 단위로 한 번 승인하고 전체 공급사 판단을 다시 실행한다.
  fastify.put('/bom/quotes/:id/passive-defaults', {
    schema: {
      params: IdParams,
      body: BomQuotePassiveDefaultsBody,
      response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError },
    },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') {
      return reply.conflict('견적요청 후에는 기본 검색조건을 변경할 수 없습니다');
    }
    if (quote.buildStatus !== 'ready') {
      return reply.conflict('시트 계산이 완료된 후 기본 검색조건을 적용할 수 있습니다');
    }
    if (quote.enrichStatus === 'searching') {
      return reply.conflict('공급사 확인이 완료된 후 기본 검색조건을 적용할 수 있습니다');
    }

    try {
      const started = await autoEnrichQuote(
        quote.id,
        request.user.mbId,
        request.log,
        { force: true, passiveDefaults: request.body },
      );
      if (!started) {
        return await reply.status(409).send({
          result: false,
          error: 'SUPPLIER_SEARCH_NOT_STARTED',
        });
      }
    } catch (error) {
      request.log.warn({
        quoteId: String(quote.id),
        err: String(error),
      }, '견적 누락 수동소자 기본조건 검색 시작 실패');
      return reply.status(502).send({
        result: false,
        error: 'SUPPLIER_SEARCH_FAILED',
      });
    }

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return {
      result: true as const,
      data: await toDetailDto(fresh, fresh.items, fresh.sheets),
    };
  });

  // 후보/오퍼 명시 선택 — 클라이언트 가격은 받지 않고 서버 스냅샷에서 합계를 재계산한다.
  fastify.post('/bom/quotes/:id/items/:itemId/selection', {
    schema: {
      params: ItemParams,
      body: BomQuoteCandidateSelectionBody,
      response: { 200: BomQuoteDetailResponse, 409: BizError },
    },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('견적요청 후에는 후보를 변경할 수 없습니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 후보를 변경할 수 있습니다');
    if (quote.enrichStatus === 'searching') return reply.conflict('공급사 확인이 완료된 후 후보를 변경할 수 있습니다');
    const result = await applyQuoteCandidateSelection(
      quote.id,
      request.params.itemId,
      request.body.candidateKey,
      request.body.offerKey,
      request.user.mbId,
    );
    if (result !== 'ok') {
      const error = result === 'candidate-blocked'
        ? 'CANDIDATE_BLOCKED'
        : result === 'offer-not-found'
          ? 'OFFER_NOT_FOUND'
          : result === 'offer-not-priced'
            ? 'OFFER_NOT_PRICED'
            : 'CANDIDATE_NOT_FOUND';
      return reply.status(409).send({ result: false, error });
    }
    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 파싱 완료 결과 전체를 불변 AnalysisRun/Sheet/Component로 영속한다.
  // 이후 시트 선택·라인 생성은 엔진 인메모리 잡이 아니라 활성 분석 실행을 읽는다.
  fastify.post('/bom/quotes/:id/prepare', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.buildStatus !== 'parsing') {
      return { result: true as const, data: await toDetailDto(quote, quote.items, quote.sheets) };
    }
    if (quote.engineJobId === null) return reply.conflict('파싱 잡이 없습니다 — 다시 업로드해 주세요');

    let engineResult: unknown;
    try {
      const res = await engineFetch(`/jobs/${encodeURIComponent(quote.engineJobId)}/result`);
      if (!res.ok) {
        return await reply.status(409).send({ result: false, error: 'ENGINE_JOB_GONE' }); // 엔진 재시작 등 — 재업로드 안내
      }
      engineResult = await res.json();
    } catch {
      return reply.status(502).send({ result: false, error: 'BOM_ENGINE_UNREACHABLE' });
    }

    try {
      await persistBomAnalysisResult(quote.id, quote.engineJobId, engineResult);
    } catch (error) {
      if (error instanceof BomAnalysisContractError || (
        error instanceof Error && error.message.startsWith('ENGINE_')
      )) {
        request.log.error({ quoteId: String(quote.id), err: error }, 'BOM 분석 결과 계약 검증 실패');
        await prisma.spBomQuote.update({ where: { id: quote.id }, data: { buildStatus: 'failed' } });
        return reply.status(409).send({ result: false, error: 'INVALID_ENGINE_RESULT' });
      }
      throw error;
    }

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 고객이 선택한 시트만 라인·필요수량을 생성하고 공급사 검색을 시작한다.
  fastify.post('/bom/quotes/:id/build', { schema: { params: IdParams, body: BomQuoteBuildBody, response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.buildStatus === 'ready') {
      return { result: true as const, data: await toDetailDto(quote, quote.items, quote.sheets) };
    }
    if (quote.buildStatus !== 'selecting') return reply.conflict('시트 분석 또는 다른 계산이 진행 중입니다');
    const requestedIndexes = request.body.sheetIndexes;
    const selectable = new Set(quote.sheets.filter((sheet) => sheet.status === 'parsed').map((sheet) => sheet.sheetIndex));
    if (requestedIndexes.some((index) => !selectable.has(index))) {
      return reply.status(409).send({ result: false, error: 'INVALID_SHEET_SELECTION' });
    }

    const engineResult = await loadActiveBomAnalysisResult(quote.id, requestedIndexes);
    if (engineResult === null) {
      return reply.status(409).send({ result: false, error: 'ANALYSIS_NOT_PERSISTED' });
    }

    const items = buildItemsFromEngineResult(engineResult, requestedIndexes);
    if (items.length === 0) {
      return reply.status(409).send({ result: false, error: 'NO_COMPONENTS_IN_SELECTED_SHEETS' });
    }
    if (items.length > 2_000) {
      return reply.status(409).send({ result: false, error: 'SELECTED_SHEETS_ITEM_LIMIT' });
    }
    const claimed = await prisma.spBomQuote.updateMany({
      where: { id: quote.id, buildStatus: 'selecting' },
      data: { buildStatus: 'building' },
    });
    if (claimed.count !== 1) return reply.conflict('다른 시트 계산이 진행 중입니다');

    const config = await getBomQuoteRuntimeConfig();
    try {
      for (const item of items) item.orderQty = neededQty(item.bomQty, quote.setQty, quote.spareQty);
      const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
      // 라인·선택 시트·ready를 한 트랜잭션으로 공개한다.
      const willEnrich = enrichNeeded(computed.items, config.freshnessHours);
      await persistQuoteComputed(quote.id, computed, config.usdKrwRate, {
        exchangeRateSnapshot: config.exchangeRateSnapshot,
        enrichStatus: willEnrich ? 'searching' : 'idle',
        buildStatus: 'ready',
        selectedSheetIndexes: requestedIndexes,
      });
    } catch (error) {
      await prisma.spBomQuote.updateMany({
        where: { id: quote.id, buildStatus: 'building' },
        data: { buildStatus: 'selecting' },
      });
      throw error;
    }

    // 조용한 자동 보강 — 검색 "시작"까지만 동기(수백 ms)로 확정. enrichStatus=searching 이
    // 응답에 실려 FE 가 즉시 "확인 중" 모드로 들어간다. 완료·결과 반영은 백그라운드.
    try {
      await autoEnrichQuote(quote.id, request.user.mbId, request.log);
    } catch (error: unknown) {
      request.log.warn({ quoteId: String(quote.id), err: String(error) }, '자동 보강 실패');
    }

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 계산 완료 후 기존 구성 시트를 제외·복원한다. 원본 분석, 라인 ID, 후보와 선택 이력은
  // 삭제하지 않고 selected만 바꿔 draft 안에서 되돌릴 수 있게 한다.
  fastify.put('/bom/quotes/:id/sheets', {
    schema: {
      params: IdParams,
      body: BomQuoteSheetSelectionBody,
      response: { 200: BomQuoteDetailResponse, 409: BizError },
    },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('견적요청 후에는 시트를 변경할 수 없습니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 변경할 수 있습니다');
    if (quote.enrichStatus === 'searching') return reply.conflict('공급사 확인이 완료된 후 변경할 수 있습니다');

    const builtSheetIndexes = new Set(
      quote.items.flatMap((item) => item.sourceSheetIndex === null ? [] : [item.sourceSheetIndex]),
    );
    const selectableSheetIndexes = new Set(
      quote.sheets
        .filter((sheet) => sheet.status === 'parsed' && builtSheetIndexes.has(sheet.sheetIndex))
        .map((sheet) => sheet.sheetIndex),
    );
    const requestedIndexes = [...request.body.sheetIndexes].sort((left, right) => left - right);
    if (requestedIndexes.some((index) => !selectableSheetIndexes.has(index))) {
      return reply.status(409).send({ result: false, error: 'INVALID_SHEET_SELECTION' });
    }

    const currentIndexes = quote.sheets
      .filter((sheet) => sheet.selected)
      .map((sheet) => sheet.sheetIndex)
      .sort((left, right) => left - right);
    if (
      currentIndexes.length === requestedIndexes.length
      && currentIndexes.every((index, position) => index === requestedIndexes[position])
    ) {
      return { result: true as const, data: await toDetailDto(quote, quote.items, quote.sheets) };
    }

    const requested = new Set(requestedIndexes);
    const restored = new Set(requestedIndexes.filter((index) => !currentIndexes.includes(index)));
    const items = quote.items
      .filter((item) => item.sourceSheetIndex === null || requested.has(item.sourceSheetIndex))
      .map((row) => toItemDto(row));
    if (items.length === 0) {
      return reply.status(409).send({ result: false, error: 'NO_COMPONENTS_IN_SELECTED_SHEETS' });
    }

    // draft 재계산은 일반 PATCH와 같이 현재 실효 환율 스냅샷을 사용한다.
    const config = await getBomQuoteRuntimeConfig();
    const rate = config.usdKrwRate;
    let candidateSnapshots: Awaited<ReturnType<typeof repriceCandidateSelections>> = undefined;
    if (restored.size > 0) {
      for (const item of items) {
        if (item.sourceSheetIndex === null || !restored.has(item.sourceSheetIndex)) continue;
        const needed = neededQty(item.bomQty, quote.setQty, quote.spareQty);
        item.orderQty = item.selectedOffer === null
          ? needed
          : stampOrderQty(needed, item.selectedOffer.moq, item.selectedOffer.orderMultiple);
      }
      candidateSnapshots = await repriceCandidateSelections(
        quote.id,
        items,
        quote.setQty,
        quote.spareQty,
        rate,
        config.exchangeRateSnapshot,
        request.log,
      );
    }

    const computed = computeQuote(items, rate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quote.id, computed, rate, {
      exchangeRateSnapshot: config.exchangeRateSnapshot,
      selectedSheetIndexes: requestedIndexes,
      ...(candidateSnapshots === undefined
        ? {}
        : { candidateSnapshots, candidateSnapshotScope: 'partial' as const }),
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 자동저장(디바운스) — 안정 itemId 기반 부분 갱신. 원본·엔진 판정은 서버에서만 보존한다.
  fastify.patch('/bom/quotes/:id', { schema: { params: IdParams, body: BomQuotePatchBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('견적요청 후에는 수정할 수 없습니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 수정할 수 있습니다');
    if (quote.enrichStatus === 'searching') return reply.conflict('공급사 확인이 완료된 후 수정할 수 있습니다');

    const config = await getBomQuoteRuntimeConfig();
    const persistedItems = filterActiveQuoteItems(quote.items, quote.sheets).map((row) => toItemDto(row));
    const existingById = new Map(persistedItems.map((item) => [item.id, item] as const));
    const items: (BomQuoteItemType | BomQuoteItemInputType)[] = [...persistedItems];

    if (request.body.items !== undefined) {
      const seenIds = new Set<string>();
      let nextRowIdx = items.reduce((max, item) => Math.max(max, item.rowIdx), -1) + 1;
      for (const edit of request.body.items) {
        if (edit.id === null) {
          const catalog = edit.catalogSelection;
          if (catalog === undefined) return reply.badRequest('신규 견적 행의 카탈로그 선택 정보가 없습니다');
          items.push({
            rowIdx: nextRowIdx,
            included: edit.included,
            mpn: catalog.mpn,
            manufacturerName: catalog.manufacturerName,
            description: catalog.description,
            bomQty: 1,
            orderQty: edit.orderQty,
            matchStatus: 'manual',
            matchEvidence: null,
            recommendedCandidateKey: null,
            selectedCandidateKey: null,
            selectionSource: 'catalog',
            partId: catalog.partId,
            selectedOffer: catalog.selectedOffer,
            sourceRow: null,
            sourceSheetIndex: null,
            sourceSheetName: null,
          });
          nextRowIdx += 1;
          continue;
        }

        if (seenIds.has(edit.id)) return reply.badRequest('중복된 견적 행 ID가 있습니다');
        seenIds.add(edit.id);
        const current = existingById.get(edit.id);
        if (current === undefined) return reply.badRequest('견적에 속하지 않은 행이 포함되어 있습니다');
        current.included = edit.included;
        current.orderQty = edit.orderQty;

        const catalog = edit.catalogSelection;
        if (catalog === undefined) continue;
        const catalogChanged =
          catalog.partId !== current.partId ||
          catalog.selectedOffer?.supplier !== current.selectedOffer?.supplier ||
          catalog.selectedOffer?.supplierSku !== current.selectedOffer?.supplierSku ||
          catalog.selectedOffer?.packaging !== current.selectedOffer?.packaging;
        current.mpn = catalog.mpn;
        current.manufacturerName = catalog.manufacturerName;
        current.description = catalog.description;
        current.partId = catalog.partId;
        current.selectedOffer = catalog.selectedOffer;
        current.matchStatus = 'manual';
        current.selectionSource = 'catalog';
        if (!catalogChanged) continue;
        current.selectedCandidateKey = null;
        const evidence = current.matchEvidence;
        const nextEvidence: BomQuoteMatchEvidenceType | null = evidence === null
          ? null
          : {
              ...evidence,
              selectedCandidateKey: null,
              selectedTechnicalRank: null,
              selectedMpn: catalog.mpn,
              selectedManufacturer: catalog.manufacturerName,
              selectedSupplier: catalog.selectedOffer?.supplier ?? null,
              selectedSupplierSku: catalog.selectedOffer?.supplierSku ?? null,
              decisionReasonCodes: ['catalog-choice'],
              priceEvidence: null,
            };
        current.matchEvidence = nextEvidence;
      }
    }
    const nextSetQty = request.body.setQty ?? quote.setQty;
    const nextSpareQty = request.body.spareQty ?? quote.spareQty;
    // items/setQty/spareQty 를 하나도 건드리지 않는 PATCH(제목·메모 전용)는 재평가 대상 자체가
    // 없다 — 엔진 호출 없이 스킵한다. 엔진이 완전히 죽어 있어도 repriceCandidateSelections는
    // 더 이상 예외를 던지지 않으므로(실패 행은 stale 축퇴) 이 PATCH는 항상 200을 반환한다.
    const candidateSnapshots = patchNeedsCandidateReprice(request.body)
      ? await repriceCandidateSelections(
          quote.id,
          items,
          nextSetQty,
          nextSpareQty,
          config.usdKrwRate,
          config.exchangeRateSnapshot,
          request.log,
        )
      : undefined;
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quote.id, computed, config.usdKrwRate, {
      exchangeRateSnapshot: config.exchangeRateSnapshot,
      ...(candidateSnapshots === undefined ? {} : { candidateSnapshots, candidateSnapshotScope: 'partial' as const }),
      ...(request.body.title !== undefined ? { title: request.body.title } : {}),
      ...(request.body.setQty !== undefined ? { setQty: request.body.setQty } : {}),
      ...(request.body.spareQty !== undefined ? { spareQty: request.body.spareQty } : {}),
      ...(request.body.customerMemo !== undefined ? { customerMemo: request.body.customerMemo } : {}),
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 견적요청(RFQ) — 서버 재계산 후 동결(draft→requested)
  fastify.post('/bom/quotes/:id/request', { schema: { params: IdParams, body: BomQuoteRequestBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!canTransition(quote.status, 'requested')) return reply.conflict('견적요청할 수 없는 상태입니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 견적요청할 수 있습니다');

    const items = filterActiveQuoteItems(quote.items, quote.sheets).map((row) => toItemDto(row));
    if (!items.some((i) => i.included)) return reply.badRequest('견적요청에 포함된 라인이 없습니다');

    const rate = quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed);
    const computed = computeQuote(items, rate, quote.shippingFee, quote.managementFee);
    await replaceQuoteItems(quote.id, computed.items);
    await prisma.spBomQuote.update({
      where: { id: quote.id },
      data: {
        title: request.body.title,
        status: 'requested',
        requestedAt: new Date(),
        itemsTotal: computed.itemsTotal,
        finalTotal: computed.finalTotal,
        uncostedCount: computed.uncostedCount,
      },
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 취소 — draft/requested 에서만(고객)
  fastify.post('/bom/quotes/:id/cancel', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!canTransition(quote.status, 'canceled')) return reply.conflict('취소할 수 없는 상태입니다');
    await prisma.spBomQuote.update({ where: { id: quote.id }, data: { status: 'canceled' } });
    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 삭제 — draft 한정(하드 삭제, 원본 파일도 정리)
  fastify.delete('/bom/quotes/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 삭제할 수 있습니다');

    const files = await prisma.spFile.findMany({ where: { refType: FILE_REF_TYPE, refId: quote.id } });
    // 대형 견적은 cascade 자식이 수만 행이라 인터랙티브 트랜잭션(기본 5초)을 넘을 수 있다.
    // 문장 WHERE의 status 가드가 조회 후 상태 전이(draft→requested) 경쟁도 함께 막는다.
    const removed = await prisma.spBomQuote.deleteMany({
      where: { id: quote.id, mbId: request.user.mbId, status: 'draft' },
    });
    if (removed.count === 0) return reply.conflict('draft 상태에서만 삭제할 수 있습니다');
    await prisma.spFile.deleteMany({ where: { refType: FILE_REF_TYPE, refId: quote.id } });
    for (const f of files) {
      void deleteFromFileServer(f.pathToken).catch(() => undefined); // 정리 실패는 무해(고아 파일)
    }
    return { result: true as const };
  });

  done();
};
