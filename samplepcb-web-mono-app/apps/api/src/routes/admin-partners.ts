import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpPartner } from '@prisma/client';
import { z } from 'zod';
import {
  AdminPartnerActLogResponse,
  AdminPartnerCreateBody,
  AdminPartnerDeleteResponse,
  AdminPartnerDetailResponse,
  AdminPartnerListQuery,
  AdminPartnerListResponse,
  AdminPartnerMemberAddBody,
  AdminPartnerMutationResponse,
  AdminPartnerRelationAddBody,
  AdminPartnerRelationCurrencyBody,
  AdminPartnerRelationsResponse,
  AdminPartnerStatusBody,
  AdminPartnerUpdateBody,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminPartnerCountsType,
  AdminPartnerDetailType,
  AdminPartnerRelationLinkType,
  AdminPartnerRelationsDataType,
} from '@sp/api-contract';
import { getMembersByIds } from '../lib/g5-db';
import {
  asPartnerStatus,
  asPartnerType,
  matchPartnerDuplicates,
  toAdminPartnerDetail,
  toAdminPartnerItem,
  toCapabilities,
  validatePartnerCountry,
  validateSupplierCode,
} from '../lib/partner';
import { normalizePartnerCountry } from '../lib/bom-shipment-policy';
import {
  activeBomPairDocCount,
  activePairDocCount,
  loadActiveDirectPos,
  type BomPairDoc,
  type PairDoc,
} from '../lib/partner-children';
import { purgeOrphanPartnerOffers } from '../lib/partner-parts';
import { prisma } from '../lib/prisma';

// ── /api/admin/partners — 공용 파트너(조직) 관리 ────────────────────────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §1·§3.5. 조직/계정/자동화 3축 분리 —
// 등록 원천이 관리자라 생성 기본 approved, 상태 변경은 감사 필드(decidedBy/At) 기록.
// 계정 연결은 정상 가입한 g5_member 만(가짜 회원 없음), 1계정=1조직 운영 가드.
// 전 라우트 requireAdmin(addHook 일괄 — 라우트별 누락 사고 차단).

const PartnerIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const PartnerMemberParams = z.object({
  id: z.string().regex(/^\d+$/),
  mbId: z.string().min(1),
});

const PartnerRelationParams = z.object({
  id: z.string().regex(/^\d+$/),
  childId: z.string().regex(/^\d+$/),
});

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const isForeignKeyViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';

// 같은 회사로 보이는 다른 협력사(사업자번호·담당 이메일 일치) — 사람 협력사끼리만 본다.
type DupSource = Pick<SpPartner, 'id' | 'type' | 'name' | 'businessNo' | 'contactEmail'>;

const loadDuplicatePool = async (rows: readonly DupSource[]): Promise<DupSource[]> => {
  const targets = rows.filter((r) => r.type === 'partner');
  const bizNos = [...new Set(targets.map((r) => r.businessNo?.trim() ?? '').filter((v) => v !== ''))];
  const emails = [...new Set(targets.map((r) => r.contactEmail?.trim() ?? '').filter((v) => v !== ''))];
  if (bizNos.length === 0 && emails.length === 0) return [];
  return prisma.spPartner.findMany({
    where: {
      type: 'partner',
      OR: [
        ...(bizNos.length > 0 ? [{ businessNo: { in: bizNos } }] : []),
        ...(emails.length > 0 ? [{ contactEmail: { in: emails } }] : []),
      ],
    },
    select: { id: true, type: true, name: true, businessNo: true, contactEmail: true },
  });
};

const duplicatesOf = (row: DupSource, pool: readonly DupSource[]) =>
  row.type === 'partner' ? matchPartnerDuplicates(row, pool) : [];

const detailOf = async (id: bigint): Promise<AdminPartnerDetailType | null> => {
  const partner = await prisma.spPartner.findUnique({
    where: { id },
    include: { members: { orderBy: { id: 'asc' } }, owner: { select: { name: true } } },
  });
  if (partner === null) return null;
  const pool = await loadDuplicatePool([partner]);
  return toAdminPartnerDetail(partner, {
    ownerPartnerName: partner.owner?.name ?? null,
    duplicates: duplicatesOf(partner, pool),
  });
};

