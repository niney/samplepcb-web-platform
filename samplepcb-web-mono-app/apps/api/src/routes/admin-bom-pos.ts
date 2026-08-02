import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomPoCreateBody,
  AdminBomPoCreateResponse,
  AdminBomPoCrossListQuery,
  AdminBomPoCrossListResponse,
  AdminBomPoListResponse,
  AdminBomPoMutationResponse,
  AdminBomPartPackageActionBody,
  AdminBomPartPackageResponse,
  AdminBomShipmentCrossListQuery,
  AdminBomShipmentCrossListResponse,
  AdminBomShipmentReceiveBody,
  AdminBomShipmentUpsertBody,
  ApiError,
  BomInvoiceData,
  BomInvoiceDraftResponse,
  BomPartnerQuotationResponse,
  BomShipmentPackingListResponse,
  BomShipmentPackingListSaveBody,
  BomShipmentStatementResponse,
  BomShipmentFileType,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
} from '@sp/api-contract';
import type { AdminBomPoCrossCountsType, AdminBomShipmentCrossCountsType } from '@sp/api-contract';
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
  loadAdminPoCrossList,
  loadAdminPos,
  loadAdminShipmentCrossList,
  receiveShipment,
  saveShipmentFile,
  upsertShipment,
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
import {
  buildBomPoIssuedEmail,
  buildShipmentReceivedEmail,
  buildShipmentTurnPartnerEmail,
  sendBomRfqMail,
} from '../lib/rfq-email';
import {
  BomPackingError,
  loadPartPackage,
  loadShipmentPackingList,
  markShipmentPackingListPrinted,
  saveShipmentPackingList,
  updatePartPackage,
} from '../lib/bom-packing';
import { shipmentModeFromCountry } from '../lib/bom-shipment-policy';

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
const ShipmentIdParams = z.object({ shipmentId: z.coerce.bigint() });
const PackageCodeParams = z.object({ code: z.string().trim().min(1).max(100) });

const CREATE_ERROR_MESSAGE: Record<string, string> = {
  QUOTE_NOT_FOUND: '견적을 찾을 수 없습니다.',
  NOT_PAID: '결제 확인(입금) 후에 발주할 수 있습니다.',
  NO_ELIGIBLE_ROWS: '협력사 회신으로 선정된 부품행이 없는 협력사가 포함되어 있습니다.',
  ALREADY_ISSUED: '이미 발주서가 발행된 협력사가 포함되어 있습니다(재발행은 삭제 후).',
  PARTNER_COUNTRY_REQUIRED: '발주 전에 선택한 협력사의 국가를 등록해 주세요.',
};

