import type { SpFile, SpPartner, SpPcbPo, SpPcbShipment } from '@prisma/client';
import type {
  BomInvoiceDataType,
  BomShipmentFileTypeType,
  BomShipmentModeType,
  BomShipmentStatusType,
  PcbShipmentAdvanceBodyType,
  PcbShipmentFileViewType,
  PcbShipmentViewType,
} from '@sp/api-contract';
import {
  BOM_SHIPMENT_DOMESTIC_STATUSES,
  BOM_SHIPMENT_INTL_STATUSES,
  BomInvoiceData,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentPrevStatus,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { getBusinessInfo } from './g5-db';
import { loadHousePartnerName } from './pcb-rfq';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';
import { kstDateStr } from './kst';

// ── PCB 선적 코어(P3) — docs/PCB_PARTNER_TRACK.md §5.2-4 ─────────────────────
// 상태·핑퐁 주체·필수값은 BOM 선적 계약 코드사전을 공유하고(§8 V6 — lib 은 전용 미러),
// PCB 고유는 **받는측 재해석**(admin=관리자/직송, md=MD 입고)과 **출고 게이팅**(MD 는
// 하위 입고를 모두 확인해야 관리자에게 출고)이다. 레거시 서버 무검증(L1)은 여기서
// 전이 주체·순서·필수값 서버 강제로 교정한다. 모드·받는측·목적지는 생성 시 박제.

const SHIPMENT_REF_TYPE = 'sp_pcb_shipment';
const SHIPMENT_UPLOAD_SERVICE_TYPE = 'pcb_shipment';

export const asPcbShipmentMode = (v: string): BomShipmentModeType =>
  v === 'domestic' ? 'domestic' : 'international';

export const asPcbShipmentStatus = (
  mode: BomShipmentModeType,
  v: string,
): BomShipmentStatusType => {
  const chain: readonly string[] =
    mode === 'domestic' ? BOM_SHIPMENT_DOMESTIC_STATUSES : BOM_SHIPMENT_INTL_STATUSES;
  return chain.includes(v) ? (v as BomShipmentStatusType) : 'preparing';
};

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);
const normalizeCountry = (v: string | null | undefined): string | null => {
  const up = (v ?? '').trim().toUpperCase();
  return up === '' ? null : up;
};

type PoWithPartner = SpPcbPo & { partner: SpPartner };

// ── 발송 컨텍스트 — 생성 시 박제될 받는측·모드 해석 ──────────────────────────
export interface PcbShipContext {
  mode: BomShipmentModeType;
  receiverKind: 'admin' | 'md';
  receiverPartnerId: bigint | null;
  destinationCountry: string | null;
  senderCountry: string;
}

export type ResolveShipContextError = 'PARTNER_COUNTRY_REQUIRED';

