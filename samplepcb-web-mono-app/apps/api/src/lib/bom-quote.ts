import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  BomQuoteSelectedOffer,
  type AdminBomQuoteDetailType,
  type AdminBomQuoteSummaryType,
  type BomQuoteDetailType,
  type BomQuoteItemInputType,
  type BomQuoteItemType,
  type BomQuoteSelectedOfferType,
  type BomQuoteStatusType,
  type BomQuoteSummaryType,
} from '@sp/api-contract';
import {
  applyQtyToOffer,
  computeTotals,
  neededQty,
  normalizeMpn,
  pickBreak,
  pickDefaultOffer,
  toKrw,
  type BomOfferInput,
  type OfferPick,
} from '@sp/utils';
import { prisma } from './prisma';
import { resolveManufacturer } from './manufacturer-alias';
import { SAMPLEPCB_SUPPLIER } from './parts-facts';
import { getBomQuoteConfig } from './sp-config';

// 고객 BOM 견적 핵심 로직 — 회원/관리자 라우트가 공유. 설계: docs/BOM_QUOTE.md.
// 원칙: 수량·오퍼는 스냅샷 박제가 단일 진실, 금액은 항상 서버가 스냅샷에서 재계산
// (클라 금액 불신 — 단 스냅샷 단가 자체는 카탈로그 매칭이 서버측에서 기록한 값이고,
//  최종 확정가는 관리자 검토가 결정하는 RFQ 모델이라 조작 이득이 없다).

export type QuoteRow = Prisma.SpBomQuoteGetPayload<object>;
export type QuoteItemRow = Prisma.SpBomQuoteItemGetPayload<object>;

// ── 상태 전이 ────────────────────────────────────────────────────────────────
export const QUOTE_TRANSITIONS: Record<string, BomQuoteStatusType[]> = {
  draft: ['requested', 'canceled'],
  requested: ['reviewing', 'answered', 'canceled'],
  reviewing: ['answered', 'closed', 'canceled'],
  answered: ['closed'],
  closed: [],
  canceled: [],
};

export function canTransition(from: string, to: BomQuoteStatusType): boolean {
  return (QUOTE_TRANSITIONS[from] ?? []).includes(to);
}

// ── 엔진 파싱 결과 → 라인 초안 ───────────────────────────────────────────────
const EngineComponentLoose = z
  .object({
    part_number: z.string().nullish(),
    manufacturer: z.string().nullish(),
    description: z.string().nullish(),
    quantity: z.number().int().nullish(),
    reference_designators: z.array(z.string()).optional(),
    package: z.string().nullish(),
    value_raw: z.string().nullish(),
    sheet_name: z.string().optional(),
    source_rows_1based: z.array(z.number().int()).optional(),
  })
  .passthrough();

const EngineResultLoose = z.object({ components: z.array(EngineComponentLoose).default([]) }).passthrough();

/** G-shape 파싱 결과에서 견적 라인 초안 생성 — MPN 있는 행만(비부품행 제외). */
export function buildItemsFromEngineResult(result: unknown): BomQuoteItemInputType[] {
  const parsed = EngineResultLoose.safeParse(result);
  if (!parsed.success) return [];
  const items: BomQuoteItemInputType[] = [];
  for (const c of parsed.data.components) {
    const mpn = (c.part_number ?? '').trim();
    if (mpn === '') continue;
    items.push({
      rowIdx: items.length,
      included: true,
      mpn: mpn.slice(0, 191),
      manufacturerName: c.manufacturer?.trim().slice(0, 191) ?? null,
      description: c.description?.trim().slice(0, 1000) ?? null,
      bomQty: Math.max(1, c.quantity ?? 1),
      orderQty: 0, // 매칭·수량 박제 전 — catalog-match/재계산이 채운다
      matchStatus: 'none',
      partId: null,
      selectedOffer: null,
      sourceRow: {
        sheetName: c.sheet_name ?? null,
        sourceRows: c.source_rows_1based ?? [],
        referenceDesignators: c.reference_designators ?? [],
        packageCode: c.package ?? null,
        valueRaw: c.value_raw ?? null,
      },
    });
  }
  return items;
}

// ── 카탈로그 매칭 + 재계산 ───────────────────────────────────────────────────

