import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbRfqActionResponse,
  AdminPcbRfqSendBody,
  AdminPcbRfqSendResponse,
  ApiError,
  PartnerPcbRfqDetailResponse,
  PartnerPcbRfqListResponse,
  PcbRfqChildSelectBody,
  PcbRfqReplyBody,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  diffSendPcbRfqs,
  loadAdminPcbRfqs,
  loadPartnerPcbRfqDetail,
  loadPartnerPcbRfqs,
  loadPartnerPcbSpecFile,
  saveMdChildSelection,
  savePcbRfqReply,
} from '../lib/pcb-rfq';
import {
  buildPcbRfqRepliedEmail,
  buildPcbRfqRequestEmail,
  magicPcbReplyUrl,
  pcbAdminCaseUrl,
  pcbPartnerPortalUrl,
  pcbPriceText,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
import { downloadFromFileServer } from '../lib/file-server';
import { getShopEstimateProfile } from '../lib/g5-db';

// ── PCB 파트너 RFQ 포털 라우트(requirePartner) — docs/PCB_PARTNER_TRACK.md §5.4 ──
// 받은 견적요청 워크큐·상세(스펙 사양 + 거버 파일 프록시)·회신, MD 2단(하위 배정 diff·
// 하위 선정+마진). 소속 판정은 매 요청 서버(requirePartner) — JWT 에 조직 클레임 없음.

const RfqParams = z.object({ rfqId: z.coerce.bigint() });
const RfqFileParams = z.object({ rfqId: z.coerce.bigint(), fileId: z.coerce.bigint() });

export const partnerPcbRfqRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const requireCtx = (request: { partnerContext?: { partnerId: bigint; partnerName: string } }) => {
    const ctx = request.partnerContext;
    if (ctx === undefined) throw fastify.httpErrors.forbidden();
    return ctx;
  };

  /** 본인 조직이 받은 행인지 확인 후 반환(아니면 404 — 존재 은닉). */
  const loadMyRfq = async (rfqId: bigint, partnerId: bigint) => {
    const rfq = await prisma.spPcbRfq.findUnique({
      where: { id: rfqId },
      include: { spec: true, partner: true },
    });
    if (rfq === null) return null;
    if (rfq.partnerId !== partnerId) return null;
    return rfq;
  };

  // ── GET — 받은 견적요청 목록(관리자발 + MD발 전 트랙) ───────────────────────
  fastify.get(
    '/partner/pcb-rfqs',
    { schema: { response: { 200: PartnerPcbRfqListResponse } } },
    async (request) => {
      const ctx = requireCtx(request);
      return {
        result: true as const,
        data: { items: await loadPartnerPcbRfqs(ctx.partnerId), partnerName: ctx.partnerName },
      };
    },
  );

  // ── GET — 상세(스펙 사양·파일 + MD 확장: children/배정 후보) ────────────────
  fastify.get(
    '/partner/pcb-rfqs/:rfqId',
    { schema: { params: RfqParams, response: { 200: PartnerPcbRfqDetailResponse } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const detail = await loadPartnerPcbRfqDetail(request.params.rfqId, ctx.partnerId);
      if (detail === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── PUT — 회신 저장(가격+예상 배송일 필수) → 요청 주체에게 통지 메일 ─────────
  fastify.put(
    '/partner/pcb-rfqs/:rfqId',
    {
      schema: {
        params: RfqParams,
        body: PcbRfqReplyBody,
        response: { 200: PartnerPcbRfqDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const rfq = await loadMyRfq(request.params.rfqId, ctx.partnerId);
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');

      const saved = await savePcbRfqReply(rfq.id, request.body);
      if (!saved.ok) {
        if (saved.error === 'EXCHANGE_RATE_UNAVAILABLE')
          return reply.status(409).send({
            error: saved.error,
            message: '환율 정보가 준비되지 않았습니다 — 관리자에게 문의해 주세요.',
          });
        return reply.status(409).send({
          error: 'NOT_EDITABLE',
          message: '선정이 끝난 견적은 수정할 수 없습니다.',
        });
      }

      // 회신 도착 통지 — 관리자 트랙이면 운영자 메일, MD 하위 트랙이면 MD 조직 메일.
      const updated = await prisma.spPcbRfq.findUnique({ where: { id: rfq.id } });
      if (updated !== null) {
        const priceText = pcbPriceText(
          updated.currency,
          updated.priceOriginal === null ? null : Number(updated.priceOriginal),
          updated.subCurrency,
          updated.subPriceOriginal === null ? null : Number(updated.subPriceOriginal),
        );
        const deliveryText = updated.quotedDeliveryDate?.toISOString().slice(0, 10) ?? null;
        if (rfq.parentPartnerId === 0n) {
          const profile = await getShopEstimateProfile();
          void sendPcbMail(
            request.log,
            profile?.managerEmail,
            buildPcbRfqRepliedEmail({
              partnerName: ctx.partnerName,
              projectName: rfq.spec.projectName,
              specId: rfq.specId.toString(),
              priceText,
              deliveryText,
              targetUrl: pcbAdminCaseUrl(rfq.specId.toString()),
              targetLabel: 'Case 상세 열기',
            }),
          );
        } else {
          const md = await prisma.spPartner.findUnique({ where: { id: rfq.parentPartnerId } });
          void sendPcbMail(
            request.log,
            md?.contactEmail,
            buildPcbRfqRepliedEmail({
              partnerName: ctx.partnerName,
              projectName: rfq.spec.projectName,
              specId: rfq.specId.toString(),
              priceText,
              deliveryText,
              targetUrl: pcbPartnerPortalUrl(),
              targetLabel: '파트너 포털 열기',
            }),
          );
        }
      }

      const detail = await loadPartnerPcbRfqDetail(rfq.id, ctx.partnerId);
      if (detail === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── GET — 스펙 파일(거버 등) 프록시 다운로드(pathToken 미노출·소유 행만) ─────
  fastify.get(
    '/partner/pcb-rfqs/:rfqId/files/:fileId',
    { schema: { params: RfqFileParams } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const file = await loadPartnerPcbSpecFile(
        request.params.rfqId,
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

  // ── POST — MD 하위 배정 diff(내 소속 하위 조직만·신규만 메일) ────────────────
  fastify.post(
    '/partner/pcb-rfqs/:rfqId/children',
    {
      schema: {
        params: RfqParams,
        body: AdminPcbRfqSendBody,
        response: { 200: AdminPcbRfqSendResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const rfq = await loadMyRfq(request.params.rfqId, ctx.partnerId);
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      // MD 하위 배정은 관리자→나(parent=0) 행에서만 트랙이 열린다.
      if (rfq.parentPartnerId !== 0n) return reply.notFound('견적요청을 찾을 수 없습니다');

      // 제시 납기 하향 상속(레거시 승계) — 명시 없으면 관리자 제시일을 그대로 전달.
      const suggested =
        request.body.suggestedDeliveryDate ??
        rfq.suggestedDeliveryDate?.toISOString().slice(0, 10) ??
        null;

      const diff = await diffSendPcbRfqs({
        specId: rfq.specId,
        parentPartnerId: ctx.partnerId,
        partnerIds: request.body.partnerIds,
        suggestedDeliveryDate: suggested,
        reorderRound: rfq.reorderRound,
      });
      if (!diff.ok) {
        if (diff.error === 'PARTNER_INVALID')
          return reply
            .status(400)
            .send({ error: 'INVALID_PARTNER', message: diff.detail ?? '협력사 검증 실패' });
        if (diff.error === 'NOT_MY_CHILD')
          return reply
            .status(400)
            .send({ error: diff.error, message: '소속되지 않은 하위 협력사가 포함되어 있습니다.' });
        return reply
          .status(409)
          .send({ error: diff.error, message: '지금은 하위 견적요청을 보낼 수 없습니다.' });
      }

      if (diff.addedPartners.length > 0) {
        for (const partner of diff.addedPartners) {
          const token = diff.addedTokens.get(partner.id.toString());
          void sendPcbMail(
            request.log,
            partner.contactEmail,
            buildPcbRfqRequestEmail({
              partnerName: partner.name,
              requesterName: ctx.partnerName,
              projectName: rfq.spec.projectName,
              qty: rfq.spec.qty,
              suggestedDeliveryDate: suggested,
              magicUrl: token === undefined ? null : magicPcbReplyUrl(token),
            }),
          );
        }
      }

      const rfqs = (await loadAdminPcbRfqs(rfq.specId)).filter(
        (v) => v.parentPartnerId === Number(ctx.partnerId),
      );
      return {
        result: true as const,
        data: { added: diff.added, kept: diff.kept, removed: diff.removed, rfqs },
      };
    },
  );

  // ── POST — MD 하위 선정(마진%) / 해제 — 상위 회신가 자동 산출·source_* 박제 ──
  fastify.post(
    '/partner/pcb-rfqs/:rfqId/child-selection',
    {
      schema: {
        params: RfqParams,
        body: PcbRfqChildSelectBody,
        response: { 200: AdminPcbRfqActionResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const res = await saveMdChildSelection(
        request.params.rfqId,
        ctx.partnerId,
        request.body.childRfqId === null ? null : BigInt(request.body.childRfqId),
        request.body.marginRate,
      );
      if (!res.ok) {
        if (res.error === 'RFQ_NOT_FOUND' || res.error === 'NOT_YOUR_RFQ' || res.error === 'CHILD_NOT_FOUND')
          return reply.notFound('견적요청을 찾을 수 없습니다');
        if (res.error === 'MARGIN_REQUIRED')
          return reply
            .status(400)
            .send({ error: res.error, message: '마진율(%)을 입력해 주세요.' });
        if (res.error === 'CHILD_NOT_QUOTED')
          return reply
            .status(409)
            .send({ error: res.error, message: '회신 완료된 하위 견적만 선정할 수 있습니다.' });
        if (res.error === 'EXCHANGE_RATE_UNAVAILABLE')
          return reply.status(409).send({
            error: res.error,
            message: '환율 정보가 준비되지 않았습니다 — 관리자에게 문의해 주세요.',
          });
        return reply
          .status(409)
          .send({ error: res.error, message: '선정이 끝난 견적은 수정할 수 없습니다.' });
      }
      return { result: true as const };
    },
  );

  done();
};
