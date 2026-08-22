// ── 입고 스캔 원장(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) ─────────────────────────────
// 공급사 봉투 라벨(ECIA 2D)을 찍으면 (1) 파싱 → (2) 열린 공급사 발주 품목과 품번 대조 → (3) 원장 1행.
// 패킹 리스트(D24)는 전량 합계 일치가 저장 조건이라 부분 입고를 담지 못해 별도 원장으로 둔다.
// 매칭 안 된 스캔도 남긴다(무엇이 왔는지 추적) — 나중에 품목을 붙이거나 취소한다.
import type { Prisma } from '@prisma/client';
import type {
  BomReceivingCandidateType,
  BomReceivingParsedBarcodeType,
  BomReceivingPoProgressType,
  BomReceivingScanRecordType,
  BomPoStatusType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import {
  normalizePartKey,
  parseSupplierBarcode,
  type ParsedSupplierBarcode,
  type SupplierBarcodeFields,
  type SupplierBarcodeSupplier,
} from './supplier-barcode';

/** 후보 대조 입력 — 라벨 파싱 결과 또는 DigiKey 조회 결과(품번·MPN·공급사)만 있으면 된다. */
export interface ReceivingMatchInput {
  supplier: SupplierBarcodeSupplier;
  fields: Pick<SupplierBarcodeFields, 'supplierSku' | 'mpn'>;
}

/** 입고 완료된 선적에 묶인 발주서 제외(선적 없음 또는 receivedAt null). */
const NOT_RECEIVED_PO: Prisma.SpBomPoWhereInput = {
  OR: [{ shipmentLink: null }, { shipmentLink: { shipment: { receivedAt: null } } }],
};

/** 발주서 상태 — 마감(closed) 전까지 입고 대상. */
const OPEN_PO_STATUSES = ['issued', 'confirmed'] as const;

const asPoStatus = (value: string): BomPoStatusType =>
  value === 'confirmed' || value === 'closed' ? value : 'issued';

export const toParsedBarcodeView = (
  parsed: ParsedSupplierBarcode,
): BomReceivingParsedBarcodeType => ({
  format: parsed.format,
  supplier: parsed.supplier,
  identifiers: parsed.identifiers,
  fields: parsed.fields,
});

const scannedQtyByPoItem = async (poItemIds: readonly bigint[]): Promise<Map<string, number>> => {
  if (poItemIds.length === 0) return new Map();
  const rows = await prisma.spBomReceivingScan.groupBy({
    by: ['poItemId'],
    where: { poItemId: { in: [...poItemIds] }, voidedAt: null },
    _sum: { quantity: true },
  });
  return new Map(
    rows.flatMap((row) =>
      row.poItemId === null ? [] : [[row.poItemId.toString(), row._sum.quantity ?? 0]],
    ),
  );
};

const SCAN_INCLUDE = {
  poItem: {
    include: {
      po: { include: { partner: true, quote: { select: { title: true } } } },
    },
  },
} satisfies Prisma.SpBomReceivingScanInclude;

type ScanRow = Prisma.SpBomReceivingScanGetPayload<{ include: typeof SCAN_INCLUDE }>;

const toScanRecord = (row: ScanRow): BomReceivingScanRecordType => ({
  scanId: Number(row.id),
  poItemId: row.poItemId === null ? null : Number(row.poItemId),
  poId: row.poId === null ? null : Number(row.poId),
  quoteId: row.poItem === null ? null : String(row.poItem.po.quoteId),
  quoteTitle: row.poItem?.po.quote.title ?? null,
  partnerName: row.poItem?.po.partner.name ?? null,
  poItemMpn: row.poItem?.mpn ?? null,
  orderedQty: row.poItem?.qty ?? null,
  supplierCode: row.supplierCode,
  supplierSku: row.supplierSku,
  mpn: row.mpn,
  quantity: row.quantity,
  lotCode: row.lotCode,
  dateCode: row.dateCode,
  countryOfOrigin: row.countryOfOrigin,
  supplierOrderNo: row.supplierOrderNo,
  customerOrderNo: row.customerOrderNo,
  invoiceNo: row.invoiceNo,
  note: row.note,
  scannedBy: row.scannedBy,
  scannedAt: row.scannedAt.toISOString(),
  voidedAt: row.voidedAt?.toISOString() ?? null,
});

/** 라벨 품번으로 열린 공급사 발주 품목을 찾는다 — SKU 일치 우선, 없으면 MPN. 라벨이 공급사를
 *  말하면 그 공급사 발주로 좁히고, 한 건도 없을 때만 전체로 넓힌다(다른 공급사 라벨 오인 방지). */
export const findReceivingCandidates = async (
  parsed: ReceivingMatchInput,
): Promise<BomReceivingCandidateType[]> => {
  const skuKey = parsed.fields.supplierSku === null ? null : normalizePartKey(parsed.fields.supplierSku);
  const mpnKey = parsed.fields.mpn === null ? null : normalizePartKey(parsed.fields.mpn);
  if (skuKey === null && mpnKey === null) return [];
  // 후보 폭 = 열린 공급사 발주 품목(규모 작음) → 메모리에서 정규화 대조(공백·대소문자 차이 흡수).
  // 입고가 끝난 선적의 발주서(receivedAt)는 상태가 confirmed 여도 더 받을 것이 없으니 후보에서 뺀다.
  const items = await prisma.spBomPoItem.findMany({
    where: {
      po: { status: { in: [...OPEN_PO_STATUSES] }, partner: { supplierCode: { not: null } }, ...NOT_RECEIVED_PO },
    },
    include: { po: { include: { partner: true, quote: { select: { title: true } } } } },
    orderBy: { id: 'desc' },
    take: 5000,
  });
  const matched = items.flatMap((item) => {
    const bySku =
      skuKey !== null &&
      item.supplierSku !== null &&
      item.supplierSku !== '' &&
      normalizePartKey(item.supplierSku) === skuKey;
    const byMpn = mpnKey !== null && normalizePartKey(item.mpn) === mpnKey;
    if (!bySku && !byMpn) return [];
    return [{ item, matchedBy: bySku ? ('supplierSku' as const) : ('mpn' as const) }];
  });
  const sameSupplier =
    parsed.supplier === 'unknown'
      ? matched
      : matched.filter((entry) => entry.item.po.partner.supplierCode === parsed.supplier);
  const pool = sameSupplier.length > 0 ? sameSupplier : matched;
  const scanned = await scannedQtyByPoItem(pool.map((entry) => entry.item.id));
  return pool
    .map(({ item, matchedBy }) => ({
      poItemId: Number(item.id),
      poId: Number(item.poId),
      quoteId: String(item.po.quoteId),
      quoteTitle: item.po.quote.title,
      partnerName: item.po.partner.name,
      supplierCode: item.po.partner.supplierCode,
      poStatus: asPoStatus(item.po.status),
      mpn: item.mpn,
      supplierSku: item.supplierSku,
      orderedQty: item.qty,
      scannedQty: scanned.get(item.id.toString()) ?? 0,
      matchedBy,
      issuedAt: item.po.issuedAt.toISOString(),
    }))
    .sort((a, b) =>
      a.matchedBy !== b.matchedBy
        ? a.matchedBy === 'supplierSku'
          ? -1
          : 1
        : b.poId - a.poId,
    );
};

/** 발주서별 스캔 누적/발주 수량 — 공급사 발주서(supplierCode 보유)만 돌려준다(워크큐 배지용). */
export const loadReceivingTotalsByPo = async (
  poIds: readonly bigint[],
): Promise<Map<string, { scannedQty: number; orderedQty: number }>> => {
  if (poIds.length === 0) return new Map();
  const pos = await prisma.spBomPo.findMany({
    where: { id: { in: [...poIds] }, partner: { supplierCode: { not: null } } },
    select: { id: true, items: { select: { qty: true } } },
  });
  if (pos.length === 0) return new Map();
  const scanned = await prisma.spBomReceivingScan.groupBy({
    by: ['poId'],
    where: { poId: { in: pos.map((po) => po.id) }, voidedAt: null },
    _sum: { quantity: true },
  });
  const scannedByPo = new Map(
    scanned.flatMap((row) => (row.poId === null ? [] : [[row.poId.toString(), row._sum.quantity ?? 0]])),
  );
  return new Map(
    pos.map((po) => [
      po.id.toString(),
      {
        scannedQty: scannedByPo.get(po.id.toString()) ?? 0,
        orderedQty: po.items.reduce((sum, item) => sum + item.qty, 0),
      },
    ]),
  );
};

export const loadReceivingProgress = async (
  poId: bigint,
): Promise<BomReceivingPoProgressType | null> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: {
      partner: true,
      quote: { select: { title: true } },
      items: { orderBy: { id: 'asc' } },
    },
  });
  if (po === null) return null;
  const rows = await prisma.spBomReceivingScan.groupBy({
    by: ['poItemId'],
    where: { poItemId: { in: po.items.map((item) => item.id) }, voidedAt: null },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  const byItem = new Map(
    rows.flatMap((row) =>
      row.poItemId === null
        ? []
        : [[row.poItemId.toString(), { qty: row._sum.quantity ?? 0, count: row._count._all }]],
    ),
  );
  const items = po.items.map((item) => {
    const agg = byItem.get(item.id.toString());
    return {
      poItemId: Number(item.id),
      mpn: item.mpn,
      supplierSku: item.supplierSku,
      orderedQty: item.qty,
      scannedQty: agg?.qty ?? 0,
      scanCount: agg?.count ?? 0,
    };
  });
  return {
    poId: Number(po.id),
    quoteId: String(po.quoteId),
    quoteTitle: po.quote.title,
    partnerName: po.partner.name,
    supplierCode: po.partner.supplierCode,
    poStatus: asPoStatus(po.status),
    items,
    orderedTotal: items.reduce((sum, item) => sum + item.orderedQty, 0),
    scannedTotal: items.reduce((sum, item) => sum + item.scannedQty, 0),
    complete: items.length > 0 && items.every((item) => item.scannedQty >= item.orderedQty),
    overReceived: items.some((item) => item.scannedQty > item.orderedQty),
  };
};

export type RecordReceivingError =
  | 'PO_ITEM_NOT_FOUND'
  | 'PO_CLOSED'
  | 'NOT_SUPPLIER_PO'
  | 'QUANTITY_REQUIRED';

export type RecordReceivingResult =
  | {
      ok: true;
      data: { scan: BomReceivingScanRecordType; progress: BomReceivingPoProgressType | null };
    }
  | { ok: false; error: RecordReceivingError };

/** 스캔 1건 박제 — 라벨 필드는 그대로, 수량은 수기 > 라벨 Q. poItemId 가 있으면 열린 공급사 PO 여야 한다. */
export type ReceivingOverrideTextKey =
  | 'supplierSku'
  | 'mpn'
  | 'lotCode'
  | 'dateCode'
  | 'countryOfOrigin'
  | 'supplierOrderNo'
  | 'invoiceNo';
/** 라벨 값 위에 덮어쓸 필드 — undefined 는 "건드리지 않음", null 은 "비움". */
export type ReceivingFieldOverride = Partial<Record<ReceivingOverrideTextKey, string | null | undefined>> & {
  supplierCode?: SupplierBarcodeSupplier | null | undefined;
};

export const recordReceivingScan = async (input: {
  barcode: string;
  poItemId: bigint | null;
  quantity: number | null;
  note: string | null;
  scannedBy: string;
  override?: ReceivingFieldOverride | null;
}): Promise<RecordReceivingResult> => {
  const parsed = parseSupplierBarcode(input.barcode);
  const quantity = input.quantity ?? parsed?.fields.quantity ?? null;
  if (quantity === null) return { ok: false, error: 'QUANTITY_REQUIRED' };
  let poId: bigint | null = null;
  if (input.poItemId !== null) {
    const item = await prisma.spBomPoItem.findUnique({
      where: { id: input.poItemId },
      include: { po: { include: { partner: true, shipmentLink: { include: { shipment: { select: { receivedAt: true } } } } } } },
    });
    if (item === null) return { ok: false, error: 'PO_ITEM_NOT_FOUND' };
    if (item.po.partner.supplierCode === null) return { ok: false, error: 'NOT_SUPPLIER_PO' };
    if (
      !(OPEN_PO_STATUSES as readonly string[]).includes(item.po.status) ||
      item.po.shipmentLink?.shipment.receivedAt != null
    ) {
      return { ok: false, error: 'PO_CLOSED' };
    }
    poId = item.poId;
  }
  const fields = parsed?.fields;
  const over = input.override ?? {};
  const pickOver = (key: ReceivingOverrideTextKey, fallback: string | null): string | null => {
    const value = over[key];
    if (value === undefined) return fallback;
    return value;
  };
  const labelSupplier = parsed === null || parsed.supplier === 'unknown' ? null : parsed.supplier;
  const supplierCode =
    over.supplierCode === undefined
      ? labelSupplier
      : over.supplierCode === 'unknown'
        ? null
        : over.supplierCode;
  const created = await prisma.spBomReceivingScan.create({
    data: {
      poItemId: input.poItemId,
      poId,
      supplierCode,
      barcode: parsed?.normalized ?? input.barcode,
      supplierSku: pickOver('supplierSku', fields?.supplierSku ?? null),
      mpn: pickOver('mpn', fields?.mpn ?? null),
      quantity,
      lotCode: pickOver('lotCode', fields?.lotCode ?? null),
      dateCode: pickOver('dateCode', fields?.dateCode ?? null),
      countryOfOrigin: pickOver('countryOfOrigin', fields?.countryOfOrigin ?? null),
      supplierOrderNo: pickOver('supplierOrderNo', fields?.supplierOrderNo ?? null),
      customerOrderNo: fields?.customerOrderNo ?? null,
      invoiceNo: pickOver('invoiceNo', fields?.invoiceNo ?? null),
      note: input.note,
      scannedBy: input.scannedBy,
    },
    include: SCAN_INCLUDE,
  });
  return {
    ok: true,
    data: {
      scan: toScanRecord(created),
      progress: poId === null ? null : await loadReceivingProgress(poId),
    },
  };
};

export type VoidReceivingResult =
  | {
      ok: true;
      data: { scan: BomReceivingScanRecordType; progress: BomReceivingPoProgressType | null };
    }
  | { ok: false; error: 'SCAN_NOT_FOUND' | 'ALREADY_VOIDED' };

/** 잘못 찍은 스캔 취소 — 삭제 대신 voidedAt(원장은 남긴다). */
export const voidReceivingScan = async (scanId: bigint): Promise<VoidReceivingResult> => {
  const row = await prisma.spBomReceivingScan.findUnique({ where: { id: scanId } });
  if (row === null) return { ok: false, error: 'SCAN_NOT_FOUND' };
  if (row.voidedAt !== null) return { ok: false, error: 'ALREADY_VOIDED' };
  const updated = await prisma.spBomReceivingScan.update({
    where: { id: scanId },
    data: { voidedAt: new Date() },
    include: SCAN_INCLUDE,
  });
  return {
    ok: true,
    data: {
      scan: toScanRecord(updated),
      progress: updated.poId === null ? null : await loadReceivingProgress(updated.poId),
    },
  };
};

export const loadRecentReceivingScans = async (query: {
  limit: number;
  poId?: bigint;
  includeVoided: boolean;
}): Promise<BomReceivingScanRecordType[]> => {
  const rows = await prisma.spBomReceivingScan.findMany({
    where: {
      ...(query.poId === undefined ? {} : { poId: query.poId }),
      ...(query.includeVoided ? {} : { voidedAt: null }),
    },
    include: SCAN_INCLUDE,
    orderBy: { id: 'desc' },
    take: query.limit,
  });
  return rows.map(toScanRecord);
};
