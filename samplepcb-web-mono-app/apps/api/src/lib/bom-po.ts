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
  BomShipmentFileType,
  bomShipmentActorOf,
  bomShipmentDocumentsLocked,
  bomShipmentNextStatus,
  bomShipmentPrevStatus,
  shipmentTransportDocType,
  shipmentTransportOf,
} from '@sp/api-contract';
import type {
  AdminBomPoCrossItemType,
  AdminBomPoViewType,
  AdminBomShortageCandidateType,
  AdminBomShortageRecoverBodyType,
  AdminBomShipmentCrossItemType,
  AdminBomShipmentUpsertBodyType,
  BomPoItemViewType,
  BomPoStatusType,
  BomShipmentFileMetaType,
  BomShipmentFileTypeType,
  ShipmentTransportType,
  BomShipmentGroupPoType,
  BomShipmentModeType,
  BomShipmentStatusType,
  BomShipmentViewType,
  PartnerPoDetailType,
  PartnerPoListItemType,
  PartnerPoShortageCreateBodyType,
  PartnerPoShortageUpdateBodyType,
  PartnerShipmentAdvanceBodyType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { filterActiveQuoteItems, toItemDto } from './bom-quote';
import { getBusinessInfo, getOrderInfoByCtId } from './g5-db';
import { isBomOrderFulfillmentClosed, isBomOrderLinePaid } from './bom-order-cancel';
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

/** 상세 화면의 조달 차질·회복 링크를 한 번에 직렬화하기 위한 공용 include. */
export const BOM_PO_ITEM_PROCUREMENT_INCLUDE = {
  shortage: {
    include: {
      recoveryItem: {
        include: {
          po: {
            include: {
              partner: true,
              shipmentLink: { include: { shipment: true } },
            },
          },
        },
      },
    },
  },
  recoverySource: {
    include: {
      sourceItem: { include: { po: { include: { partner: true } } } },
    },
  },
} as const satisfies Prisma.SpBomPoItemInclude;

type PoItemWithProcurement = Prisma.SpBomPoItemGetPayload<{
  include: typeof BOM_PO_ITEM_PROCUREMENT_INCLUDE;
}>;
type PoWithProcurementItems = SpBomPo & {
  items: PoItemWithProcurement[];
  shipmentLink?: ShipmentLink | null;
};

const suppliedQtyOf = (item: PoItemWithProcurement): number =>
  Math.max(0, item.qty - (item.shortage?.shortageQty ?? 0));

const suppliedAmountOf = (item: PoItemWithProcurement): number =>
  item.shortage === null
    ? item.lineTotal
    : Math.round(Number(item.unitPrice) * suppliedQtyOf(item));

/** 박제 발주 합계와 별도로 보여줄 실제 공급 예정 합계 — 항상 서버가 계산한다. */
export const actualSupplyAmountOf = (items: readonly PoItemWithProcurement[]): number =>
  items.reduce((sum, item) => sum + suppliedAmountOf(item), 0);

const toItemView = (item: PoItemWithProcurement): BomPoItemViewType => ({
  poItemId: Number(item.id),
  quoteItemId: String(item.quoteItemId),
  mpn: item.mpn,
  manufacturerName: item.manufacturerName,
  description: item.description,
  supplierSku: item.supplierSku,
  qty: item.qty,
  unitPrice: Number(item.unitPrice),
  lineTotal: item.lineTotal,
  shortage:
    item.shortage === null
      ? null
      : {
          shortageId: Number(item.shortage.id),
          shortageQty: item.shortage.shortageQty,
          suppliedQty: suppliedQtyOf(item),
          suppliedAmount: suppliedAmountOf(item),
          reason:
            item.shortage.reason === 'out_of_stock' ||
            item.shortage.reason === 'quality_issue' ||
            item.shortage.reason === 'discontinued' ||
            item.shortage.reason === 'other'
              ? item.shortage.reason
              : 'insufficient_stock',
          note: item.shortage.note,
          reportedAt: item.shortage.reportedAt.toISOString(),
          recovery:
            item.shortage.recoveryItem === null
              ? null
              : {
                  poId: Number(item.shortage.recoveryItem.po.id),
                  poItemId: Number(item.shortage.recoveryItem.id),
                  partnerId: Number(item.shortage.recoveryItem.po.partnerId),
                  partnerName: item.shortage.recoveryItem.po.partner.name,
                  qty: item.shortage.recoveryItem.qty,
                  receivedAt:
                    item.shortage.recoveryItem.po.shipmentLink?.shipment.receivedAt?.toISOString() ??
                    null,
                },
        },
  recoverySource:
    item.recoverySource === null
      ? null
      : {
          shortageId: Number(item.recoverySource.id),
          sourcePoId: Number(item.recoverySource.sourceItem.po.id),
          sourcePartnerName: item.recoverySource.sourceItem.po.partner.name,
          shortageQty: item.recoverySource.shortageQty,
        },
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

/** 응답용 운송수단 — DB 는 자유 문자열이라 사전 밖 값은 null(미선택)로 내보낸다.
 *  **표시 폴백(shipmentTransportOf)과 다르다**: 여기서 'air' 로 접으면 "고른 적 없음"이
 *  화면에서 "항공을 골랐음"으로 굳어 라디오가 처음부터 켜진 채 뜬다. */
const asShipmentTransport = (v: string | null): ShipmentTransportType | null =>
  v === 'air' || v === 'sea' ? v : null;

// ── 선적 첨부(D22) — sp_file 폴리모픽(refType 'sp_bom_shipment'), 종류별 1건 ──
const SHIPMENT_FILE_REF_TYPE = 'sp_bom_shipment';
const SHIPMENT_FILE_SERVICE_TYPE = process.env.BOM_SHIPMENT_FILE_SERVICE_TYPE ?? 'bom_shipment';

// 판정은 **계약 사전 파싱**이다 — 종류를 손으로 나열하면 사전이 늘 때마다 조용히
// 빠진다(PCB 쪽은 그 방식이라 08-15 신설 종류가 'invoice' 로 접혔다). 모르는 종류는
// 접지 말고 뺀다 — 남의 종류로 위장하면 화면의 첨부 판정이 거짓이 된다.
const toShipmentFileMeta = (f: SpFile): BomShipmentFileMetaType | null => {
  const kind = BomShipmentFileType.safeParse(f.fileType);
  if (!kind.success) return null;
  return {
    fileId: Number(f.id),
    fileType: kind.data,
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
    transport: asShipmentTransport(shipment.transport),
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    shipDate: shipment.shipDate?.toISOString().slice(0, 10) ?? null,
    caseRefRequestedAt: shipment.caseRefRequestedAt?.toISOString() ?? null,
    caseRefNote: shipment.caseRefNote,
    caseRef: shipment.caseRef,
    caseRefFilledAt: shipment.caseRefFilledAt?.toISOString() ?? null,
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
  po: PoWithProcurementItems & { partner: SpPartner },
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
    actualSupplyAmount: actualSupplyAmountOf(po.items),
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
      items: {
        include: BOM_PO_ITEM_PROCUREMENT_INCLUDE,
        orderBy: { id: 'asc' },
      },
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
    const caseRefPending = shipmentCaseRefPending(s);
    return {
      ...toShipmentView(s, filesMap.get(key) ?? [], groupMap.get(key) ?? []),
      partnerId: Number(s.po.partnerId),
      partnerName: s.po.partner.name,
      quoteId: String(s.quoteId),
      quoteTitle: s.po.quote.title,
      adminPending: isShipmentAdminPending(s),
      caseRefPending,
    };
  });
};

// ── 발주 대상 집계 ───────────────────────────────────────────────────────────
// included 행 중 ①협력사 회신 선정 행(selectedRfqItemId)과 ②공급사 구매 조건 선정 행
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

  // 공급사 구매 조건 선정 행의 supplier → 파트너 조직 매핑(supplierCode, house 제외 — D20).
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

    // ② 공급사 구매 조건 선정(D20) — supplierCode 매핑 조직에만. 단가는 KRW 환산 박제
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
        | 'ORDER_CLOSED'
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
  if (
    orderInfo !== null
    && isBomOrderFulfillmentClosed(orderInfo.odStatus, orderInfo.rowCtStatus)
  ) {
    return { ok: false, error: 'ORDER_CLOSED' };
  }
  if (orderInfo === null || !isBomOrderLinePaid(orderInfo.rowCtStatus)) {
    return { ok: false, error: 'NOT_PAID' };
  }

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

// ── 조달 차질·잔량 대체발주(D31) ───────────────────────────────────────────
// 원 PO/품목은 발행 시점 박제 문서이므로 qty·lineTotal 을 수정하지 않는다. 부족분은
// 별도 원장에 기록하고, 관리자가 다른 협력사의 유효 회신을 골라 새 PO 품목으로 이어 붙인다.

export type ReportPoShortageResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'PO_NOT_FOUND'
        | 'PO_NOT_CONFIRMED'
        | 'SHIPMENT_ALREADY_STARTED'
        | 'ITEM_NOT_FOUND'
        | 'INVALID_QUANTITY'
        | 'ALREADY_REPORTED'
        | 'NO_SUPPLY_REMAINS';
    };

export const reportPoShortage = async (
  poId: bigint,
  partnerId: bigint,
  actorMbId: string,
  body: PartnerPoShortageCreateBodyType,
): Promise<ReportPoShortageResult> => {
  try {
    return await prisma.$transaction(
      async (tx): Promise<ReportPoShortageResult> => {
        const po = await tx.spBomPo.findUnique({
          where: { id: poId },
          include: {
            shipmentLink: true,
            items: { include: { shortage: true } },
          },
        });
        if (po?.partnerId !== partnerId) {
          return { ok: false, error: 'PO_NOT_FOUND' };
        }
        if (po.status !== 'confirmed') return { ok: false, error: 'PO_NOT_CONFIRMED' };
        if (po.shipmentLink !== null) {
          return { ok: false, error: 'SHIPMENT_ALREADY_STARTED' };
        }
        const target = po.items.find((item) => item.id === BigInt(body.poItemId));
        if (target === undefined) return { ok: false, error: 'ITEM_NOT_FOUND' };
        if (target.shortage !== null) return { ok: false, error: 'ALREADY_REPORTED' };
        if (body.shortageQty > target.qty) return { ok: false, error: 'INVALID_QUANTITY' };

        const remainingQty = po.items.reduce(
          (sum, item) =>
            sum +
            Math.max(
              0,
              item.qty -
                (item.id === target.id ? body.shortageQty : (item.shortage?.shortageQty ?? 0)),
            ),
          0,
        );
        if (remainingQty < 1) return { ok: false, error: 'NO_SUPPLY_REMAINS' };

        await tx.spBomPoShortage.create({
          data: {
            sourcePoItemId: target.id,
            shortageQty: body.shortageQty,
            reason: body.reason,
            note: body.note ?? null,
            reportedByMbId: actorMbId,
          },
        });
        return { ok: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'ALREADY_REPORTED' };
    }
    throw error;
  }
};

export type ChangePoShortageResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'PO_NOT_FOUND'
        | 'PO_NOT_CONFIRMED'
        | 'SHIPMENT_ALREADY_STARTED'
        | 'SHORTAGE_NOT_FOUND'
        | 'INVALID_QUANTITY'
        | 'ALREADY_RECOVERED'
        | 'NO_SUPPLY_REMAINS';
    };

/** 대체발주·발송 전에 한해 신고 내용을 정정한다. 원 PO 스냅샷은 그대로 둔다. */
export const updatePoShortage = async (
  poId: bigint,
  shortageId: bigint,
  partnerId: bigint,
  body: PartnerPoShortageUpdateBodyType,
): Promise<ChangePoShortageResult> =>
  prisma.$transaction(
    async (tx): Promise<ChangePoShortageResult> => {
      const po = await tx.spBomPo.findUnique({
        where: { id: poId },
        include: { shipmentLink: true, items: { include: { shortage: true } } },
      });
      if (po?.partnerId !== partnerId) return { ok: false, error: 'PO_NOT_FOUND' };
      if (po.status !== 'confirmed') return { ok: false, error: 'PO_NOT_CONFIRMED' };
      if (po.shipmentLink !== null) return { ok: false, error: 'SHIPMENT_ALREADY_STARTED' };

      const target = po.items.find((item) => item.shortage?.id === shortageId);
      if (target?.shortage === null || target === undefined) {
        return { ok: false, error: 'SHORTAGE_NOT_FOUND' };
      }
      if (target.shortage.recoveryPoItemId !== null) {
        return { ok: false, error: 'ALREADY_RECOVERED' };
      }
      if (body.shortageQty > target.qty) return { ok: false, error: 'INVALID_QUANTITY' };

      const remainingQty = po.items.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            item.qty -
              (item.id === target.id
                ? body.shortageQty
                : (item.shortage?.shortageQty ?? 0)),
          ),
        0,
      );
      if (remainingQty < 1) return { ok: false, error: 'NO_SUPPLY_REMAINS' };

      const updated = await tx.spBomPoShortage.updateMany({
        where: { id: target.shortage.id, recoveryPoItemId: null },
        data: {
          shortageQty: body.shortageQty,
          reason: body.reason,
          note: body.note ?? null,
        },
      });
      return updated.count === 1
        ? { ok: true }
        : { ok: false, error: 'ALREADY_RECOVERED' };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

/** 잘못 등록한 신고를 대체발주·발송 전에 취소한다. */
export const cancelPoShortage = async (
  poId: bigint,
  shortageId: bigint,
  partnerId: bigint,
): Promise<ChangePoShortageResult> =>
  prisma.$transaction(
    async (tx): Promise<ChangePoShortageResult> => {
      const po = await tx.spBomPo.findUnique({
        where: { id: poId },
        include: { shipmentLink: true, items: { include: { shortage: true } } },
      });
      if (po?.partnerId !== partnerId) return { ok: false, error: 'PO_NOT_FOUND' };
      if (po.status !== 'confirmed') return { ok: false, error: 'PO_NOT_CONFIRMED' };
      if (po.shipmentLink !== null) return { ok: false, error: 'SHIPMENT_ALREADY_STARTED' };

      const target = po.items.find((item) => item.shortage?.id === shortageId);
      if (target?.shortage === null || target === undefined) {
        return { ok: false, error: 'SHORTAGE_NOT_FOUND' };
      }
      if (target.shortage.recoveryPoItemId !== null) {
        return { ok: false, error: 'ALREADY_RECOVERED' };
      }
      const deleted = await tx.spBomPoShortage.deleteMany({
        where: { id: target.shortage.id, recoveryPoItemId: null },
      });
      return deleted.count === 1
        ? { ok: true }
        : { ok: false, error: 'ALREADY_RECOVERED' };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export interface BomShortageCandidatesData {
  shortageId: number;
  quoteItemId: string;
  mpn: string;
  shortageQty: number;
  candidates: AdminBomShortageCandidateType[];
}

const recoveryCandidateBlockReason = (input: {
  sourcePartnerId: bigint;
  targetPartnerId: bigint;
  targetStatus: string;
  targetCountry: string | null;
  unitPrice: number;
  stock: number | null;
  replyQty: number | null;
  shortageQty: number;
  alreadyIssued: boolean;
  alreadyRecovered: boolean;
}): string | null => {
  if (input.alreadyRecovered) return '이미 대체발주가 연결되었습니다.';
  if (input.sourcePartnerId === input.targetPartnerId) return '부족을 신고한 협력사입니다.';
  if (input.targetStatus !== 'approved') return '현재 거래할 수 없는 협력사입니다.';
  if (shipmentModeFromCountry(input.targetCountry) === null) {
    return '협력사 국가 정보가 필요합니다.';
  }
  if (input.unitPrice <= 0) return '유효한 회신 단가가 없습니다.';
  if (input.stock === null) return '회신 재고를 먼저 확인해야 합니다.';
  if (input.stock < input.shortageQty) return '회신 재고가 부족 수량보다 적습니다.';
  if (input.replyQty !== null && input.replyQty < input.shortageQty) {
    return '회신 가능 수량이 부족 수량보다 적습니다.';
  }
  if (input.alreadyIssued) return '이 Case에 이미 발주된 협력사입니다.';
  return null;
};

export const loadShortageRecoveryCandidates = async (
  quoteId: bigint,
  shortageId: bigint,
): Promise<BomShortageCandidatesData | null> => {
  const shortage = await prisma.spBomPoShortage.findUnique({
    where: { id: shortageId },
    include: { sourceItem: { include: { po: true } } },
  });
  if (shortage?.sourceItem.po.quoteId !== quoteId) return null;

  const [rfqItems, existingPos] = await Promise.all([
    prisma.spBomRfqItem.findMany({
      where: {
        quoteItemId: shortage.sourceItem.quoteItemId,
        unitPrice: { not: null },
        rfq: { quoteId, respondedAt: { not: null } },
      },
      include: { rfq: { include: { partner: true } } },
      orderBy: [{ unitPrice: 'asc' }, { id: 'asc' }],
    }),
    prisma.spBomPo.findMany({ where: { quoteId }, select: { partnerId: true } }),
  ]);
  const issuedPartners = new Set(existingPos.map((po) => po.partnerId));
  return {
    shortageId: Number(shortage.id),
    quoteItemId: String(shortage.sourceItem.quoteItemId),
    mpn: shortage.sourceItem.mpn,
    shortageQty: shortage.shortageQty,
    candidates: rfqItems.map((item) => {
      const unitPrice = Number(item.unitPrice ?? 0);
      const ineligibleReason = recoveryCandidateBlockReason({
        sourcePartnerId: shortage.sourceItem.po.partnerId,
        targetPartnerId: item.rfq.partnerId,
        targetStatus: item.rfq.partner.status,
        targetCountry: item.rfq.partner.country,
        unitPrice,
        stock: item.stock,
        replyQty: item.replyQty,
        shortageQty: shortage.shortageQty,
        alreadyIssued: issuedPartners.has(item.rfq.partnerId),
        alreadyRecovered: shortage.recoveryPoItemId !== null,
      });
      return {
        rfqItemId: Number(item.id),
        partnerId: Number(item.rfq.partnerId),
        partnerName: item.rfq.partner.name,
        partnerCountry: item.rfq.partner.country,
        shipmentMode: shipmentModeFromCountry(item.rfq.partner.country),
        unitPrice,
        stock: item.stock,
        leadTime: item.leadTime,
        dateCode: item.dateCode,
        memo: item.memo,
        eligible: ineligibleReason === null,
        ineligibleReason,
      };
    }),
  };
};

export type RecoverPoShortageResult =
  | { ok: true; poId: bigint; partner: SpPartner }
  | {
      ok: false;
      error:
        | 'SHORTAGE_NOT_FOUND'
        | 'ALREADY_RECOVERED'
        | 'ORDER_CLOSED'
        | 'NOT_PAID'
        | 'RFQ_ITEM_NOT_FOUND'
        | 'INVALID_CANDIDATE'
        | 'TARGET_ALREADY_ISSUED'
        | 'PARTNER_COUNTRY_REQUIRED';
    };

class BomShortageRecoveryRaceError extends Error {}

export const recoverPoShortage = async (
  quoteId: bigint,
  shortageId: bigint,
  body: AdminBomShortageRecoverBodyType,
): Promise<RecoverPoShortageResult> => {
  const preview = await loadShortageRecoveryCandidates(quoteId, shortageId);
  if (preview === null) return { ok: false, error: 'SHORTAGE_NOT_FOUND' };
  const selected = preview.candidates.find((item) => item.rfqItemId === body.rfqItemId);
  if (selected === undefined) return { ok: false, error: 'RFQ_ITEM_NOT_FOUND' };
  if (!selected.eligible) {
    return {
      ok: false,
      error: selected.ineligibleReason?.includes('이미 발주')
        ? 'TARGET_ALREADY_ISSUED'
        : selected.ineligibleReason?.includes('국가')
          ? 'PARTNER_COUNTRY_REQUIRED'
          : selected.ineligibleReason?.includes('이미 대체발주')
            ? 'ALREADY_RECOVERED'
            : 'INVALID_CANDIDATE',
    };
  }

  const shortageHeader = await prisma.spBomPoShortage.findUnique({
    where: { id: shortageId },
    include: { sourceItem: { include: { po: { include: { quote: true } } } } },
  });
  if (shortageHeader?.sourceItem.po.quoteId !== quoteId) {
    return { ok: false, error: 'SHORTAGE_NOT_FOUND' };
  }
  const orderInfo =
    shortageHeader.sourceItem.po.quote.ctId === null
      ? null
      : await getOrderInfoByCtId(shortageHeader.sourceItem.po.quote.ctId);
  if (
    orderInfo !== null &&
    isBomOrderFulfillmentClosed(orderInfo.odStatus, orderInfo.rowCtStatus)
  ) {
    return { ok: false, error: 'ORDER_CLOSED' };
  }
  if (orderInfo === null || !isBomOrderLinePaid(orderInfo.rowCtStatus)) {
    return { ok: false, error: 'NOT_PAID' };
  }
  const business =
    shipmentModeFromCountry(selected.partnerCountry) === 'domestic'
      ? await getBusinessInfo()
      : null;

  try {
    return await prisma.$transaction(
      async (tx): Promise<RecoverPoShortageResult> => {
        const shortage = await tx.spBomPoShortage.findUnique({
          where: { id: shortageId },
          include: { sourceItem: { include: { po: { include: { quote: true } } } } },
        });
        if (shortage?.sourceItem.po.quoteId !== quoteId) {
          return { ok: false, error: 'SHORTAGE_NOT_FOUND' };
        }
        if (shortage.recoveryPoItemId !== null) {
          return { ok: false, error: 'ALREADY_RECOVERED' };
        }
        const rfqItem = await tx.spBomRfqItem.findUnique({
          where: { id: BigInt(body.rfqItemId) },
          include: { rfq: { include: { partner: true } } },
        });
        if (
          rfqItem?.quoteItemId !== shortage.sourceItem.quoteItemId ||
          rfqItem.rfq.quoteId !== quoteId ||
          rfqItem.rfq.respondedAt === null ||
          rfqItem.unitPrice === null
        ) {
          return { ok: false, error: 'RFQ_ITEM_NOT_FOUND' };
        }
        const existing = await tx.spBomPo.count({
          where: { quoteId, partnerId: rfqItem.rfq.partnerId },
        });
        if (existing > 0) return { ok: false, error: 'TARGET_ALREADY_ISSUED' };
        const blockReason = recoveryCandidateBlockReason({
          sourcePartnerId: shortage.sourceItem.po.partnerId,
          targetPartnerId: rfqItem.rfq.partnerId,
          targetStatus: rfqItem.rfq.partner.status,
          targetCountry: rfqItem.rfq.partner.country,
          unitPrice: Number(rfqItem.unitPrice),
          stock: rfqItem.stock,
          replyQty: rfqItem.replyQty,
          shortageQty: shortage.shortageQty,
          alreadyIssued: false,
          alreadyRecovered: false,
        });
        if (blockReason !== null) {
          return {
            ok: false,
            error: blockReason.includes('국가')
              ? 'PARTNER_COUNTRY_REQUIRED'
              : 'INVALID_CANDIDATE',
          };
        }

        const lineTotal = Math.round(Number(rfqItem.unitPrice) * shortage.shortageQty);
        const po = await tx.spBomPo.create({
          data: {
            quoteId,
            partnerId: rfqItem.rfq.partnerId,
            status: 'issued',
            totalAmount: lineTotal,
            currency: 'KRW',
            memo: body.memo ?? null,
            quotationDeliveryDate: rfqItem.rfq.deliveryDate,
            quotationMemo: rfqItem.rfq.memo,
          },
        });
        const recoveryItem = await tx.spBomPoItem.create({
          data: {
            poId: po.id,
            quoteItemId: shortage.sourceItem.quoteItemId,
            rfqItemId: rfqItem.id,
            mpn: shortage.sourceItem.mpn,
            manufacturerName: shortage.sourceItem.manufacturerName,
            description: shortage.sourceItem.description,
            supplierSku: null,
            qty: shortage.shortageQty,
            unitPrice: rfqItem.unitPrice,
            lineTotal,
            moq: rfqItem.moq,
            stock: rfqItem.stock,
            dateCode: rfqItem.dateCode,
            leadTime: rfqItem.leadTime,
            quotationMemo: rfqItem.memo,
          },
        });
        const linked = await tx.spBomPoShortage.updateMany({
          where: { id: shortage.id, recoveryPoItemId: null },
          data: { recoveryPoItemId: recoveryItem.id, recoveredAt: new Date() },
        });
        if (linked.count !== 1) throw new BomShortageRecoveryRaceError();

        if (shipmentModeFromCountry(rfqItem.rfq.partner.country) === 'domestic') {
          const quotation = buildPartnerQuotationDocument(
            {
              id: po.id,
              quoteId,
              quoteTitle: shortage.sourceItem.po.quote.title,
              issuedAt: po.issuedAt,
              currency: po.currency,
              totalAmount: po.totalAmount,
              quotationDeliveryDate: po.quotationDeliveryDate,
              quotationMemo: po.quotationMemo,
              partner: rfqItem.rfq.partner,
              items: [recoveryItem],
            },
            business,
            po.issuedAt,
          );
          await tx.spBomPo.update({ where: { id: po.id }, data: { quotationData: quotation } });
        }
        return { ok: true, poId: po.id, partner: rfqItem.rfq.partner };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof BomShortageRecoveryRaceError) {
      return { ok: false, error: 'ALREADY_RECOVERED' };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'TARGET_ALREADY_ISSUED' };
    }
    throw error;
  }
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
  if (lines.length === 0) {
    await prisma.spBomPo.update({
      where: { id: po.id },
      data: {
        externalRef: {
          state: 'failed',
          supplier: supplierCode,
          executedAt: new Date().toISOString(),
          skippedNoSku: po.items.length,
          error: '실행할 공급사 SKU가 없습니다. 공급사 사이트에서 품번으로 수동 주문해 주세요.',
        },
      },
    });
    return { ok: false, error: 'NO_SKU_LINES' };
  }

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
        | 'PO_NOT_CONFIRMED'
        | 'INVALID_STATUS'
        | 'PARTNER_COUNTRY_REQUIRED'
        | 'MISSING_PACKING_LIST'
        | 'MISSING_TRACKING'
        | 'CASE_REF_REQUIRED'
        | 'MISSING_AWB_FILE'
        | 'MISSING_BL_FILE'
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
  options: { caseRefRequested?: boolean; caseRefNote?: string | null } = {},
): Promise<ShipmentUpsertResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipmentLink: { include: { shipment: true } } },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (po.status === 'issued') return { ok: false, error: 'PO_NOT_CONFIRMED' };
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
  const caseRefBranch = mode === 'international' && existing?.caseRefRequestedAt != null;
  if (caseRefBranch && isShippedOrLater) {
    const effectiveCaseRef = body.caseRef === undefined ? existing.caseRef : body.caseRef;
    if (effectiveCaseRef == null || effectiveCaseRef === '') {
      return { ok: false, error: 'CASE_REF_REQUIRED' };
    }
    if (effectiveTracking === null || effectiveTracking === '') {
      return { ok: false, error: 'MISSING_TRACKING' };
    }
    const needed = shipmentTransportDocType(body.transport ?? existing.transport);
    const document = await prisma.spFile.findFirst({
      where: { refType: SHIPMENT_FILE_REF_TYPE, refId: existing.id, fileType: needed },
    });
    if (document === null) {
      return {
        ok: false,
        error: needed === 'bill_of_lading' ? 'MISSING_BL_FILE' : 'MISSING_AWB_FILE',
      };
    }
  }
  const isFinal = status === finalStatusOf(mode);
  const data = {
    status,
    // 운송수단 — **국제 전용** 축이라 국내 발송에서 오면 버린다(바로 아래 shipDate 와
    // 같은 관례). 수단이 바뀌면 앞서 적어 둔 운송회사·운송장은 남의 수단 것이 되므로
    // (항공사명 + 해상 B/L 번호 같은 모순) 함께 비운다. PCB 트랙과 같은 규칙이다.
    // ⚠ 이 스프레드는 carrier·trackingNumber 보다 **앞**이어야 한다: 수단 변경과 새
    // 운송장 입력이 한 요청에 오면 뒤에 오는 새 값이 이겨야 한다.
    ...(mode === 'international' && body.transport !== undefined
      ? {
          transport: body.transport ?? null,
          ...(shipmentTransportOf(body.transport) === shipmentTransportOf(existing?.transport)
            ? {}
            : { carrier: null, trackingNumber: null, trackingUrl: null }),
        }
      : {}),
    ...(body.carrier !== undefined ? { carrier: body.carrier ?? null } : {}),
    ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber ?? null } : {}),
    ...(body.trackingUrl !== undefined ? { trackingUrl: body.trackingUrl ?? null } : {}),
    // 출고예정일은 국외 통관 흐름에만 존재한다. 과거 국내 값은 지우지 않되 새로 저장하지 않는다.
    ...(mode === 'international' && body.shipDate !== undefined
      ? { shipDate: parseShipDate(body.shipDate) }
      : {}),
    ...(options.caseRefRequested === true && status === 'requested'
      ? { caseRefRequestedAt: new Date(), caseRefNote: options.caseRefNote ?? null }
      : {}),
    ...(body.caseRef != null && body.caseRef !== ''
      ? { caseRef: body.caseRef, caseRefFilledAt: new Date() }
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
  if (po.status === 'issued') return { ok: false, error: 'PO_NOT_CONFIRMED' };
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
  | 'CASE_REF_REQUIRED'
  | 'CASE_REF_LOCKED'
  | 'MISSING_AWB_FILE'
  | 'MISSING_BL_FILE'
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

  const saved = await upsertShipment(
    poId,
    {
      status: next,
      ...(body.shipDate !== undefined ? { shipDate: body.shipDate } : {}),
      // 운송수단은 협력사 '선적 요청'에 얹혀 온다 — 국내 게이트·전환 정리는 upsert 가 한다.
      ...(body.transport !== undefined ? { transport: body.transport } : {}),
      ...(body.carrier !== undefined ? { carrier: body.carrier } : {}),
      ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber } : {}),
      ...(body.trackingUrl !== undefined ? { trackingUrl: body.trackingUrl } : {}),
    },
    {
      caseRefRequested: body.caseRefRequested === true,
      caseRefNote: body.caseRefNote ?? null,
    },
  );
  if (!saved.ok) {
    if (
      saved.error === 'PARTNER_COUNTRY_REQUIRED' ||
      saved.error === 'MISSING_PACKING_LIST' ||
      saved.error === 'MISSING_TRACKING' ||
      saved.error === 'CASE_REF_REQUIRED' ||
      saved.error === 'MISSING_AWB_FILE' ||
      saved.error === 'MISSING_BL_FILE'
    ) {
      return { ok: false, error: saved.error };
    }
    return { ok: false, error: 'PO_NOT_FOUND' };
  }
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

