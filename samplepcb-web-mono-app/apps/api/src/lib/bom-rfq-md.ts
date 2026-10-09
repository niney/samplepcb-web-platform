import type { SpBomRfq } from '@prisma/client';
import type {
  BomRfqChildViewType,
  PartnerRfqChildCandidateType,
  PartnerRfqChildrenDataType,
} from '@sp/api-contract';
import { asBomPartnerCurrency } from './bom-fx';
import {
  diffSendRfqs,
  filterScopeForRfq,
  loadChildRfqViewsByParent,
  loadRfqScopeItems,
  parseRequestedItemIds,
  type PartnerRfqMdContext,
  type RfqDiffResult,
} from './bom-rfq';
import { toCapabilities } from './partner';
import { prisma } from './prisma';

// ── BOM 마스터딜러 중개(견적 단계) — docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개" ──
// 마스터딜러는 샘플피씨비가 직접 보낸 견적요청(parent=0)을 자기 하위 협력사에 재요청한다.
// 하위 재요청은 같은 견적에 parentPartnerId=마스터딜러로 서는 **같은 종류의 문서**라 회신·매직링크·
// 마감이 전부 기존 경로를 탄다. 여기는 그 위의 중개 규칙만 둔다: 누구에게 보낼 수 있나(내 하위),
// 무엇을 보낼 수 있나(내가 받은 범위 안), 몇 단까지인가(2단 — 하위는 다시 재요청하지 못한다).
// PCB 는 사양당 하위 하나를 고르지만 BOM 은 품목마다 다른 하위를 고를 수 있다(레거시 승계).

/** 재요청을 보낼 수 있는 내 하위 — 소속 연결 + 승인 + 부품 조달 트랙. */
export const loadMdChildCandidates = async (
  parentPartnerId: bigint,
): Promise<PartnerRfqChildCandidateType[]> => {
  const relations = await prisma.spPartnerRelation.findMany({
    where: { parentPartnerId },
    include: { child: { include: { _count: { select: { members: true } } } } },
    orderBy: { id: 'asc' },
  });
  return relations.flatMap((relation) => {
    const child = relation.child;
    if (
      child.type !== 'partner' ||
      child.status !== 'approved' ||
      !toCapabilities(child.capabilities).includes('bom_rfq')
    ) {
      return [];
    }
    return [
      {
        partnerId: Number(child.id),
        name: child.name,
        // 링크 통화 — 비어 있으면 USD(PCB 와 같은 기본값). 재요청을 만드는 순간 문서에 박제된다.
        currency: asBomPartnerCurrency(relation.settlementCurrency ?? 'USD'),
        contactEmail: child.contactEmail,
        hasPortalAccount: child._count.members > 0,
      },
    ];
  });
};

type RfqRef = Pick<SpBomRfq, 'quoteId' | 'partnerId' | 'parentPartnerId' | 'status'>;

const childViewsOf = async (rfq: RfqRef): Promise<BomRfqChildViewType[]> =>
  (await loadChildRfqViewsByParent(rfq.quoteId, rfq.partnerId)).get(rfq.partnerId.toString()) ?? [];

/** 누가 요청했나 — 마스터딜러가 보낸 재요청이면 그 조직명, 샘플피씨비 직접 요청이면 null. */
export const loadRfqRequesterName = async (
  rfq: Pick<SpBomRfq, 'parentPartnerId'>,
): Promise<string | null> => {
  if (rfq.parentPartnerId === 0n) return null;
  const parent = await prisma.spPartner.findUnique({
    where: { id: rfq.parentPartnerId },
    select: { name: true },
  });
  return parent?.name ?? null;
};

/** 포털 상세에 얹을 중개 맥락 — 하위가 볼 때는 발주처 이름, 마스터딜러가 볼 때는 하위 재요청. */
export const loadPartnerRfqMdContext = async (rfq: RfqRef): Promise<PartnerRfqMdContext> => {
  if (rfq.parentPartnerId !== 0n) {
    return { requesterName: await loadRfqRequesterName(rfq), children: [], canFanOut: false };
  }
  const [children, candidates] = await Promise.all([
    childViewsOf(rfq),
    loadMdChildCandidates(rfq.partnerId),
  ]);
  return {
    requesterName: null,
    children,
    // 이미 보낸 재요청이 있으면 하위가 그 뒤 정지돼도 화면은 열어 둔다(회신을 보고 고를 수 있게).
    canFanOut: rfq.status !== 'closed' && (candidates.length > 0 || children.length > 0),
  };
};

