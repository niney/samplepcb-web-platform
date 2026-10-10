import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { SpBomQuoteItem, SpBomRfq, SpBomRfqItem, SpPartner } from '@prisma/client';
import type {
  AdminBomRfqItemViewType,
  AdminBomRfqViewType,
  BomPartnerFxCurrencyType,
  BomPartnerFxRatesType,
  BomQuoteSelectedOfferType,
  BomRfqChildSelectionType,
  BomRfqChildViewType,
  BomRfqItemReplyInputType,
  BomRfqReplyBodyType,
  BomRfqStatusType,
  PartnerRfqDetailType,
  PartnerRfqLineItemType,
  PartnerRfqListItemType,
} from '@sp/api-contract';
import { effectiveRfqReplyQty } from '@sp/utils';
import { prisma } from './prisma';
import {
  asBomPartnerCurrency,
  buildPartnerRfqOffer,
  ensureQuotePartnerFx,
  parsePartnerFxRates,
  setQuotePartnerFx,
  partnerUnitPriceKrw,
  resolveBomLinkCurrency,
  roundBomAmount,
  roundBomUnitPrice,
} from './bom-fx';
import { getPcbExchangeRate } from './exchange-rate';
import { computeQuote, filterActiveQuoteItems, persistQuoteComputed, toItemDto } from './bom-quote';
import { toCapabilities } from './partner';

// ── 협력사 RFQ 코어 — 설계 docs/SMARTBOM_PARTNER_RFQ.md §2 ──────────────────
// diff 발송(유지분 보존)·회신 replace-all 저장(포털/대리 공용)·직렬화.
// 요청 부품행 범위 = 견적의 included 행 파생 ∩ requestedItemIds(부분 선택, §6.13 —
// null=전체). 협력사별 전문 분야만 발송해 회신율·정보 최소화를 챙긴다(레거시 승계).

export const asBomRfqStatus = (v: string): BomRfqStatusType =>
  v === 'quoted' ? 'quoted' : v === 'closed' ? 'closed' : 'requested';

type RfqWithItems = SpBomRfq & { items: SpBomRfqItem[] };

const NO_FX: BomPartnerFxRatesType = { USD: null, CNY: null };

/** 회신 합계(결제통화) — 외화 이전에 쌓인 원화 행은 totalOriginal 이 비어 있어 totalAmount 로 읽는다. */
export const rfqTotalOf = (rfq: Pick<SpBomRfq, 'totalAmount' | 'totalOriginal'>): number | null =>
  rfq.totalOriginal === null ? rfq.totalAmount : Number(rfq.totalOriginal);

/**
 * 마스터딜러가 하위 회신을 골라 만든 행의 근거. 하위가 그 뒤 다시 회신해 단가가 달라졌거나
 * 회신을 거뒀으면 stale — 박제는 그대로 두고(마스터딜러가 이미 올린 값) 다시 고르게 알린다.
 */
export const childSelectionOf = (
  item: SpBomRfqItem,
  children: readonly BomRfqChildViewType[],
): BomRfqChildSelectionType | null => {
  if (item.selectedChildRfqId === null || item.sourceUnitPrice === null || item.sourceRate === null) {
    return null;
  }
  const child = children.find((entry) => entry.rfqId === Number(item.selectedChildRfqId));
  const current = child?.items.find((entry) => entry.quoteItemId === String(item.quoteItemId));
  return {
    childRfqId: Number(item.selectedChildRfqId),
    childPartnerId: child?.partnerId ?? 0,
    childPartnerName: child?.partnerName ?? '회수된 하위 견적요청',
    marginRate: Number(item.marginRate ?? 0),
    sourceCurrency: item.sourceCurrency ?? child?.currency ?? 'KRW',
    sourceUnitPrice: Number(item.sourceUnitPrice),
    sourceRate: Number(item.sourceRate),
    stale: current?.unitPrice !== Number(item.sourceUnitPrice),
  };
};

const toItemView = (
  item: SpBomRfqItem,
  fx: BomPartnerFxRatesType,
  children: readonly BomRfqChildViewType[] = [],
): AdminBomRfqItemViewType => ({
  rfqItemId: Number(item.id),
  quoteItemId: String(item.quoteItemId),
  source: item.source === 'api' ? 'api' : 'manual',
  unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
  currency: item.currency,
  unitPriceKrw:
    item.unitPrice === null ? null : partnerUnitPriceKrw(Number(item.unitPrice), item.currency, fx),
  replyQty: item.replyQty,
  moq: item.moq,
  stock: item.stock,
  dateCode: item.dateCode,
  leadTime: item.leadTime,
  memo: item.memo,
  childSelection: childSelectionOf(item, children),
  updatedAt: item.updatedAt.toISOString(),
});

// 부분 행 선택(§6.13) — 저장값(Json) 해석. null·비배열(방어)=전체.
export const parseRequestedItemIds = (rfq: Pick<SpBomRfq, 'requestedItemIds'>): string[] | null => {
  const raw = rfq.requestedItemIds;
  if (!Array.isArray(raw)) return null;
  return raw.filter((v): v is string => typeof v === 'string');
};

/** 표시·검증 범위 = scope 파생 ∩ requestedItemIds — 견적 행이 나중에 빠져도 자연 방어. */
export const filterScopeForRfq = (
  scopeItems: readonly SpBomQuoteItem[],
  rfq: Pick<SpBomRfq, 'requestedItemIds'>,
): SpBomQuoteItem[] => {
  const requested = parseRequestedItemIds(rfq);
  if (requested === null) return [...scopeItems];
  const set = new Set(requested);
  return scopeItems.filter((item) => set.has(String(item.id)));
};