export const resolvePcbShipContext = async (
  po: PoWithPartner,
): Promise<{ ok: true; ctx: PcbShipContext } | { ok: false; error: ResolveShipContextError }> => {
  const senderCountry = normalizeCountry(po.partner.country);
  if (senderCountry === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };

  let receiverKind: 'admin' | 'md' = 'admin';
  let receiverPartnerId: bigint | null = null;
  let receiverCountry = 'KR'; // 관리자(자사) = KR 고정(레거시 mbNo 0 규칙 승계)
  const destination = normalizeCountry(po.destinationCountry);
  if (destination !== null) {
    // 직송(D5) — MD 경유 여부와 무관하게 목적지로 바로, 받는측(확인 주체)은 관리자.
    receiverCountry = destination;
  } else if (po.parentPartnerId !== 0n) {
    // MD 입고 — 하위 수주자가 MD 에게 보낸다.
    const md = await prisma.spPartner.findUnique({ where: { id: po.parentPartnerId } });
    const mdCountry = normalizeCountry(md?.country);
    if (md === null || mdCountry === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
    receiverKind = 'md';
    receiverPartnerId = md.id;
    receiverCountry = mdCountry;
  }
  return {
    ok: true,
    ctx: {
      mode: senderCountry === receiverCountry ? 'domestic' : 'international',
      receiverKind,
      receiverPartnerId,
      destinationCountry: destination,
      senderCountry,
    },
  };
};

// ── 출고 게이팅 — MD 가 관리자에게 보내는 상위 출고는 하위 입고 완료 후(레거시) ──
export const isPcbOutboundBlocked = async (po: SpPcbPo): Promise<boolean> => {
  if (po.parentPartnerId !== 0n) return false; // 상위(관리자 수취) 발송만 게이트 대상
  const children = await prisma.spPcbPo.findMany({
    where: {
      specId: po.specId,
      parentPartnerId: po.partnerId,
      reorderRound: po.reorderRound,
      destinationCountry: null, // 직송 하위는 MD 입고가 없다 — 게이트 제외
    },
  });
  if (children.length === 0) return false;
  const links = await prisma.spPcbShipmentPo.findMany({
    where: { poId: { in: children.map((c) => c.id) } },
    include: { shipment: true },
  });
  const receivedPoIds = new Set(
    links.filter((l) => l.shipment.receivedAt !== null).map((l) => l.poId.toString()),
  );
  return !children.every((c) => receivedPoIds.has(c.id.toString()));
};

// ── 소속·생성 ────────────────────────────────────────────────────────────────
export const findPcbShipmentByPo = async (poId: bigint): Promise<SpPcbShipment | null> => {
  const link = await prisma.spPcbShipmentPo.findUnique({
    where: { poId },
    include: { shipment: true },
  });
  return link?.shipment ?? null;
};

export type EnsurePcbShipmentError =
  | 'NOT_PRODUCED'
  | 'PARTNER_COUNTRY_REQUIRED'
  | 'OUTBOUND_BLOCKED';

/** 대표 발주서로 발송을 확보(없으면 생성 — 모드·받는측·목적지 박제). */
export const ensurePcbShipment = async (
  po: PoWithPartner,
): Promise<{ ok: true; shipment: SpPcbShipment } | { ok: false; error: EnsurePcbShipmentError }> => {
  const existing = await findPcbShipmentByPo(po.id);
  if (existing !== null) return { ok: true, shipment: existing };
  if (po.status !== 'produced') return { ok: false, error: 'NOT_PRODUCED' };
  if (await isPcbOutboundBlocked(po)) return { ok: false, error: 'OUTBOUND_BLOCKED' };
  const ctx = await resolvePcbShipContext(po);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const shipment = await prisma.spPcbShipment.create({
    data: {
      poId: po.id,
      specId: po.specId,
      mode: ctx.ctx.mode,
      status: 'preparing',
      receiverKind: ctx.ctx.receiverKind,
      receiverPartnerId: ctx.ctx.receiverPartnerId,
      destinationCountry: ctx.ctx.destinationCountry,
      pos: { create: { poId: po.id } },
    },
  });
  return { ok: true, shipment };
};

// ── 첨부(invoice/airwaybill — 종류별 1건 교체, BOM D22 동형) ──────────────────
const toFileView = (f: SpFile): PcbShipmentFileViewType => ({
  fileId: Number(f.id),
  name: f.originFileName,
  size: Number(f.size),
  fileType: f.fileType === 'airwaybill' ? 'airwaybill' : 'invoice',
  uploadedBy: f.uploadedBy,
  uploadedAt: f.writeDate.toISOString(),
});

const loadShipmentFilesMap = async (
  shipmentIds: bigint[],
): Promise<Map<string, PcbShipmentFileViewType[]>> => {
  if (shipmentIds.length === 0) return new Map();
  const rows = await prisma.spFile.findMany({
    where: { refType: SHIPMENT_REF_TYPE, refId: { in: shipmentIds } },
    orderBy: { id: 'asc' },
  });
  const map = new Map<string, PcbShipmentFileViewType[]>();
  for (const row of rows) {
    const key = row.refId.toString();
    const list = map.get(key) ?? [];
    list.push(toFileView(row));
    map.set(key, list);
  }
  return map;
};

export const savePcbShipmentFile = async (
  shipmentId: bigint,
  kind: BomShipmentFileTypeType,
  file: UploadTarget,
  uploadedBy: 'ADMIN' | 'PARTNER' | 'MASTER_DEALER',
): Promise<void> => {
  const [uploaded] = await uploadToFileServer([file], SHIPMENT_UPLOAD_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('선적 파일 업로드에 실패했습니다');
  // 종류별 1건 — 기존 파일은 파일서버 먼저 지우고 교체(재시도 안전).
  const olds = await prisma.spFile.findMany({
    where: { refType: SHIPMENT_REF_TYPE, refId: shipmentId, fileType: kind },
  });
  for (const old of olds) {
    await deleteFromFileServer(old.pathToken);
    await prisma.spFile.delete({ where: { id: old.id } });
  }
  await prisma.spFile.create({
    data: {
      refType: SHIPMENT_REF_TYPE,
      refId: shipmentId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: file.filename,
      pathToken: uploaded.pathToken,
      size: BigInt(file.buffer.length),
      writeDate: new Date(),
      fileType: kind,
      uploadedBy,
    },
  });
};

export const deletePcbShipmentFile = async (
  shipmentId: bigint,
  fileId: bigint,
): Promise<boolean> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return false;
  if (row.refType !== SHIPMENT_REF_TYPE || row.refId !== shipmentId) return false;
  await deleteFromFileServer(row.pathToken);
  await prisma.spFile.delete({ where: { id: row.id } });
  return true;
};

export const getPcbShipmentFileDownload = async (
  shipmentId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return null;
  if (row.refType !== SHIPMENT_REF_TYPE || row.refId !== shipmentId) return null;
  return { pathToken: row.pathToken, originFileName: row.originFileName };
};

// ── 액터 해석 — 계약 사전의 ADMIN(받는측)/PARTNER(보내는측)를 실주체로 매핑 ────
export type PcbShipmentActor = { kind: 'admin' } | { kind: 'partner'; partnerId: bigint };

const senderPartnerIdOf = async (shipment: SpPcbShipment): Promise<bigint | null> => {
  const rep = await prisma.spPcbPo.findUnique({ where: { id: shipment.poId } });
  return rep?.partnerId ?? null;
};

const isSideActor = async (
  shipment: SpPcbShipment,
  side: 'ADMIN' | 'PARTNER',
  actor: PcbShipmentActor,
): Promise<boolean> => {
  // 관리자는 양측 대행 가능(BOM 관례 — "관리자는 전 단계 임의 조작" 승계).
  if (actor.kind === 'admin') return true;
  if (side === 'PARTNER') {
    const sender = await senderPartnerIdOf(shipment);
    return sender !== null && actor.partnerId === sender;
  }
  // 받는측 — md(MD 입고 확인 주체)만 협력사 계정으로 가능.
  return shipment.receiverKind === 'md' && actor.partnerId === shipment.receiverPartnerId;
};

// ── 전이·되돌리기·입고확인 — 서버 강제(레거시 L1 교정) ────────────────────────
export type PcbShipmentTransitionError =
  | 'PO_NOT_FOUND'
  | 'NOT_PRODUCED'
  | 'PARTNER_COUNTRY_REQUIRED'
  | 'OUTBOUND_BLOCKED'
  | 'ALREADY_FINAL'
  | 'NOT_YOUR_TURN'
  | 'MISSING_SHIP_DATE'
  | 'MISSING_INVOICE_FILE'
  | 'MISSING_TRACKING'
  | 'INVALID_GROUP_PO'
  | 'NOTHING_TO_REVERT'
  | 'RECEIVE_LOCKED'
  | 'NOT_SHIPPED';

export const advancePcbShipment = async (
  po: PoWithPartner,
  actor: PcbShipmentActor,
  body: PcbShipmentAdvanceBodyType,
): Promise<
  { ok: true; to: BomShipmentStatusType; shipment: SpPcbShipment } | { ok: false; error: PcbShipmentTransitionError }
> => {
  // 발송이 없으면 보내는측 첫 전이에서 생성(produced·게이팅 가드 포함).
  let shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) {
    const ensured = await ensurePcbShipment(po);
    if (!ensured.ok) return { ok: false, error: ensured.error };
    shipment = ensured.shipment;
  }

  const mode = asPcbShipmentMode(shipment.mode);
  const current = asPcbShipmentStatus(mode, shipment.status);
  const next = bomShipmentNextStatus(mode, current);
  if (next === null) return { ok: false, error: 'ALREADY_FINAL' };
  const side = bomShipmentActorOf(mode, next);
  if (side === null || !(await isSideActor(shipment, side, actor)))
    return { ok: false, error: 'NOT_YOUR_TURN' };

  // 함께 발송(§6.10) — 최초 발송 전이에서만. 같은 보내는측·produced·미소속·같은
  // 컨텍스트(받는측/목적지/회차 — 레거시 그룹 가드 승계).
  const repPartnerId = await senderPartnerIdOf(shipment);
  const withPoIds = [...new Set(body.withPoIds ?? [])].filter((id) => BigInt(id) !== po.id);
  if (withPoIds.length > 0) {
    if (next !== 'requested' && next !== 'shipping') return { ok: false, error: 'INVALID_GROUP_PO' };
    const companions = await prisma.spPcbPo.findMany({
      where: { id: { in: withPoIds.map((id) => BigInt(id)) } },
      include: { partner: true },
    });
    if (companions.length !== withPoIds.length) return { ok: false, error: 'INVALID_GROUP_PO' };
    const links = await prisma.spPcbShipmentPo.findMany({
      where: { poId: { in: companions.map((c) => c.id) } },
    });
    if (links.length > 0) return { ok: false, error: 'INVALID_GROUP_PO' };
    const rep = await prisma.spPcbPo.findUnique({ where: { id: shipment.poId } });
    for (const companion of companions) {
      if (
        companion.partnerId !== repPartnerId ||
        companion.status !== 'produced' ||
        companion.reorderRound !== (rep?.reorderRound ?? 0)
      )
        return { ok: false, error: 'INVALID_GROUP_PO' };
      const ctx = await resolvePcbShipContext(companion);
      if (
        !ctx.ok ||
        ctx.ctx.receiverKind !== shipment.receiverKind ||
        (ctx.ctx.receiverPartnerId?.toString() ?? null) !==
          (shipment.receiverPartnerId?.toString() ?? null) ||
        ctx.ctx.destinationCountry !== shipment.destinationCountry
      )
        return { ok: false, error: 'INVALID_GROUP_PO' };
    }
    await prisma.spPcbShipmentPo.createMany({
      data: companions.map((c) => ({ shipmentId: shipment.id, poId: c.id })),
    });
  }

  // 단계별 필수값(BOM D22 미러 + 국제 '선적'은 운송장 필수).
  if (next === 'requested') {
    if (body.shipDate == null || body.shipDate === '')
      return { ok: false, error: 'MISSING_SHIP_DATE' };
    const invoice = await prisma.spFile.findFirst({
      where: { refType: SHIPMENT_REF_TYPE, refId: shipment.id, fileType: 'invoice' },
    });
    if (invoice === null) return { ok: false, error: 'MISSING_INVOICE_FILE' };
  }
  if (next === 'shipping') {
    if (
      body.carrier == null ||
      body.carrier === '' ||
      body.trackingNumber == null ||
      body.trackingNumber === ''
    )
      return { ok: false, error: 'MISSING_TRACKING' };
  }
  if (next === 'shipped') {
    const tracking = body.trackingNumber ?? shipment.trackingNumber;
    if (tracking === null || tracking === '') return { ok: false, error: 'MISSING_TRACKING' };
  }

  const isFinal = bomShipmentNextStatus(mode, next) === null;
  const updated = await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: {
      status: next,
      ...(body.shipDate === undefined
        ? {}
        : { shipDate: body.shipDate === null || body.shipDate === '' ? null : parseKstDate(body.shipDate) }),
      ...(body.carrier === undefined ? {} : { carrier: body.carrier }),
      ...(body.trackingNumber === undefined ? {} : { trackingNumber: body.trackingNumber }),
      ...(body.trackingUrl === undefined ? {} : { trackingUrl: body.trackingUrl }),
      // 발송 박제 — 국제 '선적'(실선적)·국내 '배송 중' 진입 시 최초 1회.
      ...((next === 'shipped' || next === 'shipping') && shipment.shippedAt === null
        ? { shippedAt: new Date() }
        : {}),
      ...(isFinal ? { completedAt: new Date() } : {}),
    },
  });
  return { ok: true, to: next, shipment: updated };
};

