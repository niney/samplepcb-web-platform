import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbAsCaseCandidatesResponse,
  AdminPcbAsCaseCreateBody,
  AdminPcbAsCaseListResponse,
  AdminPcbAsCaseMutateResponse,
  AdminPcbAsCaseProceedResponse,
  AdminPcbAsCaseUpdateBody,
  ApiError,
  PCB_AS_CASE_TYPE_LABELS,
  PCB_AS_CHARGE_LABELS,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  createPcbAsCase,
  deletePcbAsCase,
  deletePcbAsCaseFile,
  getPcbAsCaseFileDownload,
  listPcbAsCandidates,
  proceedPcbAsCase,
  recallPcbAsCase,
  replyPcbAsCase,
  serializeAdminAsCases,
  submitPcbAsCase,
  updatePcbAsCase,
  uploadPcbAsCaseFile,
} from '../lib/pcb-as-case';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';
import { buildPcbAsCaseSubmittedEmail, sendPcbMail } from '../lib/pcb-rfq-email';

// ── PCB A/S 케이스 관리자 라우트(P4) — docs/PCB_PARTNER_TRACK.md §9 A/S ───────
// 스펙(Case) 축에서 접수를 만들고, 협력사 회신을 받아 [재발주 진행]으로 회차
// 발주서를 연다. 첨부·수정·삭제는 draft 에서만(전송 후엔 협력사가 보는 내용이라
// 고정 — 고치려면 recall 로 회수부터). 전 라우트 requireAdmin.

const SpecParams = z.object({ id: z.coerce.bigint() });
const CaseParams = z.object({ caseId: z.coerce.bigint() });
const CaseFileParams = z.object({ caseId: z.coerce.bigint(), fileId: z.coerce.bigint() });

const CREATE_MESSAGES = {
  SPEC_NOT_FOUND: '프로젝트가 없습니다',
  ORDER_CANCELED: '취소된 주문입니다 — 재생산(A/S)이 성립하지 않습니다',
  NO_ORIGIN_PO: '대상 협력사의 원주문 발주서가 없습니다 — 발주된 협력사만 A/S 대상이 됩니다',
} as const;

const PROCEED_MESSAGES = {
  CASE_NOT_FOUND: 'A/S 케이스가 없습니다',
  NOT_ACCEPTED: "협력사가 '재생산 가능'으로 회신한 건만 진행할 수 있습니다",
  ORDER_CANCELED: '취소된 주문입니다 — 재생산(A/S)이 성립하지 않습니다',
  NO_ORIGIN_PO: '원주문 발주서를 찾을 수 없습니다(삭제됨) — 진행할 수 없습니다',
} as const;

