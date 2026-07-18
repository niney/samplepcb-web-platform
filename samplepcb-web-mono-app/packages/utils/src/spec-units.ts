// 부품 스펙 표기 정규화 — 색인·검색 양쪽이 "같은 파서"를 쓴다 (설계: docs/PARTS_SEARCH.md).
//
// 2트랙 원칙:
//  - Track A(수치): 모든 표기를 SI 기본단위 double(유효 6자리)로 정준화 → range ±0.1%
//    매칭. 접두 환산(4k7=4700=0.0047M, 2.2nF=2200pF)은 여기서 구조적으로 해소된다.
//  - Track B(표기): 사람이 실제 치는 관행 표기만 variants 로 생성(2n2, 472, 104…).
//    임의 단위 환산을 열거하지 않는다 — 그건 Track A 의 몫.
// 모호성 원칙: 해석은 항상 복수 후보(confidence high/low)로 내보내고, 검색 쿼리는
// should(가산점)로만 쓴다 — 배타 필터 승격 금지. 실데이터가 랭킹으로 결정한다.
//
// 파싱 관례는 bom-extraction-engine(normalize_values.py)과 정합 유지:
//  - 저항 문맥의 m 은 관례상 메가(1M=1e6). 단 명시적 ohm 접미가 붙으면 대소문자
//    존중(5mΩ=밀리 high / 5MΩ=메가 high, 반대 해석은 low 동반).
//  - 커패시턴스 무단위 p/n/u ("100n")는 F 생략 관용 표기.
//  - EIA 3자리 코드(104=100nF)는 엔진이 미지원(None)인 확장 — 검색 전용, low.

export type SpecKind =
  | 'resistance'
  | 'capacitance'
  | 'inductance'
  | 'voltage'
  | 'current'
  | 'power'
  | 'frequency'
  | 'tolerance';

export type SpecConfidence = 'high' | 'low';

export interface SpecInterpretation {
  kind: SpecKind;
  /** SI 기본단위 값(Ω·F·H·V·A·W·Hz·%), 유효 6자리 반올림. */
  si: number;
  confidence: SpecConfidence;
  /** EIA 코드 톨러런스 문자(104K→10)에서만 채워진다. */
  tolerancePct?: number;
}

/** ES 문서의 SI 필드명 매핑 — 색인(Phase B)·쿼리 빌더(Phase C)가 공유. */
export const SPEC_SI_FIELD: Record<SpecKind, string> = {
  resistance: 'resistanceOhm',
  capacitance: 'capacitanceF',
  inductance: 'inductanceH',
  voltage: 'voltageV',
  current: 'currentA',
  power: 'powerW',
  frequency: 'frequencyHz',
  tolerance: 'tolerancePct',
};

/** 유효숫자 반올림(기본 6자리) — 색인·쿼리 양쪽 정준화의 기준. */
export function roundSig(x: number, sig = 6): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  return Number(x.toPrecision(sig));
}

/** SI 값의 매칭 범위(기본 ±0.1%) — 부동소수점 잔차 + 정준화 반올림 흡수. */
export function siRange(si: number, relTol = 0.001): { gte: number; lte: number } {
  const lo = si * (1 - relTol);
  const hi = si * (1 + relTol);
  return { gte: Math.min(lo, hi), lte: Math.max(lo, hi) };
}

// ── 문자 정규화 ──────────────────────────────────────────────────────────────
// NFKC(전각·단위스퀘어 ㎌→μF 등) → 천단위 콤마 제거 → µ(U+00B5)/μ(U+03BC)→u,
// Ω(U+03A9·U+2126은 NFKC 가 U+03A9 로)·ω·'옴'→ohm → 공백 제거.
// 대소문자는 보존한다 — m(밀리)/M(메가) 구분에 필요. 매칭은 /i 정규식 +
// 캡처 문자열의 케이스 검사로 수행한다.
const THOUSANDS = /(?<=\d),(?=\d{3}\b)/g;

function compact(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(THOUSANDS, '')
    .replace(/[µμ]/g, 'u')
    .replace(/[Ωω]/g, 'ohm')
    .replace(/옴/g, 'ohm')
    .replace(/\s+/g, '');
}

// ── 해석 규칙 ────────────────────────────────────────────────────────────────
const EIA_TOLERANCE_LETTERS: Record<string, number> = {
  b: 0.1,
  c: 0.25,
  d: 0.5,
  f: 1,
  g: 2,
  j: 5,
  k: 10,
  m: 20,
};

