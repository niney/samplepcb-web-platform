import type { Prisma, SpFile, SpPartner, SpPcbPo } from '@prisma/client';
import type {
  AdminPcbPoCreateBodyType,
  AdminPcbPoPatchBodyType,
  AdminPcbPoViewType,
  AdminPcbPoWorkItemType,
  PartnerPcbChildPoCreateBodyType,
  PartnerPcbPoDetailType,
  PartnerPcbPoListItemType,
  PcbEqEventType,
  PcbEqFileTypeType,
  PcbEqFileViewType,
  PcbEqRoleType,
  PcbPoEqReviewSummaryType,
  PcbPoStatusType,
} from '@sp/api-contract';
import {
  PCB_EQ_FORWARD,
  PCB_EQ_REVERT,
  PCB_PO_STATUSES,
  lastPcbEqRejectedAt,
  orderPcbEqFiles,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { getOrderInfoByCtId } from './g5-db';
import { loadPcbCustomerNames } from './pcb-customer';
import { isPcbOrderFulfillmentClosed } from './pcb-order-cancel';
import { roundPcbAmount } from './exchange-rate';
import {
  asPcbCurrency,
  loadHousePartnerName,
  loadPcbSpecFiles,
  resolveLinkCurrency,
  serializeAdminPcbRfqRows,
  stripInternalSpecKeys,
  validatePcbRfqPartners,
} from './pcb-rfq';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';
import { loadEqReviewRowSummaries } from './pcb-eq-review';
import type { PcbDeliveryDateRange } from './pcb-delivery-filter';
import { resolvePcbRemittanceDueOn } from './pcb-payment-terms';
import { loadRemittanceSummaries, summarizePcbRemittances } from './pcb-remittance';
import {
  findPcbShipmentByPo,
  isPcbOrderLineCanceled,
  isPcbOutboundBlocked,
  isPcbUniqueViolation,
  pcbShipmentReceiverTurn,
  pcbShipmentSenderTurn,
  resolvePcbShipContext,
  toPcbShipmentView,
} from './pcb-shipment';

// ── PCB 발주서·EQ 코어(P2) — docs/PCB_PARTNER_TRACK.md §5.2-2·§5.2-3 ─────────
// 발주는 결제 확인(od isPaid) 후에만(§5.2-2, BOM D18 동형). status 가 EQ·생산
// 5단계 진행 머신을 겸하며 **서버가 순서(expectedFrom)와 주체를 강제**한다(레거시가
// 이미 지키던 유일한 축 — 승계 가치 최상). MD 경유 상위 발주서는 자체 EQ 를 진행하지
// 않고 하위 발주서에 위임·미러한다(레거시 EQ 단일화 승계).

const EQ_REF_TYPE = 'sp_pcb_po_eq';
const EQ_UPLOAD_SERVICE_TYPE = 'pcb_eq';

export const asPcbPoStatus = (v: string): PcbPoStatusType =>
  (PCB_PO_STATUSES as readonly string[]).includes(v) ? (v as PcbPoStatusType) : 'issued';

const decNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);

type PoWithPartner = SpPcbPo & { partner: SpPartner };

// ── EQ 이력(Json) — 하위 발주서가 정본, 상위(미러)는 상태만 복사 ──────────────
const parseEqHistory = (json: unknown): PcbEqEventType[] => {
  if (!Array.isArray(json)) return [];
  const out: PcbEqEventType[] = [];
  for (const row of json) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    out.push({
      at: typeof r.at === 'string' ? r.at : '',
      byRole: typeof r.byRole === 'string' ? r.byRole : '',
      fromStatus: typeof r.fromStatus === 'string' ? r.fromStatus : '',
      toStatus: typeof r.toStatus === 'string' ? r.toStatus : '',
      note: typeof r.note === 'string' ? r.note : null,
    });
  }
  return out;
};

const appendEq = (
  history: unknown,
  event: Omit<PcbEqEventType, 'at'>,
): PcbEqEventType[] => [...parseEqHistory(history), { at: new Date().toISOString(), ...event }];

/**
 * 현재 EQ 회차의 시작 시각 — 마지막으로 승인요청에 들어선 순간. 반려로 발주가 내려갔다
 * 다시 올라오면 지난 회차의 고객 확인은 이력일 뿐이라, 행 요약은 이 시점 이후만 봐야 한다.
 * 이력이 없으면(이관·구데이터) null — 제한하지 않는다.
 */
const eqRoundStartOf = (po: SpPcbPo): Date | null => {
  const events = parseEqHistory(po.eqHistory);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const at = events[i]?.toStatus === 'eq_requested' ? events[i]?.at : undefined;
    if (at !== undefined && at !== '') {
      const parsed = new Date(at);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  return null;
};

const eqRoundStartMap = (rows: readonly SpPcbPo[]): Map<string, Date | null> =>
  new Map(rows.map((r) => [r.id.toString(), eqRoundStartOf(r)]));

// ── MD 경유 판정 — 관계 보유 조직이 수주한 상위 발주서는 자체 EQ 금지(위임) ────
const isMdOrganization = async (partnerId: bigint): Promise<boolean> =>
  (await prisma.spPartnerRelation.count({ where: { parentPartnerId: partnerId } })) > 0;

interface EqDelegation {
  /** 위임 대상 하위 발주서(같은 스펙·회차, 첫 건 — 레거시 승계). null=자체 진행. */
  delegatePoId: bigint | null;
  /** MD 수주인데 하위 발주 전 — EQ 시작 불가. */
  blocked: boolean;
}

const resolveEqDelegation = async (po: SpPcbPo): Promise<EqDelegation> => {
  if (po.parentPartnerId !== 0n) return { delegatePoId: null, blocked: false };
  if (!(await isMdOrganization(po.partnerId))) return { delegatePoId: null, blocked: false };
  const child = await prisma.spPcbPo.findFirst({
    where: { specId: po.specId, parentPartnerId: po.partnerId, reorderRound: po.reorderRound },
    orderBy: { id: 'asc' },
  });
  return child === null
    ? { delegatePoId: null, blocked: true }
    : { delegatePoId: child.id, blocked: false };
};

// ── EQ 첨부(sp_file refType 'sp_pcb_po_eq') ──────────────────────────────────
// isLatest·afterReject 는 **목록 전체와 EQ 이력을 봐야** 정해지므로 여기서는 붙이지 않는다
// (orderPcbEqFiles 몫).
type EqFileBase = Omit<PcbEqFileViewType, 'isLatest' | 'afterReject'>;

// DB 컬럼은 문자열 — 계약 유니온으로 총함수 내로잉. ⚠ 새 종류를 여기 안 더하면 그 파일이
// 조용히 'eq' 로 뭉개져 협력사 질의서 칸에 섞인다(방향을 가르려고 종류를 만든 의미가 사라진다).
const asEqFileType = (v: string | null): PcbEqFileTypeType =>
  v === 'working' ? 'working' : v === 'reply' ? 'reply' : 'eq';

const toEqFileView = (f: SpFile): EqFileBase => ({
  fileId: Number(f.id),
  name: f.originFileName,
  size: Number(f.size),
  fileType: asEqFileType(f.fileType),
  uploadedBy: f.uploadedBy,
  uploadedAt: f.writeDate.toISOString(),
});

/** 발주서를 통째로 받는다 — 반려 시각(eqHistory)이 있어야 '보완분'을 가를 수 있다. */
const loadEqFilesMap = async (
  pos: readonly SpPcbPo[],
): Promise<Map<string, PcbEqFileViewType[]>> => {
  if (pos.length === 0) return new Map();
  const rows = await prisma.spFile.findMany({
    where: { refType: EQ_REF_TYPE, refId: { in: pos.map((p) => p.id) } },
    orderBy: { id: 'asc' },
  });
  const map = new Map<string, EqFileBase[]>();
  for (const row of rows) {
    const key = row.refId.toString();
    const list = map.get(key) ?? [];
    list.push(toEqFileView(row));
    map.set(key, list);
  }
  // 최신 판정·정렬은 계약의 순수 함수 하나로 — 화면마다 각자 정렬하면 규칙이 갈라진다.
  const out = new Map<string, PcbEqFileViewType[]>();
  for (const po of pos) {
    const key = po.id.toString();
    const rejectedAt = lastPcbEqRejectedAt(parseEqHistory(po.eqHistory));
    out.set(key, orderPcbEqFiles(map.get(key) ?? [], rejectedAt));
  }
  return out;
};

export const uploadPcbEqFile = async (
  poId: bigint,
  file: UploadTarget,
  fileType: PcbEqFileTypeType,
  uploadedBy: 'ADMIN' | 'PARTNER' | 'MASTER_DEALER',
  // 호출부(관리자·협력사 라우트)는 둘 다 업로드 뒤 **상세를 다시 조회해** 응답한다 —
  // 여기서 뷰를 만들어 돌려줘도 아무도 쓰지 않는다(isLatest·afterReject 는 목록 전체와
  // EQ 이력을 봐야 정해지므로 그 재조회가 정답이기도 하다).
): Promise<void> => {
  const [uploaded] = await uploadToFileServer([file], EQ_UPLOAD_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('EQ 파일 업로드에 실패했습니다');
  await prisma.spFile.create({
    data: {
      refType: EQ_REF_TYPE,
      refId: poId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: file.filename,
      pathToken: uploaded.pathToken,
      size: BigInt(file.buffer.length),
      writeDate: new Date(),
      fileType,
      uploadedBy,
    },
  });
};

export const deletePcbEqFile = async (poId: bigint, fileId: bigint): Promise<boolean> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return false;
  if (row.refType !== EQ_REF_TYPE || row.refId !== poId) return false;
  // 파일서버 먼저(실패 시 행이 남아 재시도 가능 — 고아 파일 방지, file-server 관례).
  await deleteFromFileServer(row.pathToken);
  await prisma.spFile.delete({ where: { id: row.id } });
  return true;
};

export const getPcbEqFileDownload = async (
  poId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return null;
  if (row.refType !== EQ_REF_TYPE || row.refId !== poId) return null;
  return { pathToken: row.pathToken, originFileName: row.originFileName };
};

/** 이 발주의 관리자 회신 첨부 수 — 반려 메일이 "첨부가 있다"를 말할 근거. */
export const countPcbEqReplyFiles = async (poId: bigint): Promise<number> =>
  prisma.spFile.count({ where: { refType: EQ_REF_TYPE, refId: poId, fileType: 'reply' } });

/** 삭제 가능 판정에 종류가 필요하다 — 회신(reply)과 협력사 산출물은 잠기는 시점이 다르고,
 *  협력사는 회신 파일을 지울 수 없다(관리자가 준 것이다). 없으면 null. */
export const getPcbEqFileType = async (
  poId: bigint,
  fileId: bigint,
): Promise<PcbEqFileTypeType | null> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return null;
  if (row.refType !== EQ_REF_TYPE || row.refId !== poId) return null;
  return asEqFileType(row.fileType);
};