/** Case ID 사후 요청 — 주 동선은 선적 요청 폼의 발송 방식 선택이다. 실선적 전에는
 *  메모 정정용으로 허용하고, 발송·입고 뒤에는 원장을 잠근다. */
export const requestBomShipmentCaseRef = async (
  poId: bigint,
  partnerId: bigint,
  note: string | null,
): Promise<PartnerShipmentResult> => {
  const po = await loadPartnerPo(poId, partnerId);
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const shipment = linkedShipment(po);
  if (shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (asShipmentMode(shipment.mode) !== 'international') {
    return { ok: false, error: 'NOT_YOUR_TURN' };
  }
  if (shipment.shippedAt !== null || shipment.receivedAt !== null) {
    return { ok: false, error: 'CASE_REF_LOCKED' };
  }
  await prisma.spBomShipment.update({
    where: { id: shipment.id },
    data: { caseRefRequestedAt: new Date(), caseRefNote: note },
  });
  return { ok: true };
};

/** 관리자 Case ID 단독 입력·정정 — 입고 전까지 오타 교정을 허용한다. */
export const fillBomShipmentCaseRef = async (
  poId: bigint,
  caseRef: string,
): Promise<PartnerShipmentResult> => {
  const link = await prisma.spBomShipmentPo.findUnique({
    where: { poId },
    include: { shipment: true },
  });
  if (link === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (link.shipment.receivedAt !== null) return { ok: false, error: 'CASE_REF_LOCKED' };
  await prisma.spBomShipment.update({
    where: { id: link.shipment.id },
    data: { caseRef, caseRefFilledAt: new Date() },
  });
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

export type ShipmentDocumentMutationError =
  | 'SHIPMENT_NOT_FOUND'
  | 'INTERNATIONAL_DOCUMENT_ONLY'
  | 'SHIPMENT_DOCUMENTS_LOCKED';
export type ShipmentDocumentMutationResult =
  | { ok: true }
  | { ok: false; error: ShipmentDocumentMutationError };

const shipmentDocumentMutationError = (
  shipment: { mode: string; status: string; receivedAt: Date | null } | null,
): ShipmentDocumentMutationError | null => {
  if (shipment === null) return 'SHIPMENT_NOT_FOUND';
  const mode = asShipmentMode(shipment.mode);
  if (mode !== 'international') return 'INTERNATIONAL_DOCUMENT_ONLY';
  const status = asShipmentStatus(mode, shipment.status);
  return bomShipmentDocumentsLocked(mode, status, shipment.receivedAt)
    ? 'SHIPMENT_DOCUMENTS_LOCKED'
    : null;
};

export const saveShipmentFile = async (
  shipmentId: bigint,
  kind: BomShipmentFileTypeType,
  file: UploadTarget,
  uploadedBy: 'ADMIN' | 'PARTNER',
): Promise<ShipmentDocumentMutationResult> => {
  const beforeUpload = await prisma.spBomShipment.findUnique({
    where: { id: shipmentId },
    select: { mode: true, status: true, receivedAt: true },
  });
  const initialError = shipmentDocumentMutationError(beforeUpload);
  if (initialError !== null) return { ok: false, error: initialError };

  const [uploaded] = await uploadToFileServer([file], SHIPMENT_FILE_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('shipment file upload failed: empty result');

  try {
    const result = await prisma.$transaction(
      async (tx): Promise<ShipmentDocumentMutationResult> => {
        const shipment = await tx.spBomShipment.findUnique({
          where: { id: shipmentId },
          select: { mode: true, status: true, receivedAt: true },
        });
        const error = shipmentDocumentMutationError(shipment);
        if (error !== null) return { ok: false, error };

        const existing = await tx.spFile.findFirst({
          where: { refType: SHIPMENT_FILE_REF_TYPE, refId: shipmentId, fileType: kind },
        });
        if (existing !== null) {
          await deleteFromFileServer(existing.pathToken);
          await tx.spFile.delete({ where: { id: existing.id } });
        }
        await tx.spFile.create({
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
        return { ok: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result.ok) await deleteFromFileServer(uploaded.pathToken);
    return result;
  } catch (error) {
    await deleteFromFileServer(uploaded.pathToken);
    throw error;
  }
};

export const deleteShipmentFile = async (
  shipmentId: bigint,
  fileId: bigint,
): Promise<ShipmentDocumentMutationResult> =>
  prisma.$transaction(
    async (tx): Promise<ShipmentDocumentMutationResult> => {
      const shipment = await tx.spBomShipment.findUnique({
        where: { id: shipmentId },
        select: { mode: true, status: true, receivedAt: true },
      });
      const error = shipmentDocumentMutationError(shipment);
      if (error !== null) return { ok: false, error };

      const file = await tx.spFile.findFirst({
        where: { id: fileId, refType: SHIPMENT_FILE_REF_TYPE, refId: shipmentId },
      });
      if (file === null) return { ok: false, error: 'SHIPMENT_NOT_FOUND' };
      await deleteFromFileServer(file.pathToken);
      await tx.spFile.delete({ where: { id: file.id } });
      return { ok: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

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
  caseRefRequestedAt: Date | null;
  caseRef: string | null;
}): boolean => {
  if (row.receivedAt !== null) return false;
  if (shipmentCaseRefPending(row)) return true;
  const mode = asShipmentMode(row.mode);
  const next = bomShipmentNextStatus(mode, asShipmentStatus(mode, row.status));
  return next !== null && bomShipmentActorOf(mode, next) === 'ADMIN';
};

const shipmentCaseRefPending = (row: {
  receivedAt: Date | null;
  caseRefRequestedAt: Date | null;
  caseRef: string | null;
}): boolean =>
  row.receivedAt === null &&
  row.caseRefRequestedAt !== null &&
  (row.caseRef === null || row.caseRef === '');

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
      caseRefRequestedAt: true,
      caseRef: true,
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

/** 현재 목록 Case의 선적 문서 존재 여부 — 완료 선적도 ⑨ 이후 단계 파생 근거로 보존한다. */
export const loadQuoteShipmentPresence = async (quoteIds: bigint[]): Promise<Set<string>> => {
  if (quoteIds.length === 0) return new Set();
  const links = await prisma.spBomShipmentPo.findMany({
    where: { po: { quoteId: { in: quoteIds } } },
    select: { po: { select: { quoteId: true } } },
  });
  return new Set(links.map((link) => link.po.quoteId.toString()));
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

/** 대체 PO 품목이 아직 연결되지 않은 공급 부족 수(quoteId별). 하나라도 열려 있으면
 * PO 입고 개수와 무관하게 고객 배송을 막는다(D31). */
export const loadOpenShortageCounts = async (
  quoteIds: bigint[],
): Promise<Map<bigint, number>> => {
  const map = new Map<bigint, number>();
  if (quoteIds.length === 0) return map;
  const rows = await prisma.spBomPoShortage.findMany({
    where: {
      recoveryPoItemId: null,
      sourceItem: { po: { quoteId: { in: quoteIds } } },
    },
    select: { sourceItem: { select: { po: { select: { quoteId: true } } } } },
  });
  for (const row of rows) {
    const quoteId = row.sourceItem.po.quoteId;
    map.set(quoteId, (map.get(quoteId) ?? 0) + 1);
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
  po: PoWithProcurementItems & { quote: { title: string } },
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
    actualSupplyAmount: actualSupplyAmountOf(po.items),
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
            transport: shipment.transport,
            caseRefRequestedAt: shipment.caseRefRequestedAt,
            caseRefNote: shipment.caseRefNote,
            caseRef: shipment.caseRef,
            caseRefFilledAt: shipment.caseRefFilledAt,
            shippedAt: shipment.shippedAt,
            receivedAt: shipment.receivedAt,
            receivedNote: shipment.receivedNote,
            files: shipment.files,
            groupPos: shipment.groupPos,
          },
    items: po.items.map(toItemView),
  };
};
