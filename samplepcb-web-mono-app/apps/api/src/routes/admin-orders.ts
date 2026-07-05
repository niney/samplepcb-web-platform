import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminOrderDetailResponse,
  AdminOrderListQuery,
  AdminOrderListResponse,
} from '@sp/api-contract';
import type {
  AdminOrderCoreType,
  AdminOrderDetailOrderType,
  PcbProjectPayloadType,
} from '@sp/api-contract';
import {
  getCartRowsByOdId,
  getMemberOrderCounts,
  getOrderRow,
  searchOrders,
} from '../lib/g5-db';
import type { OrderDetailRow, OrderListRow } from '../lib/g5-db';
import { buildOptionSummary } from '../lib/option-summary';
import { prisma } from '../lib/prisma';
import { signedThumbUrl } from '../lib/thumb-url';

// ── /api/admin/orders — 관리자 주문내역 (sp-vue /app/admin/orders) ────────────
// 레거시 adm/shop_admin/orderlist.php 를 sp-vue 로 마이그레이션. 이번 WP 는 읽기 경로만
// (목록/상세). 전 라우트가 requireAdmin(JWT isAdmin) 뒤에 있고, 응답은 계약 response
// 스키마로 직렬화되어 미선언 필드(민감 컬럼)가 구조적으로 탈락한다. g5 접근은 lib/g5-db.ts
// 한정 예외 ⑫(read-only SELECT)로만 하고, sp_* 조인은 Prisma 가 소유한다.

const OdIdParams = z.object({ odId: z.string().min(1).max(20) });

// Prisma quoteStatus(string) → 계약 리터럴 유니온 총함수 내로잉(직렬화 실패 방지).
const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';

// 목록/상세 공용 코어 매핑(누적주문수 제외).
const toOrderCore = (row: OrderListRow): AdminOrderCoreType => ({
  odId: row.odId,
  odName: row.odName,
  mbId: row.mbId,
  odTel: row.odTel,
  odHp: row.odHp,
  odBName: row.odBName,
  status: row.status,
  settleCase: row.settleCase,
  orderPrice: row.orderPrice,
  receiptPrice: row.receiptPrice,
  cancelPrice: row.cancelPrice,
  couponPrice: row.couponPrice,
  misu: row.misu,
  cartCount: row.cartCount,
  deliveryCompany: row.deliveryCompany,
  invoiceNo: row.invoiceNo,
  invoiceTime: row.invoiceTime,
  receiptTime: row.receiptTime,
  odTime: row.odTime,
  isMobile: row.isMobile,
  isTest: row.isTest,
});

const toDetailOrder = (row: OrderDetailRow): AdminOrderDetailOrderType => ({
  ...toOrderCore(row),
  email: row.email,
  addr: {
    zip1: row.zip1,
    zip2: row.zip2,
    addr1: row.addr1,
    addr2: row.addr2,
    addr3: row.addr3,
    jibeon: row.addrJibeon,
  },
  receiver: {
    name: row.odBName,
    tel: row.bTel,
    hp: row.bHp,
    zip1: row.bZip1,
    zip2: row.bZip2,
    addr1: row.bAddr1,
    addr2: row.bAddr2,
    addr3: row.bAddr3,
    jibeon: row.bAddrJibeon,
  },
  depositName: row.depositName,
  memo: row.memo,
  shopMemo: row.shopMemo,
  hopeDate: row.hopeDate,
  amounts: {
    sendCost: row.sendCost,
    sendCost2: row.sendCost2,
    sendCoupon: row.sendCoupon,
    cartCoupon: row.cartCoupon,
    coupon: row.coupon,
    refundPrice: row.refundPrice,
    receiptPoint: row.receiptPoint,
    taxMny: row.taxMny,
    vatMny: row.vatMny,
    freeMny: row.freeMny,
  },
  payment: { pg: row.pg, tno: row.tno, appNo: row.appNo },
  ip: row.ip,
});