export const revertPcbShipment = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
): Promise<{ ok: true; to: BomShipmentStatusType } | { ok: false; error: PcbShipmentTransitionError }> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (shipment.receivedAt !== null) return { ok: false, error: 'RECEIVE_LOCKED' };
  const mode = asPcbShipmentMode(shipment.mode);
  const current = asPcbShipmentStatus(mode, shipment.status);
  const prev = bomShipmentPrevStatus(mode, current);
  if (prev === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  // 직전에 그 상태로 진입시킨 주체만 되돌린다(BOM D22 동형).
  const side = bomShipmentActorOf(mode, current);
  if (side === null || !(await isSideActor(shipment, side, actor)))
    return { ok: false, error: 'NOT_YOUR_TURN' };
  await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: { status: prev, completedAt: null },
  });
  return { ok: true, to: prev };
};

/** 입고확인(검수) — 받는측 전용, 발송 시작 후 허용(조기 확인 가능 — UI 경고 몫). */
export const receivePcbShipment = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
  note: string | null,
): Promise<{ ok: true } | { ok: false; error: PcbShipmentTransitionError }> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOT_SHIPPED' };
  if (!(await isSideActor(shipment, 'ADMIN', actor))) return { ok: false, error: 'NOT_YOUR_TURN' };
  const mode = asPcbShipmentMode(shipment.mode);
  const current = asPcbShipmentStatus(mode, shipment.status);
  if (current === 'preparing') return { ok: false, error: 'NOT_SHIPPED' };
  await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: { receivedAt: new Date(), receivedNote: note },
  });
  return { ok: true };
};

