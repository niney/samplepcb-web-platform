import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpMarketExpert } from '@prisma/client';
import { z } from 'zod';
import {
  AdminMarketExpertDecisionBody,
  AdminMarketExpertDecisionResponse,
  AdminMarketExpertDetailResponse,
  AdminMarketExpertListQuery,
  AdminMarketExpertListResponse,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminMarketExpertCountsType,
  AdminMarketExpertListItemType,
  MarketExpertStatusType,
} from '@sp/api-contract';
import { getMembersByIds } from '../lib/g5-db';
import type { G5Member } from '../lib/g5-db';
import { buildExpertDecisionEmail, sendMarketMail } from '../lib/market-email';
import {
  REF_MARKET_EXPERT,
  asCareerRange,
  asExpertStatus,
  asExpertType,
  asRegionOrNull,
  asTravelRangeOrNull,
  toCadCodes,
  toCategoryCodes,
  toFileMeta,
  toServiceAreaCodes,
} from '../lib/market';
import { prisma } from '../lib/prisma';

// ── /api/admin/market/experts — 전문가 심사(승인/반려/정지) ──────────────────
// 관리자는 마스킹·블라인드 예외(운영 감독): mbId·연락처·계좌·g5 회원 표시정보 열람.
// 상태 전이는 조건부 updateMany — 관리자 2명이 동시에 눌러도 한 번만 반영(0건=409).
// 전 라우트 requireAdmin(addHook 일괄 — 라우트별 누락 사고 차단).

const ExpertIdParams = z.object({ id: z.string().regex(/^\d+$/) });

const toMember = (m: G5Member | undefined): AdminMarketExpertListItemType['member'] =>
  m === undefined ? null : { name: m.name, nick: m.nick, email: m.email, hp: m.hp };

const toAdminItem = (
  e: SpMarketExpert,
  member: G5Member | undefined,
): AdminMarketExpertListItemType => ({
  expertId: Number(e.id),
  mbId: e.mbId,
  displayName: e.displayName,
  expertType: asExpertType(e.expertType),
  careerRange: asCareerRange(e.careerRange),
  region: asRegionOrNull(e.region),
  status: asExpertStatus(e.status),
  identityVerified: e.identityVerified,
  createdAt: e.createdAt.toISOString(),
  decidedAt: e.decidedAt?.toISOString() ?? null,
  member: toMember(member),
});

// 상태 전이 공통 — expectedFrom 에서만 to 로(조건부 updateMany, 감사 필드 기록).
const transition = async (
  expertId: bigint,
  expectedFrom: MarketExpertStatusType,
  to: MarketExpertStatusType,
  decidedBy: string,
  reason: string | null,
): Promise<boolean> => {
  const updated = await prisma.spMarketExpert.updateMany({
    where: { id: expertId, status: expectedFrom },
    data: { status: to, statusReason: reason, decidedBy, decidedAt: new Date() },
  });
  return updated.count > 0;
};

