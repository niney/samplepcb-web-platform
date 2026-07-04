import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminMemberDetailResponse,
  AdminMemberInterceptBody,
  AdminMemberInterceptResponse,
  AdminMemberLevelBody,
  AdminMemberLevelResponse,
  AdminMemberListQuery,
  AdminMemberListResponse,
  AdminMemberProfileBody,
  AdminMemberProfileResponse,
  ApiError,
} from '@sp/api-contract';
import type { AdminMemberListItemType, AdminMemberStatusType } from '@sp/api-contract';
import {
  getCfAdminId,
  getMemberDetailRow,
  searchMembers,
  setMemberIntercept,
  setMemberLevel,
} from '../lib/g5-db';
import type { MemberListRow } from '../lib/g5-db';
import { kstTodayYmd } from '../lib/kst';
import { prisma } from '../lib/prisma';

// ── /api/admin/members — 관리자 회원 관리 (sp-vue /app/admin/members) ─────────
// 레거시 /adm/member_list.php 를 sp-vue 로 마이그레이션. 전 라우트가 requireAdmin(JWT
// isAdmin) 뒤에 있고, 응답은 계약 response 스키마로 직렬화되어 미선언 필드(민감 컬럼)가
// 구조적으로 탈락한다. g5_member 접근은 lib/g5-db.ts 한정 예외 ⑧(read-only SELECT)·⑨
// (mb_intercept_date·mb_level UPDATE)로만 하고, sp_* 는 Prisma 가 소유한다.

const MbIdParams = z.object({ mbId: z.string().min(1).max(20) });

// '' → null 정규화(익명화된 탈퇴 회원의 빈 값을 null 로 표시).
const nn = (s: string | null): string | null => (s === null || s === '' ? null : s);

// 상태(배타): 탈퇴(leave≠'') > 차단(intercept≠'' AND leave='') > 정상.
const deriveStatus = (interceptDate: string, leaveDate: string): AdminMemberStatusType =>
  leaveDate !== '' ? 'left' : interceptDate !== '' ? 'intercepted' : 'normal';

// 회사명 해석(2층): sp 프로필 ?? mb_2(레거시) ?? null. 빈 값은 null 로 정규화.
const resolveMemberCompany = (profileCompany: string | null, legacyMb2: string): string | null =>
  nn(profileCompany) ?? nn(legacyMb2);

// recentProjects 의 quoteStatus 총함수 내로잉(직렬화 실패 방지).
const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';

// 목록 행 → 계약 ListItem. 상세도 이 필드를 공유한다(ListItem.extend).
const toMemberListItem = (
  row: MemberListRow,
  profileCompany: string | null,
  projectCount: number,
): AdminMemberListItemType => ({
  mbId: row.mbId,
  name: row.name,
  nick: row.nick,
  email: nn(row.email),
  phone: nn(row.hp !== '' ? row.hp : row.tel), // mb_hp 우선, 없으면 mb_tel
  memberType: nn(row.memberType),
  companyName: resolveMemberCompany(profileCompany, row.legacyCompany),
  level: row.level,
  point: row.point,
  status: deriveStatus(row.interceptDate, row.leaveDate),
  joinedAt: row.joinedAt,
  lastLoginAt: row.lastLoginAt,
  projectCount,
});