export const adminOrderRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // 전 라우트 관리자 전용 — 라우트별 preHandler 누락 사고를 원천 차단
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/orders — 주문 목록 ─────────────────────────────────────
  // counts 는 탭 미반영·나머지 필터 반영(배타 집계), total 은 탭 반영(searchOrders 파생).
  // 누적주문수는 페이지 mbId 배치 GROUP BY(스톡의 N+1 서브쿼리 대체).
  fastify.get(
    '/orders',
    {
      schema: {
        querystring: AdminOrderListQuery,
        response: { 200: AdminOrderListResponse },
      },
    },
    async (request) => {
      const q = request.query;
      const { rows, total, counts } = await searchOrders({
        tab: q.tab,
        qField: q.qField,
        q: q.q,
        from: q.from,
        to: q.to,
        settleCase: q.settleCase,
        misu: q.misu,
        cancelled: q.cancelled,
        refund: q.refund,
        point: q.point,
        coupon: q.coupon,
        sort: q.sort,
        order: q.order,
        page: q.page,
        pageSize: q.pageSize,
      });

      const mbIds = rows.map((r) => r.mbId).filter((id) => id !== '');
      const orderCounts = await getMemberOrderCounts(mbIds);

      return {
        result: true as const,
        data: {
          items: rows.map((r) => ({
            ...toOrderCore(r),
            memberOrderCount: r.mbId !== '' ? (orderCounts.get(r.mbId) ?? 0) : 0,
          })),
          total,
          page: q.page,
          pageSize: q.pageSize,
          counts,
        },
      };
    },
  );

  // ── GET /api/admin/orders/:odId — 주문 상세 ───────────────────────────────
  // 헤더 + 카트 라인(ct_id 단위, GROUP BY 없음). 각 라인은 sp_order_spec(ctId 조인)이
  // 있으면 quote(썸네일 서명·사양 요약·확정가)를 채운다. 민감 컬럼은 SELECT 부터 배제.
  fastify.get(
    '/orders/:odId',
    {
      schema: {
        params: OdIdParams,
        response: { 200: AdminOrderDetailResponse },
      },
    },
    async (request, reply) => {
      const order = await getOrderRow(request.params.odId);
      if (order === null) return reply.notFound('주문이 없습니다');

      const cartRows = await getCartRowsByOdId(order.odId);
      const ctIds = cartRows.map((r) => r.ctId);

      // sp_order_spec 배치 조인(ctId) → 각 카트 라인에 견적 메타 매핑
      const specs =
        ctIds.length > 0
          ? await prisma.spOrderSpec.findMany({ where: { ctId: { in: ctIds } } })
          : [];
      const specByCt = new Map<number, (typeof specs)[number]>();
      for (const s of specs) {
        if (s.ctId !== null) specByCt.set(s.ctId, s);
      }

      // 썸네일(fileType='thumbnail') 배치 조회 → refId(spec.id)별 최초 파일 id
      const thumbs =
        specs.length > 0
          ? await prisma.spFile.findMany({
              where: {
                refType: 'sp_order_spec',
                refId: { in: specs.map((s) => s.id) },
                fileType: 'thumbnail',
              },
              orderBy: { id: 'asc' },
              select: { id: true, refId: true },
            })
          : [];
      const thumbByRef = new Map<string, bigint>();
      for (const t of thumbs) {
        if (!thumbByRef.has(t.refId.toString())) thumbByRef.set(t.refId.toString(), t.id);
      }

      const memberOrderCount =
        order.mbId !== ''
          ? ((await getMemberOrderCounts([order.mbId])).get(order.mbId) ?? 0)
          : 0;

      return {
        result: true as const,
        data: {
          order: toDetailOrder(order),
          items: cartRows.map((r) => {
            const spec = specByCt.get(r.ctId);
            const thumbId = spec !== undefined ? thumbByRef.get(spec.id.toString()) : undefined;
            return {
              ctId: r.ctId,
              itId: r.itId,
              itName: r.itName,
              ctOption: r.ctOption,
              ctQty: r.ctQty,
              ctPrice: r.ctPrice,
              ioId: r.ioId,
              ioType: r.ioType,
              ioPrice: r.ioPrice,
              ctStatus: r.ctStatus,
              ctSelect: r.ctSelect,
              quote:
                spec !== undefined
                  ? {
                      projectId: String(spec.id),
                      quoteStatus: asQuoteStatus(spec.quoteStatus),
                      specSummary: buildOptionSummary(
                        spec.specJson as PcbProjectPayloadType['spec'],
                        spec.qty,
                      ),
                      thumbUrl: thumbId !== undefined ? signedThumbUrl(thumbId) : null,
                      finalPrice: spec.finalPrice,
                    }
                  : null,
            };
          }),
          memberOrderCount,
        },
      };
    },
  );

  done();
};