// ── 마스터딜러(MD) 소속 — sp_partner_relation 헬퍼 ───────────────────────────
// PCB 트랙 MD 2단 중개(docs/PCB_PARTNER_TRACK.md §1.4·D1)의 소속 링크. 링크 통화는
// 배정 시점에 RFQ 행으로 박제(resolveLinkCurrency)되므로 여기서의 변경은 이후 배정부터
// 적용된다. 2단만 지원 — 부모는 다른 MD 의 하위일 수 없고, 하위는 부모일 수 없다.

// 진행 중 문서 수(activePairDocCount)는 포털의 하위 삭제와 같은 판정이라 lib 로 옮겼다
// (lib/partner-children.ts).

type PairRow = PairDoc & { parentPartnerId: bigint; partnerId: bigint };

const pairKey = (parentId: bigint, childId: bigint): string =>
  `${parentId.toString()}:${childId.toString()}`;

const groupByPair = (rows: PairRow[]): Map<string, PairRow[]> => {
  const map = new Map<string, PairRow[]>();
  for (const row of rows) {
    const key = pairKey(row.parentPartnerId, row.partnerId);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
};

const relationsOf = async (id: bigint): Promise<AdminPartnerRelationsDataType> => {
  const [asParent, asChild] = await Promise.all([
    prisma.spPartnerRelation.findMany({
      where: { parentPartnerId: id },
      include: { child: true },
      orderBy: { id: 'asc' },
    }),
    prisma.spPartnerRelation.findMany({
      where: { childPartnerId: id },
      include: { parent: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const childIds = asParent.map((r) => r.childPartnerId);
  const parentIds = asChild.map((r) => r.parentPartnerId);
  // RFQ·PO 두 모델에 같은 where 를 쓰므로 공용 구조 타입으로 둔다(WhereInput 은 모델별).
  type PairCond =
    | { parentPartnerId: bigint; partnerId: { in: bigint[] } }
    | { partnerId: bigint; parentPartnerId: { in: bigint[] } };
  const pairConds: PairCond[] = [];
  if (childIds.length > 0) pairConds.push({ parentPartnerId: id, partnerId: { in: childIds } });
  if (parentIds.length > 0) pairConds.push({ partnerId: id, parentPartnerId: { in: parentIds } });
  const docSelect = {
    parentPartnerId: true,
    partnerId: true,
    status: true,
    reorderRound: true,
  } as const;
  // BOM 쪽 문서(하위 재요청·하위 발주)도 같은 쌍으로 센다 — 해제 가드와 화면의 숫자가 같아야 한다.
  const bomSelect = { parentPartnerId: true, partnerId: true, status: true } as const;
  const [rfqRows, poRows, bomRfqRows, bomMdPoRows] =
    pairConds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          prisma.spPcbRfq.findMany({ where: { OR: pairConds }, select: docSelect }),
          prisma.spPcbPo.findMany({ where: { OR: pairConds }, select: docSelect }),
          prisma.spBomRfq.findMany({ where: { OR: pairConds }, select: bomSelect }),
          prisma.spBomMdPo.findMany({ where: { OR: pairConds }, select: bomSelect }),
        ]);
  const rfqMap = groupByPair(rfqRows);
  const poMap = groupByPair(poRows);
  const bomOfPair = (
    rows: (BomPairDoc & { parentPartnerId: bigint; partnerId: bigint })[],
    parentId: bigint,
    childId: bigint,
  ): BomPairDoc[] => rows.filter((row) => row.parentPartnerId === parentId && row.partnerId === childId);
  const activeOf = (parentId: bigint, childId: bigint): number => {
    const key = pairKey(parentId, childId);
    return (
      activePairDocCount(rfqMap.get(key) ?? [], poMap.get(key) ?? []) +
      activeBomPairDocCount(
        bomOfPair(bomRfqRows, parentId, childId),
        bomOfPair(bomMdPoRows, parentId, childId),
      )
    );
  };

  const toLink = (
    rel: {
      settlementCurrency: string | null;
      createdBy: string | null;
      forceNote: string | null;
      createdAt: Date;
    },
    other: { id: bigint; name: string; country: string | null; status: string },
    parentId: bigint,
    childId: bigint,
  ): AdminPartnerRelationLinkType => ({
    partnerId: Number(other.id),
    name: other.name,
    country: other.country,
    status: asPartnerStatus(other.status),
    settlementCurrency: rel.settlementCurrency,
    activeCount: activeOf(parentId, childId),
    createdBy: rel.createdBy,
    forceNote: rel.forceNote,
    createdAt: rel.createdAt.toISOString(),
  });

  // 첫 하위 연결이 지금 막히는가 — 화면이 연결을 누르기 전에 알리고 강제 전환을 안내한다.
  // 이미 마스터딜러로 지정된 조직은 첫 연결이 역할 전환이 아니라 막지 않는다.
  let conversionBlock: AdminPartnerRelationsDataType['conversionBlock'] = null;
  const self = await prisma.spPartner.findUnique({ where: { id }, select: { isMasterDealer: true } });
  if (asParent.length === 0 && asChild.length === 0 && self?.isMasterDealer !== true) {
    const active = await loadActiveDirectPos(id, 0);
    if (active.count > 0) conversionBlock = { activePoCount: active.count };
  }

  // 후보 — 2단 규칙 선반영: 자신·기존 하위·이미 MD(부모 경험)인 조직 제외. 이 조직이
  // 이미 다른 MD 의 하위면 후보 없음(하위는 부모가 될 수 없다 — POST 가드와 동일).
  // 다른 마스터딜러가 포털에서 직접 등록한 조직도 후보에서 뺀다(그 조직의 것이다).
  let candidates: AdminPartnerRelationsDataType['candidates'] = [];
  if (asChild.length === 0) {
    const mdRows = await prisma.spPartnerRelation.findMany({
      select: { parentPartnerId: true },
      distinct: ['parentPartnerId'],
    });
    const excluded = new Set<string>([
      id.toString(),
      ...childIds.map((v) => v.toString()),
      ...mdRows.map((r) => r.parentPartnerId.toString()),
    ]);
    const rows = await prisma.spPartner.findMany({
      where: {
        type: 'partner',
        status: 'approved',
        isMasterDealer: false, // 하위가 아직 없어도 마스터딜러로 지정된 조직은 하위가 될 수 없다
        OR: [{ ownerPartnerId: null }, { ownerPartnerId: id }],
      },
      orderBy: { name: 'asc' },
    });
    candidates = rows
      .filter((p) => !excluded.has(p.id.toString()))
      .map((p) => ({
        partnerId: Number(p.id),
        name: p.name,
        country: p.country,
        hasPcbRfq: toCapabilities(p.capabilities).includes('pcb_rfq'),
      }));
  }

  return {
    parents: asChild.map((rel) => toLink(rel, rel.parent, rel.parentPartnerId, id)),
    children: asParent.map((rel) => toLink(rel, rel.child, id, rel.childPartnerId)),
    candidates,
    conversionBlock,
  };
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
      const { page, pageSize, tab, type, origin, role, q } = request.query;
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
      // 등록 원천 — md 는 마스터딜러가 포털에서 직접 등록한 조직(자동 승인 — 사후 감독 대상).
      if (origin === 'md') conds.push({ NOT: { ownerPartnerId: null } });
      if (origin === 'admin') conds.push({ ownerPartnerId: null });
      if (role === 'md') conds.push({ isMasterDealer: true });
      const base: Prisma.SpPartnerWhereInput = conds.length > 0 ? { AND: conds } : {};
      const where: Prisma.SpPartnerWhereInput =
        tab === 'all' ? base : { AND: [base, { status: tab }] };

      const [rows, total, grouped] = await Promise.all([
        prisma.spPartner.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { members: true } }, owner: { select: { name: true } } },
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
      const dupPool = await loadDuplicatePool(rows);
      return {
        result: true as const,
        data: {
          items: rows.map((r) =>
            toAdminPartnerItem(r, r._count.members, {
              ownerPartnerName: r.owner?.name ?? null,
              duplicates: duplicatesOf(r, dupPool),
            }),
          ),
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
      const invalidCountry = validatePartnerCountry(b.type, b.status, b.country ?? null);
      if (invalidCountry !== null) {
        return reply
          .status(400)
          .send({ error: 'PARTNER_COUNTRY_REQUIRED', message: invalidCountry });
      }
      if (b.isMasterDealer === true && b.type !== 'partner') {
        return reply.status(400).send({
          error: 'NOT_PARTNER_TYPE',
          message: '마스터딜러는 사람 협력사(partner)만 지정할 수 있습니다.',
        });
      }
      try {
        const created = await prisma.spPartner.create({
          data: {
            type: b.type,
            name: b.name,
            supplierCode,
            country: normalizePartnerCountry(b.country),
            defaultCurrency: b.defaultCurrency,
            capabilities: b.capabilities,
            status: b.status,
            contactName: b.contactName ?? null,
            contactPhone: b.contactPhone ?? null,
            contactEmail: b.contactEmail ?? null,
            businessNo: b.businessNo ?? null,
            ownerName: b.ownerName ?? null,
            businessZip: b.businessZip ?? null,
            businessAddress: b.businessAddress ?? null,
            businessType: b.businessType ?? null,
            businessItem: b.businessItem ?? null,
            fax: b.fax ?? null,
            memo: b.memo ?? null,
            isMasterDealer: b.isMasterDealer === true,
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
      const effCountry = b.country === undefined ? existing.country : (b.country ?? null);
      const invalidCountry = validatePartnerCountry(
        effType,
        asPartnerStatus(existing.status),
        effCountry,
      );
      if (invalidCountry !== null) {
        return reply
          .status(400)
          .send({ error: 'PARTNER_COUNTRY_REQUIRED', message: invalidCountry });
      }

      // 마스터딜러 지정 — 켜기는 사람 협력사이고 다른 마스터딜러의 하위가 아닐 때(2단 제한),
      // 끄기는 하위가 없을 때만(하위가 있는 동안은 실제로 중개 중이다). 유형을 바꾸며 켜 둔 채
      // partner 가 아니게 되는 것도 막는다.
      const effMd = b.isMasterDealer ?? existing.isMasterDealer;
      if (effMd && effType !== 'partner') {
        return reply.status(400).send({
          error: 'NOT_PARTNER_TYPE',
          message: '마스터딜러는 사람 협력사(partner)만 지정할 수 있습니다.',
        });
      }
      if (b.isMasterDealer !== undefined && b.isMasterDealer !== existing.isMasterDealer) {
        const [asChild, childCount] = await Promise.all([
          prisma.spPartnerRelation.count({ where: { childPartnerId: id } }),
          prisma.spPartnerRelation.count({ where: { parentPartnerId: id } }),
        ]);
        if (b.isMasterDealer && asChild > 0) {
          return reply.status(409).send({
            error: 'PARENT_IS_CHILD',
            message: '다른 마스터딜러의 하위 조직은 마스터딜러가 될 수 없습니다(2단 제한).',
          });
        }
        if (!b.isMasterDealer && childCount > 0) {
          return reply.status(409).send({
            error: 'HAS_CHILDREN',
            message: `하위 협력사 ${String(childCount)}곳이 연결돼 있어 마스터딜러 지정을 끌 수 없습니다 — 소속을 먼저 해제하세요.`,
          });
        }
      }

      const data: Prisma.SpPartnerUpdateInput = {};
      if (b.isMasterDealer !== undefined) data.isMasterDealer = b.isMasterDealer;
      if (b.type !== undefined) data.type = b.type;
      if (b.name !== undefined) data.name = b.name;
      if (b.supplierCode !== undefined) data.supplierCode = b.supplierCode ?? null;
      if (b.country !== undefined) data.country = normalizePartnerCountry(b.country);
      if (b.defaultCurrency !== undefined) data.defaultCurrency = b.defaultCurrency;
      if (b.capabilities !== undefined) data.capabilities = b.capabilities;
      if (b.contactName !== undefined) data.contactName = b.contactName ?? null;
      if (b.contactPhone !== undefined) data.contactPhone = b.contactPhone ?? null;
      if (b.contactEmail !== undefined) data.contactEmail = b.contactEmail ?? null;
      if (b.businessNo !== undefined) data.businessNo = b.businessNo ?? null;
      if (b.ownerName !== undefined) data.ownerName = b.ownerName ?? null;
      if (b.businessZip !== undefined) data.businessZip = b.businessZip ?? null;
      if (b.businessAddress !== undefined) data.businessAddress = b.businessAddress ?? null;
      if (b.businessType !== undefined) data.businessType = b.businessType ?? null;
      if (b.businessItem !== undefined) data.businessItem = b.businessItem ?? null;
      if (b.fax !== undefined) data.fax = b.fax ?? null;
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
        response: { 200: AdminPartnerMutationResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const { status, reason } = request.body;
      const partner = await prisma.spPartner.findUnique({ where: { id } });
      if (partner === null) return reply.notFound('파트너가 없습니다');
      const invalidCountry = validatePartnerCountry(
        asPartnerType(partner.type),
        status,
        partner.country,
      );
      if (invalidCountry !== null) {
        return reply
          .status(400)
          .send({ error: 'PARTNER_COUNTRY_REQUIRED', message: invalidCountry });
      }
      const updated = await prisma.spPartner.updateMany({
        where: { id, NOT: { status } },
        data: {
          status,
          statusReason: reason ?? null,
          decidedBy: request.user.mbId,
          decidedAt: new Date(),
          // 관리자가 상태를 정했다 — 소유 마스터딜러의 '사용 중지' 표식을 지워, 관리자 정지를
          // 마스터딜러가 포털에서 되살리지 못하게 한다.
          ownerSuspendedAt: null,
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
  // 문서 이력이 있으면 거부(FK RESTRICT 와 동일 정책의 선제 안내) — 운영 배제는 suspended.
  // BOM 축(sp_bom_rfq)에 더해 PCB 축(sp_pcb_rfq·sp_pcb_po)도 선제 가드한다 — 가드 없이는
  // FK P2003 이 안내 없는 500 으로 죽었다(여정 6호 J5 실측). 그 밖의 참조가 남는 경우도
  // P2003 을 잡아 같은 409 안내로 돌려준다(Prisma 원문이 화면에 새지 않게).
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
      const [rfqCount, pcbRfqCount, pcbPoCount] = await Promise.all([
        prisma.spBomRfq.count({ where: { partnerId: id } }),
        prisma.spPcbRfq.count({ where: { partnerId: id } }),
        prisma.spPcbPo.count({ where: { partnerId: id } }),
      ]);
      if (rfqCount > 0) {
        return reply.status(409).send({
          error: 'PARTNER_HAS_RFQS',
          message: 'RFQ 이력이 있는 파트너는 삭제할 수 없습니다. 정지(suspended)로 배제하세요.',
        });
      }
      if (pcbRfqCount > 0 || pcbPoCount > 0) {
        return reply.status(409).send({
          error: 'PARTNER_HAS_PCB_DOCS',
          message:
            'PCB 견적요청/발주 이력이 있어 삭제할 수 없습니다 — 정지 상태로 전환해 사용을 막으세요.',
        });
      }
      try {
        await prisma.spPartner.delete({ where: { id } });
        // 원장은 cascade 로 딸려 가지만 카탈로그 구매 조건에는 FK 가 없다 — 직접 치운다.
        await purgeOrphanPartnerOffers(id);
      } catch (e) {
        if (isForeignKeyViolation(e)) {
          return reply.status(409).send({
            error: 'PARTNER_HAS_PCB_DOCS',
            message:
              'PCB 견적요청/발주 이력이 있어 삭제할 수 없습니다 — 정지 상태로 전환해 사용을 막으세요.',
          });
        }
        throw e;
      }
      return { result: true as const };
    },
  );

  // ── GET /api/admin/partners/:id/act-logs — 관리자 대리 접속 이력(최근 50건) ──
  // 관리자가 이 조직의 포털에 들어가 한 쓰기 요청(lib/partner-act-as.ts·plugins/auth.ts).
  fastify.get(
    '/partners/:id/act-logs',
    { schema: { params: PartnerIdParams, response: { 200: AdminPartnerActLogResponse } } },
    async (request) => {
      const rows = await prisma.spPartnerActLog.findMany({
        where: { partnerId: BigInt(request.params.id) },
        orderBy: { id: 'desc' },
        take: 50,
      });
      return {
        result: true as const,
        data: {
          items: rows.map((r) => ({
            id: Number(r.id),
            adminMbId: r.adminMbId,
            method: r.method,
            path: r.path,
            statusCode: r.statusCode,
            createdAt: r.createdAt.toISOString(),
          })),
        },
      };
    },
  );

  // ── GET /api/admin/partners/:id/relations — MD 소속(상위·하위·후보) ─────────
  fastify.get(
    '/partners/:id/relations',
    { schema: { params: PartnerIdParams, response: { 200: AdminPartnerRelationsResponse } } },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const partner = await prisma.spPartner.findUnique({ where: { id } });
      if (partner === null) return reply.notFound('파트너가 없습니다');
      return { result: true as const, data: await relationsOf(id) };
    },
  );

  // ── POST /api/admin/partners/:id/relations — 하위 협력사 연결(:id = MD) ────
  fastify.post(
    '/partners/:id/relations',
    {
      schema: {
        params: PartnerIdParams,
        body: AdminPartnerRelationAddBody,
        response: { 200: AdminPartnerRelationsResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const childId = BigInt(request.body.childPartnerId);
      const [parent, child] = await Promise.all([
        prisma.spPartner.findUnique({ where: { id } }),
        prisma.spPartner.findUnique({ where: { id: childId } }),
      ]);
      if (parent === null) return reply.notFound('파트너가 없습니다');
      if (child === null) return reply.notFound('연결할 협력사가 없습니다');
      if (id === childId) {
        return reply
          .status(400)
          .send({ error: 'SELF_LINK', message: '자기 자신은 하위로 연결할 수 없습니다.' });
      }
      if (parent.type !== 'partner' || child.type !== 'partner') {
        return reply.status(400).send({
          error: 'NOT_PARTNER_TYPE',
          message: '마스터딜러 소속은 사람 협력사끼리만 연결할 수 있습니다.',
        });
      }
      if (parent.status !== 'approved' || child.status !== 'approved') {
        return reply.status(400).send({
          error: 'NOT_APPROVED',
          message: '승인 상태의 조직만 연결할 수 있습니다.',
        });
      }
      // 2단 강제 — 하위가 이미 MD 이거나(3단), 부모가 이미 다른 MD 의 하위면(사슬) 거부.
      const [childAsMd, parentAsChild] = await Promise.all([
        prisma.spPartnerRelation.count({ where: { parentPartnerId: childId } }),
        prisma.spPartnerRelation.count({ where: { childPartnerId: id } }),
      ]);
      if (childAsMd > 0 || child.isMasterDealer) {
        return reply.status(400).send({
          error: 'CHILD_IS_MD',
          message: '마스터딜러 조직은 하위로 연결할 수 없습니다 — 2단 중개만 지원합니다.',
        });
      }
      if (parentAsChild > 0) {
        return reply.status(400).send({
          error: 'PARENT_IS_CHILD',
          message: '다른 마스터딜러의 하위 조직은 마스터딜러가 될 수 없습니다(2단 제한).',
        });
      }
      // 첫 하위 연결은 조직을 MD 로 전환한다. 발주 방식은 fulfillmentMode 박제라 기존 건이
      // 자체→위임으로 뒤집히진 않지만, 진행 중 거래 도중 조직 역할을 바꾸지 않는 보수적 가드는 유지.
      // 발주가 끊이지 않는 협력사는 이 가드에 영영 걸리므로, 관리자는 사유를 남기고 넘을 수 있다
      // (force — 2단 제한·승인 상태 같은 위의 구조 제약은 강제로도 못 넘는다).
      const existingChildren = await prisma.spPartnerRelation.count({
        where: { parentPartnerId: id },
      });
      let forceNote: string | null = null;
      // 이미 마스터딜러로 지정된 조직은 역할 전환이 아니므로 진행 중 발주 가드를 두지 않는다.
      if (existingChildren === 0 && !parent.isMasterDealer) {
        const activeReceived = await prisma.spPcbPo.count({
          where: { partnerId: id, parentPartnerId: 0n, status: { not: 'produced' } },
        });
        if (activeReceived > 0) {
          if (!request.body.force) {
            return reply.status(409).send({
              error: 'PARENT_HAS_ACTIVE_POS',
              message: `진행 중인 발주가 ${String(activeReceived)}건 있어 지금은 마스터딜러로 전환할 수 없습니다 — 발주 종결 후 연결하거나, 사유를 남기고 강제로 연결하세요(진행 중인 발주는 직접 제작으로 그대로 진행됩니다).`,
            });
          }
          forceNote = request.body.forceReason ?? null;
        }
      }
      try {
        // 하위를 연결하면 마스터딜러 지정도 켠다(표시가 역할의 정본).
        await prisma.$transaction([
          prisma.spPartnerRelation.create({
            data: {
              parentPartnerId: id,
              childPartnerId: childId,
              settlementCurrency: request.body.settlementCurrency,
              createdBy: request.user.mbId,
              forceNote,
            },
          }),
          prisma.spPartner.update({ where: { id }, data: { isMasterDealer: true } }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) {
          return reply
            .status(409)
            .send({ error: 'ALREADY_LINKED', message: '이미 연결된 하위 협력사입니다.' });
        }
        throw e;
      }
      return { result: true as const, data: await relationsOf(id) };
    },
  );

  // ── PUT /api/admin/partners/:id/relations/:childId — 링크 통화 변경 ─────────
  // 기존 견적행은 배정 시점 박제 통화를 유지한다 — 변경은 이후 배정부터 적용.
  fastify.put(
    '/partners/:id/relations/:childId',
    {
      schema: {
        params: PartnerRelationParams,
        body: AdminPartnerRelationCurrencyBody,
        response: { 200: AdminPartnerRelationsResponse },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const childId = BigInt(request.params.childId);
      const updated = await prisma.spPartnerRelation.updateMany({
        where: { parentPartnerId: id, childPartnerId: childId },
        data: { settlementCurrency: request.body.settlementCurrency },
      });
      if (updated.count === 0) return reply.notFound('소속 링크가 없습니다');
      return { result: true as const, data: await relationsOf(id) };
    },
  );

  // ── DELETE /api/admin/partners/:id/relations/:childId — 소속 해제 ───────────
  fastify.delete(
    '/partners/:id/relations/:childId',
    {
      schema: {
        params: PartnerRelationParams,
        response: { 200: AdminPartnerRelationsResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = BigInt(request.params.id);
      const childId = BigInt(request.params.childId);
      const relation = await prisma.spPartnerRelation.findUnique({
        where: { parentPartnerId_childPartnerId: { parentPartnerId: id, childPartnerId: childId } },
      });
      if (relation === null) return reply.notFound('소속 링크가 없습니다');
      const pair = { parentPartnerId: id, partnerId: childId };
      const [rfqs, pos, bomRfqs, bomMdPos] = await Promise.all([
        prisma.spPcbRfq.findMany({ where: pair, select: { status: true, reorderRound: true } }),
        prisma.spPcbPo.findMany({ where: pair, select: { status: true, reorderRound: true } }),
        // 부품 조달 쪽 — 하위 재요청(회신 왕복 중)·하위 발주(수령 전)도 진행 중이다.
        prisma.spBomRfq.findMany({ where: pair, select: { status: true } }),
        prisma.spBomMdPo.findMany({ where: pair, select: { status: true } }),
      ]);
      if (activePairDocCount(rfqs, pos) + activeBomPairDocCount(bomRfqs, bomMdPos) > 0) {
        return reply.status(409).send({
          error: 'RELATION_ACTIVE',
          message:
            '진행 중 견적·발주가 있는 소속은 해제할 수 없습니다. 종결(생산완료·수령·견적 마감) 후 해제하세요.',
        });
      }
      await prisma.spPartnerRelation.delete({ where: { id: relation.id } });
      return { result: true as const, data: await relationsOf(id) };
    },
  );

  done();
};