const CAP_PREFIX: Record<string, number> = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3 };
const IND_PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3 };

interface Interp {
  kind: SpecKind;
  si: number;
  confidence: SpecConfidence;
  tolerancePct?: number;
}

function interp(kind: SpecKind, si: number, confidence: SpecConfidence, tolerancePct?: number): Interp {
  const base: Interp = { kind, si: roundSig(si), confidence };
  return tolerancePct === undefined ? base : { ...base, tolerancePct };
}

/** 소수 표기 조립: ("4","7")→4.7, ("66","5")→66.5, ("4",undefined)→4 */
function joinDecimal(intPart: string, fracPart: string | undefined): number {
  return Number(fracPart === undefined || fracPart === '' ? intPart : `${intPart}.${fracPart}`);
}

/** 단일 토큰 → 스펙 해석 후보들. 스펙으로 안 읽히면 빈 배열. */
export function parseSpecToken(raw: string): SpecInterpretation[] {
  const t = compact(raw);
  if (t === '' || t.length > 24) return [];
  const out: Interp[] = [];
  const num = String.raw`\d+(?:\.\d+)?`;

  let m: RegExpExecArray | null;

  // 명시적 저항: 470ohm · 4.7kohm · 5mΩ(밀리) · 4.7MΩ(메가)
  m = new RegExp(`^(${num})(k|m|meg|g)?ohms?$`, 'i').exec(t);
  if (m !== null) {
    const v = Number(m[1]);
    const p = m[2] ?? '';
    if (p === '') out.push(interp('resistance', v, 'high'));
    else if (/^k$/i.test(p)) out.push(interp('resistance', v * 1e3, 'high'));
    else if (/^g$/i.test(p)) out.push(interp('resistance', v * 1e9, 'high'));
    else if (/^meg$/i.test(p)) out.push(interp('resistance', v * 1e6, 'high'));
    else if (p === 'M') {
      out.push(interp('resistance', v * 1e6, 'high'), interp('resistance', v * 1e-3, 'low'));
    } else {
      // 소문자 m + 명시적 ohm → 밀리 우선, 메가 동반
      out.push(interp('resistance', v * 1e-3, 'high'), interp('resistance', v * 1e6, 'low'));
    }
  }

  // R 표기: 4R7=4.7Ω · 66R5=66.5Ω · 100R=100Ω · R47=0.47Ω
  m = /^(\d+)r(\d+)?$/i.exec(t);
  if (m?.[1] !== undefined) out.push(interp('resistance', joinDecimal(m[1], m[2]), 'high'));
  m = /^r(\d+)$/i.exec(t);
  if (m?.[1] !== undefined) out.push(interp('resistance', Number(`0.${m[1]}`), 'high'));

  // 문자-소수점 표기(저항): 4k7=4.7k · 1M5=1.5M — m 케이스: M=high, m=low(메가 관례)
  m = /^(\d+)(k|m|meg|g)(\d+)$/i.exec(t);
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    const v = joinDecimal(m[1], m[3]);
    const p = m[2];
    if (/^k$/i.test(p)) out.push(interp('resistance', v * 1e3, 'high'));
    else if (/^g$/i.test(p)) out.push(interp('resistance', v * 1e9, 'high'));
    else if (/^meg$/i.test(p)) out.push(interp('resistance', v * 1e6, 'high'));
    else out.push(interp('resistance', v * 1e6, p === 'M' ? 'high' : 'low'));
  }

  // 문자-소수점 표기(용량·인덕턴스): 2p2 · 4u7 · 2n2f · 1m5h
  m = /^(\d+)(p|n|u|m)(\d+)(f|h)?$/i.exec(t);
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    const v = joinDecimal(m[1], m[3]);
    const p = m[2].toLowerCase();
    const suffix = (m[4] ?? '').toLowerCase();
    const capMult = CAP_PREFIX[p];
    const indMult = IND_PREFIX[p];
    if (suffix === 'f' && capMult !== undefined) out.push(interp('capacitance', v * capMult, 'high'));
    else if (suffix === 'h' && indMult !== undefined) out.push(interp('inductance', v * indMult, 'high'));
    else {
      if (capMult !== undefined) out.push(interp('capacitance', v * capMult, 'high'));
      if (indMult !== undefined) out.push(interp('inductance', v * indMult, 'low'));
    }
  }

  // 명시적 용량: 2.2pF · 0.1uF · 2200fF · 2.2F
  m = new RegExp(`^(${num})(f|p|n|u|m)?f(arads?)?$`, 'i').exec(t);
  if (m?.[1] !== undefined) {
    const mult = m[2] === undefined ? 1 : CAP_PREFIX[m[2].toLowerCase()];
    if (mult !== undefined) out.push(interp('capacitance', Number(m[1]) * mult, 'high'));
  }

  // 무단위 p/n/u 관용(용량 우선, 인덕턴스 동반): 2200p · 100n · 4.7u · 2p
  m = new RegExp(`^(${num})(p|n|u)$`, 'i').exec(t);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    const p = m[2].toLowerCase();
    const capMult = CAP_PREFIX[p];
    const indMult = IND_PREFIX[p];
    if (capMult !== undefined) out.push(interp('capacitance', Number(m[1]) * capMult, 'high'));
    if (indMult !== undefined) out.push(interp('inductance', Number(m[1]) * indMult, 'low'));
  }

  // 명시적 인덕턴스: 10uH · 1mH
  m = new RegExp(`^(${num})(p|n|u|m)?h(enrys?)?$`, 'i').exec(t);
  if (m?.[1] !== undefined) {
    const mult = m[2] === undefined ? 1 : IND_PREFIX[m[2].toLowerCase()];
    if (mult !== undefined) out.push(interp('inductance', Number(m[1]) * mult, 'high'));
  }

  // 전압·전류·전력(분수 포함)·주파수
  m = new RegExp(`^(${num})(m|k)?v(ac|dc)?$`, 'i').exec(t);
  if (m?.[1] !== undefined) {
    const mult = m[2] === undefined ? 1 : /^k$/i.test(m[2]) ? 1e3 : 1e-3;
    out.push(interp('voltage', Number(m[1]) * mult, 'high'));
  }
  m = new RegExp(`^(${num})(m|u|n)?a(mps?)?$`, 'i').exec(t);
  if (m?.[1] !== undefined) {
    const p = (m[2] ?? '').toLowerCase();
    const mult = p === '' ? 1 : p === 'm' ? 1e-3 : p === 'u' ? 1e-6 : 1e-9;
    out.push(interp('current', Number(m[1]) * mult, 'high'));
  }
  m = /^(\d+)\/(\d+)w(atts?)?$/i.exec(t);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    out.push(interp('power', Number(m[1]) / Number(m[2]), 'high'));
  }
  m = new RegExp(`^(${num})(m|k)?w(atts?)?$`, 'i').exec(t);
  if (m?.[1] !== undefined) {
    const mult = m[2] === undefined ? 1 : /^k$/i.test(m[2]) ? 1e3 : 1e-3;
    out.push(interp('power', Number(m[1]) * mult, 'high'));
  }
  m = new RegExp(`^(${num})(k|m|g)?hz$`, 'i').exec(t);
  if (m?.[1] !== undefined) {
    const p = (m[2] ?? '').toLowerCase(); // 주파수엔 밀리가 없어 케이스 무관 메가
    const mult = p === '' ? 1 : p === 'k' ? 1e3 : p === 'm' ? 1e6 : 1e9;
    out.push(interp('frequency', Number(m[1]) * mult, 'high'));
  }

  // 톨러런스: ±5% · +/-1% · 5%
  m = new RegExp(`^(?:±|\\+/-|\\+-)?(${num})%$`).exec(t);
  if (m?.[1] !== undefined) out.push(interp('tolerance', Number(m[1]), 'high'));

  // 무접두 k/M/G 숫자: 4.7k(저항 high) · 16M(저항 high+주파수 low) · 4.7m(저항 low — 엔진 관례 메가)
  m = new RegExp(`^(${num})(k|m|g)$`, 'i').exec(t);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    const v = Number(m[1]);
    const p = m[2];
    if (/^k$/i.test(p)) {
      out.push(interp('resistance', v * 1e3, 'high'), interp('frequency', v * 1e3, 'low'));
    } else if (/^g$/i.test(p)) {
      out.push(interp('resistance', v * 1e9, 'high'), interp('frequency', v * 1e9, 'low'));
    } else if (p === 'M') {
      out.push(interp('resistance', v * 1e6, 'high'), interp('frequency', v * 1e6, 'low'));
    } else {
      out.push(
        interp('resistance', v * 1e6, 'low'),
        interp('inductance', v * 1e-3, 'low'),
        interp('capacitance', v * 1e-3, 'low'),
      );
    }
  }

  // EIA 코드 계열 — 선행 0(0402 등 패키지·코드 표기)은 값 해석에서 제외한다.
  const leadingZero = /^0\d/.test(t);
  if (!leadingZero) {
    // 3자리 코드 + 톨러런스 문자: 104K=100nF±10% (여기의 K/M 은 접두가 아니라 톨러런스)
    m = /^(\d{2})(\d)([bcdfgjkm])$/i.exec(t);
    if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      const pf = Number(m[1]) * 10 ** Number(m[2]);
      const tol = EIA_TOLERANCE_LETTERS[m[3].toLowerCase()];
      out.push(interp('capacitance', pf * 1e-12, 'high', tol));
    }
    // 3자리 코드: 472 → 4.7nF(캡 관례) · 4.7kΩ(SMD 저항 관례) — 모두 low
    m = /^(\d{2})(\d)$/.exec(t);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      const base = Number(m[1]);
      const exp = Number(m[2]);
      out.push(interp('capacitance', base * 10 ** exp * 1e-12, 'low'));
      out.push(interp('resistance', base * 10 ** exp, 'low'));
    }
    // 4자리 SMD 저항 코드: 4702=47kΩ — low
    m = /^(\d{3})(\d)$/.exec(t);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      out.push(interp('resistance', Number(m[1]) * 10 ** Number(m[2]), 'low'));
    }
    // 맨 숫자: 저항 Ω·용량 pF 관례 — 모두 low (MPN 매칭은 호출부가 항상 병행)
    m = new RegExp(`^(${num})$`).exec(t);
    if (m?.[1] !== undefined) {
      const v = Number(m[1]);
      out.push(interp('resistance', v, 'low'), interp('capacitance', v * 1e-12, 'low'));
    }
  }

  // 중복 제거: (kind, si) 동일 시 high 우선, tolerancePct 는 보존
  const byKey = new Map<string, Interp>();
  for (const it of out) {
    const key = `${it.kind}:${String(it.si)}`;
    const prev = byKey.get(key);
    if (prev === undefined || (prev.confidence === 'low' && it.confidence === 'high')) {
      byKey.set(key, prev?.tolerancePct !== undefined && it.tolerancePct === undefined
        ? { ...it, tolerancePct: prev.tolerancePct }
        : it);
    }
  }
  return [...byKey.values()];
}

