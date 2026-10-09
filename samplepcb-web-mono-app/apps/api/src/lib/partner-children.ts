import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { SpPartner } from '@prisma/client';
import type {
  PartnerChildEligibilityType,
  PartnerChildItemType,
  PartnerChildListDataType,
  PartnerInviteStateType,
} from '@sp/api-contract';
import { asPartnerStatus, toCapabilities } from './partner';
import { purgeOrphanPartnerOffers } from './partner-parts';
import { prisma } from './prisma';

// ── 하위 협력사 직접 관리 — docs/PARTNER_PORTAL.md "하위 협력사 직접 관리" ────
// 마스터딜러가 포털에서 자기 하위 협력사를 등록·수정·삭제한다. 등록은 자동 승인이고
// 회원 계정은 만들지 않는다(가짜 회원 없음 원칙 유지) — 하위는 매직링크로 견적을 회신하고
// 이후 단계는 마스터딜러가 대행한다. 계정이 필요하면 초대 링크로 본인이 연결한다.
// 소유(ownerPartnerId)는 "누가 포털에서 고칠 수 있는가"의 근거다 — 관리자가 연결해 준
// 하위는 읽기 전용으로만 보인다.

export interface PairDoc {
  status: string;
  reorderRound: number;
}

// 진행 중(미종결) 문서 수 — RFQ 왕복 중(requested|quoted)·선정 후 발주 대기(selected 인데
// 같은 회차 발주 없음)·미종결 발주(≠produced). 이 수가 0일 때만 링크 해제·삭제를 허용한다 —
// 도중 해제는 위임 발주의 하위 재배정·발주 권한(NOT_MY_CHILD) 축을 흔든다. EQ 방식 자체는
// 발주서 fulfillmentMode 에 박제돼 관계 변경으로 뒤집히지 않는다. 선적은
// 행에 받는측이 박제돼 링크와 무관하므로 세지 않는다.
export const activePairDocCount = (rfqs: PairDoc[], pos: PairDoc[]): number => {
  const poRounds = new Set(pos.map((p) => p.reorderRound));
  let count = 0;
  for (const r of rfqs) {
    if (r.status === 'requested' || r.status === 'quoted') count += 1;
    else if (r.status === 'selected' && !poRounds.has(r.reorderRound)) count += 1;
  }
  for (const p of pos) if (p.status !== 'produced') count += 1;
  return count;
};

// 첫 하위 연결(마스터딜러 전환) 가드의 대상 — 관리자 직속 미종결 발주.
// 발주 방식은 발주서마다 박제(fulfillmentMode)라 전환해도 진행 건은 바뀌지 않는다. 그래도
// 거래 도중 조직 역할을 바꾸지 않는다는 정책으로 막고, 관리자만 사유를 남겨 넘을 수 있다.
export const loadActiveDirectPos = async (
  partnerId: bigint,
  take = 10,
): Promise<{ count: number; items: { poId: number; projectName: string }[] }> => {
  const where = { partnerId, parentPartnerId: 0n, status: { not: 'produced' } };
  const [count, rows] = await Promise.all([
    prisma.spPcbPo.count({ where }),
    prisma.spPcbPo.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
      select: { id: true, spec: { select: { projectName: true } } },
    }),
  ]);
  return {
    count,
    items: rows.map((r) => ({ poId: Number(r.id), projectName: r.spec.projectName })),
  };
};

const NOT_BLOCKED: Pick<PartnerChildEligibilityType, 'activePoCount' | 'activePos' | 'canForce'> = {
  activePoCount: 0,
  activePos: [],
  canForce: false,
};

/** 지금 하위를 등록할 수 있는가 — 포털 메뉴 진입·등록 요청이 같은 판정을 쓴다. */
export const resolveChildEligibility = async (
  partner: Pick<SpPartner, 'id' | 'type' | 'capabilities'>,
  actingAdmin: boolean,
): Promise<PartnerChildEligibilityType> => {
  if (partner.type !== 'partner' || !toCapabilities(partner.capabilities).includes('pcb_rfq')) {
    return { allowed: false, reason: 'NO_PCB_TRACK', ...NOT_BLOCKED };
  }
  const [asChild, childCount] = await Promise.all([
    prisma.spPartnerRelation.count({ where: { childPartnerId: partner.id } }),
    prisma.spPartnerRelation.count({ where: { parentPartnerId: partner.id } }),
  ]);
  // 2단 제한 — 다른 마스터딜러의 하위는 하위를 둘 수 없다(구조 제약이라 강제로도 못 넘는다).
  if (asChild > 0) return { allowed: false, reason: 'PARENT_IS_CHILD', ...NOT_BLOCKED };
  if (childCount === 0) {
    const active = await loadActiveDirectPos(partner.id);
    if (active.count > 0) {
      return {
        allowed: false,
        reason: 'ACTIVE_POS',
        activePoCount: active.count,
        activePos: active.items,
        canForce: actingAdmin,
      };
    }
  }
  return { allowed: true, reason: null, ...NOT_BLOCKED };
};

