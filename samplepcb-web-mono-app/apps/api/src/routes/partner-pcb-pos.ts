import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomInvoiceData,
  BomShipmentFileType,
  PartnerPcbChildPoCreateBody,
  PartnerPcbPoDetailResponse,
  PartnerPcbPoListResponse,
  PartnerPcbRemittanceListResponse,
  PcbEqFileType,
  PcbInvoiceResponse,
  PcbPoActionResponse,
  PcbShipmentAdvanceBody,
  PcbShipmentReceiveBody,
  bomShipmentStatusLabel,
  type PartnerPcbRemittanceTotalType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { isFreeAsPo, loadFreeAsRoundKeys, summarizePcbRemittances } from '../lib/pcb-remittance';
import { loadHousePartnerName } from '../lib/pcb-rfq';
import {
  advancePcbPoEq,
  asPcbPoStatus,
  createChildPcbPo,
  deletePcbEqFile,
  getPcbEqFileDownload,
  loadPartnerPcbPoDetail,
  loadPartnerPcbPoSpecFile,
  loadPartnerPcbPos,
  partnerCanTouchPo,
  revertPcbPoEq,
  uploadPcbEqFile,
} from '../lib/pcb-po';
import {
  advancePcbShipment,
  buildPcbInvoiceDraft,
  countPcbShipmentPos,
  deletePcbShipmentFile,
  detachPcbShipmentPo,
  findPcbShipmentByPo,
  getPcbShipmentFileDownload,
  receivePcbShipment,
  revertPcbShipment,
  savePcbInvoiceData,
  savePcbShipmentFile,
} from '../lib/pcb-shipment';
import { renderInvoiceXlsx } from '../lib/bom-invoice';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';
import { getShopEstimateProfile } from '../lib/g5-db';
import {
  buildPcbEqRequestedEmail,
  buildPcbPoIssuedEmail,
  buildPcbProducedEmail,
  buildPcbShipmentReceivedEmail,
  buildPcbShipmentTurnEmail,
  pcbAdminCaseUrl,
  pcbPartnerPortalUrl,
  pcbPriceText,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
import { resolvePcbPortalCta } from '../lib/pcb-portal-cta';
import { kstDateStr } from '../lib/kst';
import type { MailLogMeta } from '../lib/mail-log';

// ── PCB 발주서·EQ 포털 라우트(P2, requirePartner) — docs/PCB_PARTNER_TRACK.md ──
// 수주 발주서의 EQ 진행(파일 → 승인요청 → 생산)과 MD 하위 발주. EQ 순서·주체는
// 서버(lib)가 강제하고, MD 는 하위 수주자의 RECEIVER 액션을 fallback 대행할 수 있다.

const PoParams = z.object({ poId: z.coerce.bigint() });
const PoFileParams = z.object({ poId: z.coerce.bigint(), fileId: z.coerce.bigint() });

export const partnerPcbPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const requireCtx = (request: { partnerContext?: { partnerId: bigint; partnerName: string } }) => {
    const ctx = request.partnerContext;
    if (ctx === undefined) throw fastify.httpErrors.forbidden();
    return ctx;
  };

  // ── 목록/상세 ───────────────────────────────────────────────────────────────
  fastify.get(
    '/partner/pcb-pos',
    { schema: { response: { 200: PartnerPcbPoListResponse } } },
    async (request) => {
      const ctx = requireCtx(request);
      return {
        result: true as const,
        data: { items: await loadPartnerPcbPos(ctx.partnerId), partnerName: ctx.partnerName },
      };
    },
  );

  fastify.get(
    '/partner/pcb-pos/:poId',
    { schema: { params: PoParams, response: { 200: PartnerPcbPoDetailResponse } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const detail = await loadPartnerPcbPoDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── 수금 현황(P3.11) — 관리자 [송금] 워크큐의 협력사 버전 ────────────────────
  // 내 조직이 **수주한** 발주서만(parentPartnerId 무관 — 받는 쪽이 나면 다 내 수금).
  // 완료된 발주서는 포털 홈의 '진행할 발주'에 안 떠서 상세로 갈 길이 없었다 —
  // 이 목록이 그 진입점이다(2026-08-06 사용자 지적).
  // 무상(free) A/S 회차는 수금 대상이 아니다 — 미수금 0 취급·통화 총계 제외, 행은
  // '무상 A/S' 배지로 남긴다(관리자 송금 큐와 같은 규율, 유상 A/S 는 현행 유지).
  fastify.get(
    '/partner/pcb-remittances',
    { schema: { response: { 200: PartnerPcbRemittanceListResponse } } },
    async (request) => {
      const ctx = requireCtx(request);
      const pos = await prisma.spPcbPo.findMany({
        where: { partnerId: ctx.partnerId },
        include: {
          spec: { select: { projectName: true } },
          remittances: { orderBy: [{ remittedOn: 'asc' }, { id: 'asc' }] },
        },
        orderBy: { issuedAt: 'desc' },
      });
      const freeKeys = await loadFreeAsRoundKeys(pos);
      // 발주처 이름 — parentPartnerId 0 = 우리(하우스), 그 외 = 상위 MD 조직.
      const parentIds = [...new Set(pos.map((p) => p.parentPartnerId).filter((id) => id !== 0n))];
      const parents =
        parentIds.length === 0
          ? []
          : await prisma.spPartner.findMany({
              where: { id: { in: parentIds } },
              select: { id: true, name: true },
            });
      const parentName = new Map(parents.map((p) => [p.id.toString(), p.name]));
      const houseName = await loadHousePartnerName();

      const items = pos.map((po) => {
        const isFreeAs = isFreeAsPo(freeKeys, po);
        const summary = summarizePcbRemittances(po, po.remittances);
        return {
          poId: Number(po.id),
          projectName: po.spec.projectName,
          ordererName:
            po.parentPartnerId === 0n
              ? houseName
              : (parentName.get(po.parentPartnerId.toString()) ?? '중개 조직'),
          poStatus: asPcbPoStatus(po.status),
          issuedAt: po.issuedAt.toISOString(),
          isFreeAs,
          summary: isFreeAs ? { ...summary, balance: 0 } : summary,
          remittances: po.remittances.map((r) => ({
            id: Number(r.id),
            remittedOn: r.remittedOn.toISOString(),
            currency: r.currency,
            amount: Number(r.amount),
            memo: r.memo,
          })),
        };
      });

      const byCurrency = new Map<string, PartnerPcbRemittanceTotalType>();
      for (const it of items) {
        if (it.isFreeAs) continue; // 무상 A/S — 총계에 섞으면 미수금이 거짓말을 한다
        const cur = byCurrency.get(it.summary.currency) ?? {
          currency: it.summary.currency,
          poAmount: 0,
          paidAmount: 0,
          balance: 0,
          poCount: 0,
        };
        cur.poAmount += it.summary.poAmount;
        cur.paidAmount += it.summary.paidAmount;
        cur.balance += it.summary.balance;
        cur.poCount += 1;
        byCurrency.set(it.summary.currency, cur);
      }

      return {
        result: true as const,
        data: {
          items,
          totals: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
          unpaidCount: items.filter((i) => i.summary.balance > 0).length,
        },
      };
    },
  );

  // ── 스펙 파일(거버) 프록시 ──────────────────────────────────────────────────
  fastify.get(
    '/partner/pcb-pos/:poId/spec-files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const file = await loadPartnerPcbPoSpecFile(
        request.params.poId,
        ctx.partnerId,
        request.params.fileId,
      );
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // ── EQ 첨부 — 업로드/삭제는 발주접수(issued)에서만(승인요청 후 잠금) ─────────
  fastify.post(
    '/partner/pcb-pos/:poId/eq-files',
    { schema: { params: PoParams, response: { 200: PartnerPcbPoDetailResponse, 400: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const { files, fields } = await collectMultipart(request);
      const kind = PcbEqFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined) {
        return reply.status(400).send({
          error: 'BAD_UPLOAD',
          message: 'fileType(eq|working)과 파일이 필요합니다.',
        });
      }
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.status !== 'issued') {
        return reply.status(409).send({
          error: 'EQ_LOCKED',
          message: 'EQ 승인요청 후에는 파일을 바꿀 수 없습니다 — 요청을 되돌린 뒤 교체하세요.',
        });
      }
      const uploadedBy = po.partnerId === ctx.partnerId ? 'PARTNER' : 'MASTER_DEALER';
      await uploadPcbEqFile(po.id, file, kind.data, uploadedBy);
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  fastify.delete(
    '/partner/pcb-pos/:poId/eq-files/:fileId',
    { schema: { params: PoFileParams, response: { 200: PartnerPcbPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.status !== 'issued') {
        return reply.status(409).send({
          error: 'EQ_LOCKED',
          message: 'EQ 승인요청 후에는 파일을 바꿀 수 없습니다 — 요청을 되돌린 뒤 교체하세요.',
        });
      }
      const removed = await deletePcbEqFile(po.id, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  fastify.get(
    '/partner/pcb-pos/:poId/eq-files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const file = await getPcbEqFileDownload(po.id, request.params.fileId);
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // ── EQ 전이(RECEIVER — MD fallback 포함, 순서는 expectedFrom 으로 고정) ──────
  const TRANSITION_MESSAGES: Record<string, string> = {
    DELEGATED: 'MD 경유 발주서입니다 — EQ 는 하위 발주서에서 진행됩니다.',
    NOT_YOUR_TURN: '지금은 상대 차례입니다.',
    INVALID_STATUS: '현재 단계에서 실행할 수 없는 전이입니다.',
    NOTHING_TO_REVERT: '되돌릴 단계가 없습니다.',
    FINAL: '이미 마지막 단계입니다.',
    ORDER_CANCELED: '취소된 주문입니다 — 진행을 멈추고 샘플피씨비 담당자에게 문의해 주세요.',
  };

  const transitionMessage = (error: string): string =>
    TRANSITION_MESSAGES[error] ?? '전이할 수 없습니다.';

  fastify.post(
    '/partner/pcb-pos/:poId/eq-request',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbPoEq(po.id, { kind: 'partner', partnerId: ctx.partnerId }, 'issued');
      if (!res.ok)
        return reply.status(409).send({ error: res.error, message: transitionMessage(res.error) });

      // EQ 승인은 항상 루트 관리자(D3) — 운영자 메일로 통지.
      const [profile, spec] = await Promise.all([
        getShopEstimateProfile(),
        prisma.spOrderSpec.findUnique({ where: { id: po.specId } }),
      ]);
      void sendPcbMail(
        request.log,
        profile?.managerEmail,
        buildPcbEqRequestedEmail({
          partnerName: ctx.partnerName,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          statusLabel: 'EQ 승인요청',
          targetUrl: pcbAdminCaseUrl(po.specId.toString()),
          targetLabel: 'Case 상세 열기',
        }),
        {
          kind: 'pcb_eq_requested',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          params: { poId: String(po.id), partnerName: ctx.partnerName },
        },
      );
      return { result: true as const };
    },
  );

  fastify.post(
    '/partner/pcb-pos/:poId/production-start',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbPoEq(po.id, { kind: 'partner', partnerId: ctx.partnerId }, 'eq_done');
      if (!res.ok)
        return reply.status(409).send({ error: res.error, message: transitionMessage(res.error) });
      return { result: true as const };
    },
  );

  fastify.post(
    '/partner/pcb-pos/:poId/production-complete',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbPoEq(
        po.id,
        { kind: 'partner', partnerId: ctx.partnerId },
        'producing',
      );
      if (!res.ok)
        return reply.status(409).send({ error: res.error, message: transitionMessage(res.error) });

      // 생산완료 → 발주 주체 통지(관리자=운영자 메일 / MD=조직 메일) — P3 선적 신호.
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: po.specId } });
      const projectName = spec?.projectName ?? `Q${po.specId.toString()}`;
      const producedMeta: MailLogMeta = {
        kind: 'pcb_produced',
        refType: 'pcb_spec',
        refId: po.specId,
        sentBy: request.user.mbId,
        params: { poId: String(po.id), partnerName: ctx.partnerName },
      };
      if (po.parentPartnerId === 0n) {
        const profile = await getShopEstimateProfile();
        void sendPcbMail(
          request.log,
          profile?.managerEmail,
          buildPcbProducedEmail({
            partnerName: ctx.partnerName,
            projectName,
            statusLabel: '생산완료',
            targetUrl: pcbAdminCaseUrl(po.specId.toString()),
            targetLabel: 'Case 상세 열기',
          }),
          producedMeta,
        );
      } else {
        const md = await prisma.spPartner.findUnique({ where: { id: po.parentPartnerId } });
        void sendPcbMail(
          request.log,
          md?.contactEmail,
          buildPcbProducedEmail({
            partnerName: ctx.partnerName,
            projectName,
            statusLabel: '생산완료',
            targetUrl: pcbPartnerPortalUrl(),
            targetLabel: '파트너 포털 열기',
          }),
          producedMeta,
        );
      }
      return { result: true as const };
    },
  );

  fastify.post(
    '/partner/pcb-pos/:poId/eq-revert',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await partnerCanTouchPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await revertPcbPoEq(po.id, { kind: 'partner', partnerId: ctx.partnerId });
      if (!res.ok)
        return reply.status(409).send({ error: res.error, message: transitionMessage(res.error) });
      return { result: true as const };
    },
  );

  // ── MD 하위 발주 — 하위 회신 견적행 기준(대상·통화·금액 유도) ─────────────────
  fastify.post(
    '/partner/pcb-pos/:poId/children',
    {
      schema: {
        params: PoParams,
        body: PartnerPcbChildPoCreateBody,
        response: { 200: PartnerPcbPoDetailResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const created = await createChildPcbPo(request.params.poId, ctx.partnerId, request.body);
      if (!created.ok) {
        if (created.error === 'PO_NOT_FOUND' || created.error === 'NOT_YOUR_PO')
          return reply.notFound('발주서를 찾을 수 없습니다');
        if (created.error === 'ALREADY_ISSUED')
          return reply
            .status(409)
            .send({ error: created.error, message: '이 하위 협력사에게 이미 발주했습니다.' });
        if (created.error === 'ORDER_CANCELED')
          return reply.status(409).send({
            error: created.error,
            message: '취소된 주문입니다 — 하위 발주를 시작하지 말고 샘플피씨비 담당자에게 문의해 주세요.',
          });
        // 회차 조건 복사 경로 — 원회차에 대상 하위 발주가 없으면 복사할 원본이 없다(409).
        if (created.error === 'NO_ORIGIN_CHILD_PO')
          return reply.status(409).send({
            error: created.error,
            message:
              '원주문(round 0)에 이 협력사로의 하위 발주가 없습니다 — 복사할 조건이 없어 회차 하위 발주를 만들 수 없습니다.',
          });
        const badRequestMessages: Record<string, string> = {
          CHILD_NOT_QUOTED: '회신 완료된 하위 견적행만 발주할 수 있습니다.',
          CHILD_RFQ_REQUIRED:
            '원주문(round 0) 하위 발주는 회신 완료된 하위 견적행(childRfqId)이 필요합니다.',
          PARTNER_REQUIRED: '회차 하위 발주는 대상 협력사(partnerId)를 지정해야 합니다.',
        };
        return reply.status(400).send({
          error: created.error,
          message:
            badRequestMessages[created.error] ?? '하위 견적행이 이 발주 건과 일치하지 않습니다.',
        });
      }

      const [spec, portalCta] = await Promise.all([
        prisma.spOrderSpec.findUnique({ where: { id: created.po.specId } }),
        resolvePcbPortalCta(created.po.partnerId),
      ]);
      if (spec !== null) {
        void sendPcbMail(
          request.log,
          created.partner.contactEmail,
          buildPcbPoIssuedEmail({
            partnerName: created.partner.name,
            requesterName: ctx.partnerName,
            projectName: spec.projectName,
            qty: spec.qty,
            priceText: pcbPriceText(
              created.po.currency,
              Number(created.po.priceOriginal),
              created.po.subCurrency,
              created.po.subPriceOriginal === null ? null : Number(created.po.subPriceOriginal),
            ),
            deliveryText: created.po.deliveryDate === null ? null : kstDateStr(created.po.deliveryDate),
            ...portalCta,
          }),
          {
            kind: 'pcb_po_issued',
            refType: 'pcb_spec',
            refId: created.po.specId,
            sentBy: request.user.mbId,
            params: {
              poId: String(created.po.id),
              partnerName: created.partner.name,
              mdTrack: true,
            },
          },
        );
      }
      const detail = await loadPartnerPcbPoDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ═══ P3 선적 — 보내는측 발송·핑퐁, MD 입고확인, 첨부, 상업송장 ═══════════════

  const SHIP_ERROR_MESSAGES: Record<string, string> = {
    NOT_PRODUCED: '생산완료된 발주서만 발송할 수 있습니다.',
    PARTNER_COUNTRY_REQUIRED: '조직 소재 국가가 없습니다 — 샘플피씨비 담당자에게 문의하세요.',
    OUTBOUND_BLOCKED: '하위 협력사 입고 확인이 끝나야 출고할 수 있습니다.',
    ALREADY_FINAL: '이미 마지막 단계입니다.',
    NOT_YOUR_TURN: '지금은 상대 차례입니다.',
    MISSING_SHIP_DATE: '출고예정일을 입력해 주세요.',
    MISSING_INVOICE_FILE: 'Invoice 첨부가 필요합니다 — 상업송장 생성기로 만들 수 있습니다.',
    MISSING_TRACKING: '택배사와 송장번호를 입력해 주세요.',
    NOTHING_TO_REVERT: '되돌릴 단계가 없습니다.',
    RECEIVE_LOCKED: '입고확인된 발송은 되돌릴 수 없습니다.',
    RECEIVE_REQUIRED: '입고 완료는 받는 쪽이 [입고 확인]으로 처리합니다.',
    ORDER_CANCELED: '취소된 주문입니다 — 진행을 멈추고 샘플피씨비 담당자에게 문의해 주세요.',
    NOT_SHIPPED: '발송 시작 전에는 처리할 수 없습니다.',
    NOT_PREPARING: '발송 준비 단계에서만 뺄 수 있습니다.',
  };
  const shipError = (error: string): { error: string; message: string } => ({
    error,
    message: SHIP_ERROR_MESSAGES[error] ?? '처리할 수 없습니다.',
  });

  /** 조작 인가 — 수주(보내는측) 또는 발주(MD 받는측) 소속 발주서. */
  const loadTouchablePo = async (poId: bigint, partnerId: bigint) => {
    const po = await prisma.spPcbPo.findUnique({
      where: { id: poId },
      include: { partner: true, spec: true },
    });
    if (po === null) return null;
    if (po.partnerId !== partnerId && po.parentPartnerId !== partnerId) return null;
    return po;
  };

  fastify.post(
    '/partner/pcb-pos/:poId/shipment/advance',
    {
      schema: {
        params: PoParams,
        body: PcbShipmentAdvanceBody,
        response: { 200: PartnerPcbPoDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbShipment(
        po,
        { kind: 'partner', partnerId: ctx.partnerId },
        request.body,
      );
      if (!res.ok) return reply.status(409).send(shipError(res.error));

      // 협력사 전이 → 받는측 통지(관리자=운영자 메일 / MD 입고=조직 메일).
      // 묶음이면 이 한 통이 발주 여러 건을 가리킨다 — 건수를 문구에 싣는다(여정 9호).
      const shipPoCount = await countPcbShipmentPos(po.id);
      const mode = res.shipment.mode === 'domestic' ? 'domestic' : 'international';
      const statusLabel = bomShipmentStatusLabel(mode, res.to);
      const turnMeta: MailLogMeta = {
        kind: 'pcb_shipment_turn',
        refType: 'pcb_spec',
        refId: po.specId,
        sentBy: request.user.mbId,
        params: { poId: String(po.id), partnerName: ctx.partnerName, status: res.to },
      };
      if (res.shipment.receiverKind === 'md') {
        // 수신자가 MD 조직 — 무계정 조직이면 포털 버튼 대신 대행 안내(재점검 #15).
        const receiverPartnerId = res.shipment.receiverPartnerId;
        const [md, portalCta] = await Promise.all([
          prisma.spPartner.findUnique({ where: { id: receiverPartnerId ?? 0n } }),
          receiverPartnerId === null ? null : resolvePcbPortalCta(receiverPartnerId),
        ]);
        void sendPcbMail(
          request.log,
          md?.contactEmail,
          buildPcbShipmentTurnEmail({
            recipientName: md?.name ?? '중개 조직',
            projectName: po.spec.projectName,
            statusLabel,
            nextLabel: null,
            targetUrl: pcbPartnerPortalUrl(),
            targetLabel: '파트너 포털 열기',
            poCount: shipPoCount,
            ...(portalCta ?? {}),
          }),
          turnMeta,
        );
      } else {
        const profile = await getShopEstimateProfile();
        void sendPcbMail(
          request.log,
          profile?.managerEmail,
          buildPcbShipmentTurnEmail({
            recipientName: '샘플피씨비',
            projectName: po.spec.projectName,
            statusLabel,
            nextLabel: null,
            targetUrl: pcbAdminCaseUrl(po.specId.toString()),
            targetLabel: 'Case 상세 열기',
            poCount: shipPoCount,
          }),
          turnMeta,
        );
      }
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  fastify.post(
    '/partner/pcb-pos/:poId/shipment/revert',
    { schema: { params: PoParams, response: { 200: PartnerPcbPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await revertPcbShipment(po, { kind: 'partner', partnerId: ctx.partnerId });
      if (!res.ok) return reply.status(409).send(shipError(res.error));
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // MD 입고확인 — 받는측이 MD 인 발송만(서버 판정).
  fastify.post(
    '/partner/pcb-pos/:poId/shipment/receive',
    {
      schema: {
        params: PoParams,
        body: PcbShipmentReceiveBody,
        response: { 200: PartnerPcbPoDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await receivePcbShipment(
        po,
        { kind: 'partner', partnerId: ctx.partnerId },
        request.body.note ?? null,
      );
      if (!res.ok) return reply.status(409).send(shipError(res.error));

      // 보내는측(하위 수주 조직) 통지 — 무계정이면 대행 안내(재점검 #15).
      const [portalCta, shipPoCount] = await Promise.all([
        resolvePcbPortalCta(po.partnerId),
        countPcbShipmentPos(po.id),
      ]);
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbShipmentReceivedEmail({
          partnerName: po.partner.name,
          projectName: po.spec.projectName,
          note: request.body.note ?? null,
          poCount: shipPoCount,
          ...portalCta,
        }),
        {
          kind: 'pcb_shipment_received',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          params: { poId: String(po.id), partnerName: po.partner.name },
        },
      );
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // 묶음에서 제외 — preparing·대표 제외(보내는측).
  fastify.delete(
    '/partner/pcb-pos/:poId/shipment/membership',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await detachPcbShipmentPo(po, { kind: 'partner', partnerId: ctx.partnerId });
      if (!res.ok) return reply.status(409).send(shipError(res.error));
      return { result: true as const };
    },
  );

  // 선적 첨부(invoice/airwaybill — 종류별 1건 교체).
  fastify.post(
    '/partner/pcb-pos/:poId/shipment/files',
    { schema: { params: PoParams, response: { 200: PartnerPcbPoDetailResponse, 400: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const { files, fields } = await collectMultipart(request);
      const kind = BomShipmentFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined)
        return reply
          .status(400)
          .send({ error: 'BAD_UPLOAD', message: 'fileType(invoice|airwaybill)과 파일이 필요합니다.' });
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      // 발송이 없으면 생성 시도(보내는측 첫 준비 — produced·게이팅 가드는 lib).
      let shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) {
        const advanceable = await advancePcbShipment(
          po,
          { kind: 'partner', partnerId: ctx.partnerId },
          {},
        );
        // 첫 전이는 필수값 부족으로 실패할 수 있다 — 발송 생성만 필요하므로 재조회.
        shipment = await findPcbShipmentByPo(po.id);
        if (shipment === null)
          return reply
            .status(409)
            .send(shipError(advanceable.ok ? 'NOT_SHIPPED' : advanceable.error));
      }
      const uploadedBy = po.partnerId === ctx.partnerId ? 'PARTNER' : 'MASTER_DEALER';
      await savePcbShipmentFile(shipment.id, kind.data, file, uploadedBy);
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  fastify.delete(
    '/partner/pcb-pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams, response: { 200: PartnerPcbPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.notFound('발송이 없습니다');
      // Invoice 는 선적요청 진입의 필수 서류 — 진입 후 삭제하면 서류 없는 국제 선적이
      // 진행된다(프로브 W7). 되돌려 준비 단계로 내린 뒤에만 교체할 수 있다.
      if (shipment.status !== 'preparing') {
        return reply.status(409).send({
          error: 'DOC_LOCKED',
          message: '발송이 시작된 뒤에는 첨부를 바꿀 수 없습니다 — 되돌린 뒤 교체하세요.',
        });
      }
      const removed = await deletePcbShipmentFile(shipment.id, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      const detail = await loadPartnerPcbPoDetail(po.id, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  fastify.get(
    '/partner/pcb-pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.notFound('발송이 없습니다');
      const file = await getPcbShipmentFileDownload(shipment.id, request.params.fileId);
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // 상업송장(D23 동형 — 국제 전용).
  fastify.get(
    '/partner/pcb-pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        // coerce.boolean 은 'false' 문자열도 true 라 enum→transform 으로 판정한다.
        querystring: z.object({
          fresh: z
            .enum(['true', 'false'])
            .default('false')
            .transform((v) => v === 'true'),
        }),
        response: { 200: PcbInvoiceResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      let shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) {
        await advancePcbShipment(po, { kind: 'partner', partnerId: ctx.partnerId }, {});
        shipment = await findPcbShipmentByPo(po.id);
      }
      if (shipment === null) return reply.status(409).send(shipError('NOT_SHIPPED'));
      const draft = await buildPcbInvoiceDraft(shipment, request.query.fresh);
      if (!draft.ok)
        return reply
          .status(409)
          .send({ error: draft.error, message: '국내 발송은 상업송장을 사용하지 않습니다.' });
      return { result: true as const, data: draft.data };
    },
  );

  fastify.put(
    '/partner/pcb-pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        body: BomInvoiceData,
        response: { 200: PcbPoActionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.status(409).send(shipError('NOT_SHIPPED'));
      await savePcbInvoiceData(shipment.id, request.body);
      return { result: true as const };
    },
  );

  fastify.post(
    '/partner/pcb-pos/:poId/shipment/invoice/xlsx',
    { schema: { params: PoParams, body: BomInvoiceData } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await loadTouchablePo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.notFound('발송이 없습니다');
      await savePcbInvoiceData(shipment.id, request.body);
      const buffer = await renderInvoiceXlsx(request.body);
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename*=UTF-8''invoice-${String(request.params.poId)}.xlsx`)
        .send(buffer);
    },
  );

  done();
};
