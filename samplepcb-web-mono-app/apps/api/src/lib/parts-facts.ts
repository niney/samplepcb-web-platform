import { roundSig } from '@sp/utils';

// 부품 정본 사실 해소 — 부품(SpPart)의 스펙·설명·자체(samplepcb) 오퍼는
// "그 부품의 전체 실공급사 오퍼"의 결정적 함수다. 인제스트·수동 갱신·재색인
// 어디서 호출해도 같은 결과가 나오도록 순수함수로 두고, 영속 레코드는 이 함수의
// 출력을 항상 재생성한다(내용의 소유권은 함수, 저장은 캐시).
//
// 스펙 충돌 정책: 표기·정밀도 차이(SI 상대 오차 이내)는 충돌이 아니다. 진짜 충돌은
// 다수결 → 공급사 신뢰 순위 → 최신 fetchedAt 으로 채택하고 전체 그룹을 남긴다.
// 오퍼 선정(상업 조건: 가격·재고)과 스펙 판정(데이터 품질)은 분리된 축 —
// 최저가 공급사의 오타 스펙이 정본을 오염시키는 경로를 차단한다.

export const SAMPLEPCB_SUPPLIER = 'samplepcb';
export const SAMPLEPCB_POLICY_VERSION = 1;

/** 데이터 품질 신뢰 순위(스펙 판정용) — 목록에 없는 공급사는 그 뒤 순위. */
export const SUPPLIER_TRUST_ORDER: readonly string[] = ['digikey', 'mouser', 'unikeyic'];

/** 같은 값의 표기·정밀도 차이 허용(상대 오차) — 이내면 동일 값으로 본다. */
export const SPEC_REL_TOLERANCE = 0.005;

// 엔진 normalized_specs 키 → ES SI 필드(SPEC_SI_FIELD 값과 일치)
export const ENGINE_SPEC_FIELD: Record<string, string> = {
  resistance_ohm: 'resistanceOhm',
  capacitance_f: 'capacitanceF',
  inductance_h: 'inductanceH',
  power_w: 'powerW',
  tolerance_percent: 'tolerancePct',
  voltage_v: 'voltageV',
  current_a: 'currentA',
  frequency_hz: 'frequencyHz',
};

export interface FactsSource {
  supplier: string;
  fetchedAt: Date;
  specs: Record<string, unknown>;
  description: string | null;
  category: string | null;
  packageCode: string | null; // 원문 — 정준화(normalizePackageCode)는 호출부
  lifecycle: string | null;
  datasheetUrl: string | null;
  imageUrl: string | null;
}

export interface SpecConflictGroup {
  value: unknown;
  suppliers: string[];
  fetchedAt: string; // 그룹 내 최신 ISO
}

/** field → 값 그룹들(채택 그룹이 첫 번째). 빈 객체 = 충돌 없음. */
export type SpecConflicts = Record<string, SpecConflictGroup[]>;

export interface PartFacts {
  specsJson: Record<string, unknown>;
  specsSi: Record<string, number>;
  specConflicts: SpecConflicts;
  description: string | null;
  category: string | null;
  packageCode: string | null;
  lifecycle: string | null;
  datasheetUrl: string | null;
  imageUrl: string | null;
}

function trustRank(supplier: string): number {
  const i = SUPPLIER_TRUST_ORDER.indexOf(supplier.toLowerCase());
  return i === -1 ? SUPPLIER_TRUST_ORDER.length : i;
}

interface Vote {
  value: unknown;
  supplier: string;
  fetchedAt: Date;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a === b) return true;
    return Math.abs(a - b) <= SPEC_REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 그룹 내 대표값 — 신뢰 순위 높은 공급사, 동률이면 최신. */
function pickRepresentative(votes: Vote[]): Vote {
  const sorted = [...votes].sort(
    (a, b) => trustRank(a.supplier) - trustRank(b.supplier) || b.fetchedAt.getTime() - a.fetchedAt.getTime(),
  );
  const first = sorted[0];
  if (first === undefined) throw new Error('빈 투표 그룹 — 호출부 버그');
  return first;
}

interface ValueGroup {
  votes: Vote[];
}

function groupStats(g: ValueGroup): { supplierCount: number; bestTrust: number; latest: number } {
  const suppliers = new Set(g.votes.map((v) => v.supplier.toLowerCase()));
  return {
    supplierCount: suppliers.size,
    bestTrust: Math.min(...g.votes.map((v) => trustRank(v.supplier))),
    latest: Math.max(...g.votes.map((v) => v.fetchedAt.getTime())),
  };
}

/** 다수결 → 신뢰 순위 → 최신 순으로 그룹 정렬(채택 그룹이 첫 번째). */
function rankGroups(groups: ValueGroup[]): ValueGroup[] {
  return [...groups].sort((a, b) => {
    const sa = groupStats(a);
    const sb = groupStats(b);
    return sb.supplierCount - sa.supplierCount || sa.bestTrust - sb.bestTrust || sb.latest - sa.latest;
  });
}

