import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  PartnerPcbAsCaseDetailResponse,
  PartnerPcbAsCaseListResponse,
  PartnerPcbAsCaseReplyBody,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  deletePcbAsCaseFile,
  getPcbAsCaseFileDownload,
  replyPcbAsCase,
  serializePartnerAsCases,
  uploadPcbAsCaseFile,
} from '../lib/pcb-as-case';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';
import { getShopEstimateProfile } from '../lib/g5-db';
import { buildPcbAsCaseRepliedEmail, pcbAdminCaseUrl, sendPcbMail } from '../lib/pcb-rfq-email';

// ── PCB A/S 케이스 포털 라우트(P4, requirePartner) ────────────────────────────
// 격리: 회신 주체(target=나) + MD 중계 열람(parent=나). draft(초안)는 어느 쪽에도
// 안 보인다 — 접수 전 관리자 작업물이다. 회신·첨부는 target 만, MD 는 순수 뷰어
// (레거시 동형 — MD 의 실무는 회차 발주서가 생긴 뒤 하위 발주에서 시작된다).

const CaseParams = z.object({ caseId: z.coerce.bigint() });
const CaseFileParams = z.object({ caseId: z.coerce.bigint(), fileId: z.coerce.bigint() });

export const partnerPcbAsCaseRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const requireCtx = (request: { partnerContext?: { partnerId: bigint; partnerName: string } }) => {
    const ctx = request.partnerContext;
    if (ctx === undefined) throw fastify.httpErrors.forbidden();
    return ctx;
  };

  /** 격리 로드 — 내 것(target) 또는 내 중계 트랙(parent), draft 제외. */
  const loadVisible = async (caseId: bigint, partnerId: bigint) => {
    const c = await prisma.spPcbAsCase.findUnique({ where: { id: caseId } });
    if (c === null || c.status === 'draft') return null;
    if (c.targetPartnerId !== partnerId && c.parentPartnerId !== partnerId) return null;
    return c;
  };

  const serializeOne = async (caseId: bigint) => {
    const row = await prisma.spPcbAsCase.findUniqueOrThrow({ where: { id: caseId } });
    const [view] = await serializePartnerAsCases([row]);
    if (view === undefined) throw new Error('직렬화 실패');
    return view;
  };

  fastify.get(
    '/partner/pcb-as-cases',
    { schema: { response: { 200: PartnerPcbAsCaseListResponse } } },
    async (request) => {
      const ctx = requireCtx(request);
      const rows = await prisma.spPcbAsCase.findMany({
        where: {
          status: { not: 'draft' },
          OR: [{ targetPartnerId: ctx.partnerId }, { parentPartnerId: ctx.partnerId }],
        },
        orderBy: { id: 'desc' },
      });
      return {
        result: true as const,
        data: {
          cases: await serializePartnerAsCases(rows),
          partnerId: Number(ctx.partnerId),
          partnerName: ctx.partnerName,
        },
      };
    },
  );

  fastify.get(
    '/partner/pcb-as-cases/:caseId',
    {
      schema: {
        params: CaseParams,
        response: { 200: PartnerPcbAsCaseDetailResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const c = await loadVisible(request.params.caseId, ctx.partnerId);
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      return { result: true as const, data: { asCase: await serializeOne(c.id) } };
    },
  );

  // ── 회신 — target 만. 수락(재생산 가능)/거절(재생산 불가) + 사유 ─────────────
  // 성공 시 관리자 통지 — 회신을 놓치면 재발주 진행이 멈춘다(RFQ 회신 통지와 같은 결).
  const doReply = async (
    caseId: bigint,
    ctx: { partnerId: bigint; partnerName: string },
    accept: boolean,
    reason: string | undefined,
    log: Parameters<typeof sendPcbMail>[0],
    mbId: string,
  ) => {
    const r = await replyPcbAsCase(
      caseId,
      ctx.partnerId,
      accept,
      reason === undefined || reason === '' ? null : reason,
    );
    if (!r.ok) return r;
    const [profile, spec] = await Promise.all([
      getShopEstimateProfile(),
      prisma.spOrderSpec.findUnique({ where: { id: r.asCase.specId } }),
    ]);
    void sendPcbMail(
      log,
      profile?.managerEmail,
      buildPcbAsCaseRepliedEmail({
        partnerName: ctx.partnerName,
        projectName: spec?.projectName ?? `Q${r.asCase.specId.toString()}`,
        accepted: accept,
        reason: r.asCase.replyReason,
        targetUrl: pcbAdminCaseUrl(r.asCase.specId.toString()),
      }),
      {
        kind: 'pcb_as_replied',
        refType: 'pcb_spec',
        refId: r.asCase.specId,
        sentBy: mbId,
        params: { caseId: String(r.asCase.id), accepted: accept, partnerName: ctx.partnerName },
      },
    );
    return r;
  };

  const REPLY_SCHEMA = {
    params: CaseParams,
    body: PartnerPcbAsCaseReplyBody,
    response: { 200: PartnerPcbAsCaseDetailResponse, 403: ApiError, 404: ApiError, 409: ApiError },
  };

  fastify.post(
    '/partner/pcb-as-cases/:caseId/accept',
    { schema: REPLY_SCHEMA },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const r = await doReply(
        request.params.caseId,
        ctx,
        true,
        request.body.reason,
        request.log,
        request.user.mbId,
      );
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound('A/S 케이스가 없습니다');
        if (r.error === 'NOT_YOUR_CASE') {
          return reply
            .status(403)
            .send({ error: r.error, message: '재생산 대상 협력사만 회신할 수 있습니다' });
        }
        return reply
          .status(409)
          .send({ error: r.error, message: '접수(회신 대기) 상태에서만 회신할 수 있습니다' });
      }
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  fastify.post(
    '/partner/pcb-as-cases/:caseId/reject',
    { schema: REPLY_SCHEMA },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const r = await doReply(
        request.params.caseId,
        ctx,
        false,
        request.body.reason,
        request.log,
        request.user.mbId,
      );
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound('A/S 케이스가 없습니다');
        if (r.error === 'NOT_YOUR_CASE') {
          return reply
            .status(403)
            .send({ error: r.error, message: '재생산 대상 협력사만 회신할 수 있습니다' });
        }
        return reply
          .status(409)
          .send({ error: r.error, message: '접수(회신 대기) 상태에서만 회신할 수 있습니다' });
      }
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  // ── 회신 첨부(불량 사진 등) — target 만, 회신 전(접수 상태)만 ────────────────
  // 레거시 갭 교정: 협력사 회신 첨부가 설계에 있었지만 미구현 + 올리면 관리자 첨부를
  // 덮어쓰는 결함 — 여기서는 자기(PARTNER) 파일만 추가·삭제한다.
  fastify.post(
    '/partner/pcb-as-cases/:caseId/files',
    {
      schema: {
        params: CaseParams,
        response: {
          200: PartnerPcbAsCaseDetailResponse,
          400: ApiError,
          403: ApiError,
          404: ApiError,
          409: ApiError,
        },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const c = await loadVisible(request.params.caseId, ctx.partnerId);
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      if (c.targetPartnerId !== ctx.partnerId) {
        return reply
          .status(403)
          .send({ error: 'NOT_YOUR_CASE', message: '재생산 대상 협력사만 첨부할 수 있습니다' });
      }
      if (c.status !== 'submitted') {
        return reply.status(409).send({
          error: 'NOT_SUBMITTED',
          message: '회신 전(접수 상태)에만 첨부할 수 있습니다',
        });
      }
      const { files } = await collectMultipart(request);
      const file = files[0];
      if (file === undefined) {
        return reply.status(400).send({ error: 'FILE_REQUIRED', message: '파일을 첨부해 주세요' });
      }
      await uploadPcbAsCaseFile(c.id, file, 'PARTNER');
      return { result: true as const, data: { asCase: await serializeOne(c.id) } };
    },
  );

  fastify.delete(
    '/partner/pcb-as-cases/:caseId/files/:fileId',
    {
      schema: {
        params: CaseFileParams,
        response: { 200: PartnerPcbAsCaseDetailResponse, 403: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const c = await loadVisible(request.params.caseId, ctx.partnerId);
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      if (c.targetPartnerId !== ctx.partnerId) {
        return reply
          .status(403)
          .send({ error: 'NOT_YOUR_CASE', message: '재생산 대상 협력사만 삭제할 수 있습니다' });
      }
      if (c.status !== 'submitted') {
        return reply.status(409).send({
          error: 'NOT_SUBMITTED',
          message: '회신 전(접수 상태)에만 첨부를 삭제할 수 있습니다',
        });
      }
      const done_ = await deletePcbAsCaseFile(c.id, request.params.fileId, 'PARTNER');
      if (!done_) return reply.notFound('파일이 없습니다(내가 올린 파일만 삭제할 수 있습니다)');
      return { result: true as const, data: { asCase: await serializeOne(c.id) } };
    },
  );

  fastify.get(
    '/partner/pcb-as-cases/:caseId/files/:fileId',
    { schema: { params: CaseFileParams } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const c = await loadVisible(request.params.caseId, ctx.partnerId);
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      const target = await getPcbAsCaseFileDownload(c.id, request.params.fileId);
      if (target === null) return reply.notFound('파일이 없습니다');
      const stream = await downloadFromFileServer(target.pathToken);
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(target.originFileName)}`,
        )
        .send(stream);
    },
  );

  done();
};