/**
 * 선적 취소(문서 삭제) — 관리자 전용. 묶음이면 통째로 사라진다.
 *
 * 왜 필요한가: 협력사 detach 는 대표 발주서를 뺄 수 없어(REPRESENTATIVE_PO) 잘못 만든
 * 선적을 없앨 방법이 아예 없었다. 그래서 견적 영구 삭제의 SHIPMENT_EXISTS 차단(D13)이
 * 풀 수 없는 막다른 길이 됐다 — 취소 경로가 그 출구다.
 *
 * 위계는 발주 취소(deletePcbPo: issued 만)와 같다 — **발송 전(preparing)** 만 허용하고,
 * 그 이후 단계는 revert 로 내려온 뒤에야 취소된다. 입고 확인된 선적은 어떤 경우에도 불가.
 * 첨부는 파일서버 먼저 → DB 순서(고아 pathToken 방지, 재시도 멱등).
 */
export const cancelPcbShipment = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
): Promise<
  | { ok: true; poIds: bigint[] }
  | { ok: false; error: 'NOTHING_TO_REVERT' | 'NOT_YOUR_TURN' | 'NOT_PREPARING' | 'RECEIVE_LOCKED' }
> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (actor.kind !== 'admin') return { ok: false, error: 'NOT_YOUR_TURN' };
  if (shipment.receivedAt !== null) return { ok: false, error: 'RECEIVE_LOCKED' };
  if (asPcbShipmentStatus(asPcbShipmentMode(shipment.mode), shipment.status) !== 'preparing')
    return { ok: false, error: 'NOT_PREPARING' };

  const links = await prisma.spPcbShipmentPo.findMany({
    where: { shipmentId: shipment.id },
    select: { poId: true },
  });
  const files = await prisma.spFile.findMany({
    where: { refType: SHIPMENT_REF_TYPE, refId: shipment.id },
  });
  for (const file of files) {
    await deleteFromFileServer(file.pathToken);
    await prisma.spFile.delete({ where: { id: file.id } });
  }
  await prisma.spPcbShipment.delete({ where: { id: shipment.id } }); // 조인 cascade
  return { ok: true, poIds: links.map((l) => l.poId) };
};

