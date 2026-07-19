import { createHash } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BomQuoteCatalogMatchBody,
  BomQuoteBuildBody,
  BomQuoteCreateResponse,
  BomQuoteDetailResponse,
  BomQuoteListResponse,
  BomQuotePatchBody,
  BomQuoteRequestBody,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { collectMultipart } from '../lib/market';
import { deleteFromFileServer, uploadToFileServer } from '../lib/file-server';
import { engineFetch } from '../lib/engine-client';
import { getBomQuoteConfig } from '../lib/sp-config';
import { ingestJobResult, recordJobOwner, startIngestPoller, tryCountDailySearch } from '../lib/bom-engine-jobs';
import {
  buildItemsFromEngineResult,
  canTransition,
  catalogMatchItems,
  computeQuote,
  extractEngineSheets,
  persistQuoteComputed,
  refreshQuoteFromSupplierResult,
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
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const ALLOWED_EXT = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'tsv']);
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 시안 카피("up to 50 MB")와 정합

const FILE_REF_TYPE = 'sp_bom_quote';
const BizError = z.object({ result: z.literal(false), error: z.string() });

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

async function applyCompletedSupplierResult(quoteId: bigint, jobId: string): Promise<boolean> {
  const result = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
  if (!result.ok) return false;
  return refreshQuoteFromSupplierResult(quoteId, await result.json());
}

async function autoEnrichQuote(
  quoteId: bigint,
  jobId: string,
  mbId: string,
  log: Parameters<typeof startIngestPoller>[1],
): Promise<boolean> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true, sheets: true } });
  if (quote?.status !== 'draft') return false;
  const config = await getBomQuoteConfig();
  const sheetIndexes = quote.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.sheetIndex);
  if (sheetIndexes.length === 0) return false;
  const searchOptions = {
    max_calls: config.supplierSearchMaxCalls,
    cache_only: false,
    reset_cache: false,
    sheet_indexes: sheetIndexes,
  };

  const items = quote.items.map(toItemDto);
  if (!enrichNeeded(items, config.freshnessHours)) {
    // 전부 신선 — 0콜로 끝. build 가 선점해 둔 searching 이 있으면 idle 로 되돌린다.
    if (quote.enrichStatus === 'searching') {
      await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'idle' } }).catch(() => undefined);
    }
    return false;
  }

  const markFailed = async (): Promise<false> => {
    await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'failed' } }).catch(() => undefined);
    return false;
  };

  let cacheOnly = false;
  try {
    const pfRes = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchOptions),
    });
    if (!pfRes.ok) return await markFailed();
    const pf = (await pfRes.json()) as { plan?: { estimated_within_job_limit?: boolean; estimated_api_calls?: number } };
    if (pf.plan?.estimated_within_job_limit !== true) cacheOnly = true; // 초대형 BOM — 캐시만
    const liveCalls = (pf.plan?.estimated_api_calls ?? 0) > 0;
    if (!cacheOnly && liveCalls && !tryCountDailySearch(mbId, config.memberDailySearchLimit)) {
      cacheOnly = true; // 일일 한도 소진 — 캐시만
    }
  } catch {
    return markFailed(); // 엔진 불가 — 카탈로그 데이터로 그대로(다음 업로드에 재시도)
  }

  try {
    const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...searchOptions, cache_only: cacheOnly }),
    });
    if (res.status !== 202 && !res.ok) return await markFailed();
  } catch {
    return markFailed();
  }
  // 응답 전에 searching 을 영속 — 이후 어떤 조회(새로고침·타기기)든 같은 진실을 본다
  await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'searching' } });
  log.info({ quoteId: String(quoteId), jobId, cacheOnly }, '자동 보강 검색 시작');
  startIngestPoller(jobId, log, async () => {
    await applyCompletedSupplierResult(quoteId, jobId); // 엔진 판정+최저 실효가+done 원자 커밋
  });
  return true;
}

