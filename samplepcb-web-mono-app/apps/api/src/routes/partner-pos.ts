import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomInvoiceData,
  BomInvoiceDraftResponse,
  BomPartnerQuotationResponse,
  BomShipmentPackingListResponse,
  BomShipmentPackingListSaveBody,
  BomShipmentStatementResponse,
  BomShipmentFileType,
  PartnerPoDetailResponse,
  PartnerPoListResponse,
  PartnerShipmentAdvanceBody,
  PartnerShipmentCreateBody,
  PartnerShipmentCreateResponse,
  PartnerShipmentListQuery,
  PartnerShipmentListResponse,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  type BomShipmentFileMetaType,
  type BomShipmentGroupPoType,
  type PartnerShipmentListQueryType,
  type PartnerShipmentViewType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  advancePartnerShipment,
  asShipmentMode,
  asShipmentStatus,
  attachShipmentPo,
  createPartnerShipment,
  deleteShipmentFile,
  detachShipmentPo,
  ensurePartnerShipment,
  getShipmentFileDownload,
  loadPartnerShipments,
  revertPartnerShipment,
  saveShipmentFile,
  toPartnerPoDetail,
  toPartnerPoListItem,
  loadShipmentFilesMap,
  loadShipmentGroupMap,
  type PartnerShipmentError,
} from '../lib/bom-po';
import { collectMultipart } from '../lib/market';
import {
  buildInvoiceDraft,
  loadPoForInvoice,
  renderInvoiceXlsx,
  saveInvoiceData,
} from '../lib/bom-invoice';
import {
  loadPartnerQuotationDocument,
  loadShipmentStatementDocument,
} from '../lib/bom-trade-documents';
import { buildShipmentTurnAdminEmail, sendBomRfqMail } from '../lib/rfq-email';
import { getShopEstimateProfile } from '../lib/g5-db';
import {
  BomPackingError,
  loadShipmentPackingList,
  markShipmentPackingListPrinted,
  partnerCanAccessPacking,
  saveShipmentPackingList,
} from '../lib/bom-packing';
import { shipmentModeFromCountry } from '../lib/bom-shipment-policy';

// ── /api/partner/pos — 협력사 포털: 받은 발주(D18-8) + 선적 핑퐁(D22) ────────
// requirePartner 가 매 요청 소속을 서버 판정. 노출은 자기 발주서의 품목·수량·단가뿐
// (고객 식별정보는 계약 스키마에 없다). 선적은 자기 차례 전이만 서버가 인가한다
// (레거시는 프론트만 검증 — 취약점 교정).

const PoIdParams = z.object({ poId: z.coerce.bigint() });
const PoFileParams = z.object({ poId: z.coerce.bigint(), fileId: z.coerce.bigint() });

const ADVANCE_ERROR_MESSAGE: Record<PartnerShipmentError, string> = {
  PO_NOT_FOUND: '발주서를 찾을 수 없습니다.',
  NOT_YOUR_TURN: '지금은 샘플피씨비 처리 차례입니다.',
  ALREADY_FINAL: '이미 최종 단계입니다.',
  NOTHING_TO_REVERT: '되돌릴 단계가 없습니다.',
  MISSING_SHIP_DATE: '출고예정일을 입력해 주세요.',
  MISSING_INVOICE_FILE: 'Invoice 파일을 먼저 첨부해 주세요.',
  MISSING_PACKING_LIST: '선적 리스트와 QR 라벨을 먼저 생성해 주세요.',
  MISSING_TRACKING: '택배사와 송장번호를 입력해 주세요.',
  INVALID_GROUP_PO: '담을 수 없는 발주서입니다 — 목록을 새로고침해 주세요.',
  NOT_PREPARING: '발송 준비 단계에서만 박스를 변경할 수 있습니다.',
  PARTNER_COUNTRY_REQUIRED: '협력사 국가 정보가 없습니다. 샘플피씨비 담당자에게 문의해 주세요.',
};