/** 원화 환산 합계 — 원화 회신은 그대로, 외화는 견적 고정 환율. 환율이 없으면 null. */
const rfqTotalKrwOf = (
  rfq: Pick<SpBomRfq, 'totalAmount' | 'totalOriginal' | 'currency'>,
  fx: BomPartnerFxRatesType,
): number | null => {
  const total = rfqTotalOf(rfq);
  if (total === null) return null;
  const currency = asBomPartnerCurrency(rfq.currency);
  if (currency === 'KRW') return total;
  const rate = fx[currency]?.rate ?? null;
  return rate === null ? null : Math.round(total * rate);
};

export const toAdminRfqView = (
  rfq: RfqWithItems & { partner: SpPartner },
  /** 견적 고정 환율 — 원화 환산 표시용. 생략하면 외화 행의 원화 값은 null 이다. */
  fx: BomPartnerFxRatesType = NO_FX,
  /** 이 협력사가 마스터딜러로서 하위에 보낸 재요청(관리자 열람용). */
  children: readonly BomRfqChildViewType[] = [],
): AdminBomRfqViewType => ({
  rfqId: Number(rfq.id),
  partnerId: Number(rfq.partnerId),
  partnerName: rfq.partner.name,
  status: asBomRfqStatus(rfq.status),
  totalAmount: rfqTotalOf(rfq),
  currency: rfq.currency,
  totalAmountKrw: rfqTotalKrwOf(rfq, fx),
  deliveryDate: rfq.deliveryDate?.toISOString() ?? null,
  memo: rfq.memo,
  requestedAt: rfq.requestedAt.toISOString(),
  respondedAt: rfq.respondedAt?.toISOString() ?? null,
  repliedItemCount: rfq.items.filter((i) => i.unitPrice !== null).length,
  magicToken: rfq.magicToken,
  requestedItemIds: parseRequestedItemIds(rfq),
  items: rfq.items.map((item) => toItemView(item, fx, children)),
  children: [...children],
});

// ── 마스터딜러 중개 — 하위 재요청 열람 ───────────────────────────────────────
// 하위 재요청은 같은 견적(quoteId)에 parentPartnerId=마스터딜러 조직으로 선다. 마스터딜러 포털과
// 관리자 Case 가 같은 뷰를 쓴다. 하위 회신가는 상위 결제통화로 환산해 곁들이는데, 이건 **지금
// 환율의 참고값**이다 — 굳는 값은 마스터딜러가 골라 저장한 순간의 환율(sourceRate)이다.
const crossRate = async (from: string, to: string): Promise<number | null> =>
  (await getPcbExchangeRate(asBomPartnerCurrency(from), asBomPartnerCurrency(to)))?.rate ?? null;

type ChildRfqRow = RfqWithItems & { partner: SpPartner & { _count: { members: number } } };

const toChildRfqView = (rfq: ChildRfqRow, rateToParent: number | null): BomRfqChildViewType => ({
  rfqId: Number(rfq.id),
  partnerId: Number(rfq.partnerId),
  partnerName: rfq.partner.name,
  status: asBomRfqStatus(rfq.status),
  currency: rfq.currency,
  rateToParent,
  totalAmount: rfqTotalOf(rfq),
  deliveryDate: rfq.deliveryDate?.toISOString() ?? null,
  memo: rfq.memo,
  requestedAt: rfq.requestedAt.toISOString(),
  respondedAt: rfq.respondedAt?.toISOString() ?? null,
  repliedItemCount: rfq.items.filter((item) => item.unitPrice !== null).length,
  requestedItemIds: parseRequestedItemIds(rfq),
  magicToken: rfq.magicToken,
  hasPortalAccount: rfq.partner._count.members > 0,
  items: rfq.items.flatMap((item) =>
    item.unitPrice === null
      ? []
      : [
          {
            rfqItemId: Number(item.id),
            quoteItemId: String(item.quoteItemId),
            unitPrice: Number(item.unitPrice),
            unitPriceInParent:
              rateToParent === null ? null : roundBomUnitPrice(Number(item.unitPrice) * rateToParent),
            replyQty: item.replyQty,
            moq: item.moq,
            stock: item.stock,
            dateCode: item.dateCode,
            leadTime: item.leadTime,
            memo: item.memo,
          },
        ],
  ),
});

/** 한 견적의 하위 재요청 — 상위(마스터딜러) 조직 id 별. parentPartnerId 를 주면 그 조직 것만. */
export const loadChildRfqViewsByParent = async (
  quoteId: bigint,
  parentPartnerId?: bigint,
): Promise<Map<string, BomRfqChildViewType[]>> => {
  const map = new Map<string, BomRfqChildViewType[]>();
  const rows = await prisma.spBomRfq.findMany({
    where: { quoteId, parentPartnerId: parentPartnerId ?? { not: 0n } },
    include: {
      items: { orderBy: { id: 'asc' } },
      partner: { include: { _count: { select: { members: true } } } },
    },
    orderBy: { id: 'asc' },
  });
  if (rows.length === 0) return map;
  // 상위 결제통화 = 상위가 샘플피씨비에게서 받은 견적요청에 박제된 통화.
  const parents = await prisma.spBomRfq.findMany({
    where: {
      quoteId,
      parentPartnerId: 0n,
      partnerId: { in: [...new Set(rows.map((row) => row.parentPartnerId))] },
    },
    select: { partnerId: true, currency: true },
  });
  const parentCurrency = new Map(parents.map((row) => [row.partnerId.toString(), row.currency]));
  const rates = new Map<string, number | null>();
  for (const row of rows) {
    const key = row.parentPartnerId.toString();
    const to = parentCurrency.get(key);
    const pair = `${row.currency}>${to ?? ''}`;
    if (!rates.has(pair)) rates.set(pair, to === undefined ? null : await crossRate(row.currency, to));
    map.set(key, [...(map.get(key) ?? []), toChildRfqView(row, rates.get(pair) ?? null)]);
  }
  return map;
};

