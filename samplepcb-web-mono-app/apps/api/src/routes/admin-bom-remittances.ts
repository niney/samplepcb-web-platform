import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomRemittanceCreateBody,
  AdminBomRemittanceListResponse,
  ApiError,
} from '@sp/api-contract';
import { BOM_PO_ITEM_PROCUREMENT_INCLUDE, bomPoRemittanceSummary } from '../lib/bom-po';
import {
  createBomRemittance,
  listBomRemittanceRows,
  toBomRemittanceView,
} from '../lib/bom-remittance';
import { prisma } from '../lib/prisma';

// ── /api/admin/bom-pos/:poId/remittances — BOM 송금 원장(D48) ─────────────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §6.44. 돈은 은행에서 사람이 보내고 여기는 사실만 적는다.
// 사람 협력사 발주만 — 공급사(DigiKey·Mouser 등) 발주는 공급사 사이트에서 결제한다.
// 전 라우트 requireAdmin.

const PoParams = z.object({ poId: z.coerce.bigint() });
const RowParams = z.object({ poId: z.coerce.bigint(), id: z.coerce.bigint() });

export const adminBomRemittanceRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const loadPo = (poId: bigint) =>
    prisma.spBomPo.findUnique({
      where: { id: poId },
      include: {
        partner: true,
        items: { include: BOM_PO_ITEM_PROCUREMENT_INCLUDE, orderBy: { id: 'asc' } },
      },
    });

  const listData = async (po: NonNullable<Awaited<ReturnType<typeof loadPo>>>) => {
    const rows = await listBomRemittanceRows(po.id);
    const summary = bomPoRemittanceSummary(po, rows);
    if (summary === null) return null;
    return {
      summary,
      bookedRate: po.exchangeRate === null ? null : Number(po.exchangeRate),
      items: rows.map((row) => toBomRemittanceView(row, po)),
    };
  };

  const NOT_PARTNER_PO = {
    error: 'NOT_PARTNER_PO',
    message: '공급사 발주는 공급사 사이트에서 결제합니다 — 송금 기록 대상이 아닙니다.',
  } as const;

  fastify.get(
    '/bom-pos/:poId/remittances',
    { schema: { params: PoParams, response: { 200: AdminBomRemittanceListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPo(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const data = await listData(po);
      if (data === null) return reply.status(409).send(NOT_PARTNER_PO);
      return { result: true as const, data };
    },
  );

  fastify.post(
    '/bom-pos/:poId/remittances',
    {
      schema: {
        params: PoParams,
        body: AdminBomRemittanceCreateBody,
        response: { 200: AdminBomRemittanceListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPo(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.partner.type !== 'partner') return reply.status(409).send(NOT_PARTNER_PO);
      const created = await createBomRemittance(po, request.body, request.user.mbId);
      if (!created.ok) {
        return reply.status(409).send({
          error: created.error,
          message: '환율을 가져오지 못했습니다 — 실제 적용 환율을 직접 입력해 주세요.',
        });
      }
      const data = await listData(po);
      if (data === null) return reply.status(409).send(NOT_PARTNER_PO);
      return { result: true as const, data };
    },
  );

  // 정정은 삭제 뒤 다시 적는다 — 돈 기록을 조용히 고쳐 쓰지 않는다(누가 언제 적었는지가 남는다).
  fastify.delete(
    '/bom-pos/:poId/remittances/:id',
    { schema: { params: RowParams, response: { 200: AdminBomRemittanceListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPo(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const deleted = await prisma.spBomRemittance.deleteMany({
        where: { id: request.params.id, poId: po.id },
      });
      if (deleted.count !== 1) return reply.notFound('송금 기록을 찾을 수 없습니다');
      const data = await listData(po);
      if (data === null) return reply.status(409).send(NOT_PARTNER_PO);
      return { result: true as const, data };
    },
  );

  done();
};
