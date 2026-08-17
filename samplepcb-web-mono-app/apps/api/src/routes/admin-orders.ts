import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminOrderActionResponse,
  AdminOrderDeleteRequest,
  AdminOrderDetailResponse,
  AdminOrderEditResponse,
  AdminOrderForceStatusRequest,
  AdminOrderInfoBody,
  AdminOrderItemActionResponse,
  AdminOrderItemStatusRequest,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AdminNotifyConfigResponse,
  AdminOrderMemoBody,
  AdminOrderPrintResponse,
  AdminOrderReceiptBody,
  AdminOrderRefundBody,
  AdminOrderStatusRequest,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminOrderCartItemType,
  AdminOrderCoreType,
  AdminOrderDetailOrderType,
  PcbProjectPayloadType,
} from '@sp/api-contract';
import { loadBomOrderShippingReadiness } from '../lib/bom-order-shipping';
import {
  deleteOrders,
  getCartRowsByOdId,
  getDeliveryExcelRows,
  getMemberOrderCounts,
  getNotifyConfig,
  getOrderRow,
  getShopEstimateProfile,
  matchDeliveryRows,
  searchOrders,
  setOrderForceStatus,
  setOrderItemsStatus,
  setOrdersComplete,
  setOrdersDelivery,
  setOrdersReceipt,
  setOrdersStage,
  updateOrderInfo,
  updateOrderReceipt,
  updateOrderRefund,
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
import { recordMailLog } from '../lib/mail-log';
import type { MailLogMeta } from '../lib/mail-log';
import { prisma } from '../lib/prisma';
import { signedThumbUrl } from '../lib/thumb-url';

// ── /api/admin/orders — 관리자 주문내역 (sp-vue /app/admin/orders) ────────────
// 레거시 adm/shop_admin/orderlist.php 를 sp-vue 로 마이그레이션. 이번 WP 는 읽기 경로만
// (목록/상세). 전 라우트가 requireAdmin(JWT isAdmin) 뒤에 있고, 응답은 계약 response
// 스키마로 직렬화되어 미선언 필드(민감 컬럼)가 구조적으로 탈락한다. g5 접근은 lib/g5-db.ts
// 한정 예외 ⑫(read-only SELECT)로만 하고, sp_* 조인은 Prisma 가 소유한다.

const OdIdParams = z.object({ odId: z.string().min(1).max(20) });

// 주문 이벤트 kind 코드 — 발송 이력(sp_mail_log) 필터 축(입금·배송만 실제 발송 대상).
const ORDER_NOTIFY_KIND: Record<'입금' | '준비' | '배송' | '완료', string> = {
  입금: 'order_deposit',
  준비: 'order_ready',
  배송: 'order_delivery',
  완료: 'order_complete',
};

// PHP 브리지 알림 + 발송 이력 기록. 발송 주체가 PHP(그누보드 ordermail)라 수신처는
// 미상('') — 채널별 결과(sent/failed/skipped)만 정직하게 남긴다.
const notifyOrderEventLogged = async (
  log: FastifyBaseLogger,
  params: { odId: string; event: '입금' | '준비' | '배송' | '완료'; mail: boolean; sms: boolean },
  token: string,
  sentBy: string,
): Promise<{ odId: string; mail?: NotifyStatus; sms?: NotifyStatus }> => {
  const r = await notifyOrderEvent(params, { token });
  const meta: MailLogMeta = {
    kind: ORDER_NOTIFY_KIND[params.event],
    refType: 'order',
    refId: params.odId,
    sentBy,
  };
  const reasonOf = (s: NotifyStatus): string | null =>
    s === 'sent' ? null : s === 'failed' ? 'send_failed' : 'php_skipped';
  if (r.mail !== undefined) {
    await recordMailLog(log, meta, {
      channel: 'email',
      status: r.mail,
      reason: reasonOf(r.mail),
      recipient: '',
    });
  }
  if (r.sms !== undefined) {
    await recordMailLog(log, meta, {
      channel: 'sms',
      status: r.sms,
      reason: reasonOf(r.sms),
      recipient: '',
    });
  }
  return { odId: params.odId, ...r };
};

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
  deliveryMethod: row.deliveryMethod,
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
        case '가격확인':
        case '파일검사':
        case 'EQ':
        case '생산시작':
        case '생산중':
        case '품질시험':
        case '생산완료':
          // 부수효과 없는 단순 선형 전이(입금→준비, 제작 7단계 간). 알림 미발송.
          action = await setOrdersStage(odIds, target);
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
          action.processed.map((odId) =>
            notifyOrderEventLogged(
              request.log,
              { odId, event: target, mail: sendMail, sms: sendSms },
              token,
              request.user.mbId,
            ),
          ),
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
  // 레거시 orderdeliveryexcel.php 이식. od_status='생산완료' AND od_misu=0(택배 방법만) 주문
  // 전체(페이지네이션 없음)를 xlsx 로. od_id 는 문자열 셀(빅넘버 깨짐 방지). 바이너리라 스키마 없음.
  // 레거시(.xls/Excel5) 대비 **.xlsx(exceljs)** 로 포맷 상향 — 업로드 파서도 xlsx 를 읽는다.
  // ── GET /api/admin/orders/notify-config — 메일/SMS 발송 설정(체크박스 노출 게이트) ──
  // 코어 orderform.php 의 설정 게이트를 목록·상세 공통으로 이식. SMS 는 실발송(order-notify.php)과
  // 동일 조건(cf_sms_use==='icode' + de_sms_use4/5)으로 계산됨(g5-db getNotifyConfig). read-only.
  // 정적 경로라 '/orders/:odId' 보다 우선 매칭된다(delivery-excel 과 동일 그룹).
  fastify.get(
    '/orders/notify-config',
    { schema: { response: { 200: AdminNotifyConfigResponse } } },
    async () => {
      const cfg = await getNotifyConfig();
      return { result: true as const, data: cfg };
    },
  );

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
      // 엑셀 왕복은 택배 전제(방법 열 없음) — method 는 parcel 고정.
      const delivery = parsed.map((p) => ({
        odId: p.odId,
        method: 'parcel' as const,
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
          action.processed.map((odId) =>
            notifyOrderEventLogged(
              request.log,
              { odId, event: '배송', mail: sendMail, sms: sendSms },
              token,
              request.user.mbId,
            ),
          ),
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

  // ── PATCH /api/admin/orders/:odId/refund — 환불 처리 기록 ───────────────────
  // 부분 취소로 od_misu 가 음수(= 돌려줄 돈)가 됐을 때, 실제로 돌려준 사실을 남기는 창구.
  // **돈을 보내지 않는다** — 실제 환불은 결제사·계좌에서 사람이 한다. 기록이 없으면
  // 시스템은 두 번 돌려주거나 영영 안 돌려준다(여정 10호 X5).
  // 결제수단 가드 없음(입금 조정과 다른 지점 — 위 updateOrderRefund 주석 참조). 404 만.
  fastify.patch(
    '/orders/:odId/refund',
    {
      schema: {
        params: OdIdParams,
        body: AdminOrderRefundBody,
        response: { 200: AdminOrderEditResponse },
      },
    },
    async (request, reply) => {
      const { odId } = request.params;
      const order = await getOrderRow(odId);
      if (order === null) return reply.notFound('주문이 없습니다');

      const { refundPrice, note } = request.body;
      await updateOrderRefund(odId, refundPrice, request.user.mbId, note);
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

  // ── PATCH /api/admin/orders/:odId/items/status — 카트행 취소/반품/품절 ───────
  // 레거시 orderformcartupdate.php 이식(무통장 한정). ct 단위 독립 처리 — 재고 복원·미수금/취소금액
  // 재계산·전량 취소류면 od_status='취소'. 결제수단≠무통장 → 409 NOT_BANK_TRANSFER(PG 부분취소는
  // PHP 도메인 존치). 미존재 404. 취소된 견적행은 주문내역에 남고 견적관리 미복귀(sp 무접촉).
  fastify.patch(
    '/orders/:odId/items/status',
    {
      schema: {
        params: OdIdParams,
        body: AdminOrderItemStatusRequest,
        response: { 200: AdminOrderItemActionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { odId } = request.params;
      const order = await getOrderRow(odId);
      if (order === null) return reply.notFound('주문이 없습니다');
      if (order.settleCase !== '무통장') {
        return reply.status(409).send({
          error: 'NOT_BANK_TRANSFER',
          message: '무통장 주문만 카트행 취소/반품/품절 처리할 수 있습니다',
        });
      }

      const { ctIds, target } = request.body;
      const result = await setOrderItemsStatus(odId, ctIds, target, request.user.mbId, request.ip);
      return {
        result: true as const,
        data: {
          processed: result.processed,
          skipped: result.skipped,
          odStatus: result.odStatus,
          orderCancelled: result.orderCancelled,
        },
      };
    },
  );

  // ── PATCH /api/admin/orders/:odId/force-status — 임의 상태 변경 ─────────────
  // 레거시 orderformcartupdate.php 정상 상태 분기 이식. 활성 카트행 ct_status=target + od_status
  // =target(역방향 포함). 스톡 앵커: 배송/완료 진입 차감·주문 역방향 복원. 코어 정상 분기에 결제수단
  // 결제수단 가드·운송장 요구 없음(임의 변경 허용). 단, Smart BOM 배송은 조달 복구·전량 입고를
  // 서버가 다시 확인한다. delivery 는 target='배송' 제공 시만 운송장 반영. 미존재 404.
  // SmartBOM·PCB 고객 배송 화면은 sendMail=true 로 기존 영카트 배송 메일 브리지를 선택 호출한다.
  // 포인트 딸린 활성 행(ct_point>0)은 409 HAS_POINT(PCB 미발생 안전판). 부분 갱신 응답 { odId }(FE refetch).
  fastify.patch(
    '/orders/:odId/force-status',
    {
      schema: {
        params: OdIdParams,
        body: AdminOrderForceStatusRequest,
        response: { 200: AdminOrderEditResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { odId } = request.params;
      const order = await getOrderRow(odId);
      if (order === null) return reply.notFound('주문이 없습니다');

      const { target, delivery, sendMail, preserveCanceled } = request.body;
      if (target === '배송') {
        const readiness = await loadBomOrderShippingReadiness(odId);
        if (readiness.hasBomCases && !readiness.ready) {
          return reply.status(409).send({
            error: 'BOM_FULFILLMENT_INCOMPLETE',
            message: '공급 부족 대체발주와 모든 발주서 입고가 끝난 뒤 배송 처리할 수 있습니다.',
          });
        }
      }
      const outcome = await setOrderForceStatus(
        odId,
        target,
        delivery,
        request.user.mbId,
        request.ip,
        { preserveCanceled },
      );
      if (outcome === 'HAS_POINT') {
        return reply.status(409).send({
          error: 'HAS_POINT',
          message: '포인트가 부여된 주문은 이 화면에서 상태를 변경할 수 없습니다',
        });
      }
      // 전량 취소(모든 줄이 취소류)인데 전진 상태를 걸었다 — 상태만 올리면 카트행과 어긋난다.
      if (outcome === 'NO_ACTIVE_LINES') {
        return reply.status(409).send({
          error: 'NO_ACTIVE_LINES',
          message:
            '취소된 주문입니다 — 진행할 상품이 없습니다. 되살리려면 상태를 [주문]으로 되돌린 뒤 다시 진행하세요',
        });
      }
      if (outcome === 'NO_ACTIVE_ITEMS') {
        return reply.status(409).send({
          error: 'NO_ACTIVE_ITEMS',
          message: '진행할 활성 주문 품목이 없습니다',
        });
      }
      if (target === '배송' && sendMail) {
        const token = fastify.jwt.sign({ svc: 'sp-node' }, { expiresIn: '60s' });
        const deliveryResult = await notifyOrderEventLogged(
          request.log,
          { odId, event: '배송', mail: true, sms: false },
          token,
          request.user.mbId,
        );
        return {
          result: true as const,
          data: {
            odId,
            notify: { mail: deliveryResult.mail ?? 'failed' },
          },
        };
      }
      return { result: true as const, data: { odId } };
    },
  );

  done();
};
