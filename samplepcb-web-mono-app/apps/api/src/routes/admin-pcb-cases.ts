import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AdminPcbCaseListQuery, AdminPcbCaseListResponse } from '@sp/api-contract';
import { listPcbCaseSpecs } from '../lib/g5-db';
import {
  PCB_EQ_DONE_STATUSES,
  pcbCaseStepOf,
  resolvePcbAsRoundState,
  type PcbTopPoSignal,
} from '../lib/pcb-case-step';
import { prisma } from '../lib/prisma';

// ── /api/admin/pcb-cases — PCB 진행현황 + 역할별 대기 큐 ─────────────────────
// 스펙(견적건) 축 단일 절단면. 구간 탭(quoting/unpaid/production/closed/all)은 총괄
// 조감이고, todo_rfq·todo_po 는 각 워크큐의 "시작 전" 큐다(계약 주석 참조).
// 모수가 이관 견적 2만여 건이라 목록·counts 는 SQL(한정 예외 ⑳)에서 페이지네이션하고,
// 페이지 행만 RFQ·발주·선적으로 enrich 한다. read-only.
// step·구간의 A/S 판정 축은 lib/pcb-case-step — SQL(PCB_AS_OPEN_JOIN)과 같은 규칙의
// JS 면이다(행 배지·step 은 여기, 탭 소속·counts 는 SQL 이 계산).

const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';

export const adminPcbCaseRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get(
    '/pcb-cases',
    {
      schema: {
        querystring: AdminPcbCaseListQuery,
        response: { 200: AdminPcbCaseListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab } = request.query;
      const { rows, total, counts } = await listPcbCaseSpecs({
        tab,
        q: request.query.q ?? '',
        page,
        pageSize,
      });

      const specIds = rows.map((row) => BigInt(row.specId));
      const [specs, rfqRows, poRows, shipments] = await Promise.all([
        prisma.spOrderSpec.findMany({
          where: { id: { in: specIds } },
          select: {
            id: true,
            projectName: true,
            mbId: true,
            category: true,
            qty: true,
            quoteStatus: true,
            finalPrice: true,
            createdAt: true,
          },
        }),
        // 회신 판정은 respondedAt — unselected 는 미회신 탈락도 포함하므로 status 로 세지 않는다.
        prisma.spPcbRfq.findMany({
          where: { specId: { in: specIds }, parentPartnerId: 0n },
          select: { specId: true, status: true, respondedAt: true },
        }),
        prisma.spPcbPo.findMany({
          where: { specId: { in: specIds }, parentPartnerId: 0n },
          select: { id: true, specId: true, status: true, reorderRound: true },
        }),
        prisma.spPcbShipment.findMany({
          where: { specId: { in: specIds } },
          select: { specId: true },
        }),
      ]);

      // 발주별 발송 신호(A/S 축) — 링크는 발주당 1건(@unique poId), 관리자 수신만 신호다
      // (MD 하위 입고는 다른 축 — pcb-customer-progress 와 같은 해석).
      const shipmentByPoId = new Map<string, { status: string; receivedAt: Date | null }>();
      if (poRows.length > 0) {
        const links = await prisma.spPcbShipmentPo.findMany({
          where: { poId: { in: poRows.map((po) => po.id) } },
          select: {
            poId: true,
            shipment: { select: { status: true, receivedAt: true, receiverKind: true } },
          },
        });
        for (const link of links) {
          if (link.shipment.receiverKind !== 'admin') continue;
          shipmentByPoId.set(link.poId.toString(), {
            status: link.shipment.status,
            receivedAt: link.shipment.receivedAt,
          });
        }
      }

      const specById = new Map(specs.map((s) => [s.id.toString(), s]));
      const rfqBySpec = new Map<string, { total: number; quoted: number; selected: boolean }>();
      for (const row of rfqRows) {
        const key = row.specId.toString();
        const agg = rfqBySpec.get(key) ?? { total: 0, quoted: 0, selected: false };
        agg.total += 1;
        if (row.respondedAt !== null) agg.quoted += 1;
        if (row.status === 'selected') agg.selected = true;
        rfqBySpec.set(key, agg);
      }
      const poBySpec = new Map<string, { count: number; eqDone: boolean; produced: boolean }>();
      const topPosBySpec = new Map<string, PcbTopPoSignal[]>();
      for (const row of poRows) {
        const key = row.specId.toString();
        const agg = poBySpec.get(key) ?? { count: 0, eqDone: false, produced: false };
        agg.count += 1;
        if (PCB_EQ_DONE_STATUSES.has(row.status)) agg.eqDone = true;
        if (row.status === 'produced') agg.produced = true;
        poBySpec.set(key, agg);
        const signals = topPosBySpec.get(key) ?? [];
        signals.push({
          reorderRound: row.reorderRound,
          status: row.status,
          shipment: shipmentByPoId.get(row.id.toString()) ?? null,
        });
        topPosBySpec.set(key, signals);
      }
      const shippedSpecs = new Set(shipments.map((s) => s.specId.toString()));

      return {
        result: true as const,
        data: {
          items: rows.flatMap((row) => {
            const key = String(row.specId);
            const spec = specById.get(key);
            if (spec === undefined) return []; // 조회 직후 스펙 삭제 등 경합 — 행 생략
            const rfq = rfqBySpec.get(key) ?? { total: 0, quoted: 0, selected: false };
            const po = poBySpec.get(key) ?? { count: 0, eqDone: false, produced: false };
            const hasShipment = shippedSpecs.has(key);
            const cartState: 'none' | 'cart' | 'ordered' =
              row.ctStatus === null ? 'none' : row.ctStatus === '쇼핑' ? 'cart' : 'ordered';
            const isPaid = row.odStatus !== null && row.odStatus !== '주문';
            // A/S 축 — 최상위 발주 최신 회차가 진행 중이면 step 도 그 회차 기준으로 선다.
            const topPos = topPosBySpec.get(key) ?? [];
            const asState = resolvePcbAsRoundState(topPos);
            const roundPos = topPos.filter((p) => p.reorderRound === asState.asRound);
            return [
              {
                specId: row.specId,
                projectName: spec.projectName,
                mbId: spec.mbId,
                category: spec.category,
                qty: spec.qty,
                quoteStatus: asQuoteStatus(spec.quoteStatus),
                finalPrice: spec.finalPrice,
                isLegacy: row.isLegacy,
                cartState,
                odId: row.odId,
                odStatus: row.odStatus,
                isPaid,
                orderedAt: row.orderedAt,
                rfqTotal: rfq.total,
                rfqQuoted: rfq.quoted,
                rfqSelected: rfq.selected,
                poCount: po.count,
                hasShipment,
                asRound: asState.asRound,
                asOpen: asState.asOpen,
                step: pcbCaseStepOf(
                  {
                    rfqTotal: rfq.total,
                    rfqQuoted: rfq.quoted,
                    rfqSelected: rfq.selected,
                    finalPrice: spec.finalPrice,
                    cartState,
                    isPaid,
                    poCount: po.count,
                    eqDone: po.eqDone,
                    produced: po.produced,
                    hasShipment,
                    odStatus: row.odStatus,
                  },
                  asState,
                  roundPos,
                ),
                createdAt: spec.createdAt.toISOString(),
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
