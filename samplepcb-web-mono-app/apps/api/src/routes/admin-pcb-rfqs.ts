import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ADMIN_PCB_RFQ_TABS,
  AdminPcbRfqActionResponse,
  AdminPcbRfqCaseListResponse,
  AdminPcbRfqListResponse,
  AdminPcbRfqMagicLinkResponse,
  AdminPcbRfqReplyResponse,
  AdminPcbRfqSelectBody,
  AdminPcbRfqSendBody,
  AdminPcbRfqSendResponse,
  ApiError,
  PcbRfqReplyBody,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  diffSendPcbRfqs,
  loadAdminPcbRfqCases,
  loadAdminPcbRfqs,
  loadHousePartnerName,
  reissuePcbMagicToken,
  savePcbRfqReply,
  selectPcbRfq,
  unselectPcbRfq,
} from '../lib/pcb-rfq';
import { buildPcbRfqRequestEmail, magicPcbReplyUrl, sendPcbMail } from '../lib/pcb-rfq-email';

// ── PCB 파트너 RFQ 관리자 라우트 — docs/PCB_PARTNER_TRACK.md §5.4 ─────────────
// 스펙별 현황·diff 배정·대리 회신·선정/해제·매직링크 + 횡단 워크큐(/pcb-rfqs).
// 배정·선정은 확정가 PATCH 와 같은 스펙 게이트(비담김 active — §5.2-1)를 공유한다.
// 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const RfqParams = z.object({ id: z.coerce.bigint(), rfqId: z.coerce.bigint() });

