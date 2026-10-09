import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomRfqReplyBody,
  PartnerRfqChildrenResponse,
  PartnerRfqChildrenSendBody,
  PartnerRfqChildrenSendResponse,
  PartnerRfqDetailResponse,
  PartnerRfqListResponse,
} from '@sp/api-contract';
import { loadOwnStockForItems } from '../lib/partner-parts';
import { prisma } from '../lib/prisma';
import {
  filterScopeForRfq,
  loadRfqScopeItems,
  saveRfqReply,
  toPartnerDetail,
  toPartnerListItem,
} from '../lib/bom-rfq';
import {
  loadPartnerRfqChildrenData,
  loadPartnerRfqListContexts,
  loadPartnerRfqMdContext,
  sendMdChildRfqs,
} from '../lib/bom-rfq-md';
import { buildBomRfqRequestEmail, magicReplyUrl, sendBomRfqMail } from '../lib/rfq-email';

// ── /api/partner/rfqs — 협력사 포털(받은 견적요청 워크큐·회신) ────────────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §4. requirePartner 가 매 요청 소속을 서버 판정.
// 노출은 부품행(MPN·제조사·수량)과 자신의 회신뿐 — 고객 식별정보·목표단가는
// 계약 스키마에 없어 구조적으로 탈락한다(D8). 재회신은 마감(closed) 전까지 허용.
// 마스터딜러는 받은 견적요청을 하위에 재요청하고(…/children) 품목마다 하위 회신을 골라 마진을
// 얹어 회신한다 — 회신 저장은 일반 협력사와 같은 PUT 하나다(저장 경로 단일).

const REPLY_ERRORS: Record<string, { status: 400 | 409; message: string }> = {
  RFQ_CLOSED: { status: 409, message: '마감된 견적요청에는 회신할 수 없습니다.' },
  ITEM_OUT_OF_SCOPE: { status: 400, message: '요청 범위에 없는 부품행이 포함되어 있습니다.' },
  CHILD_SELECTION_NOT_ALLOWED: {
    status: 400,
    message: '이 견적요청에서는 하위 협력사 회신을 고를 수 없습니다.',
  },
  CHILD_NOT_FOUND: { status: 400, message: '내가 보낸 하위 견적요청이 아닙니다.' },
  CHILD_NOT_PRICED: { status: 409, message: '단가를 회신한 하위 견적만 고를 수 있습니다.' },
  MARGIN_REQUIRED: { status: 400, message: '마진율(%)을 입력해 주세요.' },
  EXCHANGE_RATE_UNAVAILABLE: {
    status: 409,
    message: '환율 정보가 준비되지 않았습니다 — 관리자에게 문의해 주세요.',
  },
};

const RfqIdParams = z.object({ rfqId: z.coerce.bigint() });

