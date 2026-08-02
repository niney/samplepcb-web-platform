import type {
  SpBomPo,
  SpBomPoItem,
  SpBomShipment,
  SpBomShipmentPo,
  SpFile,
  SpPartner,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  BOM_SHIPMENT_DOMESTIC_STATUSES,
  BOM_SHIPMENT_INTL_STATUSES,
  BomPoExternalRef,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentPrevStatus,
} from '@sp/api-contract';
import type {
  AdminBomPoCrossItemType,
  AdminBomPoViewType,
  AdminBomShipmentCrossItemType,
  AdminBomShipmentUpsertBodyType,
  BomPoItemViewType,
  BomPoStatusType,
  BomShipmentFileMetaType,
  BomShipmentFileTypeType,
  BomShipmentGroupPoType,
  BomShipmentModeType,
  BomShipmentStatusType,
  BomShipmentViewType,
  PartnerPoDetailType,
  PartnerPoListItemType,
  PartnerShipmentAdvanceBodyType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { filterActiveQuoteItems, toItemDto } from './bom-quote';
import { getBusinessInfo, getOrderInfoByCtId } from './g5-db';
import { buildPartnerQuotationDocument } from './bom-trade-documents';
import { digikeyThirdPartyList, mouserCartInsert } from './supplier-order';
import {
  deleteFromFileServer,
  downloadFromFileServer,
  uploadToFileServer,
  type UploadTarget,
} from './file-server';
import {
  finalizeShipmentPackingList,
  reopenShipmentPackingList,
  receiveAllShipmentPackagesInTransaction,
  shipmentPackingListIsComplete,
  voidShipmentPackagesForPo,
} from './bom-packing';
import type { BomPackingActor } from './bom-packing';
import {
  shipmentModeDiffersFromCountry,
  shipmentModeFromCountry,
} from './bom-shipment-policy';

// ── 협력사 발주 코어(D18, docs/SMARTBOM_PARTNER_RFQ.md §6.1) ────────────────
// 발주서 = 박제 문서: 생성 시점의 부품·수량·단가(선정 회신가 스냅샷)를 복사해
// 이후 견적 변경과 무관하게 불변(snapshot-freeze). 생성은 all-or-nothing(신중 액션).

export const asBomPoStatus = (v: string): BomPoStatusType =>
  v === 'confirmed' ? 'confirmed' : v === 'closed' ? 'closed' : 'issued';

// §6.10 이후 선적 소속의 진실은 shipmentLink(조인) — po.shipment(대표 관계)는 쓰지 않는다.
type ShipmentLink = SpBomShipmentPo & { shipment: SpBomShipment };
type PoWithItems = SpBomPo & { items: SpBomPoItem[]; shipmentLink?: ShipmentLink | null };
const linkedShipment = (po: { shipmentLink?: ShipmentLink | null }): SpBomShipment | null =>
  po.shipmentLink?.shipment ?? null;

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

export const asShipmentMode = (v: string): BomShipmentModeType =>
  v === 'domestic' ? 'domestic' : 'international';

const shipmentStatusesFor = (mode: BomShipmentModeType): readonly BomShipmentStatusType[] =>
  mode === 'domestic' ? BOM_SHIPMENT_DOMESTIC_STATUSES : BOM_SHIPMENT_INTL_STATUSES;

export const asShipmentStatus = (mode: BomShipmentModeType, v: string): BomShipmentStatusType => {
  const allowed = shipmentStatusesFor(mode);
  return (allowed as readonly string[]).includes(v) ? (v as BomShipmentStatusType) : 'preparing';
};

// ── 선적 첨부(D22) — sp_file 폴리모픽(refType 'sp_bom_shipment'), 종류별 1건 ──
const SHIPMENT_FILE_REF_TYPE = 'sp_bom_shipment';
const SHIPMENT_FILE_SERVICE_TYPE = process.env.BOM_SHIPMENT_FILE_SERVICE_TYPE ?? 'bom_shipment';

const toShipmentFileMeta = (f: SpFile): BomShipmentFileMetaType | null => {
  if (f.fileType !== 'invoice' && f.fileType !== 'airwaybill') return null;
  return {
    fileId: Number(f.id),
    fileType: f.fileType,
    name: f.originFileName,
    size: Number(f.size),
    uploadedBy: f.uploadedBy === 'ADMIN' || f.uploadedBy === 'PARTNER' ? f.uploadedBy : null,
  };
};

export const loadShipmentFilesMap = async (
  shipmentIds: bigint[],
): Promise<Map<string, BomShipmentFileMetaType[]>> => {
  const map = new Map<string, BomShipmentFileMetaType[]>();
  if (shipmentIds.length === 0) return map;
  const rows = await prisma.spFile.findMany({
    where: { refType: SHIPMENT_FILE_REF_TYPE, refId: { in: shipmentIds } },
    orderBy: { id: 'asc' },
  });
  for (const row of rows) {
    const meta = toShipmentFileMeta(row);
    if (meta === null) continue;
    const key = row.refId.toString();
    map.set(key, [...(map.get(key) ?? []), meta]);
  }
  return map;
};

export const toShipmentView = (
  shipment: SpBomShipment,
  files: BomShipmentFileMetaType[] = [],
  groupPos: BomShipmentGroupPoType[] = [],
): BomShipmentViewType => {
  const mode = asShipmentMode(shipment.mode);
  return {
    shipmentId: Number(shipment.id),
    mode,
    status: asShipmentStatus(mode, shipment.status),
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    shipDate: shipment.shipDate?.toISOString().slice(0, 10) ?? null,
    shippedAt: shipment.shippedAt?.toISOString() ?? null,
    receivedAt: shipment.receivedAt?.toISOString() ?? null,
    receivedNote: shipment.receivedNote,
    completedAt: shipment.completedAt?.toISOString() ?? null,
    // Invoice/AWB는 국제 전용이다. 과거 국내 첨부는 삭제하지 않되 현재 업무 UI에는 내리지 않는다.
    files: mode === 'international' ? files : [],
    groupPos,
  };
};

/** 묶음 소속 배치 로드(§6.10) — Map<shipmentId, 소속 발주서(대표 표시 포함)>. */
export const loadShipmentGroupMap = async (
  shipmentIds: bigint[],
): Promise<Map<string, BomShipmentGroupPoType[]>> => {
  const map = new Map<string, BomShipmentGroupPoType[]>();
  if (shipmentIds.length === 0) return map;
  const links = await prisma.spBomShipmentPo.findMany({
    where: { shipmentId: { in: shipmentIds } },
    include: {
      shipment: { select: { poId: true } },
      po: { select: { id: true, totalAmount: true, quote: { select: { title: true } } } },
    },
    orderBy: { id: 'asc' },
  });
  for (const link of links) {
    const key = link.shipmentId.toString();
    map.set(key, [
      ...(map.get(key) ?? []),
      {
        poId: Number(link.po.id),
        quoteTitle: link.po.quote.title,
        totalAmount: link.po.totalAmount,
        isPrimary: link.po.id === link.shipment.poId,
      },
    ]);
  }
  return map;
};

export const toAdminPoView = (
  po: PoWithItems & { partner: SpPartner },
  shipmentFiles: BomShipmentFileMetaType[] = [],
  groupPos: BomShipmentGroupPoType[] = [],
): AdminBomPoViewType => {
  const shipment = linkedShipment(po);
  const existingMode = shipment === null ? null : asShipmentMode(shipment.mode);
  const shipmentMode = existingMode ?? shipmentModeFromCountry(po.partner.country);
  return {
    poId: Number(po.id),
    partnerId: Number(po.partnerId),
    partnerName: po.partner.name,
    supplierCode: po.partner.supplierCode,
    partnerCountry: po.partner.country,
    shipmentMode,
    shipmentModeMismatch:
      existingMode !== null && shipmentModeDiffersFromCountry(existingMode, po.partner.country),
    status: asBomPoStatus(po.status),
    totalAmount: po.totalAmount,
    currency: po.currency,
    memo: po.memo,
    externalRef: toExternalRefView(po.externalRef),
    shipment: shipment === null ? null : toShipmentView(shipment, shipmentFiles, groupPos),
    itemCount: po.items.length,
    issuedAt: po.issuedAt.toISOString(),
    confirmedAt: po.confirmedAt?.toISOString() ?? null,
    closedAt: po.closedAt?.toISOString() ?? null,
    items: po.items.map(toItemView),
  };
};

export const loadAdminPos = async (quoteId: bigint): Promise<AdminBomPoViewType[]> => {
  const pos = await prisma.spBomPo.findMany({
    where: { quoteId },
    include: {
      partner: true,
      items: { orderBy: { id: 'asc' } },
      shipmentLink: { include: { shipment: true } },
    },
    orderBy: { id: 'asc' },
  });
  const shipmentIds = [
    ...new Set(pos.flatMap((po) => (po.shipmentLink === null ? [] : [po.shipmentLink.shipmentId]))),
  ];
  const [filesMap, groupMap] = await Promise.all([
    loadShipmentFilesMap(shipmentIds),
    loadShipmentGroupMap(shipmentIds),
  ]);
  return pos.map((po) => {
    const key = po.shipmentLink?.shipmentId.toString();
    return toAdminPoView(
      po,
      key === undefined ? [] : (filesMap.get(key) ?? []),
      key === undefined ? [] : (groupMap.get(key) ?? []),
    );
  });
};

// ── 횡단 워크큐(관리자 메뉴 재편) — 전 Case 발주·선적 목록 ───────────────────
// 역할별 메뉴(발주/선적·배송)의 큐. 규모가 작아(월 수십 건) 전체 파생 후 라우트에서
// 메모리 페이지네이션 — admin-bom-orders 관례 동일(커지면 커서 재설계).

export const loadAdminPoCrossList = async (): Promise<AdminBomPoCrossItemType[]> => {
  const pos = await prisma.spBomPo.findMany({
    include: {
      partner: { select: { name: true, supplierCode: true } },
      quote: { select: { title: true } },
      shipmentLink: { include: { shipment: true } },
      _count: { select: { items: true } },
    },
    orderBy: { id: 'desc' },
  });
  return pos.map((po) => {
    const shipment = linkedShipment(po);
    let shipmentLite: AdminBomPoCrossItemType['shipment'] = null;
    if (shipment !== null) {
      const mode = asShipmentMode(shipment.mode);
      shipmentLite = {
        shipmentId: Number(shipment.id),
        mode,
        status: asShipmentStatus(mode, shipment.status),
        receivedAt: shipment.receivedAt?.toISOString() ?? null,
      };
    }
    return {
      poId: Number(po.id),
      quoteId: String(po.quoteId),
      quoteTitle: po.quote.title,
      partnerId: Number(po.partnerId),
      partnerName: po.partner.name,
      supplierCode: po.partner.supplierCode,
      status: asBomPoStatus(po.status),
      totalAmount: po.totalAmount,
      currency: po.currency,
      itemCount: po._count.items,
      issuedAt: po.issuedAt.toISOString(),
      confirmedAt: po.confirmedAt?.toISOString() ?? null,
      closedAt: po.closedAt?.toISOString() ?? null,
      shipment: shipmentLite,
    };
  });
};

export const loadAdminShipmentCrossList = async (): Promise<AdminBomShipmentCrossItemType[]> => {
  const shipments = await prisma.spBomShipment.findMany({
    include: {
      // 대표 발주서 경유로 협력사·Case 표시(§6.10 — 묶음 전체는 groupPos 가 담당)
      po: {
        select: {
          partnerId: true,
          partner: { select: { name: true } },
          quote: { select: { title: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
  });
  const shipmentIds = shipments.map((s) => s.id);
  const [filesMap, groupMap] = await Promise.all([
    loadShipmentFilesMap(shipmentIds),
    loadShipmentGroupMap(shipmentIds),
  ]);
  return shipments.map((s) => {
    const key = s.id.toString();
    return {
      ...toShipmentView(s, filesMap.get(key) ?? [], groupMap.get(key) ?? []),
      partnerId: Number(s.po.partnerId),
      partnerName: s.po.partner.name,
      quoteId: String(s.quoteId),
      quoteTitle: s.po.quote.title,
      adminPending: isShipmentAdminPending(s),
    };
  });
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
  moq: number | null;
  stock: number | null;
  dateCode: string | null;
  leadTime: string | null;
  quotationMemo: string | null;
  quotationDeliveryDate: Date | null;
  quotationHeaderMemo: string | null;
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
        moq: rfqItem.moq,
        stock: rfqItem.stock,
        dateCode: rfqItem.dateCode,
        leadTime: rfqItem.leadTime,
        quotationMemo: rfqItem.memo,
        quotationDeliveryDate: rfqItem.rfq.deliveryDate,
        quotationHeaderMemo: rfqItem.rfq.memo,
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
      moq: null,
      stock: null,
      dateCode: null,
      leadTime: null,
      quotationMemo: null,
      quotationDeliveryDate: null,
      quotationHeaderMemo: null,
    });
  }
  return groups;
};

// ── 발주서 생성 — 게이트(결제 확인) + all-or-nothing(tx) ─────────────────────
export type CreatePosResult =
  | { ok: true; partners: SpPartner[] }
  | {
      ok: false;
      error:
        | 'QUOTE_NOT_FOUND'
        | 'NOT_PAID'
        | 'NO_ELIGIBLE_ROWS'
        | 'ALREADY_ISSUED'
        | 'PARTNER_COUNTRY_REQUIRED';
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
  const missingCountries = partners.filter(
    (partner) => shipmentModeFromCountry(partner.country) === null,
  );
  if (missingCountries.length > 0) {
    return {
      ok: false,
      error: 'PARTNER_COUNTRY_REQUIRED',
      detail: missingCountries.map((partner) => partner.name).join(', '),
    };
  }
  const needsDomesticDocument = partners.some(
    (partner) => shipmentModeFromCountry(partner.country) === 'domestic',
  );
  const business = needsDomesticDocument ? await getBusinessInfo() : null;
  const partnerById = new Map(partners.map((partner) => [partner.id, partner] as const));
  await prisma.$transaction(async (tx) => {
    for (const partnerId of wanted) {
      const lines = groups.get(partnerId) ?? [];
      const totalAmount = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const quotationDeliveryDate =
        lines.find((line) => line.quotationDeliveryDate !== null)?.quotationDeliveryDate ?? null;
      const quotationMemo =
        lines.find((line) => line.quotationHeaderMemo !== null)?.quotationHeaderMemo ?? null;
      const po = await tx.spBomPo.create({
        data: {
          quoteId,
          partnerId,
          status: 'issued',
          totalAmount,
          memo,
          quotationDeliveryDate,
          quotationMemo,
        },
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
          moq: line.moq,
          stock: line.stock,
          dateCode: line.dateCode,
          leadTime: line.leadTime,
          quotationMemo: line.quotationMemo,
        })),
      });
      const partner = partnerById.get(partnerId);
      const items = await tx.spBomPoItem.findMany({
        where: { poId: po.id },
        orderBy: { id: 'asc' },
      });
      if (partner === undefined) throw new Error(`Partner not found: ${String(partnerId)}`);
      // 국내 거래 문서만 발행 시점에 박제한다. 국외 발송은 Commercial Invoice가 정본이다.
      if (shipmentModeFromCountry(partner.country) === 'domestic') {
        const quotation = buildPartnerQuotationDocument(
          {
            id: po.id,
            quoteId,
            quoteTitle: quote.title,
            issuedAt: po.issuedAt,
            currency: po.currency,
            totalAmount,
            quotationDeliveryDate: po.quotationDeliveryDate,
            quotationMemo: po.quotationMemo,
            partner,
            items,
          },
          business,
          po.issuedAt,
        );
        await tx.spBomPo.update({
          where: { id: po.id },
          data: { quotationData: quotation },
        });
      }
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

// ── 선적 관리(D21) — 경량: 발주서당 1건, mode 는 생성 시 박제 ─────────────────
export type ShipmentUpsertResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'PO_NOT_FOUND'
        | 'INVALID_STATUS'
        | 'PARTNER_COUNTRY_REQUIRED'
        | 'MISSING_PACKING_LIST'
        | 'MISSING_TRACKING'
        | 'RECEIVE_REQUIRED';
    };

const finalStatusOf = (mode: BomShipmentModeType): BomShipmentStatusType =>
  mode === 'domestic' ? 'delivered' : 'done';
const shippedStatusOf = (mode: BomShipmentModeType): BomShipmentStatusType =>
  mode === 'domestic' ? 'shipping' : 'shipped';

/** 등록/수정 — 상태의 모드 정합 검증 + shippedAt(최초 발송 진입)·completedAt(최종 단계) 박제.
 * 선적 해석은 조인(§6.10) — 묶음의 어느 발주서로 접근해도 같은 선적을 조작한다. */
export const upsertShipment = async (
  poId: bigint,
  body: AdminBomShipmentUpsertBodyType,
): Promise<ShipmentUpsertResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipmentLink: { include: { shipment: true } } },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const existing = linkedShipment(po);

  // mode: 기존 박제 우선 → 신규는 협력사 국가만. 국가 미입력을 국제로 추측하지 않는다.
  const mode =
    existing !== null ? asShipmentMode(existing.mode) : shipmentModeFromCountry(po.partner.country);
  if (mode === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
  const allowed = shipmentStatusesFor(mode);
  const status: BomShipmentStatusType =
    body.status ?? (existing !== null ? asShipmentStatus(mode, existing.status) : 'preparing');
  if (!(allowed as readonly string[]).includes(status)) {
    return { ok: false, error: 'INVALID_STATUS' };
  }
  // 국내 최종 상태는 입고 시각·QR 포장 원장을 함께 갱신하는 전용 유스케이스만 허용한다.
  if (mode === 'domestic' && status === 'delivered' && existing?.receivedAt == null) {
    return { ok: false, error: 'RECEIVE_REQUIRED' };
  }

  if (
    status !== 'preparing' &&
    (existing === null ||
      (existing.status === 'preparing' && !(await shipmentPackingListIsComplete(existing.id))))
  ) {
    return { ok: false, error: 'MISSING_PACKING_LIST' };
  }
  const effectiveCarrier =
    body.carrier === undefined ? existing?.carrier ?? null : body.carrier ?? null;
  const effectiveTracking =
    body.trackingNumber === undefined
      ? existing?.trackingNumber ?? null
      : body.trackingNumber ?? null;
  if (
    mode === 'domestic' &&
    status === 'shipping' &&
    (effectiveCarrier === null ||
      effectiveCarrier === '' ||
      effectiveTracking === null || effectiveTracking === '')
  ) {
    return { ok: false, error: 'MISSING_TRACKING' };
  }

  const shippedIdx = allowed.indexOf(shippedStatusOf(mode));
  const isShippedOrLater = allowed.indexOf(status) >= shippedIdx;
  const isFinal = status === finalStatusOf(mode);
  const data = {
    status,
    ...(body.carrier !== undefined ? { carrier: body.carrier ?? null } : {}),
    ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber ?? null } : {}),
    ...(body.trackingUrl !== undefined ? { trackingUrl: body.trackingUrl ?? null } : {}),
    // 출고예정일은 국외 통관 흐름에만 존재한다. 과거 국내 값은 지우지 않되 새로 저장하지 않는다.
    ...(mode === 'international' && body.shipDate !== undefined
      ? { shipDate: parseShipDate(body.shipDate) }
      : {}),
    // 발송 시점은 최초 진입에 박제(되돌려도 유지), 최종완료는 이탈 시 해제(레거시 관례)
    shippedAt: existing?.shippedAt ?? (isShippedOrLater ? new Date() : null),
    completedAt: isFinal ? (existing?.completedAt ?? new Date()) : null,
  };
  if (existing !== null) {
    await prisma.spBomShipment.update({ where: { id: existing.id }, data });
  } else {
    const created = await prisma.spBomShipment.create({
      data: { poId: po.id, quoteId: po.quoteId, mode, ...data },
    });
    await prisma.spBomShipmentPo.create({ data: { shipmentId: created.id, poId: po.id } });
  }
  if (existing !== null && existing.status === 'preparing' && status !== 'preparing') {
    if (await shipmentPackingListIsComplete(existing.id)) {
      await finalizeShipmentPackingList(existing.id);
    }
  } else if (existing !== null && existing.status !== 'preparing' && status === 'preparing') {
    await reopenShipmentPackingList(existing.id);
  }
  return { ok: true };
};

