import type { SpBomPo, SpBomPoItem, SpPartner } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { BomPoExternalRef } from '@sp/api-contract';
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
import { digikeyThirdPartyList, mouserCartInsert } from './supplier-order';

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
  supplierSku: item.supplierSku,
  qty: item.qty,
  unitPrice: Number(item.unitPrice),
  lineTotal: item.lineTotal,
});

const toExternalRefView = (value: unknown): AdminBomPoViewType['externalRef'] => {
  const parsed = BomPoExternalRef.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const toAdminPoView = (po: PoWithItems & { partner: SpPartner }): AdminBomPoViewType => ({
  poId: Number(po.id),
  partnerId: Number(po.partnerId),
  partnerName: po.partner.name,
  supplierCode: po.partner.supplierCode,
  status: asBomPoStatus(po.status),
  totalAmount: po.totalAmount,
  currency: po.currency,
  memo: po.memo,
  externalRef: toExternalRefView(po.externalRef),
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

// ── 발주 대상 집계 ───────────────────────────────────────────────────────────
// included 행 중 ①협력사 회신 선정 행(selectedRfqItemId)과 ②공급사 오퍼 선정 행
// (selectedOffer.supplier 가 파트너 조직의 supplierCode 에 매핑 — D20)을 조직별로 그룹.
// 자사(house)는 발주 대상 아님, 매핑 안 되는 supplier(제조사 카탈로그 등)는 대상 외.
export interface PoDraftLine {
  quoteItemId: bigint;
  rfqItemId: bigint | null; // 협력사 발주만 보유
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  supplierSku: string | null; // 공급사 발주 실행용(D20)
  qty: number;
  unitPrice: number; // 선정 박제 단가(selectedOffer, VAT 별도·KRW 환산가)
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

  const activeRows = filterActiveQuoteItems(quote.items, quote.sheets).filter(
    (row) => row.included,
  );
  if (activeRows.length === 0) return groups;

  const rfqRows = activeRows.flatMap((row) =>
    row.selectedRfqItemId !== null ? [{ row, selectedRfqItemId: row.selectedRfqItemId }] : [],
  );
  const rfqItems =
    rfqRows.length === 0
      ? []
      : await prisma.spBomRfqItem.findMany({
          where: { id: { in: rfqRows.map((entry) => entry.selectedRfqItemId) } },
          include: { rfq: true },
        });
  const rfqItemById = new Map(rfqItems.map((item) => [item.id, item]));

  // 공급사 오퍼 선정 행의 supplier → 파트너 조직 매핑(supplierCode, house 제외 — D20).
  const supplierPartners = await prisma.spPartner.findMany({
    where: { supplierCode: { not: null }, type: 'supplier' },
    select: { id: true, supplierCode: true },
  });
  const partnerBySupplier = new Map(
    supplierPartners.flatMap((partner) =>
      partner.supplierCode === null ? [] : [[partner.supplierCode, partner.id] as const],
    ),
  );

  const push = (partnerId: bigint, line: PoDraftLine): void => {
    const list = groups.get(partnerId) ?? [];
    list.push(line);
    groups.set(partnerId, list);
  };

  for (const row of activeRows) {
    const qty = Math.max(1, row.orderQty);
    const dto = toItemDto(row);
    const offer = dto.selectedOffer;

    // ① 협력사 회신 선정 — 단가 정본 = 선정 시 박제된 selectedOffer(회신가).
    //    원장(rfqItem)은 재회신으로 바뀔 수 있어 근거 참조로만 쓴다(D18-6).
    if (row.selectedRfqItemId !== null) {
      const rfqItem = rfqItemById.get(row.selectedRfqItemId);
      if (rfqItem === undefined) continue; // 회신 원장이 지워진 잔재 — 발주 대상에서 제외
      const unitPrice = offer?.unitPrice ?? Number(rfqItem.unitPrice ?? 0);
      push(rfqItem.rfq.partnerId, {
        quoteItemId: row.id,
        rfqItemId: rfqItem.id,
        mpn: row.mpn,
        manufacturerName: row.manufacturerName,
        description: row.description,
        supplierSku: null,
        qty,
        unitPrice,
        lineTotal: Math.round(unitPrice * qty),
      });
      continue;
    }

    // ② 공급사 오퍼 선정(D20) — supplierCode 매핑 조직에만. 단가는 KRW 환산 박제
    //    (unitPriceKrw — 발주서 합계는 내부 관리용, 실결제는 공급사 사이트 통화).
    if (offer === null || (offer.offerKey ?? '').startsWith('rfq:')) continue;
    const partnerId = partnerBySupplier.get(offer.supplier);
    if (partnerId === undefined) continue; // 미매핑 supplier(제조사 카탈로그 등) — 대상 외
    const unitPrice = offer.unitPriceKrw ?? 0;
    push(partnerId, {
      quoteItemId: row.id,
      rfqItemId: null,
      mpn: row.mpn,
      manufacturerName: row.manufacturerName,
      description: row.description,
      supplierSku: offer.supplierSku === '' ? null : offer.supplierSku,
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty),
    });
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
          supplierSku: line.supplierSku,
          qty: line.qty,
          unitPrice: new Prisma.Decimal(line.unitPrice),
          lineTotal: line.lineTotal,
        })),
      });
    }
  });
  return { ok: true, partners };
};