type PartWithOffers = Prisma.SpPartGetPayload<{ include: { offers: { include: { priceBreaks: true } } } }>;

function toOfferInputs(part: PartWithOffers): BomOfferInput[] {
  return part.offers
    .filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER)
    .map((o) => ({
      supplier: o.supplier,
      supplierSku: o.supplierSku,
      packaging: o.packaging,
      currency: o.currency,
      stock: o.stock,
      moq: o.moq,
      orderMultiple: o.orderMultiple,
      fetchedAt: o.fetchedAt.toISOString(),
      priceBreaks: o.priceBreaks.map((pb) => ({ qty: pb.qty, price: Number(pb.price), currency: pb.currency })),
    }));
}

function snapshotFromPick(pick: OfferPick, pinned: boolean): BomQuoteSelectedOfferType {
  return {
    supplier: pick.offer.supplier,
    supplierSku: pick.offer.supplierSku,
    packaging: pick.offer.packaging,
    breakQty: pick.breakQty,
    unitPrice: pick.unitPrice,
    currency: pick.currency,
    unitPriceKrw: pick.unitPriceKrw,
    moq: pick.offer.moq,
    orderMultiple: pick.offer.orderMultiple,
    stock: pick.offer.stock,
    priceBreaks: pick.offer.priceBreaks.map((pb) => ({ qty: pb.qty, price: pb.price })),
    fetchedAt: pick.offer.fetchedAt,
    pinned,
  };
}

/**
 * 카탈로그(sp_part) 매칭 — 미매칭(또는 전체) 라인에 기본 오퍼를 자동 선정한다.
 * pinned(사용자 명시 선택) 라인은 onlyUnmatched=false 여도 보존한다.
 * 공급사 검색 완료 후 재호출하면 자동 인제스트된 신규 오퍼가 반영된다.
 */
export async function catalogMatchItems(
  items: BomQuoteItemInputType[],
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
  onlyUnmatched: boolean,
): Promise<void> {
  for (const item of items) {
    if (item.selectedOffer?.pinned === true) continue;
    if (onlyUnmatched && item.partId !== null) continue;
    const mpnNorm = normalizeMpn(item.mpn);
    if (mpnNorm === '') continue;

    let parts = await prisma.spPart.findMany({
      where: { mpnNorm },
      include: { offers: { include: { priceBreaks: true } } },
      take: 5,
    });
    if (parts.length === 0 && mpnNorm.length >= 6) {
      // 포장 접미사 변형 폴백(엔진 verified_variant 와 동일 취지) — 고객은 베이스 품번
      // (TLV70225DBV)만 적고 공급사는 접미사형(…DBVR/…DBVT)만 파는 관행 대응.
      // 잔여 접미사 ≤4자(R·T·TR·CT·G4·RG4…)만 허용해 다른 부품 오인을 차단한다.
      const prefixed = await prisma.spPart.findMany({
        where: { mpnNorm: { startsWith: mpnNorm } },
        include: { offers: { include: { priceBreaks: true } } },
        take: 10,
      });
      parts = prefixed.filter((p) => p.mpnNorm.length - mpnNorm.length <= 4);
    }
    if (parts.length === 0) {
      if (!onlyUnmatched) {
        item.partId = null;
        item.matchStatus = 'none';
        item.selectedOffer = null;
      }
      continue;
    }

    // 제조사 일치 우선, 없으면 실공급사 재고 합 최대(결정적)
    const mfrNorm = item.manufacturerName === null ? '' : resolveManufacturer(item.manufacturerName).norm;
    const byMfr = mfrNorm === '' ? undefined : parts.find((p) => p.manufacturerNorm === mfrNorm);
    const part =
      byMfr ??
      [...parts].sort((a, b) => {
        const stockOf = (p: PartWithOffers): number =>
          p.offers.filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER).reduce((s, o) => s + (o.stock ?? 0), 0);
        return stockOf(b) - stockOf(a) || Number(a.id - b.id);
      })[0];
    if (part === undefined) continue;

    const needed = neededQty(item.bomQty, setQty, spareQty);
    const pick = pickDefaultOffer(toOfferInputs(part), needed, usdKrwRate);
    item.partId = String(part.id);
    item.matchStatus = 'auto';
    item.selectedOffer = pick === null ? null : snapshotFromPick(pick, false);
    item.orderQty = pick === null ? needed : pick.orderQty;
    // 소스 BOM 에 제조사·설명 열이 없으면 카탈로그 정본으로 보강(화면 공백 방지)
    if (item.manufacturerName === null || item.manufacturerName.trim() === '') {
      item.manufacturerName = part.manufacturerName;
    }
    if (item.description === null || item.description.trim() === '') {
      item.description = part.description?.slice(0, 1000) ?? null;
    }
  }
}

