// 결제 후 부품 확인 요청(D43) — 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
//
// 흐름: 관리자 요청(근거 박제·선택지) → 고객 회신(또는 관리자 대리 회신) → 순액 정산 생성 →
// 관리자 적용(결제 후 단일 행 변경·사급·입고 대기) → 정산 종결(추가결제 확인 / 감액→환불 기록) → 처리 완료.
//
// 불변식:
//  · 원 주문은 1건 그대로 — 돈은 요청 단위 **순액** 1건만 오간다(sp_bom_settlement).
//  · 한 품목엔 열린 이슈 1건(activeKey 'item:{quoteItemId}' unique, pending|decided 동안만).
//  · 요청 전이는 version 낙관적 잠금 — 화면이 본 판본과 다르면 STALE_VERSION(409).
//  · 고객 DTO 에는 협력사명·원가·내부 키를 싣지 않는다(여정 43호).
//  · 결정 판정·저장은 여기 한 곳 — PHP 브리지·sp-vue 는 그리기만 한다(judgment-single-owner).

import { Prisma } from '@prisma/client';
import type {
  SpBomConfirmEvent,
  SpBomConfirmIssue,
  SpBomConfirmRequest,
  SpBomSettlement,
} from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  ADMIN_BOM_CONFIRM_TABS,
  BOM_CONFIRM_ISSUE_TYPES,
  BOM_CONFIRM_ISSUE_TYPE_LABELS,
  BOM_CONFIRM_OPTION_CODES,
  BOM_CONFIRM_REQUEST_CUSTOMER_LABELS,
  BomConfirmEvidence,
  bomConfirmChosenDelta,
  bomConfirmKindChangesItem,
  bomConfirmKindNeedsPayment,
  bomConfirmOptionDefaultTitle,
  bomConfirmVatDelta,
  bomSettlementChargeKey,
  bomSettlementStatusLabel,
  isBomConfirmNoticeType,
  type AdminBomConfirmCountsType,
  type AdminBomConfirmCreateBodyType,
  type AdminBomConfirmEligibilityReasonType,
  type AdminBomConfirmIssueInputType,
  type AdminBomConfirmIssueType,
  type AdminBomConfirmItemRowType,
  type AdminBomConfirmItemStateType,
  type AdminBomConfirmListQueryType,
  type AdminBomConfirmListRowType,
  type AdminBomConfirmMailDeliveryType,
  type AdminBomConfirmOptionInputType,
  type AdminBomConfirmRequestType,
  type AdminBomConfirmTabType,
  type BomConfirmAnswerBodyType,
  type BomConfirmAnswerChannelType,
  type BomConfirmEventActionType,
  type BomConfirmEventType,
  type BomConfirmEvidenceType,
  type BomConfirmIssueStatusType,
  type BomConfirmIssueTypeType,
  type BomConfirmOptionCodeType,
  type BomConfirmOptionType,
  type BomConfirmReplacementPickType,
  type BomConfirmReplacementType,
  type BomConfirmRequestStatusType,
  type BomConfirmShipPreferenceType,
  type BomQuoteSelectedOfferType,
  type BomSettlementKindType,
  type BomSettlementStatusType,
  type BomSettlementType,
  type CustomerBomConfirmIssueType,
  type CustomerBomConfirmMineRowType,
  type CustomerBomConfirmOptionType,
  type CustomerBomConfirmRequestType,
  type CustomerBomSettlementType,
} from '@sp/api-contract';
import { kstDateOnly, kstToday, neededQty } from '@sp/utils';
import { prisma } from './prisma';
import { getBomQuoteRuntimeConfig } from './exchange-rate';
import {
  amendQuoteItemAfterOrder,
  filterActiveQuoteItems,
  resolvePostOrderChange,
  toItemDto,
  type PostOrderChange,
  type PostOrderResolveError,
} from './bom-quote';
import {
  PAID_ORDER_STATUSES,
  addOrderRefund,
  deleteCartRow,
  deleteCartRowsByIoId,
  deleteQuoteOption,
  getBomExtraAnchorItem,
  getCartRowByCtId,
  getMembersByIds,
  getNotifyConfig,
  getOrderHeadersLite,
  getOrderInfoByCtId,
  insertCartRow,
  insertQuoteOption,
  reduceOrderedBomRowAmount,
  selectCartRows,
} from './g5-db';
import { isBomOrderFulfillmentClosed, isBomOrderLinePaid } from './bom-order-cancel';
import { bomCaseNo } from './bom-case-delete';
import { PARTNER_SUPPLIER, SAMPLEPCB_SUPPLIER } from './parts-facts';
import { recordMailLog, type MailLogMeta } from './mail-log';
import { sendBomRfqMail } from './rfq-email';
import { buildBomConfirmAnsweredEmail, buildBomConfirmNoticeEmail, buildBomConfirmRequestEmail } from './bom-confirm-email';
import { chosenConfirmOption, parseConfirmOptions } from './bom-confirm-gates';

// ── 공용 ─────────────────────────────────────────────────────────────────────

const OPEN_ISSUE_STATUSES: ReadonlySet<string> = new Set(['pending', 'decided']);
const TERMINAL_ISSUE_STATUSES: ReadonlySet<string> = new Set(['applied', 'closed', 'canceled']);
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

export const confirmIssueActiveKey = (quoteItemId: bigint): string => `item:${String(quoteItemId)}`;

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);
const kstYmd = (d: Date | null): string | null => (d === null ? null : kstDateOnly(d.toISOString()));

const parseOptions = parseConfirmOptions;
const chosenOption = chosenConfirmOption;

function asRequestStatus(value: string): BomConfirmRequestStatusType {
  return value === 'answered' || value === 'resolved' || value === 'canceled' ? value : 'requested';
}
function asIssueStatus(value: string): BomConfirmIssueStatusType {
  return value === 'decided' || value === 'applied' || value === 'closed' || value === 'canceled'
    ? value
    : 'pending';
}
function asIssueType(value: string): BomConfirmIssueTypeType {
  return (BOM_CONFIRM_ISSUE_TYPES as readonly string[]).includes(value) ? (value as BomConfirmIssueTypeType) : 'stock_out';
}
/** 알림 요청(가격 인하·단종) — 이슈가 모두 알림 유형이다(질문과 섞지 않는다, D44-5). */
function isNoticeRequest(issues: Pick<SpBomConfirmIssue, 'issueType'>[]): boolean {
  return issues.length > 0 && issues.every((issue) => isBomConfirmNoticeType(asIssueType(issue.issueType)));
}
const NOTICE_CUSTOMER_LABEL = '안내';
function asSettlementKind(value: string): BomSettlementKindType {
  return value === 'refund' ? 'refund' : 'charge';
}
function asSettlementStatus(value: string): BomSettlementStatusType {
  return value === 'paid' || value === 'reduced' || value === 'refunded' || value === 'canceled'
    ? value
    : 'pending';
}
function asShipPreference(value: string | null): BomConfirmShipPreferenceType | null {
  return value === 'together' || value === 'split' ? value : null;
}
function asOptionCode(value: string | null): BomConfirmOptionCodeType | null {
  return (BOM_CONFIRM_OPTION_CODES as readonly string[]).includes(value ?? '')
    ? (value as BomConfirmOptionCodeType)
    : null;
}
function asAnswerChannel(value: string | null): BomConfirmAnswerChannelType | null {
  return value === 'web' || value === 'phone' || value === 'email' || value === 'other' ? value : null;
}

function parseEvidence(value: Prisma.JsonValue): BomConfirmEvidenceType {
  return BomConfirmEvidence.parse(value);
}

/** 고객에게 보여도 되는 공급처 표시 — 협력사명은 감춘다(공급망 비노출). */
export function customerSupplierLabel(
  offer: Pick<BomQuoteSelectedOfferType, 'supplier' | 'offerKey'> | null,
  selectionSource: string | null,
): string | null {
  if (offer === null) return null;
  const supplier = offer.supplier.trim();
  if (
    selectionSource === 'partner'
    || (offer.offerKey ?? '').startsWith('rfq:')
    || supplier.toLowerCase() === PARTNER_SUPPLIER
  ) return '당사 협력 공급처';
  const lower = supplier.toLowerCase();
  if (lower === SAMPLEPCB_SUPPLIER) return '샘플피씨비';
  const known: Record<string, string> = { digikey: 'DigiKey', mouser: 'Mouser', unikeyic: 'UniKeyIC', lcsc: 'LCSC' };
  return known[lower] ?? (supplier === '' ? null : supplier);
}

function sourceLocation(row: {
  sourceSheetName: string | null;
  sourceRow: Prisma.JsonValue;
}): string | null {
  if (row.sourceSheetName === null) return '수동 추가 품목';
  const source = row.sourceRow !== null && typeof row.sourceRow === 'object' && !Array.isArray(row.sourceRow)
    ? row.sourceRow
    : null;
  const rows = Array.isArray(source?.sourceRows)
    ? source.sourceRows.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
    : [];
  const refs = Array.isArray(source?.referenceDesignators)
    ? source.referenceDesignators.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : [];
  const parts = [row.sourceSheetName];
  if (rows.length > 0) parts.push(`${rows.slice(0, 5).join(', ')}행`);
  if (refs.length > 0) parts.push(refs.slice(0, 6).join(', ') + (refs.length > 6 ? ' 외' : ''));
  return parts.join(' · ');
}