export const adminMemberRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // 전 라우트 관리자 전용 — 라우트별 preHandler 누락 사고를 원천 차단
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/members — 회원 목록 ────────────────────────────────────
  // counts 는 탭 미반영·검색어/기간 반영(배타 집계), total 은 탭 반영(searchMembers 파생).
  fastify.get(
    '/members',
    {
      schema: {
        querystring: AdminMemberListQuery,
        response: { 200: AdminMemberListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab, sort } = request.query;
      const { rows, total, counts } = await searchMembers({
        tab,
        q: request.query.q,
        from: request.query.from,
        to: request.query.to,
        sort,
        page,
        pageSize,
      });

      const pageIds = rows.map((r) => r.mbId);
      // 배치 2건: ① 활성 견적 건수(projectCount) ② sp 프로필 회사명(companyName 해석)
      const [grouped, profiles] = await Promise.all([
        prisma.spOrderSpec.groupBy({
          by: ['mbId'],
          where: { mbId: { in: pageIds }, status: 'active' },
          _count: { _all: true },
        }),
        prisma.spMemberProfile.findMany({
          where: { mbId: { in: pageIds } },
          select: { mbId: true, companyName: true },
        }),
      ]);
      const countByMb = new Map(grouped.map((g) => [g.mbId, g._count._all]));
      const companyByMb = new Map(profiles.map((p) => [p.mbId, p.companyName]));

      return {
        result: true as const,
        data: {
          items: rows.map((r) =>
            toMemberListItem(r, companyByMb.get(r.mbId) ?? null, countByMb.get(r.mbId) ?? 0),
          ),
          total,
          page,
          pageSize,
          counts,
        },
      };
    },
  );

  // ── GET /api/admin/members/:mbId — 회원 상세 ──────────────────────────────
  // 레거시 사업자 정보(mb_1~9)는 라벨 복원 read-only. 최근 견적 5건 + 활성 견적 총수.
  fastify.get(
    '/members/:mbId',
    {
      schema: {
        params: MbIdParams,
        response: { 200: AdminMemberDetailResponse },
      },
    },
    async (request, reply) => {
      const row = await getMemberDetailRow(request.params.mbId);
      if (row === null) return reply.notFound('회원이 없습니다');

      const [profile, specs, projectCount] = await Promise.all([
        prisma.spMemberProfile.findUnique({
          where: { mbId: row.mbId },
          select: { companyName: true },
        }),
        prisma.spOrderSpec.findMany({
          where: { mbId: row.mbId, status: 'active' },
          orderBy: { id: 'desc' },
          take: 5,
        }),
        prisma.spOrderSpec.count({ where: { mbId: row.mbId, status: 'active' } }),
      ]);
      // recentProjects price = finalPrice ?? autoPrice ?? null (sp_quote 배치, 견적 관리 관례)
      const quotes =
        specs.length > 0
          ? await prisma.spQuote.findMany({
              where: { id: { in: specs.map((s) => s.quoteId) } },
              select: { id: true, autoPrice: true },
            })
          : [];
      const autoPriceById = new Map(quotes.map((qt) => [qt.id, qt.autoPrice]));

      // 레거시 사업자 정보 — mb_1~9 전부 '' 이면 null
      const business = {
        memberType: row.memberType,
        companyName: row.legacyCompany,
        bizNo: row.mb3,
        ceoName: row.mb4,
        bizType: row.mb5,
        bizItem: row.mb6,
        managerName: row.mb7,
        taxEmail: row.mb8,
        managerPhone: row.mb9,
      };
      const hasBusiness = Object.values(business).some((v) => v !== '');

      // 주소 — zip1(+zip2) 합성, 전부 '' 이면 null
      const zip = [row.zip1, row.zip2].filter((z) => z !== '').join('-');
      const addrEmpty = zip === '' && row.addr1 === '' && row.addr2 === '' && row.addr3 === '';

      return {
        result: true as const,
        data: {
          ...toMemberListItem(row, profile?.companyName ?? null, projectCount),
          addr: addrEmpty ? null : { zip, addr1: row.addr1, addr2: row.addr2, addr3: row.addr3 },
          emailCertifiedAt: row.emailCertifiedAt,
          mailAgree: row.mailling === 1,
          smsAgree: row.sms === 1,
          marketingAgree: row.marketingAgree === 1,
          memo: nn(row.memo),
          interceptDate: nn(row.interceptDate),
          leaveDate: nn(row.leaveDate),
          legacyBusiness: hasBusiness ? business : null,
          profileCompanyName: profile?.companyName ?? null,
          recentProjects: specs.map((s) => ({
            projectId: Number(s.id),
            projectName: s.projectName,
            quoteStatus: asQuoteStatus(s.quoteStatus),
            price: s.finalPrice ?? autoPriceById.get(s.quoteId) ?? null,
            createdAt: s.createdAt.toISOString(),
          })),
        },
      };
    },
  );

  // ── PATCH /api/admin/members/:mbId/intercept — 차단/해제 (한정 예외 ⑨) ──────
  // 가드 순서: 미존재 404 → 탈퇴 409 LEFT_MEMBER → 자기 자신 409 SELF_FORBIDDEN →
  // cf_admin 계정 409 ADMIN_PROTECTED. 멱등(이미 같은 상태여도 200 — 존재는 위에서 확정).
  fastify.patch(
    '/members/:mbId/intercept',
    {
      schema: {
        params: MbIdParams,
        body: AdminMemberInterceptBody,
        response: { 200: AdminMemberInterceptResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { mbId } = request.params;
      const row = await getMemberDetailRow(mbId);
      if (row === null) return reply.notFound('회원이 없습니다');
      if (row.leaveDate !== '') {
        return reply.status(409).send({ error: 'LEFT_MEMBER', message: '탈퇴한 회원입니다' });
      }
      if (mbId === request.user.mbId) {
        return reply
          .status(409)
          .send({ error: 'SELF_FORBIDDEN', message: '자기 자신은 차단할 수 없습니다' });
      }
      // 현재는 self 와 동일인이지만 isAdmin 확장(다중 관리자) 대비 이중 가드
      const cfAdmin = await getCfAdminId();
      if (mbId === cfAdmin) {
        return reply
          .status(409)
          .send({ error: 'ADMIN_PROTECTED', message: '최고관리자 계정은 차단할 수 없습니다' });
      }

      const ymd = request.body.intercept ? kstTodayYmd() : '';
      await setMemberIntercept(mbId, ymd);
      return {
        result: true as const,
        data: {
          mbId,
          status: deriveStatus(ymd, row.leaveDate), // leaveDate='' 확정(가드 통과)
          interceptDate: nn(ymd),
        },
      };
    },
  );

  // ── PATCH /api/admin/members/:mbId/level — 레벨 변경 (한정 예외 ⑨) ──────────
  // intercept 와 동일 가드. level 은 계약(Zod)에서 1~10 강제(그 외 400).
  fastify.patch(
    '/members/:mbId/level',
    {
      schema: {
        params: MbIdParams,
        body: AdminMemberLevelBody,
        response: { 200: AdminMemberLevelResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { mbId } = request.params;
      const row = await getMemberDetailRow(mbId);
      if (row === null) return reply.notFound('회원이 없습니다');
      if (row.leaveDate !== '') {
        return reply.status(409).send({ error: 'LEFT_MEMBER', message: '탈퇴한 회원입니다' });
      }
      if (mbId === request.user.mbId) {
        return reply
          .status(409)
          .send({ error: 'SELF_FORBIDDEN', message: '자기 자신은 변경할 수 없습니다' });
      }
      const cfAdmin = await getCfAdminId();
      if (mbId === cfAdmin) {
        return reply
          .status(409)
          .send({ error: 'ADMIN_PROTECTED', message: '최고관리자 계정은 변경할 수 없습니다' });
      }

      await setMemberLevel(mbId, request.body.level);
      return {
        result: true as const,
        data: { mbId, level: request.body.level },
      };
    },
  );

  // ── PATCH /api/admin/members/:mbId/profile — 회사명(sp 프로필층) 저장 ────────
  // 미존재 404 만 방어(회사명은 프로필 메타데이터라 상태 무관 — 차단/레벨의 가드 없음).
  // '' = 프로필 회사명 삭제(null 저장). 견적 스냅샷(SpOrderSpec.companyName)은 불변.
  fastify.patch(
    '/members/:mbId/profile',
    {
      schema: {
        params: MbIdParams,
        body: AdminMemberProfileBody,
        response: { 200: AdminMemberProfileResponse },
      },
    },
    async (request, reply) => {
      const row = await getMemberDetailRow(request.params.mbId);
      if (row === null) return reply.notFound('회원이 없습니다');

      const stored = request.body.companyName === '' ? null : request.body.companyName;
      await prisma.spMemberProfile.upsert({
        where: { mbId: row.mbId },
        create: { mbId: row.mbId, companyName: stored },
        update: { companyName: stored },
      });

      return {
        result: true as const,
        data: {
          mbId: row.mbId,
          companyName: resolveMemberCompany(stored, row.legacyCompany),
        },
      };
    },
  );

  done();
};
