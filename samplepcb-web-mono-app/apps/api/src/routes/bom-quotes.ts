import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BomQuoteCatalogMatchBody,
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
  BomQuoteRequestBody,
  BomQuoteStatus,
  BomSupplierStartResponse,
  BomSupplierView,
  type BomQuoteItemInputType,
  type BomQuoteItemType,
  type BomQuoteMatchEvidenceType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { collectMultipart } from '../lib/market';
import { deleteFromFileServer, uploadToFileServer } from '../lib/file-server';
import { engineFetch } from '../lib/engine-client';
import { getBomQuoteConfig } from '../lib/sp-config';
import { getBomQuoteRuntimeConfig } from '../lib/exchange-rate';
import { ingestJobResult, recordJobOwner, startIngestPoller, tryCountDailySearch } from '../lib/bom-engine-jobs';
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
  applyQuoteCandidateSelection,
  canTransition,
  catalogMatchItems,
  computeQuote,
  getQuoteItemCandidates,
  loadQuoteComparisonPage,
  persistQuoteComputed,
  refreshQuoteFromSupplierResult,
  repriceCandidateSelections,
  replaceQuoteItems,
  toDetailDto,
  toItemDto,
  toSummaryDto,
} from '../lib/bom-quote';

// ── /api/bom/quotes — 고객(회원) BOM 견적 CRUD (설계: docs/BOM_QUOTE.md) ─────
// 업로드(견적+엔진 잡 생성) → build(파싱 결과→라인+카탈로그 매칭) → 검토(PATCH
// 자동저장·catalog-match 재매칭) → request(견적요청, 서버 재계산·동결).
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
// 비용 게이트: preflight 로 예상 호출 확인 → 한도 내면 라이브, 초과·일일 소진이면
// cache_only(0콜). 검색 시작을 응답 전에 확정하므로 FE 첫 상태 폴이 반드시 running
// 을 관측한다(폴링 경합 원천 제거). 완료·재매칭(refreshQuoteFromCatalog)은 백그라운드.
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
  jobId: string,
): Promise<boolean> {
  const result = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
  if (!result.ok) return false;
  const applied = await refreshQuoteFromSupplierResult(quoteId, await result.json());
  if (applied) {
    await prisma.spBomSupplierSearchRun.updateMany({
      where: { id: searchRunId, quoteId },
      data: { status: 'completed', completedAt: new Date(), error: null },
    });
  } else {
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.spBomSupplierSearchRun.updateMany({
        where: { id: searchRunId, quoteId },
        data: { status: 'failed', completedAt, error: 'supplier_result_not_applied' },
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
): Promise<boolean> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true, sheets: true } });
  if (quote?.status !== 'draft' || quote.activeAnalysisRunId === null) return false;
  const config = await getBomQuoteConfig();
  const sheetIndexes = quote.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.sheetIndex);
  if (sheetIndexes.length === 0) return false;
  const searchOptions = {
    max_calls: config.supplierSearchMaxCalls,
    cache_only: false,
    reset_cache: false,
    sheet_indexes: sheetIndexes,
  };

  const items = quote.items.map((row) => toItemDto(row));
  if (!enrichNeeded(items, config.freshnessHours)) {
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

  let jobId: string;
  try {
    const registered = await engineFetch('/supplier-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysis }),
    });
    if (!registered.ok) return await markFailed(`supplier_job_registration_${String(registered.status)}`);
    const body = (await registered.json()) as { job_id?: unknown };
    if (typeof body.job_id !== 'string' || body.job_id === '') return await markFailed('supplier_job_id_missing');
    jobId = body.job_id;
    await prisma.spBomSupplierSearchRun.update({ where: { id: searchRun.id }, data: { engineJobId: jobId } });
  } catch (error) {
    return markFailed(`supplier_job_registration_failed: ${String(error)}`);
  }

  let cacheOnly = false;
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
    if (pf.plan?.estimated_within_job_limit !== true) cacheOnly = true; // 초대형 BOM — 캐시만
    const liveCalls = (pf.plan?.estimated_api_calls ?? 0) > 0;
    if (!cacheOnly && liveCalls && !tryCountDailySearch(mbId, config.memberDailySearchLimit)) {
      cacheOnly = true; // 일일 한도 소진 — 캐시만
    }
  } catch {
    return markFailed('supplier_preflight_unreachable');
  }

  try {
    const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...searchOptions, cache_only: cacheOnly }),
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
        options: { ...searchOptions, cache_only: cacheOnly },
        startedAt: new Date(),
      },
    }),
    prisma.spBomQuote.update({
      where: { id: quoteId },
      data: { enrichStatus: 'searching', activeSupplierSearchRunId: searchRun.id },
    }),
  ]);
  log.info({ quoteId: String(quoteId), searchRunId: String(searchRun.id), jobId, cacheOnly }, '영속 분석 기반 자동 보강 검색 시작');
  startIngestPoller(jobId, log, async () => {
    await applyCompletedSupplierResult(quoteId, searchRun.id, jobId);
  });
  return true;
}