// ── 패키지(칩 사이즈) 코드 ───────────────────────────────────────────────────
// bom-extraction-engine normalize_values._pkg_size_canon 이식.
// 무접두 4자리는 임페리얼 우선, 메트릭 전용 토큰만 임페리얼로 변환.
const METRIC_TO_IMPERIAL: Record<string, string> = {
  '1005': '0402',
  '1608': '0603',
  '2012': '0805',
  '2520': '1008',
  '3216': '1206',
  '3225': '1210',
  '1220': '0508',
  '4532': '1812',
  '5025': '2010',
  '6332': '2512',
};
const IMPERIAL_TO_METRIC: Record<string, string> = Object.fromEntries(
  Object.entries(METRIC_TO_IMPERIAL).map(([metric, imperial]) => [imperial, metric]),
);

function padSize(code: string): string {
  return code.length === 3 ? `0${code}` : code;
}

/** 사이즈 코드 표기 → 임페리얼 정준 코드 목록('C1005'→['0402'], '0603_1608Metric'→['0603'],
 * '0402(1005 미터법)'→['0402'] — Mouser 한국어 응답의 괄호 병기). 사이즈 표기가 아니면 null. */
export function normalizePackageCode(raw: string): string[] | null {
  let t = raw.normalize('NFKC').toUpperCase().trim();
  t = t.replace(/\(([^)]*)\)/g, '/$1'); // 괄호 병기 → 슬래시 병기로 환원("0402(1005)"→"0402/1005")
  t = t.replace(/(METRIC|미터법)/g, '').replace(/^[\s_/-]+|[\s_/-]+$/g, '').replace(/\s+/g, '');
  const m = /^C?(\d{3,4})(?:[/_-]?C?(\d{3,4}))?$/.exec(t);
  if (m === null) return null;
  const canon = new Set<string>();
  for (const g of [m[1], m[2]]) {
    if (g === undefined) continue;
    const padded = padSize(g);
    canon.add(METRIC_TO_IMPERIAL[padded] ?? padded);
  }
  return canon.size > 0 ? [...canon] : null;
}

