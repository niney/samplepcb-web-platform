import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AdminPcbOrderListQuery, AdminPcbOrderListResponse } from '@sp/api-contract';
import { listPcbOrderSpecs } from '../lib/g5-db';
import { prisma } from '../lib/prisma';

// ── /api/admin/pcb-orders — PCB 주문·결제 워크큐(P3.5) ───────────────────────
// SmartBOM 주문·결제와 같은 역할(경리 관점: 입금 대기→진행→완료)이되 구현은 PCB
// 전용. 모수가 이관 주문 2만여 건이라 목록·counts 는 SQL 조인(한정 예외 ⑳)으로
// 서버 페이지네이션하고, 페이지 행만 스펙·발주 수를 enrich 한다. read-only —
// od 상태 변경은 코어 주문 관리(/adm·admin-orders)의 몫이다.

const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';

export const adminPcbOrderRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get(
    '/pcb-orders',
    {
      schema: {
        querystring: AdminPcbOrderListQuery,
        response: { 200: AdminPcbOrderListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab } = request.query;
      const { rows, total, counts } = await listPcbOrderSpecs({
        tab,
        q: request.query.q ?? '',
        page,
        pageSize,
      });

      const specIds = rows.map((row) => BigInt(row.specId));
      const [specs, poGroups] = await Promise.all([
        prisma.spOrderSpec.findMany({
          where: { id: { in: specIds } },
          select: {
            id: true,
            projectName: true,
            mbId: true,
            qty: true,
            quoteStatus: true,
            finalPrice: true,
          },
        }),
        // 발주 연결 수 — 관리자 직속 발주만(하위는 MD 경유 실작업 문서라 이중 집계 방지).
        prisma.spPcbPo.groupBy({
          by: ['specId'],
          where: { specId: { in: specIds }, parentPartnerId: 0n },
          _count: { _all: true },
        }),
      ]);
      const specById = new Map(specs.map((s) => [s.id.toString(), s]));
      const poCountBySpec = new Map(poGroups.map((g) => [g.specId.toString(), g._count._all]));

      return {
        result: true as const,
        data: {
          items: rows.flatMap((row) => {
            const spec = specById.get(String(row.specId));
            if (spec === undefined) return []; // 조인 직후 스펙 삭제 등 경합 — 행 생략
            return [
              {
                specId: row.specId,
                projectName: spec.projectName,
                mbId: spec.mbId,
                qty: spec.qty,
                quoteStatus: asQuoteStatus(spec.quoteStatus),
                finalPrice: spec.finalPrice,
                odId: row.odId,
                odStatus: row.odStatus,
                isPaid: row.odStatus !== '주문',
                settleCase: row.settleCase,
                receiptPrice: row.receiptPrice,
                orderedAt: row.orderedAt,
                poCount: poCountBySpec.get(String(row.specId)) ?? 0,
              },
            ];
          }),
          total,
          page,
          pageSize,
          counts,
        },
      };
    },
  );

  done();
};