// 출고예정일 'YYYY-MM-DD' → UTC 자정(날짜 전용 값 — toISOString().slice(0,10) 라운드트립
// 안정. KST 자정으로 저장하면 UTC 직렬화에서 하루 밀린다). 형식이 어긋나면 null.
const parseShipDate = (v: string | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 입고 확인(검수 ⑩ — D21-2) — 선적이 없어도 가능(시스템 밖 배송 수령). 최종 단계로
 * 마감하며, 묶음이면 소속 발주서 전체가 함께 입고 처리된다(선적 단위 검수 — §6.10). */
export const receiveShipment = async (
  poId: bigint,
  note: string | null,
  actor: BomPackingActor,
): Promise<ShipmentUpsertResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipmentLink: { include: { shipment: true } } },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const existing = linkedShipment(po);
  const mode =
    existing !== null ? asShipmentMode(existing.mode) : shipmentModeFromCountry(po.partner.country);
  if (mode === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
  const now = new Date();
  const data = {
    status: finalStatusOf(mode),
    receivedAt: now,
    receivedNote: note,
    completedAt: existing?.completedAt ?? now,
    shippedAt: existing?.shippedAt ?? now,
  };
  await prisma.$transaction(async (tx) => {
    const shipment =
      existing !== null
        ? await tx.spBomShipment.update({ where: { id: existing.id }, data })
        : await tx.spBomShipment.create({
            data: { poId: po.id, quoteId: po.quoteId, mode, ...data },
          });
    if (existing === null) {
      await tx.spBomShipmentPo.create({ data: { shipmentId: shipment.id, poId: po.id } });
    }
    await receiveAllShipmentPackagesInTransaction(tx, shipment.id, actor, note, now);
  });
  return { ok: true };
};