/**
 * 스냅샷 오퍼를 카탈로그 최신 데이터로 갱신 — 오퍼 정체성(공급사+SKU)은 보존하고
 * 가격구간·재고·fetchedAt 만 최신화(pinned 포함 — 고정은 오퍼 선택이지 옛 숫자가 아니다).
 * 원 오퍼가 카탈로그에서 사라졌으면 비고정 라인만 재선정한다. orderQty 는 보존하되
 * 갱신된 MOQ·배수는 재적용(발주 정합).
 */
export async function refreshOfferSnapshots(items: BomQuoteItemInputType[], usdKrwRate: number | null): Promise<void> {
  for (const item of items) {
    if (item.partId === null || item.selectedOffer === null) continue;
    const part = await prisma.spPart.findUnique({
      where: { id: BigInt(item.partId) },
      include: { offers: { include: { priceBreaks: true } } },
    });
    if (part === null) continue;
    const offers = toOfferInputs(part);
    const current = item.selectedOffer;
    const same = offers.find((o) => o.supplier === current.supplier && o.supplierSku === current.supplierSku);
    if (same !== undefined) {
      const pick = applyQtyToOffer(same, Math.max(1, item.orderQty), usdKrwRate);
      if (pick !== null) {
        item.selectedOffer = snapshotFromPick(pick, current.pinned);
        item.orderQty = pick.orderQty;
        continue;
      }
    }
    if (!current.pinned) {
      const pick = pickDefaultOffer(offers, Math.max(1, item.orderQty), usdKrwRate);
      if (pick !== null) {
        item.selectedOffer = snapshotFromPick(pick, false);
        item.orderQty = pick.orderQty;
      }
    }
  }
}

/**
 * 자동 보강 완료 후 견적 반영 — draft 한정. 기존 라인은 스냅샷 최신화(정체성 보존),
 * 미매칭 라인은 카탈로그 재매칭으로 채운 뒤 합계 재계산·영속.
 * 동시 호출(폴러 onDone+치유+백업 훅)은 직렬화 — replace-all 저장이 겹치지 않게.
 */
const refreshInFlight = new Map<string, Promise<void>>();

export async function refreshQuoteFromCatalog(quoteId: bigint): Promise<void> {
  const key = String(quoteId);
  const inFlight = refreshInFlight.get(key);
  if (inFlight !== undefined) return inFlight;
  const run = refreshQuoteFromCatalogInner(quoteId);
  refreshInFlight.set(key, run);
  try {
    await run;
  } finally {
    refreshInFlight.delete(key);
  }
}

async function refreshQuoteFromCatalogInner(quoteId: bigint): Promise<void> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true } });
  if (quote?.status !== 'draft') return;
  const config = await getBomQuoteConfig();
  const items = quote.items.map(toItemDto);
  await refreshOfferSnapshots(items, config.usdKrwRate);
  await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, true);
  const result = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
  // 라인과 done을 한 트랜잭션으로 공개 — 어떤 상세 GET도 중간 상태를 볼 수 없다.
  await persistQuoteComputed(quoteId, result, config.usdKrwRate, {
    enrichStatus: 'done',
    enrichedAt: new Date(),
  });
}

/**
 * 잡의 검색 결과가 (백업 훅 등으로) 인제스트된 뒤, 그 잡에 연결된 draft 견적을 재매칭.
 * sp-node 재시작으로 인제스트 폴러(onDone)가 유실됐을 때의 내성 — "카탈로그엔 있는데
 * 견적은 미매칭" 고착 방지. 미매칭 라인이 없으면 건드리지 않는다.
 */
