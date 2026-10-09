import { Prisma } from '@prisma/client';
import type { SpBomMdPo, SpBomMdPoItem, SpBomPo, SpBomPoItem, SpPartner } from '@prisma/client';
import {
  bomMdPoActionsFor,
  bomMdPoPreviousStatus,
  type BomMdPoActionType,
  type BomMdPoItemViewType,
  type BomMdPoPlanGroupType,
  type BomMdPoStatusType,
  type BomMdPoViewType,
  type BomMdPoViewerRoleType,
  type PartnerPoChildPosDataType,
} from '@sp/api-contract';
import { asBomPartnerCurrency, roundBomAmount } from './bom-fx';
import { prisma } from './prisma';

// ── BOM 마스터딜러 하위 발주(D47) — docs/SMARTBOM_PARTNER_RFQ.md §6.43 ────────
// 마스터딜러가 샘플피씨비에게서 받은 발주서의 품목 가운데 하위 회신으로 견적한 것을 그 하위에
// 다시 발주한다. 무엇을 누구에게 얼마에 맡길지는 **견적 때 이미 정해졌다** — 마스터딜러가 품목마다
// 고른 하위(selectedChildRfqId)와 그때 굳힌 하위 회신가(sourceUnitPrice). 여기서는 그 계획을
// 상위 발주 수량으로 문서화할 뿐 새로 흥정하지 않는다.
// 하위는 계정이 없는 경우가 많다 — 확인·출고는 발주처(마스터딜러)가 대신 처리할 수 있다.

export const asBomMdPoStatus = (v: string): BomMdPoStatusType =>
  v === 'confirmed' ? 'confirmed' : v === 'shipped' ? 'shipped' : v === 'received' ? 'received' : 'issued';

type PartnerWithMembers = SpPartner & { _count: { members: number } };
type MdPoRow = SpBomMdPo & {
  items: SpBomMdPoItem[];
  partner: PartnerWithMembers;
  parent: Pick<SpPartner, 'name'>;
  po: { quote: { title: string } };
};

export const MD_PO_INCLUDE = {
  items: { orderBy: { id: 'asc' } },
  partner: { include: { _count: { select: { members: true } } } },
  parent: { select: { name: true } },
  po: { select: { quote: { select: { title: true } } } },
} as const satisfies Prisma.SpBomMdPoInclude;

const toItemView = (item: SpBomMdPoItem): BomMdPoItemViewType => ({
  itemId: Number(item.id),
  poItemId: Number(item.poItemId),
  quoteItemId: String(item.quoteItemId),
  mpn: item.mpn,
  manufacturerName: item.manufacturerName,
  description: item.description,
  qty: item.qty,
  unitPrice: Number(item.unitPrice),
  lineTotal: Number(item.lineTotal),
  moq: item.moq,
  stock: item.stock,
  dateCode: item.dateCode,
  leadTime: item.leadTime,
});

export const toMdPoView = (row: MdPoRow): BomMdPoViewType => ({
  mdPoId: Number(row.id),
  poId: Number(row.poId),
  quoteTitle: row.po.quote.title,
  parentPartnerId: Number(row.parentPartnerId),
  parentPartnerName: row.parent.name,
  partnerId: Number(row.partnerId),
  partnerName: row.partner.name,
  hasPortalAccount: row.partner._count.members > 0,
  status: asBomMdPoStatus(row.status),
  currency: row.currency,
  totalAmount: Number(row.totalAmount),
  memo: row.memo,
  carrier: row.carrier,
  trackingNo: row.trackingNo,
  issuedAt: row.issuedAt.toISOString(),
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  shippedAt: row.shippedAt?.toISOString() ?? null,
  receivedAt: row.receivedAt?.toISOString() ?? null,
  items: row.items.map(toItemView),
});

/** 한 견적의 하위 발주 전부 — 상위 발주서 id 별(관리자 Case 열람용). */
export const loadMdPoViewsByPo = async (
  where: Prisma.SpBomMdPoWhereInput,
): Promise<Map<string, BomMdPoViewType[]>> => {
  const map = new Map<string, BomMdPoViewType[]>();
  const rows = await prisma.spBomMdPo.findMany({ where, include: MD_PO_INCLUDE, orderBy: { id: 'asc' } });
  for (const row of rows) {
    const key = row.poId.toString();
    map.set(key, [...(map.get(key) ?? []), toMdPoView(row)]);
  }
  return map;
};

type PlanItem = BomMdPoPlanGroupType['items'][number];
interface PlanGroup {
  partner: PartnerWithMembers;
  currency: string;
  items: PlanItem[];
}

