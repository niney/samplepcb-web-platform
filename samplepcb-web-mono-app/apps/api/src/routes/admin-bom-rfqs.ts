import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ADMIN_BOM_LIVE_SUPPLIERS,
  AdminBomRfqListResponse,
  AdminBomQuotePartnerStockResponse,
  AdminBomRfqReplyResponse,
  AdminBomRfqSelectionBody,
  AdminBomRfqSelectionResponse,
  AdminBomRfqSendBody,
  AdminBomRfqSendResponse,
  AdminBomSupplierRefreshResponse,
  ApiError,
  BomRfqReplyBody,
  BomSupplierView,
  type AdminBomSupplierRefreshViewType,
} from '@sp/api-contract';
import { loadQuoteItemPartnerHolders } from '../lib/partner-parts';
import { prisma } from '../lib/prisma';
import {
  applyPartnerRfqSelection,
  diffSendRfqs,
  loadAdminRfqs,
  loadRfqScopeItems,
  reissueMagicToken,
  saveRfqReply,
  toAdminRfqView,
  validateRfqPartners,
} from '../lib/bom-rfq';
import { buildBomRfqRequestEmail, magicReplyUrl, sendBomRfqMail } from '../lib/rfq-email';
import { engineFetch } from '../lib/engine-client';
import {
  applyQuoteCandidateSelection,
  getAdminBomSupplierAttemptSummaries,
  getAdminBomSupplierComparisonRows,
  getAdminBomSupplierRefreshTargets,
} from '../lib/bom-quote';
import { supplierSearchRunPolicyFromOptions } from '../lib/bom-supplier-search-policy';
import { prepareSingleSearchComparisonAnalysis } from '../lib/bom-single-search-comparison';
import { autoEnrichQuote, healEnrichment } from './bom-quotes';

// ── /api/admin/bom-quotes/:id/rfqs — 협력사 RFQ 발송·현황·대리 입력 ──────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §2.4·§2.5. 발송은 diff(유지분 보존·신규만 메일),
// 대리 입력은 포털 회신과 같은 코어(saveRfqReply)를 쓴다 — 저장 경로 단일.
// 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const RfqParams = z.object({ id: z.coerce.bigint(), rfqId: z.coerce.bigint() });

async function adminRfqListData(quoteId: bigint) {
  const [rfqs, supplierTargets] = await Promise.all([
    loadAdminRfqs(quoteId),
    getAdminBomSupplierRefreshTargets(quoteId),
  ]);
  return {
    rfqs,
    supplierComparisonTargetCount: supplierTargets?.length ?? 0,
  };
}

async function adminSupplierRefreshView(
  quoteId: bigint,
): Promise<AdminBomSupplierRefreshViewType | null> {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    select: { activeSupplierSearchRun: true },
  });
  if (quote === null) return null;
  const activeRun = quote.activeSupplierSearchRun;
  const runPolicy = supplierSearchRunPolicyFromOptions(activeRun?.options);
  const run = runPolicy.purpose === 'admin_rfq_compare' ? activeRun : null;
  const status: AdminBomSupplierRefreshViewType['status'] = run === null
    ? 'idle'
    : run.status === 'completed'
      ? 'completed'
      : run.status === 'failed'
        ? 'failed'
        : 'running';
  let progress = status === 'completed' ? 100 : status === 'running' ? 5 : 0;
  let message = status === 'completed'
    ? '공급사 최신 시세 확인 완료'
    : status === 'failed'
      ? '공급사 최신 시세 확인 실패'
      : status === 'running'
        ? '공급사 최신 시세를 확인하고 있습니다'
        : '최신 시세 조회 전';
  if (status === 'running' && run?.engineJobId !== null && run?.engineJobId !== undefined) {
    try {
      const response = await engineFetch(
        `/jobs/${encodeURIComponent(run.engineJobId)}/supplier-search`,
      );
      if (response.ok) {
        const parsed = BomSupplierView.safeParse(await response.json());
        if (parsed.success) {
          progress = Math.min(95, parsed.data.progress);
          message = parsed.data.message;
        }
      }
    } catch {
      // DB 원장 상태로 축퇴. 후속 poll의 heal 경로가 수렴시킨다.
    }
  }
  const rows = await getAdminBomSupplierComparisonRows(quoteId) ?? [];
  return {
    runId: run === null ? null : String(run.id),
    status,
    progress,
    message,
    error: run?.error ?? null,
    selectedItemCount: rows.length,
    suppliers: await getAdminBomSupplierAttemptSummaries(run?.id ?? null, status, rows),
    rows,
  };
}

