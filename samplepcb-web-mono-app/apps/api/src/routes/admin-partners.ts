import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AdminPartnerCreateBody,
  AdminPartnerDeleteResponse,
  AdminPartnerDetailResponse,
  AdminPartnerListQuery,
  AdminPartnerListResponse,
  AdminPartnerMemberAddBody,
  AdminPartnerMutationResponse,
  AdminPartnerStatusBody,
  AdminPartnerUpdateBody,
  ApiError,
} from '@sp/api-contract';
import type { AdminPartnerCountsType, AdminPartnerDetailType } from '@sp/api-contract';
import { getMembersByIds } from '../lib/g5-db';
import {
  asPartnerStatus,
  asPartnerType,
  toAdminPartnerDetail,
  toAdminPartnerItem,
  validateSupplierCode,
} from '../lib/partner';
import { prisma } from '../lib/prisma';

// ── /api/admin/partners — 스마트 BOM 파트너(조직) 관리 ──────────────────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §1·§3.5. 조직/계정/자동화 3축 분리 —
// 등록 원천이 관리자라 생성 기본 approved, 상태 변경은 감사 필드(decidedBy/At) 기록.
// 계정 연결은 정상 가입한 g5_member 만(가짜 회원 없음), 1계정=1조직 운영 가드.
// 전 라우트 requireAdmin(addHook 일괄 — 라우트별 누락 사고 차단).

const PartnerIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const PartnerMemberParams = z.object({
  id: z.string().regex(/^\d+$/),
  mbId: z.string().min(1),
});

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const detailOf = async (id: bigint): Promise<AdminPartnerDetailType | null> => {
  const partner = await prisma.spPartner.findUnique({
    where: { id },
    include: { members: { orderBy: { id: 'asc' } } },
  });
  return partner === null ? null : toAdminPartnerDetail(partner);
};

