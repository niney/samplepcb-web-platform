import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomClaimCreateRequest,
  BomClaimCreateResponse,
  BomClaimListResponse,
  BomClaimMineQuery,
  BomClaimMineResponse,
  BOM_CLAIM_ELIGIBILITY_LABELS,
  type BomClaimEligibilityReasonType,
  type BomClaimOrderSnapshotType,
  type BomClaimableRowType,
} from '@sp/api-contract';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getDeliveredCartRowsByMember, getOrderInfoByCtId, type OrderInfo } from '../lib/g5-db';
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

  // ── GET /bom/claims/mine — 견적을 가로지르는 내 문제 접수(마이페이지 /shop/as 부품 탭) ──
  // 소비처는 sp-php `spcb/pages/as.php`. 접수 폼은 /app/bom/:id 한 곳뿐이라 여기선 행을
  // 그리로 보낸다. PCB 의 /pcb-claims/mine 과 모양이 같지만 함수를 나누지 않는다 — 트랙 간
  // 어휘 격리 관례(lib/bom-claim.ts 머리 주석)와 같은 이유다.
  const CLAIMABLE_SCAN_LIMIT = 50;
  const MY_CLAIMS_TAKE = 200;
  const ACTIVE_STATUSES = ['open', 'reviewing'] as const;
  fastify.get(
    '/bom/claims/mine',
    {
      schema: {
        querystring: BomClaimMineQuery,
        response: { 200: BomClaimMineResponse },
      },
    },
    async (request) => {
      const mbId = request.user.mbId;
      const delivered = await getDeliveredCartRowsByMember(mbId, CLAIMABLE_SCAN_LIMIT);
      const quotes =
        delivered.length === 0
          ? []
          : await prisma.spBomQuote.findMany({
              where: { mbId, ctId: { in: delivered.map((r) => r.ctId) } },
              select: { id: true, ctId: true, title: true },
            });
      const activeQuoteIds = new Set(
        (
          await prisma.spBomClaim.findMany({
            where: { mbId, status: { in: [...ACTIVE_STATUSES] } },
            select: { quoteId: true },
          })
        ).map((c) => c.quoteId.toString()),
      );
      const quoteByCt = new Map(quotes.map((q) => [q.ctId, q]));
      const claimable: BomClaimableRowType[] = [];
      for (const row of delivered) {
        const quote = quoteByCt.get(row.ctId);
        if (quote === undefined || quote.ctId === null) continue;
        if (activeQuoteIds.has(quote.id.toString())) continue;
        claimable.push({
          quoteId: String(quote.id),
          ctId: quote.ctId,
          odId: row.odId,
          title: quote.title,
          orderedAt: row.orderedAt,
        });
      }

      const claims = await prisma.spBomClaim.findMany({
        where:
          request.query.scope === 'open'
            ? { mbId, status: { in: [...ACTIVE_STATUSES] } }
            : { mbId },
        include: bomClaimInclude,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: MY_CLAIMS_TAKE,
      });
      return {
        result: true as const,
        data: {
          claimable,
          claimableTruncated: delivered.length >= CLAIMABLE_SCAN_LIMIT,
          claims: claims.map(toBomClaimDto),
          openCount: activeQuoteIds.size,
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