// ── 핑퐁 전이(D22 — 레거시 절차 승계, 서버 인가는 신규 교정) ─────────────────
// 협력사는 "다음 단계 진입 주체 = PARTNER"인 전이만, 되돌리기는 "현 단계 진입 주체 =
// PARTNER"(직전에 자기가 진행한 것)만 1단계. 관리자는 upsertShipment 로 전 단계 임의 조작.

type PoWithShipment = SpBomPo & { partner: SpPartner; shipmentLink: ShipmentLink | null };

const loadPartnerPo = async (poId: bigint, partnerId: bigint): Promise<PoWithShipment | null> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipmentLink: { include: { shipment: true } } },
  });
  if (po === null) return null;
  if (po.partnerId !== partnerId) return null;
  return po;
};

const defaultModeOf = (po: PoWithShipment): BomShipmentModeType | null => {
  const shipment = linkedShipment(po);
  return shipment !== null ? asShipmentMode(shipment.mode) : shipmentModeFromCountry(po.partner.country);
};

/** 선적 문서 보장 — 파일 첨부가 전이보다 먼저 올 수 있어 preparing 으로 생성해 둔다. */
const ensureShipment = async (po: PoWithShipment): Promise<SpBomShipment | null> => {
  const existing = linkedShipment(po);
  if (existing !== null) return existing;
  const mode = defaultModeOf(po);
  if (mode === null) return null;
  const created = await prisma.spBomShipment.create({
    data: { poId: po.id, quoteId: po.quoteId, mode, status: 'preparing' },
  });
  await prisma.spBomShipmentPo.create({ data: { shipmentId: created.id, poId: po.id } });
  return created;
};