// ── 게으른 치유 — searching 견적 조회 시 상태를 수렴시킨다(재시작·폴러 유실 내성) ──
// 엔진 running → 유지 · completed → 인제스트+재매칭(done) · 잡 소멸/엔진 다운 → failed.
// fire-and-forget: 고객의 3초 폴링이 곧 치유 트리거 — 다음 폴이 수렴된 상태를 받는다.
const healInFlight = new Set<string>();

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
      const ingested = await ingestJobResult(jobId, log);
      if (!ingested) return; // 결과 준비 지연·일시 실패 — searching 유지, 다음 조회가 재시도
      await applyCompletedSupplierResult(quoteId, run.id, jobId);
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
        include: { _count: { select: { items: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.spBomQuote.count({ where }),
      prisma.spBomQuote.count({ where: { mbId: request.user.mbId, status: 'draft' } }),
    ]);
    const quoteIds = rows.map((row) => row.id);
    const [includedRows, matchedRows] = quoteIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.spBomQuote.findMany({
            where: { id: { in: quoteIds } },
            select: { id: true, _count: { select: { items: { where: { included: true } } } } },
          }),
          prisma.spBomQuote.findMany({
            where: { id: { in: quoteIds } },
            select: { id: true, _count: { select: { items: { where: { matchStatus: { not: 'none' } } } } } },
          }),
        ]);
    const includedCountById = new Map(includedRows.map((row) => [row.id, row._count.items] as const));
    const matchedCountById = new Map(matchedRows.map((row) => [row.id, row._count.items] as const));
    return {
      result: true as const,
      data: {
        items: rows.map((row) => toSummaryDto(row, {
          itemCount: row._count.items,
          includedCount: includedCountById.get(row.id) ?? 0,
          matchedCount: matchedCountById.get(row.id) ?? 0,
        })),
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

    // cascade 대상이 큰 scope=all도 청크별 커밋해 기본 트랜잭션 시간 안에 수렴시킨다.
    for (const ids of chunkBomQuoteDeletionIds(deletableIds)) {
      const chunk = await prisma.$transaction(async (tx) => {
        await tx.spBomQuote.deleteMany({
          where: { id: { in: ids }, mbId: request.user.mbId, status: 'draft' },
        });
        const survivors = await tx.spBomQuote.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
        const deletedIds = resolveDeletedBomQuoteIds(ids, survivors.map((quote) => quote.id));
        const files = deletedIds.length === 0
          ? []
          : await tx.spFile.findMany({
              where: { refType: FILE_REF_TYPE, refId: { in: deletedIds } },
              select: { pathToken: true },
            });

        if (deletedIds.length > 0) {
          await tx.spFile.deleteMany({ where: { refType: FILE_REF_TYPE, refId: { in: deletedIds } } });
        }
        return { deletedCount: deletedIds.length, pathTokens: files.map((file) => file.pathToken) };
      });
      deletedCount += chunk.deletedCount;
      pathTokens.push(...chunk.pathTokens);
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
    }
    return { result: true as const, data: await toDetailDto(quote, quote.items, quote.sheets) };
  });

  // 엔진 잡과 무관한 영속 후보 비교 — 요청 후에도 고객이 자신의 선정 근거를 조회할 수 있다.
  fastify.get('/bom/quotes/:id/items/:itemId/candidates', {
    schema: { params: ItemParams, response: { 200: BomQuoteItemCandidatesResponse } },
  }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    const data = await getQuoteItemCandidates(quote.id, request.params.itemId);
    if (data === null) return reply.notFound('견적 항목을 찾을 수 없습니다');
    return { result: true as const, data };
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

  // 고객이 선택한 시트만 라인 생성·카탈로그 매칭·공급사 검색한다.
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
      await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, false);
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
    // 응답에 실려 FE 가 즉시 "확인 중" 모드로 들어간다. 완료·재매칭은 백그라운드.
    try {
      await autoEnrichQuote(quote.id, request.user.mbId, request.log);
    } catch (error: unknown) {
      request.log.warn({ quoteId: String(quote.id), err: String(error) }, '자동 보강 실패');
    }

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
    const persistedItems = quote.items.map((row) => toItemDto(row));
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
    await repriceCandidateSelections(quote.id, items, nextSetQty, nextSpareQty, config.usdKrwRate);
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quote.id, computed, config.usdKrwRate, {
      exchangeRateSnapshot: config.exchangeRateSnapshot,
      ...(request.body.title !== undefined ? { title: request.body.title } : {}),
      ...(request.body.setQty !== undefined ? { setQty: request.body.setQty } : {}),
      ...(request.body.spareQty !== undefined ? { spareQty: request.body.spareQty } : {}),
      ...(request.body.customerMemo !== undefined ? { customerMemo: request.body.customerMemo } : {}),
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: await toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 카탈로그 재매칭 — 공급사 검색(자동 인제스트) 후 호출하면 신규 오퍼 반영
  fastify.post('/bom/quotes/:id/catalog-match', { schema: { params: IdParams, body: BomQuoteCatalogMatchBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 다시 매칭할 수 있습니다');

    const config = await getBomQuoteRuntimeConfig();
    const items = quote.items.map((row) => toItemDto(row));
    await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, request.body.onlyUnmatched);
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quote.id, computed, config.usdKrwRate, {
      exchangeRateSnapshot: config.exchangeRateSnapshot,
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

    const items = quote.items.map((row) => toItemDto(row));
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
    await prisma.$transaction(async (tx) => {
      await tx.spFile.deleteMany({ where: { refType: FILE_REF_TYPE, refId: quote.id } });
      await tx.spBomQuote.delete({ where: { id: quote.id } }); // items cascade
    });
    for (const f of files) {
      void deleteFromFileServer(f.pathToken).catch(() => undefined); // 정리 실패는 무해(고아 파일)
    }
    return { result: true as const };
  });

  done();
};
