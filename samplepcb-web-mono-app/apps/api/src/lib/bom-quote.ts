import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  BomQuoteMatchEvidence,
  BomQuoteSelectedOffer,
  type AdminBomQuoteDetailType,
  type AdminBomQuoteSummaryType,
  type BomQuoteDetailType,
  type BomQuoteItemInputType,
  type BomQuoteItemType,
  type BomQuoteMatchEvidenceType,
  type BomQuoteSheetType,
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
import { engineFetch } from './engine-client';
import { resolveManufacturer } from './manufacturer-alias';
import { SAMPLEPCB_SUPPLIER } from './parts-facts';
import { getBomQuoteConfig } from './sp-config';

// 고객 BOM 견적 핵심 로직 — 회원/관리자 라우트가 공유. 설계: docs/BOM_QUOTE.md.
// 원칙: 수량·오퍼는 스냅샷 박제가 단일 진실, 금액은 항상 서버가 스냅샷에서 재계산
// (클라 금액 불신 — 단 스냅샷 단가 자체는 카탈로그 매칭이 서버측에서 기록한 값이고,
//  최종 확정가는 관리자 검토가 결정하는 RFQ 모델이라 조작 이득이 없다).

export type QuoteRow = Prisma.SpBomQuoteGetPayload<object>;
export type QuoteItemRow = Prisma.SpBomQuoteItemGetPayload<object>;
export type QuoteSheetRow = Prisma.SpBomQuoteSheetGetPayload<object>;

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
    sheet_index_0based: z.number().int().min(0),
    source_rows_1based: z.array(z.number().int()).optional(),
  })
  .passthrough();

const EngineSheetLoose = z
  .object({
    sheet_index_0based: z.number().int().min(0),
    sheet_name: z.string(),
    status: z.string(),
    component_count: z.number().int().min(0).default(0),
    warnings: z.array(z.string()).default([]),
    unparsed_reason: z.string().nullish(),
  })
  .passthrough();

const EngineResultLoose = z
  .object({
    components: z.array(EngineComponentLoose).default([]),
    sheets: z.array(EngineSheetLoose).default([]),
    source_file: z.string().default(''),
  })
  .passthrough();

const EngineSupplierOffer = z
  .object({
    supplier: z.string(),
    supplier_sku: z.string().nullish(),
    packaging: z.string().nullish(),
    stock: z.number().int().nullish(),
    moq: z.number().int().nullish(),
    order_multiple: z.number().int().nullish(),
    price_breaks: z
      .array(
        z.object({
          quantity: z.number().int().positive(),
          unit_price: z.number().positive(),
          currency: z.string(),
        }),
      )
      .default([]),
    fetched_at: z.string(),
  })
  .passthrough();

const EngineSupplierCandidate = z
  .object({
    status: z.string(),
    identity_confidence: z.number().default(0),
    specification_confidence: z.number().default(0),
    conflicts: z.array(z.string()).default([]),
    missing_requirements: z.array(z.string()).default([]),
    reasons: z.array(z.string()).default([]),
    corroborating_suppliers: z.array(z.string()).default([]),
    product: z
      .object({
        supplier: z.string(),
        manufacturer_part_number: z.string(),
        manufacturer: z.string().nullish(),
        description: z.string().nullish(),
        offers: z.array(EngineSupplierOffer).default([]),
      })
      .passthrough(),
  })
  .passthrough();

const EngineSupplierComponent = z
  .object({
    component_id: z.string(),
    status: z.string(),
    candidates: z.array(EngineSupplierCandidate).default([]),
  })
  .passthrough();

const EngineSupplierEnvelope = z
  .object({
    search: z
      .object({
        components: z.array(EngineSupplierComponent).default([]),
      })
      .passthrough(),
  })
  .passthrough();

type EngineSupplierCandidateType = z.infer<typeof EngineSupplierCandidate>;
type EngineSupplierComponentType = z.infer<typeof EngineSupplierComponent>;

export const BOM_ENGINE_SELECTION_POLICY_VERSION = 'engine-safe-lowest-cost-v1';

