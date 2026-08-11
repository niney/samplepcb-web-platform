import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbOrderCancelPreviewResponse,
  AdminPcbOrderCancelRequest,
  AdminPcbOrderCancelResponse,
  AdminPcbOrderListQuery,
  AdminPcbOrderListResponse,
  ApiError,
  PCB_ORDER_CANCEL_BLOCK_LABELS,
  resolvePcbDirectShipCountry,
} from '@sp/api-contract';
import {
  getMembersByIds,
  getOrderInfoByCtId,
  listPcbOrderSpecs,
  setOrderItemsStatus,
} from '../lib/g5-db';
import { resolvePcbCustomerName } from '../lib/pcb-customer';
import { isActivePcbOrderLine, resolvePcbOrderCancelPolicy } from '../lib/pcb-order-cancel';
import { prisma } from '../lib/prisma';

// ── /api/admin/pcb-orders — PCB 주문·결제 워크큐(P3.5) + 고객 배송 큐(P4.6) ──
// SmartBOM 주문·결제와 같은 역할(경리 관점: 입금 대기→진행→완료)이되 구현은 PCB
// 전용. 모수가 이관 주문 2만여 건이라 목록·counts 는 SQL 조인(한정 예외 ⑳)으로
// 서버 페이지네이션하고, 페이지 행만 스펙·발주·입고 수를 enrich 한다. read-only —
// od 상태 변경은 코어 주문 관리 API(admin-orders/status·force-status)의 몫이다.
// to_ship/shipping 탭은 선적·배송 화면의 고객 배송 큐가 쓴다(입고 끝난 주문 발송).

const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';

const SpecIdParams = z.object({ specId: z.coerce.number().int().positive() });