export const loadPartnerRfqChildrenData = async (
  rfq: RfqRef & Pick<SpBomRfq, 'currency'>,
): Promise<PartnerRfqChildrenDataType> => {
  const [rfqs, candidates] = await Promise.all([
    childViewsOf(rfq),
    loadMdChildCandidates(rfq.partnerId),
  ]);
  return { myCurrency: rfq.currency, candidates, rfqs };
};

/** 목록용 — 한 번에: 발주처 이름(하위로서 받은 건)·내가 보낸 재요청 수(마스터딜러로서 받은 건). */
export const loadPartnerRfqListContexts = async (
  partnerId: bigint,
  rfqs: readonly Pick<SpBomRfq, 'id' | 'quoteId' | 'parentPartnerId'>[],
): Promise<Map<string, { requesterName: string | null; childRfqCount: number; childRepliedCount: number }>> => {
  const parentIds = [...new Set(rfqs.flatMap((rfq) => (rfq.parentPartnerId === 0n ? [] : [rfq.parentPartnerId])))];
  const [parents, mine] = await Promise.all([
    parentIds.length === 0
      ? Promise.resolve([])
      : prisma.spPartner.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } }),
    prisma.spBomRfq.findMany({
      where: { parentPartnerId: partnerId, quoteId: { in: rfqs.map((rfq) => rfq.quoteId) } },
      select: { quoteId: true, status: true },
    }),
  ]);
  const parentName = new Map(parents.map((parent) => [parent.id.toString(), parent.name]));
  const map = new Map<string, { requesterName: string | null; childRfqCount: number; childRepliedCount: number }>();
  for (const rfq of rfqs) {
    const sent = rfq.parentPartnerId === 0n ? mine.filter((child) => child.quoteId === rfq.quoteId) : [];
    map.set(rfq.id.toString(), {
      requesterName:
        rfq.parentPartnerId === 0n ? null : (parentName.get(rfq.parentPartnerId.toString()) ?? null),
      childRfqCount: sent.length,
      childRepliedCount: sent.filter((child) => child.status === 'quoted').length,
    });
  }
  return map;
};

export type MdChildSendResult =
  | { ok: true; diff: RfqDiffResult; itemCount: number }
  | { ok: false; error: 'NOT_FAN_OUT' | 'RFQ_CLOSED' | 'NOT_MY_CHILD' | 'ITEM_OUT_OF_SCOPE' };

/**
 * 하위 재요청 diff 발송 — 관리자 발송과 같은 코어(diffSendRfqs)를 발주처만 바꿔 쓴다.
 * 범위는 내가 받은 범위의 부분집합만 허용한다: 마스터딜러가 받지 않은 품목을 하위가 볼 수는 없다.
 */
export const sendMdChildRfqs = async (
  rfq: SpBomRfq,
  partnerIds: readonly number[],
  requested: readonly string[] | null | undefined,
): Promise<MdChildSendResult> => {
  if (rfq.parentPartnerId !== 0n) return { ok: false, error: 'NOT_FAN_OUT' };
  if (rfq.status === 'closed') return { ok: false, error: 'RFQ_CLOSED' };
  const allowed = new Set((await loadMdChildCandidates(rfq.partnerId)).map((child) => child.partnerId));
  if (partnerIds.some((id) => !allowed.has(id))) return { ok: false, error: 'NOT_MY_CHILD' };

  const myScope = filterScopeForRfq(await loadRfqScopeItems(rfq.quoteId), rfq);
  const myIds = myScope.map((item) => String(item.id));
  const iGotAll = parseRequestedItemIds(rfq) === null;
  let childRequested: string[] | null;
  if (requested === null || requested === undefined) {
    // 생략 = 내가 받은 범위 그대로. 내가 일부만 받았으면 그 집합을 박제한다(null 은 "견적 전체"다).
    childRequested = iGotAll ? null : myIds;
  } else {
    const mine = new Set(myIds);
    if (requested.some((id) => !mine.has(id))) return { ok: false, error: 'ITEM_OUT_OF_SCOPE' };
    const unique = [...new Set(requested)];
    childRequested = iGotAll && unique.length === myIds.length ? null : unique;
  }
  const diff = await diffSendRfqs(rfq.quoteId, partnerIds, childRequested, rfq.partnerId);
  return { ok: true, diff, itemCount: childRequested === null ? myScope.length : childRequested.length };
};
