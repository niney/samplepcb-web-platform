import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomShipmentFileType,
  PartnerPoDetailResponse,
  PartnerPoListResponse,
  PartnerShipmentAdvanceBody,
  bomShipmentStatusLabel,
  type BomShipmentFileMetaType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  advancePartnerShipment,
  asShipmentMode,
  asShipmentStatus,
  deleteShipmentFile,
  ensurePartnerShipment,
  getShipmentFileDownload,
  revertPartnerShipment,
  saveShipmentFile,
  toPartnerPoDetail,
  toPartnerPoListItem,
  loadShipmentFilesMap,
  type PartnerShipmentError,
} from '../lib/bom-po';
import { collectMultipart } from '../lib/market';
import { buildShipmentTurnAdminEmail, sendBomRfqMail } from '../lib/rfq-email';
import { getShopEstimateProfile } from '../lib/g5-db';

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
  MISSING_TRACKING: '택배사와 송장번호를 입력해 주세요.',
};

export const partnerPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const loadDetail = async (poId: bigint, partnerId: bigint) => {
    const po = await prisma.spBomPo.findUnique({
      where: { id: poId },
      include: {
        items: { orderBy: { id: 'asc' } },
        quote: { select: { title: true } },
        shipment: true,
      },
    });
    if (po === null) return null;
    if (po.partnerId !== partnerId) return null;
    const filesMap =
      po.shipment === null
        ? new Map<string, BomShipmentFileMetaType[]>()
        : await loadShipmentFilesMap([po.shipment.id]);
    return toPartnerPoDetail(
      po,
      po.shipment === null ? [] : (filesMap.get(po.shipment.id.toString()) ?? []),
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
      include: { shipment: true, quote: { select: { id: true, title: true } } },
    });
    if (po?.shipment == null) return;
    const mode = asShipmentMode(po.shipment.mode);
    const profile = await getShopEstimateProfile();
    void sendBomRfqMail(
      log,
      profile?.managerEmail,
      buildShipmentTurnAdminEmail({
        quoteId: String(po.quote.id),
        quoteTitle: po.quote.title,
        partnerName,
        statusLabel: bomShipmentStatusLabel(mode, asShipmentStatus(mode, po.shipment.status)),
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
          shipment: true,
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
      const result = await advancePartnerShipment(
        request.params.poId,
        ctx.partnerId,
        request.body,
      );
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

  // 선적 첨부 업로드(D22) — multipart(fileType 필드 + file 파트), 종류별 1건(재업로드=교체).
  // requirePartner 훅이 본문 소비 전에 인증을 마친다(관리자 훅+multipart 라우트와 동일 구성).
  fastify.post(
    '/partner/pos/:poId/shipment/files',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse, 400: ApiError } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const { files, fields } = await collectMultipart(request);
      const kind = BomShipmentFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined) {
        return reply
          .status(400)
          .send({ error: 'BAD_UPLOAD', message: 'fileType(invoice|airwaybill)과 파일이 필요합니다.' });
      }
      const shipment = await ensurePartnerShipment(request.params.poId, ctx.partnerId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      await saveShipmentFile(shipment.id, kind.data, file, 'PARTNER');
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
