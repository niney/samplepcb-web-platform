import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpMarketProject } from '@prisma/client';
import { z } from 'zod';
import {
  AdminMarketProjectDetailResponse,
  AdminMarketProjectListQuery,
  AdminMarketProjectListResponse,
  ApiError,
  MarketProjectStatusResponse,
} from '@sp/api-contract';
import type {
  AdminMarketProjectCountsType,
  AdminMarketProjectListItemType,
} from '@sp/api-contract';
import { downloadFromFileServer } from '../lib/file-server';
import { getMembersByIds } from '../lib/g5-db';
import type { G5Member } from '../lib/g5-db';
import {
  REF_MARKET_EXPERT,
  REF_MARKET_PROJECT,
  asBidStatus,
  asBudgetRange,
  asCareerRange,
  asExpertType,
  asProjectCategory,
  asProjectMethod,
  asProjectStatus,
  asRegionOrNull,
  isBiddingClosed,
  marketBidCounts,
  toFileMeta,
  toProjectCadCodes,
} from '../lib/market';
import { prisma } from '../lib/prisma';

// ── /api/admin/market/projects — 프로젝트 모니터(운영 감독) ──────────────────
// 관리자는 블라인드·마스킹·NDA 예외: 입찰 전체·NDA 서명자·의뢰인 원명을 본다.
// 탭은 저장 status 그대로(파생 마감은 행의 biddingClosed 플래그로 표기) — 운영 화면은
// 저장 상태의 진실이 우선. 전 라우트 requireAdmin.

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const FileIdParams = z.object({ fileId: z.string().regex(/^\d+$/) });

const toOwner = (
  mbId: string,
  m: G5Member | undefined,
): AdminMarketProjectListItemType['owner'] => ({
  mbId,
  name: m?.name ?? '',
  email: m === undefined || m.email === '' ? null : m.email,
});

const toAdminProjectItem = (
  p: SpMarketProject,
  owner: AdminMarketProjectListItemType['owner'],
  bidCount: number,
  now: Date,
): AdminMarketProjectListItemType => ({
  projectId: Number(p.id),
  title: p.title,
  category: asProjectCategory(p.category),
  method: asProjectMethod(p.method),
  status: asProjectStatus(p.status),
  ndaRequired: p.ndaRequired,
  bidCount,
  viewCount: p.viewCount,
  bidDeadlineAt: p.bidDeadlineAt.toISOString(),
  biddingClosed: isBiddingClosed(p.status, p.bidDeadlineAt, now),
  createdAt: p.createdAt.toISOString(),
  awardedAt: p.awardedAt?.toISOString() ?? null,
  owner,
});

