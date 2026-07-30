import type { SpBomPo, SpBomPoItem, SpBomShipment, SpFile, SpPartner } from '@prisma/client';
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
  AdminBomPoViewType,
  AdminBomShipmentUpsertBodyType,
  BomPoItemViewType,
  BomPoStatusType,
  BomShipmentFileMetaType,
  BomShipmentFileTypeType,
  BomShipmentModeType,
  BomShipmentStatusType,
  BomShipmentViewType,
  PartnerPoDetailType,
  PartnerPoListItemType,
  PartnerShipmentAdvanceBodyType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { filterActiveQuoteItems, toItemDto } from './bom-quote';
import { getOrderInfoByCtId } from './g5-db';
import { digikeyThirdPartyList, mouserCartInsert } from './supplier-order';
import {
  deleteFromFileServer,
  downloadFromFileServer,
  uploadToFileServer,
  type UploadTarget,
} from './file-server';

// ── 협력사 발주 코어(D18, docs/SMARTBOM_PARTNER_RFQ.md §6.1) ────────────────
// 발주서 = 박제 문서: 생성 시점의 부품·수량·단가(선정 회신가 스냅샷)를 복사해
// 이후 견적 변경과 무관하게 불변(snapshot-freeze). 생성은 all-or-nothing(신중 액션).

export const asBomPoStatus = (v: string): BomPoStatusType =>
  v === 'confirmed' ? 'confirmed' : v === 'closed' ? 'closed' : 'issued';

type PoWithItems = SpBomPo & { items: SpBomPoItem[]; shipment?: SpBomShipment | null };

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
    files,
  };
};

export const toAdminPoView = (
  po: PoWithItems & { partner: SpPartner },
  shipmentFiles: BomShipmentFileMetaType[] = [],
): AdminBomPoViewType => ({
  poId: Number(po.id),
  partnerId: Number(po.partnerId),
  partnerName: po.partner.name,
  supplierCode: po.partner.supplierCode,
  status: asBomPoStatus(po.status),
  totalAmount: po.totalAmount,
  currency: po.currency,
  memo: po.memo,
  externalRef: toExternalRefView(po.externalRef),
  shipment: po.shipment == null ? null : toShipmentView(po.shipment, shipmentFiles),
  itemCount: po.items.length,
  issuedAt: po.issuedAt.toISOString(),
  confirmedAt: po.confirmedAt?.toISOString() ?? null,
  closedAt: po.closedAt?.toISOString() ?? null,
  items: po.items.map(toItemView),
});

