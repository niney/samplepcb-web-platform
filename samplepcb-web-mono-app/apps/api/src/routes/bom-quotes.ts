import { createHash } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BomQuoteCatalogMatchBody,
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
import { recordJobOwner, startIngestPoller, tryCountDailySearch } from '../lib/bom-engine-jobs';
import {
  buildItemsFromEngineResult,
  canTransition,
  catalogMatchItems,
  computeQuote,
  refreshQuoteFromCatalog,
  replaceQuoteItems,
  toDetailDto,
  toItemDto,
  toSummaryDto,
  type QuoteComputed,
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
const MAX_FILE_BYTES = 30 * 1024 * 1024;

const FILE_REF_TYPE = 'sp_bom_quote';
const BizError = z.object({ result: z.literal(false), error: z.string() });

async function loadOwnQuote(id: bigint, mbId: string) {
  const quote = await prisma.spBomQuote.findUnique({ where: { id }, include: { items: true } });
  if (quote?.mbId !== mbId) return null; // 타인 견적은 404 로 은닉
  return quote;
}

// ── 조용한 자동 보강 — build 직후 서버가 판단·실행(고객에겐 상태 라벨만) ────────
// 필요 조건: included 미매칭 라인 존재 OR 오퍼 데이터 나이 > freshnessHours.
// 비용 게이트: preflight 로 예상 호출 확인 → 한도 내면 라이브, 초과·일일 소진이면
// cache_only(0콜). 완료 시 인제스트 폴러가 견적 draft 를 자동 재매칭(refreshQuoteFromCatalog).
async function autoEnrichQuote(
  quoteId: bigint,
  jobId: string,
  mbId: string,
  log: Parameters<typeof startIngestPoller>[1],
): Promise<void> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true } });
  if (quote?.status !== 'draft') return;
  const config = await getBomQuoteConfig();

  const now = Date.now();
  const freshMs = config.freshnessHours * 3_600_000;
  const items = quote.items.map(toItemDto);
  const hasUnmatched = items.some((i) => i.included && i.matchStatus === 'none');
  const hasStale = items.some(
    (i) =>
      i.included &&
      i.selectedOffer !== null &&
      now - new Date(i.selectedOffer.fetchedAt).getTime() > freshMs,
  );
  if (!hasUnmatched && !hasStale) return; // 전부 신선 — 0콜로 끝

  let cacheOnly = false;
  try {
    const pfRes = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ max_calls: config.supplierSearchMaxCalls, cache_only: false, reset_cache: false }),
    });
    if (!pfRes.ok) return;
    const pf = (await pfRes.json()) as { plan?: { estimated_within_job_limit?: boolean; estimated_api_calls?: number } };
    if (pf.plan?.estimated_within_job_limit !== true) cacheOnly = true; // 초대형 BOM — 캐시만
    const liveCalls = (pf.plan?.estimated_api_calls ?? 0) > 0;
    if (!cacheOnly && liveCalls && !tryCountDailySearch(mbId, config.memberDailySearchLimit)) {
      cacheOnly = true; // 일일 한도 소진 — 캐시만
    }
  } catch {
    return; // 엔진 불가 — 카탈로그 데이터로 그대로(다음 업로드에 재시도)
  }

  try {
    const res = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ max_calls: config.supplierSearchMaxCalls, cache_only: cacheOnly, reset_cache: false }),
    });
    if (res.status !== 202 && !res.ok) return;
  } catch {
    return;
  }
  log.info({ quoteId: String(quoteId), jobId, cacheOnly }, '자동 보강 검색 시작');
  startIngestPoller(jobId, log, async () => {
    await refreshQuoteFromCatalog(quoteId);
  });
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
    if (file.buffer.length > MAX_FILE_BYTES) return reply.badRequest('파일이 30MB 를 초과합니다');

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
    return { result: true as const, data: toDetailDto(quote, quote.items) };
  });

  /** 계산 결과를 견적에 영속화(라인 replace-all + 합계 스냅샷). */
  async function persistComputed(
    quoteId: bigint,
    computed: QuoteComputed,
    usdKrwRate: number | null,
    extra?: { title?: string; setQty?: number; spareQty?: number; customerMemo?: string | null },
  ): Promise<void> {
    await replaceQuoteItems(quoteId, computed.items);
    await prisma.spBomQuote.update({
      where: { id: quoteId },
      data: {
        itemsTotal: computed.itemsTotal,
        finalTotal: computed.finalTotal,
        uncostedCount: computed.uncostedCount,
        usdKrwRateUsed: usdKrwRate,
        ...(extra?.title !== undefined ? { title: extra.title } : {}),
        ...(extra?.setQty !== undefined ? { setQty: extra.setQty } : {}),
        ...(extra?.spareQty !== undefined ? { spareQty: extra.spareQty } : {}),
        ...(extra?.customerMemo !== undefined ? { customerMemo: extra.customerMemo } : {}),
      },
    });
  }

  // 파싱 결과 → 라인 생성 + 카탈로그 매칭(최초 1회 — 이미 라인이 있으면 그대로 반환)
  fastify.post('/bom/quotes/:id/build', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse, 409: BizError, 502: BizError } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');
    if (quote.items.length > 0) return { result: true as const, data: toDetailDto(quote, quote.items) };
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

    const items = buildItemsFromEngineResult(engineResult);
    const config = await getBomQuoteConfig();
    await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, false);
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistComputed(quote.id, computed, config.usdKrwRate);

    // 조용한 자동 보강 — 응답을 막지 않는다(고객은 카탈로그 견적을 즉시 보고, 완료 시 갱신)
    const jobId = quote.engineJobId;
    void autoEnrichQuote(quote.id, jobId, request.user.mbId, request.log).catch((error: unknown) => {
      request.log.warn({ quoteId: String(quote.id), err: String(error) }, '자동 보강 실패');
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items) };
  });

  // 자동저장(디바운스) — draft 한정, items 는 replace-all
  fastify.patch('/bom/quotes/:id', { schema: { params: IdParams, body: BomQuotePatchBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('견적요청 후에는 수정할 수 없습니다');

    const config = await getBomQuoteConfig();
    const items = request.body.items ?? quote.items.map(toItemDto);
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistComputed(quote.id, computed, config.usdKrwRate, {
      ...(request.body.title !== undefined ? { title: request.body.title } : {}),
      ...(request.body.setQty !== undefined ? { setQty: request.body.setQty } : {}),
      ...(request.body.spareQty !== undefined ? { spareQty: request.body.spareQty } : {}),
      ...(request.body.customerMemo !== undefined ? { customerMemo: request.body.customerMemo } : {}),
    });

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items) };
  });

  // 카탈로그 재매칭 — 공급사 검색(자동 인제스트) 후 호출하면 신규 오퍼 반영
  fastify.post('/bom/quotes/:id/catalog-match', { schema: { params: IdParams, body: BomQuoteCatalogMatchBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (quote.status !== 'draft') return reply.conflict('draft 상태에서만 가능합니다');

    const config = await getBomQuoteConfig();
    const items = quote.items.map(toItemDto);
    await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, request.body.onlyUnmatched);
    const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistComputed(quote.id, computed, config.usdKrwRate);

    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items) };
  });

  // 견적요청(RFQ) — 서버 재계산 후 동결(draft→requested)
  fastify.post('/bom/quotes/:id/request', { schema: { params: IdParams, body: BomQuoteRequestBody, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!canTransition(quote.status, 'requested')) return reply.conflict('견적요청할 수 없는 상태입니다');

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
    return { result: true as const, data: toDetailDto(fresh, fresh.items) };
  });

  // 취소 — draft/requested 에서만(고객)
  fastify.post('/bom/quotes/:id/cancel', { schema: { params: IdParams, response: { 200: BomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await loadOwnQuote(request.params.id, request.user.mbId);
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    if (!canTransition(quote.status, 'canceled')) return reply.conflict('취소할 수 없는 상태입니다');
    await prisma.spBomQuote.update({ where: { id: quote.id }, data: { status: 'canceled' } });
    const fresh = await loadOwnQuote(quote.id, request.user.mbId);
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data: toDetailDto(fresh, fresh.items) };
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
