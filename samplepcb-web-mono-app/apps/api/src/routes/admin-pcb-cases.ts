import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AdminPcbCaseListQuery, AdminPcbCaseListResponse } from '@sp/api-contract';
import { listPcbCaseSpecs } from '../lib/g5-db';
import { prisma } from '../lib/prisma';

// ── /api/admin/pcb-cases — PCB 진행현황 + 역할별 대기 큐 ─────────────────────
// 스펙(견적건) 축 단일 절단면. 구간 탭(quoting/unpaid/production/closed/all)은 총괄
// 조감이고, todo_rfq·todo_po 는 각 워크큐의 "시작 전" 큐다(계약 주석 참조).
// 모수가 이관 견적 2만여 건이라 목록·counts 는 SQL(한정 예외 ⑳)에서 페이지네이션하고,
// 페이지 행만 RFQ·발주·선적으로 enrich 한다. read-only.

const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';

// EQ 승인 이후로 본다 — issued·eq_requested 는 아직 ⑧발주 단계.
const EQ_DONE_STATUSES = new Set(['eq_done', 'producing', 'produced']);

interface StepInput {
  rfqTotal: number;
  rfqQuoted: number;
  rfqSelected: boolean;
  finalPrice: number | null;
  cartState: 'none' | 'cart' | 'ordered';
  isPaid: boolean;
  poCount: number;
  eqDone: boolean;
  produced: boolean;
  hasShipment: boolean;
  odStatus: string | null;
}

/** 파생 단계(1~12) — 저장 상태가 아니라 표시 타임라인. 도달한 최대 단계를 쓴다. */
const pcbStepOf = (input: StepInput): number => {
  if (input.odStatus === '배송' || input.odStatus === '완료') return 12;
  if (input.hasShipment) return 11;
  if (input.produced) return 10;
  if (input.eqDone) return 9;
  if (input.poCount > 0) return 8;
  if (input.isPaid) return 7;
  if (input.cartState === 'ordered') return 6;
  if (input.finalPrice !== null) return 5;
  if (input.rfqSelected) return 4;
  if (input.rfqQuoted > 0) return 3;
  if (input.rfqTotal > 0) return 2;
  return 1;
};

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
          select: { specId: true, status: true },
        }),
        prisma.spPcbShipment.findMany({
          where: { specId: { in: specIds } },
          select: { specId: true },
        }),
      ]);

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
      for (const row of poRows) {
        const key = row.specId.toString();
        const agg = poBySpec.get(key) ?? { count: 0, eqDone: false, produced: false };
        agg.count += 1;
        if (EQ_DONE_STATUSES.has(row.status)) agg.eqDone = true;
        if (row.status === 'produced') agg.produced = true;
        poBySpec.set(key, agg);
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
                step: pcbStepOf({
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
                }),
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
