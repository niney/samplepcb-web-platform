import { Prisma } from '@prisma/client';
import type { SpFile, SpPartner, SpPcbPo, SpPcbShipment } from '@prisma/client';
import type {
  BomInvoiceDataType,
  BomShipmentFileTypeType,
  BomShipmentModeType,
  BomShipmentStatusType,
  PartnerPcbShipBoxType,
  PartnerPcbShipShelfItemType,
  PcbShipmentAdvanceBodyType,
  PcbShipmentFileViewType,
  PcbShipmentViewType,
} from '@sp/api-contract';
import {
  BOM_SHIPMENT_DOMESTIC_STATUSES,
  BOM_SHIPMENT_INTL_STATUSES,
  BomInvoiceData,
  PCB_PO_STATUSES,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentPrevStatus,
  type PcbPoStatusType,
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

/** 묶음 컨텍스트 키 — 같은 박스로 담길 수 있는 조건(받는측·받는조직·직송지·회차)의
 *  문자열화. 보내기 보드의 선반↔박스 매칭 축이자 담기(ensure) 합류 판정의 축. */
export const pcbShipContextKey = (
  ctx: Pick<PcbShipContext, 'receiverKind' | 'receiverPartnerId' | 'destinationCountry'>,
  reorderRound: number,
): string =>
  `${ctx.receiverKind}:${(ctx.receiverPartnerId ?? 0n).toString()}:${ctx.destinationCountry ?? '-'}:r${String(reorderRound)}`;

/** 같은 컨텍스트의 준비 중 박스 — 보내는 조직·회차까지 일치해야 한다(대표 발주서 기준). */
const findPreparingPcbShipment = async (
  po: SpPcbPo,
  ctx: PcbShipContext,
): Promise<SpPcbShipment | null> => {
  const rows = await prisma.spPcbShipment.findMany({
    where: {
      status: 'preparing',
      receiverKind: ctx.receiverKind,
      receiverPartnerId: ctx.receiverPartnerId,
      destinationCountry: ctx.destinationCountry,
    },
    orderBy: { id: 'asc' },
  });
  for (const row of rows) {
    const rep = await prisma.spPcbPo.findUnique({ where: { id: row.poId } });
    if (rep !== null && rep.partnerId === po.partnerId && rep.reorderRound === po.reorderRound)
      return row;
  }
  return null;
};

export type EnsurePcbShipmentError =
  | 'NOT_PRODUCED'
  | 'PARTNER_COUNTRY_REQUIRED'
  | 'OUTBOUND_BLOCKED';

/** 담기(박스 확보) — 이미 소속이면 그 발송, **같은 컨텍스트의 preparing 박스가 있으면
 *  합류**, 없으면 생성(모드·받는측·목적지 박제). 합류 의미론이 기본값인 이유: 구
 *  모델(발주서마다 발송 생성 + 전이 순간 withPoIds)에선 발주서마다 [발송 준비]를 누르는
 *  순간 서로 다른 발송에 소속돼 영영 묶을 수 없었다(§9 재구성 — 실사용 도달 불가 판정). */
export const ensurePcbShipment = async (
  po: PoWithPartner,
): Promise<{ ok: true; shipment: SpPcbShipment } | { ok: false; error: EnsurePcbShipmentError }> => {
  const existing = await findPcbShipmentByPo(po.id);
  if (existing !== null) return { ok: true, shipment: existing };
  if (po.status !== 'produced') return { ok: false, error: 'NOT_PRODUCED' };
  if (await isPcbOutboundBlocked(po)) return { ok: false, error: 'OUTBOUND_BLOCKED' };
  const ctx = await resolvePcbShipContext(po);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const box = await findPreparingPcbShipment(po, ctx.ctx);
  if (box !== null) {
    await prisma.spPcbShipmentPo.create({ data: { shipmentId: box.id, poId: po.id } });
    // 구성 변경 — 저장된 상업송장 편집본은 품목이 달라져 무효(품목 누락 송장 방지).
    await prisma.spPcbShipment.update({
      where: { id: box.id },
      data: { invoiceData: Prisma.DbNull },
    });
    return { ok: true, shipment: box };
  }

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

  // 최초 발송 전이 — 담은 뒤 하위 발주가 새로 생겼을 수 있어 **묶음 전체**의 출고
  // 게이팅을 재검한다(MD 상위 출고는 하위 입고 완료 후 — 레거시 규칙. 구 withPoIds
  // 검증엔 이 검사가 빠져 동반 발주서로 게이트를 우회할 수 있었다 — §9 재구성 교정).
  if (current === 'preparing') {
    const links = await prisma.spPcbShipmentPo.findMany({ where: { shipmentId: shipment.id } });
    const members = await prisma.spPcbPo.findMany({
      where: { id: { in: links.map((l) => l.poId) } },
    });
    for (const member of members) {
      if (await isPcbOutboundBlocked(member)) return { ok: false, error: 'OUTBOUND_BLOCKED' };
    }
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
 * §9 재구성으로 협력사도 detach(대표 승계·빈 박스 소멸)로 발송을 스스로 정리할 수
 * 있게 됐지만, 관리자의 한 번에 취소(견적 영구 삭제의 SHIPMENT_EXISTS 차단 D13 의
 * 출구)로 여전히 유용해 유지한다.
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

/** 박스에서 꺼내기 — 보내는측, preparing 만. "대표" 개념은 사용자에게서 숨긴다
 * (BOM §6.11 개정 동형): 대표를 꺼내면 남은 발주서로 자동 승계하고, 마지막을 꺼내면
 * 발송 자체를 정리한다(첨부 실파일 → sp_file → 행 — 고아 pathToken 방지). 구
 * REPRESENTATIVE_PO 규칙(대표 불가)은 협력사가 잘못 만든 발송을 스스로 풀 수 없는
 * 막다른 길이라 폐기(§9 재구성). */
export const detachPcbShipmentPo = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
): Promise<{ ok: true } | { ok: false; error: PcbShipmentTransitionError | 'NOT_PREPARING' }> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  if (!(await isSideActor(shipment, 'PARTNER', actor)))
    return { ok: false, error: 'NOT_YOUR_TURN' };
  if (asPcbShipmentStatus(asPcbShipmentMode(shipment.mode), shipment.status) !== 'preparing')
    return { ok: false, error: 'NOT_PREPARING' };

  const links = await prisma.spPcbShipmentPo.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { id: 'asc' },
  });
  const remaining = links.filter((link) => link.poId !== po.id);

  if (remaining.length === 0) {
    // 빈 박스는 소멸 — 첨부 실파일 먼저 정리(고아 pathToken 방지, 재시도 멱등).
    const files = await prisma.spFile.findMany({
      where: { refType: SHIPMENT_REF_TYPE, refId: shipment.id },
    });
    for (const file of files) {
      await deleteFromFileServer(file.pathToken);
      await prisma.spFile.delete({ where: { id: file.id } });
    }
    await prisma.spPcbShipment.delete({ where: { id: shipment.id } }); // 조인 cascade
    return { ok: true };
  }

  await prisma.spPcbShipmentPo.delete({ where: { poId: po.id } });
  // 대표 승계는 내부 참조 정리일 뿐 — 사용자 규칙에 노출하지 않는다. 구성이 바뀌었으니
  // 저장된 상업송장 편집본도 무효(품목 누락 송장 방지).
  const heir =
    shipment.poId === po.id
      ? await prisma.spPcbPo.findUnique({ where: { id: remaining[0]?.poId ?? 0n } })
      : null;
  await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: {
      invoiceData: Prisma.DbNull,
      ...(heir === null ? {} : { poId: heir.id, specId: heir.specId }),
    },
  });
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
  const memberPos = await prisma.spPcbPo.findMany({
    where: { id: { in: links.map((l) => l.poId) } },
    include: { spec: true },
    orderBy: { id: 'asc' },
  });
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
    groupPos: memberPos.map((member) => ({
      poId: Number(member.id),
      projectName: member.spec.projectName,
      qty: member.spec.qty,
      currency: member.currency,
      priceOriginal: Number(member.priceOriginal),
    })),
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

