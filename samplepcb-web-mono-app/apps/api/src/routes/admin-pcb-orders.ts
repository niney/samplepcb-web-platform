import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AdminPcbOrderListQuery, AdminPcbOrderListResponse } from '@sp/api-contract';
import { listPcbOrderSpecs } from '../lib/g5-db';
import { prisma } from '../lib/prisma';

// ── /api/admin/pcb-orders — PCB 주문·결제 워크큐(P3.5) + 고객 배송 큐(P4.6) ──
// SmartBOM 주문·결제와 같은 역할(경리 관점: 입금 대기→진행→완료)이되 구현은 PCB
// 전용. 모수가 이관 주문 2만여 건이라 목록·counts 는 SQL 조인(한정 예외 ⑳)으로
// 서버 페이지네이션하고, 페이지 행만 스펙·발주·입고 수를 enrich 한다. read-only —
// od 상태 변경은 코어 주문 관리 API(admin-orders/status·force-status)의 몫이다.
// to_ship/shipping 탭은 선적·배송 화면의 고객 배송 큐가 쓴다(입고 끝난 주문 발송).

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
      const [specs, adminPos] = await Promise.all([
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
        // 발주 연결 — 관리자 직속 발주만(하위는 MD 경유 실작업 문서라 이중 집계 방지).
        prisma.spPcbPo.findMany({
          where: { specId: { in: specIds }, parentPartnerId: 0n },
          select: { id: true, specId: true },
        }),
      ]);
      const specById = new Map(specs.map((s) => [s.id.toString(), s]));
      const poCountBySpec = new Map<string, number>();
      for (const po of adminPos) {
        const key = po.specId.toString();
        poCountBySpec.set(key, (poCountBySpec.get(key) ?? 0) + 1);
      }
      // 입고확인 수 — 발주서 축으로 선적을 따라간다(묶음 선적의 대표 스펙이 다른 스펙일 수
      // 있어 shipment.specId 판정 금지 — 고객 배송 큐 SQL(PCB_SHIP_JOIN)과 같은 이유).
      const receivedLinks =
        adminPos.length === 0
          ? []
          : await prisma.spPcbShipmentPo.findMany({
              where: {
                poId: { in: adminPos.map((po) => po.id) },
                shipment: { receiverKind: 'admin', receivedAt: { not: null } },
              },
              select: { poId: true },
            });
      const specByPoId = new Map(adminPos.map((po) => [po.id.toString(), po.specId.toString()]));
      const receivedBySpec = new Map<string, number>();
      for (const link of receivedLinks) {
        const key = specByPoId.get(link.poId.toString());
        if (key === undefined) continue;
        receivedBySpec.set(key, (receivedBySpec.get(key) ?? 0) + 1);
      }

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
                receivedPoCount: receivedBySpec.get(String(row.specId)) ?? 0,
                deliveryCompany: row.deliveryCompany,
                invoiceNo: row.invoiceNo,
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
