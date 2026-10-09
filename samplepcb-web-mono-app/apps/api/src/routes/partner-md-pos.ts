import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  bomMdPoActionsFor,
  bomMdPoCanDelete,
  type BomMdPoViewerRoleType,
  PartnerMdPoAdvanceBody,
  PartnerMdPoDeleteResponse,
  PartnerMdPoDetailResponse,
  PartnerMdPoListResponse,
  PartnerPoChildPosIssueBody,
  PartnerPoChildPosResponse,
} from '@sp/api-contract';
import {
  MD_PO_INCLUDE,
  advanceMdPo,
  asBomMdPoStatus,
  issueMdChildPos,
  loadMdPoPlan,
  toMdPoView,
} from '../lib/bom-md-po';
import { prisma } from '../lib/prisma';
import { buildBomMdPoIssuedEmail, sendBomRfqMail } from '../lib/rfq-email';

// ── 마스터딜러 하위 발주(D47) — docs/SMARTBOM_PARTNER_RFQ.md §6.43 ────────────
//   /api/partner/pos/:poId/child-pos   발주처(마스터딜러): 발주 계획 열람·하위 발주 발행
//   /api/partner/md-pos                하위: 받은 하위 발주 목록
//   /api/partner/md-pos/:mdPoId        양쪽: 상세·진행·(발주처만) 삭제
// 문서 단위 권한은 여기서 판정한다 — 발주처이거나 수주처여야 보이고, 누를 수 있는 동작은
// 역할로 갈린다(mdPoActionsFor). 관리자 대리 접속은 그 조직의 권한 그대로다.

const PoIdParams = z.object({ poId: z.coerce.bigint() });
const MdPoIdParams = z.object({ mdPoId: z.coerce.bigint() });

const ISSUE_ERRORS: Record<string, string> = {
  PO_CLOSED: '종결된 발주서에서는 하위 발주를 낼 수 없습니다.',
  NO_CHILD_ITEMS: '이 발주서에 그 하위 협력사에게 맡길 품목이 없습니다.',
  ALREADY_ISSUED: '이미 하위 발주를 보낸 협력사가 포함되어 있습니다.',
};

