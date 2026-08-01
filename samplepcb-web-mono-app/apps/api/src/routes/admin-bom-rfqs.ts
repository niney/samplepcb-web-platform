import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomRfqListResponse,
  AdminBomRfqReplyResponse,
  AdminBomRfqSelectionBody,
  AdminBomRfqSelectionResponse,
  AdminBomRfqSendBody,
  AdminBomRfqSendResponse,
  ApiError,
  BomRfqReplyBody,
} from '@sp/api-contract';
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

// ── /api/admin/bom-quotes/:id/rfqs — 협력사 RFQ 발송·현황·대리 입력 ──────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §2.4·§2.5. 발송은 diff(유지분 보존·신규만 메일),
// 대리 입력은 포털 회신과 같은 코어(saveRfqReply)를 쓴다 — 저장 경로 단일.
// 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const RfqParams = z.object({ id: z.coerce.bigint(), rfqId: z.coerce.bigint() });

export const adminBomRfqRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET — RFQ 현황(문서+회신 행) ────────────────────────────────────────────
  fastify.get(
    '/bom-quotes/:id/rfqs',
    { schema: { params: IdParams, response: { 200: AdminBomRfqListResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      return { result: true as const, data: { rfqs: await loadAdminRfqs(quote.id) } };
    },
  );

  // ── POST — diff 발송 ────────────────────────────────────────────────────────
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
      return { result: true as const, data: { rfqs: await loadAdminRfqs(rfq.quoteId) } };
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
      const result = await applyPartnerRfqSelection(
        quote.id,
        BigInt(request.body.itemId),
        request.body.rfqItemId === null ? null : BigInt(request.body.rfqItemId),
        request.user.mbId,
      );
      if (result !== 'ok') {
        return reply.status(409).send({
          error: result.toUpperCase().replaceAll('-', '_'),
          message: '선정에 실패했습니다 — 회신 상태를 새로고침해 주세요.',
        });
      }
      return { result: true as const };
    },
  );

  done();
};
