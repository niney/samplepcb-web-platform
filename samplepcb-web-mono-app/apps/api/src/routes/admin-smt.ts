import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpSmtOrder, SpSmtReview } from '@prisma/client';
import {
  AdminSmtLinkStatusResponse,
  AdminSmtOrderListQuery,
  AdminSmtOrderListResponse,
  AdminSmtPullBody,
  AdminSmtPullResponse,
  AdminSmtQuoteDetailResponse,
  AdminSmtReceiveLogQuery,
  AdminSmtReceiveLogResponse,
  AdminSmtReviewBody,
  AdminSmtReviewResponse,
  ApiError,
  SmartsmtSheetTotals,
  computeSmartsmtSheet,
  pickSmartsmtSheetEdits,
  readSmartsmtSheetInput,
} from '@sp/api-contract';
import type {
  SmartsmtReceiveResult,
  AdminSmtOrderTab,
  AdminSmtOrderType,
  AdminSmtQuoteFileType,
  AdminSmtQuoteSummaryType,
  AdminSmtReviewType,
} from '@sp/api-contract';
import { downloadFromFileServer } from '../lib/file-server';
import { getMembersByIds } from '../lib/g5-db';
import { prisma } from '../lib/prisma';
import { SMARTSMT_FILE_REF_TYPE, SMARTSMT_FILE_SERVICE_TYPE } from '../lib/smartsmt';
import { pullSmartsmtQuote, smartsmtBaseUrl, smartsmtTimeoutMs } from '../lib/smartsmt-pull';
import { smartsmtSecret } from '../lib/smartsmt-token';

// ── /api/admin/smt — SmartSMT 모듈의 관리자 API (docs/SMARTSMT_INTEGRATION.md §4.5) ──────────
// 전 라우트 requireAdmin. 받은 견적 목록 · 견적 상세 · 동봉 파일 내려받기 · 견적서 가져오기 · 수신 기록 · 연동 상태.
//
// 여기서 내보내는 견적서(envelope)는 **관리자 전용**이다 — labor_charge · user_edits 처럼 고객에게 보이면 안 되는
// 값이 들어 있다. 고객 화면을 붙일 때는 이 응답을 재사용하지 말고 고객용 응답을 따로 만든다.

const IdParams = z.object({ id: z.coerce.bigint() });

// 목록·이력은 견적서 본문(envelope, MEDIUMTEXT)을 읽지 않는다 — 뽑아 올린 열만.
const QUOTE_SUMMARY_SELECT = {
  id: true,
  quoteId: true,
  source: true,
  madeAt: true,
  receivedAt: true,
  currency: true,
  strategy: true,
  quoteStatus: true,
  quantity: true,
  smtTotal: true,
  finalTotal: true,
  smtEstimatedTotal: true,
  finalEstimatedTotal: true,
  blockedBy: true,
  review: { select: { status: true, total: true } },
} satisfies Prisma.SpSmtQuoteSelect;
type QuoteSummaryRow = Prisma.SpSmtQuoteGetPayload<{ select: typeof QUOTE_SUMMARY_SELECT }>;

const toNumber = (value: Prisma.Decimal | null): number | null => (value === null ? null : value.toNumber());
const toStrings = (value: Prisma.JsonValue | null): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const toQuoteSummary = (row: QuoteSummaryRow): AdminSmtQuoteSummaryType => ({
  id: Number(row.id),
  quoteId: row.quoteId,
  source: row.source,
  madeAt: row.madeAt?.toISOString() ?? null,
  receivedAt: row.receivedAt.toISOString(),
  currency: row.currency,
  strategy: row.strategy,
  quoteStatus: row.quoteStatus,
  quantity: row.quantity,
  smtTotal: toNumber(row.smtTotal),
  finalTotal: toNumber(row.finalTotal),
  smtEstimatedTotal: toNumber(row.smtEstimatedTotal),
  finalEstimatedTotal: toNumber(row.finalEstimatedTotal),
  blockedBy: toStrings(row.blockedBy),
  reviewStatus: row.review?.status ?? null,
  reviewTotal: row.review === null ? null : row.review.total.toNumber(),
});

const toAmounts = (value: Prisma.JsonValue): Record<string, number> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
    : {};