// ── 게으른 치유 — searching 견적 조회 시 상태를 수렴시킨다(재시작·폴러 유실 내성) ──
// 엔진 running → 유지 · completed → 인제스트+재매칭(done) · 잡 소멸/엔진 다운 → failed.
// fire-and-forget: 고객의 3초 폴링이 곧 치유 트리거 — 다음 폴이 수렴된 상태를 받는다.
const healInFlight = new Set<string>();

async function healEnrichment(
  quoteId: bigint,
  jobId: string,
  log: Parameters<typeof startIngestPoller>[1],
): Promise<void> {
  const key = String(quoteId);
  if (healInFlight.has(key)) return;
  healInFlight.add(key);
  try {
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
      await applyCompletedSupplierResult(quoteId, jobId);
      return;
    }
    // gone·failed — 검색 결과를 받을 수 없음: 최종 판정으로 전환
    await prisma.spBomQuote.update({ where: { id: quoteId }, data: { enrichStatus: 'failed' } });
    log.warn({ quoteId: key, jobId, engineStatus: status }, '자동 보강 치유 — failed 로 종결');
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
    const config = await getBomQuoteConfig();
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
    const { page, pageSize } = request.query;
    const where = { mbId: request.user.mbId };
    const [rows, total] = await Promise.all([
      prisma.spBomQuote.findMany({
        where,
        include: { items: { select: { included: true, matchStatus: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.spBomQuote.count({ where }),
    ]);
    return {
      result: true as const,
      data: {
        items: rows.map((row) => toSummaryDto(row, row.items)),
        total,
        page,
        pageSize,
      },
    };
  });

  fastify.get('/bom/quotes/:id', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    // 게으른 치유 — searching 견적은 조회가 곧 수렴 트리거(고객 폴링이 갭도 단축)
    if (quote.status === 'draft' && quote.enrichStatus === 'searching' && quote.engineJobId !== null) {
      const jobId = quote.engineJobId;
      void healEnrichment(quote.id, jobId, request.log).catch((error: unknown) => {
        request.log.warn({ quoteId: String(quote.id), err: String(error) }, '자동 보강 치유 실패');
      });
    }
    return { result: true as const, data: toDetailDto(quote, quote.items, quote.sheets) };
  });

  // 파싱 완료 결과에서 시트 요약만 영속 — 계산·공급사 검색은 아직 시작하지 않는다.
  fastify.post('/bom/quotes/:id/prepare', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.buildStatus !== 'parsing') {
      return { result: true as const, data: toDetailDto(quote, quote.items, quote.sheets) };
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

    const sheets = extractEngineSheets(engineResult);
    if (sheets.length === 0) {
      await prisma.spBomQuote.update({ where: { id: quote.id }, data: { buildStatus: 'failed' } });
      return reply.status(409).send({ result: false, error: 'INVALID_ENGINE_RESULT' });
    }
    const hasParsedSheet = sheets.some((sheet) => sheet.status === 'parsed');
    await prisma.$transaction(async (tx) => {
      await tx.spBomQuoteSheet.deleteMany({ where: { quoteId: quote.id } });
      await tx.spBomQuoteSheet.createMany({
        data: sheets.map((sheet) => ({
          quoteId: quote.id,
          sheetIndex: sheet.sheetIndex,
          sheetName: sheet.sheetName,
          status: sheet.status,
          componentCount: sheet.componentCount,
          selected: false,
          failureReason: sheet.failureReason,
          warnings: sheet.warnings,
        })),
      });
      await tx.spBomQuote.update({
        where: { id: quote.id },
        data: { buildStatus: hasParsedSheet ? 'selecting' : 'failed' },
      });
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 고객이 선택한 시트만 라인 생성·카탈로그 매칭·공급사 검색한다.
  fastify.post('/bom/quotes/:id/build', { schema: { params: IdParams, body: BomQuoteBuildBody, response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.buildStatus === 'ready') {
      return { result: true as const, data: toDetailDto(quote, quote.items, quote.sheets) };
    }
    if (quote.buildStatus !== 'selecting') return reply.conflict('시트 분석 또는 다른 계산이 진행 중입니다');
    if (quote.engineJobId === null) return reply.conflict('파싱 잡이 없습니다 — 다시 업로드해 주세요');

    const requestedIndexes = request.body.sheetIndexes;
    const selectable = new Set(quote.sheets.filter((sheet) => sheet.status === 'parsed').map((sheet) => sheet.sheetIndex));
    if (requestedIndexes.some((index) => !selectable.has(index))) {
      return reply.status(409).send({ result: false, error: 'INVALID_SHEET_SELECTION' });
    }

    let engineResult: unknown;
    try {
      const res = await engineFetch(`/jobs/${encodeURIComponent(quote.engineJobId)}/result`);
      if (!res.ok) return await reply.status(409).send({ result: false, error: 'ENGINE_JOB_GONE' });
      engineResult = await res.json();
    } catch {
      return reply.status(502).send({ result: false, error: 'BOM_ENGINE_UNREACHABLE' });
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

    const config = await getBomQuoteConfig();
    try {
      await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, false);
      const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
      // 라인·선택 시트·ready를 한 트랜잭션으로 공개한다.
      const willEnrich = enrichNeeded(computed.items, config.freshnessHours);
      await persistQuoteComputed(quote.id, computed, config.usdKrwRate, {
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
    const jobId = quote.engineJobId;
    try {
      await autoEnrichQuote(quote.id, jobId, request.user.mbId, request.log);
    } catch (error: unknown) {
      request.log.warn({ quoteId: String(quote.id), err: String(error) }, '자동 보강 실패');
    }

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 자동저장(디바운스) — draft 한정, items 는 replace-all
  fastify.patch('/bom/quotes/:id', { schema: { params: IdParams, body: BomQuotePatchBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('견적요청 후에는 수정할 수 없습니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 수정할 수 있습니다');
    if (quote.enrichStatus === 'searching') return reply.conflict('공급사 확인이 완료된 후 수정할 수 있습니다');

    const config = await getBomQuoteConfig();
    const existing = new Map(quote.items.map((row) => [row.rowIdx, toItemDto(row)]));
    // 엔진 판정은 서버 소유 스냅샷 — 클라이언트 PATCH가 변조하거나 과거 값으로 되돌릴 수 없다.
    const items =
      request.body.items?.map((item) => ({
        ...item,
        matchEvidence: existing.get(item.rowIdx)?.matchEvidence ?? null,
      })) ?? [...existing.values()];
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quote.id, computed, config.usdKrwRate, {
      ...(request.body.title !== undefined ? { title: request.body.title } : {}),
      ...(request.body.setQty !== undefined ? { setQty: request.body.setQty } : {}),
      ...(request.body.spareQty !== undefined ? { spareQty: request.body.spareQty } : {}),
      ...(request.body.customerMemo !== undefined ? { customerMemo: request.body.customerMemo } : {}),
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 카탈로그 재매칭 — 공급사 검색(자동 인제스트) 후 호출하면 신규 오퍼 반영
  fastify.post('/bom/quotes/:id/catalog-match', { schema: { params: IdParams, body: BomQuoteCatalogMatchBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 다시 매칭할 수 있습니다');

    const config = await getBomQuoteConfig();
    const items = quote.items.map(toItemDto);
    await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, request.body.onlyUnmatched);
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quote.id, computed, config.usdKrwRate);

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 견적요청(RFQ) — 서버 재계산 후 동결(draft→requested)
  fastify.post('/bom/quotes/:id/request', { schema: { params: IdParams, body: BomQuoteRequestBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!canTransition(quote.status, 'requested')) return reply.conflict('견적요청할 수 없는 상태입니다');
    if (quote.buildStatus !== 'ready') return reply.conflict('시트 계산이 완료된 후 견적요청할 수 있습니다');

    const items = quote.items.map(toItemDto);
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
    return { result: true as const, data: toDetailDto(fresh, fresh.items, fresh.sheets) };
  });

  // 취소 — draft/requested 에서만(고객)
  fastify.post('/bom/quotes/:id/cancel', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!canTransition(quote.status, 'canceled')) return reply.conflict('취소할 수 없는 상태입니다');
    await prisma.spBomQuote.update({ where: { id: quote.id }, data: { status: 'canceled' } });
    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items, fresh.sheets) };
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
