import { randomBytes } from 'node:crypto';
import type { SpOrderSpec, SpPartner, SpPcbRfq } from '@prisma/client';
import type {
  AdminPcbRfqCaseItemType,
  AdminPcbRfqViewType,
  PartnerPcbRfqDetailType,
  PartnerPcbRfqListItemType,
  PartnerPcbSpecFileType,
  PcbCurrencyType,
  PcbRfqReplyBodyType,
  PcbRfqStatusType,
} from '@sp/api-contract';
import { PCB_CURRENCIES, PCB_RFQ_STATUSES } from '@sp/api-contract';
import { prisma } from './prisma';
import { getPcbExchangeRate, roundPcbAmount } from './exchange-rate';
import { getCartOrderLinks, getOrderInfoByCtId } from './g5-db';
import { isPcbOrderFulfillmentClosed } from './pcb-order-cancel';
import { toCapabilities } from './partner';

// ── PCB 파트너 트랙 RFQ 코어 — 설계 docs/PCB_PARTNER_TRACK.md §5 ─────────────
// BOM RFQ(bom-rfq.ts)와 달리 부품행 계층이 없는 단일가 문서. 앵커는 sp_order_spec.
// 통화 원칙: 링크 결제통화를 **배정 시점에 행에 박제**(snapshot-freeze — 이후 협력사
// 통화 설정이 바뀌어도 진행 중 RFQ 는 불변). 회신·MD 선정·관리자 선정의 환산도 각
// 시점 환율을 행에 박제한다 — 조회 시 재계산 금지.

const MAGIC_TOKEN_TTL_DAYS = 30;
const HOUSE_FALLBACK_NAME = 'SamplePCB';

// ── 내로잉·공용 유틸 ─────────────────────────────────────────────────────────

export const asPcbRfqStatus = (v: string): PcbRfqStatusType =>
  (PCB_RFQ_STATUSES as readonly string[]).includes(v) ? (v as PcbRfqStatusType) : 'requested';

export const asPcbCurrency = (v: string | null | undefined): PcbCurrencyType => {
  const up = (v ?? '').trim().toUpperCase();
  return (PCB_CURRENCIES as readonly string[]).includes(up) ? (up as PcbCurrencyType) : 'KRW';
};

const decNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** 'YYYY-MM-DD' → KST 자정 앵커 Date(BOM deliveryDate 관례 — 하루 밀림 함정 회피). */
const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);

export const newPcbMagicToken = (): string => randomBytes(32).toString('hex');