export async function refreshQuotesForJob(jobId: string): Promise<void> {
  const quotes = await prisma.spBomQuote.findMany({
    where: { engineJobId: jobId, status: 'draft' },
    select: { id: true, enrichStatus: true, items: { select: { included: true, matchStatus: true } } },
  });
  for (const quote of quotes) {
    const hasUnmatched = quote.items.some((i) => i.included && i.matchStatus === 'none');
    // searching 은 미매칭이 없어도(신선도 보강) 반영해 done 으로 종결시킨다
    if (quote.enrichStatus !== 'searching' && !hasUnmatched) continue;
    await refreshQuoteFromCatalog(quote.id);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 스냅샷 기준 라인 재계산 — orderQty 에 맞는 구간·단가·환산·라인합계. */
export function recalcItems(items: BomQuoteItemInputType[], usdKrwRate: number | null): BomQuoteItemType[] {
  return items.map((item) => {
    const offer = item.selectedOffer;
    if (offer === null) return { ...item, lineTotalKrw: null };
    const orderQty = Math.max(1, item.orderQty);
    const step = pickBreak(offer.priceBreaks, orderQty);
    const unitPrice = step === null ? offer.unitPrice : step.price;
    const breakQty = step === null ? offer.breakQty : step.qty;
    const unitPriceKrw = toKrw(unitPrice, offer.currency, usdKrwRate);
    return {
      ...item,
      orderQty,
      selectedOffer: { ...offer, breakQty, unitPrice, unitPriceKrw },
      lineTotalKrw: unitPriceKrw === null ? null : round2(unitPriceKrw * orderQty),
    };
  });
}

// ── 영속화 ──────────────────────────────────────────────────────────────────

/** 라인 replace-all(레거시 문서 자동저장 방식) — draft 한정으로 호출할 것. */
export async function replaceQuoteItems(quoteId: bigint, items: BomQuoteItemType[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await replaceQuoteItemsInTransaction(tx, quoteId, items);
  });
}

async function replaceQuoteItemsInTransaction(
  tx: Prisma.TransactionClient,
  quoteId: bigint,
  items: BomQuoteItemType[],
): Promise<void> {
  await tx.spBomQuoteItem.deleteMany({ where: { quoteId } });
  if (items.length === 0) return;
  await tx.spBomQuoteItem.createMany({
    data: items.map((item) => ({
      quoteId,
      rowIdx: item.rowIdx,
      included: item.included,
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      bomQty: item.bomQty,
      orderQty: item.orderQty,
      matchStatus: item.matchStatus,
      partId: item.partId === null ? null : BigInt(item.partId),
      selectedOffer: item.selectedOffer === null ? Prisma.DbNull : (item.selectedOffer as Prisma.InputJsonValue),
      lineTotalKrw: item.lineTotalKrw,
      sourceRow: item.sourceRow === null ? Prisma.DbNull : (item.sourceRow as Prisma.InputJsonValue),
    })),
  });
}

export interface QuoteComputed {
  items: BomQuoteItemType[];
  itemsTotal: number;
  finalTotal: number;
  uncostedCount: number;
}

export interface QuotePersistenceExtra {
  title?: string;
  setQty?: number;
  spareQty?: number;
  customerMemo?: string | null;
  enrichStatus?: string;
  enrichedAt?: Date | null;
}

/** 계산 라인과 견적 합계·보강 상태를 한 트랜잭션으로 영속화한다. */
export async function persistQuoteComputed(
  quoteId: bigint,
  computed: QuoteComputed,
  usdKrwRate: number | null,
  extra?: QuotePersistenceExtra,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await replaceQuoteItemsInTransaction(tx, quoteId, computed.items);
    await tx.spBomQuote.update({
      where: { id: quoteId },
      data: {
        itemsTotal: computed.itemsTotal,
        finalTotal: computed.finalTotal,
        uncostedCount: computed.uncostedCount,
        usdKrwRateUsed: usdKrwRate,
        ...(extra?.title !== undefined ? { title: extra.title } : {}),
        ...(extra?.setQty !== undefined ? { setQty: extra.setQty } : {}),
        ...(extra?.spareQty !== undefined ? { spareQty: extra.spareQty } : {}),
        ...(extra?.customerMemo !== undefined ? { customerMemo: extra.customerMemo } : {}),
        ...(extra?.enrichStatus !== undefined ? { enrichStatus: extra.enrichStatus } : {}),
        ...(extra?.enrichedAt !== undefined ? { enrichedAt: extra.enrichedAt } : {}),
      },
    });
  });
}

