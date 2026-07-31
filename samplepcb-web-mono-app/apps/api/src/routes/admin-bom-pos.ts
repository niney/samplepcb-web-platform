import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomPoCreateBody,
  AdminBomPoCreateResponse,
  AdminBomPoListResponse,
  AdminBomPoMutationResponse,
  AdminBomShipmentReceiveBody,
  AdminBomShipmentUpsertBody,
  ApiError,
  BomInvoiceData,
  BomInvoiceDraftResponse,
  BomShipmentFileType,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  EXTERNAL_AUTOMATED_SUPPLIERS,
  asShipmentMode,
  asShipmentStatus,
  createBomPos,
  deleteShipmentFile,
  detachShipmentPo,
  executeExternalPo,
  getShipmentFileDownload,
  loadAdminPos,
  receiveShipment,
  saveShipmentFile,
  upsertShipment,
} from '../lib/bom-po';
import { collectMultipart } from '../lib/market';
import { buildInvoiceDraft, loadPoForInvoice, renderInvoiceXlsx, saveInvoiceData } from '../lib/bom-invoice';
import {
  buildBomPoIssuedEmail,
  buildShipmentReceivedEmail,
  buildShipmentTurnPartnerEmail,
  sendBomRfqMail,
} from '../lib/rfq-email';

// ── /api/admin/bom-quotes/:id/pos — 협력사 발주서(D18) ───────────────────────
// 생성은 all-or-nothing(신중 액션): 결제 확인(od isPaid) 게이트 + 대상 행 재집계·박제.
// issued(미확인)만 삭제 가능(재발행 = 삭제 후 재생성), 마감은 issued|confirmed → closed.
// 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const PoParams = z.object({ id: z.coerce.bigint(), poId: z.coerce.bigint() });
const PoFileParams = z.object({
  id: z.coerce.bigint(),
  poId: z.coerce.bigint(),
  fileId: z.coerce.bigint(),
});

const CREATE_ERROR_MESSAGE: Record<string, string> = {
  QUOTE_NOT_FOUND: '견적을 찾을 수 없습니다.',
  NOT_PAID: '결제 확인(입금) 후에 발주할 수 있습니다.',
  NO_ELIGIBLE_ROWS: '협력사 회신으로 선정된 부품행이 없는 협력사가 포함되어 있습니다.',
  ALREADY_ISSUED: '이미 발주서가 발행된 협력사가 포함되어 있습니다(재발행은 삭제 후).',
};