export const adminMarketProjectRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/market/projects — 목록(탭 counts) ────────────────────────
  fastify.get(
    '/market/projects',
    {
      schema: {
        querystring: AdminMarketProjectListQuery,
        response: { 200: AdminMarketProjectListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab, method, q } = request.query;
      const keyword = q?.trim();
      const base: Prisma.SpMarketProjectWhereInput = {
        ...(method !== undefined ? { method } : {}),
        ...(keyword !== undefined && keyword !== ''
          ? { OR: [{ title: { contains: keyword } }, { mbId: { contains: keyword } }] }
          : {}),
      };
      const where: Prisma.SpMarketProjectWhereInput =
        tab === 'all' ? base : { AND: [base, { status: tab }] };

      const [rows, total, grouped] = await Promise.all([
        prisma.spMarketProject.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketProject.count({ where }),
        prisma.spMarketProject.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      ]);
      const counts: AdminMarketProjectCountsType = {
        all: 0,
        bidding: 0,
        awarded: 0,
        closed: 0,
        cancelled: 0,
      };
      for (const g of grouped) {
        const s = asProjectStatus(g.status);
        // 2차 예약값(working/completed)은 awarded 계열로 합산해 표를 안 깨뜨린다.
        const key = s === 'working' || s === 'completed' ? 'awarded' : s;
        counts[key] += g._count._all;
        counts.all += g._count._all;
      }

      const now = new Date();
      const [members, bidCounts] = await Promise.all([
        getMembersByIds(rows.map((p) => p.mbId)),
        marketBidCounts(rows.map((p) => p.id)),
      ]);
      const items = rows.map((p) =>
        toAdminProjectItem(
          p,
          toOwner(p.mbId, members.get(p.mbId)),
          bidCounts.get(p.id.toString()) ?? 0,
          now,
        ),
      );
      return { result: true as const, data: { items, total, page, pageSize, counts } };
    },
  );

  // ── GET /api/admin/market/projects/:id — 상세(입찰 전체+NDA 서명자+첨부) ────
  fastify.get(
    '/market/projects/:id',
    {
      schema: { params: ProjectIdParams, response: { 200: AdminMarketProjectDetailResponse } },
    },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');

      const [members, bidCounts, files, bids, ndaSigns, targetExpert] = await Promise.all([
        getMembersByIds([project.mbId]),
        marketBidCounts([project.id]),
        prisma.spFile.findMany({
          where: { refType: REF_MARKET_PROJECT, refId: project.id },
          orderBy: { id: 'asc' },
          select: { id: true, fileType: true, originFileName: true, size: true },
        }),
        prisma.spMarketBid.findMany({ where: { projectId: project.id }, orderBy: { id: 'asc' } }),
        prisma.spMarketNdaSign.findMany({
          where: { projectId: project.id },
          orderBy: { id: 'asc' },
        }),
        project.targetExpertId !== null
          ? prisma.spMarketExpert.findUnique({ where: { id: project.targetExpertId } })
          : Promise.resolve(null),
      ]);
      const experts = await prisma.spMarketExpert.findMany({
        where: { id: { in: bids.map((b) => b.expertId) } },
      });
      const expertById = new Map(experts.map((e) => [e.id.toString(), e]));

      const now = new Date();
      return {
        result: true as const,
        data: {
          ...toAdminProjectItem(
            project,
            toOwner(project.mbId, members.get(project.mbId)),
            bidCounts.get(project.id.toString()) ?? 0,
            now,
          ),
          cadTools: toProjectCadCodes(project.cadTools),
          budgetRange: asBudgetRange(project.budgetRange),
          description: project.description,
          startHopeDate: project.startHopeDate,
          dueHopeDate: project.dueHopeDate,
          targetExpert:
            targetExpert !== null
              ? {
                  expertId: Number(targetExpert.id),
                  displayName: targetExpert.displayName,
                  mbId: targetExpert.mbId,
                }
              : null,
          awardedBidId: project.awardedBidId !== null ? Number(project.awardedBidId) : null,
          attachments: files.map(toFileMeta),
          bids: bids.map((b) => {
            const e = expertById.get(b.expertId.toString());
            return {
              bidId: Number(b.id),
              mbId: b.mbId,
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
            };
          }),
          ndaSigns: ndaSigns.map((s) => ({
            mbId: s.mbId,
            signedName: s.signedName,
            textVersion: s.textVersion,
            signedAt: s.createdAt.toISOString(),
          })),
        },
      };
    },
  );

  // ── POST /api/admin/market/projects/:id/cancel — 운영 취소(신고·분쟁 대응) ──
  fastify.post(
    '/market/projects/:id/cancel',
    {
      schema: {
        params: ProjectIdParams,
        response: { 200: MarketProjectStatusResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const project = await prisma.spMarketProject.findUnique({ where: { id } });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      const updated = await prisma.spMarketProject.updateMany({
        where: { id, status: { in: ['bidding', 'closed', 'awarded'] } },
        data: { status: 'cancelled' },
      });
      if (updated.count === 0) {
        return reply
          .status(409)
          .send({ error: 'NOT_CANCELLABLE', message: '취소할 수 없는 상태입니다.' });
      }
      return {
        result: true as const,
        data: { projectId: Number(id), status: 'cancelled' as const },
      };
    },
  );

  // ── GET /api/admin/market/files/:fileId — 첨부·증빙 원본 다운로드 프록시 ────
  // refType 화이트리스트(마켓 소유 파일만) — 타 도메인(sp_order_spec 거버)은
  // admin-pcb-files 표면을 쓴다. pathToken 은 파일서버로만 전달(비노출 불변식).
  fastify.get(
    '/market/files/:fileId',
    { schema: { params: FileIdParams } },
    async (request, reply) => {
      const file = await prisma.spFile.findFirst({
        where: {
          id: BigInt(request.params.fileId),
          refType: { in: [REF_MARKET_PROJECT, REF_MARKET_EXPERT] },
        },
        select: { pathToken: true, originFileName: true },
      });
      if (file === null) return reply.notFound('파일이 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일이 없습니다');
      return reply
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .type(downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  done();
};