// ── 외부공급사 실행(D20) — 카트/리스트까지, 실결제는 구매담당이 공급사 사이트에서 ──
// 발주서 생성과 분리: 실패해도 발주서는 유효하고 externalRef 에 실패를 박제, [재시도] 가능.
export const EXTERNAL_AUTOMATED_SUPPLIERS = ['mouser', 'digikey'] as const;

export type ExecuteExternalResult =
  | { ok: true }
  | { ok: false; error: 'PO_NOT_FOUND' | 'NOT_AUTOMATED' | 'NO_SKU_LINES' | 'EXECUTE_FAILED' };

export const executeExternalPo = async (poId: bigint): Promise<ExecuteExternalResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, items: { orderBy: { id: 'asc' } } },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const supplierCode = po.partner.supplierCode;
  if (
    supplierCode === null ||
    !(EXTERNAL_AUTOMATED_SUPPLIERS as readonly string[]).includes(supplierCode)
  ) {
    return { ok: false, error: 'NOT_AUTOMATED' };
  }

  const lines = po.items.flatMap((item) =>
    item.supplierSku === null || item.supplierSku === ''
      ? []
      : [{ sku: item.supplierSku, qty: item.qty }],
  );
  if (lines.length === 0) return { ok: false, error: 'NO_SKU_LINES' };

  const result =
    supplierCode === 'mouser' ? await mouserCartInsert(lines) : await digikeyThirdPartyList(lines);
  const skippedNoSku = po.items.length - lines.length;
  await prisma.spBomPo.update({
    where: { id: po.id },
    data: {
      externalRef: {
        state: result.ok ? 'ok' : 'failed',
        supplier: supplierCode,
        executedAt: new Date().toISOString(),
        ...(skippedNoSku > 0 ? { skippedNoSku } : {}),
        ...(result.ok
          ? result.supplier === 'mouser'
            ? {
                cartKey: result.cartKey,
                cartWebUrl: result.cartWebUrl,
                lineCount: result.lineCount,
                merchandiseTotal: result.merchandiseTotal,
                currencyCode: result.currencyCode,
                ...(result.errors.length > 0 ? { errors: result.errors } : {}),
              }
            : {
                listName: result.listName,
                singleUseUrl: result.singleUseUrl,
                lineCount: result.lineCount,
              }
          : { error: result.error }),
      },
    },
  });
  return result.ok ? { ok: true } : { ok: false, error: 'EXECUTE_FAILED' };
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