/** 묶음에서 제외 — 보내는측, preparing 만, 대표 발주서 불가(BOM §6.10 초기 규칙). */
export const detachPcbShipmentPo = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
): Promise<{ ok: true } | { ok: false; error: PcbShipmentTransitionError | 'NOT_PREPARING' | 'REPRESENTATIVE_PO' }> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (!(await isSideActor(shipment, 'PARTNER', actor)))
    return { ok: false, error: 'NOT_YOUR_TURN' };
  if (asPcbShipmentStatus(asPcbShipmentMode(shipment.mode), shipment.status) !== 'preparing')
    return { ok: false, error: 'NOT_PREPARING' };
  if (shipment.poId === po.id) return { ok: false, error: 'REPRESENTATIVE_PO' };
  await prisma.spPcbShipmentPo.delete({ where: { poId: po.id } });
  return { ok: true };
};

// ── 직렬화 ───────────────────────────────────────────────────────────────────
export const toPcbShipmentView = async (
  shipment: SpPcbShipment & { pos?: { poId: bigint }[] },
): Promise<PcbShipmentViewType> => {
  const [links, files, rep, house] = await Promise.all([
    shipment.pos !== undefined
      ? Promise.resolve(shipment.pos)
      : prisma.spPcbShipmentPo.findMany({ where: { shipmentId: shipment.id } }),
    loadShipmentFilesMap([shipment.id]),
    prisma.spPcbPo.findUnique({ where: { id: shipment.poId }, include: { partner: true } }),
    loadHousePartnerName(),
  ]);
  const receiverName =
    shipment.receiverKind === 'md'
      ? ((
          await prisma.spPartner.findUnique({
            where: { id: shipment.receiverPartnerId ?? 0n },
          })
        )?.name ?? '중개 조직')
      : house;
  return {
    shipmentId: Number(shipment.id),
    poId: Number(shipment.poId),
    specId: Number(shipment.specId),
    mode: asPcbShipmentMode(shipment.mode),
    status: asPcbShipmentStatus(asPcbShipmentMode(shipment.mode), shipment.status),
    receiverKind: shipment.receiverKind === 'md' ? 'md' : 'admin',
    receiverName,
    senderPartnerId: Number(rep?.partnerId ?? 0),
    senderName: rep?.partner.name ?? '',
    destinationCountry: shipment.destinationCountry,
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    shipDate: iso(shipment.shipDate),
    shippedAt: iso(shipment.shippedAt),
    receivedAt: iso(shipment.receivedAt),
    receivedNote: shipment.receivedNote,
    completedAt: iso(shipment.completedAt),
    poIds: links.map((l) => Number(l.poId)),
    files: files.get(shipment.id.toString()) ?? [],
  };
};