export type PartnerShipmentError =
  | 'PO_NOT_FOUND'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_FINAL'
  | 'NOTHING_TO_REVERT'
  | 'MISSING_SHIP_DATE'
  | 'MISSING_INVOICE_FILE'
  | 'MISSING_PACKING_LIST'
  | 'MISSING_TRACKING'
  | 'INVALID_GROUP_PO'
  | 'NOT_PREPARING'
  | 'PARTNER_COUNTRY_REQUIRED';
export type PartnerShipmentResult =
  { ok: true; advancedTo?: BomShipmentStatusType } | { ok: false; error: PartnerShipmentError };

/** [다음 단계 진행] — 단계별 필수(레거시 fieldsForTransition 미러)를 서버가 검증한다.
 * §6.10: 최초 발송 전이에서 withPoIds(같은 박스 발주서)를 선적에 함께 묶을 수 있다. */
export const advancePartnerShipment = async (
  poId: bigint,
  partnerId: bigint,
  body: PartnerShipmentAdvanceBodyType,
): Promise<PartnerShipmentResult> => {
  const po = await loadPartnerPo(poId, partnerId);
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const shipment = await ensureShipment(po);
  if (shipment === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
  const mode = asShipmentMode(shipment.mode);
  const current = asShipmentStatus(mode, shipment.status);
  const next = bomShipmentNextStatus(mode, current);
  if (next === null) return { ok: false, error: 'ALREADY_FINAL' };
  if (bomShipmentActorOf(mode, next) !== 'PARTNER') return { ok: false, error: 'NOT_YOUR_TURN' };

  // 함께 발송(§6.10) — 최초 발송 전이(선적 요청/배송 중 진입)에서만, 같은 협력사·미소속.
  const withPoIds = [...new Set(body.withPoIds ?? [])].filter((id) => BigInt(id) !== po.id);
  if (withPoIds.length > 0) {
    if (next !== 'requested' && next !== 'shipping') {
      return { ok: false, error: 'INVALID_GROUP_PO' };
    }
    const companions = await prisma.spBomPo.findMany({
      where: { id: { in: withPoIds.map((id) => BigInt(id)) } },
      include: { shipmentLink: true },
    });
    const valid =
      companions.length === withPoIds.length &&
      companions.every((c) => c.partnerId === partnerId && c.shipmentLink === null);
    if (!valid) return { ok: false, error: 'INVALID_GROUP_PO' };
    await prisma.spBomShipmentPo.createMany({
      data: companions.map((c) => ({ shipmentId: shipment.id, poId: c.id })),
    });
  }

  // 최초 발송 전이는 선적 리스트가 전 발주 품목·수량을 포장 QR로 정확히 덮을 때만.
  // 상업송장 JSON 행은 편집 가능하므로 이 게이트의 근거로 사용하지 않는다(D24).
  if (
    current === 'preparing' &&
    (next === 'requested' || next === 'shipping') &&
    !(await shipmentPackingListIsComplete(shipment.id))
  ) {
    return { ok: false, error: 'MISSING_PACKING_LIST' };
  }

  if (next === 'requested') {
    // 선적 요청 = 출고예정일 + Invoice 첨부 필수(레거시 필수 게이트 승계)
    if (body.shipDate == null || body.shipDate === '') {
      return { ok: false, error: 'MISSING_SHIP_DATE' };
    }
    const invoice = await prisma.spFile.findFirst({
      where: { refType: SHIPMENT_FILE_REF_TYPE, refId: shipment.id, fileType: 'invoice' },
    });
    if (invoice === null) return { ok: false, error: 'MISSING_INVOICE_FILE' };
  }
  if (next === 'shipping') {
    // 국내 배송 중 = 택배사 + 송장번호 필수
    if (
      body.carrier == null ||
      body.carrier === '' ||
      body.trackingNumber == null ||
      body.trackingNumber === ''
    ) {
      return { ok: false, error: 'MISSING_TRACKING' };
    }
  }

  const saved = await upsertShipment(poId, {
    status: next,
    ...(body.shipDate !== undefined ? { shipDate: body.shipDate } : {}),
    ...(body.carrier !== undefined ? { carrier: body.carrier } : {}),
    ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber } : {}),
    ...(body.trackingUrl !== undefined ? { trackingUrl: body.trackingUrl } : {}),
  });
  if (!saved.ok) return { ok: false, error: 'PO_NOT_FOUND' };
  return { ok: true, advancedTo: next };
};

