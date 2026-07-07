import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpMarketContract } from '@prisma/client';
import { z } from 'zod';
import {
  AdminContractCancelBody,
  AdminContractHoldBody,
  AdminContractSettleBody,
  AdminMarketContractDetailResponse,
  AdminMarketContractListQuery,
  AdminMarketContractListResponse,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminMarketContractCountsType,
  AdminMarketContractDetailType,
  AdminMarketContractListItemType,
} from '@sp/api-contract';
import {
  MARKET_ANCHOR_IT_ID,
  deleteCartRowsByIoId,
  deleteQuoteOption,
  getMembersByIds,
} from '../lib/g5-db';
import {
  asConfirmType,
  asContractStatus,
  autoConfirmDate,
  deriveContractPayment,
  ensureAutoConfirmLazy,
  ensureContractLazy,
  AUTO_CONFIRM_DAYS,
} from '../lib/market-contract';
import { buildContractSettledEmail, sendMarketMail } from '../lib/market-email';
import { REF_MARKET_CONTRACT, asProjectCategory, asProjectMethod, asProjectStatus, toFileMeta } from '../lib/market';
import { prisma } from '../lib/prisma';

// ── /api/admin/market/contracts — 계약 모니터·정산(운영 감독) ─────────────────
// 관리자는 블라인드·마스킹 예외: 당사자 원 식별자·전문가 계좌·od 파생 결제(항상)를 본다.
// 전 라우트 requireAdmin. 목록은 탭 무관 delivered 자동확정 스윕을 먼저 돌려(M4) completed
// 탭만 봐도 확정이 반영되게 한다.

const ContractIdParams = z.object({ id: z.string().regex(/^\d+$/) });

// 목록 행 — 계약 scalar 전부 + 프로젝트/당사자 표시명 + hold + autoConfirmAt 파생.
const toListItem = (
  c: SpMarketContract,
  projectTitle: string,
  clientName: string,
  expertDisplayName: string,
): AdminMarketContractListItemType => ({
  contractId: Number(c.id),
  projectId: Number(c.projectId),
  bidId: Number(c.bidId),
  projectTitle,
  clientMbId: c.clientMbId,
  clientName,
  expertDisplayName,
  status: asContractStatus(c.status),
  amount: c.amount,
  feeRateBp: c.feeRateBp,
  feeAmount: c.feeAmount,
  payoutAmount: c.payoutAmount,
  paidAt: c.paidAt?.toISOString() ?? null,
  deliveredAt: c.deliveredAt?.toISOString() ?? null,
  completedAt: c.completedAt?.toISOString() ?? null,
  confirmedBy: asConfirmType(c.confirmedBy),
  holdAt: c.holdAt?.toISOString() ?? null,
  holdReason: c.holdReason,
  settledAt: c.settledAt?.toISOString() ?? null,
  cancelledAt: c.cancelledAt?.toISOString() ?? null,
  cancelReason: c.cancelReason,
  autoConfirmAt: autoConfirmDate(c)?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});

// 드로어 상세 — 목록 행 + 납품 노트 + od 파생 결제(항상) + 전문가 계좌 + 산출물 + 프로젝트.
const buildDetail = async (c: SpMarketContract): Promise<AdminMarketContractDetailType> => {
  const [project, expert, members, files, payment] = await Promise.all([
    prisma.spMarketProject.findUnique({ where: { id: c.projectId } }),
    prisma.spMarketExpert.findUnique({ where: { id: c.expertId } }),
    getMembersByIds([c.clientMbId]),
    prisma.spFile.findMany({
      where: { refType: REF_MARKET_CONTRACT, refId: c.id, fileType: 'deliverable' },
      orderBy: { id: 'asc' },
      select: { id: true, fileType: true, originFileName: true, size: true },
    }),
    deriveContractPayment(c.ctId),
  ]);
  return {
    ...toListItem(c, project?.title ?? '', members.get(c.clientMbId)?.name ?? '', expert?.displayName ?? ''),
    expertMbId: c.expertMbId,
    deliveryNote: c.deliveryNote,
    payment,
    bankName: expert?.bankName ?? null,
    bankHolder: expert?.bankHolder ?? null,
    bankAccount: expert?.bankAccount ?? null,
    settledBy: c.settledBy,
    settleNote: c.settleNote,
    files: files.map(toFileMeta),
    project: {
      projectId: Number(c.projectId),
      title: project?.title ?? '',
      category: asProjectCategory(project?.category ?? 'circuit'),
      method: asProjectMethod(project?.method ?? 'open'),
      status: asProjectStatus(project?.status ?? 'bidding'),
    },
  };
};