/** 색인용 패키지 변형: 임페리얼 정준 코드 → [임페리얼, 메트릭] (알려진 코드만). */
export function packageVariants(imperial: string): string[] {
  const metric = IMPERIAL_TO_METRIC[imperial];
  return metric === undefined ? [imperial] : [imperial, metric];
}

// ── 색인용 변형 생성 (Track B: 관행 표기만, 소문자) ──────────────────────────
function fmt(n: number): string {
  return String(roundSig(n));
}

/** 한 자리 소수면 문자-소수점 표기(4.7,'k'→'4k7'), 아니면 null. */
function letterDecimal(v: number, letter: string): string | null {
  const r = roundSig(v);
  const s = fmt(r);
  const m = /^(\d+)\.(\d)$/.exec(s);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  return `${m[1]}${letter}${m[2]}`;
}

/** 유효 2자리 정수 코드(4700→'472', 100000pF→'104'), 아니면 null. */
function smdCode(units: number): string | null {
  if (!Number.isFinite(units) || units < 10) return null;
  const exp = Math.floor(Math.log10(units)) - 1;
  const base = units / 10 ** exp;
  if (Math.abs(base - Math.round(base)) > 1e-9) return null;
  const b = Math.round(base);
  if (b < 10 || b > 99 || exp < 0 || exp > 9) return null;
  return `${String(b)}${String(exp)}`;
}