/**
 * 발주 계획 — 상위 발주 품목을 "견적 때 고른 하위"별로 묶는다.
 * 근거는 상위 발주 품목의 회신 행(rfqItemId): 마스터딜러가 하위를 골라 만든 행이면
 * selectedChildRfqId·sourceUnitPrice·sourceCurrency 가 남아 있다. 직접 회신 품목은 묶음에 없다.
 */
const buildPlanGroups = async (
  po: Pick<SpBomPo, 'quoteId' | 'partnerId'> & { items: SpBomPoItem[] },
): Promise<{ groups: PlanGroup[]; directItemCount: number }> => {
  const rfqItemIds = po.items.flatMap((item) => (item.rfqItemId === null ? [] : [item.rfqItemId]));
  const rfqItems =
    rfqItemIds.length === 0
      ? []
      : await prisma.spBomRfqItem.findMany({
          where: { id: { in: rfqItemIds }, selectedChildRfqId: { not: null } },
        });
  const childRfqIds = [...new Set(rfqItems.flatMap((row) => (row.selectedChildRfqId === null ? [] : [row.selectedChildRfqId])))];
  const childRfqs =
    childRfqIds.length === 0
      ? []
      : await prisma.spBomRfq.findMany({
          // 내가 보낸 재요청만 — 같은 견적, 발주처가 이 발주서의 협력사(마스터딜러).
          where: { id: { in: childRfqIds }, quoteId: po.quoteId, parentPartnerId: po.partnerId },
          include: {
            items: true,
            partner: { include: { _count: { select: { members: true } } } },
          },
        });
  const rfqItemById = new Map(rfqItems.map((row) => [row.id, row]));
  const childRfqById = new Map(childRfqs.map((row) => [row.id, row]));

  const groups = new Map<string, PlanGroup>();
  let directItemCount = 0;
  for (const item of po.items) {
    const source = item.rfqItemId === null ? undefined : rfqItemById.get(item.rfqItemId);
    const childRfq =
      source?.selectedChildRfqId == null ? undefined : childRfqById.get(source.selectedChildRfqId);
    if (source === undefined || childRfq === undefined || source.sourceUnitPrice === null) {
      directItemCount += 1;
      continue;
    }
    const currency = asBomPartnerCurrency(source.sourceCurrency ?? childRfq.currency);
    const unitPrice = Number(source.sourceUnitPrice);
    // 납기·재고 같은 부가 정보는 하위의 지금 회신에서 가져온다(단가는 굳힌 값).
    const reply = childRfq.items.find((entry) => entry.quoteItemId === item.quoteItemId);
    const key = childRfq.partnerId.toString();
    const group = groups.get(key) ?? { partner: childRfq.partner, currency, items: [] };
    group.items.push({
      poItemId: Number(item.id),
      quoteItemId: String(item.quoteItemId),
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      qty: item.qty,
      unitPrice,
      lineTotal: roundBomAmount(unitPrice * item.qty, currency),
      moq: reply?.moq ?? null,
      stock: reply?.stock ?? null,
      dateCode: reply?.dateCode ?? null,
      leadTime: reply?.leadTime ?? null,
    });
    groups.set(key, group);
  }
  return { groups: [...groups.values()], directItemCount };
};

const groupTotal = (group: PlanGroup): number =>
  roundBomAmount(
    group.items.reduce((sum, item) => sum + item.lineTotal, 0),
    group.currency,
  );

type PoForPlan = SpBomPo & { items: SpBomPoItem[] };

/** 이 발주서에 하위 회신으로 견적한 품목이 있는가 — 포털이 하위 발주 영역을 띄울지 가른다. */
export const poHasChildItems = async (po: PoForPlan): Promise<boolean> =>
  (await buildPlanGroups(po)).groups.length > 0;

export const loadMdPoPlan = async (po: PoForPlan): Promise<PartnerPoChildPosDataType> => {
  const [{ groups, directItemCount }, issued] = await Promise.all([
    buildPlanGroups(po),
    loadMdPoViewsByPo({ poId: po.id }),
  ]);
  const mdPos = issued.get(po.id.toString()) ?? [];
  return {
    canIssue: po.status !== 'closed',
    directItemCount,
    groups: groups.map((group): BomMdPoPlanGroupType => ({
      partnerId: Number(group.partner.id),
      partnerName: group.partner.name,
      currency: group.currency,
      hasPortalAccount: group.partner._count.members > 0,
      contactEmail: group.partner.contactEmail,
      totalAmount: groupTotal(group),
      items: group.items,
      mdPo: mdPos.find((entry) => entry.partnerId === Number(group.partner.id)) ?? null,
    })),
  };
};

export type IssueMdPosResult =
  | { ok: true; created: MdPoRow[] }
  | { ok: false; error: 'PO_CLOSED' | 'NO_CHILD_ITEMS' | 'ALREADY_ISSUED'; detail?: string };