/** 라인 재계산 + 합계(운송료·관리비 포함, VAT 별도) — 저장 전 단일 경로. */
export function computeQuote(
  items: BomQuoteItemInputType[],
  usdKrwRate: number | null,
  shippingFee: number,
  managementFee: number,
): QuoteComputed {
  const computed = recalcItems(items, usdKrwRate);
  const totals = computeTotals(
    computed.map((i) => ({ included: i.included, lineTotalKrw: i.lineTotalKrw })),
    shippingFee,
    managementFee,
  );
  return { items: computed, ...totals };
}

// ── DTO 매핑 ────────────────────────────────────────────────────────────────

export function toItemDto(row: QuoteItemRow): BomQuoteItemType {
  const offer = BomQuoteSelectedOffer.safeParse(row.selectedOffer);
  return {
    rowIdx: row.rowIdx,
    included: row.included,
    mpn: row.mpn,
    manufacturerName: row.manufacturerName,
    description: row.description,
    bomQty: row.bomQty,
    orderQty: row.orderQty,
    matchStatus: row.matchStatus as BomQuoteItemType['matchStatus'],
    partId: row.partId === null ? null : String(row.partId),
    selectedOffer: offer.success ? offer.data : null,
    sourceRow:
      typeof row.sourceRow === 'object' && row.sourceRow !== null && !Array.isArray(row.sourceRow)
        ? (row.sourceRow)
        : null,
    lineTotalKrw: row.lineTotalKrw === null ? null : Number(row.lineTotalKrw),
  };
}

type SummaryItemRow = Pick<QuoteItemRow, 'included' | 'matchStatus'>;

function summaryCounts(items: SummaryItemRow[]): { itemCount: number; includedCount: number; matchedCount: number } {
  return {
    itemCount: items.length,
    includedCount: items.filter((i) => i.included).length,
    matchedCount: items.filter((i) => i.matchStatus !== 'none').length,
  };
}

export function toSummaryDto(quote: QuoteRow, items: SummaryItemRow[]): BomQuoteSummaryType {
  return {
    id: String(quote.id),
    title: quote.title,
    status: quote.status as BomQuoteStatusType,
    fileName: quote.fileName,
    ...summaryCounts(items),
    finalTotal: quote.finalTotal,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    requestedAt: quote.requestedAt?.toISOString() ?? null,
    answeredAt: quote.answeredAt?.toISOString() ?? null,
  };
}

export function toDetailDto(quote: QuoteRow, items: QuoteItemRow[]): BomQuoteDetailType {
  return {
    ...toSummaryDto(quote, items),
    engineJobId: quote.engineJobId,
    enrichStatus: quote.enrichStatus as BomQuoteDetailType['enrichStatus'],
    enrichedAt: quote.enrichedAt?.toISOString() ?? null,
    setQty: quote.setQty,
    spareQty: quote.spareQty,
    itemsTotal: quote.itemsTotal,
    shippingFee: quote.shippingFee,
    managementFee: quote.managementFee,
    finalTotal: quote.finalTotal,
    usdKrwRateUsed: quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed),
    uncostedCount: quote.uncostedCount,
    customerMemo: quote.customerMemo,
    confirmedShippingFee: quote.confirmedShippingFee,
    confirmedManagementFee: quote.confirmedManagementFee,
    confirmedTotal: quote.confirmedTotal,
    answerNote: quote.answerNote,
    items: [...items].sort((a, b) => a.rowIdx - b.rowIdx).map(toItemDto),
  };
}

export function toAdminSummaryDto(quote: QuoteRow, items: SummaryItemRow[]): AdminBomQuoteSummaryType {
  return { ...toSummaryDto(quote, items), mbId: quote.mbId };
}

export function toAdminDetailDto(quote: QuoteRow, items: QuoteItemRow[], fileUrl: string | null): AdminBomQuoteDetailType {
  return { ...toDetailDto(quote, items), mbId: quote.mbId, adminMemo: quote.adminMemo, fileUrl };
}