/** [📦 PCB 보내기] 보드 — 선반(수주 produced·미편성)·곧 보낼 물건(생산완료 전)·
 *  박스(preparing)·진행·완료 수. 받는 곳이 갈릴 수 있어(관리자/직송/MD) 선반 카드는
 *  contextKey 로 박스와 매칭한다. 협력사 관점 완료 = 최종 도달 또는 입고 확인(BOM §6.11). */
export const loadPartnerPcbShipBoard = async (
  partnerId: bigint,
): Promise<{
  shelf: PartnerPcbShipShelfItemType[];
  producing: { poId: number; projectName: string; qty: number; status: PcbPoStatusType }[];
  boxes: PartnerPcbShipBoxType[];
  active: PcbShipmentViewType[];
  doneCount: number;
}> => {
  const myPos = await prisma.spPcbPo.findMany({
    where: { partnerId },
    include: { partner: true, spec: true },
    orderBy: { id: 'asc' },
  });
  const links = await prisma.spPcbShipmentPo.findMany({
    where: { poId: { in: myPos.map((p) => p.id) } },
  });
  const linkedPoIds = new Set(links.map((l) => l.poId.toString()));

  // 곧 보낼 물건 — BOM 은 확인 즉시 선반이지만 PCB 는 생산완료 전까지 담을 수 없다.
  // 발주 확인(EQ 진행) 시점부터의 발송 가시성은 이 목록이 담당한다(홈 카드 보조 표기 공용).
  // 상태 캐스트는 로컬로 둔다 — lib/pcb-po.ts 의 asPcbPoStatus 를 쓰면 순환 import.
  const asBoardPoStatus = (v: string): PcbPoStatusType =>
    (PCB_PO_STATUSES as readonly string[]).includes(v) ? (v as PcbPoStatusType) : 'issued';
  const producing = myPos
    .filter((po) => po.status !== 'produced')
    .map((po) => ({
      poId: Number(po.id),
      projectName: po.spec.projectName,
      qty: po.spec.qty,
      status: asBoardPoStatus(po.status),
    }));

  const mdNames = new Map<string, string>();
  const shelf: PartnerPcbShipShelfItemType[] = [];
  for (const po of myPos) {
    if (po.status !== 'produced' || linkedPoIds.has(po.id.toString())) continue;
    const ctx = await resolvePcbShipContext(po);
    let receiverLabel = '샘플피씨비';
    let contextKey = '';
    if (ctx.ok) {
      contextKey = pcbShipContextKey(ctx.ctx, po.reorderRound);
      if (ctx.ctx.destinationCountry !== null) {
        receiverLabel = `직송 ${ctx.ctx.destinationCountry}`;
      } else if (ctx.ctx.receiverKind === 'md') {
        const key = (ctx.ctx.receiverPartnerId ?? 0n).toString();
        if (!mdNames.has(key)) {
          const md = await prisma.spPartner.findUnique({
            where: { id: ctx.ctx.receiverPartnerId ?? 0n },
          });
          mdNames.set(key, md?.name ?? '중개 조직');
        }
        receiverLabel = `MD ${mdNames.get(key) ?? ''}`;
      }
    }
    shelf.push({
      poId: Number(po.id),
      projectName: po.spec.projectName,
      qty: po.spec.qty,
      currency: po.currency,
      priceOriginal: Number(po.priceOriginal),
      reorderRound: po.reorderRound,
      receiverLabel,
      contextKey,
      outboundBlocked: await isPcbOutboundBlocked(po),
      countryReady: ctx.ok,
    });
  }

  // 발송 — 대표 발주서가 내 것인 발송 전체(보내는측 = 대표 조직, 가드 불변식).
  const shipments = await prisma.spPcbShipment.findMany({
    where: { poId: { in: myPos.map((p) => p.id) } },
    orderBy: { id: 'asc' },
  });
  const boxes: PartnerPcbShipBoxType[] = [];
  const active: PcbShipmentViewType[] = [];
  let doneCount = 0;
  for (const shipment of shipments) {
    const mode = asPcbShipmentMode(shipment.mode);
    const status = asPcbShipmentStatus(mode, shipment.status);
    if (status === 'preparing') {
      const rep = await prisma.spPcbPo.findUnique({ where: { id: shipment.poId } });
      boxes.push({
        ...(await toPcbShipmentView(shipment)),
        contextKey: pcbShipContextKey(
          {
            receiverKind: shipment.receiverKind === 'md' ? 'md' : 'admin',
            receiverPartnerId: shipment.receiverPartnerId,
            destinationCountry: shipment.destinationCountry,
          },
          rep?.reorderRound ?? 0,
        ),
      });
    } else if (shipment.receivedAt !== null || bomShipmentNextStatus(mode, status) === null) {
      doneCount += 1;
    } else {
      active.push(await toPcbShipmentView(shipment));
    }
  }
  return { shelf, producing, boxes, active, doneCount };
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
