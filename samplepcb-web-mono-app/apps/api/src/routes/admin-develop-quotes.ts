import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { SpDevelopQuote } from '@prisma/client';
import { z } from 'zod';
import {
  AdminDevelopMilestoneMarkPaidBody,
  AdminDevelopQuoteBody,
  AdminDevelopQuoteResponse,
  ApiError,
  DevelopOkResponse,
  computeDevelopQuoteAmounts,
  splitDevelopMilestoneAmounts,
} from '@sp/api-contract';
import type { AdminDevelopQuoteBodyType, AdminDevelopQuoteResponseType } from '@sp/api-contract';
import { REF_DEVELOP_QUOTE, addDevelopEvent, asDevelopStatus, transitionDevelopStatus } from '../lib/develop';
import { buildQuoteSentEmail, sendDevelopMail } from '../lib/develop-email';
import { cancelPendingMilestones, ensureDevelopLazy, markMilestonePaid } from '../lib/develop-payment';
import { toAreaCodes } from '../lib/market';
import { prisma } from '../lib/prisma';
import { customerEmailOf, toQuoteView } from './develop-requests';

// ── /api/admin/develop/{requests/:id/quotes, quotes/:qid, milestones/:mid} — 견적서·마일스톤(docs/DEVELOP_FLOW.md §5) ──
// 견적서 = 조건 문서: 항목표 + 결제 조건(마일스톤 비율) + 기간·산출물·별도 실비·표준 조건·검수 기간·유효기간.
// draft 에서만 수정, 발송 때 금액(공급가·VAT·합계)과 마일스톤 금액을 확정한다(그 뒤 설정이 바뀌어도 이 견적은 불변).
// initial/revision 은 의뢰당 sent 1건(새 발송이 이전 sent 를 superseded 로), change(추가 견적)는 독립.

const RequestIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const QuoteIdParams = z.object({ qid: z.string().regex(/^\d+$/) });
const MilestoneIdParams = z.object({ mid: z.string().regex(/^\d+$/) });

const notFound = { error: 'NOT_FOUND', message: '대상이 없습니다' };