export const partnerPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const loadDetail = async (poId: bigint, partnerId: bigint) => {
    const po = await prisma.spBomPo.findUnique({
      where: { id: poId },
      include: {
        items: { orderBy: { id: 'asc' } },
        quote: { select: { title: true } },
        shipmentLink: { include: { shipment: true } },
      },
    });
    if (po === null) return null;
    if (po.partnerId !== partnerId) return null;
    const shipmentId = po.shipmentLink?.shipmentId ?? null;
    const [filesMap, groupMap] =
      shipmentId === null
        ? [
            new Map<string, BomShipmentFileMetaType[]>(),
            new Map<string, BomShipmentGroupPoType[]>(),
          ]
        : await Promise.all([
            loadShipmentFilesMap([shipmentId]),
            loadShipmentGroupMap([shipmentId]),
          ]);
    const key = shipmentId?.toString();
    return toPartnerPoDetail(
      po,
      key === undefined ? [] : (filesMap.get(key) ?? []),
      key === undefined ? [] : (groupMap.get(key) ?? []),
    );
  };

  // 협력사 전이 성공 → 관리자 알림(다음 차례 = 관리자, D22 결정: 핑퐁엔 메일이 필수).
  const notifyAdminTurn = async (
    log: Parameters<typeof sendBomRfqMail>[0],
    poId: bigint,
    partnerName: string,
  ): Promise<void> => {
    const po = await prisma.spBomPo.findUnique({
      where: { id: poId },
      include: {
        shipmentLink: { include: { shipment: true } },
        quote: { select: { id: true, title: true } },
      },
    });
    const shipment = po?.shipmentLink?.shipment ?? null;
    if (po === null || shipment === null) return;
    const mode = asShipmentMode(shipment.mode);
    const profile = await getShopEstimateProfile();
    void sendBomRfqMail(
      log,
      profile?.managerEmail,
      buildShipmentTurnAdminEmail({
        quoteId: String(po.quote.id),
        quoteTitle: po.quote.title,
        partnerName,
        statusLabel: bomShipmentStatusLabel(mode, asShipmentStatus(mode, shipment.status)),
      }),
    );
  };

  fastify.get(
    '/partner/pos',
    { schema: { response: { 200: PartnerPoListResponse } } },
    async (request) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const pos = await prisma.spBomPo.findMany({
        where: { partnerId: ctx.partnerId },
        include: {
          items: true,
          quote: { select: { title: true } },
          partner: true,
          shipmentLink: { include: { shipment: true } },
        },
        orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
      });
      return { result: true as const, data: { items: pos.map(toPartnerPoListItem) } };
    },
  );

  fastify.get(
    '/partner/pos/:poId',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const detail = await loadDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // 협력사가 제출하고 PO 발행 시 동결된 견적서. 고객 BOM 견적서와 발행 방향이 다르다.
  fastify.get(
    '/partner/pos/:poId/quotation',
    { schema: { params: PoIdParams, response: { 200: BomPartnerQuotationResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const data = await loadPartnerQuotationDocument(request.params.poId, ctx.partnerId);
      if (data === null) return reply.notFound('견적서를 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  // [다음 단계 진행](D22) — 자기 차례 전이만. 단계별 필수는 서버 검증(409 + 코드).
  fastify.post(
    '/partner/pos/:poId/shipment/advance',
    {
      schema: {
        params: PoIdParams,
        body: PartnerShipmentAdvanceBody,
        response: { 200: PartnerPoDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const result = await advancePartnerShipment(request.params.poId, ctx.partnerId, request.body);
      if (!result.ok) {
        if (result.error === 'PO_NOT_FOUND') return reply.notFound('발주서를 찾을 수 없습니다');
        return reply
          .status(409)
          .send({ error: result.error, message: ADVANCE_ERROR_MESSAGE[result.error] });
      }
      await notifyAdminTurn(request.log, request.params.poId, ctx.partnerName);
      const detail = await loadDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // [이전 단계로](D22) — 직전에 자기가 진행한 전이만 1단계(입력값·첨부 유지).
  fastify.post(
    '/partner/pos/:poId/shipment/revert',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const result = await revertPartnerShipment(request.params.poId, ctx.partnerId);
      if (!result.ok) {
        if (result.error === 'PO_NOT_FOUND') return reply.notFound('발주서를 찾을 수 없습니다');
        return reply
          .status(409)
          .send({ error: result.error, message: ADVANCE_ERROR_MESSAGE[result.error] });
      }
      const detail = await loadDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── 발송 1급(§6.11) — [보내기] 담기(생성) + 발송 목록(홈 추적 카드) ──────────
  fastify.post(
    '/partner/shipments',
    {
      schema: {
        body: PartnerShipmentCreateBody,
        response: { 200: PartnerShipmentCreateResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const result = await createPartnerShipment(ctx.partnerId, request.body.poIds);
      if (!result.ok) {
        return reply.status(409).send({
          error: result.error,
          message:
            result.error === 'PARTNER_COUNTRY_REQUIRED'
              ? ADVANCE_ERROR_MESSAGE.PARTNER_COUNTRY_REQUIRED
              : '선택한 발주서를 담을 수 없습니다 — 목록을 새로고침해 주세요.',
        });
      }
      const items = await loadPartnerShipments(ctx.partnerId);
      const created = items.find((item) => item.shipmentId === Number(result.shipmentId));
      if (created === undefined) return reply.notFound('발송을 찾을 수 없습니다');
      return { result: true as const, data: created };
    },
  );

  // 협력사 관점 완료(§6.11) = 최종 상태(done|delivered) 도달 또는 입고 확인 —
  // 협력사가 더 할 일이 없는 발송. 완료는 누적되므로 done 탭(별도 페이지)으로 분리.
  const isShipmentDoneForPartner = (s: PartnerShipmentViewType): boolean =>
    s.receivedAt !== null || bomShipmentNextStatus(s.mode, s.status) === null;

  const buildShipmentListData = async (partnerId: bigint, query?: PartnerShipmentListQueryType) => {
    const all = await loadPartnerShipments(partnerId);
    const dones = all.filter(isShipmentDoneForPartner);
    const actives = all.filter((s) => !isShipmentDoneForPartner(s));
    const tab = query?.tab ?? 'active';
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 50;
    const filtered = tab === 'done' ? dones : actives;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      counts: { active: actives.length, done: dones.length },
    };
  };

  fastify.get(
    '/partner/shipments',
    {
      schema: {
        querystring: PartnerShipmentListQuery,
        response: { 200: PartnerShipmentListResponse },
      },
    },
    async (request) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      return {
        result: true as const,
        data: await buildShipmentListData(ctx.partnerId, request.query),
      };
    },
  );

  // 박스에 담기(§6.11 두 칸 UI) — 준비 중 발송에 발주서 추가.
  const ShipmentPoBody = z.object({ poId: z.number().int().positive() });
  const ShipmentIdParams = z.object({ shipmentId: z.coerce.bigint() });

  // 발송에 실제 담긴 PO와 Packing List 수량을 합친 거래명세서. 준비 중에는 초안 표기.
  fastify.get(
    '/partner/shipments/:shipmentId/statement',
    { schema: { params: ShipmentIdParams, response: { 200: BomShipmentStatementResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const data = await loadShipmentStatementDocument(request.params.shipmentId, ctx.partnerId);
      if (data === null) return reply.notFound('거래명세서를 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  fastify.post(
    '/partner/shipments/:shipmentId/pos',
    {
      schema: {
        params: z.object({ shipmentId: z.coerce.bigint() }),
        body: ShipmentPoBody,
        response: { 200: PartnerShipmentListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const result = await attachShipmentPo(
        request.params.shipmentId,
        BigInt(request.body.poId),
        ctx.partnerId,
      );
      if (!result.ok) {
        if (result.error === 'PO_NOT_FOUND') return reply.notFound('발송을 찾을 수 없습니다');
        return reply
          .status(409)
          .send({ error: result.error, message: ADVANCE_ERROR_MESSAGE[result.error] });
      }
      return { result: true as const, data: await buildShipmentListData(ctx.partnerId) };
    },
  );

  // 선적 리스트·QR 라벨(D24) — 자기 조직 발송만. 저장은 preparing 에서만 가능하고
  // 인쇄는 확정 뒤에도 같은 token/revision을 재사용한다.
  fastify.get(
    '/partner/shipments/:shipmentId/packing-list',
    {
      schema: {
        params: ShipmentIdParams,
        response: { 200: BomShipmentPackingListResponse },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      if (!(await partnerCanAccessPacking(request.params.shipmentId, ctx.partnerId))) {
        return reply.notFound('발송을 찾을 수 없습니다');
      }
      const data = await loadShipmentPackingList(request.params.shipmentId);
      if (data === null) return reply.notFound('발송을 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  fastify.put(
    '/partner/shipments/:shipmentId/packing-list',
    {
      schema: {
        params: ShipmentIdParams,
        body: BomShipmentPackingListSaveBody,
        response: { 200: BomShipmentPackingListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      if (!(await partnerCanAccessPacking(request.params.shipmentId, ctx.partnerId))) {
        return reply.notFound('발송을 찾을 수 없습니다');
      }
      try {
        const data = await saveShipmentPackingList(request.params.shipmentId, request.body, {
          type: 'PARTNER',
          mbId: request.user.mbId,
        });
        return { result: true as const, data };
      } catch (error) {
        if (!(error instanceof BomPackingError)) throw error;
        return reply.status(409).send({
          error: error.code,
          message:
            error.code === 'PACKING_INVALID_QUANTITY'
              ? '포장 수량 합계가 발주 수량과 같아야 합니다.'
              : error.code === 'PACKING_NOT_PREPARING' || error.code === 'PACKING_TRACKING_LOCKED'
                ? '발송 준비 단계의 미입고 포장만 수정할 수 있습니다.'
                : '선적 리스트가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        });
      }
    },
  );

  fastify.post(
    '/partner/shipments/:shipmentId/packing-list/print',
    {
      schema: {
        params: ShipmentIdParams,
        response: { 200: BomShipmentPackingListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      if (!(await partnerCanAccessPacking(request.params.shipmentId, ctx.partnerId))) {
        return reply.notFound('발송을 찾을 수 없습니다');
      }
      try {
        const data = await markShipmentPackingListPrinted(request.params.shipmentId, {
          type: 'PARTNER',
          mbId: request.user.mbId,
        });
        return { result: true as const, data };
      } catch (error) {
        if (!(error instanceof BomPackingError)) throw error;
        return reply.status(409).send({
          error: error.code,
          message: 'QR을 먼저 저장한 뒤 인쇄해 주세요.',
        });
      }
    },
  );

  // 묶음에서 제외(§6.10) — 자기 발주서를 그룹에서 뺀다(대표 불가·발송 준비 단계만).
  fastify.delete(
    '/partner/pos/:poId/shipment/membership',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const result = await detachShipmentPo(shipment.id, request.params.poId);
      if (!result.ok) {
        if (result.error === 'PO_NOT_FOUND') return reply.notFound('발주서를 찾을 수 없습니다');
        return reply
          .status(409)
          .send({ error: result.error, message: ADVANCE_ERROR_MESSAGE[result.error] });
      }
      const detail = await loadDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // 선적 첨부 업로드(D22) — multipart(fileType 필드 + file 파트), 종류별 1건(재업로드=교체).
  // requirePartner 훅이 본문 소비 전에 인증을 마친다(관리자 훅+multipart 라우트와 동일 구성).
  fastify.post(
    '/partner/pos/:poId/shipment/files',
    {
      schema: {
        params: PoIdParams,
        response: { 200: PartnerPoDetailResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const { files, fields } = await collectMultipart(request);
      const kind = BomShipmentFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined) {
        return reply.status(400).send({
          error: 'BAD_UPLOAD',
          message: 'fileType(invoice|airwaybill)과 파일이 필요합니다.',
        });
      }
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const saved = await saveShipmentFile(shipment.id, kind.data, file, 'PARTNER');
      if (!saved) {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Invoice와 AWB는 국외 발송에서만 사용합니다.',
        });
      }
      const detail = await loadDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  fastify.delete(
    '/partner/pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams, response: { 200: PartnerPoDetailResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const removed = await deleteShipmentFile(shipment.id, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      const detail = await loadDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // 첨부 다운로드 — 파일서버 프록시 스트림(pathToken 미노출, 소유 발주서만).
  fastify.get(
    '/partner/pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const file = await getShipmentFileDownload(shipment.id, request.params.fileId);
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .type(file.contentType)
        .send(file.buffer);
    },
  );

  // ── 상업송장 생성기(D23) — 초안(저장본 우선·fresh 재조립)·저장·엑셀 렌더 ────
  // coerce.boolean 은 'false' 문자열도 true 라 enum→transform 으로 판정한다.
  const InvoiceQuery = z.object({
    fresh: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  });
  const invoiceModeOf = (
    po: NonNullable<Awaited<ReturnType<typeof loadPoForInvoice>>>,
  ) =>
    po.shipmentLink === null
      ? shipmentModeFromCountry(po.partner.country)
      : asShipmentMode(po.shipmentLink.shipment.mode);

  fastify.get(
    '/partner/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoIdParams,
        querystring: InvoiceQuery,
        response: { 200: BomInvoiceDraftResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const po = await loadPoForInvoice(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.partnerId !== ctx.partnerId) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const mode = invoiceModeOf(po);
      if (mode === null) {
        return reply.status(409).send({
          error: 'PARTNER_COUNTRY_REQUIRED',
          message: ADVANCE_ERROR_MESSAGE.PARTNER_COUNTRY_REQUIRED,
        });
      }
      if (mode !== 'international') {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Commercial Invoice는 국외 발송에서만 사용합니다.',
        });
      }
      return { result: true as const, data: await buildInvoiceDraft(po, request.query.fresh) };
    },
  );

  fastify.put(
    '/partner/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoIdParams,
        body: BomInvoiceData,
        response: { 200: BomInvoiceDraftResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (asShipmentMode(shipment.mode) !== 'international') {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Commercial Invoice는 국외 발송에서만 사용합니다.',
        });
      }
      await saveInvoiceData(shipment.id, request.body);
      return { result: true as const, data: request.body };
    },
  );

  // 엑셀 생성 — 편집본 저장 후 렌더(레거시 POST xlsx 미러). 응답은 xlsx 바이너리.
  fastify.post(
    '/partner/pos/:poId/shipment/invoice/xlsx',
    { schema: { params: PoIdParams, body: BomInvoiceData } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (asShipmentMode(shipment.mode) !== 'international') {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Commercial Invoice는 국외 발송에서만 사용합니다.',
        });
      }
      await saveInvoiceData(shipment.id, request.body);
      const buffer = await renderInvoiceXlsx(request.body);
      const base = (request.body.invoiceNo || `invoice-${String(shipment.id)}`).replace(
        /[^\w.-]+/g,
        '_',
      );
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.xlsx`)}`,
        )
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  // [발주 확인] — issued → confirmed (동시 클릭도 1회 수렴).
  fastify.post(
    '/partner/pos/:poId/confirm',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.partnerId !== ctx.partnerId) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const updated = await prisma.spBomPo.updateMany({
        where: { id: po.id, status: 'issued' },
        data: { status: 'confirmed', confirmedAt: new Date() },
      });
      if (updated.count === 0) {
        return reply
          .status(409)
          .send({ error: 'PO_NOT_CONFIRMABLE', message: '이미 확인되었거나 마감된 발주서입니다.' });
      }
      const detail = await loadDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  done();
};
