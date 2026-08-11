import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomClaimListQuery,
  AdminBomClaimListResponse,
  AdminBomClaimDetailResponse,
  AdminBomClaimTransitionRequest,
  AdminBomClaimTransitionResponse,
  ApiError,
  BomClaimStatus,
  type AdminBomClaimCountsType,
} from '@sp/api-contract';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveBomClaimTransition, type BomClaimAdminAction } from '../lib/bom-claim';
import { bomClaimInclude, toBomClaimDto } from '../lib/bom-claim-dto';

const ClaimIdParams = z.object({ id: z.coerce.bigint() });

class ClaimTransitionError extends Error {
  constructor(readonly code: 'CLAIM_NOT_FOUND' | 'STALE_CLAIM' | 'INVALID_TRANSITION') {
    super(code);
  }
}

const CLAIM_TRANSITION_ERROR_LABELS: Record<ClaimTransitionError['code'], string> = {
  CLAIM_NOT_FOUND: '클레임을 찾을 수 없습니다.',
  STALE_CLAIM: '다른 관리자가 먼저 처리했습니다. 최신 상태를 다시 확인해 주세요.',
  INVALID_TRANSITION: '현재 상태에서는 요청한 처리를 진행할 수 없습니다.',
};

export const adminBomClaimRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get(
    '/bom-claims',
    {
      schema: {
        querystring: AdminBomClaimListQuery,
        response: { 200: AdminBomClaimListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, status, search } = request.query;
      const where: Prisma.SpBomClaimWhereInput = {
        ...(status === 'all'
          ? {}
          : status === 'pending'
            ? { status: { in: ['open', 'reviewing'] } }
            : { status }),
        ...(search === undefined || search === ''
          ? {}
          : {
              OR: [
                { quoteTitle: { contains: search } },
                { mbId: { contains: search } },
                { odId: { contains: search } },
                { subject: { contains: search } },
              ],
            }),
      };
      const [claims, total, grouped] = await Promise.all([
        prisma.spBomClaim.findMany({
          where,
          include: bomClaimInclude,
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spBomClaim.count({ where }),
        prisma.spBomClaim.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      const statusCounts = new Map(grouped.map((row) => [row.status, row._count._all]));
      const counts: AdminBomClaimCountsType = {
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
          items: claims.map(toBomClaimDto),
          total,
          page,
          pageSize,
          counts,
        },
      };
    },
  );

  fastify.patch(
    '/bom-claims/:id',
    {
      schema: {
        params: ClaimIdParams,
        body: AdminBomClaimTransitionRequest,
        response: { 200: AdminBomClaimTransitionResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const claim = await prisma.$transaction(async (tx) => {
          const current = await tx.spBomClaim.findUnique({ where: { id: request.params.id } });
          if (current === null) throw new ClaimTransitionError('CLAIM_NOT_FOUND');
          if (current.version !== request.body.expectedVersion) {
            throw new ClaimTransitionError('STALE_CLAIM');
          }
          const parsedStatus = BomClaimStatus.safeParse(current.status);
          if (!parsedStatus.success) throw new ClaimTransitionError('INVALID_TRANSITION');
          const action: BomClaimAdminAction = request.body.action === 'start_review'
            ? 'review_started'
            : request.body.action === 'resolve'
              ? 'resolved'
              : 'rejected';
          const target = resolveBomClaimTransition(parsedStatus.data, action);
          if (target === null) throw new ClaimTransitionError('INVALID_TRANSITION');
          const now = new Date();
          const response = request.body.action === 'start_review' ? null : request.body.response;
          const update = await tx.spBomClaim.updateMany({
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
                : {
                    activeKey: null,
                    adminResponse: response,
                    resolutionKind: request.body.action === 'resolve'
                      ? request.body.resolutionKind
                      : null,
                    closedAt: now,
                  }),
            },
          });
          if (update.count !== 1) throw new ClaimTransitionError('STALE_CLAIM');
          await tx.spBomClaimEvent.create({
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
          const fresh = await tx.spBomClaim.findUnique({
            where: { id: current.id },
            include: bomClaimInclude,
          });
          if (fresh === null) throw new ClaimTransitionError('CLAIM_NOT_FOUND');
          return fresh;
        });
        return { result: true as const, data: toBomClaimDto(claim) };
      } catch (error) {
        if (error instanceof ClaimTransitionError) {
          const statusCode = error.code === 'CLAIM_NOT_FOUND' ? 404 : 409;
          return reply.status(statusCode).send({
            error: error.code,
            message: CLAIM_TRANSITION_ERROR_LABELS[error.code],
          });
        }
        throw error;
      }
    },
  );

  fastify.get(
    '/bom-claims/:id',
    {
      schema: {
        params: ClaimIdParams,
        response: { 200: AdminBomClaimDetailResponse },
      },
    },
    async (request, reply) => {
      const claim = await prisma.spBomClaim.findUnique({
        where: { id: request.params.id },
        include: bomClaimInclude,
      });
      if (claim === null) return reply.notFound('클레임을 찾을 수 없습니다');
      return { result: true as const, data: toBomClaimDto(claim) };
    },
  );

  done();
};