/** 하위 협력사 메뉴 노출 근거 — 등록이 지금 막혀 있어도(ACTIVE_POS) 메뉴는 보여 안내한다. */
export const canManageChildren = async (
  partner: Pick<SpPartner, 'id' | 'type' | 'capabilities'>,
): Promise<boolean> => {
  if (partner.type !== 'partner' || !toCapabilities(partner.capabilities).includes('pcb_rfq')) {
    return false;
  }
  return (await prisma.spPartnerRelation.count({ where: { childPartnerId: partner.id } })) === 0;
};

interface ChildDocs {
  /** 이 조직이 수주한 PCB 견적·발주(상위 불문). */
  rfqs: (PairDoc & { parentPartnerId: bigint })[];
  pos: (PairDoc & { parentPartnerId: bigint })[];
  bomRfqCount: number;
}

const loadChildDocs = async (childIds: bigint[]): Promise<Map<string, ChildDocs>> => {
  const map = new Map<string, ChildDocs>();
  for (const id of childIds) map.set(id.toString(), { rfqs: [], pos: [], bomRfqCount: 0 });
  if (childIds.length === 0) return map;
  const docSelect = { partnerId: true, parentPartnerId: true, status: true, reorderRound: true } as const;
  const [rfqs, pos, bomRfqs] = await Promise.all([
    prisma.spPcbRfq.findMany({ where: { partnerId: { in: childIds } }, select: docSelect }),
    prisma.spPcbPo.findMany({ where: { partnerId: { in: childIds } }, select: docSelect }),
    prisma.spBomRfq.groupBy({
      by: ['partnerId'],
      where: { partnerId: { in: childIds } },
      _count: { _all: true },
    }),
  ]);
  for (const r of rfqs) map.get(r.partnerId.toString())?.rfqs.push(r);
  for (const p of pos) map.get(p.partnerId.toString())?.pos.push(p);
  for (const g of bomRfqs) {
    const docs = map.get(g.partnerId.toString());
    if (docs !== undefined) docs.bomRfqCount = g._count._all;
  }
  return map;
};

// 진행 중 건은 상위별로 따로 센다 — 같은 회차 번호라도 상위가 다르면 다른 문서다.
const activeDocCountOf = (docs: ChildDocs, parentId: bigint | null): number => {
  const parents = new Set<string>();
  for (const d of [...docs.rfqs, ...docs.pos]) parents.add(d.parentPartnerId.toString());
  let count = 0;
  for (const key of parents) {
    if (parentId !== null && key !== parentId.toString()) continue;
    count += activePairDocCount(
      docs.rfqs.filter((r) => r.parentPartnerId.toString() === key),
      docs.pos.filter((p) => p.parentPartnerId.toString() === key),
    );
  }
  return count;
};

const hasAnyDocs = (docs: ChildDocs): boolean =>
  docs.rfqs.length > 0 || docs.pos.length > 0 || docs.bomRfqCount > 0;

