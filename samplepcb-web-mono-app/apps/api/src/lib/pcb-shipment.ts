import { Prisma } from '@prisma/client';
import type { SpFile, SpPartner, SpPcbPo, SpPcbShipment } from '@prisma/client';
import type {
  AdminPcbShipmentViewType,
  AdminPcbShipmentWorkItemType,
  BomInvoiceDataType,
  BomShipmentModeType,
  BomShipmentStatusType,
  PartnerPcbShipBoxType,
  PartnerPcbShipShelfItemType,
  PcbShipmentAdvanceBodyType,
  PcbShipmentFileTypeType,
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
import { getBusinessInfo, getOrderInfoByCtId, isCanceledCartStatus } from './g5-db';
import { loadPcbCustomerNames } from './pcb-customer';
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

/**
 * 발송에 담긴 발주서 수 — 알림 문구가 "대표 하나"로 읽히지 않게 하는 값(여정 9호).
 * 묶음이면 이 메일 한 통이 여러 발주(때로 여러 고객)를 가리킨다.
 */
export const countPcbShipmentPos = async (poId: bigint): Promise<number> => {
  const link = await prisma.spPcbShipmentPo.findUnique({ where: { poId } });
  if (link === null) return 1;
  return prisma.spPcbShipmentPo.count({ where: { shipmentId: link.shipmentId } });
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

/**
 * 이 스펙의 **주문 또는 그 줄**이 취소됐는가 — 협력 트랙의 **새 작업 시작**(EQ 전진·하위
 * 발주·담기·A/S 접수)을 막는 판정에 쓴다. 주문 취소 후에도 PO·EQ·선적 라우트가 주문을 전혀
 * 보지 않아 취소된 보드가 그대로 생산·발송되던 것(재작업 조사 실증)의 최소 방어다.
 *
 * 판정 축은 **둘**이다(여정 10호 교정 — 둘 중 하나면 취소):
 *   ① 주문 헤더 od_status='취소'(전량 취소)
 *   ② 그 스펙의 카트행 ct_status 가 취소류(취소·반품·품절)
 * ②가 없으면 **부분 취소가 통째로 새어 나간다** — 영카트는 줄 단위로 취소하고 전량일 때만
 * od 를 '취소'로 내리므로, 한 주문서의 한 줄만 취소하면 od 는 '입금' 그대로다. 여정 10호는
 * 그 상태에서 담기·EQ 전진·A/S 접수가 모두 200 으로 통과해 취소된 보드가 박스에 담기는 것을
 * 실증했다. 줄 상태는 getOrderInfoByCtId 가 이미 rowCtStatus 로 함께 돌려준다(카탈로그 ⑲).
 *
 * 정리 작업(revert·detach·발주 취소)과 이미 시작된 발송의 전이·입고는 막지 않는다 —
 * 실물이 움직인 기록은 남겨야 한다. '완료' 는 A/S 재발주(P4) 설계와 얽혀 여기서 안 본다.
 */
export const isPcbOrderLineCanceled = async (specId: bigint): Promise<boolean> => {
  const spec = await prisma.spOrderSpec.findUnique({ where: { id: specId } });
  if (spec?.ctId == null) return false;
  const order = await getOrderInfoByCtId(spec.ctId);
  if (order === null) return false;
  return order.odStatus === '취소' || isCanceledCartStatus(order.rowCtStatus);
};

/** 유니크 위반(P2002) — 동시 요청이 겹쳤다는 신호. 실패가 아니라 "남이 먼저 했다"다. */
export const isPcbUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export type EnsurePcbShipmentError =
  | 'NOT_PRODUCED'
  | 'PARTNER_COUNTRY_REQUIRED'
  | 'OUTBOUND_BLOCKED'
  | 'ORDER_CANCELED';

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
  if (await isPcbOrderLineCanceled(po.specId)) return { ok: false, error: 'ORDER_CANCELED' };
  if (await isPcbOutboundBlocked(po)) return { ok: false, error: 'OUTBOUND_BLOCKED' };
  const ctx = await resolvePcbShipContext(po);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  // 동시 담기(여정 16호 C3) — 조회와 생성 사이가 경합 창이다. 협력사 포털 [담기]와 관리자
  // [발송 시작]이 같은 순간 눌리면 둘 다 "박스 없음"을 보고 각자 만들려 든다. 데이터는
  // `sp_pcb_shipment_po.poId` UNIQUE 가 지켜 주지만, 그 P2002 를 그냥 두면 **안내 없는 500**
  // 이 된다. 합류 의미론에서 "이미 담겼다"는 실패가 아니라 **성공**이므로, 진 쪽은 이긴 쪽의
  // 박스를 재조회해 돌려준다(호출자에겐 순서만 다를 뿐 결과가 같다).
  const joined = async (): Promise<{ ok: true; shipment: SpPcbShipment } | null> => {
    const existing = await findPcbShipmentByPo(po.id);
    return existing === null ? null : { ok: true, shipment: existing };
  };

  const box = await findPreparingPcbShipment(po, ctx.ctx);
  if (box !== null) {
    try {
      await prisma.spPcbShipmentPo.create({ data: { shipmentId: box.id, poId: po.id } });
    } catch (e) {
      if (!isPcbUniqueViolation(e)) throw e;
      const raced = await joined();
      if (raced !== null) return raced;
      throw e;
    }
    // 구성 변경 — 저장된 상업송장 편집본은 품목이 달라져 무효(품목 누락 송장 방지).
    await prisma.spPcbShipment.update({
      where: { id: box.id },
      data: { invoiceData: Prisma.DbNull },
    });
    return { ok: true, shipment: box };
  }

  try {
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
  } catch (e) {
    if (!isPcbUniqueViolation(e)) throw e;
    const raced = await joined();
    if (raced !== null) return raced;
    throw e;
  }
};

// ── 첨부(invoice/airwaybill — 종류별 1건 교체, BOM D22 동형) ──────────────────
const toFileView = (f: SpFile): PcbShipmentFileViewType => ({
  fileId: Number(f.id),
  name: f.originFileName,
  size: Number(f.size),
  fileType:
    f.fileType === 'airwaybill' ? 'airwaybill' : f.fileType === 'origin_cert' ? 'origin_cert' : 'invoice',
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
  kind: PcbShipmentFileTypeType,
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
  | 'CASE_REF_REQUIRED'
  | 'CASE_REF_LOCKED'
  | 'MISSING_AWB_FILE'
  | 'NOT_ADMIN_RECEIVER'
  | 'NOTHING_TO_REVERT'
  | 'RECEIVE_LOCKED'
  | 'RECEIVE_REQUIRED'
  | 'ORDER_CANCELED'
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

  // 발송 참조번호(Case ID) 체크(2026-08-13 재편) — '선적 요청' 전이에 얹혀 온다.
  // 체크 = 자사 주선 발송: 이후 서류(Case ID·운송장·AWB)는 관리자 몫이 된다.
  // 자사(admin) 수신 발송에서만 성립 — MD 수신 박스의 참조값은 MD 조직 몫이다.
  const wantsCaseRef = body.caseRefRequested === true && next === 'requested';
  if (wantsCaseRef && shipment.receiverKind !== 'admin')
    return { ok: false, error: 'NOT_ADMIN_RECEIVER' };

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
  // 발송 참조번호(Case ID) 게이트 — 요청된 발송의 실발송 전이(운송장 박제)는 참조번호
  // 없이 넘어갈 수 없다(요청해 놓고 값 없이 부치면 이 기능은 메모장이다). 관리자 '선적'
  // 프롬프트가 운송장과 함께 caseRef 를 받으므로(body) 한 번에 처리된다.
  const resolvedCaseRef =
    body.caseRef != null && body.caseRef !== '' ? body.caseRef : (shipment.caseRef ?? '');
  if (
    (next === 'shipped' || next === 'shipping') &&
    shipment.caseRefRequestedAt !== null &&
    resolvedCaseRef === ''
  ) {
    return { ok: false, error: 'CASE_REF_REQUIRED' };
  }
  // 체크 갈래의 국제 '선적'은 AWB 첨부도 필수(사용자 결정 08-13) — 이 갈래의 존재 이유다.
  // 파트너는 AWB 를 낼 수 없고(자사 운송 계약) 관리자가 부킹 후 첨부한다.
  if (next === 'shipped' && shipment.caseRefRequestedAt !== null) {
    const awb = await prisma.spFile.findFirst({
      where: { refType: SHIPMENT_REF_TYPE, refId: shipment.id, fileType: 'airwaybill' },
    });
    if (awb === null) return { ok: false, error: 'MISSING_AWB_FILE' };
  }
  // 국내 종점('입고 완료')은 입고확인과 같은 사건이다 — 전이만 따로 세우면 상태는 끝났는데
  // receivedAt 이 비어 다음 일(MD 상위 출고 해제·고객 배송 큐·Case 배지)이 하나도 안 열린다.
  // BOM 은 이미 이렇게 묶여 있다(bom-po.ts:690 RECEIVE_REQUIRED) — PCB 만 풀려 있던 것.
  if (next === 'delivered' && shipment.receivedAt === null) {
    return { ok: false, error: 'RECEIVE_REQUIRED' };
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
      // Case ID 갈래 박제 — 체크는 '선적 요청'과 함께, 값 입력은 '선적'과 함께 온다.
      ...(wantsCaseRef
        ? { caseRefRequestedAt: new Date(), caseRefNote: body.caseRefNote ?? null }
        : {}),
      ...(body.caseRef != null && body.caseRef !== ''
        ? { caseRef: body.caseRef, caseRefFilledAt: new Date() }
        : {}),
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
  // 국내는 '입고 완료'가 곧 이 사건이라 상태까지 여기서 닫는다(BOM 동형). 국제는 통관·완료가
  // 뒤에 남아 있어 검수 시각만 남기고 체인은 그대로 둔다 — 조기 입고확인도 그래서 허용된다.
  const closesChain = mode === 'domestic' && current === 'shipping';
  const receivedAt = new Date();
  await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: {
      receivedAt,
      receivedNote: note,
      ...(closesChain ? { status: 'delivered', completedAt: receivedAt } : {}),
    },
  });
  return { ok: true };
};

// ── 발송 참조번호(Case ID) 갈래(2026-08-13 재편) ─────────────────────────────
// 체크(협력사, '선적 요청' 전이 동반) → 서류 처리(관리자: 인보이스 수정·Case ID·운송장·
// AWB) → 협력사는 서류 확인 후 라벨링·인계. **상태 사전(BOM 공유)은 불변** — 문서 필드
// + 차례 신호(워크큐 adminTurn)로만. 자사(admin) 수신 발송 한정.

/** 사후 요청 — 주 경로는 '선적 요청' 폼의 체크박스(advance body)다. 이 함수는 전이 밖
 *  정정·API 경로로 남긴다(예: 체크 없이 요청해 둔 발송의 메모 갱신). 실발송 후엔 잠금. */
export const requestPcbShipmentCaseRef = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
  note: string | null,
): Promise<{ ok: true; shipment: SpPcbShipment } | { ok: false; error: PcbShipmentTransitionError }> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOT_SHIPPED' };
  if (shipment.receiverKind !== 'admin') return { ok: false, error: 'NOT_ADMIN_RECEIVER' };
  if (!(await isSideActor(shipment, 'PARTNER', actor))) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (shipment.shippedAt !== null || shipment.receivedAt !== null)
    return { ok: false, error: 'CASE_REF_LOCKED' };
  // 재요청은 메모 갱신(멱등) — 입력이 이미 됐다면 pending 으로 되돌리지 않는다
  // (pending 판정은 caseRef 부재 기준이라 값이 있으면 관리자 차례가 다시 서지 않는다).
  const updated = await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: { caseRefRequestedAt: new Date(), caseRefNote: note },
  });
  return { ok: true, shipment: updated };
};