export const adminMarketExpertRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/market/experts — 심사 목록(탭 counts) ────────────────────
  fastify.get(
    '/market/experts',
    {
      schema: {
        querystring: AdminMarketExpertListQuery,
        response: { 200: AdminMarketExpertListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab, q } = request.query;
      const keyword = q?.trim();
      const base: Prisma.SpMarketExpertWhereInput =
        keyword !== undefined && keyword !== ''
          ? { OR: [{ displayName: { contains: keyword } }, { mbId: { contains: keyword } }] }
          : {};
      const where: Prisma.SpMarketExpertWhereInput =
        tab === 'all' ? base : { AND: [base, { status: tab }] };

      const [rows, total, grouped] = await Promise.all([
        prisma.spMarketExpert.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketExpert.count({ where }),
        // counts — 검색어 반영, 탭 미반영(현재 필터된 집합의 분포 — 회원 관리 관례)
        prisma.spMarketExpert.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      ]);
      const counts: AdminMarketExpertCountsType = {
        all: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        suspended: 0,
      };
      for (const g of grouped) {
        counts[asExpertStatus(g.status)] += g._count._all;
        counts.all += g._count._all;
      }

      const members = await getMembersByIds(rows.map((e) => e.mbId));
      const items = rows.map((e) => toAdminItem(e, members.get(e.mbId)));
      return { result: true as const, data: { items, total, page, pageSize, counts } };
    },
  );

  // ── GET /api/admin/market/experts/:id — 심사 상세(계좌·증빙 포함) ───────────
  fastify.get(
    '/market/experts/:id',
    {
      schema: { params: ExpertIdParams, response: { 200: AdminMarketExpertDetailResponse } },
    },
    async (request, reply) => {
      const expert = await prisma.spMarketExpert.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (expert === null) return reply.notFound('전문가가 없습니다');
      const [members, files] = await Promise.all([
        getMembersByIds([expert.mbId]),
        prisma.spFile.findMany({
          where: { refType: REF_MARKET_EXPERT, refId: expert.id },
          orderBy: { id: 'asc' },
          select: { id: true, fileType: true, originFileName: true, size: true },
        }),
      ]);
      return {
        result: true as const,
        data: {
          ...toAdminItem(expert, members.get(expert.mbId)),
          phone: expert.phone,
          contactHours: expert.contactHours,
          travelRange: asTravelRangeOrNull(expert.travelRange),
          intro: expert.intro,
          serviceAreas: toServiceAreaCodes(expert.serviceAreas),
          categories: toCategoryCodes(expert.categories),
          cadTools: toCadCodes(expert.cadTools),
          bankName: expert.bankName,
          bankHolder: expert.bankHolder,
          bankAccount: expert.bankAccount,
          termsAgreedAt: expert.termsAgreedAt.toISOString(),
          statusReason: expert.statusReason,
          decidedBy: expert.decidedBy,
          files: files.map(toFileMeta),
        },
      };
    },
  );

  // ── POST 심사 액션 4종 — 전이 표(설계 §5): pending→approved/rejected,
  //    approved→suspended, suspended→approved. 그 외 전이는 409.
  fastify.post(
    '/market/experts/:id/approve',
    {
      schema: {
        params: ExpertIdParams,
        response: { 200: AdminMarketExpertDecisionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const expert = await prisma.spMarketExpert.findUnique({ where: { id } });
      if (expert === null) return reply.notFound('전문가가 없습니다');
      const ok = await transition(id, 'pending', 'approved', request.user.mbId, null);
      if (!ok) {
        return reply
          .status(409)
          .send({ error: 'INVALID_TRANSITION', message: '심사 대기 상태가 아닙니다.' });
      }
      // 승인 통지(비차단).
      const members = await getMembersByIds([expert.mbId]);
      void sendMarketMail(
        request.log,
        members.get(expert.mbId)?.email,
        buildExpertDecisionEmail({ displayName: expert.displayName, approved: true }),
      );
      return {
        result: true as const,
        data: { expertId: Number(id), status: 'approved' as const, statusReason: null },
      };
    },
  );

  fastify.post(
    '/market/experts/:id/reject',
    {
      schema: {
        params: ExpertIdParams,
        body: AdminMarketExpertDecisionBody,
        response: { 200: AdminMarketExpertDecisionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const expert = await prisma.spMarketExpert.findUnique({ where: { id } });
      if (expert === null) return reply.notFound('전문가가 없습니다');
      const ok = await transition(id, 'pending', 'rejected', request.user.mbId, request.body.reason);
      if (!ok) {
        return reply
          .status(409)
          .send({ error: 'INVALID_TRANSITION', message: '심사 대기 상태가 아닙니다.' });
      }
      // 반려 통지(비차단) — 사유 포함.
      const members = await getMembersByIds([expert.mbId]);
      void sendMarketMail(
        request.log,
        members.get(expert.mbId)?.email,
        buildExpertDecisionEmail({
          displayName: expert.displayName,
          approved: false,
          reason: request.body.reason,
        }),
      );
      return {
        result: true as const,
        data: { expertId: Number(id), status: 'rejected' as const, statusReason: request.body.reason },
      };
    },
  );

  fastify.post(
    '/market/experts/:id/suspend',
    {
      schema: {
        params: ExpertIdParams,
        body: AdminMarketExpertDecisionBody,
        response: { 200: AdminMarketExpertDecisionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const expert = await prisma.spMarketExpert.findUnique({ where: { id } });
      if (expert === null) return reply.notFound('전문가가 없습니다');
      const ok = await transition(id, 'approved', 'suspended', request.user.mbId, request.body.reason);
      if (!ok) {
        return reply
          .status(409)
          .send({ error: 'INVALID_TRANSITION', message: '활동 중 상태가 아닙니다.' });
      }
      return {
        result: true as const,
        data: { expertId: Number(id), status: 'suspended' as const, statusReason: request.body.reason },
      };
    },
  );

  fastify.post(
    '/market/experts/:id/unsuspend',
    {
      schema: {
        params: ExpertIdParams,
        response: { 200: AdminMarketExpertDecisionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const expert = await prisma.spMarketExpert.findUnique({ where: { id } });
      if (expert === null) return reply.notFound('전문가가 없습니다');
      const ok = await transition(id, 'suspended', 'approved', request.user.mbId, null);
      if (!ok) {
        return reply
          .status(409)
          .send({ error: 'INVALID_TRANSITION', message: '정지 상태가 아닙니다.' });
      }
      return {
        result: true as const,
        data: { expertId: Number(id), status: 'approved' as const, statusReason: null },
      };
    },
  );

  done();
};
