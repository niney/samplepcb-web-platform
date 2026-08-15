import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbClaimCreateBody,
  AdminPcbClaimDetailResponse,
  AdminPcbClaimListQuery,
  AdminPcbClaimListResponse,
  AdminPcbClaimMutateResponse,
  AdminPcbClaimReturnBody,
  AdminPcbClaimTransitionBody,
  ApiError,
  PCB_CLAIM_ELIGIBILITY_LABELS,
  PCB_CLAIM_KIND_LABELS,
  PCB_CLAIM_RESOLUTION_LABELS,
  PcbClaimStatus,
  type AdminPcbClaimCountsType,
  type PcbClaimKindType,
} from '@sp/api-contract';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  isPcbClaimActive,
  pcbClaimInclude,
  resolvePcbClaimTransition,
  serializePcbClaims,
  uploadPcbClaimFile,
  getPcbClaimFileDownload,
  createPcbClaim,
  type PcbClaimAdminAction,
} from '../lib/pcb-claim';
import { createPcbAsCase, deletePcbAsCase } from '../lib/pcb-as-case';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';
import { getOrdererContactByOdId } from '../lib/g5-db';
import {
  buildPcbClaimDecidedEmail,
  buildPcbClaimReceivedEmail,
  sendPcbMail,
} from '../lib/pcb-rfq-email';

// ── PCB 고객 클레임 관리자 라우트(P5) — docs/PCB_PARTNER_TRACK.md §9 A/S ─────
// 워크큐(BOM 클레임 미러: 상태 탭·카운트·낙관적 잠금 전이) + PCB 고유 판정 축:
// 귀책(faultType)·처리(resolutionKind)·재생산 핸드오프(resolve(reproduce)가 A/S
// 케이스 초안을 만들어 연결). 대리 접수(전화·메일 건)도 여기서 — byRole=admin.

const ClaimParams = z.object({ id: z.coerce.bigint() });
const ClaimFileParams = z.object({ id: z.coerce.bigint(), fileId: z.coerce.bigint() });
const SpecParams = z.object({ id: z.coerce.bigint() });

class ClaimTransitionError extends Error {
  constructor(
    readonly code: 'CLAIM_NOT_FOUND' | 'STALE_CLAIM' | 'INVALID_TRANSITION' | 'AS_CASE_FAILED',
    readonly detail?: string,
  ) {
    super(code);
  }
}

const TRANSITION_ERROR_LABELS: Record<ClaimTransitionError['code'], string> = {
  CLAIM_NOT_FOUND: '클레임을 찾을 수 없습니다.',
  STALE_CLAIM: '다른 관리자가 먼저 처리했습니다. 최신 상태를 다시 확인해 주세요.',
  INVALID_TRANSITION: '현재 상태에서는 요청한 처리를 진행할 수 없습니다.',
  AS_CASE_FAILED: 'A/S 케이스 생성에 실패했습니다.',
};

