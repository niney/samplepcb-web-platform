import { randomUUID } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpMarketBid, SpMarketExpert } from '@prisma/client';
import { z } from 'zod';
import { MarketBidSubmitBody, MarketMyBidListQuery } from '@sp/api-contract';
import type {
  MarketMyBidListItemType,
  MarketMyBidType,
  MarketProjectBidItemType,
  MarketTargetedProjectListItemType,
} from '@sp/api-contract';
import { getMembersByIds } from '../lib/g5-db';
import { buildAwardEmail, buildNewBidEmail, sendMarketMail } from '../lib/market-email';
import {
  DEFAULT_FEE_RATE_BP,
  asBidStatus,
  asCareerRange,
  asExpertType,
  asProjectMethod,
  asProjectStatus,
  asRegionOrNull,
  isBiddingClosed,
  marketBidCounts,
  marketOwnerNames,
  toMarketProjectListItem,
} from '../lib/market';
import { asContractStatus, computeContractFee } from '../lib/market-contract';
import { buildMarketRequestSnapshot } from '../lib/market-snapshot';
import { prisma } from '../lib/prisma';

// ── /api/market — 입찰(블라인드 견적) 제출·수정·철회·비교·채택 ────────────────
// 블라인드 원칙: 타인 입찰을 반환하는 엔드포인트 자체가 없다 — 전문가는 my-bid,
// 소유자는 /:id/bids(전체), 관리자는 /api/admin/market 로 표면을 분리해 "필드 필터링
// 실수" 여지를 구조적으로 제거한다. 전문가 연락처·mbId 는 소유자 비교 응답에 없다
// (채택 전 우회 직거래 차단 — 연락은 2차 메시지룸/계약에서).
// 채택은 조건부 updateMany 트랜잭션 — 이중 채택·철회 레이스를 DB 가 최종 방어한다.

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const AwardParams = z.object({
  id: z.string().regex(/^\d+$/),
  bidId: z.string().regex(/^\d+$/),
});
const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// 채택 트랜잭션의 조건부 갱신 실패(이미 채택/취소/철회) 신호.
class AwardConflictError extends Error {}

const toMyBid = (b: SpMarketBid): MarketMyBidType => ({
  bidId: Number(b.id),
  projectId: Number(b.projectId),
  amount: b.amount,
  durationDays: b.durationDays,
  warranty: b.warranty,
  message: b.message,
  status: asBidStatus(b.status),
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
});

// 소유자 비교용 행 — 전문가는 비교에 필요한 요약만(연락처·mbId 비노출).
const toOwnerBidItem = (
  b: SpMarketBid,
  e: SpMarketExpert | undefined,
): MarketProjectBidItemType => ({
  bidId: Number(b.id),
  amount: b.amount,
  durationDays: b.durationDays,
  warranty: b.warranty,
  message: b.message,
  status: asBidStatus(b.status),
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
  expert: {
    expertId: Number(b.expertId),
    displayName: e?.displayName ?? '',
    expertType: asExpertType(e?.expertType ?? 'individual'),
    careerRange: asCareerRange(e?.careerRange ?? ''),
    region: asRegionOrNull(e?.region ?? null),
  },
});

