import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpPartner } from '@prisma/client';
import { z } from 'zod';
import {
  ApiError,
  PartnerChildCreateBody,
  PartnerChildDeleteResponse,
  PartnerChildInviteBody,
  PartnerChildListResponse,
  PartnerChildUpdateBody,
} from '@sp/api-contract';
import { getShopEstimateProfile } from '../lib/g5-db';
import {
  PARTNER_INVITE_TTL_DAYS,
  createPartnerInvite,
  loadOwnedChild,
  loadPartnerChildren,
  removeOwnedChild,
  resolveChildEligibility,
} from '../lib/partner-children';
import {
  adminPartnersUrl,
  buildPartnerChildRegisteredEmail,
  buildPartnerInviteEmail,
  partnerInviteUrl,
} from '../lib/partner-children-email';
import { sendPcbMail } from '../lib/pcb-rfq-email';
import { prisma } from '../lib/prisma';

// ── /api/partner/children — 하위 협력사 직접 관리(requirePartner) ────────────
// docs/PARTNER_PORTAL.md "하위 협력사 직접 관리". 마스터딜러가 자기 하위를 등록·수정·삭제한다.
//  · 등록은 자동 승인 — 승인 절차를 두면 "쉽게 쓴다"는 목적이 깨진다. 대신 등록 주체를 남기고
//    운영자에게 메일로 알리며, 관리자는 파트너 관리에서 언제든 정지할 수 있다.
//  · 회원 계정은 만들지 않는다 — 하위는 매직링크로 회신하고, 계정이 필요하면 초대로 본인이 연결한다.
//  · 수정·삭제·초대는 **내가 등록한 조직**에만(관리자가 연결해 준 하위는 읽기 전용).
//  · 첫 등록은 조직을 마스터딜러로 전환한다 — 진행 중 직속 발주가 있으면 막고 미리 안내한다
//    (관리자 대리 접속만 사유를 남겨 넘을 수 있다).

const ChildParams = z.object({ childId: z.string().regex(/^\d+$/) });

const BLOCK_ERRORS = {
  NO_PCB_TRACK: {
    error: 'NO_PCB_TRACK',
    message: 'PCB 견적 협력사만 하위 협력사를 둘 수 있습니다.',
  },
  PARENT_IS_CHILD: {
    error: 'PARENT_IS_CHILD',
    message: '다른 마스터딜러의 하위 조직은 하위 협력사를 둘 수 없습니다(2단 제한).',
  },
  ACTIVE_POS: {
    error: 'PARENT_HAS_ACTIVE_POS',
    message: '진행 중인 발주가 있어 지금은 하위 협력사를 등록할 수 없습니다 — 발주 종결 후 등록해 주세요.',
  },
} as const;

const NOT_OWNED = {
  error: 'NOT_OWNED',
  message: '관리자가 연결한 협력사는 여기서 바꿀 수 없습니다 — 샘플피씨비 담당자에게 요청해 주세요.',
};

