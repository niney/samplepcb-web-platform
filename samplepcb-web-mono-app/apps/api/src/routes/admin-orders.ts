import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminOrderActionResponse,
  AdminOrderDeleteRequest,
  AdminOrderDetailResponse,
  AdminOrderEditResponse,
  AdminOrderInfoBody,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AdminOrderMemoBody,
  AdminOrderPrintResponse,
  AdminOrderReceiptBody,
  AdminOrderStatusRequest,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminOrderCartItemType,
  AdminOrderCoreType,
  AdminOrderDetailOrderType,
  PcbProjectPayloadType,
} from '@sp/api-contract';
import {
  deleteOrders,
  getCartRowsByOdId,
  getDeliveryExcelRows,
  getMemberOrderCounts,
  getOrderRow,
  getShopEstimateProfile,
  matchDeliveryRows,
  searchOrders,
  setOrdersComplete,
  setOrdersDelivery,
  setOrdersPreparing,
  setOrdersReceipt,
  updateOrderInfo,
  updateOrderReceipt,
  updateOrderShopMemo,
} from '../lib/g5-db';
import type { OrderActionResult, OrderDetailRow, OrderListRow } from '../lib/g5-db';
import {
  buildDeliveryWorkbook,
  extractDeliveryRowsFromMatrix,
  readDeliverySheet,
} from '../lib/delivery-excel';
import { kstDateTimeStr, kstTodayYmd } from '../lib/kst';
import { orderInfoBodyToFields } from '../lib/order-edit';
import { buildOptionSummary } from '../lib/option-summary';
import { notifyOrderEvent } from '../lib/php-bridge';
import type { NotifyStatus } from '../lib/php-bridge';
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