export const loadAdminPos = async (quoteId: bigint): Promise<AdminBomPoViewType[]> => {
  const pos = await prisma.spBomPo.findMany({
    where: { quoteId },
    include: { partner: true, items: { orderBy: { id: 'asc' } }, shipment: true },
    orderBy: { id: 'asc' },
  });
  const filesMap = await loadShipmentFilesMap(
    pos.flatMap((po) => (po.shipment === null ? [] : [po.shipment.id])),
  );
  return pos.map((po) =>
    toAdminPoView(po, po.shipment === null ? [] : (filesMap.get(po.shipment.id.toString()) ?? [])),
  );
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

// ── 선적 관리(D21) — 경량: 발주서당 1건, mode 는 생성 시 박제 ─────────────────
export type ShipmentUpsertResult =
  | { ok: true }
  | { ok: false; error: 'PO_NOT_FOUND' | 'INVALID_STATUS' };

const finalStatusOf = (mode: BomShipmentModeType): BomShipmentStatusType =>
  mode === 'domestic' ? 'delivered' : 'done';
const shippedStatusOf = (mode: BomShipmentModeType): BomShipmentStatusType =>
  mode === 'domestic' ? 'shipping' : 'shipped';

/** 등록/수정 — 상태의 모드 정합 검증 + shippedAt(최초 발송 진입)·completedAt(최종 단계) 박제. */
export const upsertShipment = async (
  poId: bigint,
  body: AdminBomShipmentUpsertBodyType,
): Promise<ShipmentUpsertResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipment: true },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const existing = po.shipment;

  // mode: 기존 박제 우선 → 요청값 → 협력사 국가 기본값(KR=국내, 그 외=국제)
  const mode: BomShipmentModeType =
    existing !== null
      ? asShipmentMode(existing.mode)
      : (body.mode ?? (po.partner.country === 'KR' ? 'domestic' : 'international'));
  const allowed = shipmentStatusesFor(mode);
  const status: BomShipmentStatusType =
    body.status ?? (existing !== null ? asShipmentStatus(mode, existing.status) : 'preparing');
  if (!(allowed as readonly string[]).includes(status)) {
    return { ok: false, error: 'INVALID_STATUS' };
  }

  const shippedIdx = allowed.indexOf(shippedStatusOf(mode));
  const isShippedOrLater = allowed.indexOf(status) >= shippedIdx;
  const isFinal = status === finalStatusOf(mode);
  const data = {
    status,
    ...(body.carrier !== undefined ? { carrier: body.carrier ?? null } : {}),
    ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber ?? null } : {}),
    ...(body.trackingUrl !== undefined ? { trackingUrl: body.trackingUrl ?? null } : {}),
    ...(body.shipDate !== undefined ? { shipDate: parseShipDate(body.shipDate) } : {}),
    // 발송 시점은 최초 진입에 박제(되돌려도 유지), 최종완료는 이탈 시 해제(레거시 관례)
    shippedAt: existing?.shippedAt ?? (isShippedOrLater ? new Date() : null),
    completedAt: isFinal ? (existing?.completedAt ?? new Date()) : null,
  };
  if (existing !== null) {
    await prisma.spBomShipment.update({ where: { id: existing.id }, data });
  } else {
    await prisma.spBomShipment.create({
      data: { poId: po.id, quoteId: po.quoteId, mode, ...data },
    });
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

/** 입고 확인(검수 ⑩ — D21-2) — 선적이 없어도 가능(시스템 밖 배송 수령). 최종 단계로 마감. */
export const receiveShipment = async (poId: bigint, note: string | null): Promise<ShipmentUpsertResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipment: true },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const mode: BomShipmentModeType =
    po.shipment !== null
      ? asShipmentMode(po.shipment.mode)
      : po.partner.country === 'KR'
        ? 'domestic'
        : 'international';
  const now = new Date();
  const data = {
    status: finalStatusOf(mode),
    receivedAt: now,
    receivedNote: note,
    completedAt: po.shipment?.completedAt ?? now,
    shippedAt: po.shipment?.shippedAt ?? now,
  };
  if (po.shipment !== null) {
    await prisma.spBomShipment.update({ where: { id: po.shipment.id }, data });
  } else {
    await prisma.spBomShipment.create({ data: { poId: po.id, quoteId: po.quoteId, mode, ...data } });
  }
  return { ok: true };
};

// ── 핑퐁 전이(D22 — 레거시 절차 승계, 서버 인가는 신규 교정) ─────────────────
// 협력사는 "다음 단계 진입 주체 = PARTNER"인 전이만, 되돌리기는 "현 단계 진입 주체 =
// PARTNER"(직전에 자기가 진행한 것)만 1단계. 관리자는 upsertShipment 로 전 단계 임의 조작.

type PoWithShipment = SpBomPo & { partner: SpPartner; shipment: SpBomShipment | null };

const loadPartnerPo = async (poId: bigint, partnerId: bigint): Promise<PoWithShipment | null> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: { partner: true, shipment: true },
  });
  if (po === null) return null;
  if (po.partnerId !== partnerId) return null;
  return po;
};

const defaultModeOf = (po: PoWithShipment): BomShipmentModeType =>
  po.shipment !== null
    ? asShipmentMode(po.shipment.mode)
    : po.partner.country === 'KR'
      ? 'domestic'
      : 'international';

/** 선적 문서 보장 — 파일 첨부가 전이보다 먼저 올 수 있어 preparing 으로 생성해 둔다. */
const ensureShipment = async (po: PoWithShipment): Promise<SpBomShipment> => {
  if (po.shipment !== null) return po.shipment;
  return prisma.spBomShipment.create({
    data: { poId: po.id, quoteId: po.quoteId, mode: defaultModeOf(po), status: 'preparing' },
  });
};