export const adminMarketContractRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/market/contracts — 목록(탭 counts + delivered 자동확정 스윕) ──
  fastify.get(
    '/market/contracts',
    {
      schema: {
        querystring: AdminMarketContractListQuery,
        response: { 200: AdminMarketContractListResponse },
      },
    },
    async (request) => {
      // M4: 탭 무관 자동확정 스윕(completed 탭만 봐도 확정이 반영되게).
      const threshold = new Date(Date.now() - AUTO_CONFIRM_DAYS * 86_400_000);
      const due = await prisma.spMarketContract.findMany({
        where: { status: 'delivered', holdAt: null, deliveredAt: { lte: threshold } },
      });
      for (const dc of due) {
        await ensureAutoConfirmLazy(dc, request.log);
      }

      const { page, pageSize, tab, q } = request.query;
      const keyword = q?.trim();
      // projectTitle 검색은 조인이 없어(관계 미선언) 제목 매칭 프로젝트 id 를 먼저 구한다.
      let titleProjectIds: bigint[] = [];
      if (keyword !== undefined && keyword !== '') {
        const matched = await prisma.spMarketProject.findMany({
          where: { title: { contains: keyword } },
          select: { id: true },
        });
        titleProjectIds = matched.map((p) => p.id);
      }
      const base: Prisma.SpMarketContractWhereInput =
        keyword !== undefined && keyword !== ''
          ? {
              OR: [
                { clientMbId: { contains: keyword } },
                { expertMbId: { contains: keyword } },
                ...(titleProjectIds.length > 0 ? [{ projectId: { in: titleProjectIds } }] : []),
              ],
            }
          : {};
      const where: Prisma.SpMarketContractWhereInput =
        tab === 'all' ? base : { AND: [base, { status: tab }] };

      const [rows, total, grouped] = await Promise.all([
        prisma.spMarketContract.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketContract.count({ where }),
        prisma.spMarketContract.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      ]);
      const counts: AdminMarketContractCountsType = {
        all: 0,
        pending: 0,
        paid: 0,
        delivered: 0,
        completed: 0,
        settled: 0,
        cancelled: 0,
      };
      for (const g of grouped) {
        counts[asContractStatus(g.status)] += g._count._all;
        counts.all += g._count._all;
      }

      const [projects, members, experts] = await Promise.all([
        rows.length > 0
          ? prisma.spMarketProject.findMany({
              where: { id: { in: rows.map((c) => c.projectId) } },
              select: { id: true, title: true },
            })
          : Promise.resolve([]),
        getMembersByIds(rows.map((c) => c.clientMbId)),
        rows.length > 0
          ? prisma.spMarketExpert.findMany({
              where: { id: { in: rows.map((c) => c.expertId) } },
              select: { id: true, displayName: true },
            })
          : Promise.resolve([]),
      ]);
      const titleById = new Map(projects.map((p) => [p.id.toString(), p.title]));
      const expertNameById = new Map(experts.map((e) => [e.id.toString(), e.displayName]));
      const items = rows.map((c) =>
        toListItem(
          c,
          titleById.get(c.projectId.toString()) ?? '',
          members.get(c.clientMbId)?.name ?? '',
          expertNameById.get(c.expertId.toString()) ?? '',
        ),
      );
      return { result: true as const, data: { items, total, page, pageSize, counts } };
    },
  );

  // ── GET /api/admin/market/contracts/:id — 드로어 상세(+lazy 승격) ────────────
  fastify.get(
    '/market/contracts/:id',
    { schema: { params: ContractIdParams, response: { 200: AdminMarketContractDetailResponse } } },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      const c = await ensureContractLazy(contract, request.log);
      return { result: true as const, data: await buildDetail(c) };
    },
  );

  // ── POST /api/admin/market/contracts/:id/settle — 정산 완료 기록 ────────────
  fastify.post(
    '/market/contracts/:id/settle',
    {
      schema: {
        params: ContractIdParams,
        body: AdminContractSettleBody,
        response: { 200: AdminMarketContractDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      const c = await ensureContractLazy(contract, request.log);
      if (c.status !== 'completed') {
        return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '검수 확정된 계약만 정산할 수 있습니다.' });
      }
      const upd = await prisma.spMarketContract.updateMany({
        where: { id: c.id, status: 'completed' },
        data: {
          status: 'settled',
          settledAt: new Date(),
          settledBy: request.user.mbId,
          ...(request.body.note !== undefined ? { settleNote: request.body.note } : {}),
        },
      });
      if (upd.count === 0) {
        return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '정산할 수 없는 상태입니다.' });
      }
      // 메일 #4(정산 완료→전문가) — 전이 게이트 뒤에서만.
      const [project, expert, members] = await Promise.all([
        prisma.spMarketProject.findUnique({ where: { id: c.projectId }, select: { title: true } }),
        prisma.spMarketExpert.findUnique({ where: { id: c.expertId }, select: { displayName: true } }),
        getMembersByIds([c.expertMbId]),
      ]);
      void sendMarketMail(
        request.log,
        members.get(c.expertMbId)?.email,
        buildContractSettledEmail({
          expertName: expert?.displayName ?? '전문가',
          projectId: Number(c.projectId),
          projectTitle: project?.title ?? '',
          payoutAmount: c.payoutAmount,
        }),
      );
      const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
      return { result: true as const, data: await buildDetail(fresh) };
    },
  );

  // ── POST /api/admin/market/contracts/:id/hold — 자동확정 정지(delivered 만) ──
  fastify.post(
    '/market/contracts/:id/hold',
    {
      schema: {
        params: ContractIdParams,
        body: AdminContractHoldBody,
        response: { 200: AdminMarketContractDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      const c = await ensureContractLazy(contract, request.log);
      if (c.status !== 'delivered') {
        return reply.status(409).send({ error: 'NOT_DELIVERED', message: '납품 완료 상태만 정지할 수 있습니다.' });
      }
      if (c.holdAt !== null) {
        return reply.status(409).send({ error: 'ALREADY_HELD', message: '이미 자동확정이 정지되어 있습니다.' });
      }
      const upd = await prisma.spMarketContract.updateMany({
        where: { id: c.id, status: 'delivered', holdAt: null },
        data: { holdAt: new Date(), holdReason: request.body.reason },
      });
      if (upd.count === 0) {
        return reply.status(409).send({ error: 'ALREADY_HELD', message: '정지할 수 없는 상태입니다.' });
      }
      const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
      return { result: true as const, data: await buildDetail(fresh) };
    },
  );

  // ── POST /api/admin/market/contracts/:id/unhold — 자동확정 정지 해제 ─────────
  // ⚠ 해제 시 deliveredAt+7d 가 이미 지났으면 다음 조회에서 즉시 자동확정된다(의도).
  fastify.post(
    '/market/contracts/:id/unhold',
    { schema: { params: ContractIdParams, response: { 200: AdminMarketContractDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      if (contract.holdAt === null) {
        return reply.status(409).send({ error: 'NOT_HELD', message: '정지 상태가 아닙니다.' });
      }
      const upd = await prisma.spMarketContract.updateMany({
        where: { id: contract.id, NOT: { holdAt: null } },
        data: { holdAt: null, holdReason: null },
      });
      if (upd.count === 0) {
        return reply.status(409).send({ error: 'NOT_HELD', message: '정지 상태가 아닙니다.' });
      }
      // 해제만 하고 즉시 자동확정은 다음 조회로 미룬다(재조회로 상태만 반영).
      const fresh = (await prisma.spMarketContract.findUnique({ where: { id: contract.id } })) ?? contract;
      return { result: true as const, data: await buildDetail(fresh) };
    },
  );

  // ── POST /api/admin/market/contracts/:id/cancel — 운영 취소 ─────────────────
  // pending/paid/delivered 에서 취소(completed/settled 는 409). pending 이었으면 카트 정리,
  // paid 이후엔 주문 라인이라 환불은 기존 주문 관리/PG 도메인(여기선 기록만).
  fastify.post(
    '/market/contracts/:id/cancel',
    {
      schema: {
        params: ContractIdParams,
        body: AdminContractCancelBody,
        response: { 200: AdminMarketContractDetailResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const contract = await prisma.spMarketContract.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (contract === null) return reply.notFound('계약이 없습니다');
      const c = await ensureContractLazy(contract, request.log);
      if (c.status === 'completed' || c.status === 'settled' || c.status === 'cancelled') {
        return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '취소할 수 없는 상태입니다.' });
      }
      const wasPending = c.status === 'pending';
      const now = new Date();
      const cancelled = await prisma.$transaction(async (tx): Promise<boolean> => {
        const upd = await tx.spMarketContract.updateMany({
          where: { id: c.id, status: { in: ['pending', 'paid', 'delivered'] } },
          data: { status: 'cancelled', cancelReason: request.body.reason, cancelledAt: now },
        });
        if (upd.count === 0) return false;
        await tx.spMarketProject.updateMany({
          where: { id: c.projectId, status: { in: ['awarded', 'working'] } },
          data: { status: 'cancelled' },
        });
        return true;
      });
      if (!cancelled) {
        return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '취소할 수 없는 상태입니다.' });
      }
      if (wasPending) {
        // 미결제(담김) 계약만 카트 정리 — 주문 라인은 손대지 않는다.
        await deleteCartRowsByIoId(c.contractKey);
        await deleteQuoteOption(MARKET_ANCHOR_IT_ID, c.contractKey);
      }
      const fresh = (await prisma.spMarketContract.findUnique({ where: { id: c.id } })) ?? c;
      return { result: true as const, data: await buildDetail(fresh) };
    },
  );

  done();
};