export const adminPcbClaimRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const serializeOne = async (id: bigint) => {
    const row = await prisma.spPcbClaim.findUniqueOrThrow({
      where: { id },
      include: pcbClaimInclude,
    });
    const [view] = await serializePcbClaims([row]);
    if (view === undefined) throw new Error('클레임 직렬화 실패');
    return view;
  };

  /** 판정 회신 메일 — 수신처는 주문 시점 이메일. 실패해도 전이는 성립(원장에 남는다). */
  const sendDecidedMail = (
    log: Parameters<typeof sendPcbMail>[0],
    claim: { id: bigint; specId: bigint; odId: string },
    projectName: string,
    resolved: boolean,
    resolutionLabel: string | null,
    response: string,
    sentBy: string,
  ): void => {
    void (async () => {
      const contact = await getOrdererContactByOdId(claim.odId);
      await sendPcbMail(
        log,
        contact?.email,
        buildPcbClaimDecidedEmail({
          customerName: contact?.name ?? '고객',
          projectName,
          resolved,
          resolutionLabel,
          response,
        }),
        {
          kind: 'pcb_claim_decided',
          refType: 'pcb_spec',
          refId: claim.specId,
          sentBy,
          params: { claimId: String(claim.id), resolved: String(resolved) },
        },
      );
    })();
  };

  // ── 워크큐 목록 + 카운트 ────────────────────────────────────────────────────
  fastify.get(
    '/pcb-claims',
    { schema: { querystring: AdminPcbClaimListQuery, response: { 200: AdminPcbClaimListResponse } } },
    async (request) => {
      const { page, pageSize, status, search } = request.query;
      const where: Prisma.SpPcbClaimWhereInput = {
        ...(status === 'all'
          ? {}
          : status === 'pending'
            ? { status: { in: ['open', 'reviewing'] } }
            : { status }),
        ...(search === undefined || search === ''
          ? {}
          : {
              OR: [
                { spec: { projectName: { contains: search } } },
                { mbId: { contains: search } },
                { odId: { contains: search } },
              ],
            }),
      };
      const [claims, total, grouped] = await Promise.all([
        prisma.spPcbClaim.findMany({
          where,
          include: pcbClaimInclude,
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spPcbClaim.count({ where }),
        prisma.spPcbClaim.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      const statusCounts = new Map(grouped.map((row) => [row.status, row._count._all]));
      const counts: AdminPcbClaimCountsType = {
        all: grouped.reduce((sum, row) => sum + row._count._all, 0),
        open: statusCounts.get('open') ?? 0,
        reviewing: statusCounts.get('reviewing') ?? 0,
        resolved: statusCounts.get('resolved') ?? 0,
        rejected: statusCounts.get('rejected') ?? 0,
        pending: (statusCounts.get('open') ?? 0) + (statusCounts.get('reviewing') ?? 0),
      };
      return {
        result: true as const,
        data: {
          items: await serializePcbClaims(claims),
          total,
          page,
          pageSize,
          counts,
        },
      };
    },
  );

  // ── 스펙 축 목록(Case 상세 패널) ────────────────────────────────────────────
  fastify.get(
    '/pcb-projects/:id/claims',
    { schema: { params: SpecParams, response: { 200: AdminPcbClaimListResponse } } },
    async (request) => {
      const claims = await prisma.spPcbClaim.findMany({
        where: { specId: request.params.id },
        include: pcbClaimInclude,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      });
      const pending = claims.filter((c) => isPcbClaimActive(c.status)).length;
      return {
        result: true as const,
        data: {
          items: await serializePcbClaims(claims),
          total: claims.length,
          page: 1,
          pageSize: Math.max(claims.length, 1),
          counts: {
            all: claims.length,
            pending,
            open: claims.filter((c) => c.status === 'open').length,
            reviewing: claims.filter((c) => c.status === 'reviewing').length,
            resolved: claims.filter((c) => c.status === 'resolved').length,
            rejected: claims.filter((c) => c.status === 'rejected').length,
          },
        },
      };
    },
  );

  // ── 대리 접수(전화·메일 건) — 게이트는 고객 접수와 동일, byRole=admin ─────────
  fastify.post(
    '/pcb-projects/:id/claims',
    {
      schema: {
        params: SpecParams,
        body: AdminPcbClaimCreateBody,
        response: { 200: AdminPcbClaimMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: request.params.id, status: 'active' },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      const r = await createPcbClaim(spec, {
        kind: request.body.kind,
        affectedQty: request.body.affectedQty,
        description: request.body.description,
        requestedRemedy: request.body.requestedRemedy,
        createdByRole: 'admin',
        createdBy: request.user.mbId,
      });
      if (!r.ok) {
        const message =
          r.error === 'QTY_EXCEEDS_ORDER'
            ? '문제 수량은 주문 수량을 넘을 수 없습니다.'
            : PCB_CLAIM_ELIGIBILITY_LABELS[r.error];
        return reply.status(409).send({ error: r.error, message });
      }
      // 대리 접수도 고객에게 접수 확인이 간다 — "담당자가 대신 접수" 문구로.
      void (async () => {
        const contact = await getOrdererContactByOdId(r.claim.odId);
        await sendPcbMail(
          request.log,
          contact?.email,
          buildPcbClaimReceivedEmail({
            customerName: contact?.name ?? '고객',
            projectName: spec.projectName,
            kindLabel: PCB_CLAIM_KIND_LABELS[request.body.kind],
            affectedQty: request.body.affectedQty,
            orderedQty: spec.qty,
            byAdmin: true,
          }),
          {
            kind: 'pcb_claim_received',
            refType: 'pcb_spec',
            refId: spec.id,
            sentBy: request.user.mbId,
            params: { claimId: String(r.claim.id), byAdmin: 'true' },
          },
        );
      })();
      return { result: true as const, data: { claim: await serializeOne(r.claim.id) } };
    },
  );

  // ── 상세 ────────────────────────────────────────────────────────────────────
  fastify.get(
    '/pcb-claims/:id',
    { schema: { params: ClaimParams, response: { 200: AdminPcbClaimDetailResponse } } },
    async (request, reply) => {
      const row = await prisma.spPcbClaim.findUnique({
        where: { id: request.params.id },
        include: pcbClaimInclude,
      });
      if (row === null) return reply.notFound('클레임을 찾을 수 없습니다');
      const [view] = await serializePcbClaims([row]);
      if (view === undefined) throw new Error('클레임 직렬화 실패');
      return { result: true as const, data: { claim: view } };
    },
  );

  // ── 판정 전이 — BOM 미러(낙관적 잠금 tx) + reproduce 는 A/S 케이스 핸드오프 ──
  fastify.patch(
    '/pcb-claims/:id',
    {
      schema: {
        params: ClaimParams,
        body: AdminPcbClaimTransitionBody,
        response: { 200: AdminPcbClaimMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      // resolve(reproduce)+대상 지정이면 케이스 초안을 **먼저** 만든다 — 전이 뒤 케이스
      // 생성이 실패하면 클레임만 닫힌 반쪽이 남는다. 반대로 전이가 실패(경합)하면
      // 초안은 지우면 그만이다(draft 삭제는 무흔적).
      let asCaseId: bigint | null = null;
      if (
        request.body.action === 'resolve' &&
        request.body.resolutionKind === 'reproduce' &&
        request.body.targetPartnerId !== undefined
      ) {
        const claimRow = await prisma.spPcbClaim.findUnique({ where: { id: request.params.id } });
        if (claimRow === null) {
          return reply.notFound(TRANSITION_ERROR_LABELS.CLAIM_NOT_FOUND);
        }
        const kindLabel = PCB_CLAIM_KIND_LABELS[claimRow.kind as PcbClaimKindType];
        const created = await createPcbAsCase(
          claimRow.specId,
          {
            targetPartnerId: request.body.targetPartnerId,
            // 클레임발 재생산은 제품 문제 축이다(관리자 실수 유형은 기존 수동 접수 몫).
            // 비용 기본: 고객 데이터 귀책=유상, 그 외=무상 — draft 라 패널에서 수정 가능.
            caseType: 'product_defect',
            chargeType: request.body.faultType === 'customer_data' ? 'paid' : 'free',
            description:
              `[클레임 #${String(claimRow.id)}] ${kindLabel} · 문제 수량 ` +
              `${String(claimRow.affectedQty)}/${String(claimRow.orderedQty)} — ${claimRow.description}`,
          },
          request.user.mbId,
        );
        if (!created.ok) {
          return reply.status(409).send({
            error: created.error,
            message:
              created.error === 'NO_ORIGIN_PO'
                ? '대상 협력사의 원주문 발주서가 없습니다 — 발주된 협력사만 재생산 대상이 됩니다.'
                : TRANSITION_ERROR_LABELS.AS_CASE_FAILED,
          });
        }
        asCaseId = created.asCase.id;
      }

      try {
        const claim = await prisma.$transaction(async (tx) => {
          const current = await tx.spPcbClaim.findUnique({ where: { id: request.params.id } });
          if (current === null) throw new ClaimTransitionError('CLAIM_NOT_FOUND');
          if (current.version !== request.body.expectedVersion) {
            throw new ClaimTransitionError('STALE_CLAIM');
          }
          const parsedStatus = PcbClaimStatus.safeParse(current.status);
          if (!parsedStatus.success) throw new ClaimTransitionError('INVALID_TRANSITION');
          const action: PcbClaimAdminAction =
            request.body.action === 'start_review'
              ? 'review_started'
              : request.body.action === 'resolve'
                ? 'resolved'
                : 'rejected';
          const target = resolvePcbClaimTransition(parsedStatus.data, action);
          if (target === null) throw new ClaimTransitionError('INVALID_TRANSITION');
          const now = new Date();
          const response = request.body.action === 'start_review' ? null : request.body.response;
          const update = await tx.spPcbClaim.updateMany({
            where: {
              id: current.id,
              version: request.body.expectedVersion,
              status: current.status,
            },
            data: {
              status: target,
              version: { increment: 1 },
              adminMbId: request.user.mbId,
              ...(request.body.action === 'start_review'
                ? { reviewStartedAt: now }
                : request.body.action === 'resolve'
                  ? {
                      activeKey: null,
                      adminResponse: response,
                      faultType: request.body.faultType,
                      resolutionKind: request.body.resolutionKind,
                      chargeAmount: request.body.chargeAmount ?? null,
                      refundAmount: request.body.refundAmount ?? null,
                      ...(asCaseId === null ? {} : { asCaseId }),
                      closedAt: now,
                    }
                  : {
                      activeKey: null,
                      adminResponse: response,
                      faultType: request.body.faultType ?? null,
                      resolutionKind: null,
                      closedAt: now,
                    }),
            },
          });
          if (update.count !== 1) throw new ClaimTransitionError('STALE_CLAIM');
          await tx.spPcbClaimEvent.create({
            data: {
              claimId: current.id,
              action,
              actorRole: 'admin',
              actorMbId: request.user.mbId,
              fromStatus: parsedStatus.data,
              toStatus: target,
              note: response,
            },
          });
          const fresh = await tx.spPcbClaim.findUnique({
            where: { id: current.id },
            include: pcbClaimInclude,
          });
          if (fresh === null) throw new ClaimTransitionError('CLAIM_NOT_FOUND');
          return fresh;
        });

        if (request.body.action !== 'start_review') {
          sendDecidedMail(
            request.log,
            claim,
            claim.spec.projectName,
            request.body.action === 'resolve',
            request.body.action === 'resolve'
              ? PCB_CLAIM_RESOLUTION_LABELS[request.body.resolutionKind]
              : null,
            request.body.response,
            request.user.mbId,
          );
        }
        const [view] = await serializePcbClaims([claim]);
        if (view === undefined) throw new Error('클레임 직렬화 실패');
        return { result: true as const, data: { claim: view } };
      } catch (error) {
        // 전이 실패 시 방금 만든 케이스 초안 회수 — 반쪽 상태를 남기지 않는다.
        if (asCaseId !== null) await deletePcbAsCase(asCaseId);
        if (error instanceof ClaimTransitionError) {
          const statusCode = error.code === 'CLAIM_NOT_FOUND' ? 404 : 409;
          return reply.status(statusCode).send({
            error: error.code,
            message: TRANSITION_ERROR_LABELS[error.code],
          });
        }
        throw error;
      }
    },
  );

  // ── 회수 기록(자유 메모) — 전이가 아니라 검토 노트, 최종쓰기 우선 ───────────
  fastify.patch(
    '/pcb-claims/:id/return',
    {
      schema: {
        params: ClaimParams,
        body: AdminPcbClaimReturnBody,
        response: { 200: AdminPcbClaimMutateResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await prisma.spPcbClaim.findUnique({ where: { id: request.params.id } });
      if (row === null) return reply.notFound('클레임을 찾을 수 없습니다');
      await prisma.spPcbClaim.update({
        where: { id: row.id },
        data: {
          returnRequired: request.body.returnRequired,
          returnNote:
            request.body.returnNote === undefined || request.body.returnNote === ''
              ? null
              : request.body.returnNote,
        },
      });
      return { result: true as const, data: { claim: await serializeOne(row.id) } };
    },
  );

  // ── 첨부 — 대리 접수 건의 사진(고객이 메일로 보낸 것) 등, 열린 상태에서만 ────
  fastify.post(
    '/pcb-claims/:id/files',
    { schema: { params: ClaimParams, response: { 200: AdminPcbClaimMutateResponse, 400: ApiError, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const row = await prisma.spPcbClaim.findUnique({ where: { id: request.params.id } });
      if (row === null) return reply.notFound('클레임을 찾을 수 없습니다');
      if (!isPcbClaimActive(row.status)) {
        return reply.status(409).send({
          error: 'CLAIM_CLOSED',
          message: '종결된 클레임에는 첨부할 수 없습니다.',
        });
      }
      const { files } = await collectMultipart(request);
      if (files.length === 0) {
        return reply.status(400).send({ error: 'FILE_REQUIRED', message: '파일이 필요합니다.' });
      }
      for (const file of files) {
        await uploadPcbClaimFile(row.id, file, 'ADMIN');
      }
      return { result: true as const, data: { claim: await serializeOne(row.id) } };
    },
  );

  fastify.get(
    '/pcb-claims/:id/files/:fileId',
    { schema: { params: ClaimFileParams } },
    async (request, reply) => {
      const file = await getPcbClaimFileDownload(request.params.id, request.params.fileId);
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

  done();
};
