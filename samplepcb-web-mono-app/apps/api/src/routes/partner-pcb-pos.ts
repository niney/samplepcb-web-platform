import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  PartnerPcbChildPoCreateBody,
  PartnerPcbPoDetailResponse,
  PartnerPcbPoListResponse,
  PcbEqFileType,
  PcbPoActionResponse,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  advancePcbPoEq,
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
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';
import { getShopEstimateProfile } from '../lib/g5-db';
import {
  buildPcbEqRequestedEmail,
  buildPcbPoIssuedEmail,
  buildPcbProducedEmail,
  pcbAdminCaseUrl,
  pcbPartnerPortalUrl,
  pcbPriceText,
  sendPcbMail,
} from '../lib/pcb-rfq-email';

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
    MISSING_EQ_FILES: 'EQ 파일과 Working 파일을 먼저 올려 주세요.',
    INVALID_STATUS: '현재 단계에서 실행할 수 없는 전이입니다.',
    NOTHING_TO_REVERT: '되돌릴 단계가 없습니다.',
    FINAL: '이미 마지막 단계입니다.',
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
        return reply.status(400).send({
          error: created.error,
          message:
            created.error === 'CHILD_NOT_QUOTED'
              ? '회신 완료된 하위 견적행만 발주할 수 있습니다.'
              : '하위 견적행이 이 발주 건과 일치하지 않습니다.',
        });
      }

      const spec = await prisma.spOrderSpec.findUnique({ where: { id: created.po.specId } });
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
            deliveryText: created.po.deliveryDate?.toISOString().slice(0, 10) ?? null,
          }),
        );
      }
      const detail = await loadPartnerPcbPoDetail(request.params.poId, ctx.partnerId);
      if (detail === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  done();
};