export const adminBomPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 선적 해석·보장(§6.10 조인 기반) — 소속 선적을 찾고, 없으면 preparing 으로 생성.
  const ensureAdminShipment = async (
    quoteId: bigint,
    poId: bigint,
  ): Promise<
    | { ok: true; shipment: Awaited<ReturnType<typeof prisma.spBomShipment.create>> }
    | { ok: false; error: 'PO_NOT_FOUND' | 'PARTNER_COUNTRY_REQUIRED' }
  > => {
    const po = await prisma.spBomPo.findUnique({
      where: { id: poId },
      include: { shipmentLink: { include: { shipment: true } }, partner: true },
    });
    if (po?.quoteId !== quoteId) return { ok: false, error: 'PO_NOT_FOUND' };
    if (po.shipmentLink !== null) return { ok: true, shipment: po.shipmentLink.shipment };
    const mode = shipmentModeFromCountry(po.partner.country);
    if (mode === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
    const created = await prisma.spBomShipment.create({
      data: {
        poId: po.id,
        quoteId: po.quoteId,
        mode,
        status: 'preparing',
      },
    });
    await prisma.spBomShipmentPo.create({ data: { shipmentId: created.id, poId: po.id } });
    return { ok: true, shipment: created };
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

  // PO별 협력사 견적서 — 묶음 선적의 다른 Case도 poId 하나로 조회하도록 횡단 경로 제공.
  fastify.get(
    '/bom-pos/:poId/quotation',
    {
      schema: {
        params: z.object({ poId: z.coerce.bigint() }),
        response: { 200: BomPartnerQuotationResponse },
      },
    },
    async (request, reply) => {
      const data = await loadPartnerQuotationDocument(request.params.poId);
      if (data === null) return reply.notFound('견적서를 찾을 수 없습니다');
      return { result: true as const, data };
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
          message:
            result.error === 'PARTNER_COUNTRY_REQUIRED' && result.detail !== undefined
              ? `${CREATE_ERROR_MESSAGE[result.error] ?? '협력사 국가를 먼저 등록해 주세요.'} (${result.detail})`
              : (CREATE_ERROR_MESSAGE[result.error] ?? '발주서 생성에 실패했습니다.'),
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
        const messages: Record<typeof result.error, string> = {
          PO_NOT_FOUND: '발주서를 찾을 수 없습니다.',
          INVALID_STATUS: '발송 구분에 맞지 않는 상태입니다.',
          PARTNER_COUNTRY_REQUIRED: '협력사 관리에서 국가를 먼저 등록해 주세요.',
          MISSING_PACKING_LIST: '선적 리스트와 QR 라벨을 먼저 저장해 주세요.',
          MISSING_TRACKING: '국내 발송은 택배사와 송장번호가 필요합니다.',
          RECEIVE_REQUIRED: '국내 입고 완료는 입고 확인 버튼으로 처리해 주세요.',
        };
        return reply.status(409).send({
          error: result.error,
          message: messages[result.error],
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
      const result = await receiveShipment(po.id, request.body.note ?? null, {
        type: 'ADMIN',
        mbId: request.user.mbId,
      });
      if (!result.ok) {
        return reply
          .status(409)
          .send({
            error: result.error,
            message:
              result.error === 'PARTNER_COUNTRY_REQUIRED'
                ? '협력사 관리에서 국가를 먼저 등록해 주세요.'
                : '입고 확인에 실패했습니다.',
          });
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
    {
      schema: {
        params: PoParams,
        response: { 200: AdminBomPoMutationResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { files, fields } = await collectMultipart(request);
      const kind = BomShipmentFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined) {
        return reply.status(400).send({
          error: 'BAD_UPLOAD',
          message: 'fileType(invoice|airwaybill)과 파일이 필요합니다.',
        });
      }
      // 선적 문서가 없으면 preparing 으로 생성해 파일부터 받는다(협력사 흐름과 동일).
      const ensured = await ensureAdminShipment(request.params.id, request.params.poId);
      if (!ensured.ok) {
        if (ensured.error === 'PO_NOT_FOUND') return reply.notFound('발주서를 찾을 수 없습니다');
        return reply.status(409).send({
          error: ensured.error,
          message: '협력사 관리에서 국가를 먼저 등록해 주세요.',
        });
      }
      const saved = await saveShipmentFile(ensured.shipment.id, kind.data, file, 'ADMIN');
      if (!saved) {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Invoice와 AWB는 국외 발송에서만 사용합니다.',
        });
      }
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
  const invoiceModeOf = (
    po: NonNullable<Awaited<ReturnType<typeof loadPoForInvoice>>>,
  ) =>
    po.shipmentLink === null
      ? shipmentModeFromCountry(po.partner.country)
      : asShipmentMode(po.shipmentLink.shipment.mode);

  fastify.get(
    '/bom-quotes/:id/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        querystring: InvoiceQuery,
        response: { 200: BomInvoiceDraftResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPoForInvoice(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const mode = invoiceModeOf(po);
      if (mode === null) {
        return reply.status(409).send({
          error: 'PARTNER_COUNTRY_REQUIRED',
          message: '협력사 관리에서 국가를 먼저 등록해 주세요.',
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
    '/bom-quotes/:id/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        body: BomInvoiceData,
        response: { 200: BomInvoiceDraftResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ensured = await ensureAdminShipment(request.params.id, request.params.poId);
      if (!ensured.ok) {
        if (ensured.error === 'PO_NOT_FOUND') return reply.notFound('발주서를 찾을 수 없습니다');
        return reply.status(409).send({
          error: ensured.error,
          message: '협력사 관리에서 국가를 먼저 등록해 주세요.',
        });
      }
      if (asShipmentMode(ensured.shipment.mode) !== 'international') {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Commercial Invoice는 국외 발송에서만 사용합니다.',
        });
      }
      await saveInvoiceData(ensured.shipment.id, request.body);
      return { result: true as const, data: request.body };
    },
  );

  fastify.post(
    '/bom-quotes/:id/pos/:poId/shipment/invoice/xlsx',
    { schema: { params: PoParams, body: BomInvoiceData } },
    async (request, reply) => {
      const ensured = await ensureAdminShipment(request.params.id, request.params.poId);
      if (!ensured.ok) {
        if (ensured.error === 'PO_NOT_FOUND') return reply.notFound('발주서를 찾을 수 없습니다');
        return reply.status(409).send({
          error: ensured.error,
          message: '협력사 관리에서 국가를 먼저 등록해 주세요.',
        });
      }
      if (asShipmentMode(ensured.shipment.mode) !== 'international') {
        return reply.status(409).send({
          error: 'INTERNATIONAL_DOCUMENT_ONLY',
          message: 'Commercial Invoice는 국외 발송에서만 사용합니다.',
        });
      }
      await saveInvoiceData(ensured.shipment.id, request.body);
      const buffer = await renderInvoiceXlsx(request.body);
      const base = (request.body.invoiceNo || `invoice-${String(ensured.shipment.id)}`).replace(
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

  // ── 선적 리스트·QR 라벨(D24) — 관리자 대리 작성·재인쇄 ──────────────────
  fastify.get(
    '/bom-shipments/:shipmentId/statement',
    {
      schema: {
        params: ShipmentIdParams,
        response: { 200: BomShipmentStatementResponse },
      },
    },
    async (request, reply) => {
      const data = await loadShipmentStatementDocument(request.params.shipmentId);
      if (data === null) return reply.notFound('거래명세서를 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  fastify.get(
    '/bom-shipments/:shipmentId/packing-list',
    {
      schema: {
        params: ShipmentIdParams,
        response: { 200: BomShipmentPackingListResponse },
      },
    },
    async (request, reply) => {
      const data = await loadShipmentPackingList(request.params.shipmentId);
      if (data === null) return reply.notFound('발송을 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  fastify.put(
    '/bom-shipments/:shipmentId/packing-list',
    {
      schema: {
        params: ShipmentIdParams,
        body: BomShipmentPackingListSaveBody,
        response: { 200: BomShipmentPackingListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const data = await saveShipmentPackingList(request.params.shipmentId, request.body, {
          type: 'ADMIN',
          mbId: request.user.mbId,
        });
        return { result: true as const, data };
      } catch (error) {
        if (!(error instanceof BomPackingError)) throw error;
        if (error.code === 'PACKING_NOT_FOUND') {
          return reply.notFound('발송을 찾을 수 없습니다');
        }
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
    '/bom-shipments/:shipmentId/packing-list/print',
    {
      schema: {
        params: ShipmentIdParams,
        response: { 200: BomShipmentPackingListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const data = await markShipmentPackingListPrinted(request.params.shipmentId, {
          type: 'ADMIN',
          mbId: request.user.mbId,
        });
        return { result: true as const, data };
      } catch (error) {
        if (!(error instanceof BomPackingError)) throw error;
        if (error.code === 'PACKING_NOT_FOUND') {
          return reply.notFound('발송을 찾을 수 없습니다');
        }
        return reply
          .status(409)
          .send({ error: error.code, message: 'QR을 먼저 저장한 뒤 인쇄해 주세요.' });
      }
    },
  );

  // QR/수기 labelCode 조회 + 물류 이벤트. token은 권한이 아니며 requireAdmin 후에만 노출·변경.
  fastify.get(
    '/bom-packages/:code',
    {
      schema: {
        params: PackageCodeParams,
        response: { 200: AdminBomPartPackageResponse },
      },
    },
    async (request, reply) => {
      const data = await loadPartPackage(request.params.code);
      if (data === null) return reply.notFound('QR 포장을 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  fastify.post(
    '/bom-packages/:code/actions',
    {
      schema: {
        params: PackageCodeParams,
        body: AdminBomPartPackageActionBody,
        response: { 200: AdminBomPartPackageResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const data = await updatePartPackage(request.params.code, request.body, {
          type: 'ADMIN',
          mbId: request.user.mbId,
        });
        if (data === null) return await reply.notFound('QR 포장을 찾을 수 없습니다');
        return { result: true as const, data };
      } catch (error) {
        if (!(error instanceof BomPackingError)) throw error;
        return reply.status(409).send({
          error: error.code,
          message:
            error.code === 'PACKAGE_LOCATION_REQUIRED'
              ? '보관 위치를 입력해 주세요.'
              : '현재 상태에서는 이 처리를 할 수 없습니다.',
        });
      }
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

  // ── 횡단 워크큐(관리자 메뉴 재편) — 발주/선적·배송 메뉴의 전 Case 목록 ──────
  // 규모가 작아 전체 파생 후 메모리 페이지네이션(admin-bom-orders 관례 동일).

  fastify.get(
    '/bom-pos',
    {
      schema: {
        querystring: AdminBomPoCrossListQuery,
        response: { 200: AdminBomPoCrossListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab } = request.query;
      const all = await loadAdminPoCrossList();
      const counts: AdminBomPoCrossCountsType = {
        issued: all.filter((po) => po.status === 'issued').length,
        confirmed: all.filter((po) => po.status === 'confirmed').length,
        closed: all.filter((po) => po.status === 'closed').length,
      };
      const filtered = all.filter((po) => po.status === tab);
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        result: true as const,
        data: { items, total: filtered.length, page, pageSize, counts },
      };
    },
  );

  fastify.get(
    '/bom-shipments',
    {
      schema: {
        querystring: AdminBomShipmentCrossListQuery,
        response: { 200: AdminBomShipmentCrossListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab } = request.query;
      const all = await loadAdminShipmentCrossList();
      const counts: AdminBomShipmentCrossCountsType = {
        adminPending: all.filter((s) => s.adminPending).length,
        active: all.filter((s) => s.receivedAt === null).length,
        received: all.filter((s) => s.receivedAt !== null).length,
      };
      const filtered =
        tab === 'admin_pending'
          ? all.filter((s) => s.adminPending)
          : tab === 'active'
            ? all.filter((s) => s.receivedAt === null)
            : all.filter((s) => s.receivedAt !== null);
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        result: true as const,
        data: { items, total: filtered.length, page, pageSize, counts },
      };
    },
  );

  done();
};