/** 발주서 집합의 소속 선적 뷰(중복 제거) — Case 발주 패널·포털 상세 공용. */
export const loadPcbShipmentsForPoIds = async (poIds: bigint[]): Promise<PcbShipmentViewType[]> => {
  if (poIds.length === 0) return [];
  const links = await prisma.spPcbShipmentPo.findMany({
    where: { poId: { in: poIds } },
    include: { shipment: true },
  });
  const seen = new Set<string>();
  const out: PcbShipmentViewType[] = [];
  for (const link of links) {
    const key = link.shipment.id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(await toPcbShipmentView(link.shipment));
  }
  return out;
};

/** 같이 보낼 후보 — 같은 보내는측·produced·미배정·같은 컨텍스트·같은 회차. */
export const loadShippableCompanions = async (
  po: PoWithPartner,
): Promise<{ poId: number; projectName: string }[]> => {
  const baseCtx = await resolvePcbShipContext(po);
  if (!baseCtx.ok) return [];
  const candidates = await prisma.spPcbPo.findMany({
    where: {
      partnerId: po.partnerId,
      status: 'produced',
      reorderRound: po.reorderRound,
      id: { not: po.id },
    },
    include: { partner: true, spec: true },
  });
  const out: { poId: number; projectName: string }[] = [];
  for (const candidate of candidates) {
    const link = await prisma.spPcbShipmentPo.findUnique({ where: { poId: candidate.id } });
    if (link !== null) continue;
    const ctx = await resolvePcbShipContext(candidate);
    if (
      !ctx.ok ||
      ctx.ctx.receiverKind !== baseCtx.ctx.receiverKind ||
      (ctx.ctx.receiverPartnerId?.toString() ?? null) !==
        (baseCtx.ctx.receiverPartnerId?.toString() ?? null) ||
      ctx.ctx.destinationCountry !== baseCtx.ctx.destinationCountry
    )
      continue;
    out.push({ poId: Number(candidate.id), projectName: candidate.spec.projectName });
  }
  return out;
};