/** SI 값 → 사람이 실제 치는 관행 표기들(소문자). specVariants 색인 전용. */
export function variantsFor(kind: SpecKind, siRaw: number): string[] {
  const si = roundSig(siRaw);
  const out = new Set<string>();
  const add = (s: string | null): void => {
    if (s !== null && s !== '') out.add(s.toLowerCase());
  };

  if (kind === 'resistance') {
    if (si >= 1e6) {
      const v = si / 1e6;
      add(`${fmt(v)}m`);
      add(`${fmt(v)}mohm`);
      add(letterDecimal(v, 'm'));
    } else if (si >= 1e3) {
      const v = si / 1e3;
      add(`${fmt(v)}k`);
      add(`${fmt(v)}kohm`);
      add(letterDecimal(v, 'k'));
      if (Number.isInteger(si)) add(fmt(si));
    } else if (si >= 1) {
      add(fmt(si));
      add(`${fmt(si)}ohm`);
      add(letterDecimal(si, 'r'));
    } else {
      add(fmt(si));
      add(`${fmt(si)}ohm`);
      const frac = /^0\.(\d+)$/.exec(fmt(si));
      if (frac?.[1] !== undefined) add(`r${frac[1]}`);
    }
    add(smdCode(si));
    return [...out];
  }

  if (kind === 'capacitance' || kind === 'inductance') {
    const unitChar = kind === 'capacitance' ? 'f' : 'h';
    const prefixes: [string, number][] = [
      ['p', 1e-12],
      ['n', 1e-9],
      ['u', 1e-6],
      ['m', 1e-3],
      ['', 1],
    ];
    // 1 ≤ v < 1000 이 되는 최적 접두 (비교 전 유효숫자 정준화 — 부동소수점 잔차 방지)
    let best: [string, number] = ['', 1]; // 폴백 = 기본단위

    for (const [p, mult] of prefixes) {
      const v = roundSig(si / mult);
      if (v >= 1 && v < 1000) {
        best = [p, mult];
        break;
      }
    }
    const [bp, bmult] = best;
    const bv = roundSig(si / bmult);
    add(`${fmt(bv)}${bp}${unitChar}`);
    add(letterDecimal(bv, bp === '' ? unitChar : bp));
    if (kind === 'capacitance') {
      add(`${fmt(bv)}${bp}`); // F 생략 관용(2.2n·2200p)
      // 인접 하위 단위(2.2nf→2200pf) — 정수화될 때만
      const idx = prefixes.findIndex(([p]) => p === bp);
      if (idx > 0) {
        const lower = prefixes[idx - 1];
        if (lower !== undefined) {
          const lv = roundSig(si / lower[1]);
          if (Number.isInteger(lv) && lv < 100000) {
            add(`${fmt(lv)}${lower[0]}f`);
            add(`${fmt(lv)}${lower[0]}`);
          }
        }
      }
      // 인접 상위 단위(100nf→0.1uf)
      const upper = prefixes[idx + 1];
      if (upper !== undefined && bv >= 100) add(`${fmt(si / upper[1])}${upper[0]}f`);
      add(smdCode(si / 1e-12)); // EIA pF 코드(222·104)
    }
    return [...out];
  }

  if (kind === 'voltage') {
    if (si >= 1e3) add(`${fmt(si / 1e3)}kv`);
    else if (si >= 1) add(`${fmt(si)}v`);
    else add(`${fmt(si * 1e3)}mv`);
    if (si < 1) add(`${fmt(si)}v`);
    return [...out];
  }
  if (kind === 'current') {
    if (si >= 1) add(`${fmt(si)}a`);
    else if (si >= 1e-3) add(`${fmt(si * 1e3)}ma`);
    else add(`${fmt(si * 1e6)}ua`);
    if (si < 1) add(`${fmt(si)}a`);
    return [...out];
  }
  if (kind === 'power') {
    if (si >= 1) add(`${fmt(si)}w`);
    else {
      add(`${fmt(si)}w`);
      add(`${fmt(si * 1e3)}mw`);
      for (const den of [2, 4, 8, 16]) {
        if (Math.abs(si * den - Math.round(si * den)) < 1e-9 && Math.round(si * den) === 1) {
          add(`1/${String(den)}w`);
        }
      }
    }
    return [...out];
  }
  if (kind === 'frequency') {
    if (si >= 1e9) add(`${fmt(si / 1e9)}ghz`);
    else if (si >= 1e6) add(`${fmt(si / 1e6)}mhz`);
    else if (si >= 1e3) add(`${fmt(si / 1e3)}khz`);
    else add(`${fmt(si)}hz`);
    return [...out];
  }
  // tolerance
  add(`${fmt(si)}%`);
  return [...out];
}