/** 이 견적에 굳힌 협력사 외화 환율(통화별) — 없으면 null. */
export const loadQuotePartnerFx = async (quoteId: bigint): Promise<BomPartnerFxRatesType> => {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    select: { partnerFxRates: true },
  });
  return parsePartnerFxRates(quote?.partnerFxRates);
};

// ── 매직링크(§6.9) — 메일함 소유 = 신원, 권한은 RFQ 1건 스코프 ───────────────

export const newMagicToken = (): string => randomBytes(32).toString('hex');

/** 발급 30일 경과는 무효(안전 상한). RFQ closed 는 열람 허용·회신만 거부(라우트 판단). */
const MAGIC_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

const isMagicTokenAlive = (rfq: Pick<SpBomRfq, 'magicToken' | 'magicTokenAt'>): boolean =>
  rfq.magicToken !== null &&
  rfq.magicTokenAt !== null &&
  Date.now() - rfq.magicTokenAt.getTime() <= MAGIC_TOKEN_TTL_MS;

export const loadRfqByMagicToken = async (token: string) => {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const rfq = await prisma.spBomRfq.findUnique({
    where: { magicToken: token },
    include: {
      items: { orderBy: { id: 'asc' } },
      quote: { select: { title: true } },
      partner: true,
    },
  });
  if (rfq === null) return null;
  if (!isMagicTokenAlive(rfq)) return null;
  return rfq;
};

/** 재발급 — 구 토큰 즉시 무효(유출 회수·30일 경과 갱신·소급 발급 공용). */
export const reissueMagicToken = async (rfqId: bigint): Promise<void> => {
  await prisma.spBomRfq.update({
    where: { id: rfqId },
    data: { magicToken: newMagicToken(), magicTokenAt: new Date() },
  });
};