export const adminDevelopQuoteRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const quoteView = async (q: SpDevelopQuote): Promise<AdminDevelopQuoteResponseType['data']> => {
    const [full, request, po] = await Promise.all([
      prisma.spDevelopQuote.findUniqueOrThrow({ where: { id: q.id }, include: { items: true, milestones: true } }),
      prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: q.requestId } }),
      prisma.spFile.findFirst({ where: { refType: REF_DEVELOP_QUOTE, refId: q.id, fileType: 'po' } }),
    ]);
    return { ...toQuoteView(full, asDevelopStatus(request.status), po), internalNote: full.internalNote };
  };

  // 항목·마일스톤 행을 통째로 갈아 끼운다(draft 전용). 금액은 발송 시 확정하지만 화면 표시용으로 미리 계산해 둔다.
  const writeQuoteBody = async (quoteId: bigint, requestId: bigint, b: AdminDevelopQuoteBodyType): Promise<void> => {
    const amounts = computeDevelopQuoteAmounts(b.items.map((i) => i.amount), b.vatMode);
    const split = splitDevelopMilestoneAmounts(amounts.totalAmount, b.milestones.map((m) => m.ratioBp));
    await prisma.$transaction(async (tx) => {
      await tx.spDevelopQuote.update({
        where: { id: quoteId },
        data: {
          kind: b.kind,
          title: b.title,
          vatMode: b.vatMode,
          supplyAmount: amounts.supplyAmount,
          vatAmount: amounts.vatAmount,
          totalAmount: amounts.totalAmount,
          durationDays: b.durationDays,
          scheduleNote: b.scheduleNote,
          deliverables: b.deliverables,
          exclusions: b.exclusions,
          terms: b.terms,
          warrantyDays: b.warrantyDays,
          reviewDays: b.reviewDays,
          validUntil: b.validUntil,
          note: b.note,
          internalNote: b.internalNote,
        },
      });
      await tx.spDevelopQuoteItem.deleteMany({ where: { quoteId } });
      await tx.spDevelopQuoteItem.createMany({
        data: b.items.map((it, i) => ({ quoteId, seq: i + 1, title: it.title, description: it.description, amount: it.amount, durationDays: it.durationDays })),
      });
      // 마일스톤은 paymentKey(uuid) 를 새로 만든다 — draft 라 카트행이 없어 안전.
      await tx.spDevelopMilestone.deleteMany({ where: { quoteId } });
      await tx.spDevelopMilestone.createMany({
        data: b.milestones.map((m, i) => ({
          quoteId,
          requestId,
          seq: i + 1,
          title: m.title,
          ratioBp: m.ratioBp,
          amount: split[i] ?? 0,
          trigger: m.trigger,
          status: 'draft',
          paymentKey: randomUUID(),
          unlocksDeliverables: m.unlocksDeliverables,
        })),
      });
    });
  };

  // ── POST /admin/develop/requests/:id/quotes — 초안 생성 ─────────────────────────
  fastify.post(
    '/develop/requests/:id/quotes',
    { schema: { params: RequestIdParams, body: AdminDevelopQuoteBody, response: { 200: AdminDevelopQuoteResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const r = await prisma.spDevelopRequest.findUnique({ where: { id: BigInt(request.params.id) } });
      if (r === null) return reply.status(404).send(notFound);
      const status = asDevelopStatus(r.status);
      if (status === 'cancelled' || status === 'declined' || status === 'completed') {
        return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '종결된 의뢰에는 견적을 만들 수 없습니다' });
      }
      const b = request.body;
      // 추가 견적(change)은 착수 뒤에만 의미가 있고, 첫/수정 견적은 착수 전에만.
      const beforeStart = status === 'received' || status === 'reviewing' || status === 'quoted';
      if (b.kind === 'change' && beforeStart) {
        return reply.status(409).send({ error: 'KIND_MISMATCH', message: '추가 견적은 착수(수락) 뒤에 만듭니다' });
      }
      if (b.kind !== 'change' && !beforeStart) {
        return reply.status(409).send({ error: 'KIND_MISMATCH', message: '수락 뒤 변경은 추가 견적(change)으로 만듭니다' });
      }
      const last = await prisma.spDevelopQuote.findFirst({ where: { requestId: r.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const created = await prisma.spDevelopQuote.create({
        data: {
          requestId: r.id,
          version: (last?.version ?? 0) + 1,
          kind: b.kind,
          title: b.title,
          vatMode: b.vatMode,
          terms: b.terms,
          validUntil: b.validUntil,
          reviewDays: b.reviewDays,
          createdBy: request.user.mbId,
        },
      });
      await writeQuoteBody(created.id, r.id, b);
      return { result: true as const, data: await quoteView(created) };
    },
  );

  // ── PATCH /admin/develop/quotes/:qid — 초안 수정(전체 교체) ───────────────────
  fastify.patch(
    '/develop/quotes/:qid',
    { schema: { params: QuoteIdParams, body: AdminDevelopQuoteBody, response: { 200: AdminDevelopQuoteResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const q = await prisma.spDevelopQuote.findUnique({ where: { id: BigInt(request.params.qid) } });
      if (q === null) return reply.status(404).send(notFound);
      if (q.status !== 'draft') return reply.status(409).send({ error: 'QUOTE_NOT_DRAFT', message: '발송한 견적은 고칠 수 없습니다 — 수정 견적을 새로 만드세요' });
      await writeQuoteBody(q.id, q.requestId, request.body);
      return { result: true as const, data: await quoteView(q) };
    },
  );

  // ── DELETE /admin/develop/quotes/:qid — 초안 삭제 ───────────────────────────────
  fastify.delete(
    '/develop/quotes/:qid',
    { schema: { params: QuoteIdParams, response: { 200: DevelopOkResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const q = await prisma.spDevelopQuote.findUnique({ where: { id: BigInt(request.params.qid) } });
      if (q === null) return reply.status(404).send(notFound);
      if (q.status !== 'draft') return reply.status(409).send({ error: 'QUOTE_NOT_DRAFT', message: '발송한 견적은 지울 수 없습니다(철회하세요)' });
      await prisma.spDevelopQuote.delete({ where: { id: q.id } }); // items·milestones cascade
      return { result: true as const };
    },
  );

  // ── POST /admin/develop/quotes/:qid/send — 발송(금액 확정·이전 sent 대체·의뢰 quoted·메일) ──
  fastify.post(
    '/develop/quotes/:qid/send',
    { schema: { params: QuoteIdParams, response: { 200: AdminDevelopQuoteResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const q = await prisma.spDevelopQuote.findUnique({ where: { id: BigInt(request.params.qid) }, include: { items: true, milestones: true } });
      if (q === null) return reply.status(404).send(notFound);
      if (q.status !== 'draft') return reply.status(409).send({ error: 'QUOTE_NOT_DRAFT', message: '초안만 발송할 수 있습니다' });
      if (q.items.length === 0 || q.milestones.length === 0) {
        return reply.status(409).send({ error: 'QUOTE_EMPTY', message: '항목과 결제 조건이 필요합니다' });
      }
      const r0 = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: q.requestId } });
      const r = await ensureDevelopLazy(r0, request.log);
      const status = asDevelopStatus(r.status);
      if (status === 'cancelled' || status === 'declined' || status === 'completed') {
        return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '종결된 의뢰입니다' });
      }
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        if (q.kind !== 'change') {
          // 같은 의뢰의 이전 sent(첫/수정 견적)는 대체 — 그 마일스톤(draft)도 닫는다.
          const prev = await tx.spDevelopQuote.findMany({ where: { requestId: q.requestId, status: 'sent', kind: { not: 'change' } } });
          if (prev.length > 0) {
            await tx.spDevelopQuote.updateMany({ where: { id: { in: prev.map((p) => p.id) } }, data: { status: 'superseded', supersededById: q.id } });
            await tx.spDevelopMilestone.updateMany({ where: { quoteId: { in: prev.map((p) => p.id) }, status: 'draft' }, data: { status: 'cancelled' } });
          }
        }
        await tx.spDevelopQuote.update({ where: { id: q.id }, data: { status: 'sent', sentAt: now } });
        await addDevelopEvent(tx, q.requestId, {
          type: 'quote_sent',
          actorMbId: request.user.mbId,
          byAdmin: true,
          title: `견적서 v${String(q.version)} 을 보냈습니다`,
          payload: { quoteId: Number(q.id), version: q.version, kind: q.kind, totalAmount: q.totalAmount },
        });
      });
      if (q.kind !== 'change') {
        await transitionDevelopStatus(q.requestId, ['received', 'reviewing', 'quoted'], 'quoted', { mbId: request.user.mbId, byAdmin: true });
      }
      void sendDevelopMail(
        request.log,
        await customerEmailOf(r),
        buildQuoteSentEmail({
          requestId: Number(r.id),
          title: r.title,
          serviceAreas: toAreaCodes(r.serviceAreas),
          version: q.version,
          totalAmount: q.totalAmount,
          validUntil: q.validUntil,
          itemCount: q.items.length,
        }),
        { kind: 'develop_quote_sent', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: r.mbId },
      );
      return { result: true as const, data: await quoteView(q) };
    },
  );

  // ── POST /admin/develop/quotes/:qid/withdraw — 발송 철회(sent 만) ─────────────────
  fastify.post(
    '/develop/quotes/:qid/withdraw',
    { schema: { params: QuoteIdParams, response: { 200: AdminDevelopQuoteResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const q = await prisma.spDevelopQuote.findUnique({ where: { id: BigInt(request.params.qid) } });
      if (q === null) return reply.status(404).send(notFound);
      if (q.status !== 'sent') return reply.status(409).send({ error: 'QUOTE_NOT_OPEN', message: '발송 상태의 견적만 철회할 수 있습니다' });
      await prisma.spDevelopQuote.update({ where: { id: q.id }, data: { status: 'withdrawn' } });
      await cancelPendingMilestones({ quoteId: q.id });
      await addDevelopEvent(prisma, q.requestId, {
        type: 'note',
        actorMbId: request.user.mbId,
        byAdmin: true,
        title: `견적서 v${String(q.version)} 을 철회했습니다`,
        payload: { quoteId: Number(q.id) },
      });
      return { result: true as const, data: await quoteView(q) };
    },
  );

  // ── POST /admin/develop/milestones/:mid/mark-paid — 오프라인 입금 수동 확인 ─────────
  fastify.post(
    '/develop/milestones/:mid/mark-paid',
    { schema: { params: MilestoneIdParams, body: AdminDevelopMilestoneMarkPaidBody, response: { 200: DevelopOkResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const m = await prisma.spDevelopMilestone.findUnique({ where: { id: BigInt(request.params.mid) } });
      if (m === null) return reply.status(404).send(notFound);
      if (m.status !== 'pending') return reply.status(409).send({ error: 'NOT_PAYABLE', message: '결제 대기 상태가 아닙니다' });
      const ok = await markMilestonePaid(m, 'admin', null, request.log, request.user.mbId);
      if (!ok) return reply.status(409).send({ error: 'ALREADY_PAID', message: '이미 처리되었습니다' });
      if (request.body.note !== undefined && request.body.note !== '') {
        await addDevelopEvent(prisma, m.requestId, {
          type: 'note',
          actorMbId: request.user.mbId,
          byAdmin: true,
          visibleToCustomer: false,
          title: `${m.title} 수동 확인 메모`,
          body: request.body.note,
        });
      }
      return { result: true as const };
    },
  );

  done();
};