export const partnerMdPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  /** 내가 받은 상위 발주서(샘플피씨비 → 나) — 하위 발주는 여기서만 낸다. */
  const loadMyPo = async (poId: bigint, partnerId: bigint) => {
    const po = await prisma.spBomPo.findUnique({
      where: { id: poId },
      include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
    });
    return po?.partnerId === partnerId ? po : null;
  };

  /** 하위 발주 한 건 + 보는 쪽의 역할 — 당사자가 아니면 null(존재를 드러내지 않는다). */
  const loadMdPo = async (mdPoId: bigint, partnerId: bigint) => {
    const row = await prisma.spBomMdPo.findUnique({ where: { id: mdPoId }, include: MD_PO_INCLUDE });
    if (row === null) return null;
    const role: BomMdPoViewerRoleType | null =
      row.parentPartnerId === partnerId ? 'parent' : row.partnerId === partnerId ? 'child' : null;
    return role === null ? null : { row, role };
  };

  const toDetail = (found: NonNullable<Awaited<ReturnType<typeof loadMdPo>>>) => {
    const status = asBomMdPoStatus(found.row.status);
    return {
      ...toMdPoView(found.row),
      viewerRole: found.role,
      actions: bomMdPoActionsFor(status, found.role),
      canDelete: bomMdPoCanDelete(status, found.role),
    };
  };

  // ── GET — 발주 계획(하위별 묶음 + 이미 보낸 하위 발주) ────────────────────────
  fastify.get(
    '/partner/pos/:poId/child-pos',
    { schema: { params: PoIdParams, response: { 200: PartnerPoChildPosResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const po = await loadMyPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: await loadMdPoPlan(po) };
    },
  );

  // ── POST — 하위 발주 발행(고른 하위마다 한 건, 신규만 메일) ───────────────────
  fastify.post(
    '/partner/pos/:poId/child-pos',
    {
      schema: {
        params: PoIdParams,
        body: PartnerPoChildPosIssueBody,
        response: { 200: PartnerPoChildPosResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const po = await loadMyPo(request.params.poId, ctx.partnerId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const issued = await issueMdChildPos(
        po,
        request.body.partnerIds,
        request.body.memo ?? null,
        request.user.mbId,
      );
      if (!issued.ok) {
        return reply.status(409).send({
          error: issued.error,
          message: ISSUE_ERRORS[issued.error] ?? '하위 발주를 보내지 못했습니다.',
        });
      }
      // 하위에게 알린다 — 계정이 없는 경우가 많아 품목을 본문에 그대로 싣는다(비차단).
      for (const row of issued.created) {
        const view = toMdPoView(row);
        void sendBomRfqMail(
          request.log,
          row.partner.contactEmail,
          buildBomMdPoIssuedEmail({
            partnerName: view.partnerName,
            requesterName: ctx.partnerName,
            quoteTitle: view.quoteTitle,
            currency: view.currency,
            totalAmount: view.totalAmount,
            memo: view.memo,
            hasPortalAccount: view.hasPortalAccount,
            items: view.items,
          }),
          {
            kind: 'bom_md_po_issued',
            refType: 'bom_quote',
            refId: po.quoteId,
            sentBy: request.user.mbId,
            params: {
              mdPoId: view.mdPoId,
              poId: view.poId,
              partnerId: String(row.partnerId),
              partnerName: view.partnerName,
              parentPartnerId: String(ctx.partnerId),
            },
          },
        );
      }
      return { result: true as const, data: await loadMdPoPlan(po) };
    },
  );

  // ── GET — 내가 받은 하위 발주(하위로서) ───────────────────────────────────────
  fastify.get(
    '/partner/md-pos',
    { schema: { response: { 200: PartnerMdPoListResponse } } },
    async (request) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rows = await prisma.spBomMdPo.findMany({
        where: { partnerId: ctx.partnerId },
        include: MD_PO_INCLUDE,
        orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
      });
      return { result: true as const, data: { items: rows.map(toMdPoView) } };
    },
  );

  fastify.get(
    '/partner/md-pos/:mdPoId',
    { schema: { params: MdPoIdParams, response: { 200: PartnerMdPoDetailResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const found = await loadMdPo(request.params.mdPoId, ctx.partnerId);
      if (found === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: toDetail(found) };
    },
  );

  // ── POST — 진행(확인·출고·수령·되돌리기) ─────────────────────────────────────
  fastify.post(
    '/partner/md-pos/:mdPoId/advance',
    {
      schema: {
        params: MdPoIdParams,
        body: PartnerMdPoAdvanceBody,
        response: { 200: PartnerMdPoDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const found = await loadMdPo(request.params.mdPoId, ctx.partnerId);
      if (found === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const advanced = await advanceMdPo(found.row, found.role, request.body.action, request.body);
      if (!advanced.ok) {
        return reply.status(409).send({
          error: advanced.error,
          message: '지금은 할 수 없는 동작입니다 — 화면을 새로고침해 주세요.',
        });
      }
      const fresh = await loadMdPo(request.params.mdPoId, ctx.partnerId);
      if (fresh === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: toDetail(fresh) };
    },
  );

  // ── DELETE — 하위 발주 삭제(발주처만·출고 전) ────────────────────────────────
  fastify.delete(
    '/partner/md-pos/:mdPoId',
    {
      schema: {
        params: MdPoIdParams,
        response: { 200: PartnerMdPoDeleteResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const found = await loadMdPo(request.params.mdPoId, ctx.partnerId);
      if (found === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (!bomMdPoCanDelete(asBomMdPoStatus(found.row.status), found.role)) {
        return reply.status(409).send({
          error: 'CANNOT_DELETE',
          message: '출고된 하위 발주는 삭제할 수 없습니다.',
        });
      }
      // 상태를 조건에 걸어, 그사이 하위가 출고를 찍었으면 지우지 않는다.
      const deleted = await prisma.spBomMdPo.deleteMany({
        where: { id: found.row.id, status: { in: ['issued', 'confirmed'] } },
      });
      if (deleted.count !== 1) {
        return reply.status(409).send({
          error: 'CANNOT_DELETE',
          message: '출고된 하위 발주는 삭제할 수 없습니다.',
        });
      }
      return { result: true as const };
    },
  );

  done();
};
