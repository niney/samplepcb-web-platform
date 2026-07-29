import type { SpBomPo, SpBomPoItem, SpPartner } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type {
  AdminBomPoViewType,
  BomPoItemViewType,
  BomPoStatusType,
  PartnerPoDetailType,
  PartnerPoListItemType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { filterActiveQuoteItems, toItemDto } from './bom-quote';
import { getOrderInfoByCtId } from './g5-db';

// ── 협력사 발주 코어(D18, docs/SMARTBOM_PARTNER_RFQ.md §6.1) ────────────────
// 발주서 = 박제 문서: 생성 시점의 부품·수량·단가(선정 회신가 스냅샷)를 복사해
// 이후 견적 변경과 무관하게 불변(snapshot-freeze). 생성은 all-or-nothing(신중 액션).

export const asBomPoStatus = (v: string): BomPoStatusType =>
  v === 'confirmed' ? 'confirmed' : v === 'closed' ? 'closed' : 'issued';

type PoWithItems = SpBomPo & { items: SpBomPoItem[] };

const toItemView = (item: SpBomPoItem): BomPoItemViewType => ({
  poItemId: Number(item.id),
  quoteItemId: String(item.quoteItemId),
  mpn: item.mpn,
  manufacturerName: item.manufacturerName,
  description: item.description,
  qty: item.qty,
  unitPrice: Number(item.unitPrice),
  lineTotal: item.lineTotal,
});

export const toAdminPoView = (po: PoWithItems & { partner: SpPartner }): AdminBomPoViewType => ({
  poId: Number(po.id),
  partnerId: Number(po.partnerId),
  partnerName: po.partner.name,
  status: asBomPoStatus(po.status),
  totalAmount: po.totalAmount,
  currency: po.currency,
  memo: po.memo,
  itemCount: po.items.length,
  issuedAt: po.issuedAt.toISOString(),
  confirmedAt: po.confirmedAt?.toISOString() ?? null,
  closedAt: po.closedAt?.toISOString() ?? null,
  items: po.items.map(toItemView),
});

export const loadAdminPos = async (quoteId: bigint): Promise<AdminBomPoViewType[]> => {
  const pos = await prisma.spBomPo.findMany({
    where: { quoteId },
    include: { partner: true, items: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  return pos.map(toAdminPoView);
};

// ── 발주 대상 집계 — included 행 중 협력사 회신 선정 행을 협력사별로 그룹 ────
export interface PoDraftLine {
  quoteItemId: bigint;
  rfqItemId: bigint;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  qty: number;
  unitPrice: number; // 선정 박제 단가(selectedOffer — 회신가, VAT 별도)
  lineTotal: number;
}

export const collectPoDraftGroups = async (
  quoteId: bigint,
): Promise<Map<bigint, PoDraftLine[]>> => {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  const groups = new Map<bigint, PoDraftLine[]>();
  if (quote === null) return groups;

  const rows = filterActiveQuoteItems(quote.items, quote.sheets).flatMap((row) =>
    row.included && row.selectedRfqItemId !== null
      ? [{ row, selectedRfqItemId: row.selectedRfqItemId }]
      : [],
  );
  if (rows.length === 0) return groups;

  const rfqItems = await prisma.spBomRfqItem.findMany({
    where: { id: { in: rows.map((entry) => entry.selectedRfqItemId) } },
    include: { rfq: true },
  });
  const rfqItemById = new Map(rfqItems.map((item) => [item.id, item]));

  for (const { row, selectedRfqItemId } of rows) {
    const rfqItem = rfqItemById.get(selectedRfqItemId);
    if (rfqItem === undefined) continue; // 회신 원장이 지워진 잔재 — 발주 대상에서 제외
    // 단가 정본 = 선정 시 박제된 selectedOffer(회신가). 원장(rfqItem)은 재회신으로
    // 바뀔 수 있어 근거 참조로만 쓴다(D18-6).
    const dto = toItemDto(row);
    const unitPrice = dto.selectedOffer?.unitPrice ?? Number(rfqItem.unitPrice ?? 0);
    const qty = Math.max(1, row.orderQty);
    const line: PoDraftLine = {
      quoteItemId: row.id,
      rfqItemId: rfqItem.id,
      mpn: row.mpn,
      manufacturerName: row.manufacturerName,
      description: row.description,
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty),
    };
    const list = groups.get(rfqItem.rfq.partnerId) ?? [];
    list.push(line);
    groups.set(rfqItem.rfq.partnerId, list);
  }
  return groups;
};

// ── 발주서 생성 — 게이트(결제 확인) + all-or-nothing(tx) ─────────────────────
export type CreatePosResult =
  | { ok: true; partners: SpPartner[] }
  | {
      ok: false;
      error: 'QUOTE_NOT_FOUND' | 'NOT_PAID' | 'NO_ELIGIBLE_ROWS' | 'ALREADY_ISSUED';
      detail?: string;
    };

export const createBomPos = async (
  quoteId: bigint,
  partnerIds: readonly number[],
  memo: string | null,
): Promise<CreatePosResult> => {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId } });
  if (quote === null) return { ok: false, error: 'QUOTE_NOT_FOUND' };

  // D18-4 게이트 — 결제 확인(od isPaid) 후에만 발행.
  const orderInfo = quote.ctId === null ? null : await getOrderInfoByCtId(quote.ctId);
  if (!orderInfo?.isPaid) return { ok: false, error: 'NOT_PAID' };

  const groups = await collectPoDraftGroups(quoteId);
  const wanted = partnerIds.map((id) => BigInt(id));

  const missing = wanted.filter((id) => (groups.get(id) ?? []).length === 0);
  if (missing.length > 0) {
    return {
      ok: false,
      error: 'NO_ELIGIBLE_ROWS',
      detail: missing.map((id) => String(id)).join(','),
    };
  }
  const existing = await prisma.spBomPo.findMany({
    where: { quoteId, partnerId: { in: wanted } },
    select: { partnerId: true },
  });
  if (existing.length > 0) {
    return {
      ok: false,
      error: 'ALREADY_ISSUED',
      detail: existing.map((po) => String(po.partnerId)).join(','),
    };
  }

  const partners = await prisma.spPartner.findMany({ where: { id: { in: wanted } } });
  await prisma.$transaction(async (tx) => {
    for (const partnerId of wanted) {
      const lines = groups.get(partnerId) ?? [];
      const totalAmount = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const po = await tx.spBomPo.create({
        data: { quoteId, partnerId, status: 'issued', totalAmount, memo },
      });
      await tx.spBomPoItem.createMany({
        data: lines.map((line) => ({
          poId: po.id,
          quoteItemId: line.quoteItemId,
          rfqItemId: line.rfqItemId,
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          qty: line.qty,
          unitPrice: new Prisma.Decimal(line.unitPrice),
          lineTotal: line.lineTotal,
        })),
      });
    }
  });
  return { ok: true, partners };
};

// ── 협력사 포털 직렬화 ───────────────────────────────────────────────────────
export const toPartnerPoListItem = (
  po: PoWithItems & { quote: { title: string } },
): PartnerPoListItemType => ({
  poId: Number(po.id),
  quoteTitle: po.quote.title,
  status: asBomPoStatus(po.status),
  totalAmount: po.totalAmount,
  currency: po.currency,
  itemCount: po.items.length,
  issuedAt: po.issuedAt.toISOString(),
  confirmedAt: po.confirmedAt?.toISOString() ?? null,
});

export const toPartnerPoDetail = (
  po: PoWithItems & { quote: { title: string } },
): PartnerPoDetailType => ({
  poId: Number(po.id),
  quoteTitle: po.quote.title,
  status: asBomPoStatus(po.status),
  totalAmount: po.totalAmount,
  currency: po.currency,
  memo: po.memo,
  issuedAt: po.issuedAt.toISOString(),
  confirmedAt: po.confirmedAt?.toISOString() ?? null,
  items: po.items.map(toItemView),
});