/** 응답 spec 에서 언더스코어 내부 키(_legacy 등 — PII·직렬화 함정) 제거(§7-6). */
export const stripInternalSpecKeys = (specJson: unknown): Record<string, unknown> => {
  if (typeof specJson !== 'object' || specJson === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(specJson as Record<string, unknown>)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out;
};

/** 링크 결제통화 해석 — 배정(create) 시점에만 호출해 행에 박제한다. */
export const resolveLinkCurrency = async (
  parentPartnerId: bigint,
  partner: Pick<SpPartner, 'id' | 'defaultCurrency'>,
): Promise<PcbCurrencyType> => {
  if (parentPartnerId === 0n) return asPcbCurrency(partner.defaultCurrency);
  const relation = await prisma.spPartnerRelation.findUnique({
    where: {
      parentPartnerId_childPartnerId: { parentPartnerId, childPartnerId: partner.id },
    },
  });
  // 레거시 최종형 승계: MD↔하위 링크 통화 미설정 시 기본 USD.
  return asPcbCurrency(relation?.settlementCurrency ?? 'USD');
};

// ── RFQ 시작/변경 게이트 ─────────────────────────────────────────────────────
// 초안은 확정가 PATCH(판매가 보호)와 같은 게이트였으나, RFQ 는 원가 소싱이라 축이
// 다르다 — 진행 중 주문(입금~배송)은 허용한다(§6 D10, 레거시 진행분 편입). 판매가는
// 여전히 불변(확정가 PATCH 는 별도 게이트 유지). 미입금('주문')·완료·취소는 차단 —
// 미입금은 취소 가능성, 완료·취소 재작업은 A/S 재발주 회차(P4)의 몫.
export type PcbRfqSpecGate = 'ok' | 'NOT_ACTIVE' | 'IN_CART' | 'ORDER_NOT_PAID' | 'ORDER_CLOSED';

export const checkPcbRfqSpecGate = async (spec: SpOrderSpec): Promise<PcbRfqSpecGate> => {
  if (spec.status !== 'active') return 'NOT_ACTIVE';
  if (spec.ctId === null) return 'ok';
  const link = (await getCartOrderLinks([spec.ctId])).get(spec.ctId);
  // 유령 active(cart 행 소실)는 막지 않는다 — 확정가 등록 단계에서 정리·거부.
  if (link === undefined) return 'ok';
  if (!link.ordered) return 'IN_CART';
  const order = await getOrderInfoByCtId(spec.ctId);
  if (order === null) return 'ok'; // 주문 헤더 소실 — 유령과 동급
  // 부분취소에서는 od_status 가 다른 활성행을 따라갈 수 있으므로 이 스펙의 ct_status 를 우선한다.
  if (isPcbOrderFulfillmentClosed(order.odStatus, order.rowCtStatus)) return 'ORDER_CLOSED';
  if (!order.isPaid) return 'ORDER_NOT_PAID';
  return 'ok'; // 진행 중 주문 — 원가 소싱 모드(D10)
};

// ── 직렬화 ───────────────────────────────────────────────────────────────────

type RfqWithPartner = SpPcbRfq & { partner: SpPartner };

interface AdminViewExtras {
  parentPartnerName: string | null;
  childCount: number;
  childQuotedCount: number;
}

export const toAdminPcbRfqView = (
  rfq: RfqWithPartner,
  extras: AdminViewExtras,
): AdminPcbRfqViewType => ({
  rfqId: Number(rfq.id),
  specId: Number(rfq.specId),
  partnerId: Number(rfq.partnerId),
  partnerName: rfq.partner.name,
  parentPartnerId: Number(rfq.parentPartnerId),
  parentPartnerName: extras.parentPartnerName,
  reorderRound: rfq.reorderRound,
  status: asPcbRfqStatus(rfq.status),
  currency: rfq.currency,
  priceOriginal: decNum(rfq.priceOriginal),
  exchangeRate: decNum(rfq.exchangeRate),
  krwAmount: rfq.krwAmount,
  subCurrency: rfq.subCurrency,
  subPriceOriginal: decNum(rfq.subPriceOriginal),
  subExchangeRate: decNum(rfq.subExchangeRate),
  selectedChildRfqId: rfq.selectedChildRfqId === null ? null : Number(rfq.selectedChildRfqId),
  marginRate: rfq.marginRate,
  sourceCurrency: rfq.sourceCurrency,
  sourceAmount: decNum(rfq.sourceAmount),
  sourceRate: decNum(rfq.sourceRate),
  suggestedDeliveryDate: iso(rfq.suggestedDeliveryDate),
  quotedDeliveryDate: iso(rfq.quotedDeliveryDate),
  memo: rfq.memo,
  requestedAt: rfq.requestedAt.toISOString(),
  respondedAt: iso(rfq.respondedAt),
  selectedAt: iso(rfq.selectedAt),
  magicToken: rfq.magicToken,
  childCount: extras.childCount,
  childQuotedCount: extras.childQuotedCount,
});

/** 회신 도착 판정 — 미선정(unselected)도 가격이 남아 있으면 "회신은 있었던" 행이다. */
const hasReply = (rfq: Pick<SpPcbRfq, 'status'>): boolean => rfq.status !== 'requested';

/** 스펙의 전 트랙 행 조회 + 관리자 뷰 직렬화(MD 하위 집계 포함). */
export const loadAdminPcbRfqs = async (specId: bigint): Promise<AdminPcbRfqViewType[]> => {
  const rows = await prisma.spPcbRfq.findMany({
    where: { specId },
    include: { partner: true },
    orderBy: [{ parentPartnerId: 'asc' }, { id: 'asc' }],
  });
  return serializeAdminPcbRfqRows(rows);
};

/** 견적행 관리자 뷰 직렬화 — RFQ 패널·발주(PO) 상세의 하위 후보 표시 공용. */
export const serializeAdminPcbRfqRows = async (
  rows: RfqWithPartner[],
): Promise<AdminPcbRfqViewType[]> => {
  const parentIds = [...new Set(rows.map((r) => r.parentPartnerId).filter((p) => p !== 0n))];
  const parents =
    parentIds.length === 0
      ? []
      : await prisma.spPartner.findMany({ where: { id: { in: parentIds } } });
  const parentNames = new Map(parents.map((p) => [p.id.toString(), p.name]));
  // MD 하위 집계 — key `${specId}:${parentPartnerId}:${round}` (행 목록은 스펙 단위 호출 전제)
  const childAgg = new Map<string, { count: number; quoted: number }>();
  for (const row of rows) {
    if (row.parentPartnerId === 0n) continue;
    const key = `${row.specId.toString()}:${row.parentPartnerId.toString()}:${String(row.reorderRound)}`;
    const agg = childAgg.get(key) ?? { count: 0, quoted: 0 };
    agg.count += 1;
    if (hasReply(row)) agg.quoted += 1;
    childAgg.set(key, agg);
  }
  return rows.map((row) => {
    const key = `${row.specId.toString()}:${row.partnerId.toString()}:${String(row.reorderRound)}`;
    const agg = row.parentPartnerId === 0n ? childAgg.get(key) : undefined;
    return toAdminPcbRfqView(row, {
      parentPartnerName:
        row.parentPartnerId === 0n
          ? null
          : (parentNames.get(row.parentPartnerId.toString()) ?? null),
      childCount: agg?.count ?? 0,
      childQuotedCount: agg?.quoted ?? 0,
    });
  });
};

// ── 배정 diff — 미회신(requested)만 삭제·회신 보존·신규만 생성(BOM §2.4 동형) ──

export interface PcbRfqDiffOk {
  ok: true;
  added: number;
  kept: number;
  removed: number;
  addedPartners: SpPartner[];
  /** partnerId(string) → 발급 매직토큰(신규 생성분 — 메일 CTA 용). */
  addedTokens: Map<string, string>;
}
export type PcbRfqDiffError =
  | 'SPEC_NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'IN_CART'
  | 'ORDER_NOT_PAID'
  | 'ORDER_CLOSED'
  | 'PARTNER_INVALID'
  | 'MD_RFQ_NOT_FOUND'
  | 'NOT_MY_CHILD';
export type PcbRfqDiffResult = PcbRfqDiffOk | { ok: false; error: PcbRfqDiffError; detail?: string };

/** 배정 대상 협력사 검증 — 승인 + 사람 협력사 + pcb_rfq 능력. */
export const validatePcbRfqPartners = async (
  partnerIds: readonly number[],
): Promise<{ partners: SpPartner[]; error: string | null }> => {
  if (partnerIds.length === 0) return { partners: [], error: null };
  const partners = await prisma.spPartner.findMany({
    where: { id: { in: partnerIds.map((id) => BigInt(id)) } },
  });
  if (partners.length !== partnerIds.length) return { partners: [], error: '존재하지 않는 협력사가 있습니다' };
  for (const partner of partners) {
    if (partner.type !== 'partner') return { partners: [], error: `${partner.name}: 사람 협력사가 아닙니다` };
    if (partner.status !== 'approved') return { partners: [], error: `${partner.name}: 승인 상태가 아닙니다` };
    if (!toCapabilities(partner.capabilities).includes('pcb_rfq'))
      return { partners: [], error: `${partner.name}: PCB 견적(pcb_rfq) 능력이 없습니다` };
  }
  return { partners, error: null };
};

export const diffSendPcbRfqs = async (params: {
  specId: bigint;
  /** 0n=관리자 직접 트랙, 그 외=MD 조직 id(하위 재요청). */
  parentPartnerId: bigint;
  partnerIds: readonly number[];
  suggestedDeliveryDate: string | null;
  reorderRound?: number;
}): Promise<PcbRfqDiffResult> => {
  const round = params.reorderRound ?? 0;
  const spec = await prisma.spOrderSpec.findUnique({ where: { id: params.specId } });
  if (spec === null) return { ok: false, error: 'SPEC_NOT_FOUND' };

  if (params.parentPartnerId === 0n) {
    // 관리자 트랙 — 확정가 PATCH 와 같은 게이트(§5.2-1: 비담김 active 스펙 전체).
    const gate = await checkPcbRfqSpecGate(spec);
    if (gate !== 'ok') return { ok: false, error: gate };
  } else {
    // MD 하위 재요청 — 관리자→MD 행이 존재해야 트랙이 열린다.
    const mdRow = await prisma.spPcbRfq.findUnique({
      where: {
        specId_partnerId_parentPartnerId_reorderRound: {
          specId: params.specId,
          partnerId: params.parentPartnerId,
          parentPartnerId: 0n,
          reorderRound: round,
        },
      },
    });
    if (mdRow === null) return { ok: false, error: 'MD_RFQ_NOT_FOUND' };
  }

  const { partners, error } = await validatePcbRfqPartners(params.partnerIds);
  if (error !== null) return { ok: false, error: 'PARTNER_INVALID', detail: error };

  if (params.parentPartnerId !== 0n && partners.length > 0) {
    const relations = await prisma.spPartnerRelation.findMany({
      where: { parentPartnerId: params.parentPartnerId, childPartnerId: { in: partners.map((p) => p.id) } },
    });
    if (relations.length !== partners.length) return { ok: false, error: 'NOT_MY_CHILD' };
  }

  const targetIds = new Set(params.partnerIds.map((id) => BigInt(id).toString()));
  const existing = await prisma.spPcbRfq.findMany({
    where: { specId: params.specId, parentPartnerId: params.parentPartnerId, reorderRound: round },
  });
  const removed = await prisma.spPcbRfq.deleteMany({
    where: {
      specId: params.specId,
      parentPartnerId: params.parentPartnerId,
      reorderRound: round,
      status: 'requested',
      partnerId: { notIn: params.partnerIds.map((id) => BigInt(id)) },
    },
  });

  const existingIds = new Set(existing.map((r) => r.partnerId.toString()));
  const addedPartners = partners.filter((p) => !existingIds.has(p.id.toString()));
  const addedTokens = new Map<string, string>();
  const suggested =
    params.suggestedDeliveryDate === null ? null : parseKstDate(params.suggestedDeliveryDate);

  for (const partner of addedPartners) {
    const token = newPcbMagicToken();
    const currency = await resolveLinkCurrency(params.parentPartnerId, partner);
    await prisma.spPcbRfq.create({
      data: {
        specId: params.specId,
        partnerId: partner.id,
        parentPartnerId: params.parentPartnerId,
        reorderRound: round,
        status: 'requested',
        currency,
        suggestedDeliveryDate: suggested,
        magicToken: token,
        magicTokenAt: new Date(),
      },
    });
    addedTokens.set(partner.id.toString(), token);
  }

  return {
    ok: true,
    added: addedPartners.length,
    kept: targetIds.size - addedPartners.length,
    removed: removed.count,
    addedPartners,
    addedTokens,
  };
};

// ── 회신 저장(포털·관리자 대리·매직링크 공용) ────────────────────────────────

export type PcbRfqReplyError = 'RFQ_NOT_FOUND' | 'NOT_EDITABLE' | 'EXCHANGE_RATE_UNAVAILABLE';

export const savePcbRfqReply = async (
  rfqId: bigint,
  body: PcbRfqReplyBodyType,
): Promise<{ ok: true } | { ok: false; error: PcbRfqReplyError }> => {
  const rfq = await prisma.spPcbRfq.findUnique({ where: { id: rfqId } });
  if (rfq === null) return { ok: false, error: 'RFQ_NOT_FOUND' };
  // 레거시 편집 가능 조건 승계 — 선정/미선정 이후엔 수정 불가(관리자가 해제해야 재개).
  if (rfq.status !== 'requested' && rfq.status !== 'quoted')
    return { ok: false, error: 'NOT_EDITABLE' };

  const settlement = asPcbCurrency(rfq.currency); // 배정 시점 박제값이 정본
  const inputCcy = body.inputCurrency ?? settlement;

  let priceOriginal: number;
  let sub: { subCurrency: string | null; subPriceOriginal: number | null; subExchangeRate: number | null };
  if (inputCcy === settlement) {
    priceOriginal = roundPcbAmount(body.price, settlement);
    sub = { subCurrency: null, subPriceOriginal: null, subExchangeRate: null }; // 명시적 클리어(정정 잔존 방지)
  } else {
    const rate = await getPcbExchangeRate(inputCcy, settlement);
    if (rate === null) return { ok: false, error: 'EXCHANGE_RATE_UNAVAILABLE' };
    priceOriginal = roundPcbAmount(body.price * rate.rate, settlement);
    sub = {
      subCurrency: inputCcy,
      subPriceOriginal: roundPcbAmount(body.price, inputCcy),
      subExchangeRate: rate.rate,
    };
  }

  await prisma.spPcbRfq.update({
    where: { id: rfq.id },
    data: {
      status: 'quoted',
      priceOriginal,
      krwAmount: settlement === 'KRW' ? priceOriginal : null,
      exchangeRate: null, // 결제통화→KRW 박제는 관리자 선정 시점
      ...sub,
      // 직접 회신은 MD 하위 선정 산출물을 대체한다 — 변환점 박제 초기화.
      selectedChildRfqId: null,
      marginRate: null,
      sourceCurrency: null,
      sourceAmount: null,
      sourceRate: null,
      quotedDeliveryDate: parseKstDate(body.quotedDeliveryDate),
      memo: body.memo ?? null,
      respondedAt: new Date(),
    },
  });
  return { ok: true };
};

// ── MD 하위 선정 — mdAmount = source × rate × (1+마진%) 단일 체인·최종 1회 반올림 ──

export type MdChildSelectError =
  | 'RFQ_NOT_FOUND'
  | 'NOT_YOUR_RFQ'
  | 'NOT_EDITABLE'
  | 'CHILD_NOT_FOUND'
  | 'CHILD_NOT_QUOTED'
  | 'MARGIN_REQUIRED'
  | 'EXCHANGE_RATE_UNAVAILABLE';

export const saveMdChildSelection = async (
  mdRfqId: bigint,
  actorPartnerId: bigint,
  childRfqId: bigint | null,
  marginRate?: number,
): Promise<{ ok: true } | { ok: false; error: MdChildSelectError }> => {
  const mdRfq = await prisma.spPcbRfq.findUnique({ where: { id: mdRfqId } });
  if (mdRfq === null) return { ok: false, error: 'RFQ_NOT_FOUND' };
  // MD 는 "관리자→나" 행에서만 하위 선정으로 회신을 구성한다.
  if (mdRfq.partnerId !== actorPartnerId || mdRfq.parentPartnerId !== 0n)
    return { ok: false, error: 'NOT_YOUR_RFQ' };
  if (mdRfq.status !== 'requested' && mdRfq.status !== 'quoted')
    return { ok: false, error: 'NOT_EDITABLE' };

  const childWhere = {
    specId: mdRfq.specId,
    parentPartnerId: actorPartnerId,
    reorderRound: mdRfq.reorderRound,
  };

  if (childRfqId === null) {
    // 선정 해제 — 상위 회신 소거(requested 복귀), 하위 선정 표시도 회수.
    await prisma.$transaction([
      prisma.spPcbRfq.updateMany({
        where: { ...childWhere, status: { in: ['selected', 'unselected'] } },
        data: { status: 'quoted', selectedAt: null },
      }),
      prisma.spPcbRfq.update({
        where: { id: mdRfq.id },
        data: {
          status: 'requested',
          priceOriginal: null,
          krwAmount: null,
          exchangeRate: null,
          subCurrency: null,
          subPriceOriginal: null,
          subExchangeRate: null,
          selectedChildRfqId: null,
          marginRate: null,
          sourceCurrency: null,
          sourceAmount: null,
          sourceRate: null,
          quotedDeliveryDate: null,
          respondedAt: null,
        },
      }),
    ]);
    return { ok: true };
  }

  if (marginRate === undefined) return { ok: false, error: 'MARGIN_REQUIRED' };
  const child = await prisma.spPcbRfq.findUnique({ where: { id: childRfqId } });
  if (child === null) return { ok: false, error: 'CHILD_NOT_FOUND' };
  if (
    child.specId !== mdRfq.specId ||
    child.parentPartnerId !== actorPartnerId ||
    child.reorderRound !== mdRfq.reorderRound
  )
    return { ok: false, error: 'CHILD_NOT_FOUND' };
  const childPrice = decNum(child.priceOriginal);
  if (childPrice === null) return { ok: false, error: 'CHILD_NOT_QUOTED' };

  const mdCcy = asPcbCurrency(mdRfq.currency);
  const childCcy = asPcbCurrency(child.currency);
  const rate = await getPcbExchangeRate(childCcy, mdCcy);
  if (rate === null) return { ok: false, error: 'EXCHANGE_RATE_UNAVAILABLE' };
  // 단일 곱 체인 후 최종 1회 반올림(레거시 BigDecimal HALF_UP 동치 — 중간 반올림 금지).
  const mdAmount = roundPcbAmount(childPrice * rate.rate * (1 + marginRate / 100), mdCcy);

  await prisma.$transaction([
    prisma.spPcbRfq.updateMany({
      where: { ...childWhere, id: { not: child.id }, status: { in: ['quoted', 'selected', 'unselected'] } },
      data: { status: 'unselected', selectedAt: null },
    }),
    prisma.spPcbRfq.update({
      where: { id: child.id },
      data: { status: 'selected', selectedAt: new Date() },
    }),
    prisma.spPcbRfq.update({
      where: { id: mdRfq.id },
      data: {
        status: 'quoted',
        currency: mdCcy,
        priceOriginal: mdAmount,
        krwAmount: mdCcy === 'KRW' ? mdAmount : null,
        exchangeRate: null,
        subCurrency: null,
        subPriceOriginal: null,
        subExchangeRate: null,
        selectedChildRfqId: child.id,
        marginRate,
        sourceCurrency: childCcy,
        sourceAmount: childPrice,
        sourceRate: rate.rate,
        // 납기 상향 pass-through(레거시 승계) — 하위 회신 납기를 상위 회신으로 전달.
        quotedDeliveryDate: child.quotedDeliveryDate,
        respondedAt: new Date(),
      },
    }),
  ]);
  return { ok: true };
};

// ── 관리자 선정/해제 — 여기는 원가(KRW 박제)만. 판매가(확정가)는 pcb-price.ts
// (select 라우트의 finalPrice 동시 등록 또는 별도 PATCH /admin/pcb-projects/:id/price) ──

export type PcbRfqSelectError =
  | 'RFQ_NOT_FOUND'
  | 'NOT_ADMIN_TRACK'
  | 'NOT_QUOTED'
  | 'ALREADY_SELECTED'
  | 'EXCHANGE_RATE_REQUIRED'
  | 'NOT_SELECTED'
  | 'PO_ISSUED'
  | PcbRfqSpecGate;

export const selectPcbRfq = async (
  rfqId: bigint,
  exchangeRate?: number,
): Promise<{ ok: true } | { ok: false; error: PcbRfqSelectError }> => {
  const rfq = await prisma.spPcbRfq.findUnique({ where: { id: rfqId }, include: { spec: true } });
  if (rfq === null) return { ok: false, error: 'RFQ_NOT_FOUND' };
  if (rfq.parentPartnerId !== 0n) return { ok: false, error: 'NOT_ADMIN_TRACK' };
  if (rfq.status !== 'quoted') return { ok: false, error: 'NOT_QUOTED' };

  const gate = await checkPcbRfqSpecGate(rfq.spec);
  if (gate !== 'ok') return { ok: false, error: gate };

  const sibling = await prisma.spPcbRfq.findFirst({
    where: {
      specId: rfq.specId,
      parentPartnerId: 0n,
      reorderRound: rfq.reorderRound,
      status: 'selected',
    },
  });
  if (sibling !== null) return { ok: false, error: 'ALREADY_SELECTED' };

  const ccy = asPcbCurrency(rfq.currency);
  const priceOriginal = decNum(rfq.priceOriginal);
  if (priceOriginal === null) return { ok: false, error: 'NOT_QUOTED' };
  let krwAmount: number;
  let stampRate: number | null;
  if (ccy === 'KRW') {
    krwAmount = roundPcbAmount(priceOriginal, 'KRW');
    stampRate = null;
  } else {
    // 명시값 오버라이드 > 당일 수출입은행 캐시 자동 적용(회신 환산·MD 마진과 같은
    // 의미론 — 이 변환점만 순수 수동이던 비대칭 해소). 캐시 미준비면 명시 입력 요구.
    let applied = exchangeRate;
    if (applied === undefined) {
      const daily = await getPcbExchangeRate(ccy, 'KRW');
      if (daily !== null) applied = daily.rate;
    }
    if (applied === undefined) return { ok: false, error: 'EXCHANGE_RATE_REQUIRED' };
    krwAmount = roundPcbAmount(priceOriginal * applied, 'KRW');
    stampRate = applied;
  }

  await prisma.$transaction([
    // 레거시 승계: 같은 트랙 형제 전부(미회신 포함) 미선정 — 선정 후 추가 회신 소음 차단.
    prisma.spPcbRfq.updateMany({
      where: { specId: rfq.specId, parentPartnerId: 0n, reorderRound: rfq.reorderRound, id: { not: rfq.id } },
      data: { status: 'unselected', selectedAt: null },
    }),
    prisma.spPcbRfq.update({
      where: { id: rfq.id },
      data: { status: 'selected', exchangeRate: stampRate, krwAmount, selectedAt: new Date() },
    }),
  ]);
  return { ok: true };
};

export const unselectPcbRfq = async (
  rfqId: bigint,
): Promise<{ ok: true } | { ok: false; error: PcbRfqSelectError }> => {
  const rfq = await prisma.spPcbRfq.findUnique({ where: { id: rfqId }, include: { spec: true } });
  if (rfq === null) return { ok: false, error: 'RFQ_NOT_FOUND' };
  if (rfq.parentPartnerId !== 0n) return { ok: false, error: 'NOT_ADMIN_TRACK' };
  if (rfq.status !== 'selected') return { ok: false, error: 'NOT_SELECTED' };

  // 주문·담김 이후 해제 금지 — 레거시 "입금 완료 시 unselect 금지"의 플랫폼 강화판.
  const gate = await checkPcbRfqSpecGate(rfq.spec);
  if (gate !== 'ok') return { ok: false, error: gate };

  // 발주가 나간 선정은 계약의 근거다 — 해제하면 발주가 근거 없이 남고, 다른 협력사를
  // 재선정해 같은 견적에 발주 2장이 성립한다(재작업 프로브 W2·W3 실증). 발주 취소가 먼저.
  const poCount = await prisma.spPcbPo.count({
    where: { specId: rfq.specId, parentPartnerId: 0n, reorderRound: rfq.reorderRound },
  });
  if (poCount > 0) return { ok: false, error: 'PO_ISSUED' };

  const revive = (row: Pick<SpPcbRfq, 'priceOriginal'>): PcbRfqStatusType =>
    row.priceOriginal === null ? 'requested' : 'quoted';

  const siblings = await prisma.spPcbRfq.findMany({
    where: { specId: rfq.specId, parentPartnerId: 0n, reorderRound: rfq.reorderRound, status: 'unselected' },
  });
  await prisma.$transaction([
    ...siblings.map((s) =>
      prisma.spPcbRfq.update({ where: { id: s.id }, data: { status: revive(s) } }),
    ),
    prisma.spPcbRfq.update({
      where: { id: rfq.id },
      data: {
        status: revive(rfq),
        selectedAt: null,
        // 선정 박제(환산) 소거 — 결제통화 정본은 유지.
        exchangeRate: null,
        krwAmount: asPcbCurrency(rfq.currency) === 'KRW' ? rfq.krwAmount : null,
      },
    }),
  ]);
  return { ok: true };
};

// ── 매직링크(무로그인 회신 — BOM §6.9 동형) ─────────────────────────────────

export const loadPcbRfqByMagicToken = async (
  token: string,
): Promise<(RfqWithPartner & { spec: SpOrderSpec }) | null> => {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const rfq = await prisma.spPcbRfq.findUnique({
    where: { magicToken: token },
    include: { partner: true, spec: true },
  });
  if (rfq === null) return null;
  if (rfq.magicTokenAt === null) return null;
  const ageMs = Date.now() - rfq.magicTokenAt.getTime();
  if (ageMs > MAGIC_TOKEN_TTL_DAYS * 86_400_000) return null;
  return rfq;
};

export const reissuePcbMagicToken = async (rfqId: bigint): Promise<string> => {
  const token = newPcbMagicToken();
  await prisma.spPcbRfq.update({
    where: { id: rfqId },
    data: { magicToken: token, magicTokenAt: new Date() },
  });
  return token;
};

// ── 협력사 포털 직렬화 ───────────────────────────────────────────────────────

/** 자사(house) 조직명 — 협력사 화면의 발주처 표시·메일 발신 표기 공용. */
export const loadHousePartnerName = async (): Promise<string> => {
  const house = await prisma.spPartner.findFirst({ where: { type: 'house' } });
  return house?.name ?? HOUSE_FALLBACK_NAME;
};
const houseName = loadHousePartnerName;

export const loadPartnerPcbRfqs = async (
  partnerId: bigint,
): Promise<PartnerPcbRfqListItemType[]> => {
  const [rows, me, house] = await Promise.all([
    prisma.spPcbRfq.findMany({
      where: { partnerId },
      include: { spec: true },
      orderBy: { requestedAt: 'desc' },
    }),
    prisma.spPartner.findUnique({ where: { id: partnerId } }),
    houseName(),
  ]);
  const parentIds = [...new Set(rows.map((r) => r.parentPartnerId).filter((p) => p !== 0n))];
  const parents =
    parentIds.length === 0
      ? []
      : await prisma.spPartner.findMany({ where: { id: { in: parentIds } } });
  const parentNames = new Map(parents.map((p) => [p.id.toString(), p.name]));
  return rows.map((row) => ({
    rfqId: Number(row.id),
    projectName: row.spec.projectName,
    category: row.spec.category,
    qty: row.spec.qty,
    status: asPcbRfqStatus(row.status),
    requesterName:
      row.parentPartnerId === 0n
        ? house
        : (parentNames.get(row.parentPartnerId.toString()) ?? '중개 조직'),
    currency: row.currency,
    inputCurrency: me?.inputCurrency ?? null,
    priceOriginal: decNum(row.priceOriginal),
    subCurrency: row.subCurrency,
    subPriceOriginal: decNum(row.subPriceOriginal),
    suggestedDeliveryDate: iso(row.suggestedDeliveryDate),
    quotedDeliveryDate: iso(row.quotedDeliveryDate),
    requestedAt: row.requestedAt.toISOString(),
    respondedAt: iso(row.respondedAt),
  }));
};

/** 스펙 파일(거버 등, 썸네일 제외) 뷰 — RFQ·발주 포털 상세 공용. */
export const loadPcbSpecFiles = async (specId: bigint): Promise<PartnerPcbSpecFileType[]> => {
  const files = await prisma.spFile.findMany({
    where: { refType: 'sp_order_spec', refId: specId, NOT: { fileType: 'thumbnail' } },
    orderBy: { id: 'asc' },
  });
  return files.map((f) => ({
    fileId: Number(f.id),
    name: f.originFileName,
    size: Number(f.size),
    fileType: f.fileType,
  }));
};

/**
 * 포털/매직링크 상세 — PII 는 구조적으로 배제(주문자 연락처·고객 가격은 스키마에 없음),
 * specJson 은 언더스코어 내부 키 strip(§7-6). partnerId=null 은 매직링크 경로(본인 행 검증
 * 은 토큰 자체가 신원이므로 생략).
 */
export const loadPartnerPcbRfqDetail = async (
  rfqId: bigint,
  partnerId: bigint | null,
): Promise<PartnerPcbRfqDetailType | null> => {
  const rfq = await prisma.spPcbRfq.findUnique({
    where: { id: rfqId },
    include: { partner: true, spec: true },
  });
  if (rfq === null) return null;
  if (partnerId !== null && rfq.partnerId !== partnerId) return null;

  const [files, house, children, relations] = await Promise.all([
    loadPcbSpecFiles(rfq.specId),
    houseName(),
    prisma.spPcbRfq.findMany({
      where: { specId: rfq.specId, parentPartnerId: rfq.partnerId, reorderRound: rfq.reorderRound },
      include: { partner: true },
      orderBy: { id: 'asc' },
    }),
    prisma.spPartnerRelation.findMany({
      where: { parentPartnerId: rfq.partnerId },
      include: { child: true },
    }),
  ]);

  const requesterName =
    rfq.parentPartnerId === 0n
      ? house
      : ((await prisma.spPartner.findUnique({ where: { id: rfq.parentPartnerId } }))?.name ??
        '중개 조직');

  return {
    rfqId: Number(rfq.id),
    status: asPcbRfqStatus(rfq.status),
    requesterName,
    currency: rfq.currency,
    inputCurrency: rfq.partner.inputCurrency,
    priceOriginal: decNum(rfq.priceOriginal),
    subCurrency: rfq.subCurrency,
    subPriceOriginal: decNum(rfq.subPriceOriginal),
    subExchangeRate: decNum(rfq.subExchangeRate),
    suggestedDeliveryDate: iso(rfq.suggestedDeliveryDate),
    quotedDeliveryDate: iso(rfq.quotedDeliveryDate),
    memo: rfq.memo,
    requestedAt: rfq.requestedAt.toISOString(),
    respondedAt: iso(rfq.respondedAt),
    spec: {
      projectName: rfq.spec.projectName,
      category: rfq.spec.category,
      orderCategory: rfq.spec.orderCategory,
      qty: rfq.spec.qty,
      message: rfq.spec.message,
      specJson: stripInternalSpecKeys(rfq.spec.specJson),
      files,
    },
    children: await serializeAdminPcbRfqRows(children),
    myChildPartners: relations.map((rel) => ({
      partnerId: Number(rel.childPartnerId),
      name: rel.child.name,
      settlementCurrency: rel.settlementCurrency,
    })),
  };
};

/** 포털 스펙 파일 다운로드 인가 — 본인 행 + 그 스펙 소속 파일만(경로 토큰 비노출 프록시). */
export const loadPartnerPcbSpecFile = async (
  rfqId: bigint,
  partnerId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const rfq = await prisma.spPcbRfq.findUnique({ where: { id: rfqId } });
  if (rfq === null) return null;
  if (rfq.partnerId !== partnerId) return null;
  const file = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (file === null) return null;
  if (file.refType !== 'sp_order_spec' || file.refId !== rfq.specId) return null;
  if (file.fileType === 'thumbnail') return null;
  return { pathToken: file.pathToken, originFileName: file.originFileName };
};

// ── 관리자 횡단 워크큐(스펙 단위 그룹, 메모리 페이지네이션은 라우트 몫) ────────

export type AdminPcbRfqCaseTab = 'pending' | 'quoted' | 'selected';

export const pcbRfqCaseTabOf = (agg: {
  anySelected: boolean;
  anyReplied: boolean;
}): AdminPcbRfqCaseTab =>
  agg.anySelected ? 'selected' : agg.anyReplied ? 'quoted' : 'pending';

export const loadAdminPcbRfqCases = async (): Promise<
  { item: AdminPcbRfqCaseItemType; tab: AdminPcbRfqCaseTab }[]
> => {
  const rows = await prisma.spPcbRfq.findMany({
    where: { parentPartnerId: 0n },
    include: { spec: true, partner: true },
    orderBy: { requestedAt: 'desc' },
  });
  const bySpec = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const key = row.specId.toString();
    const list = bySpec.get(key) ?? [];
    list.push(row);
    bySpec.set(key, list);
  }
  const result: { item: AdminPcbRfqCaseItemType; tab: AdminPcbRfqCaseTab }[] = [];
  for (const list of bySpec.values()) {
    const first = list[0];
    if (first === undefined) continue;
    const spec = first.spec;
    const selected = list.find((r) => r.status === 'selected');
    const anyReplied = list.some((r) => hasReply(r));
    const latest = list
      .map((r) => r.requestedAt.getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    result.push({
      item: {
        specId: Number(spec.id),
        projectName: spec.projectName,
        mbId: spec.mbId,
        category: spec.category,
        orderCategory: spec.orderCategory,
        qty: spec.qty,
        quoteStatus: spec.quoteStatus,
        finalPrice: spec.finalPrice,
        rfqTotal: list.length,
        rfqQuoted: list.filter((r) => hasReply(r)).length,
        selectedPartnerName: selected?.partner.name ?? null,
        latestRequestedAt: new Date(latest).toISOString(),
        specCreatedAt: spec.createdAt.toISOString(),
      },
      tab: pcbRfqCaseTabOf({ anySelected: selected !== undefined, anyReplied }),
    });
  }
  result.sort((a, b) => (a.item.latestRequestedAt < b.item.latestRequestedAt ? 1 : -1));
  return result;
};