function isEmptyText(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

/** 스칼라 필드(설명·카테고리 등) — 비어있지 않은 값 중 신뢰 순위 → 최신. */
function pickScalar(sources: FactsSource[], get: (s: FactsSource) => string | null): string | null {
  const votes = sources
    .filter((s) => !isEmptyText(get(s)))
    .sort((a, b) => trustRank(a.supplier) - trustRank(b.supplier) || b.fetchedAt.getTime() - a.fetchedAt.getTime());
  const first = votes[0];
  return first === undefined ? null : get(first);
}

/** 부품 정본 사실 = f(전체 실공급사 오퍼). samplepcb 파생 오퍼는 입력에서 제외할 것. */
export function resolvePartFacts(sources: FactsSource[]): PartFacts {
  const real = sources.filter((s) => s.supplier !== SAMPLEPCB_SUPPLIER);

  // field 별 투표 수집
  const votesByField = new Map<string, Vote[]>();
  for (const s of real) {
    for (const [key, value] of Object.entries(s.specs)) {
      if (value === null || value === undefined) continue;
      const list = votesByField.get(key) ?? [];
      list.push({ value, supplier: s.supplier, fetchedAt: s.fetchedAt });
      votesByField.set(key, list);
    }
  }

  const specsJson: Record<string, unknown> = {};
  const specsSi: Record<string, number> = {};
  const specConflicts: SpecConflicts = {};

  for (const [key, votes] of votesByField) {
    // 값 그룹핑 — 대표값과 SI 오차 이내면 같은 그룹
    const groups: ValueGroup[] = [];
    for (const vote of votes) {
      const g = groups.find((grp) => sameValue(pickRepresentative(grp.votes).value, vote.value));
      if (g === undefined) groups.push({ votes: [vote] });
      else g.votes.push(vote);
    }

    const ranked = rankGroups(groups);
    const winner = ranked[0];
    if (winner === undefined) continue; // votes 비어있음 — 도달 불가(방어)
    const chosen = pickRepresentative(winner.votes).value;
    specsJson[key] = chosen;

    const siField = ENGINE_SPEC_FIELD[key];
    if (siField !== undefined && typeof chosen === 'number' && Number.isFinite(chosen)) {
      specsSi[siField] = roundSig(chosen);
    }

    if (ranked.length > 1) {
      specConflicts[key] = ranked.map((g) => ({
        value: pickRepresentative(g.votes).value,
        suppliers: [...new Set(g.votes.map((v) => v.supplier.toLowerCase()))].sort(),
        fetchedAt: new Date(groupStats(g).latest).toISOString(),
      }));
    }
  }

  return {
    specsJson,
    specsSi,
    specConflicts,
    description: pickScalar(real, (s) => s.description),
    category: pickScalar(real, (s) => s.category),
    packageCode: pickScalar(real, (s) => s.packageCode),
    lifecycle: pickScalar(real, (s) => s.lifecycle),
    datasheetUrl: pickScalar(real, (s) => s.datasheetUrl),
    imageUrl: pickScalar(real, (s) => s.imageUrl),
  };
}

// ── 자체(samplepcb) 오퍼 파생 ──────────────────────────────────────────────

export interface DeriveSource {
  supplier: string;
  supplierSku: string;
  productUrl: string | null;
  stock: number | null;
  moq: number | null;
  orderMultiple: number | null;
  packaging: string | null;
  currency: string | null;
  leadTime: string | null;
  fetchedAt: Date;
  priceBreaks: { qty: number; price: number; currency: string }[];
}

/** 오퍼의 최소수량 구간(대표 단가 기준점). */
function firstBreak(s: DeriveSource): { qty: number; price: number; currency: string } | null {
  return [...s.priceBreaks].sort((a, b) => a.qty - b.qty)[0] ?? null;
}

function offerCurrency(s: DeriveSource): string {
  const fb = firstBreak(s);
  const c = fb !== null && fb.currency !== '' ? fb.currency : (s.currency ?? '');
  return c.toUpperCase();
}

/**
 * 자체 samplepcb 오퍼의 원천 선정 — 수량 무관 안정 규칙(카탈로그 레벨).
 * 재고>0 우선 → KRW 우선(환율 불확실성 회피) → 최소구간 단가 최저 →
 * 동률 시 재고 많은 순 → 공급사 신뢰 순위 → 최신. 원천 1개에서 통째 복사(혼합 금지).
 * BOM 견적 라인의 수량 기반 선정(pickDefaultOffer)은 별도 축이다.
 */
export function deriveSamplepcbOffer(sources: DeriveSource[]): DeriveSource | null {
  const candidates = sources.filter((s) => {
    if (s.supplier === SAMPLEPCB_SUPPLIER) return false;
    const fb = firstBreak(s);
    return fb !== null && fb.price > 0; // 0원 구간(자리표시 데이터)은 원천 부적격
  });
  if (candidates.length === 0) return null;

  const inStock = candidates.filter((s) => (s.stock ?? 0) > 0);
  const pool = inStock.length > 0 ? inStock : candidates;

  const krw = pool.filter((s) => offerCurrency(s) === 'KRW');
  const pool2 = krw.length > 0 ? krw : pool;

  const sorted = [...pool2].sort((a, b) => {
    const pa = firstBreak(a)?.price ?? Number.POSITIVE_INFINITY; // candidates 필터로 실제로는 항상 존재
    const pb = firstBreak(b)?.price ?? Number.POSITIVE_INFINITY;
    return (
      pa - pb ||
      (b.stock ?? 0) - (a.stock ?? 0) ||
      trustRank(a.supplier) - trustRank(b.supplier) ||
      b.fetchedAt.getTime() - a.fetchedAt.getTime()
    );
  });
  return sorted[0] ?? null;
}
