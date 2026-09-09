import { developPrototypeWhere } from '../lib/develop-prototype';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import {
  AdminDevelopRequestCounts,
  AdminDevelopWorkspaceQuery,
  AdminDevelopWorkspaceResponse,
  DEVELOP_ADMIN_TABS,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  toWorkspaceItem,
  workspaceScope,
  workspaceSelect,
  workspaceStatuses,
} from '../lib/develop-workspace';

export const adminDevelopWorkspaceRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);
  fastify.get(
    '/develop/workspace',
    {
      schema: {
        querystring: AdminDevelopWorkspaceQuery,
        response: { 200: AdminDevelopWorkspaceResponse },
      },
    },
    async (request) => {
      const { section, tab, q, page, pageSize } = request.query;
      const search: Prisma.SpDevelopRequestWhereInput =
        q === ''
          ? {}
          : {
              OR: [
                { title: { contains: q } },
                { contactName: { contains: q } },
                { contactCompany: { contains: q } },
                { mbId: { contains: q } },
                { assigneeMbId: { contains: q } },
              ],
            };
      const scope: Prisma.SpDevelopRequestWhereInput = { AND: [workspaceScope(section), search, developPrototypeWhere('g')] };
      // 검색/업무 범위/상태를 DB에서 먼저 적용하고 페이지를 나눈다. 빈 페이지를 만드는 클라이언트 필터는 쓰지 않는다.
      const where: Prisma.SpDevelopRequestWhereInput = {
        AND: [scope, { status: { in: [...workspaceStatuses(tab)] } }],
      };
      const [rows, grouped] = await prisma.$transaction([
        prisma.spDevelopRequest.findMany({
          where,
          select: workspaceSelect,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spDevelopRequest.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      ]);
      const counts = AdminDevelopRequestCounts.parse(
        Object.fromEntries(
          DEVELOP_ADMIN_TABS.map((key) => [
            key,
            grouped
              .filter((group) => workspaceStatuses(key).includes(group.status))
              .reduce((sum, group) => sum + group._count._all, 0),
          ]),
        ),
      );
      return {
        result: true as const,
        data: {
          items: rows.map((row) => toWorkspaceItem(row)),
          total: counts[tab],
          page,
          pageSize,
          counts,
        },
      };
    },
  );
  done();
};