// ── 직렬화 ───────────────────────────────────────────────────────────────────
/** 포털을 **실제로 쓸 수 있는** 조직 id 집합 — 발주 줄이 "협력사가 스스로 할 수 있는 건지"를
 *  가르는 데 쓴다(행마다 세면 N+1이라 한 번에 모은다). 조직 축이라 발주 수와 무관하다.
 *  조건은 **멤버 존재 ∧ 조직 승인**(여정 13호 교정) — requirePartner 가 정지 조직을 403 으로
 *  막으므로, 멤버만 보면 배제된 조직이 "협력사가 진행한다"로 잘못 읽힌다. 메일 CTA 판정
 *  (resolvePcbPortalCta)과 같은 규칙을 쓴다. */
const loadPartnersWithPortal = async (partnerIds: bigint[]): Promise<Set<string>> => {
  const ids = [...new Set(partnerIds)];
  if (ids.length === 0) return new Set();
  const members = await prisma.spPartnerMember.findMany({
    where: { partnerId: { in: ids }, partner: { status: 'approved' } },
    select: { partnerId: true },
    distinct: ['partnerId'],
  });
  return new Set(members.map((m) => m.partnerId.toString()));
};

interface AdminPoExtras {
  parentPartnerName: string | null;
  /** 연결 계정 유무 — false 면 발주 이후 전 단계가 관리자 대행 몫이다. */
  partnerHasPortal: boolean;
  eqFiles: PcbEqFileViewType[];
  eqDelegatePoId: bigint | null;
  eqBlocked: boolean;
  childCount: number;
  eqReview: PcbPoEqReviewSummaryType | null;
  /** 송금 원장 파생(P3.11) — 행 배지가 부분/완납을 구분하려면 날짜만으론 부족하다. */
  remittance: { paidAmount: number; balance: number; count: number };
}

export const toAdminPcbPoView = (po: PoWithPartner, extras: AdminPoExtras): AdminPcbPoViewType => ({
  poId: Number(po.id),
  specId: Number(po.specId),
  partnerId: Number(po.partnerId),
  partnerName: po.partner.name,
  partnerHasPortal: extras.partnerHasPortal,
  parentPartnerId: Number(po.parentPartnerId),
  parentPartnerName: extras.parentPartnerName,
  reorderRound: po.reorderRound,
  rfqId: po.rfqId === null ? null : Number(po.rfqId),
  status: asPcbPoStatus(po.status),
  currency: po.currency,
  priceOriginal: Number(po.priceOriginal),
  exchangeRate: decNum(po.exchangeRate),
  krwAmount: po.krwAmount,
  subCurrency: po.subCurrency,
  subPriceOriginal: decNum(po.subPriceOriginal),
  subExchangeRate: decNum(po.subExchangeRate),
  destinationCountry: po.destinationCountry,
  paymentTerms: po.paymentTerms,
  remittanceDueOn: iso(po.remittanceDueOn),
  remittedAt: iso(po.remittedAt),
  remittance: extras.remittance,
  deliveryDate: iso(po.deliveryDate),
  memo: po.memo,
  issuedAt: po.issuedAt.toISOString(),
  eqHistory: parseEqHistory(po.eqHistory),
  eqFiles: extras.eqFiles,
  eqDelegatePoId: extras.eqDelegatePoId === null ? null : Number(extras.eqDelegatePoId),
  eqBlocked: extras.eqBlocked,
  childCount: extras.childCount,
  eqReview: extras.eqReview,
});

const serializeAdminPos = async (rows: PoWithPartner[]): Promise<AdminPcbPoViewType[]> => {
  const parentIds = [...new Set(rows.map((r) => r.parentPartnerId).filter((p) => p !== 0n))];
  const parents =
    parentIds.length === 0
      ? []
      : await prisma.spPartner.findMany({ where: { id: { in: parentIds } } });
  const parentNames = new Map(parents.map((p) => [p.id.toString(), p.name]));
  const filesMap = await loadEqFilesMap(rows);
  const reviewMap = await loadEqReviewRowSummaries(
    rows.map((r) => r.id),
    eqRoundStartMap(rows),
  );
  // 송금 요약은 원장(sp_pcb_remittance)이 정본 — 한 번에 모아 온다(행마다 조회하면 N+1).
  const remitMap = await loadRemittanceSummaries(rows);
  const portalSet = await loadPartnersWithPortal(rows.map((r) => r.partnerId));
  const out: AdminPcbPoViewType[] = [];
  for (const row of rows) {
    const delegation = await resolveEqDelegation(row);
    const childCount = rows.filter(
      (r) => r.parentPartnerId === row.partnerId && r.reorderRound === row.reorderRound,
    ).length;
    const remit =
      remitMap.get(row.id.toString()) ??
      summarizePcbRemittances({ currency: row.currency, priceOriginal: row.priceOriginal }, []);
    out.push(
      toAdminPcbPoView(row, {
        parentPartnerName:
          row.parentPartnerId === 0n
            ? null
            : (parentNames.get(row.parentPartnerId.toString()) ?? null),
        partnerHasPortal: portalSet.has(row.partnerId.toString()),
        eqFiles: filesMap.get(row.id.toString()) ?? [],
        eqDelegatePoId: delegation.delegatePoId,
        eqBlocked: delegation.blocked,
        childCount,
        eqReview: reviewMap.get(row.id.toString()) ?? null,
        remittance: {
          paidAmount: remit.paidAmount,
          balance: remit.balance,
          count: remit.count,
        },
      }),
    );
  }
  return out;
};