// 관리자 직접 트랙(parentPartnerId=0)만 — 마스터딜러가 하위에 보낸 재요청은 그 마스터딜러의 것이다.
export const loadAdminRfqs = async (quoteId: bigint): Promise<AdminBomRfqViewType[]> => {
  const [rfqs, fx, children] = await Promise.all([
    prisma.spBomRfq.findMany({
      where: { quoteId, parentPartnerId: 0n },
      include: { partner: true, items: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    }),
    loadQuotePartnerFx(quoteId),
    loadChildRfqViewsByParent(quoteId),
  ]);
  return rfqs.map((rfq) => toAdminRfqView(rfq, fx, children.get(rfq.partnerId.toString()) ?? []));
};

// ── 요청 부품행 범위(파생) — 시트 선택 + included 행 ─────────────────────────
type RfqScopeClient = Pick<Prisma.TransactionClient, 'spBomQuote'>;

export const loadRfqScopeItems = async (
  quoteId: bigint,
  db: RfqScopeClient = prisma,
): Promise<SpBomQuoteItem[]> => {
  const quote = await db.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  if (quote === null) return [];
  return filterActiveQuoteItems(quote.items, quote.sheets).filter((item) => item.included);
};

// ── diff 발송 — 선택 협력사 집합으로 수렴 ────────────────────────────────────
// 유지분(이미 발송) 보존, 빠진 미회신(requested)만 삭제, 회신(quoted) 문서는 빠져도
// 보존(회신 데이터 유실 방지 — 레거시 "빠지면 삭제"의 안전 개선). 신규만 생성·메일 대상.
export interface RfqDiffResult {
  added: number;
  kept: number;
  removed: number;
  addedPartners: SpPartner[]; // 알림 메일 대상(신규 발송분만)
  /** 신규 RFQ 의 매직링크 토큰(파트너별) — 메일 CTA 조립용(§6.9). */
  addedTokens: Map<string, string>;
  /** 행이 실제로 더해진 기존 요청(§6.13 개정) — '품목 추가' 알림 메일 대상. */
  expanded: RfqScopeExpansion[];
}

export interface RfqScopeExpansion {
  partner: SpPartner;
  /** 이번에 더해진 행 수. */
  addedCount: number;
  /** 더한 뒤 요청 행 수(현재 scope 기준). */
  itemCount: number;
  /** 메일 CTA 용 — 살아 있는 토큰은 그대로, 비었거나 30일이 지났으면 새로 발급한 것. */
  magicToken: string;
}

/** 행 추가 대상이 이미 회신한 요청이다 — 트랜잭션을 되돌리고 라우트가 409 로 알린다. */
export class RfqExpandConflictError extends Error {
  constructor(readonly partnerName: string) {
    super(`RFQ already replied — cannot add items (${partnerName})`);
  }
}

/**
 * 행 추가(§6.13 개정) — 기존 요청 범위 ∪ 이번 행(adding null=전체). 줄이지 않는다: 협력사가 쓰고 있는
 * 회신과 어긋나기 때문이다. 결과가 scope 전체를 덮으면 null(=전체) — 첫 발송의 '전체 선택 null 정규화'와
 * 같은 성질(이후 행 추가 자동 포함). 이미 전체(null)였거나 더할 행이 없으면 addedCount 0.
 */
export const mergeRequestedItemIds = (
  existing: readonly string[] | null,
  adding: readonly string[] | null,
  scopeIds: readonly string[],
): { next: string[] | null; addedCount: number } => {
  if (existing === null) return { next: null, addedCount: 0 };
  const have = new Set(existing);
  const added = [...new Set(adding ?? scopeIds)].filter((id) => !have.has(id));
  if (added.length === 0) return { next: [...existing], addedCount: 0 };
  const union = new Set([...existing, ...added]);
  return {
    next: scopeIds.every((id) => union.has(id)) ? null : [...union],
    addedCount: added.length,
  };
};

export const validateRfqPartners = async (
  partnerIds: readonly number[],
): Promise<{ partners: SpPartner[]; error: string | null }> => {
  const partners = await prisma.spPartner.findMany({
    where: { id: { in: partnerIds.map((id) => BigInt(id)) } },
  });
  if (partners.length !== partnerIds.length) {
    return { partners, error: '존재하지 않는 파트너가 포함되어 있습니다.' };
  }
  const invalid = partners.find(
    (p) =>
      p.type !== 'partner' ||
      p.status !== 'approved' ||
      !toCapabilities(p.capabilities).includes('bom_rfq'),
  );
  if (invalid !== undefined) {
    return {
      partners,
      error: `'${invalid.name}' 은(는) RFQ 대상이 아닙니다 — 승인된 협력사(BOM 견적 트랙)만 선택할 수 있습니다.`,
    };
  }
  return { partners, error: null };
};

export const diffSendRfqs = async (
  quoteId: bigint,
  partnerIds: readonly number[],
  /** 부분 행 선택(§6.13) — 신규 생성 RFQ 에만 적용(유지분 세트 불변). null=전체. */
  requestedItemIds: readonly string[] | null = null,
  /** 0n=관리자 직접 트랙, 그 외=마스터딜러 조직 id(하위 재요청). diff 는 **같은 발주처의 행끼리만** 수렴한다. */
  parentPartnerId = 0n,
  /** 행 추가(§6.13 개정) — 이미 보낸 미회신 요청에 requestedItemIds 를 더할 협력사 + null 정규화 기준 scope. */
  expand: { partnerIds: readonly number[]; scopeItemIds: readonly string[] } | null = null,
): Promise<RfqDiffResult> => {
  const wanted = new Set(partnerIds.map((id) => BigInt(id)));
  return prisma.$transaction(async (tx) => {
    const quoteLock = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT id FROM sp_bom_quote WHERE id = ${quoteId} FOR UPDATE
    `);
    if (quoteLock.length === 0) throw new Error(`BOM quote ${String(quoteId)} not found during RFQ send`);
    const existing = await tx.spBomRfq.findMany({ where: { quoteId, parentPartnerId } });
    const existingByPartner = new Map(existing.map((r) => [r.partnerId, r]));

    // 행 추가 대상 — 아직 안 보낸 협력사는 아래 신규 생성이 같은 결과를 낸다(그 사이 회수된 경우 포함).
    // 회신한 요청은 막는다: 받은 회신과 요청 범위가 어긋나고, 되돌리려면 회신 정책부터 정해야 한다.
    const expandTargets = (expand?.partnerIds ?? []).flatMap((id) => {
      const rfq = existingByPartner.get(BigInt(id));
      return rfq === undefined || !wanted.has(rfq.partnerId) ? [] : [rfq];
    });
    const expandPartners =
      expandTargets.length === 0
        ? new Map<bigint, SpPartner>()
        : new Map(
            (
              await tx.spPartner.findMany({ where: { id: { in: expandTargets.map((r) => r.partnerId) } } })
            ).map((p) => [p.id, p]),
          );
    const partnerNameOf = (rfq: SpBomRfq): string =>
      expandPartners.get(rfq.partnerId)?.name ?? `#${String(rfq.partnerId)}`;
    const replied = expandTargets.find((rfq) => rfq.status !== 'requested');
    if (replied !== undefined) throw new RfqExpandConflictError(partnerNameOf(replied));

    const toRemove = existing.filter(
      (r) => !wanted.has(r.partnerId) && r.status === 'requested',
    );
    if (toRemove.length > 0) {
      await tx.spBomRfq.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } });
      // 마스터딜러의 견적요청을 회수하면 그가 하위에 보낸 재요청도 같이 거둔다 — 상위 문서가
      // 사라진 하위 재요청은 누구도 열 수 없는 고아가 된다(회신이 와 있어도 쓸 곳이 없다).
      if (parentPartnerId === 0n) {
        await tx.spBomRfq.deleteMany({
          where: { quoteId, parentPartnerId: { in: toRemove.map((r) => r.partnerId) } },
        });
      }
    }

    const toAddIds = [...wanted].filter((partnerId) => !existingByPartner.has(partnerId));
    // 매직링크 토큰(§6.9)은 발송(생성) 시점에 함께 발급 — 메일 CTA 가 바로 유효하다.
    const addedTokens = new Map<string, string>();
    const addedPartners =
      toAddIds.length === 0
        ? []
        : await tx.spPartner.findMany({ where: { id: { in: toAddIds } } });
    if (addedPartners.length > 0) {
      const now = new Date();
      // 결제통화 = 링크 통화. 배정하는 이 순간에 박제한다 — 나중에 조직·링크 통화를 바꿔도
      // 이미 보낸 견적요청은 그대로다(회신 도중 통화가 바뀌는 일을 막는다).
      const currencyByPartner = new Map<string, string>();
      for (const partner of addedPartners) {
        currencyByPartner.set(
          partner.id.toString(),
          await resolveBomLinkCurrency(parentPartnerId, partner, tx),
        );
      }
      await tx.spBomRfq.createMany({
        data: addedPartners.map((partner) => {
          const token = newMagicToken();
          addedTokens.set(partner.id.toString(), token);
          return {
            quoteId,
            partnerId: partner.id,
            parentPartnerId,
            status: 'requested',
            currency: currencyByPartner.get(partner.id.toString()) ?? 'KRW',
            magicToken: token,
            magicTokenAt: now,
            requestedItemIds: requestedItemIds === null ? Prisma.DbNull : [...requestedItemIds],
          };
        }),
      });
      // 외화 링크가 처음 생기는 통화는 지금 환율을 굳힌다(견적 단위 고정 — 고르는 날마다 다시 보지 않는다).
      // 환율원을 못 구하면 굳히지 않고 넘어간다: 회신은 받을 수 있고, 선정 전에 관리자가 입력한다.
      // 견적 고정 환율은 샘플피씨비↔협력사 변환점의 것이다 — 마스터딜러↔하위 링크 통화는
      // 마스터딜러가 하위 회신을 고르는 순간의 교차환율로 따로 굳는다(행의 sourceRate).
      const foreign = new Set<BomPartnerFxCurrencyType>();
      for (const code of parentPartnerId === 0n ? currencyByPartner.values() : []) {
        const currency = asBomPartnerCurrency(code);
        if (currency !== 'KRW') foreign.add(currency);
      }
      for (const currency of foreign) await ensureQuotePartnerFx(quoteId, currency, tx);
    }

    const expanded: RfqScopeExpansion[] = [];
    if (expand !== null) {
      const scopeSet = new Set(expand.scopeItemIds);
      for (const rfq of expandTargets) {
        const merged = mergeRequestedItemIds(parseRequestedItemIds(rfq), requestedItemIds, expand.scopeItemIds);
        if (merged.addedCount === 0) continue;
        const now = new Date();
        // 메일 CTA 는 기존 링크를 그대로 쓴다 — 이미 죽은 링크(없음·30일 경과)만 새로 낸다.
        const keepToken = isMagicTokenAlive(rfq) ? rfq.magicToken : null;
        const token = keepToken ?? newMagicToken();
        // 상태 조건부 갱신 — 위 검사와 이 사이에 협력사가 회신했으면 0건이 되어 되돌린다.
        const updated = await tx.spBomRfq.updateMany({
          where: { id: rfq.id, status: 'requested' },
          data: {
            requestedItemIds: merged.next ?? Prisma.DbNull,
            requestedAt: now,
            ...(keepToken === null ? { magicToken: token, magicTokenAt: now } : {}),
          },
        });
        if (updated.count === 0) throw new RfqExpandConflictError(partnerNameOf(rfq));
        const partner = expandPartners.get(rfq.partnerId);
        if (partner === undefined) continue;
        expanded.push({
          partner,
          addedCount: merged.addedCount,
          itemCount:
            merged.next === null
              ? expand.scopeItemIds.length
              : merged.next.filter((id) => scopeSet.has(id)).length,
          magicToken: token,
        });
      }
    }

    return {
      added: toAddIds.length,
      kept: existing.length - toRemove.length,
      removed: toRemove.length,
      addedPartners,
      addedTokens,
      expanded,
    };
  });
};

