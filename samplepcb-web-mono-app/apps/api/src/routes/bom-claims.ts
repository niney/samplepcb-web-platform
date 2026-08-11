import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomClaimCreateRequest,
  BomClaimCreateResponse,
  BomClaimListResponse,
  BOM_CLAIM_ELIGIBILITY_LABELS,
  type BomClaimEligibilityReasonType,
  type BomClaimOrderSnapshotType,
} from '@sp/api-contract';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getOrderInfoByCtId, type OrderInfo } from '../lib/g5-db';
import { filterActiveQuoteItems } from '../lib/bom-quote';
import {
  resolveBomClaimEligibilityReason,
  validateBomClaimItems,
  type BomClaimItemValidationError,
} from '../lib/bom-claim';
import { bomClaimInclude, toBomClaimDto } from '../lib/bom-claim-dto';

const QuoteIdParams = z.object({ quoteId: z.coerce.bigint() });

const CLAIM_ITEM_ERROR_LABELS: Record<BomClaimItemValidationError, string> = {
  DUPLICATE_ITEM: '같은 부품은 한 번만 선택해 주세요.',
  ITEM_NOT_FOUND: '선택한 부품이 현재 견적의 주문 대상에 없습니다.',
  AFFECTED_QTY_EXCEEDS_ORDER: '문제 수량은 주문 수량을 넘을 수 없습니다.',
};

function orderSnapshot(order: OrderInfo): BomClaimOrderSnapshotType {
  return {
    odId: order.odId,
    odStatus: order.odStatus,
    ctStatus: order.rowCtStatus,
    settleCase: order.settleCase,
    receiptPrice: order.receiptPrice,
  };
}

export const bomClaimRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get(
    '/bom/quotes/:quoteId/claims',
    {
      schema: {
        params: QuoteIdParams,
        response: { 200: BomClaimListResponse },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findFirst({
        where: { id: request.params.quoteId, mbId: request.user.mbId },
        select: { id: true, ctId: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      const claims = await prisma.spBomClaim.findMany({
        where: { quoteId: quote.id, mbId: request.user.mbId },
        include: bomClaimInclude,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      });
      const activeClaim = claims.find(
        (claim) => claim.status === 'open' || claim.status === 'reviewing',
      );
      const order = quote.ctId === null ? null : await getOrderInfoByCtId(quote.ctId);
      const reason = resolveBomClaimEligibilityReason({
        ctId: quote.ctId,
        order: order === null ? null : { odStatus: order.odStatus, ctStatus: order.rowCtStatus },
        hasActiveClaim: activeClaim !== undefined,
      });

      return {
        result: true as const,
        data: {
          eligibility: {
            canSubmit: reason === null,
            reason,
            activeClaimId: activeClaim === undefined ? null : String(activeClaim.id),
            order: order === null ? null : orderSnapshot(order),
          },
          claims: claims.map(toBomClaimDto),
        },
      };
    },
  );

  fastify.post(
    '/bom/quotes/:quoteId/claims',
    {
      schema: {
        params: QuoteIdParams,
        body: BomClaimCreateRequest,
        response: { 201: BomClaimCreateResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findFirst({
        where: { id: request.params.quoteId, mbId: request.user.mbId },
        include: { items: true, sheets: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      const activeClaim = await prisma.spBomClaim.findFirst({
        where: { quoteId: quote.id, activeKey: { not: null } },
        select: { id: true },
      });
      const order = quote.ctId === null ? null : await getOrderInfoByCtId(quote.ctId);
      const reason = resolveBomClaimEligibilityReason({
        ctId: quote.ctId,
        order: order === null ? null : { odStatus: order.odStatus, ctStatus: order.rowCtStatus },
        hasActiveClaim: activeClaim !== null,
      });
      if (reason !== null) {
        return reply.status(409).send({
          error: reason,
          message: BOM_CLAIM_ELIGIBILITY_LABELS[reason],
        });
      }
      if (quote.ctId === null || order === null) {
        const fallbackReason: BomClaimEligibilityReasonType = 'ORDER_NOT_FOUND';
        return reply.status(409).send({
          error: fallbackReason,
          message: BOM_CLAIM_ELIGIBILITY_LABELS[fallbackReason],
        });
      }

      const activeItems = filterActiveQuoteItems(quote.items, quote.sheets).filter(
        (item) => item.included && item.orderQty > 0,
      );
      const itemError = validateBomClaimItems(activeItems, request.body.items);
      if (itemError !== null) {
        return reply.status(409).send({ error: itemError, message: CLAIM_ITEM_ERROR_LABELS[itemError] });
      }
      const activeById = new Map(activeItems.map((item) => [String(item.id), item]));
      const activeKey = `bom:${String(quote.id)}:${String(quote.ctId)}`;
      const snapshot = orderSnapshot(order);

      try {
        const claim = await prisma.spBomClaim.create({
          data: {
            quoteId: quote.id,
            quoteTitle: quote.title,
            mbId: quote.mbId,
            odId: order.odId,
            ctId: quote.ctId,
            activeKey,
            kind: request.body.kind,
            subject: request.body.subject,
            description: request.body.description,
            orderSnapshot: snapshot,
            items: {
              create: request.body.items.map((requested) => {
                const item = activeById.get(requested.quoteItemId);
                if (item === undefined) throw new Error('validated claim item disappeared');
                return {
                  quoteItemId: item.id,
                  mpn: item.mpn,
                  manufacturerName: item.manufacturerName,
                  description: item.description,
                  orderedQty: item.orderQty,
                  affectedQty: requested.affectedQty,
                };
              }),
            },
            events: {
              create: {
                action: 'submitted',
                actorRole: 'customer',
                actorMbId: request.user.mbId,
                fromStatus: null,
                toStatus: 'open',
              },
            },
          },
          include: bomClaimInclude,
        });
        return await reply.status(201).send({
          result: true as const,
          data: toBomClaimDto(claim),
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return reply.status(409).send({
            error: 'ACTIVE_CLAIM',
            message: BOM_CLAIM_ELIGIBILITY_LABELS.ACTIVE_CLAIM,
          });
        }
        throw error;
      }
    },
  );

  done();
};