/** 엔진 시트 결과를 고객·관리자 공용 선택 스냅샷으로 축약한다. */
export function extractEngineSheets(result: unknown): BomQuoteSheetType[] {
  const parsed = EngineResultLoose.safeParse(result);
  if (!parsed.success) return [];
  return parsed.data.sheets.map((sheet) => ({
    sheetIndex: sheet.sheet_index_0based,
    sheetName: sheet.sheet_name.slice(0, 191),
    status: sheet.status === 'parsed' ? 'parsed' : sheet.status === 'not_bom' ? 'not_bom' : 'error',
    componentCount: sheet.component_count,
    selected: false,
    failureReason: sheet.unparsed_reason?.slice(0, 500) ?? null,
    warnings: sheet.warnings,
  }));
}

/**
 * G-shape 파싱 결과에서 견적 라인 초안 생성.
 *
 * 선택한 시트에서 엔진이 컴포넌트로 판정한 행은 MPN 유무와 관계없이 모두 보존한다.
 * 순서는 워크북 시트 순서 → 원본 행 번호 → 엔진 입력 순서로 고정한다. MPN이 없는
 * 행은 빈 문자열로 두어 value_raw를 MPN처럼 카탈로그에 오매칭하지 않는다.
 */
export function buildItemsFromEngineResult(
  result: unknown,
  selectedSheetIndexes: readonly number[],
): BomQuoteItemInputType[] {
  const parsed = EngineResultLoose.safeParse(result);
  if (!parsed.success) return [];
  const selected = new Set(selectedSheetIndexes);
  const components = parsed.data.components
    .map((component, inputIndex) => ({ component, inputIndex }))
    .filter(({ component }) => selected.has(component.sheet_index_0based))
    .sort((a, b) => {
      const sheetOrder = a.component.sheet_index_0based - b.component.sheet_index_0based;
      if (sheetOrder !== 0) return sheetOrder;
      const aRow = Math.min(...(a.component.source_rows_1based ?? []), Number.MAX_SAFE_INTEGER);
      const bRow = Math.min(...(b.component.source_rows_1based ?? []), Number.MAX_SAFE_INTEGER);
      return aRow - bRow || a.inputIndex - b.inputIndex;
    });
  const items: BomQuoteItemInputType[] = [];
  for (const { component: c } of components) {
    const mpn = (c.part_number ?? '').trim();
    const sourceRows = c.source_rows_1based ?? [];
    const componentId = createHash('sha256')
      .update(`${parsed.data.source_file}\0${String(c.sheet_index_0based)}\0${sourceRows.join(',')}`)
      .digest('hex')
      .slice(0, 24);
    items.push({
      rowIdx: items.length,
      included: true,
      mpn: mpn.slice(0, 191),
      manufacturerName: c.manufacturer?.trim().slice(0, 191) ?? null,
      description: c.description?.trim().slice(0, 1000) ?? null,
      bomQty: Math.max(1, c.quantity ?? 1),
      orderQty: 0, // 매칭·수량 박제 전 — catalog-match/재계산이 채운다
      matchStatus: 'none',
      matchEvidence: null,
      partId: null,
      selectedOffer: null,
      sourceSheetIndex: c.sheet_index_0based,
      sourceSheetName: c.sheet_name?.slice(0, 191) ?? null,
      sourceRow: {
        sheetName: c.sheet_name ?? null,
        sourceRows,
        componentId,
        referenceDesignators: c.reference_designators ?? [],
        packageCode: c.package ?? null,
        valueRaw: c.value_raw ?? null,
        inputPartNumber: mpn === '' ? null : mpn,
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
    // 공급사 엔진이 판정을 끝낸 행은 느슨한 MPN 카탈로그 조회로 덮어쓰지 않는다.
    // 검토/미매칭도 엔진의 최종 BOM 문맥 판정이므로 그대로 보존한다.
    if (item.matchEvidence !== null) continue;
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

interface EngineMatchDecision {
  evidence: BomQuoteMatchEvidenceType;
  candidate: EngineSupplierCandidateType | null;
  pick: OfferPick | null;
}

function candidateMode(status: string): BomQuoteMatchEvidenceType['selectionMode'] | null {
  if (status === 'verified_exact') return 'exact';
  if (status === 'verified_variant') return 'variant';
  if (status === 'spec_compatible') return 'spec-compatible';
  return null;
}

function engineOfferInput(offer: z.infer<typeof EngineSupplierOffer>): BomOfferInput {
  return {
    supplier: offer.supplier,
    supplierSku: (offer.supplier_sku ?? '').slice(0, 191),
    packaging: offer.packaging ?? null,
    currency: offer.price_breaks[0]?.currency ?? null,
    stock: offer.stock ?? null,
    moq: offer.moq ?? null,
    orderMultiple: offer.order_multiple ?? null,
    fetchedAt: offer.fetched_at,
    priceBreaks: offer.price_breaks.map((step) => ({
      qty: step.quantity,
      price: step.unit_price,
      currency: step.currency,
    })),
  };
}

function evidenceFromDecision(
  component: EngineSupplierComponentType,
  eligible: EngineSupplierCandidateType[],
  candidate: EngineSupplierCandidateType | null,
  pick: OfferPick | null,
  mode: BomQuoteMatchEvidenceType['selectionMode'],
): BomQuoteMatchEvidenceType {
  const reviewCandidate = candidate ?? component.candidates[0] ?? null;
  return {
    policyVersion: BOM_ENGINE_SELECTION_POLICY_VERSION,
    componentId: component.component_id,
    componentStatus: component.status,
    candidateStatus: reviewCandidate?.status ?? null,
    selectionMode: mode,
    candidateCount: component.candidates.length,
    eligibleCandidateCount: eligible.length,
    selectedMpn: candidate?.product.manufacturer_part_number ?? null,
    selectedManufacturer: candidate?.product.manufacturer ?? null,
    selectedSupplier: pick?.offer.supplier ?? null,
    selectedSupplierSku: pick?.offer.supplierSku ?? null,
    identityConfidence: reviewCandidate?.identity_confidence ?? null,
    specificationConfidence: reviewCandidate?.specification_confidence ?? null,
    conflicts: reviewCandidate?.conflicts ?? [],
    missingRequirements: reviewCandidate?.missing_requirements ?? [],
    reasons: reviewCandidate?.reasons ?? [],
    corroboratingSuppliers: reviewCandidate?.corroborating_suppliers ?? [],
  };
}

/**
 * 엔진 후보에서 안전한 최상위 판정 등급만 남긴 뒤 모든 공급사 오퍼 중 실효 총비용
 * 최저를 고른다. 원본 MPN이 있으면 임의 대체를 막기 위해 spec_compatible은 제외한다.
 */
export function selectEngineMatch(
  componentValue: unknown,
  originalHasMpn: boolean,
  needed: number,
  usdKrwRate: number | null,
): EngineMatchDecision | null {
  const parsed = EngineSupplierComponent.safeParse(componentValue);
  if (!parsed.success) return null;
  const component = parsed.data;
  const safe = component.candidates.filter((candidate) => {
    const mode = candidateMode(candidate.status);
    if (mode === null) return false;
    if (mode === 'spec-compatible' && originalHasMpn) return false;
    if (candidate.conflicts.length > 0) return false;
    if (mode === 'spec-compatible' && candidate.missing_requirements.length > 0) return false;
    return normalizeMpn(candidate.product.manufacturer_part_number) !== '';
  });

  const tierOrder: BomQuoteMatchEvidenceType['selectionMode'][] = originalHasMpn
    ? ['exact', 'variant']
    : ['exact', 'variant', 'spec-compatible'];
  const selectedMode = tierOrder.find((mode) => safe.some((candidate) => candidateMode(candidate.status) === mode));
  if (selectedMode === undefined) {
    const mode = component.status === 'not_found' ? 'unmatched' : 'review';
    return {
      evidence: evidenceFromDecision(component, [], null, null, mode),
      candidate: null,
      pick: null,
    };
  }

  const eligible = safe.filter((candidate) => candidateMode(candidate.status) === selectedMode);
  const candidateByOffer = new Map<BomOfferInput, EngineSupplierCandidateType>();
  const offers: BomOfferInput[] = [];
  for (const candidate of eligible) {
    for (const offer of candidate.product.offers) {
      const input = engineOfferInput(offer);
      offers.push(input);
      candidateByOffer.set(input, candidate);
    }
  }
  const pick = pickDefaultOffer(offers, needed, usdKrwRate);
  // 가격이 없는 안전 후보도 부품 자체는 선정한다. 공급사 오퍼는 가격 확인 필요 상태다.
  const candidate = pick === null ? (eligible[0] ?? null) : (candidateByOffer.get(pick.offer) ?? eligible[0] ?? null);
  return {
    evidence: evidenceFromDecision(component, eligible, candidate, pick, selectedMode),
    candidate,
    pick,
  };
}

function originalPartNumber(item: BomQuoteItemInputType): string {
  const raw = item.sourceRow?.inputPartNumber;
  if (typeof raw === 'string') return raw.trim();
  if (raw === null) return '';
  if (item.matchEvidence?.selectionMode === 'spec-compatible') return '';
  return item.mpn.trim();
}

async function partIdForCandidate(candidate: EngineSupplierCandidateType): Promise<string | null> {
  const mpnNorm = normalizeMpn(candidate.product.manufacturer_part_number);
  if (mpnNorm === '') return null;
  const manufacturer = resolveManufacturer(candidate.product.manufacturer);
  const exact = await prisma.spPart.findUnique({
    where: { mpnNorm_manufacturerNorm: { mpnNorm, manufacturerNorm: manufacturer.norm } },
    select: { id: true },
  });
  if (exact !== null) return String(exact.id);
  // 공급사별 제조사 표기가 아직 별칭 사전에 없더라도 같은 MPN 인제스트 행을 연결한다.
  const byMpn = await prisma.spPart.findFirst({ where: { mpnNorm }, orderBy: { lastSeenAt: 'desc' }, select: { id: true } });
  return byMpn === null ? null : String(byMpn.id);
}

/** 관리자와 동일한 공급사 검색 결과를 견적 행에 직접 반영한다. */
export async function applyEngineSupplierResult(
  items: BomQuoteItemInputType[],
  envelopeValue: unknown,
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
): Promise<boolean> {
  const parsed = EngineSupplierEnvelope.safeParse(envelopeValue);
  if (!parsed.success) return false;
  const components = new Map(parsed.data.search.components.map((component) => [component.component_id, component]));

  for (const item of items) {
    if (item.matchStatus === 'manual' || item.selectedOffer?.pinned === true) continue;
    const componentId = item.sourceRow?.componentId;
    if (typeof componentId !== 'string') continue; // 수동 추가 행은 카탈로그/사용자 선택을 유지
    const component = components.get(componentId);
    if (component === undefined) continue;

    const inputPartNumber = originalPartNumber(item);
    const needed = neededQty(item.bomQty, setQty, spareQty);
    const decision = selectEngineMatch(component, inputPartNumber !== '', needed, usdKrwRate);
    if (decision === null) continue;
    item.matchEvidence = decision.evidence;

    if (decision.candidate === null) {
      item.mpn = inputPartNumber.slice(0, 191);
      item.partId = null;
      item.matchStatus = 'none';
      item.selectedOffer = null;
      item.orderQty = needed;
      continue;
    }

    const product = decision.candidate.product;
    item.mpn = product.manufacturer_part_number.trim().slice(0, 191);
    if (product.manufacturer !== null && product.manufacturer !== undefined && product.manufacturer.trim() !== '') {
      item.manufacturerName = product.manufacturer.trim().slice(0, 191);
    }
    if (product.description !== null && product.description !== undefined && product.description.trim() !== '') {
      item.description = product.description.trim().slice(0, 1000);
    }
    item.partId = await partIdForCandidate(decision.candidate);
    item.matchStatus = 'auto';
    item.selectedOffer = decision.pick === null ? null : snapshotFromPick(decision.pick, false);
    item.orderQty = decision.pick?.orderQty ?? needed;
  }
  return true;
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

const engineRefreshInFlight = new Map<string, Promise<boolean>>();

/**
 * 검색 완료 결과를 componentId로 견적에 직접 반영한다. 카탈로그 인제스트 이후 호출되어
 * partId도 연결하지만, 매칭 판정과 오퍼 선택의 진실원본은 이 엔진 봉투다.
 */
export async function refreshQuoteFromSupplierResult(quoteId: bigint, envelope: unknown): Promise<boolean> {
  const key = String(quoteId);
  const inFlight = engineRefreshInFlight.get(key);
  if (inFlight !== undefined) return inFlight;
  const run = (async (): Promise<boolean> => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true } });
    if (quote?.status !== 'draft') return false;
    const config = await getBomQuoteConfig();
    const items = quote.items.map(toItemDto);
    const applied = await applyEngineSupplierResult(items, envelope, quote.setQty, quote.spareQty, config.usdKrwRate);
    if (!applied) return false;
    const result = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quoteId, result, config.usdKrwRate, {
      enrichStatus: 'done',
      enrichedAt: new Date(),
    });
    return true;
  })();
  engineRefreshInFlight.set(key, run);
  try {
    return await run;
  } finally {
    engineRefreshInFlight.delete(key);
  }
}

/**
 * 잡의 검색 결과가 (백업 훅 등으로) 인제스트된 뒤, 그 잡에 연결된 draft 견적을 재매칭.
 * sp-node 재시작으로 인제스트 폴러(onDone)가 유실됐을 때의 내성 — "카탈로그엔 있는데
 * 견적은 미매칭" 고착 방지. 미매칭 라인이 없으면 건드리지 않는다.
 */
export async function refreshQuotesForJob(jobId: string): Promise<void> {
  const response = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
  if (!response.ok) return;
  const envelope: unknown = await response.json();
  const quotes = await prisma.spBomQuote.findMany({
    where: { engineJobId: jobId, status: 'draft' },
    select: { id: true, enrichStatus: true, items: { select: { included: true, matchStatus: true } } },
  });
  for (const quote of quotes) {
    const hasUnmatched = quote.items.some((i) => i.included && i.matchStatus === 'none');
    // searching 은 미매칭이 없어도 최신 엔진 판정·가격을 반영해 done 으로 종결시킨다.
    if (quote.enrichStatus !== 'searching' && !hasUnmatched) continue;
    await refreshQuoteFromSupplierResult(quote.id, envelope);
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
      matchEvidence: item.matchEvidence === null ? Prisma.DbNull : (item.matchEvidence as Prisma.InputJsonValue),
      partId: item.partId === null ? null : BigInt(item.partId),
      selectedOffer: item.selectedOffer === null ? Prisma.DbNull : (item.selectedOffer as Prisma.InputJsonValue),
      lineTotalKrw: item.lineTotalKrw,
      sourceRow: item.sourceRow === null ? Prisma.DbNull : (item.sourceRow as Prisma.InputJsonValue),
      sourceSheetIndex: item.sourceSheetIndex,
      sourceSheetName: item.sourceSheetName,
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
  buildStatus?: string;
  selectedSheetIndexes?: number[];
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
    if (extra?.selectedSheetIndexes !== undefined) {
      await tx.spBomQuoteSheet.updateMany({ where: { quoteId }, data: { selected: false } });
      await tx.spBomQuoteSheet.updateMany({
        where: { quoteId, sheetIndex: { in: extra.selectedSheetIndexes } },
        data: { selected: true },
      });
    }
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
        ...(extra?.buildStatus !== undefined ? { buildStatus: extra.buildStatus } : {}),
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
  const evidence = BomQuoteMatchEvidence.safeParse(row.matchEvidence);
  return {
    rowIdx: row.rowIdx,
    included: row.included,
    mpn: row.mpn,
    manufacturerName: row.manufacturerName,
    description: row.description,
    bomQty: row.bomQty,
    orderQty: row.orderQty,
    matchStatus: row.matchStatus as BomQuoteItemType['matchStatus'],
    matchEvidence: evidence.success ? evidence.data : null,
    partId: row.partId === null ? null : String(row.partId),
    selectedOffer: offer.success ? offer.data : null,
    sourceSheetIndex: row.sourceSheetIndex,
    sourceSheetName: row.sourceSheetName,
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

function toSheetDto(row: QuoteSheetRow): BomQuoteSheetType {
  return {
    sheetIndex: row.sheetIndex,
    sheetName: row.sheetName,
    status: row.status as BomQuoteSheetType['status'],
    componentCount: row.componentCount,
    selected: row.selected,
    failureReason: row.failureReason,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((value): value is string => typeof value === 'string') : [],
  };
}

export function toDetailDto(quote: QuoteRow, items: QuoteItemRow[], sheets: QuoteSheetRow[] = []): BomQuoteDetailType {
  return {
    ...toSummaryDto(quote, items),
    engineJobId: quote.engineJobId,
    buildStatus: quote.buildStatus as BomQuoteDetailType['buildStatus'],
    sheets: [...sheets].sort((a, b) => a.sheetIndex - b.sheetIndex).map(toSheetDto),
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

export function toAdminDetailDto(
  quote: QuoteRow,
  items: QuoteItemRow[],
  sheets: QuoteSheetRow[],
  fileUrl: string | null,
): AdminBomQuoteDetailType {
  return { ...toDetailDto(quote, items, sheets), mbId: quote.mbId, adminMemo: quote.adminMemo, fileUrl };
}
