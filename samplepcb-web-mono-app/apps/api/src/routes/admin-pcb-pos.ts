import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ADMIN_PCB_PO_TABS,
  AdminPcbPoCreateBody,
  AdminPcbPoListResponse,
  AdminPcbPoPatchBody,
  AdminPcbPoWorkListResponse,
  ApiError,
  PcbPoActionResponse,
  PcbPoRejectBody,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  advancePcbPoEq,
  createAdminPcbPo,
  deletePcbPo,
  getPcbEqFileDownload,
  loadAdminPcbPoWorkItems,
  loadAdminPcbPos,
  loadPcbPoWithPartner,
  patchPcbPo,
  rejectPcbPoEq,
  revertPcbPoEq,
} from '../lib/pcb-po';
import { loadHousePartnerName } from '../lib/pcb-rfq';
import {
  buildPcbEqDecisionEmail,
  buildPcbPoIssuedEmail,
  pcbPriceText,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
import { downloadFromFileServer } from '../lib/file-server';

// ── PCB 발주서·EQ 관리자 라우트(P2) — docs/PCB_PARTNER_TRACK.md §5.4 ──────────
// 발행(paid 게이트)·조건 수정·삭제 + EQ 승인/반려/되돌리기(관리자=ORDERER, D3) +
// 횡단 워크큐(/pcb-pos). 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const PoParams = z.object({ id: z.coerce.bigint(), poId: z.coerce.bigint() });
const PoFileParams = z.object({
  id: z.coerce.bigint(),
  poId: z.coerce.bigint(),
  fileId: z.coerce.bigint(),
});

const WorkListQuery = z.object({
  tab: z.enum(ADMIN_PCB_PO_TABS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

const CREATE_ERROR_MESSAGES: Record<string, { code: 400 | 409; message: string }> = {
  NOT_ORDERED: { code: 409, message: '고객 주문이 아직 없습니다 — 주문·결제 후 발주할 수 있습니다.' },
  NOT_PAID: { code: 409, message: '결제(입금) 확인 전입니다 — 입금 확인 후 발주할 수 있습니다.' },
  ALREADY_ISSUED: { code: 409, message: '이 협력사에게 이미 발주서가 있습니다.' },
  RFQ_MISMATCH: { code: 400, message: '견적행이 이 스펙·협력사와 일치하지 않습니다.' },
  PRICE_REQUIRED: { code: 400, message: '발주가를 입력해 주세요(회신 견적이 없는 직접 발주).' },
  EXCHANGE_RATE_REQUIRED: { code: 400, message: '외화 발주에는 KRW 회계 환율이 필요합니다.' },
};

export const adminPcbPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /pcb-pos — 횡단 워크큐(경유 상위 제외한 실작업 단위) ────────────────
  fastify.get(
    '/pcb-pos',
    { schema: { querystring: WorkListQuery, response: { 200: AdminPcbPoWorkListResponse } } },
    async (request) => {
      const all = await loadAdminPcbPoWorkItems();
      const q = request.query.q?.toLowerCase() ?? '';
      const filtered = all.filter(
        ({ item }) =>
          q === '' ||
          item.projectName.toLowerCase().includes(q) ||
          item.partnerName.toLowerCase().includes(q),
      );
      const counts = {
        eq_pending: filtered.filter((r) => r.tab === 'eq_pending').length,
        producing: filtered.filter((r) => r.tab === 'producing').length,
        produced: filtered.filter((r) => r.tab === 'produced').length,
        all: filtered.length,
      };
      const tabbed =
        request.query.tab === 'all' ? filtered : filtered.filter((r) => r.tab === request.query.tab);
      const start = (request.query.page - 1) * request.query.pageSize;
      return {
        result: true as const,
        data: {
          items: tabbed.slice(start, start + request.query.pageSize).map((r) => r.item),
          total: tabbed.length,
          page: request.query.page,
          pageSize: request.query.pageSize,
          counts,
        },
      };
    },
  );

  // ── GET — 스펙별 발주 현황 ──────────────────────────────────────────────────
  fastify.get(
    '/pcb-projects/:id/pos',
    { schema: { params: IdParams, response: { 200: AdminPcbPoListResponse } } },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: request.params.id } });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      return { result: true as const, data: { pos: await loadAdminPcbPos(spec.id) } };
    },
  );

  // ── POST — 발주서 발행(paid 게이트) + 협력사 메일 ───────────────────────────
  fastify.post(
    '/pcb-projects/:id/pos',
    {
      schema: {
        params: IdParams,
        body: AdminPcbPoCreateBody,
        response: { 200: AdminPcbPoListResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const created = await createAdminPcbPo(request.params.id, request.body);
      if (!created.ok) {
        if (created.error === 'SPEC_NOT_FOUND') return reply.notFound('프로젝트가 없습니다');
        if (created.error === 'PARTNER_INVALID')
          return reply
            .status(400)
            .send({ error: created.error, message: created.detail ?? '협력사 검증 실패' });
        const mapped = CREATE_ERROR_MESSAGES[created.error];
        if (mapped !== undefined)
          return reply.status(mapped.code).send({ error: created.error, message: mapped.message });
        return reply.status(409).send({ error: created.error, message: '발주할 수 없습니다.' });
      }

      const spec = await prisma.spOrderSpec.findUnique({ where: { id: request.params.id } });
      if (spec !== null) {
        const requesterName = await loadHousePartnerName();
        void sendPcbMail(
          request.log,
          created.partner.contactEmail,
          buildPcbPoIssuedEmail({
            partnerName: created.partner.name,
            requesterName,
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
      return {
        result: true as const,
        data: { pos: await loadAdminPcbPos(request.params.id) },
      };
    },
  );

  // ── PATCH — 조건 수정(금액·환율은 issued 에서만) ────────────────────────────
  fastify.patch(
    '/pcb-projects/:id/pos/:poId',
    {
      schema: {
        params: PoParams,
        body: AdminPcbPoPatchBody,
        response: { 200: AdminPcbPoListResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await patchPcbPo(po.id, { kind: 'admin' }, request.body);
      if (!res.ok) {
        if (res.error === 'PO_NOT_FOUND' || res.error === 'NOT_ISSUER')
          return reply.notFound('발주서를 찾을 수 없습니다');
        if (res.error === 'EXCHANGE_RATE_REQUIRED')
          return reply
            .status(400)
            .send({ error: res.error, message: '외화 발주에는 KRW 회계 환율이 필요합니다.' });
        return reply.status(409).send({
          error: res.error,
          message: '발주가는 EQ 시작 전(발주접수)에만 수정할 수 있습니다.',
        });
      }
      return { result: true as const, data: { pos: await loadAdminPcbPos(request.params.id) } };
    },
  );

  // ── DELETE — 발행 취소(issued·하위 없음) ────────────────────────────────────
  fastify.delete(
    '/pcb-projects/:id/pos/:poId',
    { schema: { params: PoParams, response: { 200: AdminPcbPoListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await deletePcbPo(po.id, { kind: 'admin' });
      if (!res.ok) {
        if (res.error === 'PO_NOT_FOUND' || res.error === 'NOT_ISSUER')
          return reply.notFound('발주서를 찾을 수 없습니다');
        const message =
          res.error === 'HAS_CHILDREN'
            ? '하위(MD) 발주서가 남아 있어 취소할 수 없습니다 — 하위부터 정리하세요.'
            : 'EQ 진행 중인 발주서는 되돌리기로 발주접수까지 낮춘 뒤 취소할 수 있습니다.';
        return reply.status(409).send({ error: res.error, message });
      }
      return { result: true as const, data: { pos: await loadAdminPcbPos(request.params.id) } };
    },
  );

  // ── EQ 승인/반려/되돌리기 — 관리자=ORDERER(D3) ──────────────────────────────
  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-approve',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbPoEq(po.id, { kind: 'admin' }, 'eq_requested');
      if (!res.ok)
        return reply
          .status(409)
          .send({ error: res.error, message: 'EQ 승인요청 상태에서만 승인할 수 있습니다.' });

      const spec = await prisma.spOrderSpec.findUnique({ where: { id: po.specId } });
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbEqDecisionEmail({
          partnerName: po.partner.name,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          approved: true,
          reason: null,
        }),
      );
      return { result: true as const };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-reject',
    {
      schema: {
        params: PoParams,
        body: PcbPoRejectBody,
        response: { 200: PcbPoActionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await rejectPcbPoEq(po.id, request.body.reason);
      if (!res.ok)
        return reply
          .status(409)
          .send({ error: res.error, message: 'EQ 승인요청 상태에서만 반려할 수 있습니다.' });

      const spec = await prisma.spOrderSpec.findUnique({ where: { id: po.specId } });
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbEqDecisionEmail({
          partnerName: po.partner.name,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          approved: false,
          reason: request.body.reason,
        }),
      );
      return { result: true as const };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-revert',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await revertPcbPoEq(po.id, { kind: 'admin' });
      if (!res.ok)
        return reply.status(409).send({
          error: res.error,
          message: '되돌릴 단계가 없거나 관리자 차례의 전이가 아닙니다.',
        });
      return { result: true as const };
    },
  );

  // ── EQ 첨부 다운로드(관리자 열람) ───────────────────────────────────────────
  fastify.get(
    '/pcb-projects/:id/pos/:poId/eq-files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
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

  done();
};