/** 받는측 차례 판정(목록 myTurn·워크큐 공용) — 다음 전이가 받는측이거나 최종·입고 미확인. */
export const pcbShipmentReceiverTurn = (shipment: SpPcbShipment): boolean => {
  const mode = asPcbShipmentMode(shipment.mode);
  const current = asPcbShipmentStatus(mode, shipment.status);
  const next = bomShipmentNextStatus(mode, current);
  if (next !== null) return bomShipmentActorOf(mode, next) === 'ADMIN';
  return shipment.receivedAt === null; // 최종 도달·입고확인 대기
};

export const pcbShipmentSenderTurn = (shipment: SpPcbShipment): boolean => {
  const mode = asPcbShipmentMode(shipment.mode);
  const current = asPcbShipmentStatus(mode, shipment.status);
  const next = bomShipmentNextStatus(mode, current);
  return next !== null && bomShipmentActorOf(mode, next) === 'PARTNER';
};

// ── 상업송장(D23 동형 — BomInvoiceData·renderInvoiceXlsx 재사용) ──────────────
export type PcbInvoiceError = 'NOT_SHIPMENT' | 'DOMESTIC_INVOICE';

const COUNTRY_NAMES: Record<string, string> = { KR: 'KOREA', CN: 'CHINA', VN: 'VIETNAM' };

export const buildPcbInvoiceDraft = async (
  shipment: SpPcbShipment,
  fresh: boolean,
): Promise<{ ok: true; data: BomInvoiceDataType } | { ok: false; error: PcbInvoiceError }> => {
  if (asPcbShipmentMode(shipment.mode) === 'domestic')
    return { ok: false, error: 'DOMESTIC_INVOICE' };
  if (!fresh && shipment.invoiceData !== null) {
    const parsed = BomInvoiceData.safeParse(shipment.invoiceData);
    if (parsed.success) return { ok: true, data: parsed.data };
  }

  const [links, rep, business, house] = await Promise.all([
    prisma.spPcbShipmentPo.findMany({ where: { shipmentId: shipment.id } }),
    prisma.spPcbPo.findUnique({ where: { id: shipment.poId }, include: { partner: true } }),
    getBusinessInfo(),
    loadHousePartnerName(),
  ]);
  const pos = await prisma.spPcbPo.findMany({
    where: { id: { in: links.map((l) => l.poId) } },
    include: { spec: true },
    orderBy: { id: 'asc' },
  });
  const sender = rep?.partner ?? null;
  const senderCountry = normalizeCountry(sender?.country) ?? '';
  const currency = rep?.currency === 'KRW' ? 'USD' : (rep?.currency ?? 'USD'); // 레거시: 국제 송장 통화 USD 관행
  const items = pos.map((po) => {
    const total = Number(po.priceOriginal);
    const qty = po.spec.qty;
    return {
      description: po.spec.projectName,
      hsCode: '',
      qty: `${String(qty)}PCS`,
      currency,
      unitValue: qty > 0 ? Math.round((total / qty) * 100) / 100 : null,
      totalValue: total,
    };
  });
  const receiverIsAdmin = shipment.receiverKind !== 'md';
  const md = receiverIsAdmin
    ? null
    : await prisma.spPartner.findUnique({ where: { id: shipment.receiverPartnerId ?? 0n } });
  const destCountry =
    shipment.destinationCountry ?? (receiverIsAdmin ? 'KR' : normalizeCountry(md?.country) ?? '');
  return {
    ok: true,
    data: {
      companyName: sender?.name ?? '',
      shipperName: sender?.contactName ?? '',
      shipperAddress: sender?.businessAddress ?? '',
      shipperTel: sender?.contactPhone ?? '',
      countryOfOrigin: COUNTRY_NAMES[senderCountry] ?? senderCountry,
      countryOfDestination: COUNTRY_NAMES[destCountry] ?? destCountry,
      consigneeCompany: receiverIsAdmin ? (business?.companyName ?? house) : (md?.name ?? ''),
      consigneeContact: receiverIsAdmin
        ? (business?.infoManagerName ?? '')
        : (md?.contactName ?? ''),
      consigneeAddress: receiverIsAdmin ? (business?.addr ?? '') : (md?.businessAddress ?? ''),
      consigneeTel: receiverIsAdmin ? (business?.tel ?? '') : (md?.contactPhone ?? ''),
      consigneeFax: receiverIsAdmin ? (business?.fax ?? '') : (md?.fax ?? ''),
      consigneeEmail: receiverIsAdmin
        ? (business?.infoManagerEmail ?? '')
        : (md?.contactEmail ?? ''),
      countryOfManufacture: COUNTRY_NAMES[senderCountry] ?? senderCountry,
      invoiceNo: `SPCB-P${shipment.poId.toString()}-${shipment.id.toString()}`,
      netWeight: '',
      grossWeight: '',
      currency,
      invoiceDate: kstDateStr(new Date()),
      items,
      totalValue: items.reduce((sum, item) => sum + item.totalValue, 0),
    },
  };
};