export const loadAdminPcbPos = async (specId: bigint): Promise<AdminPcbPoViewType[]> => {
  const rows = await prisma.spPcbPo.findMany({
    where: { specId },
    include: { partner: true },
    orderBy: [{ parentPartnerId: 'asc' }, { id: 'asc' }],
  });
  return serializeAdminPos(rows);
};

// ── 발주 생성(관리자) — paid 게이트 + 선정 견적행 스냅샷 프리필 ───────────────
export type CreatePcbPoError =
  | 'SPEC_NOT_FOUND'
  | 'NOT_ORDERED'
  | 'ORDER_CLOSED'
  | 'NOT_PAID'
  | 'PARTNER_INVALID'
  | 'ALREADY_ISSUED'
  | 'RFQ_MISMATCH'
  | 'RFQ_NOT_SELECTED'
  | 'PRICE_REQUIRED'
  | 'EXCHANGE_RATE_REQUIRED'
  | 'REMITTANCE_DUE_REQUIRED';

export const createAdminPcbPo = async (
  specId: bigint,
  body: AdminPcbPoCreateBodyType,
): Promise<{ ok: true; po: SpPcbPo; partner: SpPartner } | { ok: false; error: CreatePcbPoError; detail?: string }> => {
  const spec = await prisma.spOrderSpec.findUnique({ where: { id: specId } });
  if (spec === null) return { ok: false, error: 'SPEC_NOT_FOUND' };
  // 결제 게이트(§5.2-2) — 주문 없음도 미결제와 같은 사유로 안내.
  if (spec.ctId === null) return { ok: false, error: 'NOT_ORDERED' };
  const order = await getOrderInfoByCtId(spec.ctId);
  if (order === null) return { ok: false, error: 'NOT_ORDERED' };
  // getOrderInfoByCtId.isPaid 는 영카트의 넓은 "주문 아님" 판정이라 취소 헤더도 true 다.
  // 취소된 PCB 행/주문과 완료 주문은 발주 게이트에서 먼저 닫아 후속 발주를 막는다.
  if (isPcbOrderFulfillmentClosed(order.odStatus, order.rowCtStatus))
    return { ok: false, error: 'ORDER_CLOSED' };
  if (!order.isPaid) return { ok: false, error: 'NOT_PAID' };

  const { partners, error } = await validatePcbRfqPartners([body.partnerId]);
  const partner = partners[0];
  if (error !== null || partner === undefined)
    return { ok: false, error: 'PARTNER_INVALID', ...(error === null ? {} : { detail: error }) };

  const existing = await prisma.spPcbPo.findUnique({
    where: {
      specId_partnerId_parentPartnerId_reorderRound: {
        specId,
        partnerId: partner.id,
        parentPartnerId: 0n,
        reorderRound: 0,
      },
    },
  });
  if (existing !== null) return { ok: false, error: 'ALREADY_ISSUED' };

  const rfq =
    body.rfqId === null || body.rfqId === undefined
      ? null
      : await prisma.spPcbRfq.findUnique({ where: { id: BigInt(body.rfqId) } });
  if (body.rfqId !== null && body.rfqId !== undefined) {
    if (rfq === null) return { ok: false, error: 'RFQ_MISMATCH' };
    if (
      rfq.specId !== specId ||
      rfq.parentPartnerId !== 0n ||
      rfq.partnerId !== partner.id
    )
      return { ok: false, error: 'RFQ_MISMATCH' };
    // 견적행을 근거로 발주하려면 그 행이 **선정**돼 있어야 한다 — quoted 로 발주하면
    // 같은 견적에 발주 2장이 성립하고, 협력사가 발주 후에도 회신가를 바꿀 수 있다
    // (NOT_EDITABLE 은 selected 만 잠근다 — 재작업 프로브 W3 실증). rfq 없이 조건을
    // 직접 넣는 수동 발주 경로는 그대로 둔다.
    if (rfq.status !== 'selected') return { ok: false, error: 'RFQ_NOT_SELECTED' };
  }

  const currency = rfq !== null ? asPcbCurrency(rfq.currency) : await resolveLinkCurrency(0n, partner);
  const priceOriginal = body.priceOriginal ?? decNum(rfq?.priceOriginal) ?? null;
  if (priceOriginal === null) return { ok: false, error: 'PRICE_REQUIRED' };
  const price = roundPcbAmount(priceOriginal, currency);

  // KRW 회계(관리자 직접 발주) — 외화는 환율 필수(선정 박제값 승계 가능, 레거시 승계).
  let krwAmount: number;
  let stampRate: number | null;
  if (currency === 'KRW') {
    krwAmount = roundPcbAmount(price, 'KRW');
    stampRate = null;
  } else {
    const rate = body.exchangeRate ?? decNum(rfq?.exchangeRate);
    if (rate === null) return { ok: false, error: 'EXCHANGE_RATE_REQUIRED' };
    krwAmount = roundPcbAmount(price * rate, 'KRW');
    stampRate = rate;
  }

  const issuedAt = new Date();
  const remittanceDue = resolvePcbRemittanceDueOn({
    paymentTerms: body.paymentTerms ?? null,
    requestedDueOn: body.remittanceDueOn,
    issuedAt,
  });
  if (!remittanceDue.ok) return remittanceDue;

  // 동시 발행(여정 16호 C1) — 위의 ALREADY_ISSUED 사전 검사는 두 요청이 **같은 순간**
  // 통과할 수 있다. 데이터는 UK(specId+partnerId+parentPartnerId+reorderRound)가 한 장으로
  // 막아 주지만, 그 P2002 를 그냥 두면 진 쪽이 **안내 없는 500**을 본다(두 창을 연 관리자가
  // 겪는다). 사전 검사와 같은 코드로 되돌려 "이미 발행됐다"고 말한다.
  try {
    const po = await prisma.spPcbPo.create({
    data: {
      specId,
      partnerId: partner.id,
      parentPartnerId: 0n,
      reorderRound: 0,
      rfqId: rfq?.id ?? null,
      status: 'issued',
      currency,
      priceOriginal: price,
      exchangeRate: stampRate,
      krwAmount,
      subCurrency: rfq?.subCurrency ?? null,
      subPriceOriginal: rfq?.subPriceOriginal ?? null,
      subExchangeRate: rfq?.subExchangeRate ?? null,
      destinationCountry: body.destinationCountry ?? null,
      paymentTerms: body.paymentTerms ?? null,
      remittanceDueOn: remittanceDue.dueOn,
      // 송금은 원장(sp_pcb_remittance)이 정본 — 발주 시점엔 항상 비어 있다(P3.11).
      remittedAt: null,
      deliveryDate:
        body.deliveryDate === null || body.deliveryDate === undefined
          ? (rfq?.quotedDeliveryDate ?? null)
          : parseKstDate(body.deliveryDate),
      memo: body.memo ?? null,
      eqHistory: [],
      issuedAt,
    },
    });
    return { ok: true, po, partner };
  } catch (e) {
    if (!isPcbUniqueViolation(e)) throw e;
    return { ok: false, error: 'ALREADY_ISSUED' };
  }
};