// ── 회신 저장(replace-all) — 포털 회신·관리자 대리 입력 공용 코어 ────────────
// 합계 = Σ 단가 × (회신수량 ?? 주문수량)를 **결제통화**로 박제(원화 0자리·외화 2자리). quoted 전환.
// 환율은 여기 없다 — 협력사는 자기 통화만 말하고, 원화 환산은 견적 고정 환율이 맡는다.
interface MdChildPricing {
  unitPrice: number;
  selectedChildRfqId: bigint;
  marginRate: number;
  sourceCurrency: string;
  sourceUnitPrice: number;
  sourceRate: number;
}

type MdChildPricingResult =
  | { ok: true; pricing: Map<string, MdChildPricing> }
  | { ok: false; error: string };

/**
 * 마스터딜러의 하위 선정 → 상위 회신가. 단가 = 하위 회신가 × 환율(하위 통화 → 내 통화) × (1 + 마진%).
 * 환율은 **고른 순간**에 굳는다: 같은 하위·같은 회신가를 그대로 둔 채 다시 저장하면 앞서 굳힌
 * 환율을 물려받는다(마진만 고쳐도 값이 환율 때문에 흔들리지 않게). 하위를 바꾸거나 하위 회신가가
 * 달라졌으면 그때의 환율로 새로 굳힌다.
 */
const resolveMdChildPricing = async (
  tx: Prisma.TransactionClient,
  rfq: SpBomRfq,
  picks: readonly BomRfqItemReplyInputType[],
): Promise<MdChildPricingResult> => {
  const childRfqIds = [...new Set(picks.flatMap((pick) => (pick.childRfqId == null ? [] : [BigInt(pick.childRfqId)])))];
  const [childRfqs, prior] = await Promise.all([
    tx.spBomRfq.findMany({
      // 내가 보낸 재요청만 — 같은 견적, 발주처가 나.
      where: { id: { in: childRfqIds }, quoteId: rfq.quoteId, parentPartnerId: rfq.partnerId },
      include: { items: true },
    }),
    tx.spBomRfqItem.findMany({ where: { rfqId: rfq.id, selectedChildRfqId: { not: null } } }),
  ]);
  const pricing = new Map<string, MdChildPricing>();
  for (const pick of picks) {
    if (pick.childRfqId == null) continue;
    const child = childRfqs.find((entry) => entry.id === BigInt(pick.childRfqId ?? 0));
    if (child === undefined) return { ok: false, error: 'CHILD_NOT_FOUND' };
    const childItem = child.items.find((entry) => String(entry.quoteItemId) === pick.quoteItemId);
    if (childItem?.unitPrice == null) return { ok: false, error: 'CHILD_NOT_PRICED' };
    if (pick.marginRate == null) return { ok: false, error: 'MARGIN_REQUIRED' };
    const sourceUnitPrice = Number(childItem.unitPrice);
    const kept = prior.find(
      (row) =>
        String(row.quoteItemId) === pick.quoteItemId &&
        row.selectedChildRfqId === child.id &&
        row.sourceCurrency === child.currency &&
        row.sourceRate !== null &&
        Number(row.sourceUnitPrice) === sourceUnitPrice,
    );
    const rate =
      kept?.sourceRate == null ? await crossRate(child.currency, rfq.currency) : Number(kept.sourceRate);
    if (rate === null) return { ok: false, error: 'EXCHANGE_RATE_UNAVAILABLE' };
    pricing.set(pick.quoteItemId, {
      unitPrice: roundBomUnitPrice(sourceUnitPrice * rate * (1 + pick.marginRate / 100)),
      selectedChildRfqId: child.id,
      marginRate: pick.marginRate,
      sourceCurrency: child.currency,
      sourceUnitPrice,
      sourceRate: rate,
    });
  }
  return { ok: true, pricing };
};