export const partnerRfqRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  // ── GET /api/partner/rfqs — 워크큐(회신할 것/회신한 것은 클라 분리) ────────
  fastify.get(
    '/partner/rfqs',
    { schema: { response: { 200: PartnerRfqListResponse } } },
    async (request) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfqs = await prisma.spBomRfq.findMany({
        where: { partnerId: ctx.partnerId },
        include: { items: true, quote: { select: { title: true } } },
        orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      });
      const contexts = await loadPartnerRfqListContexts(ctx.partnerId, rfqs);
      const items = await Promise.all(
        rfqs.map(async (rfq) => {
          // 부분 행 선택(§6.13) — 협력사가 보는 품목 수 = 자기 요청 범위만
          const scope = filterScopeForRfq(await loadRfqScopeItems(rfq.quoteId), rfq);
          return toPartnerListItem(rfq, scope.length, contexts.get(rfq.id.toString()));
        }),
      );
      return { result: true as const, data: { items, partnerName: ctx.partnerName } };
    },
  );

  // ── GET /api/partner/rfqs/:rfqId — 상세(부품행 + 내 회신) ──────────────────
  fastify.get(
    '/partner/rfqs/:rfqId',
    { schema: { params: RfqIdParams, response: { 200: PartnerRfqDetailResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfq = await prisma.spBomRfq.findUnique({
        where: { id: request.params.rfqId },
        include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
      });
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      if (rfq.partnerId !== ctx.partnerId) {
        return reply.notFound('견적요청을 찾을 수 없습니다');
      }
      const scope = filterScopeForRfq(await loadRfqScopeItems(rfq.quoteId), rfq);
      return {
        result: true as const,
        data: toPartnerDetail(
          rfq,
          scope,
          await loadOwnStockForItems(rfq.partnerId, scope),
          await loadPartnerRfqMdContext(rfq),
        ),
      };
    },
  );

  // ── PUT /api/partner/rfqs/:rfqId — 회신 저장(행 일괄 replace-all) ──────────
  fastify.put(
    '/partner/rfqs/:rfqId',
    {
      schema: {
        params: RfqIdParams,
        body: BomRfqReplyBody,
        response: { 200: PartnerRfqDetailResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfq = await prisma.spBomRfq.findUnique({ where: { id: request.params.rfqId } });
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      if (rfq.partnerId !== ctx.partnerId) {
        return reply.notFound('견적요청을 찾을 수 없습니다');
      }
      const saved = await saveRfqReply(rfq.id, request.body, { allowChildSelection: true });
      if (!saved.ok) {
        const mapped = REPLY_ERRORS[saved.error] ?? {
          status: 400 as const,
          message: '회신을 저장하지 못했습니다.',
        };
        return reply.status(mapped.status).send({ error: saved.error, message: mapped.message });
      }
      const updated = await prisma.spBomRfq.findUnique({
        where: { id: rfq.id },
        include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
      });
      if (updated === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      const scope = filterScopeForRfq(await loadRfqScopeItems(updated.quoteId), updated);
      return {
        result: true as const,
        data: toPartnerDetail(
          updated,
          scope,
          await loadOwnStockForItems(updated.partnerId, scope),
          await loadPartnerRfqMdContext(updated),
        ),
      };
    },
  );

  // ── GET — 마스터딜러: 내 하위 후보 + 내가 보낸 재요청·회신 ───────────────────
  fastify.get(
    '/partner/rfqs/:rfqId/children',
    { schema: { params: RfqIdParams, response: { 200: PartnerRfqChildrenResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfq = await prisma.spBomRfq.findUnique({ where: { id: request.params.rfqId } });
      // 하위로서 받은 건(parent≠0)에는 이 화면이 없다 — 2단 제한.
      if (rfq?.partnerId !== ctx.partnerId || rfq.parentPartnerId !== 0n) {
        return reply.notFound('견적요청을 찾을 수 없습니다');
      }
      return { result: true as const, data: await loadPartnerRfqChildrenData(rfq) };
    },
  );

  // ── POST — 마스터딜러: 하위 재요청 diff 발송(내 하위만·신규만 메일) ───────────
  fastify.post(
    '/partner/rfqs/:rfqId/children',
    {
      schema: {
        params: RfqIdParams,
        body: PartnerRfqChildrenSendBody,
        response: { 200: PartnerRfqChildrenSendResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfq = await prisma.spBomRfq.findUnique({
        where: { id: request.params.rfqId },
        include: { quote: { select: { title: true } } },
      });
      if (rfq?.partnerId !== ctx.partnerId) {
        return reply.notFound('견적요청을 찾을 수 없습니다');
      }
      const sent = await sendMdChildRfqs(rfq, request.body.partnerIds, request.body.requestedItemIds);
      if (!sent.ok) {
        if (sent.error === 'NOT_FAN_OUT') return reply.notFound('견적요청을 찾을 수 없습니다');
        if (sent.error === 'RFQ_CLOSED') {
          return reply
            .status(409)
            .send({ error: sent.error, message: '마감된 견적요청은 하위에 다시 보낼 수 없습니다.' });
        }
        return reply.status(400).send({
          error: sent.error,
          message:
            sent.error === 'NOT_MY_CHILD'
              ? '소속되지 않았거나 부품 조달 트랙이 아닌 하위 협력사가 포함되어 있습니다.'
              : '내가 받은 범위에 없는 부품행이 포함되어 있습니다.',
        });
      }

      // 알림 메일 — 신규 발송분만, 비차단. 하위는 계정이 없는 경우가 많아 매직링크가 주 동선이다.
      for (const partner of sent.diff.addedPartners) {
        const token = sent.diff.addedTokens.get(partner.id.toString());
        void sendBomRfqMail(
          request.log,
          partner.contactEmail,
          buildBomRfqRequestEmail({
            partnerName: partner.name,
            quoteTitle: rfq.quote.title,
            itemCount: sent.itemCount,
            magicUrl: token === undefined ? null : magicReplyUrl(token),
            requesterName: ctx.partnerName,
          }),
          {
            kind: 'bom_rfq_request',
            refType: 'bom_quote',
            refId: rfq.quoteId,
            sentBy: request.user.mbId,
            params: {
              partnerId: String(partner.id),
              partnerName: partner.name,
              mdTrack: true,
              parentPartnerId: String(ctx.partnerId),
            },
          },
        );
      }

      return {
        result: true as const,
        data: {
          ...(await loadPartnerRfqChildrenData(rfq)),
          added: sent.diff.added,
          kept: sent.diff.kept,
          removed: sent.diff.removed,
        },
      };
    },
  );

  done();
};