export const adminBomPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 선적 해석·보장(§6.10 조인 기반) — 소속 선적을 찾고, 없으면 preparing 으로 생성.
  const ensureAdminShipment = async (quoteId: bigint, poId: bigint) => {
    const po = await prisma.spBomPo.findUnique({
      where: { id: poId },
      include: { shipmentLink: { include: { shipment: true } }, partner: true },
    });
    if (po?.quoteId !== quoteId) return null;
    if (po.shipmentLink !== null) return po.shipmentLink.shipment;
    const created = await prisma.spBomShipment.create({
      data: {
        poId: po.id,
        quoteId: po.quoteId,
        mode: po.partner.country === 'KR' ? 'domestic' : 'international',
        status: 'preparing',
      },
    });
    await prisma.spBomShipmentPo.create({ data: { shipmentId: created.id, poId: po.id } });
    return created;
  };

  // ── GET — 발주서 목록(행 포함) ──────────────────────────────────────────────
  fastify.get(
    '/bom-quotes/:id/pos',
    { schema: { params: IdParams, response: { 200: AdminBomPoListResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      return { result: true as const, data: { pos: await loadAdminPos(quote.id) } };
    },
  );

  // ── POST — 발주서 생성(선택 협력사, all-or-nothing) + 메일 ──────────────────
  fastify.post(
    '/bom-quotes/:id/pos',
    {
      schema: {
        params: IdParams,
        body: AdminBomPoCreateBody,
        response: { 200: AdminBomPoCreateResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      const result = await createBomPos(
        quote.id,
        request.body.partnerIds,
        request.body.memo ?? null,
      );
      if (!result.ok) {
        return reply.status(409).send({
          error: result.error,
          message: CREATE_ERROR_MESSAGE[result.error] ?? '발주서 생성에 실패했습니다.',
        });
      }

      // 외부공급사(D20) 자동 실행 — 생성과 분리: 실패해도 발주서는 유효, 결과는 externalRef.
      let pos = await loadAdminPos(quote.id);
      const externalTargets = result.partners.filter(
        (partner) =>
          partner.supplierCode !== null &&
          (EXTERNAL_AUTOMATED_SUPPLIERS as readonly string[]).includes(partner.supplierCode),
      );
      for (const partner of externalTargets) {
        const po = pos.find((entry) => entry.partnerId === Number(partner.id));
        if (po === undefined) continue;
        await executeExternalPo(BigInt(po.poId));
      }
      if (externalTargets.length > 0) pos = await loadAdminPos(quote.id);

      // 발행 알림 — 사람 협력사만(공급사 조직 메일은 알림 대상 아님), 비차단(실패는 로그).
      for (const partner of result.partners) {
        if (partner.type !== 'partner') continue;
        const po = pos.find((entry) => entry.partnerId === Number(partner.id));
        if (po === undefined) continue;
        void sendBomRfqMail(
          request.log,
          partner.contactEmail,
          buildBomPoIssuedEmail({
            partnerName: partner.name,
            quoteTitle: quote.title,
            itemCount: po.itemCount,
            totalAmount: po.totalAmount,
          }),
        );
      }
      return {
        result: true as const,
        data: { created: result.partners.length, pos },
      };
    },
  );

  // ── POST — 외부 실행 재시도/재발급(D20 — Mouser 카트·DigiKey 리스트) ────────
  fastify.post(
    '/bom-quotes/:id/pos/:poId/external',
    {
      schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 409: ApiError } },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const result = await executeExternalPo(po.id);
      if (!result.ok && result.error !== 'EXECUTE_FAILED') {
        // EXECUTE_FAILED 는 externalRef 에 박제되어 화면이 보여준다 — 목록 갱신으로 응답.
        return reply.status(409).send({
          error: result.error,
          message:
            result.error === 'NOT_AUTOMATED'
              ? '자동 실행 대상 공급사(mouser·digikey)가 아닙니다.'
              : '실행할 SKU 가 있는 행이 없습니다.',
        });
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  // ── DELETE — 발행 취소(issued 만 — confirmed 는 협력사가 이미 본 문서) ──────
  fastify.delete(
    '/bom-quotes/:id/pos/:poId',
    {
      schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 409: ApiError } },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const removed = await prisma.spBomPo.deleteMany({
        where: { id: po.id, status: 'issued' },
      });
      if (removed.count === 0) {
        return reply.status(409).send({
          error: 'PO_NOT_DELETABLE',
          message: '협력사가 확인한 발주서는 삭제할 수 없습니다.',
        });
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  // ── PUT — 선적 등록/수정(D21) — mode 는 생성 시 박제, 상태 모드 정합은 서버 검증 ──
  // 상태가 실제로 바뀌고 다음 단계 주체가 협력사면 알림 메일(D22 핑퐁 — 상대 차례 통지).
  fastify.put(
    '/bom-quotes/:id/pos/:poId/shipment',
    {
      schema: {
        params: PoParams,
        body: AdminBomShipmentUpsertBody,
        response: { 200: AdminBomPoMutationResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({
        where: { id: request.params.poId },
        include: {
          shipmentLink: { include: { shipment: true } },
          partner: true,
          quote: { select: { title: true } },
        },
      });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const prevStatus = po.shipmentLink?.shipment.status ?? null;
      const result = await upsertShipment(po.id, request.body);
      if (!result.ok) {
        return reply.status(409).send({
          error: result.error,
          message:
            result.error === 'INVALID_STATUS'
              ? '선적 모드에 맞지 않는 상태입니다.'
              : '발주서를 찾을 수 없습니다.',
        });
      }
      const freshLink = await prisma.spBomShipmentPo.findUnique({
        where: { poId: po.id },
        include: { shipment: true },
      });
      const fresh = freshLink?.shipment ?? null;
      if (fresh !== null && fresh.status !== prevStatus) {
        const mode = asShipmentMode(fresh.mode);
        const status = asShipmentStatus(mode, fresh.status);
        const next = bomShipmentNextStatus(mode, status);
        if (next !== null && bomShipmentActorOf(mode, next) === 'PARTNER') {
          void sendBomRfqMail(
            request.log,
            po.partner.contactEmail,
            buildShipmentTurnPartnerEmail({
              partnerName: po.partner.name,
              quoteTitle: po.quote.title,
              statusLabel: bomShipmentStatusLabel(mode, status),
              nextLabel: bomShipmentStatusLabel(mode, next),
            }),
          );
        }
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  // ── POST — 입고 확인(검수 ⑩, D21-2) — 선적 없이도 가능, 편차 메모 기록 ──────
  // 확인 후 협력사 통지(D22) — 편차 메모가 있으면 재발송 협의 근거로 함께 보낸다.
  fastify.post(
    '/bom-quotes/:id/pos/:poId/shipment/receive',
    {
      schema: {
        params: PoParams,
        body: AdminBomShipmentReceiveBody,
        response: { 200: AdminBomPoMutationResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({
        where: { id: request.params.poId },
        include: { partner: true, quote: { select: { title: true } } },
      });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const result = await receiveShipment(po.id, request.body.note ?? null);
      if (!result.ok) {
        return reply
          .status(409)
          .send({ error: result.error, message: '입고 확인에 실패했습니다.' });
      }
      if (po.partner.type === 'partner') {
        void sendBomRfqMail(
          request.log,
          po.partner.contactEmail,
          buildShipmentReceivedEmail({
            partnerName: po.partner.name,
            quoteTitle: po.quote.title,
            note: request.body.note ?? null,
          }),
        );
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  // ── 선적 첨부(D22) — 업로드(종류별 1건, 재업로드=교체)·삭제·다운로드 ─────────
  fastify.post(
    '/bom-quotes/:id/pos/:poId/shipment/files',
    { schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 400: ApiError } } },
    async (request, reply) => {
      const { files, fields } = await collectMultipart(request);
      const kind = BomShipmentFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined) {
        return reply
          .status(400)
          .send({ error: 'BAD_UPLOAD', message: 'fileType(invoice|airwaybill)과 파일이 필요합니다.' });
      }
      // 선적 문서가 없으면 preparing 으로 생성해 파일부터 받는다(협력사 흐름과 동일).
      const shipment = await ensureAdminShipment(request.params.id, request.params.poId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      await saveShipmentFile(shipment.id, kind.data, file, 'ADMIN');
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  fastify.delete(
    '/bom-quotes/:id/pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams, response: { 200: AdminBomPoMutationResponse } } },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({
        where: { id: request.params.poId },
        include: { shipmentLink: true },
      });
      if (po?.quoteId !== request.params.id || po.shipmentLink === null) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const removed = await deleteShipmentFile(po.shipmentLink.shipmentId, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  // 묶음에서 제외(§6.10) — 협력사와 같은 규칙(대표 불가·발송 준비 단계만).
  fastify.delete(
    '/bom-quotes/:id/pos/:poId/shipment/membership',
    { schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({
        where: { id: request.params.poId },
        include: { shipmentLink: true },
      });
      if (po?.quoteId !== request.params.id || po.shipmentLink === null) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const result = await detachShipmentPo(po.shipmentLink.shipmentId, po.id);
      if (!result.ok) {
        return reply.status(409).send({
          error: result.error,
          message: '발송 준비 단계에서만 묶음을 변경할 수 있습니다.',
        });
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  fastify.get(
    '/bom-quotes/:id/pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({
        where: { id: request.params.poId },
        include: { shipmentLink: true },
      });
      if (po?.quoteId !== request.params.id || po.shipmentLink === null) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const file = await getShipmentFileDownload(po.shipmentLink.shipmentId, request.params.fileId);
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

  // ── 상업송장 생성기(D23) — 초안·저장·엑셀(협력사와 같은 데이터, 관리자 대리 작성) ──
  const InvoiceQuery = z.object({ fresh: z.coerce.boolean().default(false) });

  fastify.get(
    '/bom-quotes/:id/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        querystring: InvoiceQuery,
        response: { 200: BomInvoiceDraftResponse },
      },
    },
    async (request, reply) => {
      const po = await loadPoForInvoice(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      return { result: true as const, data: await buildInvoiceDraft(po, request.query.fresh) };
    },
  );

  fastify.put(
    '/bom-quotes/:id/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        body: BomInvoiceData,
        response: { 200: BomInvoiceDraftResponse },
      },
    },
    async (request, reply) => {
      const shipment = await ensureAdminShipment(request.params.id, request.params.poId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      await saveInvoiceData(shipment.id, request.body);
      return { result: true as const, data: request.body };
    },
  );

  fastify.post(
    '/bom-quotes/:id/pos/:poId/shipment/invoice/xlsx',
    { schema: { params: PoParams, body: BomInvoiceData } },
    async (request, reply) => {
      const shipment = await ensureAdminShipment(request.params.id, request.params.poId);
      if (shipment === null) return reply.notFound('발주서를 찾을 수 없습니다');
      await saveInvoiceData(shipment.id, request.body);
      const buffer = await renderInvoiceXlsx(request.body);
      const base = (request.body.invoiceNo || `invoice-${String(shipment.id)}`).replace(
        /[^\w.-]+/g,
        '_',
      );
      return reply
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.xlsx`)}`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  // ── POST — 마감(issued|confirmed → closed) ──────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/pos/:poId/close',
    {
      schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 409: ApiError } },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const updated = await prisma.spBomPo.updateMany({
        where: { id: po.id, status: { in: ['issued', 'confirmed'] } },
        data: { status: 'closed', closedAt: new Date() },
      });
      if (updated.count === 0) {
        return reply
          .status(409)
          .send({ error: 'PO_ALREADY_CLOSED', message: '이미 마감된 발주서입니다.' });
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  done();
};