/** 저장된 확정 한 벌. 계산 결과를 읽지 못하면(모양이 바뀜) 없는 것으로 본다 — 화면은 SmartSMT 금액에서 다시 시작한다. */
const toReview = (row: SpSmtReview | null): AdminSmtReviewType | null => {
  if (row === null) return null;
  const totals = SmartsmtSheetTotals.safeParse(row.totals);
  if (!totals.success) return null;
  return {
    status: row.status === 'confirmed' ? 'confirmed' : 'draft',
    lineAmounts: toAmounts(row.lineAmounts),
    blockAmounts: toAmounts(row.blockAmounts),
    customerNote: row.customerNote ?? '',
    totals: totals.data,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
};

const toOrder = (row: SpSmtOrder, members: ReadonlySet<string> | null): AdminSmtOrderType => ({
  id: Number(row.id),
  orderId: row.orderId,
  ownerMbId: row.ownerMbId,
  ownerName: row.ownerName,
  // 아이디가 오지 않았거나 회원 조회를 못 했으면 "모름"(null)으로 둔다 — 아니라고 단정하지 않는다.
  ownerIsMember: row.ownerMbId === null || members === null ? null : members.has(row.ownerMbId),
  quoteCount: row.quoteCount,
  firstReceivedAt: row.firstReceivedAt.toISOString(),
  lastReceivedAt: row.lastReceivedAt.toISOString(),
});

/** 견적서의 owner_mb_id 가 우리 회원인지 한 번에 대조한다. 회원 DB 조회가 실패해도 화면은 뜬다(null = 모름). */
async function existingMemberIds(mbIds: (string | null)[], log: FastifyBaseLogger): Promise<Set<string> | null> {
  const ids = mbIds.filter((id): id is string => id !== null && id !== '');
  if (ids.length === 0) return new Set();
  try {
    return new Set((await getMembersByIds(ids)).keys());
  } catch (err) {
    log.warn({ err }, 'smartsmt: 회원 대조 실패');
    return null;
  }
}

const TAB_WHERE: Record<AdminSmtOrderTab, Prisma.SpSmtOrderWhereInput> = {
  all: {},
  review: { latestQuote: { is: { quoteStatus: 'REVIEW_REQUIRED' } } },
  // 최종 금액이 미정 — 합계가 막혔거나(blocked_by) 금액이 오지 않은 견적.
  undetermined: { latestQuote: { is: { finalTotal: null } } },
};

/** sp_smt_quote.files(대조 결과)에 저장된 파일 행을 이어 붙인다 — 파일 행이 있으면 내려받을 수 있다. */
function toQuoteFiles(
  checks: Prisma.JsonValue | null,
  stored: readonly { id: bigint; slot: string | null }[],
): AdminSmtQuoteFileType[] {
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const { part, name, bytes, sha256, check } = entry;
    if (typeof part !== 'string') return [];
    const file = stored.find((row) => row.slot === part);
    return [{
      part,
      name: typeof name === 'string' ? name : null,
      bytes: typeof bytes === 'number' ? bytes : null,
      sha256: typeof sha256 === 'string' ? sha256 : null,
      check: typeof check === 'string' ? check : 'missing',
      fileId: file === undefined ? null : Number(file.id),
    }];
  });
}