function sourcePackage(row: { sourceRow: Prisma.JsonValue }): string | null {
  const source = row.sourceRow !== null && typeof row.sourceRow === 'object' && !Array.isArray(row.sourceRow)
    ? row.sourceRow
    : null;
  const value = source?.packageCode;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const optionCodeAt = (index: number): BomConfirmOptionCodeType =>
  BOM_CONFIRM_OPTION_CODES[Math.min(index, BOM_CONFIRM_OPTION_CODES.length - 1)] ?? 'E';

function isOverdue(request: Pick<SpBomConfirmRequest, 'status' | 'dueOn'>): boolean {
  const due = kstYmd(request.dueOn);
  return request.status === 'requested' && due !== null && due < kstToday();
}

// ── 주문 연결·자격 ───────────────────────────────────────────────────────────

export interface ConfirmCaseOrder {
  odId: string;
  ctId: number;
  odStatus: string;
  rowCtStatus: string;
  rowIoId: string;
  rowIoPrice: number;
}

async function loadCaseOrder(ctId: number | null): Promise<{
  order: ConfirmCaseOrder | null;
  reason: AdminBomConfirmEligibilityReasonType | null;
}> {
  if (ctId === null) return { order: null, reason: 'NOT_ORDERED' };
  const info = await getOrderInfoByCtId(ctId);
  if (info === null) return { order: null, reason: 'NOT_ORDERED' };
  const order: ConfirmCaseOrder = {
    odId: info.odId,
    ctId,
    odStatus: info.odStatus,
    rowCtStatus: info.rowCtStatus,
    rowIoId: info.rowIoId,
    rowIoPrice: info.rowIoPrice,
  };
  if (isBomOrderFulfillmentClosed(info.odStatus, info.rowCtStatus) || info.odStatus === '배송') {
    return { order, reason: 'ORDER_CLOSED' };
  }
  if (!isBomOrderLinePaid(info.rowCtStatus)) return { order, reason: 'NOT_PAID' };
  return { order, reason: null };
}

// ── 품목 현재 상태(발주 연결) ───────────────────────────────────────────────

interface ItemPoLink {
  poId: bigint;
  status: string;
  partnerName: string;
  supplier: boolean;
}

async function loadItemPoLinks(quoteId: bigint): Promise<Map<string, ItemPoLink>> {
  const poItems = await prisma.spBomPoItem.findMany({
    where: { po: { quoteId } },
    select: {
      quoteItemId: true,
      po: { select: { id: true, status: true, partner: { select: { name: true, type: true } } } },
    },
  });
  const links = new Map<string, ItemPoLink>();
  for (const poItem of poItems) {
    links.set(String(poItem.quoteItemId), {
      poId: poItem.po.id,
      status: poItem.po.status,
      partnerName: poItem.po.partner.name,
      supplier: poItem.po.partner.type === 'supplier',
    });
  }
  return links;
}

const toPoView = (link: ItemPoLink | undefined): AdminBomConfirmItemStateType['po'] =>
  link === undefined
    ? null
    : { poId: String(link.poId), status: link.status, partnerName: link.partnerName, supplier: link.supplier };

// ── DTO ──────────────────────────────────────────────────────────────────────

type RequestWithChildren = SpBomConfirmRequest & {
  issues: SpBomConfirmIssue[];
  events: SpBomConfirmEvent[];
};

const REQUEST_INCLUDE = {
  issues: { orderBy: { sortOrder: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SpBomConfirmRequestInclude;

export function toSettlementDto(settlement: SpBomSettlement): BomSettlementType {
  const kind = asSettlementKind(settlement.kind);
  const status = asSettlementStatus(settlement.status);
  return {
    id: String(settlement.id),
    quoteId: String(settlement.quoteId),
    requestId: settlement.requestId === null ? null : String(settlement.requestId),
    kind,
    status,
    statusLabel: bomSettlementStatusLabel(kind, status),
    amount: settlement.amount,
    chargeKey: settlement.chargeKey,
    ctId: settlement.ctId,
    paidOdId: settlement.paidOdId,
    paidAt: iso(settlement.paidAt),
    odId: settlement.odId,
    reducedAt: iso(settlement.reducedAt),
    refundedAt: iso(settlement.refundedAt),
    note: settlement.note,
    createdAt: settlement.createdAt.toISOString(),
  };
}

function toEventDto(event: SpBomConfirmEvent): BomConfirmEventType {
  const role = event.actorRole === 'customer' || event.actorRole === 'admin' ? event.actorRole : 'system';
  return {
    id: String(event.id),
    issueId: event.issueId === null ? null : String(event.issueId),
    action: event.action as BomConfirmEventActionType,
    actorRole: role,
    actorMbId: event.actorMbId,
    note: event.note,
    createdAt: event.createdAt.toISOString(),
  };
}

/** 순액 — 고객 선택 기준(+추가결제 · −환불). 선택 전 issue 가 하나라도 있으면 null. */
export function requestNetDelta(issues: Pick<SpBomConfirmIssue, 'status' | 'options' | 'chosenCode' | 'shipPreference'>[]): number | null {
  let net = 0;
  for (const issue of issues) {
    if (issue.status === 'canceled') continue;
    const option = chosenOption(parseOptions(issue.options), issue.chosenCode);
    if (option === null) return null;
    net += bomConfirmChosenDelta(option, asShipPreference(issue.shipPreference));
  }
  return net;
}

function toFollowup(issue: SpBomConfirmIssue): AdminBomConfirmIssueType['followup'] {
  if (issue.followupCarrier === null || issue.followupInvoice === null || issue.followupShippedAt === null) return null;
  return {
    carrier: issue.followupCarrier,
    invoice: issue.followupInvoice,
    shippedAt: kstYmd(issue.followupShippedAt) ?? issue.followupShippedAt.toISOString(),
  };
}

interface ItemStateSource {
  rows: Map<string, { fulfillment: string; mpn: string }>;
  poLinks: Map<string, ItemPoLink>;
}

async function loadItemStateSource(quoteId: bigint): Promise<ItemStateSource> {
  const [items, poLinks] = await Promise.all([
    prisma.spBomQuoteItem.findMany({
      where: { quoteId },
      select: { id: true, fulfillment: true, mpn: true },
    }),
    loadItemPoLinks(quoteId),
  ]);
  return {
    rows: new Map(items.map((item) => [String(item.id), { fulfillment: item.fulfillment, mpn: item.mpn }] as const)),
    poLinks,
  };
}

function toAdminIssueDto(issue: SpBomConfirmIssue, source: ItemStateSource): AdminBomConfirmIssueType {
  const row = source.rows.get(String(issue.quoteItemId));
  const fulfillment = row?.fulfillment;
  return {
    id: String(issue.id),
    quoteItemId: String(issue.quoteItemId),
    sortOrder: issue.sortOrder,
    issueType: asIssueType(issue.issueType),
    status: asIssueStatus(issue.status),
    description: issue.description,
    evidence: parseEvidence(issue.evidence),
    options: parseOptions(issue.options),
    chosenCode: asOptionCode(issue.chosenCode),
    shipPreference: asShipPreference(issue.shipPreference),
    appliedAt: iso(issue.appliedAt),
    appliedBy: issue.appliedBy,
    applyNote: issue.applyNote,
    followup: toFollowup(issue),
    itemState: {
      exists: row !== undefined,
      fulfillment: fulfillment === 'customer_supply' || fulfillment === 'backorder' ? fulfillment : 'normal',
      mpn: row?.mpn ?? null,
      po: toPoView(source.poLinks.get(String(issue.quoteItemId))),
    },
  };
}

function toAdminRequestDto(
  request: RequestWithChildren,
  settlement: SpBomSettlement | null,
  source: ItemStateSource,
): AdminBomConfirmRequestType {
  return {
    id: String(request.id),
    quoteId: String(request.quoteId),
    odId: request.odId,
    ctId: request.ctId,
    status: asRequestStatus(request.status),
    notice: isNoticeRequest(request.issues),
    settlementMode: 'difference',
    message: request.message,
    dueOn: kstYmd(request.dueOn),
    overdue: isOverdue(request),
    version: request.version,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt.toISOString(),
    answeredAt: iso(request.answeredAt),
    answeredBy: request.answeredBy,
    answeredRole: request.answeredRole === 'customer' || request.answeredRole === 'admin' ? request.answeredRole : null,
    answerChannel: asAnswerChannel(request.answerChannel),
    customerNote: request.customerNote,
    resolvedAt: iso(request.resolvedAt),
    canceledAt: iso(request.canceledAt),
    cancelReason: request.cancelReason,
    netDelta: request.status === 'requested' || request.status === 'canceled' ? null : requestNetDelta(request.issues),
    settlement: settlement === null ? null : toSettlementDto(settlement),
    issues: request.issues.map((issue) => toAdminIssueDto(issue, source)),
    events: request.events.map(toEventDto),
  };
}

function toCustomerReplacement(
  replacement: BomConfirmReplacementType | null,
): CustomerBomConfirmOptionType['replacement'] {
  if (replacement === null) return null;
  return {
    source: replacement.source,
    supplierLabel: replacement.supplierLabel,
    mpn: replacement.mpn,
    manufacturerName: replacement.manufacturerName,
    description: replacement.description,
    packageCode: replacement.packageCode,
    lifecycleCode: replacement.lifecycleCode,
    datasheetUrl: replacement.datasheetUrl,
    unitPriceKrw: replacement.unitPriceKrw,
    orderQty: replacement.orderQty,
    lineTotalKrw: replacement.lineTotalKrw,
    moq: replacement.moq,
    stock: replacement.stock,
    leadTime: replacement.leadTime,
    engine: replacement.engine,
  };
}

function toCustomerIssueDto(issue: SpBomConfirmIssue): CustomerBomConfirmIssueType {
  const issueType = asIssueType(issue.issueType);
  return {
    id: String(issue.id),
    sortOrder: issue.sortOrder,
    issueType,
    issueTypeLabel: BOM_CONFIRM_ISSUE_TYPE_LABELS[issueType],
    status: asIssueStatus(issue.status),
    description: issue.description,
    evidence: parseEvidence(issue.evidence),
    options: parseOptions(issue.options).map((option) => ({
      code: option.code,
      kind: option.kind,
      title: option.title,
      detail: option.detail,
      priceDelta: option.priceDelta,
      replacement: toCustomerReplacement(option.replacement),
      moq: option.moq,
      restock: option.restock,
      price: option.price,
    })),
    chosenCode: asOptionCode(issue.chosenCode),
    shipPreference: asShipPreference(issue.shipPreference),
    applied: issue.status === 'applied',
    followup: toFollowup(issue),
  };
}

function toCustomerSettlementDto(
  settlement: SpBomSettlement,
  requestStatus: BomConfirmRequestStatusType,
  orderPendingIds: ReadonlySet<string>,
): CustomerBomSettlementType {
  const kind = asSettlementKind(settlement.kind);
  const status = asSettlementStatus(settlement.status);
  const payable = kind === 'charge' && status === 'pending' && requestStatus !== 'canceled';
  const orderPending = payable && orderPendingIds.has(String(settlement.id));
  return {
    id: String(settlement.id),
    kind,
    status,
    statusLabel: orderPending ? '입금 확인 대기' : bomSettlementStatusLabel(kind, status),
    amount: settlement.amount,
    paidAt: iso(settlement.paidAt),
    refundedAt: iso(settlement.refundedAt),
    canCheckout: payable && !orderPending,
    orderPending,
  };
}

function toCustomerRequestDto(
  request: SpBomConfirmRequest & { issues: SpBomConfirmIssue[] },
  quoteTitle: string,
  settlement: SpBomSettlement | null,
  orderPendingIds: ReadonlySet<string>,
): CustomerBomConfirmRequestType {
  const status = asRequestStatus(request.status);
  const notice = isNoticeRequest(request.issues);
  return {
    id: String(request.id),
    quoteId: String(request.quoteId),
    quoteTitle,
    odId: request.odId,
    ctId: request.ctId,
    status,
    statusLabel: notice && status !== 'canceled' ? NOTICE_CUSTOMER_LABEL : BOM_CONFIRM_REQUEST_CUSTOMER_LABELS[status],
    notice,
    message: request.message,
    dueOn: kstYmd(request.dueOn),
    overdue: isOverdue(request),
    version: request.version,
    requestedAt: request.requestedAt.toISOString(),
    answeredAt: iso(request.answeredAt),
    answeredByAdmin: request.answeredRole === 'admin',
    customerNote: request.customerNote,
    netDelta: status === 'requested' || status === 'canceled' ? null : requestNetDelta(request.issues),
    settlement: settlement === null ? null : toCustomerSettlementDto(settlement, status, orderPendingIds),
    issues: request.issues.filter((issue) => issue.status !== 'canceled' || status === 'canceled').map(toCustomerIssueDto),
  };
}

async function loadSettlementsByRequest(requestIds: bigint[]): Promise<Map<string, SpBomSettlement>> {
  if (requestIds.length === 0) return new Map();
  const rows = await prisma.spBomSettlement.findMany({
    where: { requestId: { in: requestIds } },
    orderBy: { id: 'desc' },
  });
  const map = new Map<string, SpBomSettlement>();
  for (const row of rows) {
    if (row.requestId === null) continue;
    const key = String(row.requestId);
    // 요청당 정산은 1건이 원칙 — 취소 후 재생성이 있으면 살아 있는 최신을 보인다.
    const current = map.get(key);
    if (current === undefined || (current.status === 'canceled' && row.status !== 'canceled')) map.set(key, row);
  }
  return map;
}

// ── 추가결제 확인(lazy) ──────────────────────────────────────────────────────

/**
 * charge·pending·카트행이 있을 때 그 줄을 검증해(결제 상태 ∧ io_id==chargeKey ∧ io_price==amount) paid 로
 * 올린다. 래칫 — 이후 주문이 역행해도 paid 유지(ensurePaidLazy 관례). 목록·상세 조회가 부른다.
 */
export async function ensureChargePaidLazy(settlement: SpBomSettlement): Promise<SpBomSettlement> {
  return (await inspectChargeLine(settlement)).settlement;
}

/**
 * 추가결제 줄 판정 — 결제됐으면 paid 로 올리고(래칫), 주문서만 내고 입금 전(무통장 '주문')이면
 * orderPending 을 세운다. 고객 화면은 orderPending 이면 결제 버튼 대신 '입금 확인 대기'를 보인다.
 */
async function inspectChargeLine(
  settlement: SpBomSettlement,
): Promise<{ settlement: SpBomSettlement; orderPending: boolean }> {
  const untouched = { settlement, orderPending: false };
  if (settlement.kind !== 'charge' || settlement.status !== 'pending' || settlement.ctId === null) return untouched;
  const info = await getOrderInfoByCtId(settlement.ctId);
  if (info === null) return untouched;
  const lineMatches = info.rowIoId === settlement.chargeKey && info.rowIoPrice === settlement.amount;
  if (!lineMatches) return untouched;
  if (!PAID_ORDER_STATUSES.includes(info.rowCtStatus)) {
    return { settlement, orderPending: info.odStatus === '주문' && info.rowCtStatus === '주문' };
  }
  return { settlement: await promoteChargePaid(settlement, info.odId), orderPending: false };
}

async function promoteChargePaid(settlement: SpBomSettlement, paidOdId: string): Promise<SpBomSettlement> {
  const now = new Date();
  const promoted = await prisma.$transaction(async (tx) => {
    const updated = await tx.spBomSettlement.updateMany({
      where: { id: settlement.id, status: 'pending' },
      data: { status: 'paid', paidAt: now, paidOdId },
    });
    if (updated.count === 0 || settlement.requestId === null) return updated.count > 0;
    await tx.spBomConfirmEvent.create({
      data: {
        requestId: settlement.requestId,
        action: 'settlement_paid',
        actorRole: 'system',
        actorMbId: null,
        note: `추가결제 ${settlement.amount.toLocaleString('ko-KR')}원 확인 (주문 ${paidOdId})`,
      },
    });
    return true;
  });
  const fresh = await prisma.spBomSettlement.findUnique({ where: { id: settlement.id } });
  if (promoted && fresh?.requestId != null) await maybeAutoResolve(fresh.requestId);
  return fresh ?? settlement;
}

/** 요청별 정산 맵의 대기 추가결제를 판정해 갱신하고, 입금 확인 대기인 정산 id 를 돌려준다. */
async function refreshPendingCharges(settlements: Map<string, SpBomSettlement>): Promise<Set<string>> {
  const orderPending = new Set<string>();
  for (const [key, settlement] of settlements) {
    if (settlement.kind === 'charge' && settlement.status === 'pending' && settlement.ctId !== null) {
      const inspected = await inspectChargeLine(settlement);
      settlements.set(key, inspected.settlement);
      if (inspected.orderPending) orderPending.add(String(settlement.id));
    }
  }
  return orderPending;
}

// ── 자동 처리 완료 ───────────────────────────────────────────────────────────

/** 모든 이슈가 닫히고 정산이 끝났으면 요청을 처리 완료로 닫는다(관리자 버튼 없이). */
export async function maybeAutoResolve(requestId: bigint): Promise<boolean> {
  const request = await prisma.spBomConfirmRequest.findUnique({
    where: { id: requestId },
    include: { issues: true },
  });
  if (request?.status !== 'answered') return false;
  if (!request.issues.every((issue) => TERMINAL_ISSUE_STATUSES.has(issue.status))) return false;
  const settlements = await prisma.spBomSettlement.findMany({ where: { requestId } });
  const settled = settlements.every((row) => row.status === 'paid' || row.status === 'refunded' || row.status === 'canceled');
  if (!settled) return false;
  const now = new Date();
  const updated = await prisma.spBomConfirmRequest.updateMany({
    where: { id: requestId, status: 'answered', version: request.version },
    data: { status: 'resolved', resolvedAt: now, version: { increment: 1 } },
  });
  if (updated.count === 0) return false;
  await prisma.spBomConfirmEvent.create({
    data: { requestId, action: 'resolved', actorRole: 'system', actorMbId: null, note: null },
  });
  return true;
}

// ── 관리자: Case 뷰 ──────────────────────────────────────────────────────────

export async function loadAdminConfirmCase(quoteId: bigint): Promise<{
  eligibility: { canCreate: boolean; reason: AdminBomConfirmEligibilityReasonType | null; odId: string | null; ctId: number | null };
  items: AdminBomConfirmItemRowType[];
  requests: AdminBomConfirmRequestType[];
} | null> {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  if (quote === null) return null;
  const [{ order, reason }, requests, source] = await Promise.all([
    loadCaseOrder(quote.ctId),
    prisma.spBomConfirmRequest.findMany({
      where: { quoteId },
      include: REQUEST_INCLUDE,
      orderBy: { requestedAt: 'desc' },
    }),
    loadItemStateSource(quoteId),
  ]);
  const settlements = await loadSettlementsByRequest(requests.map((request) => request.id));
  await refreshPendingCharges(settlements);
  // lazy 승격이 요청을 자동 종결했을 수 있어 요청을 다시 읽는다(한 번뿐 — 비용 작음).
  const freshRequests = await prisma.spBomConfirmRequest.findMany({
    where: { quoteId },
    include: REQUEST_INCLUDE,
    orderBy: { requestedAt: 'desc' },
  });

  const activeIssueByItem = new Map<string, string>();
  for (const request of freshRequests) {
    for (const issue of request.issues) {
      if (OPEN_ISSUE_STATUSES.has(issue.status)) activeIssueByItem.set(String(issue.quoteItemId), String(issue.id));
    }
  }
  const items = filterActiveQuoteItems(quote.items, quote.sheets)
    .filter((row) => row.included)
    .map((row): AdminBomConfirmItemRowType => {
      const dto = toItemDto(row);
      const offer = dto.selectedOffer;
      return {
        quoteItemId: String(row.id),
        rowIdx: row.rowIdx,
        mpn: row.mpn,
        manufacturerName: row.manufacturerName,
        description: row.description,
        neededQty: neededQty(row.bomQty, quote.setQty, quote.spareQty),
        orderQty: row.orderQty,
        lineTotalKrw: dto.lineTotalKrw,
        supplierLabel: customerSupplierLabel(offer, dto.selectionSource),
        offerStock: offer?.stock ?? null,
        offerMoq: offer?.moq ?? null,
        fulfillment: row.fulfillment === 'customer_supply' || row.fulfillment === 'backorder' ? row.fulfillment : 'normal',
        activeIssueId: activeIssueByItem.get(String(row.id)) ?? null,
        po: toPoView(source.poLinks.get(String(row.id))),
      };
    });
  return {
    eligibility: { canCreate: reason === null, reason, odId: order?.odId ?? null, ctId: order?.ctId ?? null },
    items,
    requests: freshRequests.map((request) =>
      toAdminRequestDto(request, settlements.get(String(request.id)) ?? null, source)),
  };
}

export async function loadAdminConfirmRequest(quoteId: bigint, requestId: bigint): Promise<AdminBomConfirmRequestType | null> {
  const request = await prisma.spBomConfirmRequest.findFirst({
    where: { id: requestId, quoteId },
    include: REQUEST_INCLUDE,
  });
  if (request === null) return null;
  const [settlements, source] = await Promise.all([
    loadSettlementsByRequest([request.id]),
    loadItemStateSource(quoteId),
  ]);
  return toAdminRequestDto(request, settlements.get(String(request.id)) ?? null, source);
}

// ── 관리자: 요청 작성 ────────────────────────────────────────────────────────

export type ConfirmCreateError =
  | { code: 'QUOTE_NOT_FOUND' }
  | { code: AdminBomConfirmEligibilityReasonType }
  | { code: 'ITEM_NOT_FOUND'; quoteItemId: string }
  | { code: 'ITEM_NOT_ELIGIBLE'; quoteItemId: string }
  | { code: 'ITEM_HAS_OPEN_ISSUE'; quoteItemId: string }
  | { code: 'DUPLICATE_ITEM'; quoteItemId: string }
  | { code: 'REPLACEMENT_UNAVAILABLE'; quoteItemId: string; reason: PostOrderResolveError }
  | { code: 'MOQ_QTY_INVALID'; quoteItemId: string };

function replacementChange(pick: BomConfirmReplacementPickType): PostOrderChange {
  if (pick.source === 'candidate') {
    return { source: 'candidate', candidateKey: pick.candidateKey, offerKey: pick.offerKey };
  }
  if (pick.source === 'catalog') {
    return { source: 'catalog', partId: BigInt(pick.partId), offer: pick.offer };
  }
  return { source: 'rfq', rfqItemId: BigInt(pick.rfqItemId) };
}

/** 저장된 선택지 → 적용 때 다시 해석할 변경 명세. */
function changeFromOption(option: BomConfirmOptionType): PostOrderChange | null {
  if (option.kind === 'moq_purchase') {
    return option.moq === null ? null : { source: 'qty', orderQty: option.moq.orderQty };
  }
  if (option.kind !== 'substitute' && option.kind !== 'alt_supplier') return null;
  const replacement = option.replacement;
  if (replacement === null) return null;
  if (replacement.source === 'candidate' && replacement.candidateKey !== null) {
    return { source: 'candidate', candidateKey: replacement.candidateKey, offerKey: replacement.offerKey };
  }
  if (replacement.source === 'catalog' && replacement.partId !== null) {
    return {
      source: 'catalog',
      partId: BigInt(replacement.partId),
      offer: replacement.supplier !== null && replacement.supplierSku !== null
        ? { supplier: replacement.supplier, supplierSku: replacement.supplierSku }
        : null,
    };
  }
  if (replacement.source === 'rfq' && replacement.rfqItemId !== null) {
    return { source: 'rfq', rfqItemId: BigInt(replacement.rfqItemId) };
  }
  return null;
}

interface BuiltIssue {
  quoteItemId: bigint;
  issueType: BomConfirmIssueTypeType;
  description: string;
  evidence: BomConfirmEvidenceType;
  options: BomConfirmOptionType[];
}

async function buildIssue(
  quoteId: bigint,
  quote: { setQty: number; spareQty: number },
  row: Parameters<typeof toItemDto>[0],
  input: AdminBomConfirmIssueInputType,
  usdKrwRate: number | null,
  now: Date,
): Promise<BuiltIssue | ConfirmCreateError> {
  const dto = toItemDto(row);
  const needed = neededQty(row.bomQty, quote.setQty, quote.spareQty);
  const previousLine = dto.lineTotalKrw;
  const evidence: BomConfirmEvidenceType = {
    part: {
      mpn: row.mpn,
      manufacturerName: row.manufacturerName,
      description: row.description,
      packageCode: sourcePackage(row),
      neededQty: needed,
      orderQty: row.orderQty,
      unitPriceKrw: dto.selectedOffer?.unitPriceKrw ?? null,
      lineTotalKrw: previousLine,
      supplierLabel: customerSupplierLabel(dto.selectedOffer, dto.selectionSource),
      location: sourceLocation(row),
    },
    observation: {
      checkedAt: now.toISOString(),
      sourceLabel: input.observation.sourceLabel ?? customerSupplierLabel(dto.selectedOffer, dto.selectionSource),
      stock: input.observation.stock ?? null,
      moq: input.observation.moq ?? null,
      leadTime: input.observation.leadTime ?? null,
      note: input.observation.note ?? null,
      unitPriceKrw: input.observation.unitPriceKrw ?? null,
    },
  };
  const quoteItemId = String(row.id);
  const pricing: OptionPricing = {
    beforeUnitKrw: evidence.part.unitPriceKrw,
    afterUnitKrw: evidence.observation.unitPriceKrw,
    orderQty: row.orderQty,
  };
  const options: BomConfirmOptionType[] = [];
  for (const [index, optionInput] of input.options.entries()) {
    const built = await buildOption(quoteId, row.id, input.issueType, optionInput, index, previousLine, needed, usdKrwRate, pricing);
    if (!built.ok) {
      return built.error === 'MOQ_QTY_INVALID'
        ? { code: 'MOQ_QTY_INVALID', quoteItemId }
        : { code: 'REPLACEMENT_UNAVAILABLE', quoteItemId, reason: built.reason };
    }
    options.push(built.option);
  }
  // 알림은 답을 받지 않으니 상담 요청을 붙이지 않는다(D44-5).
  if (!isBomConfirmNoticeType(input.issueType)) {
    options.push({
      code: optionCodeAt(options.length),
      kind: 'consult',
      title: bomConfirmOptionDefaultTitle(input.issueType, 'consult'),
      detail: '맞는 선택지가 없으면 담당자와 상담해 정합니다.',
      priceDelta: 0,
      referenceDelta: null,
      replacement: null,
      moq: null,
      restock: null,
      price: null,
    });
  }
  return {
    quoteItemId: row.id,
    issueType: input.issueType,
    description: input.description,
    evidence,
    options,
  };
}

/** 같은 부품의 값만 바뀌는 선택지의 단가 근거 — 주문 당시 단가 → 관찰 단가(원, VAT 별도). */
interface OptionPricing {
  beforeUnitKrw: number | null;
  afterUnitKrw: number | null;
  orderQty: number;
}

/** 단가 비교 + 참고 차액(새 라인 − 원 라인, ×1.1). 관찰 단가가 없으면 비교 없음. */
function pricePlan(
  pricing: OptionPricing,
  previousLine: number | null,
): { price: BomConfirmOptionType['price']; referenceDelta: number | null } {
  if (pricing.afterUnitKrw === null) return { price: null, referenceDelta: null };
  const lineTotalKrw = Math.round(pricing.afterUnitKrw * pricing.orderQty * 100) / 100;
  return {
    price: {
      beforeUnitKrw: pricing.beforeUnitKrw,
      afterUnitKrw: pricing.afterUnitKrw,
      orderQty: pricing.orderQty,
      lineTotalKrw,
    },
    referenceDelta: bomConfirmVatDelta(lineTotalKrw, previousLine),
  };
}

async function buildOption(
  quoteId: bigint,
  itemId: bigint,
  issueType: BomConfirmIssueTypeType,
  input: AdminBomConfirmOptionInputType,
  index: number,
  previousLine: number | null,
  needed: number,
  usdKrwRate: number | null,
  pricing: OptionPricing,
): Promise<
  | { ok: true; option: BomConfirmOptionType }
  | { ok: false; error: 'REPLACEMENT_UNAVAILABLE'; reason: PostOrderResolveError }
  | { ok: false; error: 'MOQ_QTY_INVALID' }
> {
  const base: BomConfirmOptionType = {
    code: optionCodeAt(index),
    kind: input.kind,
    title: input.title ?? bomConfirmOptionDefaultTitle(issueType, input.kind),
    detail: input.detail === undefined || input.detail === '' ? null : input.detail,
    priceDelta: input.priceDelta,
    referenceDelta: null,
    replacement: null,
    moq: null,
    restock: null,
    price: null,
  };
  if (input.kind === 'price_accept' || (input.kind === 'notice' && issueType === 'price_decrease')) {
    return { ok: true, option: { ...base, ...pricePlan(pricing, previousLine) } };
  }
  if (input.kind === 'accept_as_is' || input.kind === 'notice') {
    return { ok: true, option: { ...base, referenceDelta: 0 } };
  }
  if (input.kind === 'substitute' || input.kind === 'alt_supplier') {
    if (input.replacement === undefined) return { ok: false, error: 'REPLACEMENT_UNAVAILABLE', reason: 'no-offer' };
    const resolved = await resolvePostOrderChange(prisma, quoteId, itemId, replacementChange(input.replacement), usdKrwRate);
    if (typeof resolved === 'string') return { ok: false, error: 'REPLACEMENT_UNAVAILABLE', reason: resolved };
    const offer = resolved.item.selectedOffer;
    const pick = input.replacement;
    const replacement: BomConfirmReplacementType = {
      source: pick.source,
      candidateKey: pick.source === 'candidate' ? pick.candidateKey : null,
      offerKey: pick.source === 'candidate' ? resolved.selectedOfferKey : null,
      partId: resolved.item.partId,
      rfqItemId: pick.source === 'rfq' ? pick.rfqItemId : null,
      supplier: offer?.supplier ?? null,
      supplierSku: offer === null || offer.supplierSku === '' ? null : offer.supplierSku,
      supplierLabel: customerSupplierLabel(offer, resolved.item.selectionSource) ?? '공급처 미정',
      mpn: resolved.item.mpn,
      manufacturerName: resolved.item.manufacturerName,
      description: resolved.item.description,
      packageCode: resolved.display.packageCode,
      lifecycleCode: resolved.display.lifecycleCode,
      datasheetUrl: resolved.display.datasheetUrl,
      unitPriceKrw: offer?.unitPriceKrw ?? null,
      orderQty: resolved.item.orderQty,
      lineTotalKrw: resolved.item.lineTotalKrw,
      moq: offer?.moq ?? null,
      stock: offer?.stock ?? null,
      leadTime: resolved.display.leadTime,
      engine: resolved.display.engine,
    };
    return {
      ok: true,
      option: { ...base, replacement, referenceDelta: bomConfirmVatDelta(resolved.item.lineTotalKrw, previousLine) },
    };
  }
  if (input.kind === 'moq_purchase') {
    const orderQty = input.moqOrderQty ?? 0;
    if (orderQty < needed) return { ok: false, error: 'MOQ_QTY_INVALID' };
    const resolved = await resolvePostOrderChange(prisma, quoteId, itemId, { source: 'qty', orderQty }, usdKrwRate);
    if (typeof resolved === 'string') return { ok: false, error: 'REPLACEMENT_UNAVAILABLE', reason: resolved };
    return {
      ok: true,
      option: {
        ...base,
        moq: {
          neededQty: needed,
          orderQty: resolved.item.orderQty,
          surplusQty: Math.max(0, resolved.item.orderQty - needed),
          unitPriceKrw: resolved.item.selectedOffer?.unitPriceKrw ?? null,
          lineTotalKrw: resolved.item.lineTotalKrw,
        },
        referenceDelta: bomConfirmVatDelta(resolved.item.lineTotalKrw, previousLine),
      },
    };
  }
  if (input.kind === 'customer_supply') {
    return {
      ok: true,
      option: { ...base, referenceDelta: previousLine === null ? null : -Math.round(previousLine * 1.1) },
    };
  }
  // wait_restock — 남은 종류는 이것뿐이다(위 분기가 나머지를 모두 돌려보낸다).
  const restock = input.restock;
  return {
    ok: true,
    option: {
      ...base,
      referenceDelta: 0,
      restock: restock === undefined
        ? null
        : {
            expectedOn: restock.expectedOn,
            basis: restock.basis,
            maxWaitOn: restock.maxWaitOn ?? null,
            splitAllowed: restock.splitAllowed,
            splitShippingFee: restock.splitAllowed ? restock.splitShippingFee : 0,
          },
    },
  };
}

export async function createConfirmRequest(
  log: FastifyBaseLogger,
  quoteId: bigint,
  body: AdminBomConfirmCreateBodyType,
  actorMbId: string,
): Promise<{ ok: true; request: AdminBomConfirmRequestType; mail: AdminBomConfirmMailDeliveryType } | { ok: false; error: ConfirmCreateError }> {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: true, sheets: true },
  });
  if (quote === null) return { ok: false, error: { code: 'QUOTE_NOT_FOUND' } };
  const { order, reason } = await loadCaseOrder(quote.ctId);
  if (reason !== null || order === null) return { ok: false, error: { code: reason ?? 'NOT_ORDERED' } };

  const activeRows = new Map(
    filterActiveQuoteItems(quote.items, quote.sheets)
      .filter((row) => row.included)
      .map((row) => [String(row.id), row] as const),
  );
  const seen = new Set<string>();
  const openIssues = await prisma.spBomConfirmIssue.findMany({
    where: { activeKey: { in: body.issues.map((issue) => confirmIssueActiveKey(BigInt(issue.quoteItemId))) } },
    select: { quoteItemId: true },
  });
  const openIssueItems = new Set(openIssues.map((issue) => String(issue.quoteItemId)));
  const runtime = await getBomQuoteRuntimeConfig();
  const now = new Date();
  const built: BuiltIssue[] = [];
  for (const input of body.issues) {
    if (seen.has(input.quoteItemId)) return { ok: false, error: { code: 'DUPLICATE_ITEM', quoteItemId: input.quoteItemId } };
    seen.add(input.quoteItemId);
    const row = activeRows.get(input.quoteItemId);
    if (row === undefined) return { ok: false, error: { code: 'ITEM_NOT_FOUND', quoteItemId: input.quoteItemId } };
    if (row.fulfillment !== 'normal') return { ok: false, error: { code: 'ITEM_NOT_ELIGIBLE', quoteItemId: input.quoteItemId } };
    if (openIssueItems.has(input.quoteItemId)) {
      return { ok: false, error: { code: 'ITEM_HAS_OPEN_ISSUE', quoteItemId: input.quoteItemId } };
    }
    const issue = await buildIssue(quoteId, quote, row, input, runtime.usdKrwRate, now);
    if ('code' in issue) return { ok: false, error: issue };
    built.push(issue);
  }

  // 알림(가격 인하·단종)은 답을 받지 않는다 — 만들자마자 '안내'를 고른 것으로 닫고, 돈이 있으면 환불 정산을
  // 바로 연다(환불 기록 뒤 자동 처리 완료). 게이트·고객 차례 배지에 들지 않게 activeKey 도 잡지 않는다(D44-5).
  const notice = built.every((issue) => isBomConfirmNoticeType(issue.issueType));
  const noticeNet = notice ? built.reduce((sum, issue) => sum + (issue.options[0]?.priceDelta ?? 0), 0) : 0;
  let requestId: bigint;
  try {
    requestId = await prisma.$transaction(async (tx) => {
      const request = await tx.spBomConfirmRequest.create({
        data: {
          quoteId,
          mbId: quote.mbId,
          odId: order.odId,
          ctId: order.ctId,
          message: body.message === undefined || body.message === '' ? null : body.message,
          dueOn: notice || body.dueOn == null ? null : parseKstDate(body.dueOn),
          requestedBy: actorMbId,
          ...(notice
            ? noticeNet === 0
              ? { status: 'resolved', resolvedAt: now }
              : { status: 'answered' }
            : {}),
        },
      });
      for (const [index, issue] of built.entries()) {
        await tx.spBomConfirmIssue.create({
          data: {
            requestId: request.id,
            quoteItemId: issue.quoteItemId,
            sortOrder: index,
            issueType: issue.issueType,
            description: issue.description,
            evidence: issue.evidence,
            options: issue.options,
            ...(notice
              ? { status: 'closed', chosenCode: issue.options[0]?.code ?? 'A', activeKey: null }
              : { activeKey: confirmIssueActiveKey(issue.quoteItemId) }),
          },
        });
      }
      await tx.spBomConfirmEvent.create({
        data: {
          requestId: request.id,
          action: notice ? 'notified' : 'requested',
          actorRole: 'admin',
          actorMbId,
          note: `${String(built.length)}개 품목 ${notice ? '변동 안내' : '확인 요청'}`,
        },
      });
      if (notice) {
        await createRequestSettlementTx(tx, request, noticeNet, actorMbId);
        if (noticeNet === 0) {
          await tx.spBomConfirmEvent.create({
            data: { requestId: request.id, action: 'resolved', actorRole: 'system', actorMbId: null, note: '안내만 — 할 일 없음' },
          });
        }
      }
      return request.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: { code: 'ITEM_HAS_OPEN_ISSUE', quoteItemId: body.issues[0]?.quoteItemId ?? '' } };
    }
    throw error;
  }

  const mail = body.sendMail
    ? await deliverRequestMail(log, requestId, actorMbId)
    : { status: 'skipped' as const, reason: 'disabled' };
  const request = await loadAdminConfirmRequest(quoteId, requestId);
  if (request === null) throw new Error(`confirm request ${String(requestId)} vanished`);
  return { ok: true, request, mail };
}

// ── 메일 ─────────────────────────────────────────────────────────────────────

async function deliverRequestMail(
  log: FastifyBaseLogger,
  requestId: bigint,
  actorMbId: string,
): Promise<AdminBomConfirmMailDeliveryType> {
  const request = await prisma.spBomConfirmRequest.findUnique({
    where: { id: requestId },
    include: { issues: { orderBy: { sortOrder: 'asc' } }, quote: { select: { title: true, requestedAt: true, createdAt: true } } },
  });
  if (request === null) return { status: 'skipped', reason: 'not_found' };
  const notice = isNoticeRequest(request.issues);
  const meta: MailLogMeta = {
    kind: notice ? 'bom_confirm_notice' : 'bom_confirm_request',
    refType: 'bom_quote',
    refId: request.quoteId,
    sentBy: actorMbId,
    toMbId: request.mbId,
    params: { requestId: String(request.id), odId: request.odId },
  };
  const [notify, members] = await Promise.all([getNotifyConfig(), getMembersByIds([request.mbId])]);
  const member = members.get(request.mbId);
  const toEmail = (member?.email ?? '').trim();
  if (!notify.mailAvailable) {
    await recordMailLog(log, meta, { channel: 'email', status: 'skipped', reason: 'mail_unavailable', recipient: toEmail });
    return { status: 'skipped', reason: 'mail_unavailable' };
  }
  const common = {
    customerName: member?.name ?? '',
    caseNo: bomCaseNo(request.quoteId, request.quote.requestedAt, request.quote.createdAt),
    quoteTitle: request.quote.title,
    odId: request.odId,
    requestId: String(request.id),
  };
  const mail = notice
    ? buildBomConfirmNoticeEmail({
        ...common,
        issues: request.issues.map((issue) => ({
          issueTypeLabel: BOM_CONFIRM_ISSUE_TYPE_LABELS[asIssueType(issue.issueType)],
          mpn: parseEvidence(issue.evidence).part.mpn,
          description: issue.description,
        })),
        refund: -(requestNetDelta(request.issues) ?? 0),
      })
    : buildBomConfirmRequestEmail({
        ...common,
        dueOn: kstYmd(request.dueOn),
        issues: request.issues.map((issue) => ({
          issueTypeLabel: BOM_CONFIRM_ISSUE_TYPE_LABELS[asIssueType(issue.issueType)],
          mpn: parseEvidence(issue.evidence).part.mpn,
          optionTitles: parseOptions(issue.options).map((option) => `${option.code} ${option.title}`),
        })),
      });
  const sent = await sendBomRfqMail(log, toEmail, mail, meta);
  if (toEmail === '') return { status: 'skipped', reason: 'missing_recipient' };
  return { status: sent ? 'sent' : 'failed', reason: sent ? null : 'send_failed' };
}

async function deliverAnsweredMail(
  log: FastifyBaseLogger,
  requestId: bigint,
): Promise<void> {
  const request = await prisma.spBomConfirmRequest.findUnique({
    where: { id: requestId },
    include: { issues: { orderBy: { sortOrder: 'asc' } }, quote: { select: { title: true, requestedAt: true, createdAt: true } } },
  });
  if (request === null) return;
  const meta: MailLogMeta = {
    kind: 'bom_confirm_answered',
    refType: 'bom_quote',
    refId: request.quoteId,
    sentBy: null,
    toMbId: null,
    params: { requestId: String(request.id) },
  };
  const notify = await getNotifyConfig();
  const adminEmail = (await prisma.spPartner.findFirst({ where: { type: 'house' } }))?.contactEmail ?? '';
  if (!notify.mailAvailable) {
    await recordMailLog(log, meta, { channel: 'email', status: 'skipped', reason: 'mail_unavailable', recipient: adminEmail });
    return;
  }
  const members = await getMembersByIds([request.mbId]);
  const choices = request.issues
    .filter((issue) => issue.status !== 'canceled')
    .map((issue) => {
      const option = chosenOption(parseOptions(issue.options), issue.chosenCode);
      const preference = asShipPreference(issue.shipPreference);
      const suffix = option?.kind === 'wait_restock' && preference !== null
        ? ` (${preference === 'split' ? '먼저 온 부품 먼저' : '모아서 한 번에'})`
        : '';
      return {
        mpn: parseEvidence(issue.evidence).part.mpn,
        optionTitle: option === null ? '—' : `${option.code} ${option.title}${suffix}`,
      };
    });
  await sendBomRfqMail(
    log,
    adminEmail,
    buildBomConfirmAnsweredEmail({
      caseNo: bomCaseNo(request.quoteId, request.quote.requestedAt, request.quote.createdAt),
      quoteTitle: request.quote.title,
      quoteId: String(request.quoteId),
      customerName: members.get(request.mbId)?.name ?? '',
      byAdmin: request.answeredRole === 'admin',
      choices,
      netDelta: requestNetDelta(request.issues) ?? 0,
      note: request.customerNote,
    }),
    meta,
  );
}

// ── 회신(고객·대리) ──────────────────────────────────────────────────────────

export type ConfirmAnswerError =
  | 'NOT_FOUND'
  | 'NOT_OPEN'
  | 'STALE_VERSION'
  | 'CHOICES_INCOMPLETE'
  | 'CHOICE_INVALID'
  | 'SHIP_PREFERENCE_REQUIRED'
  | 'SHIP_PREFERENCE_INVALID';

export const CONFIRM_ANSWER_ERROR_MESSAGES: Record<ConfirmAnswerError, string> = {
  NOT_FOUND: '확인 요청을 찾을 수 없습니다.',
  NOT_OPEN: '이미 회신했거나 담당자가 요청을 닫았습니다. 화면을 새로 고쳐 확인해 주세요.',
  STALE_VERSION: '그사이 요청 내용이 바뀌었습니다. 화면을 새로 고친 뒤 다시 골라 주세요.',
  CHOICES_INCOMPLETE: '모든 부품의 처리 방법을 골라 주세요.',
  CHOICE_INVALID: '고를 수 없는 선택지입니다. 화면을 새로 고쳐 주세요.',
  SHIP_PREFERENCE_REQUIRED: '입고 대기를 고르셨다면 받는 방법(모아서 한 번에 / 먼저 온 부품 먼저)도 골라 주세요.',
  SHIP_PREFERENCE_INVALID: '이 부품은 나눠서 받을 수 없습니다. 모아서 한 번에 받기로 골라 주세요.',
};

type AnswerActor =
  | { role: 'customer'; mbId: string }
  | { role: 'admin'; mbId: string; channel: BomConfirmAnswerChannelType };

/** 요청 단위 순액 정산 1건(D43-11) — 0 이면 만들지 않는다. 회신(질문)과 알림 생성(가격 인하)이 함께 쓴다. */
async function createRequestSettlementTx(
  tx: Prisma.TransactionClient,
  request: Pick<SpBomConfirmRequest, 'id' | 'quoteId' | 'mbId' | 'odId' | 'ctId'>,
  net: number,
  createdBy: string,
): Promise<void> {
  if (net === 0) return;
  const settlement = await tx.spBomSettlement.create({
    data: {
      quoteId: request.quoteId,
      mbId: request.mbId,
      requestId: request.id,
      kind: net > 0 ? 'charge' : 'refund',
      amount: Math.abs(net),
      odId: net < 0 ? request.odId : null,
      targetCtId: net < 0 ? request.ctId : null,
      createdBy,
    },
  });
  if (net > 0) {
    await tx.spBomSettlement.update({
      where: { id: settlement.id },
      data: { chargeKey: bomSettlementChargeKey(settlement.id) },
    });
  }
  await tx.spBomConfirmEvent.create({
    data: {
      requestId: request.id,
      action: 'settlement_created',
      actorRole: 'system',
      actorMbId: null,
      note: `${net > 0 ? '추가결제' : '환불'} ${Math.abs(net).toLocaleString('ko-KR')}원`,
    },
  });
}

export async function answerConfirmRequest(
  log: FastifyBaseLogger,
  requestId: bigint,
  body: BomConfirmAnswerBodyType,
  actor: AnswerActor,
): Promise<{ ok: true } | { ok: false; error: ConfirmAnswerError }> {
  const request = await prisma.spBomConfirmRequest.findUnique({
    where: { id: requestId },
    include: { issues: { orderBy: { sortOrder: 'asc' } } },
  });
  if (request === null || (actor.role === 'customer' && request.mbId !== actor.mbId)) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  if (request.status !== 'requested') return { ok: false, error: 'NOT_OPEN' };
  if (request.version !== body.expectedVersion) return { ok: false, error: 'STALE_VERSION' };

  const pending = request.issues.filter((issue) => issue.status === 'pending');
  const choiceByIssue = new Map(body.choices.map((choice) => [choice.issueId, choice] as const));
  if (pending.length === 0 || pending.some((issue) => !choiceByIssue.has(String(issue.id)))) {
    return { ok: false, error: 'CHOICES_INCOMPLETE' };
  }
  if (body.choices.some((choice) => !pending.some((issue) => String(issue.id) === choice.issueId))) {
    return { ok: false, error: 'CHOICE_INVALID' };
  }
  const decisions: { issue: SpBomConfirmIssue; option: BomConfirmOptionType; preference: BomConfirmShipPreferenceType | null }[] = [];
  for (const issue of pending) {
    const choice = choiceByIssue.get(String(issue.id));
    if (choice === undefined) return { ok: false, error: 'CHOICES_INCOMPLETE' };
    const option = chosenOption(parseOptions(issue.options), choice.code);
    if (option === null) return { ok: false, error: 'CHOICE_INVALID' };
    let preference: BomConfirmShipPreferenceType | null = null;
    if (option.kind === 'wait_restock') {
      const splitAllowed = option.restock?.splitAllowed === true;
      if (splitAllowed && choice.shipPreference === undefined) return { ok: false, error: 'SHIP_PREFERENCE_REQUIRED' };
      if (!splitAllowed && choice.shipPreference === 'split') return { ok: false, error: 'SHIP_PREFERENCE_INVALID' };
      preference = splitAllowed ? (choice.shipPreference ?? 'together') : 'together';
    }
    decisions.push({ issue, option, preference });
  }
  const net = decisions.reduce((sum, entry) => sum + bomConfirmChosenDelta(entry.option, entry.preference), 0);
  const now = new Date();
  const note = body.note === undefined || body.note === '' ? null : body.note;

  const answered = await prisma.$transaction(async (tx) => {
    const updated = await tx.spBomConfirmRequest.updateMany({
      where: { id: requestId, status: 'requested', version: body.expectedVersion },
      data: {
        status: 'answered',
        answeredAt: now,
        answeredBy: actor.mbId,
        answeredRole: actor.role,
        answerChannel: actor.role === 'admin' ? actor.channel : 'web',
        customerNote: note,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return false;
    for (const decision of decisions) {
      await tx.spBomConfirmIssue.update({
        where: { id: decision.issue.id },
        data: { status: 'decided', chosenCode: decision.option.code, shipPreference: decision.preference },
      });
    }
    await tx.spBomConfirmEvent.create({
      data: {
        requestId,
        action: actor.role === 'admin' ? 'proxy_answered' : 'answered',
        actorRole: actor.role,
        actorMbId: actor.mbId,
        note: decisions
          .map((entry) => `${parseEvidence(entry.issue.evidence).part.mpn}: ${entry.option.code} ${entry.option.title}`)
          .join(' / ') + (actor.role === 'admin' ? ` (${actor.channel})` : ''),
        payload: { netDelta: net },
      },
    });
    await createRequestSettlementTx(tx, request, net, actor.mbId);
    return true;
  });
  if (!answered) return { ok: false, error: 'STALE_VERSION' };
  void deliverAnsweredMail(log, requestId).catch((err: unknown) => {
    log.error({ err, requestId: String(requestId) }, 'bom confirm answered mail failed');
  });
  return { ok: true };
}

// ── 관리자: 취소 ─────────────────────────────────────────────────────────────

export type ConfirmMutationError =
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'NOT_CANCELABLE'
  | 'NOT_ANSWERED'
  | 'ISSUE_NOT_DECIDED'
  | 'PAYMENT_PENDING'
  | 'ITEM_IN_PO'
  | 'ITEM_MISSING'
  | 'REPLACEMENT_UNAVAILABLE'
  | 'NOT_SPLIT_BACKORDER'
  | 'NOT_RESOLVABLE';

export const CONFIRM_MUTATION_ERROR_MESSAGES: Record<ConfirmMutationError, string> = {
  NOT_FOUND: '확인 요청을 찾을 수 없습니다.',
  STALE_VERSION: '그사이 요청이 바뀌었습니다. 새로 불러온 뒤 다시 시도하세요.',
  NOT_CANCELABLE: '이미 적용했거나 돈이 오간 요청은 취소할 수 없습니다. 적용·정산을 먼저 정리하세요.',
  NOT_ANSWERED: '고객 회신 뒤에 적용할 수 있습니다.',
  ISSUE_NOT_DECIDED: '고객이 고른 선택지가 없거나 이미 처리한 품목입니다.',
  PAYMENT_PENDING: '추가결제가 아직 확인되지 않았습니다. 결제 확인 뒤 적용하거나 [선적용]을 체크하세요.',
  ITEM_IN_PO: '이 품목이 이미 발주서에 있습니다. 발행됨 발주서는 삭제한 뒤 적용하고, 확인된 발주서는 부족 신고로 처리하세요.',
  ITEM_MISSING: '견적에서 이 품목을 찾을 수 없습니다.',
  REPLACEMENT_UNAVAILABLE: '고객이 고른 대체 부품·공급 조건을 지금은 적용할 수 없습니다(가격·재고 변동). 새 확인 요청으로 다시 물어보세요.',
  NOT_SPLIT_BACKORDER: '나눠 받기로 한 입고 대기 품목에만 두 번째 발송을 기록할 수 있습니다.',
  NOT_RESOLVABLE: '적용하지 않은 품목이나 끝나지 않은 정산이 있습니다.',
};

export async function cancelConfirmRequest(
  requestId: bigint,
  quoteId: bigint,
  expectedVersion: number,
  reason: string,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: ConfirmMutationError }> {
  const request = await prisma.spBomConfirmRequest.findFirst({
    where: { id: requestId, quoteId },
    include: { issues: true },
  });
  if (request === null) return { ok: false, error: 'NOT_FOUND' };
  if (request.version !== expectedVersion) return { ok: false, error: 'STALE_VERSION' };
  if (request.status === 'resolved' || request.status === 'canceled') return { ok: false, error: 'NOT_CANCELABLE' };
  if (request.issues.some((issue) => issue.status === 'applied')) return { ok: false, error: 'NOT_CANCELABLE' };
  const settlements = await prisma.spBomSettlement.findMany({ where: { requestId } });
  if (settlements.some((row) => row.status !== 'pending' && row.status !== 'canceled')) {
    return { ok: false, error: 'NOT_CANCELABLE' };
  }
  // 추가결제 주문이 이미 들어갔으면(미입금 주문 포함) 먼저 영카트에서 정리해야 한다.
  for (const row of settlements) {
    if (row.kind === 'charge' && row.status === 'pending' && row.ctId !== null) {
      const cart = await getCartRowByCtId(row.ctId);
      if (cart !== null && cart.ctStatus !== '쇼핑' && cart.ctStatus !== '취소' && cart.ctStatus !== '삭제') {
        return { ok: false, error: 'NOT_CANCELABLE' };
      }
    }
  }
  const now = new Date();
  const done = await prisma.$transaction(async (tx) => {
    const updated = await tx.spBomConfirmRequest.updateMany({
      where: { id: requestId, version: expectedVersion, status: { in: ['requested', 'answered'] } },
      data: { status: 'canceled', canceledAt: now, cancelReason: reason, version: { increment: 1 } },
    });
    if (updated.count === 0) return false;
    await tx.spBomConfirmIssue.updateMany({
      where: { requestId, status: { in: ['pending', 'decided'] } },
      data: { status: 'canceled', activeKey: null },
    });
    await tx.spBomSettlement.updateMany({
      where: { requestId, status: 'pending' },
      data: { status: 'canceled' },
    });
    await tx.spBomConfirmEvent.create({
      data: { requestId, action: 'canceled', actorRole: 'admin', actorMbId, note: reason },
    });
    return true;
  });
  if (!done) return { ok: false, error: 'STALE_VERSION' };
  for (const row of settlements) {
    if (row.kind === 'charge' && row.ctId !== null) {
      const cart = await getCartRowByCtId(row.ctId);
      if (cart?.ctStatus === '쇼핑') await deleteCartRow(row.ctId);
    }
  }
  return { ok: true };
}

// ── 관리자: 적용 ─────────────────────────────────────────────────────────────

export async function applyConfirmIssue(
  requestId: bigint,
  quoteId: bigint,
  issueId: bigint,
  body: { expectedVersion: number; preApply: boolean; note?: string | undefined },
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: ConfirmMutationError; detail?: string }> {
  const request = await prisma.spBomConfirmRequest.findFirst({
    where: { id: requestId, quoteId },
    include: { issues: true },
  });
  if (request === null) return { ok: false, error: 'NOT_FOUND' };
  if (request.status !== 'answered') return { ok: false, error: 'NOT_ANSWERED' };
  if (request.version !== body.expectedVersion) return { ok: false, error: 'STALE_VERSION' };
  const issue = request.issues.find((entry) => entry.id === issueId);
  if (issue?.status !== 'decided') return { ok: false, error: 'ISSUE_NOT_DECIDED' };
  const option = chosenOption(parseOptions(issue.options), issue.chosenCode);
  if (option === null) return { ok: false, error: 'ISSUE_NOT_DECIDED' };

  const settlements = await prisma.spBomSettlement.findMany({ where: { requestId, kind: 'charge', status: { not: 'canceled' } } });
  const charge = settlements[0] ?? null;
  const chargeFresh = charge === null ? null : await ensureChargePaidLazy(charge);
  // 돈이 드는 변경(품목 변경·같은 부품 값 인상)은 추가결제 확인 뒤(D43-12), 품목을 바꾸는 선택지만 발주서 정리 뒤(D43-10).
  // 입고 기다리기·그대로 진행·상담은 발주서에 든 품목에도 그대로 적용된다 — 산 뒤 유형(D44-6)이 이 길을 쓴다.
  if (bomConfirmKindNeedsPayment(option.kind) && chargeFresh?.status === 'pending' && !body.preApply) {
    return { ok: false, error: 'PAYMENT_PENDING' };
  }
  const poLinks = await loadItemPoLinks(quoteId);
  const poLink = poLinks.get(String(issue.quoteItemId));
  if (bomConfirmKindChangesItem(option.kind) && poLink !== undefined) {
    return { ok: false, error: 'ITEM_IN_PO', detail: `${poLink.partnerName} 발주서 #${String(poLink.poId)} (${poLink.status})` };
  }
  const item = await prisma.spBomQuoteItem.findFirst({ where: { id: issue.quoteItemId, quoteId } });
  if (item === null && option.kind !== 'consult') return { ok: false, error: 'ITEM_MISSING' };

  const runtime = await getBomQuoteRuntimeConfig();
  const now = new Date();
  const note = body.note === undefined || body.note === '' ? null : body.note;
  const change = changeFromOption(option);

  const outcome = await prisma.$transaction(async (tx): Promise<'ok' | 'stale' | PostOrderResolveError> => {
    // 요청 행을 먼저 잠근다 — 같은 요청의 동시 적용·취소가 한 줄로 선다.
    await tx.$queryRaw`SELECT id FROM sp_bom_confirm_request WHERE id = ${requestId} FOR UPDATE`;
    const current = await tx.spBomConfirmRequest.findUnique({ where: { id: requestId } });
    if (current?.status !== 'answered' || current.version !== body.expectedVersion) return 'stale';
    await tx.$queryRaw`SELECT id FROM sp_bom_quote WHERE id = ${quoteId} FOR UPDATE`;

    if (change !== null) {
      const amended = await amendQuoteItemAfterOrder(tx, quoteId, issue.quoteItemId, change, actorMbId, runtime.usdKrwRate);
      if (amended.result !== 'ok') return amended.result;
    } else if (option.kind === 'customer_supply') {
      await tx.spBomQuoteItem.update({
        where: { id: issue.quoteItemId },
        data: { fulfillment: 'customer_supply', fulfillmentOn: null },
      });
    } else if (option.kind === 'wait_restock') {
      await tx.spBomQuoteItem.update({
        where: { id: issue.quoteItemId },
        data: {
          fulfillment: 'backorder',
          fulfillmentOn: option.restock === null ? null : parseKstDate(option.restock.expectedOn),
        },
      });
    }
    await tx.spBomConfirmIssue.update({
      where: { id: issue.id },
      data: {
        status: option.kind === 'consult' ? 'closed' : 'applied',
        appliedAt: now,
        appliedBy: actorMbId,
        applyNote: note,
        activeKey: null,
      },
    });
    await tx.spBomConfirmRequest.update({
      where: { id: requestId },
      data: { version: { increment: 1 } },
    });
    await tx.spBomConfirmEvent.create({
      data: {
        requestId,
        issueId: issue.id,
        action: option.kind === 'consult' ? 'closed' : 'applied',
        actorRole: 'admin',
        actorMbId,
        note: `${option.code} ${option.title}${body.preApply && chargeFresh?.status === 'pending' ? ' (추가결제 확인 전 선적용)' : ''}${note === null ? '' : ` — ${note}`}`,
      },
    });
    return 'ok';
  }, { maxWait: 10_000, timeout: 60_000 });
  if (outcome === 'stale') return { ok: false, error: 'STALE_VERSION' };
  if (outcome !== 'ok') return { ok: false, error: 'REPLACEMENT_UNAVAILABLE', detail: outcome };
  await maybeAutoResolve(requestId);
  return { ok: true };
}

// ── 관리자: 분할 발송의 두 번째 발송 ─────────────────────────────────────────

export async function recordConfirmFollowup(
  requestId: bigint,
  quoteId: bigint,
  issueId: bigint,
  body: { expectedVersion: number; carrier: string; invoice: string; shippedAt?: string | undefined },
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: ConfirmMutationError }> {
  const request = await prisma.spBomConfirmRequest.findFirst({
    where: { id: requestId, quoteId },
    include: { issues: true },
  });
  if (request === null) return { ok: false, error: 'NOT_FOUND' };
  if (request.version !== body.expectedVersion) return { ok: false, error: 'STALE_VERSION' };
  const issue = request.issues.find((entry) => entry.id === issueId);
  const option = issue === undefined ? null : chosenOption(parseOptions(issue.options), issue.chosenCode);
  if (issue?.status !== 'applied' || option?.kind !== 'wait_restock' || issue.shipPreference !== 'split') {
    return { ok: false, error: 'NOT_SPLIT_BACKORDER' };
  }
  const shippedAt = body.shippedAt === undefined ? new Date() : parseKstDate(body.shippedAt);
  const done = await prisma.$transaction(async (tx) => {
    const updated = await tx.spBomConfirmRequest.updateMany({
      where: { id: requestId, version: body.expectedVersion },
      data: { version: { increment: 1 } },
    });
    if (updated.count === 0) return false;
    await tx.spBomConfirmIssue.update({
      where: { id: issueId },
      data: { followupCarrier: body.carrier, followupInvoice: body.invoice, followupShippedAt: shippedAt },
    });
    await tx.spBomQuoteItem.updateMany({
      where: { id: issue.quoteItemId, quoteId, fulfillment: 'backorder' },
      data: { fulfillment: 'normal', fulfillmentOn: null },
    });
    await tx.spBomConfirmEvent.create({
      data: {
        requestId,
        issueId,
        action: 'followup_shipped',
        actorRole: 'admin',
        actorMbId,
        note: `${body.carrier} ${body.invoice}`,
      },
    });
    return true;
  });
  return done ? { ok: true } : { ok: false, error: 'STALE_VERSION' };
}

// ── 관리자: 처리 완료(수동) ──────────────────────────────────────────────────

export async function resolveConfirmRequest(
  requestId: bigint,
  quoteId: bigint,
  expectedVersion: number,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: ConfirmMutationError }> {
  const request = await prisma.spBomConfirmRequest.findFirst({ where: { id: requestId, quoteId }, include: { issues: true } });
  if (request === null) return { ok: false, error: 'NOT_FOUND' };
  if (request.version !== expectedVersion) return { ok: false, error: 'STALE_VERSION' };
  if (request.status !== 'answered') return { ok: false, error: 'NOT_RESOLVABLE' };
  if (!request.issues.every((issue) => TERMINAL_ISSUE_STATUSES.has(issue.status))) return { ok: false, error: 'NOT_RESOLVABLE' };
  const settlements = await prisma.spBomSettlement.findMany({ where: { requestId } });
  if (!settlements.every((row) => row.status === 'paid' || row.status === 'refunded' || row.status === 'canceled')) {
    return { ok: false, error: 'NOT_RESOLVABLE' };
  }
  const updated = await prisma.spBomConfirmRequest.updateMany({
    where: { id: requestId, version: expectedVersion, status: 'answered' },
    data: { status: 'resolved', resolvedAt: new Date(), version: { increment: 1 } },
  });
  if (updated.count === 0) return { ok: false, error: 'STALE_VERSION' };
  await prisma.spBomConfirmEvent.create({
    data: { requestId, action: 'resolved', actorRole: 'admin', actorMbId, note: null },
  });
  return { ok: true };
}

// ── 관리자: 정산 ─────────────────────────────────────────────────────────────

export type SettlementError =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'ORDER_ROW_CHANGED'
  | 'AMOUNT_EXCEEDS_ORDER'
  | 'CHARGE_ORDER_PLACED';

export const SETTLEMENT_ERROR_MESSAGES: Record<SettlementError, string> = {
  NOT_FOUND: '정산을 찾을 수 없습니다.',
  INVALID_STATE: '지금 상태에서는 할 수 없는 정산 작업입니다. 새로 불러와 확인하세요.',
  ORDER_ROW_CHANGED: '주문 금액이 그사이 바뀌었습니다(다른 곳에서 수정됨). 주문을 확인한 뒤 다시 시도하세요.',
  AMOUNT_EXCEEDS_ORDER: '환불액이 주문 금액보다 큽니다. 주문을 확인하세요.',
  CHARGE_ORDER_PLACED: '고객이 추가결제 주문서를 이미 냈습니다. 영카트에서 그 주문을 먼저 취소하세요.',
};

async function loadSettlementForQuote(quoteId: bigint, settlementId: bigint): Promise<SpBomSettlement | null> {
  return prisma.spBomSettlement.findFirst({ where: { id: settlementId, quoteId } });
}

/** 환불 1단계 — 원 BOM 주문행 금액을 줄여 과입금(미수 음수)을 만든다. 카드 부분취소는 이 뒤에 열린다. */
export async function reduceSettlementOrder(
  quoteId: bigint,
  settlementId: bigint,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: SettlementError }> {
  const settlement = await loadSettlementForQuote(quoteId, settlementId);
  if (settlement === null) return { ok: false, error: 'NOT_FOUND' };
  if (settlement.kind !== 'refund' || settlement.status !== 'pending' || settlement.odId === null || settlement.targetCtId === null) {
    return { ok: false, error: 'INVALID_STATE' };
  }
  // 감액은 주문행을 잠근 뒤 읽은 금액에서 빼고, 정산 id 표식으로 **한 번만** 적용된다 — 더블클릭이나
  // "감액은 커밋됐는데 아래 상태 기록이 실패한" 요청의 재시도가 금액을 두 번 깎지 않는다.
  const reduced = await reduceOrderedBomRowAmount({
    odId: settlement.odId,
    ctId: settlement.targetCtId,
    ioId: `bom-${String(quoteId)}`,
    amount: settlement.amount,
    actorMbId,
    note: `부품 확인 요청 #${String(settlement.requestId ?? '')} 환불분`,
    applyOnceKey: `정산#${String(settlementId)}`,
  });
  if (reduced.result === 'AMOUNT_EXCEEDS') return { ok: false, error: 'AMOUNT_EXCEEDS_ORDER' };
  if (reduced.result !== 'ok' && reduced.result !== 'ALREADY_APPLIED') {
    return { ok: false, error: 'ORDER_ROW_CHANGED' };
  }
  // 상태 전환은 한 요청만 한다 — 동시에 들어온 요청은 0건이 되어 이벤트를 두 번 남기지 않는다.
  const flipped = await prisma.spBomSettlement.updateMany({
    where: { id: settlementId, status: 'pending' },
    data: { status: 'reduced', reducedAt: new Date() },
  });
  if (flipped.count === 1 && settlement.requestId !== null) {
    await prisma.spBomConfirmEvent.create({
      data: {
        requestId: settlement.requestId,
        action: 'settlement_reduced',
        actorRole: 'admin',
        actorMbId,
        note: reduced.result === 'ok'
          ? `주문 ${settlement.odId} 금액 ${reduced.fromPrice.toLocaleString('ko-KR')} → ${reduced.toPrice.toLocaleString('ko-KR')}원`
          : `주문 ${settlement.odId} 감액은 이미 반영돼 있어 정산 상태만 맞췄습니다`,
      },
    });
  }
  return { ok: true };
}

/** 환불 2단계 — 실제로 돌려준 사실을 기록한다(돈은 결제사·계좌에서 사람이 보낸다). */
export async function recordSettlementRefund(
  quoteId: bigint,
  settlementId: bigint,
  note: string | undefined,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: SettlementError }> {
  const settlement = await loadSettlementForQuote(quoteId, settlementId);
  if (settlement === null) return { ok: false, error: 'NOT_FOUND' };
  if (settlement.kind !== 'refund' || settlement.status !== 'reduced' || settlement.odId === null) {
    return { ok: false, error: 'INVALID_STATE' };
  }
  const claimed = await prisma.spBomSettlement.updateMany({
    where: { id: settlementId, status: 'reduced' },
    data: { status: 'refunded', refundedAt: new Date(), note: note ?? settlement.note },
  });
  if (claimed.count === 0) return { ok: false, error: 'INVALID_STATE' };
  await addOrderRefund(settlement.odId, settlement.amount, actorMbId, `부품 확인 요청 #${String(settlement.requestId ?? '')}${note === undefined || note === '' ? '' : ` · ${note}`}`);
  if (settlement.requestId !== null) {
    await prisma.spBomConfirmEvent.create({
      data: {
        requestId: settlement.requestId,
        action: 'settlement_refunded',
        actorRole: 'admin',
        actorMbId,
        note: `${settlement.amount.toLocaleString('ko-KR')}원 환불 기록${note === undefined || note === '' ? '' : ` — ${note}`}`,
      },
    });
    await maybeAutoResolve(settlement.requestId);
  }
  return { ok: true };
}

export async function cancelSettlement(
  quoteId: bigint,
  settlementId: bigint,
  reason: string,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: SettlementError }> {
  const settlement = await loadSettlementForQuote(quoteId, settlementId);
  if (settlement === null) return { ok: false, error: 'NOT_FOUND' };
  if (settlement.status !== 'pending') return { ok: false, error: 'INVALID_STATE' };
  if (settlement.kind === 'charge' && settlement.ctId !== null) {
    const cart = await getCartRowByCtId(settlement.ctId);
    if (cart !== null && cart.ctStatus !== '쇼핑' && cart.ctStatus !== '취소' && cart.ctStatus !== '삭제') {
      return { ok: false, error: 'CHARGE_ORDER_PLACED' };
    }
  }
  const updated = await prisma.spBomSettlement.updateMany({
    where: { id: settlementId, status: 'pending' },
    data: { status: 'canceled', note: reason },
  });
  if (updated.count === 0) return { ok: false, error: 'INVALID_STATE' };
  if (settlement.kind === 'charge' && settlement.ctId !== null) {
    const cart = await getCartRowByCtId(settlement.ctId);
    if (cart?.ctStatus === '쇼핑') await deleteCartRow(settlement.ctId);
  }
  if (settlement.requestId !== null) {
    await prisma.spBomConfirmEvent.create({
      data: { requestId: settlement.requestId, action: 'settlement_canceled', actorRole: 'admin', actorMbId, note: reason },
    });
    await maybeAutoResolve(settlement.requestId);
  }
  return { ok: true };
}

// ── 고객: 추가결제 주문서 ────────────────────────────────────────────────────

export type ChargeCheckoutError =
  | 'NOT_FOUND'
  | 'NOT_PAYABLE'
  | 'ALREADY_PAID'
  | 'ORDER_PENDING'
  | 'NO_CART_ID'
  | 'ANCHOR_ITEM_MISSING'
  | 'CART_INSERT_FAILED';

export const CHARGE_CHECKOUT_ERROR_MESSAGES: Record<ChargeCheckoutError, string> = {
  NOT_FOUND: '추가결제 건을 찾을 수 없습니다.',
  NOT_PAYABLE: '지금은 결제할 수 없는 건입니다.',
  ALREADY_PAID: '이미 결제한 건입니다.',
  ORDER_PENDING: '이미 주문서를 내셨습니다. 입금을 마치면 확인됩니다(무통장이면 입금 확인 후 반영).',
  NO_CART_ID: '장바구니 정보를 찾지 못했습니다. 다시 로그인한 뒤 시도해 주세요.',
  ANCHOR_ITEM_MISSING: '결제 준비가 끝나지 않았습니다. 고객센터에 문의해 주세요.',
  CART_INSERT_FAILED: '주문서를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
};

/**
 * 추가결제 주문서 직행 — 재능마켓 계약 checkout 과 같은 문법(재사용/재주입, 옛 버킷 청소). 앵커 상품
 * sp-bom-extra 카트행(io_id=chargeKey, io_price=amount)을 만들고 그 줄만 선택해 orderform 으로 보낸다.
 * 결제 확인은 ensureChargePaidLazy 가 한다.
 */
export async function checkoutChargeSettlement(
  log: FastifyBaseLogger,
  settlementId: bigint,
  mbId: string,
  cartId: string | undefined,
  ip: string,
): Promise<{ ok: true; redirectUrl: string } | { ok: false; error: ChargeCheckoutError }> {
  const found = await prisma.spBomSettlement.findUnique({ where: { id: settlementId } });
  if (found?.mbId !== mbId) return { ok: false, error: 'NOT_FOUND' };
  const settlement = await ensureChargePaidLazy(found);
  if (settlement.kind !== 'charge' || settlement.chargeKey === null) return { ok: false, error: 'NOT_PAYABLE' };
  if (settlement.status === 'paid') return { ok: false, error: 'ALREADY_PAID' };
  if (settlement.status !== 'pending') return { ok: false, error: 'NOT_PAYABLE' };
  if (settlement.requestId !== null) {
    const request = await prisma.spBomConfirmRequest.findUnique({ where: { id: settlement.requestId }, select: { status: true } });
    if (request === null || request.status === 'canceled') return { ok: false, error: 'NOT_PAYABLE' };
  }
  if (cartId === undefined || cartId === '') return { ok: false, error: 'NO_CART_ID' };

  let reuseCtId: number | null = null;
  let needInject = true;
  if (settlement.ctId !== null) {
    const cartRow = await getCartRowByCtId(settlement.ctId);
    if (cartRow === null) {
      needInject = true;
    } else if (cartRow.ctStatus === '쇼핑') {
      if (cartRow.odId === cartId) {
        reuseCtId = settlement.ctId;
        needInject = false;
      } else {
        await deleteCartRow(settlement.ctId);
      }
    } else {
      const info = await getOrderInfoByCtId(settlement.ctId);
      if (info !== null && info.odStatus !== '취소' && !['취소', '반품', '품절', '삭제'].includes(info.rowCtStatus)) {
        return { ok: false, error: info.odStatus === '주문' ? 'ORDER_PENDING' : 'ALREADY_PAID' };
      }
    }
  }

  let ctId = reuseCtId;
  if (needInject) {
    const anchor = await getBomExtraAnchorItem();
    if (anchor === null) {
      log.error('부품 추가결제 앵커 상품 없음 — pnpm --filter api run smartbom:seed-extra-anchor 필요');
      return { ok: false, error: 'ANCHOR_ITEM_MISSING' };
    }
    const quote = await prisma.spBomQuote.findUnique({
      where: { id: settlement.quoteId },
      select: { title: true, requestedAt: true, createdAt: true },
    });
    const caseNo = quote === null ? '' : bomCaseNo(settlement.quoteId, quote.requestedAt, quote.createdAt);
    await deleteCartRowsByIoId(settlement.chargeKey);
    await deleteQuoteOption(anchor.itId, settlement.chargeKey);
    await insertQuoteOption(anchor.itId, settlement.chargeKey, settlement.amount);
    try {
      ctId = await insertCartRow({
        odId: cartId,
        mbId,
        item: anchor,
        itemName: `부품 BOM 추가결제 · ${(quote?.title ?? '').slice(0, 80)}`,
        ioId: settlement.chargeKey,
        price: settlement.amount,
        option: `${caseNo} 부품 확인 요청 #${String(settlement.requestId ?? '')} 차액(VAT 포함)`,
        ip,
      });
    } catch (err) {
      await deleteQuoteOption(anchor.itId, settlement.chargeKey).catch(() => undefined);
      log.error({ err, settlementId: String(settlementId) }, 'g5_shop_cart INSERT 실패 (부품 추가결제)');
      return { ok: false, error: 'CART_INSERT_FAILED' };
    }
    await prisma.spBomSettlement.update({ where: { id: settlementId }, data: { ctId } });
  }
  if (ctId === null) return { ok: false, error: 'CART_INSERT_FAILED' };
  await selectCartRows(cartId, [ctId]);
  return { ok: true, redirectUrl: `${WEB_BASE_URL}/shop/orderform.php` };
}

// ── 고객: 목록 ───────────────────────────────────────────────────────────────

async function quoteTitles(quoteIds: bigint[]): Promise<Map<string, string>> {
  if (quoteIds.length === 0) return new Map();
  const rows = await prisma.spBomQuote.findMany({
    where: { id: { in: [...new Set(quoteIds)] } },
    select: { id: true, title: true },
  });
  return new Map(rows.map((row) => [String(row.id), row.title] as const));
}

export async function listCustomerConfirmsByOrder(odId: string, mbId: string): Promise<CustomerBomConfirmRequestType[]> {
  const requests = await prisma.spBomConfirmRequest.findMany({
    where: { odId, mbId },
    include: { issues: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { requestedAt: 'desc' },
  });
  if (requests.length === 0) return [];
  const settlements = await loadSettlementsByRequest(requests.map((request) => request.id));
  const orderPendingIds = await refreshPendingCharges(settlements);
  // lazy 승격이 요청을 자동 종결했을 수 있어 다시 읽는다.
  const fresh = await prisma.spBomConfirmRequest.findMany({
    where: { odId, mbId },
    include: { issues: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { requestedAt: 'desc' },
  });
  const titles = await quoteTitles(fresh.map((request) => request.quoteId));
  return fresh.map((request) => toCustomerRequestDto(
    request,
    titles.get(String(request.quoteId)) ?? '',
    settlements.get(String(request.id)) ?? null,
    orderPendingIds,
  ));
}

export async function listCustomerConfirmsMine(
  mbId: string,
  scope: 'open' | 'all',
): Promise<{ requests: CustomerBomConfirmMineRowType[]; openCount: number }> {
  const query = {
    where: { mbId },
    include: { issues: { orderBy: { sortOrder: 'asc' as const } } },
    orderBy: { requestedAt: 'desc' as const },
    take: 200,
  };
  const loaded = await prisma.spBomConfirmRequest.findMany(query);
  const settlements = await loadSettlementsByRequest(loaded.map((request) => request.id));
  const orderPendingIds = await refreshPendingCharges(settlements);
  // lazy 승격이 요청을 자동 종결했을 수 있어 다시 읽는다.
  const requests = await prisma.spBomConfirmRequest.findMany(query);
  const titles = await quoteTitles(requests.map((request) => request.quoteId));
  const rows = requests.map((request): CustomerBomConfirmMineRowType => {
    const status = asRequestStatus(request.status);
    const settlement = settlements.get(String(request.id)) ?? null;
    const settlementDto = settlement === null ? null : toCustomerSettlementDto(settlement, status, orderPendingIds);
    const live = request.issues.filter((issue) => issue.status !== 'canceled' || status === 'canceled');
    const summary = live
      .map((issue) => `${parseEvidence(issue.evidence).part.mpn} ${BOM_CONFIRM_ISSUE_TYPE_LABELS[asIssueType(issue.issueType)]}`)
      .slice(0, 3)
      .join(', ') + (live.length > 3 ? ` 외 ${String(live.length - 3)}건` : '');
    const notice = isNoticeRequest(request.issues);
    return {
      id: String(request.id),
      quoteId: String(request.quoteId),
      quoteTitle: titles.get(String(request.quoteId)) ?? '',
      odId: request.odId,
      status,
      statusLabel: notice && status !== 'canceled' ? NOTICE_CUSTOMER_LABEL : BOM_CONFIRM_REQUEST_CUSTOMER_LABELS[status],
      notice,
      dueOn: kstYmd(request.dueOn),
      overdue: isOverdue(request),
      issueCount: live.length,
      issueSummary: summary,
      requestedAt: request.requestedAt.toISOString(),
      answeredAt: iso(request.answeredAt),
      customerTurn: status === 'requested' || settlementDto?.canCheckout === true,
      settlement: settlementDto,
    };
  });
  // 사이드바 배지(extend sp_bom_confirm_open_count)와 같은 모수 — 확인 대기 + 결제할 추가결제.
  const turns = rows.filter((row) => row.customerTurn);
  return { requests: scope === 'open' ? turns : rows, openCount: turns.length };
}

// ── 관리자 워크큐 ────────────────────────────────────────────────────────────

interface QueueEntry {
  row: AdminBomConfirmListRowType;
  tabs: Set<AdminBomConfirmTabType>;
}

export async function listAdminConfirms(query: AdminBomConfirmListQueryType): Promise<{
  items: AdminBomConfirmListRowType[];
  total: number;
  counts: AdminBomConfirmCountsType;
}> {
  const requests = await prisma.spBomConfirmRequest.findMany({
    include: { issues: true, quote: { select: { title: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  });
  const settlements = await loadSettlementsByRequest(requests.map((request) => request.id));
  await refreshPendingCharges(settlements);
  const members = await getMembersByIds([...new Set(requests.map((request) => request.mbId))]);
  const shippedOrders = await loadShippedOrderIds([...new Set(requests.map((request) => request.odId))]);

  const entries: QueueEntry[] = requests.map((request) => {
    const status = asRequestStatus(request.status);
    const settlement = settlements.get(String(request.id)) ?? null;
    const settlementStatus = settlement === null ? null : asSettlementStatus(settlement.status);
    const settlementKind = settlement === null ? null : asSettlementKind(settlement.kind);
    const pendingApply = request.issues.filter((issue) => issue.status === 'decided').length;
    const backorders = request.issues.filter((issue) => {
      if (issue.status !== 'applied') return false;
      const option = chosenOption(parseOptions(issue.options), issue.chosenCode);
      if (option?.kind !== 'wait_restock') return false;
      return issue.shipPreference === 'split' ? issue.followupShippedAt === null : !shippedOrders.has(request.odId);
    }).length;
    const tabs = new Set<AdminBomConfirmTabType>();
    if (status === 'requested') tabs.add('awaiting_customer');
    if (status === 'resolved') tabs.add('done');
    if (status === 'canceled') tabs.add('canceled');
    if (status === 'answered') {
      const chargePending = settlementKind === 'charge' && settlementStatus === 'pending';
      const refundOpen = settlementKind === 'refund' && (settlementStatus === 'pending' || settlementStatus === 'reduced');
      if (chargePending) tabs.add('awaiting_payment');
      if (refundOpen) tabs.add('awaiting_refund');
      const applicable = request.issues.some((issue) => {
        if (issue.status !== 'decided') return false;
        const option = chosenOption(parseOptions(issue.options), issue.chosenCode);
        return !(option !== null && bomConfirmKindNeedsPayment(option.kind) && chargePending);
      });
      if (applicable || refundOpen) tabs.add('needs_action');
    }
    if (backorders > 0 && status !== 'canceled') tabs.add('backorder');
    const member = members.get(request.mbId);
    return {
      tabs,
      row: {
        id: String(request.id),
        quoteId: String(request.quoteId),
        quoteTitle: request.quote.title,
        mbId: request.mbId,
        customerName: member?.name ?? null,
        odId: request.odId,
        status,
        dueOn: kstYmd(request.dueOn),
        overdue: isOverdue(request),
        issueCount: request.issues.filter((issue) => issue.status !== 'canceled' || status === 'canceled').length,
        issueTypes: [...new Set(request.issues.map((issue) => asIssueType(issue.issueType)))],
        pendingApplyCount: pendingApply,
        backorderCount: backorders,
        netDelta: status === 'requested' || status === 'canceled' ? null : requestNetDelta(request.issues),
        settlement: settlement === null ? null : toSettlementDto(settlement),
        requestedAt: request.requestedAt.toISOString(),
        answeredAt: iso(request.answeredAt),
        updatedAt: request.updatedAt.toISOString(),
      },
    };
  });

  const counts = Object.fromEntries(
    ADMIN_BOM_CONFIRM_TABS.map((tab) => [tab, entries.filter((entry) => entry.tabs.has(tab)).length] as const),
  ) as AdminBomConfirmCountsType;
  const search = query.search?.trim().toLowerCase() ?? '';
  const filtered = entries
    .filter((entry) => entry.tabs.has(query.tab))
    .filter((entry) =>
      search === ''
      || entry.row.quoteTitle.toLowerCase().includes(search)
      || entry.row.odId.includes(search)
      || entry.row.mbId.toLowerCase().includes(search)
      || (entry.row.customerName ?? '').toLowerCase().includes(search)
      || entry.row.quoteId === search);
  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize).map((entry) => entry.row),
    total: filtered.length,
    counts,
  };
}

async function loadShippedOrderIds(odIds: string[]): Promise<Set<string>> {
  const headers = await getOrderHeadersLite(odIds);
  const shipped = new Set<string>();
  for (const [odId, header] of headers) {
    if (header.odStatus === '배송' || header.odStatus === '완료') shipped.add(odId);
  }
  return shipped;
}
