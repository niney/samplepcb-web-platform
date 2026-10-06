// 부품 카탈로그 표시 규칙 — 옛 pages/admin/AdminParts.vue 의 표시 함수를 그대로 옮겼다(화면 전용).

/** 검색 패싯 열쇠 — 검색 필터의 같은 이름 칸. */
export type PartFacetKey = 'manufacturer' | 'packageCode' | 'supplier';

/** ISO 시각 → 상대 나이("3시간 전"). null=구매 조건 없음. */
export function fmtAge(iso: string | null): string {
  if (iso === null) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${String(min)}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${String(hours)}시간 전`;
  return `${String(Math.floor(hours / 24))}일 전`;
}

function trim(v: number): string {
  return String(Number(v.toPrecision(4)));
}

// SI 값 → 사람이 읽는 표기(표시는 최적 접두 1개면 충분).
const SI_LABELS: readonly [string, (v: number) => string][] = [
  ['resistanceOhm', (v) => (v >= 1e6 ? `${trim(v / 1e6)}MΩ` : v >= 1e3 ? `${trim(v / 1e3)}kΩ` : `${trim(v)}Ω`)],
  ['capacitanceF', (v) => (v >= 1e-6 ? `${trim(v * 1e6)}µF` : v >= 1e-9 ? `${trim(v * 1e9)}nF` : `${trim(v * 1e12)}pF`)],
  ['inductanceH', (v) => (v >= 1e-3 ? `${trim(v * 1e3)}mH` : v >= 1e-6 ? `${trim(v * 1e6)}µH` : `${trim(v * 1e9)}nH`)],
  ['voltageV', (v) => `${trim(v)}V`],
  ['currentA', (v) => (v >= 1 ? `${trim(v)}A` : `${trim(v * 1e3)}mA`)],
  ['powerW', (v) => (v >= 1 ? `${trim(v)}W` : `${trim(v * 1e3)}mW`)],
  ['frequencyHz', (v) => (v >= 1e6 ? `${trim(v / 1e6)}MHz` : v >= 1e3 ? `${trim(v / 1e3)}kHz` : `${trim(v)}Hz`)],
  ['tolerancePct', (v) => `±${trim(v)}%`],
];

export function specSummary(specsSi: Record<string, number>): string {
  const parts: string[] = [];
  for (const [field, fmtFn] of SI_LABELS) {
    const v = specsSi[field];
    if (v !== undefined) parts.push(fmtFn(v));
  }
  return parts.join(' · ');
}

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = { KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '¥' };
const SUPPLIER_LABEL: Readonly<Record<string, string>> = {
  samplepcb: 'SamplePCB',
  digikey: 'DigiKey',
  mouser: 'Mouser',
  unikeyic: 'UniKeyIC',
  walsin: 'Walsin',
  yageo: 'Yageo',
  samsung: 'Samsung',
  murata: 'Murata',
  tdk: 'TDK',
  vishay: 'Vishay',
  koa: 'KOA',
  yeonho: 'Yeonho',
};

export function supplierLabel(value: string): string {
  return SUPPLIER_LABEL[value.toLowerCase()] ?? value;
}

export function fmtPrice(p: number | null, currency: string | null): string {
  if (p === null) return '';
  const n = String(Number(p.toPrecision(4)));
  if (currency === null || currency === '') return n;
  const sym = CURRENCY_SYMBOL[currency];
  return sym === undefined ? `${n} ${currency}` : `${sym}${n}`;
}