export const adminSmtRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 받은 견적 목록 — 주문 단위 한 줄(마지막에 받은 견적 기준).
  fastify.get(
    '/smt/orders',
    { schema: { querystring: AdminSmtOrderListQuery, response: { 200: AdminSmtOrderListResponse } } },
    async (request) => {
      const q = request.query;
      const where: Prisma.SpSmtOrderWhereInput = {
        ...TAB_WHERE[q.tab],
        ...(q.search === undefined
          ? {}
          : {
              OR: [
                { orderId: { contains: q.search } },
                { ownerMbId: { contains: q.search } },
                { ownerName: { contains: q.search } },
              ],
            }),
      };
      const [rows, total, all, review, undetermined] = await Promise.all([
        prisma.spSmtOrder.findMany({
          where,
          include: { latestQuote: { select: QUOTE_SUMMARY_SELECT } },
          orderBy: [{ lastReceivedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.spSmtOrder.count({ where }),
        prisma.spSmtOrder.count(),
        prisma.spSmtOrder.count({ where: TAB_WHERE.review }),
        prisma.spSmtOrder.count({ where: TAB_WHERE.undetermined }),
      ]);
      const members = await existingMemberIds(rows.map((row) => row.ownerMbId), request.log);
      return {
        result: true as const,
        data: {
          items: rows.map((row) => ({
            ...toOrder(row, members),
            latest: row.latestQuote === null ? null : toQuoteSummary(row.latestQuote),
          })),
          total,
          page: q.page,
          pageSize: q.pageSize,
          counts: { all, review, undetermined },
        },
      };
    },
  );

  // 견적 상세 — 견적서 전체 + 동봉 파일 + 같은 주문의 견적 이력. :id 는 sp_smt_quote 의 행 번호.
  fastify.get(
    '/smt/quotes/:id',
    { schema: { params: IdParams, response: { 200: AdminSmtQuoteDetailResponse } } },
    async (request, reply) => {
      const quote = await prisma.spSmtQuote.findUnique({
        where: { id: request.params.id },
        include: { order: true, review: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      const [history, stored, members] = await Promise.all([
        prisma.spSmtQuote.findMany({
          where: { orderRefId: quote.orderRefId },
          select: QUOTE_SUMMARY_SELECT,
          orderBy: { id: 'desc' },
        }),
        prisma.spFile.findMany({
          where: { refType: SMARTSMT_FILE_REF_TYPE, refId: quote.id },
          select: { id: true, slot: true },
        }),
        existingMemberIds([quote.order.ownerMbId], request.log),
      ]);

      // 저장할 때 검증을 통과한 JSON 이지만, 읽지 못하면 빈 객체로 두고 화면은 뜨게 한다.
      let envelope: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(quote.envelope);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          envelope = parsed as Record<string, unknown>;
        }
      } catch (err) {
        request.log.error({ err, quoteId: quote.quoteId }, 'smartsmt: 저장된 견적서를 읽지 못했습니다');
      }

      const latestId = quote.order.latestQuoteId;
      reply.header('cache-control', 'no-store');
      return {
        result: true as const,
        data: {
          order: toOrder(quote.order, members),
          quote: {
            ...toQuoteSummary(quote),
            envelopeVersion: quote.envelopeVersion,
            lang: quote.lang,
            finalSupplyPrice: toNumber(quote.finalSupplyPrice),
            finalVat: toNumber(quote.finalVat),
            isLatest: latestId === quote.id,
          },
          envelope,
          files: toQuoteFiles(quote.files, stored),
          review: toReview(quote.review),
          history: history.map((row) => ({ ...toQuoteSummary(row), isLatest: latestId === row.id })),
        },
      };
    },
  );

  // 관리자 확정 — 항목(견적 줄 · 블록)의 금액을 고쳐 저장한다. 합계는 받지 않는다: 저장된 견적서와 고친 금액으로
  // 서버가 다시 계산한다(직접공정비 → 간접비 → 기업이윤 → 공급가액 → 부가세, 계약 computeSmartsmtSheet).
  // confirm=true 는 빈 금액이 하나도 없을 때만 받는다. 견적 하나에 한 벌이라 다시 저장하면 덮어쓴다.
  fastify.put(
    '/smt/quotes/:id/review',
    {
      schema: {
        params: IdParams,
        body: AdminSmtReviewBody,
        response: { 200: AdminSmtReviewResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spSmtQuote.findUnique({
        where: { id: request.params.id },
        select: { id: true, quoteId: true, envelope: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      let envelope: unknown = null;
      try {
        envelope = JSON.parse(quote.envelope);
      } catch {
        // 아래에서 "고칠 항목이 없다"로 답한다.
      }
      const input = readSmartsmtSheetInput(envelope);
      if (input.lines.length === 0 && input.blocks.length === 0) {
        return reply.conflict('이 견적서에는 고칠 항목이 없습니다');
      }
      // 이 견적에 없는 줄 · 사지 않는 블록의 금액은 버린다(화면이 옛 견적의 값을 들고 있었을 때).
      const edits = pickSmartsmtSheetEdits(input, {
        lineAmounts: request.body.lineAmounts,
        blockAmounts: request.body.blockAmounts,
      });
      const totals = computeSmartsmtSheet(input, edits);
      if (request.body.confirm && !totals.complete) {
        const empty = [...totals.unknownLines, ...totals.unknownBlocks].join(', ');
        return reply.conflict(`금액이 비어 있는 항목이 있어 확정할 수 없습니다 (${empty})`);
      }

      const note = request.body.customerNote.trim();
      const data = {
        status: request.body.confirm ? 'confirmed' : 'draft',
        lineAmounts: { ...edits.lineAmounts },
        blockAmounts: { ...edits.blockAmounts },
        customerNote: note === '' ? null : note,
        directCost: totals.directCost,
        indirectCost: totals.indirectCost,
        profit: totals.profit,
        supplyPrice: totals.supplyPrice,
        vat: totals.vat,
        total: totals.total,
        totals: { ...totals },
        updatedBy: request.user.mbId,
        confirmedAt: request.body.confirm ? new Date() : null,
      };
      const row = await prisma.spSmtReview.upsert({
        where: { quoteRefId: quote.id },
        create: { quoteRefId: quote.id, ...data },
        update: data,
      });
      request.log.info(
        { quoteId: quote.quoteId, status: data.status, total: totals.total, by: request.user.mbId },
        'smartsmt: 견적 확정 저장',
      );
      return { result: true as const, data: { review: toReview(row) } };
    },
  );

  // 고친 금액을 버리고 SmartSMT 가 보낸 금액으로 되돌린다.
  fastify.delete(
    '/smt/quotes/:id/review',
    { schema: { params: IdParams, response: { 200: AdminSmtReviewResponse } } },
    async (request) => {
      const removed = await prisma.spSmtReview.deleteMany({ where: { quoteRefId: request.params.id } });
      if (removed.count > 0) {
        request.log.info({ quoteRowId: Number(request.params.id), by: request.user.mbId }, 'smartsmt: 견적 확정 되돌림');
      }
      return { result: true as const, data: { review: null } };
    },
  );

  // 동봉 파일 내려받기(서버 경유 — pathToken 을 화면에 내보내지 않는다). SmartSMT 견적의 파일만 내준다.
  fastify.get('/smt/files/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const file = await prisma.spFile.findUnique({ where: { id: request.params.id } });
    if (file?.refType !== SMARTSMT_FILE_REF_TYPE) return reply.notFound('파일을 찾을 수 없습니다');
    const downloaded = await downloadFromFileServer(file.pathToken);
    if (downloaded === null) return reply.notFound('파일서버에서 파일을 찾을 수 없습니다');
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`)
      .header('cache-control', 'no-store')
      .send(downloaded.buffer);
  });

  // 견적서 가져오기 — 주문 번호로 SmartSMT 에서 당겨 와 저장한다(파일 없음).
  // 전송을 놓쳤을 때 쓴다. SmartSMT 보관 기간(24시간)이 지나면 404.
  fastify.post(
    '/smt/pull',
    {
      schema: {
        body: AdminSmtPullBody,
        response: { 200: AdminSmtPullResponse, 404: ApiError, 409: ApiError, 502: ApiError, 503: ApiError },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const result = await pullSmartsmtQuote(request.body.orderId, request.log);
      if (!result.ok) {
        request.log.info({ orderId: request.body.orderId, error: result.error, by: request.user.mbId }, 'smartsmt: 견적서 가져오기 실패');
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }
      request.log.info({ ...result, by: request.user.mbId }, 'smartsmt: 견적서 가져오기');
      return {
        result: true as const,
        data: { quoteId: result.quoteId, orderId: result.orderId, duplicate: result.duplicate },
      };
    },
  );

  // 수신 기록 — SmartSMT 가 보낸 시도(성공·실패). 보내는 쪽 화면에는 HTTP 코드만 뜨므로 원인은 여기서 찾는다.
  fastify.get(
    '/smt/receive-logs',
    { schema: { querystring: AdminSmtReceiveLogQuery, response: { 200: AdminSmtReceiveLogResponse } } },
    async (request) => {
      const q = request.query;
      const where: Prisma.SpSmtReceiveLogWhereInput = q.result === undefined ? {} : { result: q.result };
      const [rows, total] = await Promise.all([
        prisma.spSmtReceiveLog.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.spSmtReceiveLog.count({ where }),
      ]);
      return {
        result: true as const,
        data: {
          items: rows.map((row) => ({
            id: Number(row.id),
            result: row.result,
            reason: row.reason,
            httpStatus: row.httpStatus,
            quoteId: row.quoteId,
            orderId: row.orderId,
            bytes: row.bytes === null ? null : Number(row.bytes),
            durationMs: row.durationMs,
            remoteAddr: row.remoteAddr,
            message: row.message,
            createdAt: row.createdAt.toISOString(),
          })),
          total,
          page: q.page,
          pageSize: q.pageSize,
        },
      };
    },
  );

  // 연동 상태 — 설정 여부와 최근 수신 요약. 공유 비밀의 값은 싣지 않는다(설정됐는지만).
  fastify.get(
    '/smt/link-status',
    { schema: { response: { 200: AdminSmtLinkStatusResponse } } },
    async (_request, reply) => {
      const since = new Date(Date.now() - 86_400_000);
      const [grouped, lastQuote] = await Promise.all([
        prisma.spSmtReceiveLog.groupBy({ by: ['result'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.spSmtQuote.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      ]);
      const countOf = (result: SmartsmtReceiveResult): number =>
        grouped.find((row) => row.result === result)?._count._all ?? 0;
      reply.header('cache-control', 'no-store');
      return {
        result: true as const,
        data: {
          secretConfigured: smartsmtSecret() !== null,
          baseUrl: smartsmtBaseUrl(),
          timeoutMs: smartsmtTimeoutMs(),
          inboundPath: '/api/smartsmt/quotes',
          ssoPath: '/spcb/sso/smartsmt',
          fileServiceType: SMARTSMT_FILE_SERVICE_TYPE,
          lastAcceptedAt: lastQuote?.receivedAt.toISOString() ?? null,
          last24h: {
            accepted: countOf('accepted'),
            duplicate: countOf('duplicate'),
            rejected: countOf('rejected'),
            failed: countOf('failed'),
          },
        },
      };
    },
  );

  done();
};