/** 입력 — 관리자 전용. 요청 없이도 기록할 수 있다(관리자 자체 메모 관례). 입고 전까지
 *  정정 허용(오타 교정 실무), 입고확인 뒤엔 원장 잠금. */
export const fillPcbShipmentCaseRef = async (
  po: SpPcbPo,
  actor: PcbShipmentActor,
  caseRef: string,
): Promise<{ ok: true; shipment: SpPcbShipment } | { ok: false; error: PcbShipmentTransitionError }> => {
  const shipment = await findPcbShipmentByPo(po.id);
  if (shipment === null) return { ok: false, error: 'NOT_SHIPPED' };
  if (actor.kind !== 'admin') return { ok: false, error: 'NOT_YOUR_TURN' };
  if (shipment.receivedAt !== null) return { ok: false, error: 'RECEIVE_LOCKED' };
  const updated = await prisma.spPcbShipment.update({
    where: { id: shipment.id },
    data: { caseRef, caseRefFilledAt: new Date() },
  });
  return { ok: true, shipment: updated };
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
    // 대표 발주의 회차 — 박스 합류 키의 한 축(같은 회차끼리만 합류)이라 화면 헤더가
    // "왜 이 박스가 따로 섰는지"를 말하려면 필요하다(여정 11호 X7).
    reorderRound: rep?.reorderRound ?? 0,
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
    caseRefRequestedAt: iso(shipment.caseRefRequestedAt),
    caseRefNote: shipment.caseRefNote,
    caseRef: shipment.caseRef,
    caseRefFilledAt: iso(shipment.caseRefFilledAt),
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

/** 발주서 집합의 소속 선적 뷰(중복 제거) — 공유(포털 안전) 형태. 관리자 응답은
 *  loadAdminPcbShipmentsForPoIds 가 이 위에 고객 신원을 얹는다. */
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

/**
 * **관리자 전용** — 공유 뷰에 묶음 구성원의 고객 신원(specId·mbId·고객명)을 얹는다.
 * 묶음은 고객(Case) 경계를 넘어 합류하므로 관리자 화면(Case 상세 묶음 칩)은 "누구
 * 것이 함께 묶였는지"까지 말해야 한다(2026-08-12). 협력사 포털 응답에는 절대 쓰지
 * 않는다 — 다른 엔드 고객의 이름·아이디가 협력사에게 새는 자리다.
 */
export const loadAdminPcbShipmentsForPoIds = async (
  poIds: bigint[],
): Promise<AdminPcbShipmentViewType[]> => {
  const views = await loadPcbShipmentsForPoIds(poIds);
  const memberIds = [...new Set(views.flatMap((v) => v.poIds))];
  if (memberIds.length === 0) return views.map((v) => ({ ...v, groupPos: [] }));
  const pos = await prisma.spPcbPo.findMany({
    where: { id: { in: memberIds.map((id) => BigInt(id)) } },
    include: { spec: true },
  });
  const names = await loadPcbCustomerNames(
    pos.map((p) => ({ specId: p.specId, mbId: p.spec.mbId, ctId: p.spec.ctId })),
  );
  const byPoId = new Map(pos.map((p) => [Number(p.id), p]));
  return views.map((v) => ({
    ...v,
    groupPos: v.groupPos.map((g) => {
      const po = byPoId.get(g.poId);
      return {
        ...g,
        specId: Number(po?.specId ?? 0),
        mbId: po?.spec.mbId ?? null,
        customerName: po === undefined ? '' : (names.get(po.specId.toString()) ?? ''),
      };
    }),
  }));
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
      // 회차는 뷰가 이미 대표 발주에서 실어 온다(구 별도 조회 제거 — 같은 값 두 번 읽던 자리).
      const view = await toPcbShipmentView(shipment);
      boxes.push({
        ...view,
        contextKey: pcbShipContextKey(
          {
            receiverKind: shipment.receiverKind === 'md' ? 'md' : 'admin',
            receiverPartnerId: shipment.receiverPartnerId,
            destinationCountry: shipment.destinationCountry,
          },
          view.reorderRound,
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

/** 완료된 발송 아카이브(R2 — BOM done 분리 미러) — 최신순 페이지네이션. */
export const loadPartnerPcbDoneShipments = async (
  partnerId: bigint,
  page: number,
  pageSize: number,
): Promise<{ items: PcbShipmentViewType[]; total: number; page: number; pageSize: number }> => {
  const myPoIds = (
    await prisma.spPcbPo.findMany({ where: { partnerId }, select: { id: true } })
  ).map((p) => p.id);
  const shipments = await prisma.spPcbShipment.findMany({
    where: { poId: { in: myPoIds } },
    orderBy: { id: 'desc' },
  });
  const done = shipments.filter((s) => {
    const mode = asPcbShipmentMode(s.mode);
    const status = asPcbShipmentStatus(mode, s.status);
    return s.receivedAt !== null || bomShipmentNextStatus(mode, status) === null;
  });
  const slice = done.slice((page - 1) * pageSize, page * pageSize);
  return {
    items: await Promise.all(slice.map((s) => toPcbShipmentView(s))),
    total: done.length,
    page,
    pageSize,
  };
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
      // 프로젝트명은 업로드 파일명이라 서로 다른 발주가 같은 이름일 수 있다 — 묶음 송장은
      // **다른 고객의 건까지** 한 장에 담기므로(여정 9호) 품목 두 줄이 통관 서류에서 구별이
      // 안 될 수 있다. 발주번호를 앞에 세워 각 줄을 유일하게 만든다(초안값 — 협력사가 수정 가능).
      description: `PO-${po.id.toString()} ${po.spec.projectName}`,
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
  { item: AdminPcbShipmentWorkItemType; tab: AdminPcbShipmentTab }[]
> => {
  const shipments = await prisma.spPcbShipment.findMany({
    include: { pos: true },
    orderBy: { createdAt: 'desc' },
  });
  // 배치 조회 — 구판은 박스마다 3쿼리(N+1)였다. 대표는 구성원의 부분집합이므로
  // 발주서는 한 번에 모으고, 고객명 사전(od_name > mb_name)도 스펙 전체로 1회.
  const house = await loadHousePartnerName();
  const allPoIds = [...new Set(shipments.flatMap((s) => s.pos.map((p) => p.poId)))];
  const pos = await prisma.spPcbPo.findMany({
    where: { id: { in: allPoIds } },
    include: { partner: true, spec: true },
  });
  const poById = new Map(pos.map((p) => [p.id.toString(), p]));
  const mdIds = [
    ...new Set(
      shipments
        .filter((s) => s.receiverKind === 'md')
        .map((s) => s.receiverPartnerId)
        .filter((id): id is bigint => id !== null),
    ),
  ];
  const mdPartners = await prisma.spPartner.findMany({ where: { id: { in: mdIds } } });
  const mdNameById = new Map(mdPartners.map((p) => [p.id.toString(), p.name]));
  const customerNames = await loadPcbCustomerNames(
    pos.map((p) => ({ specId: p.specId, mbId: p.spec.mbId, ctId: p.spec.ctId })),
  );

  const out: { item: AdminPcbShipmentWorkItemType; tab: AdminPcbShipmentTab }[] = [];
  for (const shipment of shipments) {
    const rep = poById.get(shipment.poId.toString()) ?? null;
    const receiverName =
      shipment.receiverKind === 'md'
        ? (mdNameById.get((shipment.receiverPartnerId ?? 0n).toString()) ?? '중개 조직')
        : house;
    // 묶음 구성 — 대표 외 발주서는 다른 Case(다른 고객)일 수 있으므로 주인까지 싣는다.
    const memberPos = shipment.pos
      .map((p) => poById.get(p.poId.toString()))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // 발송 참조번호 요청·미입력 — 협력사가 이 값을 기다리며 멈춰 있으므로 관리자 차례다.
    const caseRefPending =
      shipment.receiverKind === 'admin' &&
      shipment.caseRefRequestedAt !== null &&
      (shipment.caseRef === null || shipment.caseRef === '');
    const adminTurn =
      (shipment.receiverKind !== 'md' && pcbShipmentReceiverTurn(shipment)) || caseRefPending;
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
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        poCount: shipment.pos.length,
        members: memberPos.map((p) => ({
          poId: Number(p.id),
          specId: Number(p.specId),
          projectName: p.spec.projectName,
          mbId: p.spec.mbId,
          customerName: customerNames.get(p.specId.toString()) ?? '',
        })),
        receivedAt: iso(shipment.receivedAt),
        // 큐 배지 — 직송(실물이 자사를 안 거침)·A/S 회차(대표 발주 기준)를 행에서 바로 읽게.
        destinationCountry: shipment.destinationCountry,
        reorderRound: rep?.reorderRound ?? 0,
        adminTurn,
        caseRefPending,
        createdAt: shipment.createdAt.toISOString(),
      },
      tab,
    });
  }
  return out;
};