export const partnerChildRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  const requireCtx = (request: {
    partnerContext?: { partnerId: bigint; partnerName: string; actingAdmin: boolean };
  }) => {
    const ctx = request.partnerContext;
    if (ctx === undefined) throw fastify.httpErrors.forbidden();
    return ctx;
  };

  const loadMe = async (partnerId: bigint): Promise<SpPartner> => {
    const me = await prisma.spPartner.findUnique({ where: { id: partnerId } });
    if (me === null) throw fastify.httpErrors.forbidden();
    return me;
  };

  // ── GET — 내 하위 협력사 + 등록 가능 여부 ───────────────────────────────────
  fastify.get(
    '/partner/children',
    { schema: { response: { 200: PartnerChildListResponse } } },
    async (request) => {
      const ctx = requireCtx(request);
      const me = await loadMe(ctx.partnerId);
      return { result: true as const, data: await loadPartnerChildren(me, ctx.actingAdmin) };
    },
  );

  // ── POST — 등록(조직 생성 + 소속 연결, 자동 승인) ───────────────────────────
  fastify.post(
    '/partner/children',
    {
      schema: {
        body: PartnerChildCreateBody,
        response: { 200: PartnerChildListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const me = await loadMe(ctx.partnerId);
      const b = request.body;
      // 정지된 조직은 관리자 대리 접속으로만 여기까지 온다 — 새 하위를 붙이지는 않는다.
      if (me.status !== 'approved') {
        return reply
          .status(409)
          .send({ error: 'NOT_APPROVED', message: '승인 상태의 조직만 하위 협력사를 등록할 수 있습니다.' });
      }
      const eligibility = await resolveChildEligibility(me, ctx.actingAdmin);
      let forceNote: string | null = null;
      if (!eligibility.allowed && eligibility.reason !== null) {
        const forced =
          eligibility.reason === 'ACTIVE_POS' && eligibility.canForce && b.forceReason !== undefined;
        if (!forced) return reply.status(409).send(BLOCK_ERRORS[eligibility.reason]);
        forceNote = b.forceReason ?? null;
      }

      const child = await prisma.$transaction(async (tx) => {
        const created = await tx.spPartner.create({
          data: {
            type: 'partner',
            name: b.name,
            country: b.country,
            defaultCurrency: b.settlementCurrency,
            capabilities: ['pcb_rfq'],
            status: 'approved',
            contactName: b.contactName ?? null,
            contactPhone: b.contactPhone ?? null,
            contactEmail: b.contactEmail ?? null,
            ownerPartnerId: me.id,
            createdBy: request.user.mbId,
            decidedAt: new Date(), // 자동 승인 — 처리 관리자(decidedBy)는 없다
          },
        });
        await tx.spPartnerRelation.create({
          data: {
            parentPartnerId: me.id,
            childPartnerId: created.id,
            settlementCurrency: b.settlementCurrency,
            createdBy: request.user.mbId,
            forceNote,
          },
        });
        return created;
      });

      // 운영자 통지 — 자동 승인의 사후 감독 출발점(비차단).
      void getShopEstimateProfile()
        .then((profile) =>
          sendPcbMail(
            request.log,
            profile?.managerEmail,
            buildPartnerChildRegisteredEmail({
              childName: child.name,
              country: child.country,
              contactEmail: child.contactEmail,
              ownerName: me.name,
              registeredBy: request.user.mbId,
              forceNote,
              adminUrl: adminPartnersUrl(),
            }),
            {
              kind: 'partner_child_registered',
              refType: 'partner',
              refId: child.id,
              sentBy: request.user.mbId,
              params: { partnerId: String(child.id), partnerName: child.name, ownerName: me.name },
            },
          ),
        )
        .catch((err: unknown) => {
          request.log.error({ err }, 'partner child registered mail failed');
        });

      return { result: true as const, data: await loadPartnerChildren(me, ctx.actingAdmin) };
    },
  );

  // ── PUT — 수정(내가 등록한 조직만. 링크 통화는 이후 배정부터 적용) ───────────
  fastify.put(
    '/partner/children/:childId',
    {
      schema: {
        params: ChildParams,
        body: PartnerChildUpdateBody,
        response: { 200: PartnerChildListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const me = await loadMe(ctx.partnerId);
      const childId = BigInt(request.params.childId);
      const owned = await loadOwnedChild(me.id, childId);
      if (!owned.ok) {
        if (owned.error === 'NOT_FOUND') return reply.notFound('하위 협력사를 찾을 수 없습니다');
        return reply.status(409).send(NOT_OWNED);
      }
      const b = request.body;
      const data: Prisma.SpPartnerUpdateInput = {};
      if (b.name !== undefined) data.name = b.name;
      if (b.country !== undefined) data.country = b.country;
      if (b.contactName !== undefined) data.contactName = b.contactName ?? null;
      if (b.contactPhone !== undefined) data.contactPhone = b.contactPhone ?? null;
      if (b.contactEmail !== undefined) data.contactEmail = b.contactEmail ?? null;
      if (b.settlementCurrency !== undefined) data.defaultCurrency = b.settlementCurrency;
      await prisma.$transaction([
        prisma.spPartner.update({ where: { id: childId }, data }),
        ...(b.settlementCurrency === undefined
          ? []
          : [
              prisma.spPartnerRelation.updateMany({
                where: { parentPartnerId: me.id, childPartnerId: childId },
                data: { settlementCurrency: b.settlementCurrency },
              }),
            ]),
      ]);
      return { result: true as const, data: await loadPartnerChildren(me, ctx.actingAdmin) };
    },
  );

  // ── DELETE — 삭제(이력이 없으면 삭제, 있으면 사용 중지) ─────────────────────
  fastify.delete(
    '/partner/children/:childId',
    {
      schema: {
        params: ChildParams,
        response: { 200: PartnerChildDeleteResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const me = await loadMe(ctx.partnerId);
      const owned = await loadOwnedChild(me.id, BigInt(request.params.childId));
      if (!owned.ok) {
        if (owned.error === 'NOT_FOUND') return reply.notFound('하위 협력사를 찾을 수 없습니다');
        return reply.status(409).send(NOT_OWNED);
      }
      const removed = await removeOwnedChild(me.id, owned.child, request.user.mbId);
      if (!removed.ok) {
        return reply.status(409).send(
          removed.error === 'RELATION_ACTIVE'
            ? {
                error: 'RELATION_ACTIVE',
                message: '진행 중인 견적·발주가 있어 삭제할 수 없습니다 — 종결(생산완료) 후 삭제해 주세요.',
              }
            : {
                error: 'SHARED_CHILD',
                message: '다른 마스터딜러와 함께 쓰는 협력사입니다 — 샘플피씨비 담당자에게 요청해 주세요.',
              },
        );
      }
      const data = await loadPartnerChildren(me, ctx.actingAdmin);
      return { result: true as const, data: { ...data, outcome: removed.outcome } };
    },
  );

  // ── POST — 다시 사용(내가 사용 중지한 조직만 — 관리자 정지는 되살리지 못한다) ──
  fastify.post(
    '/partner/children/:childId/reactivate',
    { schema: { params: ChildParams, response: { 200: PartnerChildListResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const me = await loadMe(ctx.partnerId);
      const owned = await loadOwnedChild(me.id, BigInt(request.params.childId));
      if (!owned.ok) {
        if (owned.error === 'NOT_FOUND') return reply.notFound('하위 협력사를 찾을 수 없습니다');
        return reply.status(409).send(NOT_OWNED);
      }
      const updated = await prisma.spPartner.updateMany({
        where: { id: owned.child.id, status: 'suspended', NOT: { ownerSuspendedAt: null } },
        data: {
          status: 'approved',
          statusReason: null,
          ownerSuspendedAt: null,
          decidedBy: request.user.mbId,
          decidedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        return reply.status(409).send({
          error: 'NOT_OWNER_SUSPENDED',
          message: '샘플피씨비에서 정지한 협력사는 다시 사용으로 바꿀 수 없습니다 — 담당자에게 문의해 주세요.',
        });
      }
      return { result: true as const, data: await loadPartnerChildren(me, ctx.actingAdmin) };
    },
  );

  // ── POST — 포털 초대(본인 계정 연결용 1회용 링크 메일) ──────────────────────
  fastify.post(
    '/partner/children/:childId/invite',
    {
      schema: {
        params: ChildParams,
        body: PartnerChildInviteBody,
        response: { 200: PartnerChildListResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = requireCtx(request);
      const me = await loadMe(ctx.partnerId);
      const owned = await loadOwnedChild(me.id, BigInt(request.params.childId));
      if (!owned.ok) {
        if (owned.error === 'NOT_FOUND') return reply.notFound('하위 협력사를 찾을 수 없습니다');
        return reply.status(409).send(NOT_OWNED);
      }
      const child = owned.child;
      if (child.status !== 'approved') {
        return reply
          .status(409)
          .send({ error: 'NOT_APPROVED', message: '사용 중지된 협력사는 초대할 수 없습니다.' });
      }
      const email = request.body.email ?? child.contactEmail ?? '';
      if (email === '') {
        return reply
          .status(400)
          .send({ error: 'EMAIL_REQUIRED', message: '초대를 받을 이메일이 필요합니다.' });
      }
      // 1조직 = 계정 1개 운영(스키마는 1:N). 이미 연결돼 있으면 초대가 아니라 계정 교체 문의다.
      const members = await prisma.spPartnerMember.count({ where: { partnerId: child.id } });
      if (members > 0) {
        return reply
          .status(409)
          .send({ error: 'ALREADY_HAS_ACCOUNT', message: '이미 포털 계정이 연결된 협력사입니다.' });
      }
      const token = await createPartnerInvite(child.id, email, request.user.mbId);
      void sendPcbMail(
        request.log,
        email,
        buildPartnerInviteEmail({
          partnerName: child.name,
          inviterName: me.name,
          acceptUrl: partnerInviteUrl(token),
          ttlDays: PARTNER_INVITE_TTL_DAYS,
        }),
        {
          kind: 'partner_invite',
          refType: 'partner',
          refId: child.id,
          sentBy: request.user.mbId,
          params: { partnerId: String(child.id), partnerName: child.name, inviterName: me.name },
        },
      );
      return { result: true as const, data: await loadPartnerChildren(me, ctx.actingAdmin) };
    },
  );

  done();
};