export const marketBidRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── POST /market/projects/:id/bids — 입찰 제출(승인 전문가) ─────────────────
  fastify.post(
    '/market/projects/:id/bids',
    {
      schema: { params: ProjectIdParams, body: MarketBidSubmitBody },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      const mbId = request.user.mbId;

      // 가드 사슬 — UI 숨김이 아니라 서버가 강제한다(설계 §7).
      const expert = await prisma.spMarketExpert.findUnique({ where: { mbId } });
      if (expert?.status !== 'approved') {
        return reply.status(403).send({ result: false, error: 'EXPERT_NOT_APPROVED' });
      }
      if (project.mbId === mbId) {
        return reply.status(403).send({ result: false, error: 'SELF_BID_FORBIDDEN' });
      }
      if (project.method === 'targeted' && project.targetExpertId !== expert.id) {
        return reply.status(403).send({ result: false, error: 'TARGETED_ONLY' });
      }
      // 시스템 통합(전체서비스) 의뢰는 검증 조직만 입찰 — 기획 §13.4 의 완화형(사용자
      // 확정 2026-07-12): 목록·상세는 공개 유지, 입찰만 company·house 로 제한.
      if (project.requestType === 'system' && expert.expertType === 'individual') {
        return reply.status(403).send({ result: false, error: 'FULL_SERVICE_COMPANY_ONLY' });
      }
      if (isBiddingClosed(project.status, project.bidDeadlineAt, new Date())) {
        return reply.status(409).send({ result: false, error: 'BIDDING_CLOSED' });
      }

      let bid: SpMarketBid;
      try {
        bid = await prisma.spMarketBid.create({
          data: {
            projectId: project.id,
            expertId: expert.id,
            mbId,
            amount: request.body.amount,
            durationDays: request.body.durationDays,
            warranty: request.body.warranty ?? null,
            message: request.body.message,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // 전문가당 1입찰(unique) — 재제출은 PATCH my-bid 로.
          return reply.status(409).send({ result: false, error: 'ALREADY_BID' });
        }
        throw err;
      }

      // 새 견적 도착 알림(비차단) — 의뢰인에게 메일(의뢰인은 블라인드 예외라 금액 안내 가능).
      const [members, bidCount] = await Promise.all([
        getMembersByIds([project.mbId]),
        prisma.spMarketBid.count({
          where: { projectId: project.id, status: { not: 'withdrawn' } },
        }),
      ]);
      void sendMarketMail(
        request.log,
        members.get(project.mbId)?.email,
        buildNewBidEmail({
          projectId: Number(project.id),
          projectTitle: project.title,
          expertDisplayName: expert.displayName,
          amount: bid.amount,
          durationDays: bid.durationDays,
          bidCount,
        }),
      );

      request.log.info(
        { projectId: Number(project.id), bidId: Number(bid.id), expertId: Number(expert.id) },
        'market bid submitted',
      );
      return { result: true as const, data: toMyBid(bid) };
    },
  );

  // ── GET /market/projects/:id/my-bid — 내 입찰(없으면 data:null) ─────────────
  fastify.get(
    '/market/projects/:id/my-bid',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
        select: { id: true },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      const bid = await prisma.spMarketBid.findFirst({
        where: { projectId: project.id, mbId: request.user.mbId },
      });
      return { result: true as const, data: bid !== null ? toMyBid(bid) : null };
    },
  );

  // ── PATCH /market/projects/:id/my-bid — 재제출(수정, withdrawn 재활성 포함) ──
  // 블라인드라 타 입찰을 볼 수 없어 수정 허용이 담합 위험을 만들지 않는다(설계 §7).
  fastify.patch(
    '/market/projects/:id/my-bid',
    {
      schema: { params: ProjectIdParams, body: MarketBidSubmitBody },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      const mbId = request.user.mbId;
      const expert = await prisma.spMarketExpert.findUnique({ where: { mbId } });
      if (expert?.status !== 'approved') {
        return reply.status(403).send({ result: false, error: 'EXPERT_NOT_APPROVED' });
      }
      const bid = await prisma.spMarketBid.findFirst({
        where: { projectId: project.id, mbId },
      });
      if (bid === null) return reply.notFound('입찰이 없습니다');
      if (isBiddingClosed(project.status, project.bidDeadlineAt, new Date())) {
        return reply.status(409).send({ result: false, error: 'BIDDING_CLOSED' });
      }
      if (bid.status !== 'submitted' && bid.status !== 'withdrawn') {
        return reply.status(409).send({ result: false, error: 'BID_FINALIZED' });
      }
      const updated = await prisma.spMarketBid.update({
        where: { id: bid.id },
        data: {
          amount: request.body.amount,
          durationDays: request.body.durationDays,
          warranty: request.body.warranty ?? null,
          message: request.body.message,
          status: 'submitted', // withdrawn 재활성 겸용(같은 행 — unique 유지)
        },
      });
      return { result: true as const, data: toMyBid(updated) };
    },
  );

  // ── POST /market/projects/:id/my-bid/withdraw — 철회(채택 확정 전까지) ──────
  fastify.post(
    '/market/projects/:id/my-bid/withdraw',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const bid = await prisma.spMarketBid.findFirst({
        where: { projectId: BigInt(request.params.id), mbId: request.user.mbId },
      });
      if (bid === null) return reply.notFound('입찰이 없습니다');
      if (bid.status === 'withdrawn') {
        // 멱등 — 이미 철회됨.
        return { result: true as const, data: { bidId: Number(bid.id), status: 'withdrawn' as const } };
      }
      // 조건부 갱신 — 채택 트랜잭션(submitted→awarded/rejected)과의 레이스 방어.
      const updated = await prisma.spMarketBid.updateMany({
        where: { id: bid.id, status: 'submitted' },
        data: { status: 'withdrawn' },
      });
      if (updated.count === 0) {
        return reply.status(409).send({ result: false, error: 'BID_FINALIZED' });
      }
      return { result: true as const, data: { bidId: Number(bid.id), status: 'withdrawn' as const } };
    },
  );

  // ── GET /market/projects/:id/bids — 소유자 전용 비교 목록(블라인드 핵심) ────
  fastify.get(
    '/market/projects/:id/bids',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId) {
        // 관리자 열람은 /api/admin/market/projects/:id — 표면 분리 원칙.
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const bids = await prisma.spMarketBid.findMany({
        where: { projectId: project.id },
        orderBy: { id: 'asc' },
      });
      const experts = await prisma.spMarketExpert.findMany({
        where: { id: { in: bids.map((b) => b.expertId) } },
      });
      const expertById = new Map(experts.map((e) => [e.id.toString(), e]));
      return {
        result: true as const,
        data: { items: bids.map((b) => toOwnerBidItem(b, expertById.get(b.expertId.toString()))) },
      };
    },
  );

  // ── POST /market/projects/:id/bids/:bidId/award — 채택(트랜잭션) ────────────
  // project(조건부: bidding|closed && 미채택) + 대상 bid(조건부: submitted) + 나머지
  // submitted→rejected 를 한 트랜잭션으로 — 0건 갱신은 레이스 패배로 409.
  fastify.post(
    '/market/projects/:id/bids/:bidId/award',
    { schema: { params: AwardParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const bid = await prisma.spMarketBid.findUnique({
        where: { id: BigInt(request.params.bidId) },
      });
      if (bid?.projectId !== project.id) {
        return reply.notFound('입찰이 없습니다');
      }
      if (bid.status !== 'submitted') {
        return reply.status(409).send({ result: false, error: 'BID_NOT_AWARDABLE' });
      }

      // 수수료율 스냅샷 — 계약 생성 시점의 마켓 설정(부재 시 기본값). tx 밖 사전 조회.
      const settings = await prisma.spMarketSettings.findUnique({ where: { id: 1 } });
      const feeRateBp = settings?.feeRateBp ?? DEFAULT_FEE_RATE_BP;

      const awardedAt = new Date();
      try {
        await prisma.$transaction(async (tx) => {
          const projectUpd = await tx.spMarketProject.updateMany({
            where: {
              id: project.id,
              status: { in: ['bidding', 'closed'] },
              awardedBidId: null,
            },
            data: { status: 'awarded', awardedBidId: bid.id, awardedAt },
          });
          if (projectUpd.count === 0) throw new AwardConflictError();
          const bidUpd = await tx.spMarketBid.updateMany({
            where: { id: bid.id, status: 'submitted' },
            data: { status: 'awarded' },
          });
          if (bidUpd.count === 0) throw new AwardConflictError();
          // 나머지 검토중 입찰 일괄 종결(withdrawn 은 불변).
          await tx.spMarketBid.updateMany({
            where: { projectId: project.id, status: 'submitted', id: { not: bid.id } },
            data: { status: 'rejected' },
          });
          // 계약 생성 — 채택 금액은 tx 안에서 재조회(라우트 상단 읽기와 tx 사이 PATCH
          // my-bid 금액 변경 레이스 방어, M1). projectId unique → P2002 는 이미 계약 존재.
          const freshBid = await tx.spMarketBid.findUnique({ where: { id: bid.id } });
          if (freshBid === null) throw new AwardConflictError();
          const freshProject = await tx.spMarketProject.findUnique({ where: { id: project.id } });
          if (freshProject === null) throw new AwardConflictError();
          const { feeAmount, payoutAmount } = computeContractFee(freshBid.amount, feeRateBp);
          await tx.spMarketContract.create({
            data: {
              projectId: project.id,
              bidId: bid.id,
              clientMbId: project.mbId,
              expertMbId: freshBid.mbId,
              expertId: freshBid.expertId,
              amount: freshBid.amount,
              feeRateBp,
              feeAmount,
              payoutAmount,
              contractKey: randomUUID(),
              status: 'pending',
              requestSnapshot: buildMarketRequestSnapshot(freshProject, freshBid, awardedAt),
            },
          });
        });
      } catch (err) {
        if (err instanceof AwardConflictError) {
          return reply.status(409).send({ result: false, error: 'NOT_AWARDABLE' });
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // 이 프로젝트에 이미 계약이 있음(동시 채택) — 채택 불가로 매핑.
          return reply.status(409).send({ result: false, error: 'NOT_AWARDABLE' });
        }
        throw err;
      }

      // 채택 통지(비차단) — 채택된 전문가에게 메일.
      const [members, bidExpert] = await Promise.all([
        getMembersByIds([bid.mbId]),
        prisma.spMarketExpert.findUnique({
          where: { id: bid.expertId },
          select: { displayName: true },
        }),
      ]);
      void sendMarketMail(
        request.log,
        members.get(bid.mbId)?.email,
        buildAwardEmail({
          expertName: bidExpert?.displayName ?? '전문가',
          projectId: Number(project.id),
          projectTitle: project.title,
          amount: bid.amount,
        }),
      );

      request.log.info(
        { projectId: Number(project.id), bidId: Number(bid.id) },
        'market bid awarded',
      );
      return {
        result: true as const,
        data: {
          projectId: Number(project.id),
          status: 'awarded' as const,
          awardedBidId: Number(bid.id),
          awardedAt: awardedAt.toISOString(),
        },
      };
    },
  );

  // ── GET /market/my/bids — 내 입찰 목록(전문가) ──────────────────────────────
  fastify.get(
    '/market/my/bids',
    { schema: { querystring: MarketMyBidListQuery }, preHandler: fastify.authenticate },
    async (request) => {
      const { page, pageSize, status } = request.query;
      const where = {
        mbId: request.user.mbId,
        ...(status !== undefined ? { status } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.spMarketBid.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketBid.count({ where }),
      ]);
      const projects = await prisma.spMarketProject.findMany({
        where: { id: { in: rows.map((b) => b.projectId) } },
      });
      const projectById = new Map(projects.map((p) => [p.id.toString(), p]));
      // 계약 상태 배치 조회(N+1 금지) — 계약은 채택 입찰(bidId)에 묶이므로 bidId 로 매핑해
      // "이 입찰이 채택된 경우"에만 상태를 실는다. lazy 승격은 상세 진입 시(목록은 성능 우선).
      const contracts = await prisma.spMarketContract.findMany({
        where: { projectId: { in: rows.map((b) => b.projectId) } },
        select: { bidId: true, status: true },
      });
      const contractStatusByBid = new Map(
        contracts.map((c) => [c.bidId.toString(), asContractStatus(c.status)]),
      );
      const now = new Date();
      const items: MarketMyBidListItemType[] = rows.map((b) => {
        const p = projectById.get(b.projectId.toString());
        return {
          bidId: Number(b.id),
          amount: b.amount,
          durationDays: b.durationDays,
          status: asBidStatus(b.status),
          contractStatus: contractStatusByBid.get(b.id.toString()) ?? null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
          project: {
            projectId: Number(b.projectId),
            title: p?.title ?? '',
            status: asProjectStatus(p?.status ?? 'bidding'),
            biddingClosed:
              p !== undefined ? isBiddingClosed(p.status, p.bidDeadlineAt, now) : true,
            bidDeadlineAt: p?.bidDeadlineAt.toISOString() ?? '',
            method: asProjectMethod(p?.method ?? 'open'),
          },
        };
      });
      return { result: true as const, data: { items, total, page, pageSize } };
    },
  );

  // ── GET /market/my/targeted-projects — 나를 지정한 의뢰 인박스(전문가) ──────
  fastify.get(
    '/market/my/targeted-projects',
    { schema: { querystring: PageQuery }, preHandler: fastify.authenticate },
    async (request) => {
      const { page, pageSize } = request.query;
      const mbId = request.user.mbId;
      const expert = await prisma.spMarketExpert.findUnique({ where: { mbId } });
      if (expert === null) {
        return { result: true as const, data: { items: [], total: 0, page, pageSize } };
      }
      const where = { targetExpertId: expert.id, status: { not: 'cancelled' } };
      const [rows, total] = await Promise.all([
        prisma.spMarketProject.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketProject.count({ where }),
      ]);
      const now = new Date();
      const [owners, counts, myBids] = await Promise.all([
        marketOwnerNames(rows.map((p) => p.mbId)),
        marketBidCounts(rows.map((p) => p.id)),
        prisma.spMarketBid.findMany({
          where: { projectId: { in: rows.map((p) => p.id) }, mbId },
          select: { projectId: true, status: true },
        }),
      ]);
      const myBidByProject = new Map(myBids.map((b) => [b.projectId.toString(), b.status]));
      const items: MarketTargetedProjectListItemType[] = rows.map((p) => {
        const myStatus = myBidByProject.get(p.id.toString());
        return {
          ...toMarketProjectListItem(
            p,
            owners.get(p.mbId) ?? '회원',
            counts.get(p.id.toString()) ?? 0,
            now,
          ),
          myBidStatus: myStatus !== undefined ? asBidStatus(myStatus) : null,
        };
      });
      return { result: true as const, data: { items, total, page, pageSize } };
    },
  );

  done();
};