const CaseListQuery = z.object({
  tab: z.enum(ADMIN_PCB_RFQ_TABS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

// 스펙 게이트 오류 → 사용자 문구(확정가 PATCH 와 같은 정합 사유).
const GATE_MESSAGES: Record<string, string> = {
  NOT_ACTIVE: '활성 상태의 견적이 아닙니다',
  IN_CART: '장바구니에 담긴 견적입니다 — 담김 해제 후 진행하세요',
  ORDERED: '이미 주문된 견적입니다',
};

export const adminPcbRfqRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /pcb-rfqs — 횡단 워크큐(스펙 단위 그룹, 메모리 페이지네이션) ────────
  fastify.get(
    '/pcb-rfqs',
    { schema: { querystring: CaseListQuery, response: { 200: AdminPcbRfqCaseListResponse } } },
    async (request) => {
      const all = await loadAdminPcbRfqCases();
      const q = request.query.q?.toLowerCase() ?? '';
      const filtered = all.filter(
        ({ item }) =>
          q === '' ||
          item.projectName.toLowerCase().includes(q) ||
          (item.mbId ?? '').toLowerCase().includes(q),
      );
      const counts = {
        pending: filtered.filter((r) => r.tab === 'pending').length,
        quoted: filtered.filter((r) => r.tab === 'quoted').length,
        selected: filtered.filter((r) => r.tab === 'selected').length,
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

  // ── GET — 스펙별 RFQ 현황(전 트랙 평면 + MD 하위 집계) ──────────────────────
  fastify.get(
    '/pcb-projects/:id/rfqs',
    { schema: { params: IdParams, response: { 200: AdminPcbRfqListResponse } } },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: request.params.id } });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      return { result: true as const, data: { rfqs: await loadAdminPcbRfqs(spec.id) } };
    },
  );

  // ── POST — diff 배정(신규만 메일·유지 보존·미회신만 회수) ───────────────────
  fastify.post(
    '/pcb-projects/:id/rfqs',
    {
      schema: {
        params: IdParams,
        body: AdminPcbRfqSendBody,
        response: { 200: AdminPcbRfqSendResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: request.params.id } });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');

      const diff = await diffSendPcbRfqs({
        specId: spec.id,
        parentPartnerId: 0n,
        partnerIds: request.body.partnerIds,
        suggestedDeliveryDate: request.body.suggestedDeliveryDate ?? null,
      });
      if (!diff.ok) {
        if (diff.error === 'PARTNER_INVALID') {
          return reply
            .status(400)
            .send({ error: 'INVALID_PARTNER', message: diff.detail ?? '협력사 검증 실패' });
        }
        const message = GATE_MESSAGES[diff.error];
        if (message !== undefined) return reply.status(409).send({ error: diff.error, message });
        return reply.notFound('프로젝트가 없습니다');
      }

      // 알림 메일 — 신규 발송분만, 비차단. 주 CTA = 매직링크(BOM §6.9 승계).
      if (diff.addedPartners.length > 0) {
        const requesterName = await loadHousePartnerName();
        for (const partner of diff.addedPartners) {
          const token = diff.addedTokens.get(partner.id.toString());
          void sendPcbMail(
            request.log,
            partner.contactEmail,
            buildPcbRfqRequestEmail({
              partnerName: partner.name,
              requesterName,
              projectName: spec.projectName,
              qty: spec.qty,
              suggestedDeliveryDate: request.body.suggestedDeliveryDate ?? null,
              magicUrl: token === undefined ? null : magicPcbReplyUrl(token),
            }),
          );
        }
      }

      return {
        result: true as const,
        data: {
          added: diff.added,
          kept: diff.kept,
          removed: diff.removed,
          rfqs: await loadAdminPcbRfqs(spec.id),
        },
      };
    },
  );

  // ── PUT — 관리자 대리 회신(포털·매직링크와 같은 코어 — 저장 경로 단일) ───────
  fastify.put(
    '/pcb-projects/:id/rfqs/:rfqId/reply',
    {
      schema: {
        params: RfqParams,
        body: PcbRfqReplyBody,
        response: { 200: AdminPcbRfqReplyResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const rfq = await prisma.spPcbRfq.findUnique({ where: { id: request.params.rfqId } });
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      if (rfq.specId !== request.params.id)
        return reply.notFound('견적요청을 찾을 수 없습니다');
      const saved = await savePcbRfqReply(rfq.id, request.body);
      if (!saved.ok) {
        if (saved.error === 'RFQ_NOT_FOUND') return reply.notFound('견적요청을 찾을 수 없습니다');
        if (saved.error === 'EXCHANGE_RATE_UNAVAILABLE')
          return reply.status(409).send({
            error: saved.error,
            message: '환율 정보가 준비되지 않았습니다 — 잠시 후 다시 시도해 주세요.',
          });
        return reply
          .status(409)
          .send({ error: saved.error, message: '선정/미선정 상태의 회신은 수정할 수 없습니다.' });
      }
      const view = (await loadAdminPcbRfqs(rfq.specId)).find((v) => v.rfqId === Number(rfq.id));
      if (view === undefined) return reply.notFound('견적요청을 찾을 수 없습니다');
      return { result: true as const, data: view };
    },
  );

  // ── POST — 선정(외화는 환율 필수) / 해제 ────────────────────────────────────
  fastify.post(
    '/pcb-projects/:id/rfqs/:rfqId/select',
    {
      schema: {
        params: RfqParams,
        body: AdminPcbRfqSelectBody,
        response: { 200: AdminPcbRfqActionResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const res = await selectPcbRfq(request.params.rfqId, request.body.exchangeRate);
      if (!res.ok) {
        if (res.error === 'RFQ_NOT_FOUND') return reply.notFound('견적요청을 찾을 수 없습니다');
        if (res.error === 'EXCHANGE_RATE_REQUIRED')
          return reply
            .status(400)
            .send({ error: res.error, message: '외화 견적 선정에는 적용 환율이 필요합니다.' });
        const message =
          GATE_MESSAGES[res.error] ??
          (res.error === 'ALREADY_SELECTED'
            ? '이미 선정된 협력사가 있습니다 — 먼저 선정을 해제하세요.'
            : '회신 완료 상태의 견적만 선정할 수 있습니다.');
        return reply.status(409).send({ error: res.error, message });
      }
      return { result: true as const };
    },
  );

  fastify.post(
    '/pcb-projects/:id/rfqs/:rfqId/unselect',
    { schema: { params: RfqParams, response: { 200: AdminPcbRfqActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const res = await unselectPcbRfq(request.params.rfqId);
      if (!res.ok) {
        if (res.error === 'RFQ_NOT_FOUND') return reply.notFound('견적요청을 찾을 수 없습니다');
        const message =
          GATE_MESSAGES[res.error] ?? '선정 상태의 견적만 해제할 수 있습니다.';
        return reply.status(409).send({ error: res.error, message });
      }
      return { result: true as const };
    },
  );

  // ── POST — 매직링크 재발급(회전 — 구 토큰 즉시 무효) ────────────────────────
  fastify.post(
    '/pcb-projects/:id/rfqs/:rfqId/magic-link',
    { schema: { params: RfqParams, response: { 200: AdminPcbRfqMagicLinkResponse } } },
    async (request, reply) => {
      const rfq = await prisma.spPcbRfq.findUnique({ where: { id: request.params.rfqId } });
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      if (rfq.specId !== request.params.id)
        return reply.notFound('견적요청을 찾을 수 없습니다');
      const magicToken = await reissuePcbMagicToken(rfq.id);
      return { result: true as const, data: { magicToken } };
    },
  );

  done();
};