export const adminBomRfqRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /bom-quotes/:id/partner-stock — 품목 × 보유 협력사 ────────────────
  // "이 행을 누가 갖고 있나" — 견적요청을 누구에게 보낼지 정하는 근거(docs/PARTNER_PARTS.md).
  // 조직 이름이 들어가므로 관리자 전용이다(고객 DTO 는 곳 수·기준일까지만 본다).
  fastify.get(
    '/bom-quotes/:id/partner-stock',
    { schema: { params: IdParams, response: { 200: AdminBomQuotePartnerStockResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      const items = await prisma.spBomQuoteItem.findMany({
        where: { quoteId: quote.id, included: true },
        select: { id: true, mpn: true },
      });
      return { result: true as const, data: await loadQuoteItemPartnerHolders(items) };
    },
  );

  // ── GET — RFQ 현황(문서+회신 행) ────────────────────────────────────────────
  fastify.get(
    '/bom-quotes/:id/rfqs',
    { schema: { params: IdParams, response: { 200: AdminBomRfqListResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      return { result: true as const, data: await adminRfqListData(quote.id) };
    },
  );

  // ── 선정 부품 MPN 3사 강제 최신조회 + 비교 읽기 모델 ────────────────
  fastify.post(
    '/bom-quotes/:id/supplier-offer-refresh',
    {
      schema: {
        params: IdParams,
        response: {
          200: AdminBomSupplierRefreshResponse,
          409: ApiError,
          502: ApiError,
        },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({
        where: { id: request.params.id },
        include: { items: true, sheets: true, activeSupplierSearchRun: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      if (quote.status !== 'requested' && quote.status !== 'reviewing') {
        return reply.status(409).send({
          error: 'INVALID_QUOTE_STATUS',
          message: '회신 확정 전 검토 중 상태에서만 최신 시세를 조회할 수 있습니다.',
        });
      }
      if (quote.buildStatus !== 'ready') {
        return reply.status(409).send({
          error: 'QUOTE_NOT_READY',
          message: 'BOM 계산이 완료된 뒤 최신 시세를 조회해 주세요.',
        });
      }
      const activePolicy = supplierSearchRunPolicyFromOptions(
        quote.activeSupplierSearchRun?.options,
      );
      if (
        quote.activeSupplierSearchRun !== null
        && activePolicy.purpose === 'admin_rfq_compare'
        && ['preparing', 'running'].includes(quote.activeSupplierSearchRun.status)
      ) {
        const data = await adminSupplierRefreshView(quote.id);
        if (data === null) return reply.notFound('견적을 찾을 수 없습니다');
        return { result: true as const, data };
      }
      if (quote.enrichStatus === 'searching') {
        return reply.status(409).send({
          error: 'SUPPLIER_SEARCH_RUNNING',
          message: '진행 중인 공급사 확인이 완료된 뒤 다시 시도해 주세요.',
        });
      }
      let targets = await getAdminBomSupplierRefreshTargets(quote.id) ?? [];
      if (
        quote.sourceKind === 'single_search'
        && targets.some((target) => target.candidateKey === null)
      ) {
        await prepareSingleSearchComparisonAnalysis(quote.id);
        targets = await getAdminBomSupplierRefreshTargets(quote.id) ?? [];
      }
      const componentIds = targets.map((target) => target.componentId);
      if (targets.length === 0) {
        const current = await adminSupplierRefreshView(quote.id);
        if (current === null) return reply.notFound('견적을 찾을 수 없습니다');
        return {
          result: true as const,
          data: {
            ...current,
            runId: null,
            status: 'completed' as const,
            progress: 100,
            message: '최신 시세를 조회할 선정 부품 품번이 없습니다.',
            error: null,
            selectedItemCount: 0,
          },
        };
      }
      const runId = await autoEnrichQuote(quote.id, quote.mbId, request.log, {
        force: true,
        componentIds,
        identityOverrides: targets.map((target) => ({
          componentId: target.componentId,
          partNumber: target.partNumber,
          manufacturer: target.manufacturer,
        })),
        bypassLocalCatalog: true,
        forceLive: true,
        purpose: 'admin_rfq_compare',
        allowedStatuses: ['requested', 'reviewing'],
        enforceMemberDailyLimit: false,
        ...(quote.sourceKind === 'single_search' ? { analysisSheetIndexes: [0] } : {}),
      });
      if (runId === null) {
        return reply.status(502).send({
          error: 'SUPPLIER_REFRESH_NOT_STARTED',
          message: '공급사 최신 시세 조회를 시작하지 못했습니다.',
        });
      }
      const data = await adminSupplierRefreshView(quote.id);
      if (data === null) return reply.notFound('견적을 찾을 수 없습니다');
      return {
        result: true as const,
        data: { ...data, runId: String(runId), selectedItemCount: targets.length },
      };
    },
  );

  fastify.get(
    '/bom-quotes/:id/supplier-offer-refresh',
    {
      schema: {
        params: IdParams,
        response: { 200: AdminBomSupplierRefreshResponse },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({
        where: { id: request.params.id },
        select: { id: true, mbId: true, activeSupplierSearchRun: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      const policy = supplierSearchRunPolicyFromOptions(
        quote.activeSupplierSearchRun?.options,
      );
      if (
        quote.activeSupplierSearchRun !== null
        && policy.purpose === 'admin_rfq_compare'
        && ['preparing', 'running'].includes(quote.activeSupplierSearchRun.status)
      ) {
        void healEnrichment(quote.id, quote.mbId, request.log).catch((error: unknown) => {
          request.log.warn(
            { quoteId: String(quote.id), err: String(error) },
            '관리자 공급사 최신조회 치유 실패',
          );
        });
      }
      const data = await adminSupplierRefreshView(quote.id);
      if (data === null) return reply.notFound('견적을 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  // ── POST — RFQ diff 발송 ─────────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/rfqs',
    {
      schema: {
        params: IdParams,
        body: AdminBomRfqSendBody,
        response: { 200: AdminBomRfqSendResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      if (quote.status !== 'requested' && quote.status !== 'reviewing') {
        return reply.status(409).send({
          error: 'INVALID_QUOTE_STATUS',
          message: '검토 중(또는 견적요청) 상태에서만 협력사 견적요청을 보낼 수 있습니다.',
        });
      }

      const { error } = await validateRfqPartners(request.body.partnerIds);
      if (error !== null) {
        return reply.status(400).send({ error: 'INVALID_PARTNER', message: error });
      }

      // 부분 행 선택(§6.13) — 요청 행은 scope 안에서만. 전체 선택은 null(=전체 파생)로
      // 정규화해 "행이 나중에 추가되면 자동 포함"이라는 전체 발송의 성질을 유지한다.
      const scope = await loadRfqScopeItems(quote.id);
      let requestedItemIds: string[] | null = null;
      if (request.body.itemIds !== undefined) {
        const scopeIds = new Set(scope.map((item) => String(item.id)));
        const outside = request.body.itemIds.find((id) => !scopeIds.has(id));
        if (outside !== undefined) {
          return reply.status(400).send({
            error: 'ITEM_OUT_OF_SCOPE',
            message: '요청 범위에 없는 부품행이 포함되어 있습니다.',
          });
        }
        const unique = [...new Set(request.body.itemIds)];
        requestedItemIds = unique.length === scope.length ? null : unique;
      }

      const diff = await diffSendRfqs(quote.id, request.body.partnerIds, requestedItemIds);

      // 알림 메일 — 신규 발송분만, 비차단(실패는 로그). 주 CTA = 매직링크(§6.9).
      if (diff.addedPartners.length > 0) {
        const mailItemCount = requestedItemIds === null ? scope.length : requestedItemIds.length;
        for (const partner of diff.addedPartners) {
          const token = diff.addedTokens.get(partner.id.toString());
          void sendBomRfqMail(
            request.log,
            partner.contactEmail,
            buildBomRfqRequestEmail({
              partnerName: partner.name,
              quoteTitle: quote.title,
              itemCount: mailItemCount,
              magicUrl: token === undefined ? null : magicReplyUrl(token),
            }),
            {
              kind: 'bom_rfq_request',
              refType: 'bom_quote',
              refId: quote.id,
              sentBy: request.user.mbId,
              params: { partnerId: String(partner.id), partnerName: partner.name },
            },
          );
        }
      }

      return {
        result: true as const,
        data: {
          added: diff.added,
          kept: diff.kept,
          removed: diff.removed,
          rfqs: await loadAdminRfqs(quote.id),
        },
      };
    },
  );

  // ── PUT — 관리자 대리 입력(전화·메일 회신의 기록) ───────────────────────────
  fastify.put(
    '/bom-quotes/:id/rfqs/:rfqId/reply',
    {
      schema: {
        params: RfqParams,
        body: BomRfqReplyBody,
        response: { 200: AdminBomRfqReplyResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const rfq = await prisma.spBomRfq.findUnique({ where: { id: request.params.rfqId } });
      if (rfq === null) return reply.notFound('RFQ 를 찾을 수 없습니다');
      if (rfq.quoteId !== request.params.id) {
        return reply.notFound('RFQ 를 찾을 수 없습니다');
      }
      const saved = await saveRfqReply(rfq.id, request.body);
      if (!saved.ok) {
        if (saved.error === 'RFQ_CLOSED') {
          return reply
            .status(409)
            .send({ error: saved.error, message: '마감된 RFQ 에는 회신을 저장할 수 없습니다.' });
        }
        return reply
          .status(400)
          .send({ error: saved.error, message: '요청 범위에 없는 부품행이 포함되어 있습니다.' });
      }
      const updated = await prisma.spBomRfq.findUnique({
        where: { id: rfq.id },
        include: { partner: true, items: { orderBy: { id: 'asc' } } },
      });
      if (updated === null) return reply.notFound('RFQ 를 찾을 수 없습니다');
      return { result: true as const, data: toAdminRfqView(updated) };
    },
  );

  // ── POST — 매직링크 재발급(§6.9) — 구 토큰 즉시 무효(유출 회수·소급 발급 공용) ──
  fastify.post(
    '/bom-quotes/:id/rfqs/:rfqId/magic-link',
    { schema: { params: RfqParams, response: { 200: AdminBomRfqListResponse } } },
    async (request, reply) => {
      const rfq = await prisma.spBomRfq.findUnique({ where: { id: request.params.rfqId } });
      if (rfq === null) return reply.notFound('RFQ 를 찾을 수 없습니다');
      if (rfq.quoteId !== request.params.id) {
        return reply.notFound('RFQ 를 찾을 수 없습니다');
      }
      await reissueMagicToken(rfq.id);
      return { result: true as const, data: await adminRfqListData(rfq.quoteId) };
    },
  );

  // ── POST — 행별 협력사 회신 선정/해제(스냅샷 박제 + 서버 재계산) ────────────
  fastify.post(
    '/bom-quotes/:id/rfq-selection',
    {
      schema: {
        params: IdParams,
        body: AdminBomRfqSelectionBody,
        response: { 200: AdminBomRfqSelectionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      if (quote.status !== 'requested' && quote.status !== 'reviewing') {
        return reply.status(409).send({
          error: 'INVALID_QUOTE_STATUS',
          message: '회신 확정 전(검토 중)에만 선정을 변경할 수 있습니다.',
        });
      }
      if (request.body.kind === 'supplier' && quote.enrichStatus === 'searching') {
        return reply.status(409).send({
          error: 'SUPPLIER_REFRESH_RUNNING',
          message: '공급사 최신 시세 확인이 완료된 뒤 선정해 주세요.',
        });
      }
      if (request.body.kind === 'partner') {
        const partnerResult = await applyPartnerRfqSelection(
          quote.id,
          BigInt(request.body.itemId),
          request.body.rfqItemId === null ? null : BigInt(request.body.rfqItemId),
          request.user.mbId,
        );
        if (partnerResult !== 'ok') {
          return reply.status(409).send({
            error: partnerResult.toUpperCase().replaceAll('-', '_'),
            message: '선정에 실패했습니다 — 회신과 공급사 시세를 새로고침해 주세요.',
          });
        }
        return { result: true as const };
      }
      const supplierBody = request.body;
      const supplierResult = await prisma.$transaction(async (tx) => {
        const selectionResult = await applyQuoteCandidateSelection(
          quote.id,
          BigInt(supplierBody.itemId),
          supplierBody.candidateKey,
          supplierBody.offerKey,
          request.user.mbId,
          {
            source: 'admin',
            requireCurrentSelection: true,
            allowedSuppliers: ADMIN_BOM_LIVE_SUPPLIERS,
            transaction: tx,
          },
        );
        if (selectionResult === 'ok') {
          await tx.spBomQuoteItem.updateMany({
            where: { id: BigInt(supplierBody.itemId), quoteId: quote.id },
            data: { selectedRfqItemId: null },
          });
        }
        return selectionResult;
      }, { maxWait: 10_000, timeout: 60_000 });
      if (supplierResult !== 'ok') {
        return reply.status(409).send({
          error: supplierResult.toUpperCase().replaceAll('-', '_'),
          message: '선정에 실패했습니다 — 회신과 공급사 시세를 새로고침해 주세요.',
        });
      }
      return { result: true as const };
    },
  );

  done();
};