// ── MD 하위 발주(포털) — 하위 회신 견적행 기준, KRW 회계 없음(레거시 승계) ────
export type CreateChildPcbPoError =
  | 'PO_NOT_FOUND'
  | 'NOT_YOUR_PO'
  | 'CHILD_RFQ_REQUIRED'
  | 'PARTNER_REQUIRED'
  | 'NO_ORIGIN_CHILD_PO'
  | 'CHILD_RFQ_MISMATCH'
  | 'CHILD_NOT_QUOTED'
  | 'ALREADY_ISSUED'
  | 'ORDER_CANCELED';

export const createChildPcbPo = async (
  parentPoId: bigint,
  actorPartnerId: bigint,
  body: PartnerPcbChildPoCreateBodyType,
): Promise<
  { ok: true; po: SpPcbPo; partner: SpPartner } | { ok: false; error: CreateChildPcbPoError }
> => {
  const parentPo = await prisma.spPcbPo.findUnique({ where: { id: parentPoId } });
  if (parentPo === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (parentPo.partnerId !== actorPartnerId || parentPo.parentPartnerId !== 0n)
    return { ok: false, error: 'NOT_YOUR_PO' };
  // 취소된 주문에 새 하위 발주를 열지 않는다(EQ 전진 차단과 같은 원칙).
  if (await isPcbOrderLineCanceled(parentPo.specId)) return { ok: false, error: 'ORDER_CANCELED' };

  // ── A/S 회차(round>0) 하위 발주 — childRfqId 없이 원회차 조건 복사(여정 7호 교정) ──
  // 회차 하위 RFQ 를 만들 경로가 없어 MD 경유 회차가 여기서 dead-end 였다. 레거시가
  // 하위 RFQ 없이 reorderRound 직접 발주였듯, 원회차(round 0)의 같은 (spec, 대상,
  // parentPartnerId=MD) 하위 발주 조건을 복사하고 납기는 비운다(proceed 의 A′ 복사와
  // 대칭). 원발주(round 0)는 childRfqId 필수 규율 그대로 — 계약 완화가 규율을 약화하지
  // 않게 서버가 CHILD_RFQ_REQUIRED 로 끊는다.
  if (body.childRfqId === undefined) {
    if (parentPo.reorderRound === 0) return { ok: false, error: 'CHILD_RFQ_REQUIRED' };
    if (body.partnerId === undefined) return { ok: false, error: 'PARTNER_REQUIRED' };
    const origin = await prisma.spPcbPo.findUnique({
      where: {
        specId_partnerId_parentPartnerId_reorderRound: {
          specId: parentPo.specId,
          partnerId: BigInt(body.partnerId),
          parentPartnerId: actorPartnerId,
          reorderRound: 0,
        },
      },
      include: { partner: true },
    });
    if (origin === null) return { ok: false, error: 'NO_ORIGIN_CHILD_PO' };

    const dup = await prisma.spPcbPo.findUnique({
      where: {
        specId_partnerId_parentPartnerId_reorderRound: {
          specId: parentPo.specId,
          partnerId: origin.partnerId,
          parentPartnerId: actorPartnerId,
          reorderRound: parentPo.reorderRound,
        },
      },
    });
    if (dup !== null) return { ok: false, error: 'ALREADY_ISSUED' };

    const originCurrency = asPcbCurrency(origin.currency);
    const copiedPrice = roundPcbAmount(
      body.priceOriginal ?? Number(origin.priceOriginal),
      originCurrency,
    );
    const po = await prisma.spPcbPo.create({
      data: {
        specId: parentPo.specId,
        partnerId: origin.partnerId,
        parentPartnerId: actorPartnerId,
        reorderRound: parentPo.reorderRound, // 회차 상속(기존 경로와 동일)
        rfqId: origin.rfqId, // 근거 회신 참조 승계(proceed 의 A′ 복사와 대칭)
        status: 'issued',
        currency: originCurrency,
        priceOriginal: copiedPrice,
        exchangeRate: null,
        krwAmount: null, // MD→하위 발주는 KRW 회계 불필요(레거시 승계)
        subCurrency: origin.subCurrency,
        subPriceOriginal: origin.subPriceOriginal,
        subExchangeRate: origin.subExchangeRate,
        destinationCountry: origin.destinationCountry,
        paymentTerms: body.paymentTerms === undefined ? origin.paymentTerms : body.paymentTerms,
        remittedAt: null, // 원장이 정본(P3.11)
        // 납기는 비운다 — 원회차 납기 복사는 stale(레거시 함정, proceed 교정과 동일).
        deliveryDate:
          body.deliveryDate === null || body.deliveryDate === undefined
            ? null
            : parseKstDate(body.deliveryDate),
        memo: body.memo === undefined ? origin.memo : body.memo,
        eqHistory: [],
      },
    });
    return { ok: true, po, partner: origin.partner };
  }

  const childRfq = await prisma.spPcbRfq.findUnique({
    where: { id: BigInt(body.childRfqId) },
    include: { partner: true },
  });
  if (childRfq === null) return { ok: false, error: 'CHILD_RFQ_MISMATCH' };
  if (
    childRfq.specId !== parentPo.specId ||
    childRfq.parentPartnerId !== actorPartnerId ||
    childRfq.reorderRound !== parentPo.reorderRound
  )
    return { ok: false, error: 'CHILD_RFQ_MISMATCH' };
  const childPrice = decNum(childRfq.priceOriginal);
  if (childPrice === null) return { ok: false, error: 'CHILD_NOT_QUOTED' };

  const existing = await prisma.spPcbPo.findUnique({
    where: {
      specId_partnerId_parentPartnerId_reorderRound: {
        specId: parentPo.specId,
        partnerId: childRfq.partnerId,
        parentPartnerId: actorPartnerId,
        reorderRound: parentPo.reorderRound,
      },
    },
  });
  if (existing !== null) return { ok: false, error: 'ALREADY_ISSUED' };

  const currency = asPcbCurrency(childRfq.currency);
  const price = roundPcbAmount(body.priceOriginal ?? childPrice, currency);
  const po = await prisma.spPcbPo.create({
    data: {
      specId: parentPo.specId,
      partnerId: childRfq.partnerId,
      parentPartnerId: actorPartnerId,
      reorderRound: parentPo.reorderRound,
      rfqId: childRfq.id,
      status: 'issued',
      currency,
      priceOriginal: price,
      exchangeRate: null,
      krwAmount: null, // MD→하위 발주는 KRW 회계 불필요(레거시 needsKrwAccounting 승계)
      subCurrency: childRfq.subCurrency,
      subPriceOriginal: childRfq.subPriceOriginal,
      subExchangeRate: childRfq.subExchangeRate,
      destinationCountry: parentPo.destinationCountry, // 발주 시점 하향 상속(레거시 §2.5)
      paymentTerms: body.paymentTerms ?? null,
      remittedAt: null, // 원장이 정본(P3.11)
      deliveryDate:
        body.deliveryDate === null || body.deliveryDate === undefined
          ? (childRfq.quotedDeliveryDate ?? null)
          : parseKstDate(body.deliveryDate),
      memo: body.memo ?? null,
      eqHistory: [],
    },
  });
  return { ok: true, po, partner: childRfq.partner };
};

// ── 조건 수정·삭제 — 발주 주체만(관리자=parent 0, MD=parent 본인) ─────────────
export type PcbPoActor = { kind: 'admin' } | { kind: 'partner'; partnerId: bigint };

const isIssuer = (po: SpPcbPo, actor: PcbPoActor): boolean =>
  actor.kind === 'admin' ? po.parentPartnerId === 0n : po.parentPartnerId === actor.partnerId;

export type PatchPcbPoError =
  | 'PO_NOT_FOUND'
  | 'NOT_ISSUER'
  | 'PRICE_LOCKED'
  | 'EXCHANGE_RATE_REQUIRED'
  | 'REMITTANCE_DUE_REQUIRED'
  | 'IN_SHIPMENT';

export const patchPcbPo = async (
  poId: bigint,
  actor: PcbPoActor,
  body: AdminPcbPoPatchBodyType,
): Promise<{ ok: true } | { ok: false; error: PatchPcbPoError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (!isIssuer(po, actor)) return { ok: false, error: 'NOT_ISSUER' };

  const wantsPriceChange = body.priceOriginal !== undefined || body.exchangeRate !== undefined;
  if (wantsPriceChange && po.status !== 'issued') return { ok: false, error: 'PRICE_LOCKED' };

  // 직송지는 발송 문서의 입력이다 — 모드·받는측·묶음 컨텍스트가 생성 시 박제되고, MD 출고
  // 게이팅도 이 값으로 하위를 고른다. 발송이 이미 있으면 값이 바뀌는 변경을 막는다
  // (문서와 실물 경로가 갈라진다 — 재작업 프로브 W8 실증). 발송을 취소·detach 한 뒤에만.
  if (
    body.destinationCountry !== undefined &&
    (body.destinationCountry ?? null) !== po.destinationCountry
  ) {
    const memberships = await prisma.spPcbShipmentPo.count({ where: { poId: po.id } });
    if (memberships > 0) return { ok: false, error: 'IN_SHIPMENT' };
  }

  const currency = asPcbCurrency(po.currency);
  let priceFields: Record<string, unknown> = {};
  if (wantsPriceChange) {
    const price = roundPcbAmount(body.priceOriginal ?? Number(po.priceOriginal), currency);
    if (currency === 'KRW') {
      priceFields = { priceOriginal: price, krwAmount: roundPcbAmount(price, 'KRW') };
    } else if (po.parentPartnerId === 0n) {
      const rate = body.exchangeRate ?? decNum(po.exchangeRate);
      if (rate === null) return { ok: false, error: 'EXCHANGE_RATE_REQUIRED' };
      priceFields = {
        priceOriginal: price,
        exchangeRate: rate,
        krwAmount: roundPcbAmount(price * rate, 'KRW'),
      };
    } else {
      priceFields = { priceOriginal: price };
    }
  }

  const remittanceDue = resolvePcbRemittanceDueOn({
    paymentTerms: body.paymentTerms === undefined ? po.paymentTerms : body.paymentTerms,
    requestedDueOn: body.remittanceDueOn,
    issuedAt: po.issuedAt,
    existingDueOn: po.remittanceDueOn,
  });
  if (!remittanceDue.ok) return remittanceDue;

  await prisma.spPcbPo.update({
    where: { id: po.id },
    data: {
      ...priceFields,
      ...(body.paymentTerms === undefined ? {} : { paymentTerms: body.paymentTerms }),
      remittanceDueOn: remittanceDue.dueOn,
      ...(body.deliveryDate === undefined
        ? {}
        : { deliveryDate: body.deliveryDate === null ? null : parseKstDate(body.deliveryDate) }),
      ...(body.destinationCountry === undefined
        ? {}
        : { destinationCountry: body.destinationCountry }),
      ...(body.memo === undefined ? {} : { memo: body.memo }),
    },
  });
  return { ok: true };
};

export type DeletePcbPoError =
  | 'PO_NOT_FOUND'
  | 'NOT_ISSUER'
  | 'NOT_ISSUED'
  | 'HAS_CHILDREN'
  | 'HAS_REMITTANCE'
  | 'IN_SHIPMENT';

export const deletePcbPo = async (
  poId: bigint,
  actor: PcbPoActor,
): Promise<{ ok: true } | { ok: false; error: DeletePcbPoError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (!isIssuer(po, actor)) return { ok: false, error: 'NOT_ISSUER' };
  // EQ 시작 후엔 되돌리기로 issued 까지 낮춘 뒤에만 삭제(안전 — BOM issued 관례).
  if (po.status !== 'issued') return { ok: false, error: 'NOT_ISSUED' };
  const children = await prisma.spPcbPo.count({
    where: { specId: po.specId, parentPartnerId: po.partnerId, reorderRound: po.reorderRound },
  });
  if (children > 0) return { ok: false, error: 'HAS_CHILDREN' };

  // 돈 기록이 있는 발주는 지우지 않는다 — 원장은 cascade 라 발주와 함께 **조용히**
  // 사라지고 증빙 파일만 고아로 남는다(재작업 프로브 W4 실증). 송금 기록을 먼저 정리해야
  // 삭제가 열린다(leaf-first — 원장 삭제 라우트가 따로 있다).
  const remittances = await prisma.spPcbRemittance.count({ where: { poId: po.id } });
  if (remittances > 0) return { ok: false, error: 'HAS_REMITTANCE' };
  // 박스에 담긴 발주도 마찬가지 — 멤버십에 FK 가 없어 지우면 대표 없는 선적이 남는다
  // (프로브 W5 실증). 보드에서 꺼낸(detach) 뒤에만 삭제할 수 있다.
  const memberships = await prisma.spPcbShipmentPo.count({ where: { poId: po.id } });
  if (memberships > 0) return { ok: false, error: 'IN_SHIPMENT' };

  // 첨부 정리(파일서버 먼저) 후 행 삭제 — leaf-first(레거시 승계, 재시도 안전).
  const files = await prisma.spFile.findMany({ where: { refType: EQ_REF_TYPE, refId: po.id } });
  for (const file of files) {
    await deleteFromFileServer(file.pathToken);
    await prisma.spFile.delete({ where: { id: file.id } });
  }
  await prisma.spPcbPo.delete({ where: { id: po.id } });
  return { ok: true };
};

// ── EQ 전이 — 순서(expectedFrom)·주체 서버 강제 + MD 미러 ────────────────────
export type PcbEqActor = { kind: 'admin' } | { kind: 'partner'; partnerId: bigint };

interface EqRoleResolution {
  role: PcbEqRoleType | null;
  fallback: boolean; // MD 가 하위 수주자 대신 진행
  byRole: 'ADMIN' | 'PARTNER' | 'MASTER_DEALER';
}

const resolveEqRole = (po: SpPcbPo, actor: PcbEqActor): EqRoleResolution => {
  if (actor.kind === 'admin') return { role: 'ORDERER', fallback: false, byRole: 'ADMIN' };
  if (po.partnerId === actor.partnerId)
    return { role: 'RECEIVER', fallback: false, byRole: 'PARTNER' };
  if (po.parentPartnerId === actor.partnerId)
    return { role: 'RECEIVER', fallback: true, byRole: 'MASTER_DEALER' };
  return { role: null, fallback: false, byRole: 'PARTNER' };
};

/** 하위 전이를 같은 회차 상위(관리자→MD) 발주서에 상태만 미러(레거시 mirrorToParent).
 *  전이와 **한 트랜잭션**에 실어야 하므로 실행하지 않고 연산만 돌려준다(상위 없으면 빈 배열). */
const mirrorToParent = (
  po: SpPcbPo,
  toStatus: PcbPoStatusType,
): Prisma.PrismaPromise<Prisma.BatchPayload>[] =>
  po.parentPartnerId === 0n
    ? []
    : [
        prisma.spPcbPo.updateMany({
          where: {
            specId: po.specId,
            partnerId: po.parentPartnerId,
            parentPartnerId: 0n,
            reorderRound: po.reorderRound,
          },
          data: { status: toStatus },
        }),
      ];

/** EQ 상태가 움직이면 열려 있던 고객 확인 요청(D16)은 물어볼 대상을 잃는다 — 닫지 않으면
 *  고객 주문내역엔 답할 수 없는 승인/반려 폼이 계속 뜨고, 협력사가 보완 후 재요청할 때도
 *  createEqReview 가 ALREADY_OPEN 으로 막힌다(관리자가 옛 요청을 손으로 취소해야 했다). */
const closeOpenEqReviews = (poId: bigint): Prisma.PrismaPromise<Prisma.BatchPayload> =>
  prisma.spPcbEqReview.updateMany({
    where: { poId, status: 'requested' },
    data: { status: 'canceled' },
  });

export type PcbEqTransitionError =
  | 'PO_NOT_FOUND'
  | 'DELEGATED'
  | 'FINAL'
  | 'NOT_YOUR_TURN'
  | 'INVALID_STATUS'
  | 'NOTHING_TO_REVERT'
  | 'ORDER_CANCELED';

export const advancePcbPoEq = async (
  poId: bigint,
  actor: PcbEqActor,
  /** 라우트별 기대 시작 상태 — 불일치 시 다른 전이가 오발되지 않게 409 로 끊는다. */
  expectedFrom: PcbPoStatusType,
): Promise<{ ok: true; to: PcbPoStatusType } | { ok: false; error: PcbEqTransitionError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (asPcbPoStatus(po.status) !== expectedFrom) return { ok: false, error: 'INVALID_STATUS' };
  const delegation = await resolveEqDelegation(po);
  if (delegation.delegatePoId !== null || delegation.blocked)
    return { ok: false, error: 'DELEGATED' };

  const action = PCB_EQ_FORWARD[asPcbPoStatus(po.status)];
  if (action === null) return { ok: false, error: 'FINAL' };
  // 취소된 주문의 보드를 계속 만들지 않는다 — 전진만 막고 revert(정리)는 그대로 둔다.
  if (await isPcbOrderLineCanceled(po.specId)) return { ok: false, error: 'ORDER_CANCELED' };
  const { role, byRole } = resolveEqRole(po, actor);
  // 관리자 만능 대행(D11) — 협력사 포털 미온보딩(레거시 진행분) 대비, 선적과 동일
  // 원칙. 이력 byRole 'ADMIN' 으로 대행 사실이 남는다.
  if (role !== action.actor && actor.kind !== 'admin')
    return { ok: false, error: 'NOT_YOUR_TURN' };

  // 전이·미러·고객 확인 종료는 한 덩어리다 — 나뉘면 발주만 넘어가고 고객 화면엔 답할 수
  // 없는 요청이 남는다.
  await prisma.$transaction([
    prisma.spPcbPo.update({
      where: { id: po.id },
      data: {
        status: action.to,
        eqHistory: appendEq(po.eqHistory, {
          byRole,
          fromStatus: po.status,
          toStatus: action.to,
          note: null,
        }),
      },
    }),
    closeOpenEqReviews(po.id),
    ...mirrorToParent(po, action.to),
  ]);
  return { ok: true, to: action.to };
};

export const rejectPcbPoEq = async (
  poId: bigint,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: PcbEqTransitionError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const delegation = await resolveEqDelegation(po);
  if (delegation.delegatePoId !== null || delegation.blocked)
    return { ok: false, error: 'DELEGATED' };
  const action = PCB_EQ_FORWARD[asPcbPoStatus(po.status)];
  if (action === null) return { ok: false, error: 'INVALID_STATUS' };
  if (action.rejectTo === undefined) return { ok: false, error: 'INVALID_STATUS' };

  await prisma.$transaction([
    prisma.spPcbPo.update({
      where: { id: po.id },
      data: {
        status: action.rejectTo,
        eqHistory: appendEq(po.eqHistory, {
          byRole: 'ADMIN',
          fromStatus: po.status,
          toStatus: action.rejectTo,
          note: reason,
        }),
      },
    }),
    closeOpenEqReviews(po.id),
    ...mirrorToParent(po, action.rejectTo),
  ]);
  return { ok: true };
};

export const revertPcbPoEq = async (
  poId: bigint,
  actor: PcbEqActor,
): Promise<{ ok: true; to: PcbPoStatusType } | { ok: false; error: PcbEqTransitionError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const delegation = await resolveEqDelegation(po);
  if (delegation.delegatePoId !== null || delegation.blocked)
    return { ok: false, error: 'DELEGATED' };

  const revert = PCB_EQ_REVERT[asPcbPoStatus(po.status)];
  if (revert === null) return { ok: false, error: 'NOTHING_TO_REVERT' };
  const { role, byRole } = resolveEqRole(po, actor);
  // 관리자 만능 대행(D11) — advance 와 동일.
  if (role !== revert.actor && actor.kind !== 'admin')
    return { ok: false, error: 'NOT_YOUR_TURN' };

  await prisma.$transaction([
    prisma.spPcbPo.update({
      where: { id: po.id },
      data: {
        status: revert.to,
        eqHistory: appendEq(po.eqHistory, {
          byRole,
          fromStatus: po.status,
          toStatus: revert.to,
          note: '되돌리기',
        }),
      },
    }),
    closeOpenEqReviews(po.id),
    ...mirrorToParent(po, revert.to),
  ]);
  return { ok: true, to: revert.to };
};

// ── 협력사 포털 직렬화 ───────────────────────────────────────────────────────
export const loadPartnerPcbPos = async (
  partnerId: bigint,
): Promise<PartnerPcbPoListItemType[]> => {
  const [received, issued, house] = await Promise.all([
    prisma.spPcbPo.findMany({
      where: { partnerId },
      include: { spec: true, partner: true },
      orderBy: { issuedAt: 'desc' },
    }),
    prisma.spPcbPo.findMany({
      where: { parentPartnerId: partnerId },
      include: { spec: true, partner: true },
      orderBy: { issuedAt: 'desc' },
    }),
    loadHousePartnerName(),
  ]);
  const parentIds = [...new Set(received.map((r) => r.parentPartnerId).filter((p) => p !== 0n))];
  const parents =
    parentIds.length === 0
      ? []
      : await prisma.spPartner.findMany({ where: { id: { in: parentIds } } });
  const parentNames = new Map(parents.map((p) => [p.id.toString(), p.name]));

  // 선적 소속 일괄 로드 — myTurn 에 발송·핑퐁 차례를 반영(P3).
  const allIds = [...received, ...issued].map((po) => po.id);
  const shipmentLinks =
    allIds.length === 0
      ? []
      : await prisma.spPcbShipmentPo.findMany({
          where: { poId: { in: allIds } },
          include: { shipment: true },
        });
  const shipmentByPo = new Map(shipmentLinks.map((l) => [l.poId.toString(), l.shipment]));

  const items: PartnerPcbPoListItemType[] = [];
  for (const po of received) {
    const delegation = await resolveEqDelegation(po);
    const forward = PCB_EQ_FORWARD[asPcbPoStatus(po.status)];
    const shipment = shipmentByPo.get(po.id.toString()) ?? null;
    const eqTurn =
      delegation.delegatePoId === null &&
      !delegation.blocked &&
      forward !== null &&
      forward.actor === 'RECEIVER';
    // MD 수주의 "하위 발주 대기" — EQ 사전(actor)으로는 안 잡히지만 다음 손은 MD 다.
    // 이걸 내 차례로 안 세면 발주를 받아 놓고도 홈이 "할 일 없음"으로 침묵한다(실주행 확정).
    const childRequired = delegation.blocked && asPcbPoStatus(po.status) === 'issued';
    const shipTurn =
      shipment !== null
        ? pcbShipmentSenderTurn(shipment)
        : asPcbPoStatus(po.status) === 'produced' && !(await isPcbOutboundBlocked(po));
    items.push({
      poId: Number(po.id),
      projectName: po.spec.projectName,
      qty: po.spec.qty,
      reorderRound: po.reorderRound,
      status: asPcbPoStatus(po.status),
      direction: 'received',
      counterpartyName:
        po.parentPartnerId === 0n
          ? house
          : (parentNames.get(po.parentPartnerId.toString()) ?? '중개 조직'),
      currency: po.currency,
      priceOriginal: Number(po.priceOriginal),
      subCurrency: po.subCurrency,
      subPriceOriginal: decNum(po.subPriceOriginal),
      deliveryDate: iso(po.deliveryDate),
      remittanceDueOn: iso(po.remittanceDueOn),
      remittedAt: iso(po.remittedAt),
      issuedAt: po.issuedAt.toISOString(),
      myTurn: eqTurn || shipTurn || childRequired,
      // 이력은 행에 이미 있다 — 관리자 워크큐 배지와 같은 사전(추가 조회 없음).
      rejectedAt: lastPcbEqRejectedAt(parseEqHistory(po.eqHistory)),
      eqBlocked: childRequired,
    });
  }
  for (const po of issued) {
    const shipment = shipmentByPo.get(po.id.toString()) ?? null;
    // MD 입고 확인 차례(받는측=내 조직) — 하위가 발송하면 켜진다.
    const inboundTurn =
      shipment !== null &&
      shipment.receiverKind === 'md' &&
      shipment.receiverPartnerId === partnerId &&
      pcbShipmentReceiverTurn(shipment);
    items.push({
      poId: Number(po.id),
      projectName: po.spec.projectName,
      qty: po.spec.qty,
      reorderRound: po.reorderRound,
      status: asPcbPoStatus(po.status),
      direction: 'issued',
      counterpartyName: po.partner.name,
      currency: po.currency,
      priceOriginal: Number(po.priceOriginal),
      subCurrency: po.subCurrency,
      subPriceOriginal: decNum(po.subPriceOriginal),
      deliveryDate: iso(po.deliveryDate),
      remittanceDueOn: iso(po.remittanceDueOn),
      remittedAt: iso(po.remittedAt),
      issuedAt: po.issuedAt.toISOString(),
      // EQ 승인은 관리자 몫(D3)이지만 하위 **입고 확인**은 MD 차례다(P3).
      myTurn: inboundTurn,
      // 내가 발주한 축(하위 진행분)의 반려 이력 — 상대가 보완 중임을 MD 도 알아야 한다.
      rejectedAt: lastPcbEqRejectedAt(parseEqHistory(po.eqHistory)),
      eqBlocked: false,
    });
  }
  items.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  return items;
};

export const loadPartnerPcbPoDetail = async (
  poId: bigint,
  partnerId: bigint,
): Promise<PartnerPcbPoDetailType | null> => {
  const po = await prisma.spPcbPo.findUnique({
    where: { id: poId },
    include: { spec: true, partner: true },
  });
  if (po === null) return null;
  const direction =
    po.partnerId === partnerId ? 'received' : po.parentPartnerId === partnerId ? 'issued' : null;
  if (direction === null) return null;

  const [files, house, delegation, childrenRows, childRfqRows, roundRows, originChildRows] =
    await Promise.all([
    loadEqFilesMap([po]),
    loadHousePartnerName(),
    resolveEqDelegation(po),
    prisma.spPcbPo.findMany({
      where: { specId: po.specId, parentPartnerId: po.partnerId, reorderRound: po.reorderRound },
      include: { partner: true },
      orderBy: { id: 'asc' },
    }),
    prisma.spPcbRfq.findMany({
      where: {
        specId: po.specId,
        parentPartnerId: partnerId,
        reorderRound: po.reorderRound,
        status: { in: ['quoted', 'selected'] },
      },
      include: { partner: true },
      orderBy: { id: 'asc' },
    }),
    // 같은 사양의 다른 A/S 회차 발주(#16 역링크) — 내가 볼 수 있는 것(수주·MD 발주)만.
    prisma.spPcbPo.findMany({
      where: {
        specId: po.specId,
        reorderRound: { gt: 0, not: po.reorderRound },
        OR: [{ partnerId }, { parentPartnerId: partnerId }],
      },
      orderBy: [{ reorderRound: 'asc' }, { id: 'asc' }],
      select: { id: true, reorderRound: true, status: true, partnerId: true },
    }),
    // A/S 회차 수주(A′) 전용 — 원회차(round 0) 하위 발주. 회차 하위 RFQ 가 없어도
    // [원발주 조건으로 하위 발주](childRfqId 없는 조건 복사)의 대상 후보가 된다.
    direction === 'received' && po.reorderRound > 0
      ? prisma.spPcbPo.findMany({
          where: { specId: po.specId, parentPartnerId: po.partnerId, reorderRound: 0 },
          include: { partner: true },
          orderBy: { id: 'asc' },
        })
      : Promise.resolve([] as PoWithPartner[]),
  ]);

  // 회차당 1건 — MD 는 같은 회차의 상위(수주)·하위(발주)가 다 보이므로 내 수주 문서 우선.
  const roundPick = new Map<number, (typeof roundRows)[number]>();
  for (const row of roundRows) {
    const cur = roundPick.get(row.reorderRound);
    if (cur === undefined || (cur.partnerId !== partnerId && row.partnerId === partnerId)) {
      roundPick.set(row.reorderRound, row);
    }
  }

  const requesterName =
    po.parentPartnerId === 0n
      ? house
      : ((await prisma.spPartner.findUnique({ where: { id: po.parentPartnerId } }))?.name ??
        '중개 조직');

  const { role, fallback } = (() => {
    const r = resolveEqRole(po, { kind: 'partner', partnerId });
    return { role: r.role, fallback: r.fallback };
  })();
  const forward = PCB_EQ_FORWARD[asPcbPoStatus(po.status)];
  const revert = PCB_EQ_REVERT[asPcbPoStatus(po.status)];
  // 내 역할 노출 — 지금 정·역방향 어느 쪽이든 내가 움직일 수 있으면 RECEIVER 로 표기.
  const myRole =
    role === 'RECEIVER' &&
    ((forward !== null && forward.actor === 'RECEIVER') ||
      (revert !== null && revert.actor === 'RECEIVER'))
      ? ('RECEIVER' as const)
      : null;

  return {
    poId: Number(po.id),
    specId: Number(po.specId),
    reorderRound: po.reorderRound,
    status: asPcbPoStatus(po.status),
    direction,
    requesterName,
    // 상세의 상대 — 수주면 발주처, 하위 발주(MD 관전)면 수주 협력사. 헤더가
    // requesterName(자기 조직)을 상대처럼 보여 주던 구멍의 교정(MD 실주행 확정).
    counterpartyName: direction === 'received' ? requesterName : po.partner.name,
    currency: po.currency,
    priceOriginal: Number(po.priceOriginal),
    subCurrency: po.subCurrency,
    subPriceOriginal: decNum(po.subPriceOriginal),
    subExchangeRate: decNum(po.subExchangeRate),
    paymentTerms: po.paymentTerms,
    remittanceDueOn: iso(po.remittanceDueOn),
    remittedAt: iso(po.remittedAt),
    // 수금 내역 — 협력사는 자기 발주서 건만 본다(증빙 파일은 내부 자료라 제외).
    ...(await (async () => {
      const rows = await prisma.spPcbRemittance.findMany({
        where: { poId: po.id },
        orderBy: [{ remittedOn: 'asc' }, { id: 'asc' }],
      });
      return {
        remittances: rows.map((r) => ({
          id: Number(r.id),
          remittedOn: r.remittedOn.toISOString(),
          currency: r.currency,
          amount: Number(r.amount),
          memo: r.memo,
        })),
        remittanceSummary: summarizePcbRemittances(po, rows),
      };
    })()),
    deliveryDate: iso(po.deliveryDate),
    memo: po.memo,
    issuedAt: po.issuedAt.toISOString(),
    eq: {
      files: files.get(po.id.toString()) ?? [],
      history: parseEqHistory(po.eqHistory),
      myRole,
      fallback,
      delegatePoId: delegation.delegatePoId === null ? null : Number(delegation.delegatePoId),
      blocked: delegation.blocked,
    },
    spec: {
      projectName: po.spec.projectName,
      category: po.spec.category,
      orderCategory: po.spec.orderCategory,
      qty: po.spec.qty,
      message: po.spec.message,
      specJson: stripInternalSpecKeys(po.spec.specJson),
      files: await loadPcbSpecFiles(po.specId),
    },
    children: await serializeAdminPos(childrenRows),
    childRfqs: await serializeAdminPcbRfqRows(childRfqRows),
    originChildPos: originChildRows.map((row) => ({
      poId: Number(row.id),
      partnerId: Number(row.partnerId),
      partnerName: row.partner.name,
      currency: row.currency,
      priceOriginal: Number(row.priceOriginal),
      subCurrency: row.subCurrency,
      subPriceOriginal: decNum(row.subPriceOriginal),
      paymentTerms: row.paymentTerms,
    })),
    asRounds: [...roundPick.values()].map((row) => ({
      poId: Number(row.id),
      reorderRound: row.reorderRound,
      status: asPcbPoStatus(row.status),
    })),
    // ── P3 선적 — 소속 발송·같이 보낼 후보·발송 가능/게이팅 파생 ──
    ...(await (async () => {
      const shipmentRow = await findPcbShipmentByPo(po.id);
      const shipment = shipmentRow === null ? null : await toPcbShipmentView(shipmentRow);
      const outboundBlocked =
        asPcbPoStatus(po.status) === 'produced' && (await isPcbOutboundBlocked(po));
      const ctxOk = (await resolvePcbShipContext(po)).ok;
      const canShip =
        direction === 'received' &&
        asPcbPoStatus(po.status) === 'produced' &&
        shipmentRow === null &&
        !outboundBlocked &&
        ctxOk;
      return { shipment, canShip, outboundBlocked };
    })()),
  };
};

/** 포털 스펙 파일 다운로드 인가 — 수주·발주 소속 발주서만. */
export const loadPartnerPcbPoSpecFile = async (
  poId: bigint,
  partnerId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return null;
  if (po.partnerId !== partnerId && po.parentPartnerId !== partnerId) return null;
  const file = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (file === null) return null;
  if (file.refType !== 'sp_order_spec' || file.refId !== po.specId) return null;
  if (file.fileType === 'thumbnail') return null;
  return { pathToken: file.pathToken, originFileName: file.originFileName };
};

/** 포털 EQ 조작 인가 — 수주(본인) 또는 MD(fallback) 소속 발주서. */
export const partnerCanTouchPo = async (
  poId: bigint,
  partnerId: bigint,
): Promise<SpPcbPo | null> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return null;
  if (po.partnerId !== partnerId && po.parentPartnerId !== partnerId) return null;
  return po;
};