export type PartnerShipmentError =
  | 'PO_NOT_FOUND'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_FINAL'
  | 'NOTHING_TO_REVERT'
  | 'MISSING_SHIP_DATE'
  | 'MISSING_INVOICE_FILE'
  | 'MISSING_TRACKING';
export type PartnerShipmentResult =
  | { ok: true; advancedTo?: BomShipmentStatusType }
  | { ok: false; error: PartnerShipmentError };

/** [다음 단계 진행] — 단계별 필수(레거시 fieldsForTransition 미러)를 서버가 검증한다. */
export const advancePartnerShipment = async (
  poId: bigint,
  partnerId: bigint,
  body: PartnerShipmentAdvanceBodyType,
): Promise<PartnerShipmentResult> => {
  const po = await loadPartnerPo(poId, partnerId);
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const shipment = await ensureShipment(po);
  const mode = asShipmentMode(shipment.mode);
  const current = asShipmentStatus(mode, shipment.status);
  const next = bomShipmentNextStatus(mode, current);
  if (next === null) return { ok: false, error: 'ALREADY_FINAL' };
  if (bomShipmentActorOf(mode, next) !== 'PARTNER') return { ok: false, error: 'NOT_YOUR_TURN' };

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
    // 국내 배송중 = 택배사 + 송장번호 필수
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
  if (po.shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  const mode = asShipmentMode(po.shipment.mode);
  const current = asShipmentStatus(mode, po.shipment.status);
  const prev = bomShipmentPrevStatus(mode, current);
  if (prev === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (bomShipmentActorOf(mode, current) !== 'PARTNER') return { ok: false, error: 'NOT_YOUR_TURN' };
  const saved = await upsertShipment(poId, { status: prev });
  if (!saved.ok) return { ok: false, error: 'PO_NOT_FOUND' };
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
): Promise<void> => {
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

/** 전역 파생 1회 로드 — byQuote(칩)·total(배지). 선적 행 수가 작아 전량 스캔으로 충분. */
export const loadShipmentAdminPending = async (): Promise<{
  byQuote: Set<string>;
  total: number;
}> => {
  const rows = await prisma.spBomShipment.findMany({
    where: { receivedAt: null },
    select: { quoteId: true, mode: true, status: true, receivedAt: true },
  });
  const byQuote = new Set<string>();
  let total = 0;
  for (const row of rows) {
    if (!isShipmentAdminPending(row)) continue;
    total += 1;
    byQuote.add(row.quoteId.toString());
  }
  return { byQuote, total };
};

// ── 협력사 포털 직렬화 ───────────────────────────────────────────────────────

// 협력사 차례 판정(D22 인지 장치 — isShipmentAdminPending 의 협력사 미러).
// 발주 확인(issued) 전엔 확인이 먼저라 false, 검수(receivedAt) 후엔 할 일 없음.
// 선적 문서가 없어도 첫 전이(선적 요청/배송중)는 협력사 몫이라 국가 기본 모드로 판정한다.
const partnerShipmentSummary = (
  po: SpBomPo & { partner: SpPartner; shipment?: SpBomShipment | null },
): Pick<
  PartnerPoListItemType,
  'shipmentMode' | 'shipmentStatus' | 'shipmentReceived' | 'shipmentMyTurn'
> => {
  const shipment = po.shipment ?? null;
  const mode =
    shipment !== null
      ? asShipmentMode(shipment.mode)
      : po.partner.country === 'KR'
        ? 'domestic'
        : 'international';
  const status = shipment !== null ? asShipmentStatus(mode, shipment.status) : 'preparing';
  const received = shipment?.receivedAt != null;
  const next = bomShipmentNextStatus(mode, status);
  const myTurn =
    po.status !== 'issued' &&
    !received &&
    next !== null &&
    bomShipmentActorOf(mode, next) === 'PARTNER';
  return {
    shipmentMode: mode,
    shipmentStatus: status,
    shipmentReceived: received,
    shipmentMyTurn: myTurn,
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
): PartnerPoDetailType => {
  const shipment = po.shipment == null ? null : toShipmentView(po.shipment, shipmentFiles);
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
          },
    items: po.items.map(toItemView),
  };
};