/** [이전 단계로] — 직전에 자기가 진행한 전이만 되돌린다(입력값·첨부는 유지 — 레거시). */
export const revertPartnerShipment = async (
  poId: bigint,
  partnerId: bigint,
): Promise<PartnerShipmentResult> => {
  const po = await loadPartnerPo(poId, partnerId);
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const shipment = linkedShipment(po);
  if (shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  const mode = asShipmentMode(shipment.mode);
  const current = asShipmentStatus(mode, shipment.status);
  const prev = bomShipmentPrevStatus(mode, current);
  if (prev === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (bomShipmentActorOf(mode, current) !== 'PARTNER') return { ok: false, error: 'NOT_YOUR_TURN' };
  const saved = await upsertShipment(poId, { status: prev });
  if (!saved.ok) return { ok: false, error: 'PO_NOT_FOUND' };
  return { ok: true };
};

export interface DetachShipmentPoOptions {
  /** 관리자 Case 하드 삭제 전용. 일반 물류 화면은 완료·진행 선적을 분리할 수 없다. */
  allowAnyStatus?: boolean;
}

/** 박스에서 꺼내기(§6.10·§6.11 개정) — 일반 호출은 선적 준비 단계에서만 허용한다.
 * Case 하드 삭제는 allowAnyStatus로 상태와 관계없이 정확한 PO 소속을 정리한다.
 * "기준(대표)" 개념은 사용자에게서 숨긴다: 대표를 꺼내면 남은 발주서로 자동 승계,
 * 마지막을 꺼내면 발송 자체를 정리(첨부 실파일 → sp_file → 선적 순서 — 고아 방지). */
export const detachShipmentPo = async (
  shipmentId: bigint,
  poId: bigint,
  options: DetachShipmentPoOptions = {},
): Promise<PartnerShipmentResult> => {
  const shipment = await prisma.spBomShipment.findUnique({
    where: { id: shipmentId },
    include: { pos: { orderBy: { id: 'asc' } } },
  });
  if (shipment === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const mode = asShipmentMode(shipment.mode);
  if (!options.allowAnyStatus && asShipmentStatus(mode, shipment.status) !== 'preparing') {
    return { ok: false, error: 'NOT_PREPARING' };
  }
  const target = shipment.pos.find((link) => link.poId === poId);
  if (target === undefined) return { ok: false, error: 'PO_NOT_FOUND' };
  const remaining = shipment.pos.filter((link) => link.poId !== poId);

  if (remaining.length === 0) {
    // 빈 박스는 소멸 — 첨부 실파일 먼저 정리(고아 pathToken 방지)
    const files = await prisma.spFile.findMany({
      where: { refType: SHIPMENT_FILE_REF_TYPE, refId: shipment.id },
    });
    for (const file of files) {
      await deleteFromFileServer(file.pathToken);
      await prisma.spFile.delete({ where: { id: file.id } });
    }
    await prisma.spBomShipment.delete({ where: { id: shipment.id } }); // 조인 cascade
    return { ok: true };
  }

  // Case 하드 삭제는 바로 뒤에서 PO 품목 cascade로 QR·이력을 영구 삭제한다. 여기서 먼저
  // 무효화하면 이후 단계 실패 시 보존된 공유 선적에 거짓 이력만 남으므로 일반 분리에만 기록한다.
  if (!options.allowAnyStatus) {
    await voidShipmentPackagesForPo(shipment.id, poId, { type: 'SYSTEM', mbId: null });
  }
  await prisma.spBomShipmentPo.delete({ where: { id: target.id } });
  if (shipment.poId === poId) {
    // 대표 승계 — 내부 참조일 뿐이라 사용자 규칙에 노출하지 않는다
    const heir = await prisma.spBomPo.findUnique({ where: { id: remaining[0]?.poId ?? 0n } });
    if (heir !== null) {
      await prisma.spBomShipment.update({
        where: { id: shipment.id },
        data: { poId: heir.id, quoteId: heir.quoteId },
      });
    }
  }
  return { ok: true };
};

/** 박스에 담기(§6.11) — 준비 단계 발송에 발주서 추가(소유·미담김·확인 완료 검증). */
export const attachShipmentPo = async (
  shipmentId: bigint,
  poId: bigint,
  partnerId: bigint,
): Promise<PartnerShipmentResult> => {
  const shipment = await prisma.spBomShipment.findUnique({
    where: { id: shipmentId },
    include: { po: true },
  });
  if (shipment === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (shipment.po.partnerId !== partnerId) return { ok: false, error: 'PO_NOT_FOUND' };
  const mode = asShipmentMode(shipment.mode);
  if (asShipmentStatus(mode, shipment.status) !== 'preparing') {
    return { ok: false, error: 'NOT_PREPARING' };
  }
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { shipmentLink: true },
  });
  if (po === null) return { ok: false, error: 'INVALID_GROUP_PO' };
  if (po.partnerId !== partnerId || po.shipmentLink !== null || po.status === 'issued') {
    return { ok: false, error: 'INVALID_GROUP_PO' };
  }
  await prisma.spBomShipmentPo.create({ data: { shipmentId, poId } });
  await prisma.spBomShipment.update({
    where: { id: shipmentId },
    data: { packingFinalizedAt: null },
  });
  return { ok: true };
};

// ── 선적 첨부 저장/삭제/다운로드(D22) ───────────────────────────────────────
// 순서 불변식: 업로드는 새 실파일 성공 후 구 파일 정리(실패 시 기존 유지), 삭제는
// 실파일 먼저·성공 시에만 DB 행(고아 pathToken 방지 — lib/market.ts 관례).

export const saveShipmentFile = async (
  shipmentId: bigint,
  kind: BomShipmentFileTypeType,
  file: UploadTarget,
  uploadedBy: 'ADMIN' | 'PARTNER',
): Promise<boolean> => {
  const shipment = await prisma.spBomShipment.findUnique({
    where: { id: shipmentId },
    select: { mode: true },
  });
  // Invoice/AWB 슬롯은 국제 발송 전용. 모드는 생성 후 불변이라 검사 뒤 경합이 없다.
  if (shipment === null || asShipmentMode(shipment.mode) !== 'international') return false;
  const [uploaded] = await uploadToFileServer([file], SHIPMENT_FILE_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('shipment file upload failed: empty result');
  const existing = await prisma.spFile.findFirst({
    where: { refType: SHIPMENT_FILE_REF_TYPE, refId: shipmentId, fileType: kind },
  });
  if (existing !== null) {
    await deleteFromFileServer(existing.pathToken);
    await prisma.spFile.delete({ where: { id: existing.id } });
  }
  await prisma.spFile.create({
    data: {
      refType: SHIPMENT_FILE_REF_TYPE,
      refId: shipmentId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: uploaded.originFileName,
      pathToken: uploaded.pathToken,
      size: BigInt(uploaded.size),
      writeDate: new Date(),
      fileType: kind,
      uploadedBy,
    },
  });
  return true;
};

export const deleteShipmentFile = async (shipmentId: bigint, fileId: bigint): Promise<boolean> => {
  const file = await prisma.spFile.findFirst({
    where: { id: fileId, refType: SHIPMENT_FILE_REF_TYPE, refId: shipmentId },
  });
  if (file === null) return false;
  await deleteFromFileServer(file.pathToken);
  await prisma.spFile.delete({ where: { id: file.id } });
  return true;
};

export interface ShipmentFileDownload {
  originFileName: string;
  buffer: Buffer;
  contentType: string;
}

export const getShipmentFileDownload = async (
  shipmentId: bigint,
  fileId: bigint,
): Promise<ShipmentFileDownload | null> => {
  const file = await prisma.spFile.findFirst({
    where: { id: fileId, refType: SHIPMENT_FILE_REF_TYPE, refId: shipmentId },
  });
  if (file === null) return null;
  const downloaded = await downloadFromFileServer(file.pathToken);
  if (downloaded === null) return null;
  return {
    originFileName: file.originFileName,
    buffer: downloaded.buffer,
    contentType: downloaded.contentType,
  };
};

/** 파일 라우트 공용 — 포털은 소유 검증 포함, 선적 없으면 생성(preparing). */
export const ensurePartnerShipment = async (
  poId: bigint,
  partnerId: bigint,
): Promise<SpBomShipment | null> => {
  const po = await loadPartnerPo(poId, partnerId);
  if (po === null) return null;
  return ensureShipment(po);
};

// ── 발송 1급(§6.11) — [보내기] 위저드의 "담기"가 발송(선적+조인)을 먼저 만든다 ──

export const createPartnerShipment = async (
  partnerId: bigint,
  poIds: number[],
): Promise<
  | { ok: true; shipmentId: bigint }
  | { ok: false; error: 'INVALID_GROUP_PO' | 'PARTNER_COUNTRY_REQUIRED' }
> => {
  const unique = [...new Set(poIds)].map((id) => BigInt(id));
  const pos = await prisma.spBomPo.findMany({
    where: { id: { in: unique } },
    include: { shipmentLink: true, partner: true },
  });
  const valid =
    pos.length === unique.length &&
    pos.every(
      (po) => po.partnerId === partnerId && po.shipmentLink === null && po.status !== 'issued',
    );
  const primary = pos.find((po) => po.id === unique[0]);
  if (!valid || primary === undefined) return { ok: false, error: 'INVALID_GROUP_PO' };
  const mode = shipmentModeFromCountry(primary.partner.country);
  if (mode === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
  const created = await prisma.spBomShipment.create({
    data: {
      poId: primary.id,
      quoteId: primary.quoteId,
      mode,
      status: 'preparing',
    },
  });
  await prisma.spBomShipmentPo.createMany({
    data: unique.map((poId) => ({ shipmentId: created.id, poId })),
  });
  return { ok: true, shipmentId: created.id };
};

/** 협력사의 발송 목록(§6.11) — 소속·파일·묶음 배치 포함, 진행 중이 위로. */
export const loadPartnerShipments = async (partnerId: bigint) => {
  const shipments = await prisma.spBomShipment.findMany({
    where: { pos: { some: { po: { partnerId } } } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'desc' }],
  });
  const ids = shipments.map((s) => s.id);
  const [filesMap, groupMap] = await Promise.all([
    loadShipmentFilesMap(ids),
    loadShipmentGroupMap(ids),
  ]);
  return shipments.map((shipment) => {
    const view = toShipmentView(
      shipment,
      filesMap.get(shipment.id.toString()) ?? [],
      groupMap.get(shipment.id.toString()) ?? [],
    );
    const next = bomShipmentNextStatus(view.mode, view.status);
    return {
      ...view,
      primaryPoId: Number(shipment.poId),
      myTurn:
        shipment.receivedAt === null &&
        next !== null &&
        bomShipmentActorOf(view.mode, next) === 'PARTNER',
    };
  });
};

// ── 관리자 차례 선적(D22 인지 장치) — 메뉴 배지·목록 칩 파생 ─────────────────
// "다음 단계 진입 주체 = ADMIN"이고 아직 검수(receivedAt) 전인 선적. 협력사 차례·
// 최종 단계·검수 완료 건은 대기 아님.

export const isShipmentAdminPending = (row: {
  mode: string;
  status: string;
  receivedAt: Date | null;
}): boolean => {
  if (row.receivedAt !== null) return false;
  const mode = asShipmentMode(row.mode);
  const next = bomShipmentNextStatus(mode, asShipmentStatus(mode, row.status));
  return next !== null && bomShipmentActorOf(mode, next) === 'ADMIN';
};

/** 전역 파생 1회 로드 — byQuote(칩)·total(배지). §6.10: 묶음이 여러 Case 를 걸칠 수
 * 있어 byQuote 는 조인 소속 발주서들의 quoteId 전부에 찍는다. total 은 선적 단위. */
export const loadShipmentAdminPending = async (): Promise<{
  byQuote: Set<string>;
  total: number;
}> => {
  const rows = await prisma.spBomShipment.findMany({
    where: { receivedAt: null },
    select: {
      mode: true,
      status: true,
      receivedAt: true,
      pos: { select: { po: { select: { quoteId: true } } } },
    },
  });
  const byQuote = new Set<string>();
  let total = 0;
  for (const row of rows) {
    if (!isShipmentAdminPending(row)) continue;
    total += 1;
    for (const link of row.pos) byQuote.add(link.po.quoteId.toString());
  }
  return { byQuote, total };
};

/** 입고 확인된 발주서 수(quoteId별, §6.10 조인 기반) — quote 목록·주문 축 poReceivedCount. */
export const loadReceivedPoCounts = async (quoteIds: bigint[]): Promise<Map<bigint, number>> => {
  const map = new Map<bigint, number>();
  if (quoteIds.length === 0) return map;
  const links = await prisma.spBomShipmentPo.findMany({
    where: {
      shipment: { receivedAt: { not: null } },
      po: { quoteId: { in: quoteIds } },
    },
    select: { po: { select: { quoteId: true } } },
  });
  for (const link of links) {
    map.set(link.po.quoteId, (map.get(link.po.quoteId) ?? 0) + 1);
  }
  return map;
};

// ── 협력사 포털 직렬화 ───────────────────────────────────────────────────────

// 협력사 차례 판정(D22 인지 장치 — isShipmentAdminPending 의 협력사 미러).
// 발주 확인(issued) 전엔 확인이 먼저라 false, 검수(receivedAt) 후엔 할 일 없음.
// 선적 문서가 없어도 첫 전이(선적 요청/배송 중)는 협력사 몫이라 국가 기본 모드로 판정한다.
const partnerShipmentSummary = (
  po: SpBomPo & { partner: SpPartner; shipmentLink?: ShipmentLink | null },
): Pick<
  PartnerPoListItemType,
  | 'shipmentMode'
  | 'shipmentStatus'
  | 'shipmentCountryReady'
  | 'shipmentReceived'
  | 'shipmentMyTurn'
  | 'shipmentAttached'
> => {
  const shipment = linkedShipment(po);
  const mode =
    shipment !== null ? asShipmentMode(shipment.mode) : shipmentModeFromCountry(po.partner.country);
  const status =
    shipment !== null
      ? asShipmentStatus(asShipmentMode(shipment.mode), shipment.status)
      : mode === null
        ? null
        : 'preparing';
  const received = shipment?.receivedAt != null;
  const next = mode === null || status === null ? null : bomShipmentNextStatus(mode, status);
  const myTurn =
    po.status !== 'issued' &&
    !received &&
    mode !== null &&
    next !== null &&
    bomShipmentActorOf(mode, next) === 'PARTNER';
  return {
    shipmentMode: mode,
    shipmentStatus: status,
    shipmentCountryReady: mode !== null,
    shipmentReceived: received,
    shipmentMyTurn: myTurn,
    shipmentAttached: shipment !== null,
  };
};

export const toPartnerPoListItem = (
  po: PoWithItems & { quote: { title: string }; partner: SpPartner },
): PartnerPoListItemType => ({
  poId: Number(po.id),
  quoteTitle: po.quote.title,
  status: asBomPoStatus(po.status),
  totalAmount: po.totalAmount,
  currency: po.currency,
  itemCount: po.items.length,
  issuedAt: po.issuedAt.toISOString(),
  confirmedAt: po.confirmedAt?.toISOString() ?? null,
  ...partnerShipmentSummary(po),
});

export const toPartnerPoDetail = (
  po: PoWithItems & { quote: { title: string } },
  shipmentFiles: BomShipmentFileMetaType[] = [],
  groupPos: BomShipmentGroupPoType[] = [],
): PartnerPoDetailType => {
  const linked = linkedShipment(po);
  const shipment = linked === null ? null : toShipmentView(linked, shipmentFiles, groupPos);
  return {
    poId: Number(po.id),
    quoteTitle: po.quote.title,
    status: asBomPoStatus(po.status),
    totalAmount: po.totalAmount,
    currency: po.currency,
    memo: po.memo,
    issuedAt: po.issuedAt.toISOString(),
    confirmedAt: po.confirmedAt?.toISOString() ?? null,
    shipment:
      shipment === null
        ? null
        : {
            mode: shipment.mode,
            status: shipment.status,
            carrier: shipment.carrier,
            trackingNumber: shipment.trackingNumber,
            trackingUrl: shipment.trackingUrl,
            shipDate: shipment.shipDate,
            shippedAt: shipment.shippedAt,
            receivedAt: shipment.receivedAt,
            receivedNote: shipment.receivedNote,
            files: shipment.files,
            groupPos: shipment.groupPos,
          },
    items: po.items.map(toItemView),
  };
};