export const loadPartnerChildren = async (
  parent: Pick<SpPartner, 'id' | 'type' | 'capabilities'>,
  actingAdmin: boolean,
): Promise<PartnerChildListDataType> => {
  const [eligibility, relations] = await Promise.all([
    resolveChildEligibility(parent, actingAdmin),
    prisma.spPartnerRelation.findMany({
      where: { parentPartnerId: parent.id },
      include: {
        child: {
          include: {
            _count: { select: { members: true } },
            invites: { orderBy: { id: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  const docsMap = await loadChildDocs(relations.map((r) => r.childPartnerId));
  const now = Date.now();
  const items: PartnerChildItemType[] = relations.map((rel) => {
    const child = rel.child;
    const docs = docsMap.get(child.id.toString()) ?? { rfqs: [], pos: [], bomRfqCount: 0 };
    const invite = child.invites[0];
    return {
      partnerId: Number(child.id),
      name: child.name,
      country: child.country,
      status: asPartnerStatus(child.status),
      contactName: child.contactName,
      contactPhone: child.contactPhone,
      contactEmail: child.contactEmail,
      settlementCurrency: rel.settlementCurrency,
      owned: child.ownerPartnerId === parent.id,
      ownerSuspended: child.status === 'suspended' && child.ownerSuspendedAt !== null,
      activeCount: activeDocCountOf(docs, parent.id),
      hasHistory: hasAnyDocs(docs),
      hasPortalAccount: child._count.members > 0,
      invite:
        invite === undefined
          ? null
          : {
              email: invite.email,
              expiresAt: invite.expiresAt.toISOString(),
              pending: invite.acceptedAt === null && invite.expiresAt.getTime() > now,
            },
      createdAt: rel.createdAt.toISOString(),
    };
  });
  return { eligibility, items };
};

export type OwnedChildError = 'NOT_FOUND' | 'NOT_OWNED';

/** 내 하위이면서 내가 등록한 조직만 돌려준다 — 포털 수정·삭제·초대의 공통 인가. */
export const loadOwnedChild = async (
  parentId: bigint,
  childId: bigint,
): Promise<{ ok: true; child: SpPartner } | { ok: false; error: OwnedChildError }> => {
  const relation = await prisma.spPartnerRelation.findUnique({
    where: { parentPartnerId_childPartnerId: { parentPartnerId: parentId, childPartnerId: childId } },
    include: { child: true },
  });
  if (relation === null) return { ok: false, error: 'NOT_FOUND' };
  if (relation.child.ownerPartnerId !== parentId) return { ok: false, error: 'NOT_OWNED' };
  return { ok: true, child: relation.child };
};

export type RemoveChildResult =
  | { ok: true; outcome: 'deleted' | 'suspended' }
  | { ok: false; error: 'RELATION_ACTIVE' | 'SHARED_CHILD' };

/**
 * 하위 협력사 삭제 — 이력이 없으면 실제로 지우고, 있으면 사용 중지로 남긴다.
 * 문서 이력이 있는 조직은 지울 수 없으므로(FK RESTRICT) 삭제 버튼이 조용히 실패하는 대신
 * 같은 버튼이 '사용 중지'로 수렴한다. 중지 주체가 소유 조직임을 ownerSuspendedAt 으로 남겨,
 * 관리자가 정지한 조직을 마스터딜러가 되살리지 못하게 한다.
 */
export const removeOwnedChild = async (
  parentId: bigint,
  child: SpPartner,
  actorMbId: string,
): Promise<RemoveChildResult> => {
  const [docsMap, otherParents] = await Promise.all([
    loadChildDocs([child.id]),
    prisma.spPartnerRelation.count({
      where: { childPartnerId: child.id, NOT: { parentPartnerId: parentId } },
    }),
  ]);
  const docs = docsMap.get(child.id.toString()) ?? { rfqs: [], pos: [], bomRfqCount: 0 };
  // 상위 불문 진행 중 건이 하나라도 있으면 막는다 — 정지는 매직링크·포털을 함께 닫는다.
  if (activeDocCountOf(docs, null) > 0) return { ok: false, error: 'RELATION_ACTIVE' };
  // 관리자가 다른 마스터딜러에게도 연결해 둔 조직은 한쪽이 없앨 수 없다.
  if (otherParents > 0) return { ok: false, error: 'SHARED_CHILD' };

  if (!hasAnyDocs(docs)) {
    try {
      await prisma.spPartner.delete({ where: { id: child.id } });
      // 원장은 cascade 로 딸려 가지만 카탈로그 구매 조건에는 FK 가 없다(관리자 삭제와 같은 정리).
      await purgeOrphanPartnerOffers(child.id);
      return { ok: true, outcome: 'deleted' };
    } catch (e) {
      // 그 밖의 참조(FK)가 남아 있으면 사용 중지로 수렴한다.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003')) throw e;
    }
  }
  await prisma.spPartner.update({
    where: { id: child.id },
    data: {
      status: 'suspended',
      statusReason: '마스터딜러 사용 중지',
      ownerSuspendedAt: new Date(),
      decidedBy: actorMbId,
      decidedAt: new Date(),
    },
  });
  return { ok: true, outcome: 'suspended' };
};

// ── 포털 초대 ───────────────────────────────────────────────────────────────
// 토큰(64hex) 자체가 초대의 근거다(메일함 소유 = 신원 — 매직링크와 같은 신뢰 모델).
// 1회용이고 14일 뒤 닫힌다. 새 초대를 보내면 앞선 미수락 초대는 닫는다.

export const PARTNER_INVITE_TTL_DAYS = 14;

export const newPartnerInviteToken = (): string => randomBytes(32).toString('hex');

export const createPartnerInvite = async (
  partnerId: bigint,
  email: string,
  createdBy: string,
): Promise<string> => {
  const token = newPartnerInviteToken();
  const now = new Date();
  await prisma.$transaction([
    prisma.spPartnerInvite.updateMany({
      where: { partnerId, acceptedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    }),
    prisma.spPartnerInvite.create({
      data: {
        partnerId,
        token,
        email,
        createdBy,
        expiresAt: new Date(now.getTime() + PARTNER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    }),
  ]);
  return token;
};

export const partnerInviteStateOf = (
  invite: { acceptedAt: Date | null; expiresAt: Date },
  partnerStatus: string,
  now: Date = new Date(),
): PartnerInviteStateType => {
  if (invite.acceptedAt !== null) return 'accepted';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (partnerStatus !== 'approved') return 'unavailable';
  return 'valid';
};