export const savePcbInvoiceData = async (
  shipmentId: bigint,
  data: BomInvoiceDataType,
): Promise<void> => {
  await prisma.spPcbShipment.update({ where: { id: shipmentId }, data: { invoiceData: data } });
};

// ── 관리자 선적 워크큐 — 관리자 차례(받는측 admin 전이·입고 미확인 최종) 중심 ──
export type AdminPcbShipmentTab = 'pending' | 'active' | 'received';

export const loadAdminPcbShipmentWorkItems = async (): Promise<
  {
    item: {
      shipmentId: number;
      poId: number;
      specId: number;
      projectName: string;
      senderName: string;
      receiverKind: 'admin' | 'md';
      receiverName: string;
      mode: BomShipmentModeType;
      status: BomShipmentStatusType;
      poCount: number;
      receivedAt: string | null;
      adminTurn: boolean;
      createdAt: string;
    };
    tab: AdminPcbShipmentTab;
  }[]
> => {
  const shipments = await prisma.spPcbShipment.findMany({
    include: { pos: true },
    orderBy: { createdAt: 'desc' },
  });
  const house = await loadHousePartnerName();
  const out = [];
  for (const shipment of shipments) {
    const rep = await prisma.spPcbPo.findUnique({
      where: { id: shipment.poId },
      include: { partner: true, spec: true },
    });
    const receiverName =
      shipment.receiverKind === 'md'
        ? ((
            await prisma.spPartner.findUnique({ where: { id: shipment.receiverPartnerId ?? 0n } })
          )?.name ?? '중개 조직')
        : house;
    const adminTurn = shipment.receiverKind !== 'md' && pcbShipmentReceiverTurn(shipment);
    const tab: AdminPcbShipmentTab =
      shipment.receivedAt !== null ? 'received' : adminTurn ? 'pending' : 'active';
    out.push({
      item: {
        shipmentId: Number(shipment.id),
        poId: Number(shipment.poId),
        specId: Number(shipment.specId),
        projectName: rep?.spec.projectName ?? `Q${shipment.specId.toString()}`,
        senderName: rep?.partner.name ?? '',
        receiverKind: shipment.receiverKind === 'md' ? ('md' as const) : ('admin' as const),
        receiverName,
        mode: asPcbShipmentMode(shipment.mode),
        status: asPcbShipmentStatus(asPcbShipmentMode(shipment.mode), shipment.status),
        poCount: shipment.pos.length,
        receivedAt: iso(shipment.receivedAt),
        adminTurn,
        createdAt: shipment.createdAt.toISOString(),
      },
      tab,
    });
  }
  return out;
};
