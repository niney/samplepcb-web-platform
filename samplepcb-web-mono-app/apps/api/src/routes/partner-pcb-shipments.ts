import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  ApiError,
  PartnerPcbShipBoardResponse,
  PartnerPcbShipBoxBody,
  PartnerPcbShipDoneQuery,
  PartnerPcbShipDoneResponse,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  ensurePcbShipment,
  loadPartnerPcbDoneShipments,
  loadPartnerPcbShipBoard,
} from '../lib/pcb-shipment';

// ── [📦 PCB 보내기] 보드(P3 재구성, requirePartner) — docs/PCB_PARTNER_TRACK.md §9 ──
// BOM §6.11 두 칸 모델의 PCB 일반화: 받는 곳(관리자/직송/MD)이 갈릴 수 있어 박스는
// 컨텍스트당 1개, 담기는 서버가 컨텍스트를 해석해 합류·생성한다(ensurePcbShipment).
// 꺼내기·전이·서류·입고는 기존 발주서 경유 라우트(partner-pcb-pos)를 그대로 쓴다.

const BOX_ERROR_MESSAGES: Record<string, string> = {
  NOT_PRODUCED: '생산완료된 발주서만 담을 수 있습니다.',
  PARTNER_COUNTRY_REQUIRED: '조직 소재 국가가 없습니다 — 샘플피씨비 담당자에게 문의하세요.',
  OUTBOUND_BLOCKED: '하위 협력사 입고 확인이 끝나야 출고할 수 있습니다.',
  ORDER_CANCELED: '취소된 주문입니다 — 발송을 시작하지 말고 샘플피씨비 담당자에게 문의해 주세요.',
};

export const partnerPcbShipmentRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const requireCtx = (request: { partnerContext?: { partnerId: bigint; partnerName: string } }) => {
    const ctx = request.partnerContext;
    if (ctx === undefined) throw fastify.httpErrors.forbidden();
    return ctx;
  };

  // ── GET /api/partner/pcb-shipments — 보드(선반·박스·진행·완료 수) ────────────
  fastify.get(
    '/partner/pcb-shipments',
    { schema: { response: { 200: PartnerPcbShipBoardResponse } } },
    async (request) => {
      const ctx = requireCtx(request);
      return { result: true as const, data: await loadPartnerPcbShipBoard(ctx.partnerId) };
    },
  );

  // ── GET /api/partner/pcb-shipments/done — 완료 아카이브(R2, BOM done 미러) ──
  fastify.get(
    '/partner/pcb-shipments/done',
    {
      schema: {
        querystring: PartnerPcbShipDoneQuery,
        response: { 200: PartnerPcbShipDoneResponse },
      },
    },
    async (request) => {
      const ctx = requireCtx(request);
      return {
        result: true as const,
        data: await loadPartnerPcbDoneShipments(
          ctx.partnerId,
          request.query.page,
          request.query.pageSize,
        ),
      };
    },
  );

  // ── POST /api/partner/pcb-shipments/box — 담기(같은 컨텍스트 합류 또는 새 박스) ──
  fastify.post(
    '/partner/pcb-shipments/box',
    {
      schema: {
        body: PartnerPcbShipBoxBody,
        response: { 200: PartnerPcbShipBoardResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const po = await prisma.spPcbPo.findUnique({
        where: { id: BigInt(request.body.poId) },
        include: { partner: true },
      });
      // 담기는 내가 수주한 발주서만 — MD 가 하위에 발주한 건은 하위 수주자가 보낸다.
      if (po?.partnerId !== ctx.partnerId) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await ensurePcbShipment(po);
      if (!res.ok) {
        return reply.status(409).send({
          error: res.error,
          message: BOX_ERROR_MESSAGES[res.error] ?? '담을 수 없습니다.',
        });
      }
      return { result: true as const, data: await loadPartnerPcbShipBoard(ctx.partnerId) };
    },
  );

  done();
};