export const adminPartnerRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/partners — 목록(상태 탭 × 유형 필터 × 검색, counts) ──────
  fastify.get(
    '/partners',
    {
      schema: { querystring: AdminPartnerListQuery, response: { 200: AdminPartnerListResponse } },
    },
    async (request) => {
      const { page, pageSize, tab, type, q } = request.query;
      const keyword = q?.trim();
      const conds: Prisma.SpPartnerWhereInput[] = [];
      if (keyword !== undefined && keyword !== '') {
        conds.push({
          OR: [
            { name: { contains: keyword } },
            { supplierCode: { contains: keyword } },
            { contactEmail: { contains: keyword } },
            { members: { some: { mbId: { contains: keyword } } } },
          ],
        });
      }
      if (type !== 'all') conds.push({ type });
      const base: Prisma.SpPartnerWhereInput = conds.length > 0 ? { AND: conds } : {};
      const where: Prisma.SpPartnerWhereInput =
        tab === 'all' ? base : { AND: [base, { status: tab }] };

      const [rows, total, grouped] = await Promise.all([
        prisma.spPartner.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { members: true } } },
        }),
        prisma.spPartner.count({ where }),
        // counts — 검색어·유형 필터 반영, 탭 미반영(회원 관리 관례)
        prisma.spPartner.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      ]);
      const counts: AdminPartnerCountsType = { all: 0, pending: 0, approved: 0, suspended: 0 };
      for (const g of grouped) {
        counts[asPartnerStatus(g.status)] += g._count._all;
        counts.all += g._count._all;
      }
      return {
        result: true as const,
        data: {
          items: rows.map((r) => toAdminPartnerItem(r, r._count.members)),
          total,
          page,
          pageSize,
          counts,
        },
      };
    },
  );

  // ── GET /api/admin/partners/:id — 상세(연결 계정 포함) ──────────────────────
  fastify.get(
    '/partners/:id',
    { schema: { params: PartnerIdParams, response: { 200: AdminPartnerDetailResponse } } },
    async (request, reply) => {
      const detail = await detailOf(BigInt(request.params.id));
      if (detail === null) return reply.notFound('파트너가 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── POST /api/admin/partners — 생성(기본 approved, 감사 기록) ───────────────
  fastify.post(
    '/partners',
    {
      schema: {
        body: AdminPartnerCreateBody,
        response: { 200: AdminPartnerMutationResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const supplierCode = b.supplierCode ?? null;
      const invalid = validateSupplierCode(b.type, supplierCode);
      if (invalid !== null) {
        return reply.status(400).send({ error: 'INVALID_SUPPLIER_CODE', message: invalid });
      }
      try {
        const created = await prisma.spPartner.create({
          data: {
            type: b.type,
            name: b.name,
            supplierCode,
            country: b.country ?? null,
            defaultCurrency: b.defaultCurrency,
            capabilities: b.capabilities,
            status: b.status,
            contactName: b.contactName ?? null,
            contactPhone: b.contactPhone ?? null,
            contactEmail: b.contactEmail ?? null,
            memo: b.memo ?? null,
            ...(b.status === 'pending'
              ? {}
              : { decidedBy: request.user.mbId, decidedAt: new Date() }),
          },
        });
        return { result: true as const, data: toAdminPartnerDetail({ ...created, members: [] }) };
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply
            .status(409)
            .send({ error: 'SUPPLIER_CODE_TAKEN', message: '이미 사용 중인 supplierCode 입니다.' });
        }
        throw e;
      }
    },
  );

  // ── PUT /api/admin/partners/:id — 부분 수정(status 제외 — 전용 라우트) ──────
  fastify.put(
    '/partners/:id',
    {
      schema: {
        params: PartnerIdParams,
        body: AdminPartnerUpdateBody,
        response: { 200: AdminPartnerMutationResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const existing = await prisma.spPartner.findUnique({ where: { id } });
      if (existing === null) return reply.notFound('파트너가 없습니다');
      const b = request.body;

      // 수정 후의 유효 상태로 type↔supplierCode 정합을 검증한다(부분 갱신이라 병합 필요).
      const effType = b.type ?? asPartnerType(existing.type);
      const effCode =
        b.supplierCode === undefined ? existing.supplierCode : (b.supplierCode ?? null);
      const invalid = validateSupplierCode(effType, effCode);
      if (invalid !== null) {
        return reply.status(400).send({ error: 'INVALID_SUPPLIER_CODE', message: invalid });
      }

      const data: Prisma.SpPartnerUpdateInput = {};
      if (b.type !== undefined) data.type = b.type;
      if (b.name !== undefined) data.name = b.name;
      if (b.supplierCode !== undefined) data.supplierCode = b.supplierCode ?? null;
      if (b.country !== undefined) data.country = b.country ?? null;
      if (b.defaultCurrency !== undefined) data.defaultCurrency = b.defaultCurrency;
      if (b.capabilities !== undefined) data.capabilities = b.capabilities;
      if (b.contactName !== undefined) data.contactName = b.contactName ?? null;
      if (b.contactPhone !== undefined) data.contactPhone = b.contactPhone ?? null;
      if (b.contactEmail !== undefined) data.contactEmail = b.contactEmail ?? null;
      if (b.memo !== undefined) data.memo = b.memo ?? null;

      try {
        await prisma.spPartner.update({ where: { id }, data });
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply
            .status(409)
            .send({ error: 'SUPPLIER_CODE_TAKEN', message: '이미 사용 중인 supplierCode 입니다.' });
        }
        throw e;
      }
      const detail = await detailOf(id);
      if (detail === null) return reply.notFound('파트너가 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── POST /api/admin/partners/:id/status — 상태 변경(감사 기록) ──────────────
  // 마스터데이터라 엄격한 상태머신 대신 "동일 상태 재설정만 금지"(동시 클릭 1회 수렴).
  fastify.post(
    '/partners/:id/status',
    {
      schema: {
        params: PartnerIdParams,
        body: AdminPartnerStatusBody,
        response: { 200: AdminPartnerMutationResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const { status, reason } = request.body;
      const updated = await prisma.spPartner.updateMany({
        where: { id, NOT: { status } },
        data: {
          status,
          statusReason: reason ?? null,
          decidedBy: request.user.mbId,
          decidedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        const exists = await prisma.spPartner.count({ where: { id } });
        if (exists === 0) return reply.notFound('파트너가 없습니다');
        return reply
          .status(409)
          .send({ error: 'ALREADY_IN_STATUS', message: '이미 해당 상태입니다.' });
      }
      const detail = await detailOf(id);
      if (detail === null) return reply.notFound('파트너가 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── POST /api/admin/partners/:id/members — 계정 연결 ────────────────────────
  fastify.post(
    '/partners/:id/members',
    {
      schema: {
        params: PartnerIdParams,
        body: AdminPartnerMemberAddBody,
        response: { 200: AdminPartnerMutationResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const partner = await prisma.spPartner.findUnique({ where: { id } });
      if (partner === null) return reply.notFound('파트너가 없습니다');
      const { mbId, role } = request.body;

      // 정상 가입한 회원만 연결(가짜 회원 금지 — 설계 §1).
      const g5Members = await getMembersByIds([mbId]);
      if (!g5Members.has(mbId)) {
        return reply
          .status(404)
          .send({ error: 'MEMBER_NOT_FOUND', message: '가입된 회원이 아닙니다.' });
      }
      // 1계정=1조직 운영 가드 — requirePartner 판정의 단순성 유지(설계 §1.2).
      const linkedElsewhere = await prisma.spPartnerMember.findFirst({
        where: { mbId, NOT: { partnerId: id } },
      });
      if (linkedElsewhere !== null) {
        return reply
          .status(409)
          .send({ error: 'MEMBER_ALREADY_LINKED', message: '이미 다른 파트너에 연결된 계정입니다.' });
      }
      try {
        await prisma.spPartnerMember.create({ data: { partnerId: id, mbId, role } });
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply
            .status(409)
            .send({ error: 'ALREADY_MEMBER', message: '이미 이 파트너에 연결된 계정입니다.' });
        }
        throw e;
      }
      const detail = await detailOf(id);
      if (detail === null) return reply.notFound('파트너가 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── DELETE /api/admin/partners/:id/members/:mbId — 연결 해제 ────────────────
  fastify.delete(
    '/partners/:id/members/:mbId',
    {
      schema: {
        params: PartnerMemberParams,
        response: { 200: AdminPartnerMutationResponse },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const removed = await prisma.spPartnerMember.deleteMany({
        where: { partnerId: id, mbId: request.params.mbId },
      });
      if (removed.count === 0) return reply.notFound('연결된 계정이 없습니다');
      const detail = await detailOf(id);
      if (detail === null) return reply.notFound('파트너가 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // ── DELETE /api/admin/partners/:id — 삭제(오기 정리용) ──────────────────────
  // RFQ 이력이 있으면 거부(FK RESTRICT 와 동일 정책의 선제 안내) — 운영 배제는 suspended.
  fastify.delete(
    '/partners/:id',
    {
      schema: {
        params: PartnerIdParams,
        response: { 200: AdminPartnerDeleteResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const partner = await prisma.spPartner.findUnique({ where: { id } });
      if (partner === null) return reply.notFound('파트너가 없습니다');
      const rfqCount = await prisma.spBomRfq.count({ where: { partnerId: id } });
      if (rfqCount > 0) {
        return reply.status(409).send({
          error: 'PARTNER_HAS_RFQS',
          message: 'RFQ 이력이 있는 파트너는 삭제할 수 없습니다. 정지(suspended)로 배제하세요.',
        });
      }
      await prisma.spPartner.delete({ where: { id } });
      return { result: true as const };
    },
  );

  done();
};