// ── 검색 쿼리 토큰화 ─────────────────────────────────────────────────────────
export interface ParsedQuery {
  /** 전체 토큰의 스펙 해석 합집합(중복 제거). */
  specs: SpecInterpretation[];
  /** 패키지 코드로 읽힌 토큰의 임페리얼 정준 코드들. */
  packageCodes: string[];
  /** 원문 토큰 전부 — MPN·설명 매칭은 항상 병행한다(해석은 should 전용 원칙). */
  texts: string[];
}

const UNIT_ONLY = /^(f|p|n|u|m|k|g|meg)?(ohms?|f(arads?)?|h(enrys?)?|v(ac|dc)?|a(mps?)?|w(atts?)?|hz|%)$/i;

/** 검색창 자유 텍스트 → 스펙/패키지/텍스트 3뷰. "2.2 pF"처럼 단위가 띄어진 쌍은 결합 시도. */
export function parseQuery(q: string): ParsedQuery {
  const rawTokens = q.split(/\s+/).filter((s) => s !== '');
  const specs: SpecInterpretation[] = [];
  const packageCodes = new Set<string>();
  const texts: string[] = [];

  let i = 0;
  while (i < rawTokens.length) {
    const tok = rawTokens[i];
    if (tok === undefined) break;
    const next = rawTokens[i + 1];
    // "2.2 pF" → "2.2pF" 결합: 숫자 토큰 + 단위 토큰
    if (next !== undefined && /^[\d.,]+$/.test(tok) && UNIT_ONLY.test(compact(next))) {
      const joined = parseSpecToken(tok + next);
      if (joined.some((s) => s.confidence === 'high')) {
        specs.push(...joined);
        texts.push(tok + next);
        i += 2;
        continue;
      }
    }
    const pkg = normalizePackageCode(tok);
    if (pkg !== null) for (const c of pkg) packageCodes.add(c);
    specs.push(...parseSpecToken(tok));
    texts.push(tok);
    i += 1;
  }

  // 전역 중복 제거(kind+si, high 우선)
  const byKey = new Map<string, SpecInterpretation>();
  for (const s of specs) {
    const key = `${s.kind}:${String(s.si)}`;
    const prev = byKey.get(key);
    if (prev === undefined || (prev.confidence === 'low' && s.confidence === 'high')) byKey.set(key, s);
  }
  return { specs: [...byKey.values()], packageCodes: [...packageCodes], texts };
}

/** MPN 정규화: 대문자 + 영숫자만 — DB mpnNorm·ES 키와 동일 규칙. */
export function normalizeMpn(raw: string): string {
  return raw.normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** 제조사 정규화(별칭 해소 전 단계): 소문자 + 영숫자만. */
export function normalizeManufacturer(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/[^0-9a-z]/g, '');
}