async function loadCancelPreview(specId: number) {
  const spec = await prisma.spOrderSpec.findUnique({
    where: { id: BigInt(specId) },
    select: { id: true, projectName: true, status: true, ctId: true },
  });
  if (spec?.status !== 'active' || spec.ctId === null) return null;

  const [order, poCount, rfqCount] = await Promise.all([
    getOrderInfoByCtId(spec.ctId),
    prisma.spPcbPo.count({ where: { specId: spec.id } }),
    prisma.spPcbRfq.count({ where: { specId: spec.id } }),
  ]);
  if (order === null) return null;

  const activeSiblingCount = order.siblingCarts.filter((row) =>
    isActivePcbOrderLine(row.ctStatus),
  ).length;
  const policy = resolvePcbOrderCancelPolicy({
    odStatus: order.odStatus,
    ctStatus: order.rowCtStatus,
    settleCase: order.settleCase,
    receiptPrice: order.receiptPrice,
    hasPgTransaction: order.hasPgTransaction,
    poCount,
  });

  return {
    specId,
    ctId: spec.ctId,
    data: {
      specId,
      projectName: spec.projectName,
      odId: order.odId,
      odStatus: order.odStatus,
      ctStatus: order.rowCtStatus,
      settleCase: order.settleCase,
      receiptPrice: order.receiptPrice,
      poCount,
      rfqCount,
      activeSiblingCount,
      cancelsWholeOrder: activeSiblingCount === 0,
      cancelable: policy.cancelable,
      blockReason: policy.blockReason,
      youngcartOrderUrl: `/adm/shop_admin/orderform.php?od_id=${encodeURIComponent(order.odId)}`,
    },
  };
}

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
          select: { id: true, specId: true, destinationCountry: true },
        }),
      ]);
      // 고객명 fallback — 주문자명(od_name)이 비어 있는 주문(대행 등록 등)은 회원 이름으로
      // 메운다(한정 예외 ⑤ · lib/pcb-customer 단일 사전).
      const members = await getMembersByIds(
        specs.map((s) => s.mbId).filter((id): id is string => id !== null),
      );
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
      const poById = new Map(adminPos.map((po) => [po.id.toString(), po]));
      const receivedBySpec = new Map<string, number>();
      // 직송지(D5) — 판정 근거는 **입고 신호를 만든 그 발주**의 destinationCountry 다
      // (위 receivedLinks 와 같은 축 = 큐 소속 판정 PCB_SHIP_JOIN/PCB_TO_SHIP 과 같은 조인).
      // 이 큐의 종결 대상이 곧 그 발주이기 때문 — '최신 회차 발주' 축으로 보면 원발주가 KR 로
      // 입고 완료된 주문도 뒤에 선 A/S 회차의 직송지에 뒤집혀, 실물이 자사 창고에 있는데
      // 운송장 없이 [직송 완료]로 닫히는 경로가 열렸다(여정 11호 X9). 혼재 처리(보수적으로
      // '직송 아님')는 resolvePcbDirectShipCountry 주석 참조.
      const receivedDestBySpec = new Map<string, (string | null)[]>();
      for (const link of receivedLinks) {
        const po = poById.get(link.poId.toString());
        if (po === undefined) continue;
        const key = po.specId.toString();
        receivedBySpec.set(key, (receivedBySpec.get(key) ?? 0) + 1);
        receivedDestBySpec.set(key, [
          ...(receivedDestBySpec.get(key) ?? []),
          po.destinationCountry,
        ]);
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
                odName: row.odName,
                customerName: resolvePcbCustomerName(
                  row.odName,
                  spec.mbId === null ? '' : members.get(spec.mbId)?.name,
                ),
                qty: spec.qty,
                quoteStatus: asQuoteStatus(spec.quoteStatus),
                finalPrice: spec.finalPrice,
                odId: row.odId,
                odStatus: row.odStatus,
                lineCanceled: row.lineCanceled,
                ctStatus: row.ctStatus,
                isPaid: row.odStatus !== '주문',
                settleCase: row.settleCase,
                receiptPrice: row.receiptPrice,
                misu: row.misu,
                orderedAt: row.orderedAt,
                poCount: poCountBySpec.get(String(row.specId)) ?? 0,
                receivedPoCount: receivedBySpec.get(String(row.specId)) ?? 0,
                directShipCountry: resolvePcbDirectShipCountry(
                  receivedDestBySpec.get(String(row.specId)) ?? [],
                ),
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

  // 취소 미리보기 — 프런트는 결제·발주 상태를 조합하지 않고 서버 판정을 그대로 표시한다.
  fastify.get(
    '/pcb-orders/:specId/cancel-preview',
    {
      schema: {
        params: SpecIdParams,
        response: { 200: AdminPcbOrderCancelPreviewResponse },
      },
    },
    async (request, reply) => {
      const preview = await loadCancelPreview(request.params.specId);
      if (preview === null) return reply.notFound('취소할 PCB 주문을 찾을 수 없습니다');
      return { result: true as const, data: preview.data };
    },
  );

  // 미입금·무통장·발주 전 PCB 카트행 취소. 정책을 다시 읽고 g5 UPDATE에도 동일 조건을
  // 원자 가드해 입금확인과의 레이스에서 결제 주문을 로컬 취소하지 않는다.
  fastify.post(
    '/pcb-orders/:specId/cancel',
    {
      schema: {
        params: SpecIdParams,
        body: AdminPcbOrderCancelRequest,
        response: { 200: AdminPcbOrderCancelResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const preview = await loadCancelPreview(request.params.specId);
      if (preview === null) return reply.notFound('취소할 PCB 주문을 찾을 수 없습니다');
      if (!preview.data.cancelable) {
        const blockReason = preview.data.blockReason ?? 'ORDER_STATE_CHANGED';
        return reply.status(409).send({
          error: blockReason,
          message: PCB_ORDER_CANCEL_BLOCK_LABELS[blockReason],
        });
      }

      const outcome = await setOrderItemsStatus(
        preview.data.odId,
        [preview.ctId],
        '취소',
        request.user.mbId,
        request.ip,
        {
          requireUnpaidBankTransfer: true,
          historyReason: request.body.reason,
        },
      );
      if (!outcome.processed.includes(preview.ctId)) {
        return reply.status(409).send({
          error: 'ORDER_STATE_CHANGED',
          message: PCB_ORDER_CANCEL_BLOCK_LABELS.ORDER_STATE_CHANGED,
        });
      }

      return {
        result: true as const,
        data: {
          specId: preview.specId,
          ctId: preview.ctId,
          odId: preview.data.odId,
          odStatus: outcome.odStatus,
          orderCancelled: outcome.orderCancelled,
        },
      };
    },
  );

  done();
};