// 주문의 카트 라인 조립(상세·인쇄 공용) — ct_id 단위 카트행 + sp_order_spec(ctId 조인) 견적 메타
// (썸네일 서명·사양 요약·확정가). Prisma 배치 조회(sp_order_spec·sp_file)로 N+1 방지.
async function buildOrderItems(odId: string): Promise<AdminOrderCartItemType[]> {
  const cartRows = await getCartRowsByOdId(odId);
  const ctIds = cartRows.map((r) => r.ctId);

  const specs =
    ctIds.length > 0
      ? await prisma.spOrderSpec.findMany({ where: { ctId: { in: ctIds } } })
      : [];
  const specByCt = new Map<number, (typeof specs)[number]>();
  for (const s of specs) {
    if (s.ctId !== null) specByCt.set(s.ctId, s);
  }

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

  return cartRows.map((r) => {
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
  });
}

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

      const items = await buildOrderItems(order.odId);
      const memberOrderCount =
        order.mbId !== ''
          ? ((await getMemberOrderCounts([order.mbId])).get(order.mbId) ?? 0)
          : 0;

      return {
        result: true as const,
        data: {
          order: toDetailOrder(order),
          items,
          memberOrderCount,
        },
      };
    },
  );

  // ── PATCH /api/admin/orders/status — 일괄 상태 전이 ────────────────────────
  // 레거시 orderlistupdate.php 이식. target 별 g5-db 전이 함수 → 성공 건에 한해 PHP 알림 브리지
  // (메일/SMS). 전이는 od 단위 독립(processed/skipped). **알림 실패는 전이를 실패로 만들지 않는다**.
  // 코어는 입금·배송 전이에서만 알림을 보내므로 준비·완료는 브리지를 호출하지 않는다(notify=[]).
  fastify.patch(
    '/orders/status',
    {
      schema: {
        body: AdminOrderStatusRequest,
        response: { 200: AdminOrderActionResponse },
      },
    },
    async (request) => {
      const { target, odIds, sendMail, sendSms, delivery } = request.body;

      let action: OrderActionResult;
      const preSkipped: { odId: string; reason: string }[] = [];
      switch (target) {
        case '입금':
          action = await setOrdersReceipt(odIds);
          break;
        case '준비':
          action = await setOrdersPreparing(odIds);
          break;
        case '배송': {
          // 선택 odIds ↔ 운송장 행 매칭. 행 없거나 3필드 미비 → MISSING_INVOICE(전이 전 skip).
          const matched = matchDeliveryRows(odIds, delivery ?? []);
          preSkipped.push(...matched.skipped);
          action = await setOrdersDelivery(matched.rows);
          break;
        }
        case '완료':
          action = await setOrdersComplete(odIds);
          break;
      }

      // 알림 — 입금·배송 전이의 성공 건만(코어 orderlistupdate.php 미러). 서비스 JWT 서명(짧은 exp).
      const notify: { odId: string; mail?: NotifyStatus; sms?: NotifyStatus }[] = [];
      const needNotify = (target === '입금' || target === '배송') && (sendMail || sendSms);
      if (needNotify && action.processed.length > 0) {
        const token = fastify.jwt.sign({ svc: 'sp-node' }, { expiresIn: '60s' });
        const results = await Promise.all(
          action.processed.map(async (odId) => {
            const r = await notifyOrderEvent(
              { odId, event: target, mail: sendMail, sms: sendSms },
              { token },
            );
            return { odId, ...r };
          }),
        );
        notify.push(...results);
      }

      return {
        result: true as const,
        data: {
          processed: action.processed,
          skipped: [...preSkipped, ...action.skipped],
          notify,
        },
      };
    },
  );

  // ── POST /api/admin/orders/delete — 미입금 선택삭제 ───────────────────────
  // 레거시 orderlistdelete.php 이식(⑬→⑪). od_status='주문'만 삭제(백업→cart 소프트삭제→order DELETE).
  // 결제완료는 PG 환불 취소 도메인이라 NOT_ORDER_STATUS 로 skip. 삭제는 알림 없음(notify=[]).
  fastify.post(
    '/orders/delete',
    {
      schema: {
        body: AdminOrderDeleteRequest,
        response: { 200: AdminOrderActionResponse },
      },
    },
    async (request) => {
      const action = await deleteOrders(request.body.odIds, request.user.mbId, request.ip);
      return {
        result: true as const,
        data: { processed: action.processed, skipped: action.skipped, notify: [] },
      };
    },
  );

  // ── GET /api/admin/orders/delivery-excel — 배송처리용 엑셀 다운로드 ─────────
  // 레거시 orderdeliveryexcel.php 이식. od_status='준비' AND od_misu=0 주문 전체(페이지네이션
  // 없음)를 xlsx 로. od_id 는 문자열 셀(빅넘버 깨짐 방지). 응답은 바이너리라 스키마 없음.
  // 레거시(.xls/Excel5) 대비 **.xlsx(exceljs)** 로 포맷 상향 — 업로드 파서도 xlsx 를 읽는다.
  fastify.get('/orders/delivery-excel', async (_request, reply) => {
    const rows = await getDeliveryExcelRows();
    const buffer = await buildDeliveryWorkbook(rows);
    const stamp = kstTodayYmd().slice(2); // YYMMDD (레거시 date('ymd') 미러)
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', `attachment; filename="deliverylist-${stamp}.xlsx"`)
      .header('Cache-Control', 'no-store')
      .send(buffer);
  });

  // ── POST /api/admin/orders/delivery-excel — 배송정보 일괄 업로드 ────────────
  // 레거시 orderdeliveryupdate.php 이식. multipart 파일 파트명은 `file` 고정. xlsx 파싱 →
  // A/I/J 열(od_id/배송회사/운송장) 추출 → invoice_time 은 서버 KST 시각(코어 G5_TIME_YMDHIS
  // 등가 — 엑셀엔 시각 컬럼 없음) → 기존 matchDeliveryRows+setOrdersDelivery(⑬) 재사용.
  // 알림: 레거시는 폼 체크박스 기본 on 이지만 팀리드 지시로 **기본 off**, sendMail/sendSms
  // 필드('1'|'true')로 opt-in. 성공 건만 notifyOrderEvent('배송'). 응답은 기존 AdminOrderActionResponse.
  fastify.post(
    '/orders/delivery-excel',
    {
      schema: {
        response: { 200: AdminOrderActionResponse },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.badRequest('multipart/form-data 요청이어야 합니다');
      }
      let fileBuffer: Buffer | undefined;
      let sendMail = false;
      let sendSms = false;
      const isTruthy = (v: unknown): boolean => v === '1' || v === 'true';
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') fileBuffer = await part.toBuffer();
          else await part.toBuffer(); // 예기치 않은 파일 파트는 소진(스트림 정체 방지)
        } else if (part.fieldname === 'sendMail') {
          sendMail = isTruthy(part.value);
        } else if (part.fieldname === 'sendSms') {
          sendSms = isTruthy(part.value);
        }
      }
      if (fileBuffer === undefined) return reply.badRequest('file 파트(xlsx)가 없습니다');

      let matrix: string[][];
      try {
        matrix = await readDeliverySheet(fileBuffer);
      } catch {
        return reply.badRequest('xlsx 파일을 읽을 수 없습니다');
      }

      const parsed = extractDeliveryRowsFromMatrix(matrix);
      const invoiceTime = kstDateTimeStr(new Date());
      const odIds = parsed.map((p) => p.odId);
      const delivery = parsed.map((p) => ({
        odId: p.odId,
        deliveryCompany: p.deliveryCompany,
        invoiceNo: p.invoiceNo,
        invoiceTime,
      }));
      const matched = matchDeliveryRows(odIds, delivery);
      const action = await setOrdersDelivery(matched.rows);

      // 알림(opt-in) — 성공 배송 건에 한해 PHP 브리지(입금·배송만 코어가 발송).
      const notify: { odId: string; mail?: NotifyStatus; sms?: NotifyStatus }[] = [];
      if ((sendMail || sendSms) && action.processed.length > 0) {
        const token = fastify.jwt.sign({ svc: 'sp-node' }, { expiresIn: '60s' });
        const results = await Promise.all(
          action.processed.map(async (odId) => {
            const r = await notifyOrderEvent(
              { odId, event: '배송', mail: sendMail, sms: sendSms },
              { token },
            );
            return { odId, ...r };
          }),
        );
        notify.push(...results);
      }

      return {
        result: true as const,
        data: {
          processed: action.processed,
          skipped: [...matched.skipped, ...action.skipped],
          notify,
        },
      };
    },
  );

  // ── PATCH /api/admin/orders/:odId/info — 주문자/받는분/배송지 편집 ──────────
  // 레거시 orderformupdate.php(mod_type='info') 이식. 상태 무관(코어 동일). 보낸 필드만 화이트리스트
  // UPDATE. jibeon 은 코어처럼 패스스루(회원 ⑨-b 의 addr 변경 시 초기화와 다름 — FE 가 R/J/'' 전송).
  // 부분 갱신이라 에코 대신 { odId }(FE refetch). 미존재 404.
  fastify.patch(
    '/orders/:odId/info',
    {
      schema: {
        params: OdIdParams,
        body: AdminOrderInfoBody,
        response: { 200: AdminOrderEditResponse },
      },
    },
    async (request, reply) => {
      const { odId } = request.params;
      const order = await getOrderRow(odId);
      if (order === null) return reply.notFound('주문이 없습니다');

      await updateOrderInfo(odId, orderInfoBodyToFields(request.body));
      return { result: true as const, data: { odId } };
    },
  );

  // ── PATCH /api/admin/orders/:odId/memo — 관리자 메모(od_shop_memo) 편집 ──────
  // 레거시 orderformupdate.php else 분기. 평문·''=비움. od_memo(주문자 요청)는 편집 대상 아님. 404.
  fastify.patch(
    '/orders/:odId/memo',
    {
      schema: {
        params: OdIdParams,
        body: AdminOrderMemoBody,
        response: { 200: AdminOrderEditResponse },
      },
    },
    async (request, reply) => {
      const { odId } = request.params;
      const order = await getOrderRow(odId);
      if (order === null) return reply.notFound('주문이 없습니다');

      await updateOrderShopMemo(odId, request.body.shopMemo);
      return { result: true as const, data: { odId } };
    },
  );

  // ── PATCH /api/admin/orders/:odId/receipt — 무통장 입금 수동 조정 ───────────
  // 레거시 orderformreceiptupdate.php 의 무통장·3필드 부분 이식. 결제수단≠무통장 → 409
  // NOT_BANK_TRANSFER(무통장만 관리자 수동 입금 조정 대상). 3필드 UPDATE(원자 가드 WHERE
  // od_settle_case='무통장') 후 recomputeOrderMoney(미수금 자동 재계산). **상태 전이·배송·에스크로·
  // 재고·메일 부수효과는 스코프 밖**(WP3 전이가 담당). 404.
  fastify.patch(
    '/orders/:odId/receipt',
    {
      schema: {
        params: OdIdParams,
        body: AdminOrderReceiptBody,
        response: { 200: AdminOrderEditResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { odId } = request.params;
      const order = await getOrderRow(odId);
      if (order === null) return reply.notFound('주문이 없습니다');
      if (order.settleCase !== '무통장') {
        return reply
          .status(409)
          .send({ error: 'NOT_BANK_TRANSFER', message: '무통장 주문만 입금 조정할 수 있습니다' });
      }

      const { receiptPrice, receiptTime, depositName } = request.body;
      await updateOrderReceipt(odId, receiptPrice, receiptTime, depositName);
      return { result: true as const, data: { odId } };
    },
  );

  // ── GET /api/admin/orders/:odId/print — 주문서 인쇄 데이터 ─────────────────
  // 레거시 orderprint 계열 이식. 상세(order+items) + 발신처(seller — 견적서 발신처 g5_shop_default
  // 재사용 ⑦). read-only. 404.
  fastify.get(
    '/orders/:odId/print',
    {
      schema: {
        params: OdIdParams,
        response: { 200: AdminOrderPrintResponse },
      },
    },
    async (request, reply) => {
      const order = await getOrderRow(request.params.odId);
      if (order === null) return reply.notFound('주문이 없습니다');

      const items = await buildOrderItems(order.odId);
      const profile = await getShopEstimateProfile();
      const seller = {
        name: profile?.name ?? '',
        owner: profile?.owner ?? '',
        tel: profile?.tel ?? '',
        zip: profile?.zip ?? '',
        addr: profile?.addr ?? '',
        managerName: profile?.managerName ?? '',
        managerEmail: profile?.managerEmail ?? '',
        bankAccount: profile?.bankAccount ?? '',
      };

      return {
        result: true as const,
        data: { order: toDetailOrder(order), items, seller },
      };
    },
  );

  done();
};