/**
 * 하위 발주 발행 — 고른 하위마다 한 건. 품목·수량은 상위 발주서 박제를, 단가는 견적 때 굳힌 하위
 * 회신가를 그대로 옮긴다. 이미 보낸 하위는 다시 보내지 않는다(삭제 뒤 재발행).
 */
export const issueMdChildPos = async (
  po: PoForPlan,
  partnerIds: readonly number[],
  memo: string | null,
  actorMbId: string,
): Promise<IssueMdPosResult> => {
  if (po.status === 'closed') return { ok: false, error: 'PO_CLOSED' };
  const { groups } = await buildPlanGroups(po);
  const wanted = [...new Set(partnerIds)];
  const picked: PlanGroup[] = [];
  for (const partnerId of wanted) {
    const group = groups.find((entry) => Number(entry.partner.id) === partnerId);
    if (group === undefined) return { ok: false, error: 'NO_CHILD_ITEMS', detail: String(partnerId) };
    picked.push(group);
  }
  try {
    const ids = await prisma.$transaction(async (tx) => {
      const created: bigint[] = [];
      for (const group of picked) {
        const row = await tx.spBomMdPo.create({
          data: {
            poId: po.id,
            quoteId: po.quoteId,
            parentPartnerId: po.partnerId,
            partnerId: group.partner.id,
            status: 'issued',
            currency: group.currency,
            totalAmount: new Prisma.Decimal(groupTotal(group)),
            memo,
            issuedBy: actorMbId,
            items: {
              create: group.items.map((item) => ({
                poItemId: BigInt(item.poItemId),
                quoteItemId: BigInt(item.quoteItemId),
                mpn: item.mpn,
                manufacturerName: item.manufacturerName,
                description: item.description,
                qty: item.qty,
                unitPrice: new Prisma.Decimal(item.unitPrice),
                lineTotal: new Prisma.Decimal(item.lineTotal),
                moq: item.moq,
                stock: item.stock,
                dateCode: item.dateCode,
                leadTime: item.leadTime,
              })),
            },
          },
        });
        created.push(row.id);
      }
      return created;
    });
    const created = await prisma.spBomMdPo.findMany({
      where: { id: { in: ids } },
      include: MD_PO_INCLUDE,
      orderBy: { id: 'asc' },
    });
    return { ok: true, created };
  } catch (error) {
    // (poId, partnerId)·(poItemId) 유니크 — 동시에 두 번 눌렀거나 이미 보낸 하위다.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'ALREADY_ISSUED' };
    }
    throw error;
  }
};

// ── 진행 — 보냄 → 하위 확인 → 하위 출고 → 마스터딜러 수령 ─────────────────────
// 누가 무엇을 누를 수 있는지는 계약의 bomMdPoActionsFor 가 정한다(화면 버튼과 같은 판정).
const NEXT_STATUS: Record<Exclude<BomMdPoActionType, 'revert'>, BomMdPoStatusType> = {
  confirm: 'confirmed',
  ship: 'shipped',
  receive: 'received',
};

export type AdvanceMdPoResult = { ok: true } | { ok: false; error: 'INVALID_ACTION' };

export const advanceMdPo = async (
  row: Pick<SpBomMdPo, 'id' | 'status'>,
  role: BomMdPoViewerRoleType,
  action: BomMdPoActionType,
  fields: { carrier?: string | null | undefined; trackingNo?: string | null | undefined },
): Promise<AdvanceMdPoResult> => {
  const status = asBomMdPoStatus(row.status);
  if (!bomMdPoActionsFor(status, role).includes(action)) return { ok: false, error: 'INVALID_ACTION' };
  const now = new Date();
  let data: Prisma.SpBomMdPoUpdateManyMutationInput;
  if (action === 'revert') {
    const to = bomMdPoPreviousStatus(status);
    if (to === undefined) return { ok: false, error: 'INVALID_ACTION' };
    data = {
      status: to,
      ...(status === 'confirmed' ? { confirmedAt: null } : {}),
      ...(status === 'shipped' ? { shippedAt: null, carrier: null, trackingNo: null } : {}),
      ...(status === 'received' ? { receivedAt: null } : {}),
    };
  } else {
    data = {
      status: NEXT_STATUS[action],
      ...(action === 'confirm' ? { confirmedAt: now } : {}),
      ...(action === 'ship'
        ? { shippedAt: now, carrier: fields.carrier ?? null, trackingNo: fields.trackingNo ?? null }
        : {}),
      ...(action === 'receive' ? { receivedAt: now } : {}),
    };
  }
  // 상태를 조건에 걸어 동시 조작을 직렬화한다 — 둘이 같이 누르면 하나만 통한다.
  const updated = await prisma.spBomMdPo.updateMany({ where: { id: row.id, status }, data });
  return updated.count === 1 ? { ok: true } : { ok: false, error: 'INVALID_ACTION' };
};
