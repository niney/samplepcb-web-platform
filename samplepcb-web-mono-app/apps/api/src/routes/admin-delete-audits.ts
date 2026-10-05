import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpDeleteAudit } from '@prisma/client';
import {
  AdminBomQuoteRetentionRunResponse,
  AdminBomQuoteRetentionStatusResponse,
  AdminDeleteAuditListQuery,
  AdminDeleteAuditListResponse,
  ApiError,
  DELETE_AUDIT_SYSTEM_ACTOR,
} from '@sp/api-contract';
import type { AdminDeleteAuditItemType } from '@sp/api-contract';
import { getCanceledQuoteCleanupStatus, runCanceledQuoteCleanup } from '../lib/bom-quote-retention';
import { prisma } from '../lib/prisma';

// ── /api/admin — 삭제 기록 + 취소 견적 자동 정리 상태 ("삭제 기록" 화면) ─────────────────────
// sp_delete_audit 는 관리자 강제 삭제(BOM·PCB Case)가 쓰기만 하던 원장이다. 보존 기간 자동 정리가
// 같은 원장에 쌓이면서 "무엇이 지워졌는가"를 읽는 화면이 필요해졌다. 전 라우트 requireAdmin.

const toSnapshot = (value: Prisma.JsonValue): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

const toAuditDto = (row: SpDeleteAudit): AdminDeleteAuditItemType => ({
  auditId: Number(row.id),
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  title: row.title,
  mbId: row.mbId,
  subjectStatus: row.subjectStatus,
  actorMbId: row.actorMbId,
  automatic: row.actorMbId === DELETE_AUDIT_SYSTEM_ACTOR,
  reason: row.reason,
  snapshot: toSnapshot(row.snapshot),
  createdAt: row.createdAt.toISOString(),
});

export const adminDeleteAuditRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 삭제 기록 목록 — 자동 정리와 관리자 강제 삭제를 한 원장에서 본다.
  fastify.get(
    '/delete-audits',
    {
      schema: { querystring: AdminDeleteAuditListQuery, response: { 200: AdminDeleteAuditListResponse } },
    },
    async (request) => {
      const q = request.query;
      const where: Prisma.SpDeleteAuditWhereInput = {
        ...(q.subjectType !== undefined ? { subjectType: q.subjectType } : {}),
        ...(q.actor === 'auto' ? { actorMbId: DELETE_AUDIT_SYSTEM_ACTOR } : {}),
        ...(q.actor === 'manual' ? { actorMbId: { not: DELETE_AUDIT_SYSTEM_ACTOR } } : {}),
        ...(q.search !== undefined
          ? {
              OR: [
                { title: { contains: q.search } },
                { mbId: { contains: q.search } },
                { subjectId: q.search },
              ],
            }
          : {}),
        ...(q.dateFrom !== undefined || q.dateTo !== undefined
          ? {
              createdAt: {
                ...(q.dateFrom !== undefined
                  ? { gte: new Date(`${q.dateFrom}T00:00:00+09:00`) }
                  : {}),
                // dateTo 는 포함 범위 — KST 다음날 0시 미만으로 변환(발송 이력과 같은 축).
                ...(q.dateTo !== undefined
                  ? { lt: new Date(new Date(`${q.dateTo}T00:00:00+09:00`).getTime() + 86_400_000) }
                  : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.spDeleteAudit.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        prisma.spDeleteAudit.count({ where }),
      ]);
      return {
        result: true as const,
        data: { items: rows.map(toAuditDto), total, page: q.page, pageSize: q.pageSize },
      };
    },
  );

  // 자동 정리 상태 — 마지막 실행 요약 + 데이터에서 센 "기한 경과 미삭제"·"삭제 대기".
  fastify.get(
    '/bom-quote-retention',
    { schema: { response: { 200: AdminBomQuoteRetentionStatusResponse } } },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return { result: true as const, data: await getCanceledQuoteCleanupStatus() };
    },
  );

  // 지금 실행 — 타이머와 같은 규칙으로 한 번 돈다(기한이 지난 취소 견적만). 배포 직후 확인과
  // 밀린 건을 빨리 비울 때 쓴다. 이미 도는 중이거나 꺼져 있으면 409.
  fastify.post(
    '/bom-quote-retention/run',
    { schema: { response: { 200: AdminBomQuoteRetentionRunResponse, 409: ApiError } } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const result = await runCanceledQuoteCleanup(request.log, {
        trigger: 'manual',
        actorMbId: request.user.mbId,
      });
      if (!result.ok) {
        return reply.status(409).send(
          result.reason === 'running'
            ? {
                error: 'RETENTION_RUNNING',
                message: '자동 정리가 이미 실행 중입니다. 잠시 후 다시 확인해 주세요.',
              }
            : {
                error: 'RETENTION_DISABLED',
                message: '보존 기간이 0 으로 설정되어 자동 정리가 꺼져 있습니다.',
              },
        );
      }
      return {
        result: true as const,
        data: { run: result.run, status: await getCanceledQuoteCleanupStatus() },
      };
    },
  );

  done();
};