// ── 관리자 횡단 워크큐 — 경유 상위(위임)는 숨기고 실작업 단위만 나열 ───────────
// 소속 탭은 **배열**이다 — to_ship(발송 대기)은 produced 의 부분집합이라 배타적이지
// 않다(선적·배송 화면의 첫 탭으로 쓰인다).
export type AdminPcbPoTab = 'waiting' | 'eq_pending' | 'producing' | 'produced' | 'to_ship';

export const loadAdminPcbPoWorkItems = async (
  deliveryDateRange?: PcbDeliveryDateRange,
): Promise<
  { item: AdminPcbPoWorkItemType; tabs: AdminPcbPoTab[] }[]
> => {
  const rows = await prisma.spPcbPo.findMany({
    where:
      deliveryDateRange === undefined
        ? {}
        : {
            deliveryDate: {
              gte: deliveryDateRange.from,
              lt: deliveryDateRange.toExclusive,
            },
          },
    include: { spec: true, partner: true },
    orderBy: { issuedAt: 'desc' },
  });
  const parentIds = [...new Set(rows.map((r) => r.parentPartnerId).filter((p) => p !== 0n))];
  const [parents, shipmentLinks, reviewMap, customerNames] = await Promise.all([
    parentIds.length === 0
      ? Promise.resolve([])
      : prisma.spPartner.findMany({ where: { id: { in: parentIds } } }),
    prisma.spPcbShipmentPo.findMany({
      where: { poId: { in: rows.map((r) => r.id) } },
      select: { poId: true },
    }),
    // Case 상세와 같은 요약을 목록에도 싣는다(1쿼리) — 행을 열지 않아도 고객이 답했는지 안다.
    loadEqReviewRowSummaries(
      rows.map((r) => r.id),
      eqRoundStartMap(rows),
    ),
    // 고객명 — 협력사 축 목록이라도 운영자는 "누구 건"으로 발주를 기억한다. 스펙 단위로
    // 한 벌만 뽑는다(회원 1쿼리 + 주문 1쿼리 — 행마다 부르면 N+1).
    loadPcbCustomerNames(
      rows.map((r) => ({ specId: r.specId, mbId: r.spec.mbId, ctId: r.spec.ctId })),
    ),
  ]);
  const parentNames = new Map(parents.map((p) => [p.id.toString(), p.name]));
  const shippedPoIds = new Set(shipmentLinks.map((l) => l.poId.toString()));
  const portalSet = await loadPartnersWithPortal(rows.map((r) => r.partnerId));

  const out: { item: AdminPcbPoWorkItemType; tabs: AdminPcbPoTab[] }[] = [];
  for (const po of rows) {
    const delegation = await resolveEqDelegation(po);
    if (delegation.delegatePoId !== null) continue; // 경유 상위 — 하위가 실작업 단위
    const status = asPcbPoStatus(po.status);
    const awaitingShipment = status === 'produced' && !shippedPoIds.has(po.id.toString());
    const eqReview = reviewMap.get(po.id.toString()) ?? null;
    // 고객에게 물어본 뒤에는 답이 올 때까지 공이 고객에게 있다 — 그 사이 "내 차례"로
    // 세면 지금 승인해도 되는 건과 섞인다. 기한이 지나면 재촉이 관리자 몫이라 되돌아온다.
    const awaitingCustomer = eqReview?.status === 'requested' && !eqReview.overdue;
    const tabs: AdminPcbPoTab[] = [];
    // 협력사 차례 — 발주는 나갔는데 아직 EQ 승인요청이 없다(첫 요청 대기 또는 반려 뒤 보완).
    if (status === 'issued') tabs.push('waiting');
    if (status === 'eq_requested') tabs.push('eq_pending');
    if (status === 'producing' || status === 'eq_done') tabs.push('producing');
    if (status === 'produced') tabs.push('produced');
    if (awaitingShipment) tabs.push('to_ship');
    out.push({
      item: {
        poId: Number(po.id),
        specId: Number(po.specId),
        projectName: po.spec.projectName,
        mbId: po.spec.mbId,
        customerName: customerNames.get(po.specId.toString()) ?? '',
        partnerName: po.partner.name,
        partnerHasPortal: portalSet.has(po.partnerId.toString()),
        parentPartnerName:
          po.parentPartnerId === 0n
            ? null
            : (parentNames.get(po.parentPartnerId.toString()) ?? null),
        reorderRound: po.reorderRound,
        status,
        currency: po.currency,
        priceOriginal: Number(po.priceOriginal),
        krwAmount: po.krwAmount,
        deliveryDate: iso(po.deliveryDate),
        issuedAt: po.issuedAt.toISOString(),
        adminTurn: status === 'eq_requested' && !delegation.blocked && !awaitingCustomer,
        awaitingShipment,
        // 이력은 행에 이미 있다(추가 조회 없음) — 반려와 요청취소를 note 로 가르는 판정은
        // 계약의 순수 함수가 한다(Case 상세의 반려 배너와 같은 사전).
        rejectedAt: lastPcbEqRejectedAt(parseEqHistory(po.eqHistory)),
        eqReview,
      },
      tabs,
    });
  }
  return out;
};

/** 발주서 삭제/미러 대상 상위 로드(라우트 편의). */
export const loadPcbPoWithPartner = async (poId: bigint): Promise<PoWithPartner | null> =>
  prisma.spPcbPo.findUnique({ where: { id: poId }, include: { partner: true } });