export const saveRfqReply = async (
  rfqId: bigint,
  body: BomRfqReplyBodyType,
  /**
   * allowChildSelection — 마스터딜러의 하위 선정(childRfqId·marginRate)을 받는다. 포털(본인·관리자
   * 대리 접속)과 관리자 대리 입력만 켠다. 매직링크 회신은 끈다(링크 하나로 남의 회신을 끌어오지 못하게).
   */
  opts: { allowChildSelection?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const initial = await prisma.spBomRfq.findUnique({
    where: { id: rfqId },
    select: { quoteId: true },
  });
  if (initial === null) return { ok: false, error: 'RFQ_NOT_FOUND' };

  return prisma.$transaction(async (tx): Promise<{ ok: true } | { ok: false; error: string }> => {
    // 관리자 강제 변경과 같은 잠금 순서로 직렬화한 뒤 최신 품목 범위를 다시 검증한다.
    const quoteLock = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT id FROM sp_bom_quote WHERE id = ${initial.quoteId} FOR UPDATE
    `);
    if (quoteLock.length === 0) return { ok: false, error: 'RFQ_NOT_FOUND' };
    const rfq = await tx.spBomRfq.findUnique({ where: { id: rfqId } });
    if (rfq === null) return { ok: false, error: 'RFQ_NOT_FOUND' };
    if (rfq.status === 'closed') return { ok: false, error: 'RFQ_CLOSED' };

    // 범위 = scope ∩ 부분 선택(§6.13) — 요청하지 않은 행의 회신은 거부.
    const scopeItems = filterScopeForRfq(await loadRfqScopeItems(rfq.quoteId, tx), rfq);
    const scopeById = new Map(scopeItems.map((item) => [String(item.id), item]));
    const unknown = body.items.find((item) => !scopeById.has(item.quoteItemId));
    if (unknown !== undefined) return { ok: false, error: 'ITEM_OUT_OF_SCOPE' };

    // 마스터딜러의 하위 선정 — 샘플피씨비가 직접 보낸 견적요청(parent=0)에서만 열린다(2단 제한).
    let childPricing = new Map<string, MdChildPricing>();
    const childPicks = body.items.filter((item) => item.childRfqId != null);
    if (childPicks.length > 0) {
      if (opts.allowChildSelection !== true || rfq.parentPartnerId !== 0n) {
        return { ok: false, error: 'CHILD_SELECTION_NOT_ALLOWED' };
      }
      const resolved = await resolveMdChildPricing(tx, rfq, childPicks);
      if (!resolved.ok) return resolved;
      childPricing = resolved.pricing;
    }
    const priceOf = (item: BomRfqItemReplyInputType): number =>
      childPricing.get(item.quoteItemId)?.unitPrice ?? item.unitPrice;

    // 하위 선정을 모르는 경로(매직링크·관리자 대리 입력)가 단가를 그대로 둔 행은 근거를 물려받는다 —
    // 모르는 화면이 저장했다고 마스터딜러의 선정 기록이 지워지면 안 된다. 단가를 고쳤으면 그 행은
    // 직접 회신이 된다. 포털(하위 선정을 아는 화면)은 보낸 그대로가 정본이다.
    const carried = new Map<string, SpBomRfqItem>();
    if (opts.allowChildSelection !== true) {
      const prior = await tx.spBomRfqItem.findMany({
        where: { rfqId, selectedChildRfqId: { not: null } },
      });
      for (const row of prior) carried.set(String(row.quoteItemId), row);
    }

    // 합계 수량 = 회신 실효 수량(회신수량 ?? 필요수량, MOQ 바닥) — 폼 금액·비교표와 같은 공식(§6.38).
    let total = 0;
    for (const item of body.items) {
      const scope = scopeById.get(item.quoteItemId);
      const qty = effectiveRfqReplyQty(scope?.orderQty ?? 0, item.replyQty, item.moq);
      total += priceOf(item) * qty;
    }
    const totalOriginal = roundBomAmount(total, rfq.currency);
    const hasReply = body.items.length > 0;

    await tx.spBomRfqItem.deleteMany({ where: { rfqId } });
    if (hasReply) {
      await tx.spBomRfqItem.createMany({
        data: body.items.map((item) => {
          const md = childPricing.get(item.quoteItemId);
          const kept = carried.get(item.quoteItemId);
          const keep = kept !== undefined && Number(kept.unitPrice) === item.unitPrice ? kept : undefined;
          return {
            rfqId,
            quoteItemId: BigInt(item.quoteItemId),
            source: 'manual',
            unitPrice: new Prisma.Decimal(priceOf(item)),
            currency: rfq.currency,
            replyQty: item.replyQty,
            moq: item.moq,
            stock: item.stock,
            dateCode: item.dateCode,
            leadTime: item.leadTime,
            memo: item.memo,
            ...(md !== undefined
              ? {
                  selectedChildRfqId: md.selectedChildRfqId,
                  marginRate: new Prisma.Decimal(md.marginRate),
                  sourceCurrency: md.sourceCurrency,
                  sourceUnitPrice: new Prisma.Decimal(md.sourceUnitPrice),
                  sourceRate: new Prisma.Decimal(md.sourceRate),
                }
              : keep !== undefined
                ? {
                    selectedChildRfqId: keep.selectedChildRfqId,
                    marginRate: keep.marginRate,
                    sourceCurrency: keep.sourceCurrency,
                    sourceUnitPrice: keep.sourceUnitPrice,
                    sourceRate: keep.sourceRate,
                  }
                : {}),
          };
        }),
      });
    }
    await tx.spBomRfq.update({
      where: { id: rfqId },
      data: {
        status: hasReply ? 'quoted' : 'requested',
        totalAmount: hasReply && asBomPartnerCurrency(rfq.currency) === 'KRW' ? totalOriginal : null,
        totalOriginal: hasReply ? new Prisma.Decimal(totalOriginal) : null,
        deliveryDate:
          body.deliveryDate === undefined || body.deliveryDate === null
            ? null
            : new Date(`${body.deliveryDate}T00:00:00+09:00`),
        memo: body.memo ?? null,
        respondedAt: hasReply ? new Date() : null,
      },
    });
    return { ok: true };
  });
};

// ── 협력사 포털 직렬화 — 고객 식별정보·목표단가 없는 뷰(D8) ─────────────────
/** 포털 뷰에 얹는 중개 맥락 — 누가 요청했는지(하위가 볼 때)·내가 하위에 보낸 재요청(마스터딜러가 볼 때). */
export interface PartnerRfqMdContext {
  requesterName?: string | null;
  children?: readonly BomRfqChildViewType[];
  canFanOut?: boolean;
}

export const toPartnerListItem = (
  rfq: RfqWithItems & { quote: { title: string } },
  scopeCount: number,
  md: { requesterName?: string | null; childRfqCount?: number; childRepliedCount?: number } = {},
): PartnerRfqListItemType => ({
  rfqId: Number(rfq.id),
  quoteTitle: rfq.quote.title,
  status: asBomRfqStatus(rfq.status),
  itemCount: scopeCount,
  repliedItemCount: rfq.items.filter((i) => i.unitPrice !== null).length,
  totalAmount: rfqTotalOf(rfq),
  currency: rfq.currency,
  requestedAt: rfq.requestedAt.toISOString(),
  respondedAt: rfq.respondedAt?.toISOString() ?? null,
  requesterName: md.requesterName ?? null,
  childRfqCount: md.childRfqCount ?? 0,
  childRepliedCount: md.childRepliedCount ?? 0,
});

export const toPartnerDetail = (
  rfq: RfqWithItems & { quote: { title: string } },
  scopeItems: readonly SpBomQuoteItem[],
  /** 이 협력사 자기 원장의 같은 품번 값 — 회신 폼 프리필 제안(docs/PARTNER_PARTS.md). */
  myStockByItem: ReadonlyMap<string, PartnerRfqLineItemType['myStock']> = new Map(),
  md: PartnerRfqMdContext = {},
): PartnerRfqDetailType => {
  const replyByItem = new Map(rfq.items.map((item) => [String(item.quoteItemId), item]));
  const items: PartnerRfqLineItemType[] = scopeItems.map((item) => {
    const reply = replyByItem.get(String(item.id));
    return {
      quoteItemId: String(item.id),
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      orderQty: item.orderQty,
      myStock: myStockByItem.get(String(item.id)) ?? null,
      reply:
        reply?.unitPrice == null
          ? null
          : {
              unitPrice: Number(reply.unitPrice),
              replyQty: reply.replyQty,
              moq: reply.moq,
              stock: reply.stock,
              dateCode: reply.dateCode,
              leadTime: reply.leadTime,
              memo: reply.memo,
              // 하위 재요청을 모르는 뷰(매직링크)에는 싣지 않는다 — 맥락 없이 조립하면 전부 stale 로 보인다.
              childSelection: md.children === undefined ? null : childSelectionOf(reply, md.children),
            },
    };
  });
  return {
    rfqId: Number(rfq.id),
    quoteTitle: rfq.quote.title,
    status: asBomRfqStatus(rfq.status),
    currency: rfq.currency,
    deliveryDate: rfq.deliveryDate?.toISOString() ?? null,
    memo: rfq.memo,
    totalAmount: rfqTotalOf(rfq),
    requestedAt: rfq.requestedAt.toISOString(),
    respondedAt: rfq.respondedAt?.toISOString() ?? null,
    items,
    requesterName: md.requesterName ?? null,
    canFanOut: md.canFanOut ?? false,
  };
};

// quote 가 answered/closed/canceled 로 끝나면 하위 RFQ 도 마감한다(§2.3 전이).
// 취소는 상태 전이와 같은 트랜잭션에서 닫는다(db 로 tx 를 넘긴다) — 닫히기 전에 협력사 회신이
// 끼어들 틈을 없앤다(회신 저장은 견적 행을 잠그고 RFQ 상태를 본다).
export const closeRfqsForQuote = async (
  quoteId: bigint,
  db: Pick<Prisma.TransactionClient, 'spBomRfq'> = prisma,
): Promise<void> => {
  await db.spBomRfq.updateMany({
    where: { quoteId, status: { not: 'closed' } },
    data: { status: 'closed' },
  });
};

// ── 견적 고정 환율을 관리자가 직접 굳힌다 ─────────────────────────────────────
// 환율원을 못 구했거나(주말·고시 누락) 자동 값이 마음에 들지 않을 때다. 이미 그 통화로 선정한
// 품목은 새 환율로 원화 박제를 다시 만든다 — 한 견적 안에서 한 통화는 한 환율이어야 한다.
export type PartnerFxSetResult = 'ok' | 'quote-not-found';

export const applyQuotePartnerFx = async (
  quoteId: bigint,
  currency: BomPartnerFxCurrencyType,
  rate: number,
): Promise<PartnerFxSetResult> => {
  const fx = await setQuotePartnerFx(quoteId, currency, rate);
  if (fx === null) return 'quote-not-found';
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  if (quote === null) return 'quote-not-found';

  const itemsDto = quote.items.map((row) => toItemDto(row));
  let restamped = 0;
  for (const item of itemsDto) {
    const offer = item.selectedOffer;
    const source = offer?.sourcePrice;
    if (offer === null || source?.currency !== currency) continue;
    const krw = partnerUnitPriceKrw(source.unitPrice, currency, { USD: null, CNY: null, [currency]: fx });
    if (krw === null) continue;
    item.selectedOffer = {
      ...offer,
      unitPrice: krw,
      unitPriceKrw: krw,
      priceBreaks: [{ qty: 1, price: krw }],
      sourcePrice: { ...source, rate: fx.rate },
    };
    restamped += 1;
  }
  if (restamped === 0) return 'ok';
  const usdKrwRate = quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed);
  const computed = computeQuote(itemsDto, usdKrwRate, quote.shippingFee, quote.managementFee);
  await persistQuoteComputed(quoteId, computed, usdKrwRate);
  return 'ok';
};

// ── 행별 협력사 회신 선정(§2.2) — 스냅샷 박제 + 서버 재계산 + 감사 이벤트 ────
// 회신은 원장(sp_bom_rfq_item)에 살아 있고, 선정 시에만 selectedOffer 로 박제한다
// (snapshot-freeze). 회신 단가는 수량 구간이 없으므로 전 수량 단일가 사다리로 박제해
// 수량 변경 재계산에서도 단가가 유지된다.
export type PartnerSelectionResult =
  | 'ok'
  | 'quote-not-found'
  | 'item-not-found'
  | 'rfq-item-not-found'
  | 'not-priced'
  // 외화 회신인데 이 견적에 그 통화의 환율이 없다 — 관리자가 환율을 입력해야 한다.
  | 'fx-unavailable';

export const applyPartnerRfqSelection = async (
  quoteId: bigint,
  itemId: bigint,
  rfqItemId: bigint | null,
  actorId: string,
): Promise<PartnerSelectionResult> => {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  if (quote === null) return 'quote-not-found';
  const targetRow = quote.items.find((row) => row.id === itemId);
  if (targetRow === undefined) return 'item-not-found';

  let offer: BomQuoteSelectedOfferType | null = null;
  if (rfqItemId !== null) {
    const rfqItem = await prisma.spBomRfqItem.findUnique({
      where: { id: rfqItemId },
      include: { rfq: { include: { partner: true } } },
    });
    if (rfqItem === null) return 'rfq-item-not-found';
    // 관리자가 고르는 것은 샘플피씨비가 직접 보낸 견적요청의 회신뿐이다 — 마스터딜러의 하위 회신은
    // 마스터딜러가 골라 자기 회신으로 올린 뒤에야 후보가 된다.
    if (
      rfqItem.rfq.quoteId !== quoteId ||
      rfqItem.quoteItemId !== itemId ||
      rfqItem.rfq.parentPartnerId !== 0n
    ) {
      return 'rfq-item-not-found';
    }
    if (rfqItem.unitPrice === null) return 'not-priced';
    // 외화 회신은 견적 고정 환율로 원화 환산해 박제한다(원본은 sourcePrice). 굳힌 환율이 없으면
    // 지금 굳히고, 환율원도 없으면 선정을 막는다 — 환율 없이 박제하면 고객가가 비어 버린다.
    const currency = asBomPartnerCurrency(rfqItem.currency);
    const fx = currency === 'KRW' ? null : await ensureQuotePartnerFx(quoteId, currency);
    offer = buildPartnerRfqOffer(
      {
        rfqItemId: rfqItem.id,
        partnerName: rfqItem.rfq.partner.name,
        unitPrice: Number(rfqItem.unitPrice),
        currency: rfqItem.currency,
        replyQty: rfqItem.replyQty,
        moq: rfqItem.moq,
        stock: rfqItem.stock,
        respondedAt: rfqItem.rfq.respondedAt,
      },
      targetRow.orderQty,
      fx,
    );
    if (offer === null) return 'fx-unavailable';
  }

  const itemsDto = quote.items.map((row) => toItemDto(row));
  const target = itemsDto.find((item) => item.id === String(itemId));
  if (target === undefined) return 'item-not-found';
  const previousOffer = target.selectedOffer;
  const previousLineTotal = target.lineTotalKrw;

  target.selectionSource = offer === null ? 'none' : 'partner';
  target.selectedCandidateKey = null;
  target.selectedOffer = offer;

  const usdKrwRate = quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed);
  const computed = computeQuote(itemsDto, usdKrwRate, quote.shippingFee, quote.managementFee);
  const computedTarget = computed.items.find((item) => item.id === String(itemId));
  await persistQuoteComputed(quoteId, computed, usdKrwRate, {
    selectionEvent: {
      itemId: String(itemId),
      source: 'admin',
      actorId,
      previousCandidateKey: targetRow.selectedCandidateKey,
      selectedCandidateKey: null,
      previousMpn: targetRow.mpn,
      selectedMpn: targetRow.mpn,
      previousOfferKey: previousOffer?.offerKey ?? null,
      selectedOfferKey: offer?.offerKey ?? null,
      previousLineTotalKrw: previousLineTotal,
      selectedLineTotalKrw: computedTarget?.lineTotalKrw ?? null,
      reasonCodes: [],
    },
  });
  // 선정 포인터는 persist 경로(dataFor) 밖 컬럼이라 별도 갱신(표시·감사 보조 포인터).
  await prisma.spBomQuoteItem.update({
    where: { id: itemId },
    data: { selectedRfqItemId: rfqItemId },
  });
  return 'ok';
};