export const adminPcbAsCaseRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const serializeOne = async (id: bigint) => {
    const row = await prisma.spPcbAsCase.findUniqueOrThrow({ where: { id } });
    const [view] = await serializeAdminAsCases([row]);
    if (view === undefined) throw new Error('직렬화 실패');
    return view;
  };

  // ── 스펙 축 목록·후보·생성 ──────────────────────────────────────────────────
  fastify.get(
    '/pcb-projects/:id/as-cases',
    { schema: { params: SpecParams, response: { 200: AdminPcbAsCaseListResponse } } },
    async (request) => {
      const rows = await prisma.spPcbAsCase.findMany({
        where: { specId: request.params.id },
        orderBy: { id: 'desc' },
      });
      return { result: true as const, data: { cases: await serializeAdminAsCases(rows) } };
    },
  );

  fastify.get(
    '/pcb-projects/:id/as-candidates',
    { schema: { params: SpecParams, response: { 200: AdminPcbAsCaseCandidatesResponse } } },
    async (request) => ({
      result: true as const,
      data: { candidates: await listPcbAsCandidates(request.params.id) },
    }),
  );

  fastify.post(
    '/pcb-projects/:id/as-cases',
    {
      schema: {
        params: SpecParams,
        body: AdminPcbAsCaseCreateBody,
        response: { 200: AdminPcbAsCaseMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const r = await createPcbAsCase(request.params.id, request.body, request.user.mbId);
      if (!r.ok) {
        if (r.error === 'SPEC_NOT_FOUND') return reply.notFound(CREATE_MESSAGES[r.error]);
        return reply.status(409).send({ error: r.error, message: CREATE_MESSAGES[r.error] });
      }
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  // ── draft 수정·삭제 ────────────────────────────────────────────────────────
  fastify.put(
    '/pcb-as-cases/:caseId',
    {
      schema: {
        params: CaseParams,
        body: AdminPcbAsCaseUpdateBody,
        response: { 200: AdminPcbAsCaseMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const r = await updatePcbAsCase(request.params.caseId, request.body);
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound('A/S 케이스가 없습니다');
        const message =
          r.error === 'NOT_DRAFT'
            ? '작성(초안) 상태에서만 수정할 수 있습니다 — 전송했다면 회수부터 하세요'
            : CREATE_MESSAGES.NO_ORIGIN_PO;
        return reply.status(409).send({ error: r.error, message });
      }
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  fastify.delete(
    '/pcb-as-cases/:caseId',
    {
      schema: {
        params: CaseParams,
        response: { 200: z.object({ result: z.literal(true) }), 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const r = await deletePcbAsCase(request.params.caseId);
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound('A/S 케이스가 없습니다');
        return reply.status(409).send({
          error: r.error,
          message: '작성(초안) 상태만 삭제할 수 있습니다 — 회신 이력이 있는 케이스는 기록으로 남습니다',
        });
      }
      return { result: true as const };
    },
  );

  // ── 전송·회수 ──────────────────────────────────────────────────────────────
  fastify.post(
    '/pcb-as-cases/:caseId/submit',
    {
      schema: {
        params: CaseParams,
        response: { 200: AdminPcbAsCaseMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const r = await submitPcbAsCase(request.params.caseId);
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound('A/S 케이스가 없습니다');
        return reply
          .status(409)
          .send({ error: r.error, message: '작성(초안) 상태만 접수 요청할 수 있습니다' });
      }
      const [partner, spec] = await Promise.all([
        prisma.spPartner.findUnique({ where: { id: r.asCase.targetPartnerId } }),
        prisma.spOrderSpec.findUnique({ where: { id: r.asCase.specId } }),
      ]);
      void sendPcbMail(
        request.log,
        partner?.contactEmail,
        buildPcbAsCaseSubmittedEmail({
          partnerName: partner?.name ?? '협력사',
          projectName: spec?.projectName ?? `Q${r.asCase.specId.toString()}`,
          caseTypeLabel:
            (PCB_AS_CASE_TYPE_LABELS as Record<string, string>)[r.asCase.caseType] ??
            r.asCase.caseType,
          chargeLabel:
            (PCB_AS_CHARGE_LABELS as Record<string, string>)[r.asCase.chargeType] ??
            r.asCase.chargeType,
          description: r.asCase.description,
        }),
        {
          kind: 'pcb_as_submitted',
          refType: 'pcb_spec',
          refId: r.asCase.specId,
          sentBy: request.user.mbId,
          params: { caseId: String(r.asCase.id), partnerName: partner?.name ?? '' },
        },
      );
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  fastify.post(
    '/pcb-as-cases/:caseId/recall',
    {
      schema: {
        params: CaseParams,
        response: { 200: AdminPcbAsCaseMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const r = await recallPcbAsCase(request.params.caseId);
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound('A/S 케이스가 없습니다');
        return reply.status(409).send({
          error: r.error,
          message: '회신 전(접수 상태)에만 회수할 수 있습니다',
        });
      }
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  // ── 대상 협력사 회신 대행 — MD 하위처럼 포털 계정이 없는 협력사 대비(발주·EQ 의
  // 관리자 만능 대행 D11 과 같은 결). byPartnerId 를 케이스의 target 으로 지정한다.
  fastify.post(
    '/pcb-as-cases/:caseId/reply',
    {
      schema: {
        params: CaseParams,
        body: z.object({ accept: z.boolean(), reason: z.string().max(4000).optional() }),
        response: { 200: AdminPcbAsCaseMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const c = await prisma.spPcbAsCase.findUnique({ where: { id: request.params.caseId } });
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      const r = await replyPcbAsCase(
        c.id,
        c.targetPartnerId,
        request.body.accept,
        request.body.reason === undefined || request.body.reason === '' ? null : request.body.reason,
      );
      if (!r.ok) {
        return reply
          .status(409)
          .send({ error: r.error, message: '접수(회신 대기) 상태에서만 회신할 수 있습니다' });
      }
      return { result: true as const, data: { asCase: await serializeOne(r.asCase.id) } };
    },
  );

  // ── 재발주 진행 — 회차 채번 + 회차 발주서 생성(응답 poId 로 발주 패널 안내) ──
  fastify.post(
    '/pcb-as-cases/:caseId/proceed',
    {
      schema: {
        params: CaseParams,
        response: { 200: AdminPcbAsCaseProceedResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const r = await proceedPcbAsCase(request.params.caseId);
      if (!r.ok) {
        if (r.error === 'CASE_NOT_FOUND') return reply.notFound(PROCEED_MESSAGES[r.error]);
        return reply.status(409).send({ error: r.error, message: PROCEED_MESSAGES[r.error] });
      }
      return {
        result: true as const,
        data: {
          asCase: await serializeOne(r.asCase.id),
          poId: Number(r.po.id),
          reorderRound: r.round,
        },
      };
    },
  );

  // ── 첨부(관리자 자료) — draft 만. 전송 후 고정, 회수하면 다시 열린다 ─────────
  fastify.post(
    '/pcb-as-cases/:caseId/files',
    {
      schema: {
        params: CaseParams,
        response: { 200: AdminPcbAsCaseMutateResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const c = await prisma.spPcbAsCase.findUnique({ where: { id: request.params.caseId } });
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      if (c.status !== 'draft') {
        return reply
          .status(409)
          .send({ error: 'NOT_DRAFT', message: '작성(초안) 상태에서만 첨부할 수 있습니다' });
      }
      const { files } = await collectMultipart(request);
      const file = files[0];
      if (file === undefined) {
        return reply.status(400).send({ error: 'FILE_REQUIRED', message: '파일을 첨부해 주세요' });
      }
      await uploadPcbAsCaseFile(c.id, file, 'ADMIN');
      return { result: true as const, data: { asCase: await serializeOne(c.id) } };
    },
  );

  fastify.delete(
    '/pcb-as-cases/:caseId/files/:fileId',
    {
      schema: {
        params: CaseFileParams,
        response: { 200: AdminPcbAsCaseMutateResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const c = await prisma.spPcbAsCase.findUnique({ where: { id: request.params.caseId } });
      if (c === null) return reply.notFound('A/S 케이스가 없습니다');
      if (c.status !== 'draft') {
        return reply
          .status(409)
          .send({ error: 'NOT_DRAFT', message: '작성(초안) 상태에서만 첨부를 삭제할 수 있습니다' });
      }
      // 관리자는 협력사 회신 파일도 정리할 수 있다(by null) — draft 로 회수된 뒤의 잔재 정리.
      const done_ = await deletePcbAsCaseFile(c.id, request.params.fileId, null);
      if (!done_) return reply.notFound('파일이 없습니다');
      return { result: true as const, data: { asCase: await serializeOne(c.id) } };
    },
  );

  fastify.get(
    '/pcb-as-cases/:caseId/files/:fileId',
    { schema: { params: CaseFileParams } },
    async (request, reply) => {
      const target = await getPcbAsCaseFileDownload(request.params.caseId, request.params.fileId);
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
