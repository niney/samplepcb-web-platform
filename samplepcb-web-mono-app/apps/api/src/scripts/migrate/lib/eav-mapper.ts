// 레거시 g5_shop_item EAV(it_N_subj=키, it_N=값) → 신규 spec_json 변환(순수).
//
// 원칙(운영 전수 리포트 .tmp/legacy-gerber-db-report.md 실측 근거):
// - **슬롯 번호가 아닌 subj 문자열 기준** — 같은 슬롯이 세대별로 다른 의미(it_17: FR4Tg→kindpcb 등).
// - 1세대(2020.01 이전) PascalCase/snake_case 키는 별칭 정규화(약 1,476건).
// - 값은 자유 텍스트가 실재하므로 **string 유지**(pcbThickness "0.1 (3M tape…)" 등).
// - 산출물 키(totalPrice/ship_price/production_price)·폐기 키(apiCompany/견적상태)는 버린다
//   (가격의 진실은 금액 변환 모듈이 cart 라인에서 취한다).
// - 미지 subj 는 spec 을 오염시키지 않고 rawUnknown 으로 격리(_legacy.rawSpec 보존 + 리포트).
// 현행 정본 키 목록은 extract-legacy-gerber-samples.ts DOCUMENTED_SUBJ_KEYS 와 정합.
import { asInt, asStr } from './util';

const MAX_SLOT = 50;

/** 신규 spec 정본 키(계약 PcbProjectPayload spec 39종 + 하위호환 보존 키). */
const CANONICAL_KEYS: readonly string[] = [
  'length',
  'width',
  'layers',
  'pcbThickness',
  'material',
  'panel',
  'minTraceSpacing',
  'minHole',
  'solderMask',
  'silkscreen',
  'surfaceFinish',
  'viaProcess',
  'copperWeights',
  'kindPcb',
  'goldFingers',
  'finishedCopperAdvance',
  'differentDesign',
  'impedance',
  'etest',
  'halfHole',
  'stiffener',
  'tape3m',
  'emiFilm',
  'flayer',
  'fThickness',
  'fCopperThickness',
  'fColor',
  'fSilkcolor',
  'framework',
  'stencilSide',
  'stThickness',
  'fiducial',
  'electroPolish',
  'metalCore',
  'edgeRail',
  'placeOfOrigin',
  'coordinate',
  'size',
  'cutting',
  'mqty',
  'gusset',
  'fr4Tg', // 신규 폼엔 없지만 1세대 데이터 보존용(FR4Tg)
];

/** 특수 취급(spec 본문이 아니라 별도 필드로 추출). */
const EXTRACT_KEYS = new Set(['menu', 'status', 'orderCategory', 'qty', 'filePath', 'eta']);

/** 폐기(산출물/무의미) — 값 자체를 버린다. 견적가의 진실은 cart 라인 금액. */
const DROP_KEYS = new Set([
  'apiCompany',
  'totalPrice',
  'production_price',
  'ship_price',
  '견적상태',
]);

/** 1세대·오탈자 별칭 → 정본 키(또는 추출 키). 대소문자 정확 일치 우선, 실패 시 소문자 재조회. */
const ALIASES: Record<string, string> = {
  file_path: 'filePath',
  ApiCompany: 'apiCompany',
  total_price: 'totalPrice',
  diffDesign: 'differentDesign',
  diff_design: 'differentDesign',
  impedence: 'impedance',
  Impedence: 'impedance',
  mixTrace: 'minTraceSpacing',
  MinTrackSpacing: 'minTraceSpacing',
  MinHoleSize: 'minHole',
  Thickness: 'pcbThickness',
  FinishedCopper: 'copperWeights',
  FR4Tg: 'fr4Tg',
  DesignInPanel: 'panel',
  DesigninPanel: 'panel',
  Menu: 'menu',
  kindpcb: 'kindPcb',
  goldfingers: 'goldFingers',
  Goldfingers: 'goldFingers',
  st_direction: 'stencilSide',
  stDirection: 'stencilSide',
  st_thickness: 'stThickness',
  '3mtape': 'tape3m',
  emifilm: 'emiFilm',
  frame: 'framework',
  electrop: 'electroPolish',
  edgerail: 'edgeRail',
  sizeExtra: 'size',
  category: 'orderCategory', // it_50 구표기 — 실데이터 정본은 orderCategory
};

const CANONICAL_BY_LOWER = new Map<string, string>(CANONICAL_KEYS.map((k) => [k.toLowerCase(), k]));
const EXTRACT_BY_LOWER = new Map<string, string>([...EXTRACT_KEYS].map((k) => [k.toLowerCase(), k]));

/** subj 1개를 정본 키로 해석. null = 미지(rawUnknown 행). */
export function resolveSubjKey(subjRaw: string): { key: string; kind: 'spec' | 'extract' | 'drop' } | null {
  const subj = subjRaw.trim();
  if (subj === '') return null;
  const aliased = ALIASES[subj] ?? ALIASES[subj.toLowerCase()] ?? subj;
  if (DROP_KEYS.has(aliased)) return { key: aliased, kind: 'drop' };
  if (EXTRACT_KEYS.has(aliased)) return { key: aliased, kind: 'extract' };
  if (CANONICAL_KEYS.includes(aliased)) return { key: aliased, kind: 'spec' };
  const lower = aliased.toLowerCase();
  const extract = EXTRACT_BY_LOWER.get(lower);
  if (extract !== undefined) return { key: extract, kind: 'extract' };
  const canonical = CANONICAL_BY_LOWER.get(lower);
  if (canonical !== undefined) return { key: canonical, kind: 'spec' };
  if (DROP_KEYS.has(lower)) return { key: lower, kind: 'drop' };
  return null;
}

/** menu(it_22) 오염 25종 정규화 — 실패 시 it_name 접두(예: "standard_1608…")로 폴백. */
export function normalizeMenu(rawMenu: string, itName: string): { category: string; known: boolean } {
  const tryOne = (value: string): string | null => {
    const v = value.trim().toLowerCase();
    if (v === '') return null;
    if (v.includes('flex') || v === 'fpcb' || v.includes('rigid')) return 'flexible';
    if (v.includes('mask') || v.includes('국내') || v === 'metal mask') return 'metalMask';
    if (v.startsWith('stand') || v.startsWith('standad')) return 'standard';
    if (v.startsWith('adv')) return 'advance';
    return null;
  };
  const fromMenu = tryOne(rawMenu);
  if (fromMenu !== null) return { category: fromMenu, known: true };
  const prefix = itName.split('_')[0] ?? '';
  const fromName = tryOne(prefix);
  if (fromName !== null) return { category: fromName, known: true };
  const raw = rawMenu.trim();
  return { category: raw === '' ? 'unknown' : raw, known: false };
}

export interface MappedLineSpec {
  spec: Record<string, string>;
  rawUnknown: Record<string, string>; // 미지 subj (있는 그대로 — _legacy.rawSpec 보존)
  category: string;
  categoryKnown: boolean;
  orderCategory: 'sample' | 'mass';
  orderCategoryExplicit: boolean; // it_50 실값 존재 여부(빈값은 도입 이전 데이터 → 기본 sample)
  qty: number;
  filePath: string;
  eta: string;
  flow: string; // it_23 status (order|rfq …) — 참고용(_legacy)
}

/** 레거시 상품 행(SELECT * — it_N/it_N_subj 포함)을 신규 spec 으로 변환. */
export function mapGerberItem(item: Record<string, unknown>): MappedLineSpec {
  const spec: Record<string, string> = {};
  const rawUnknown: Record<string, string> = {};
  const extracted: Record<string, string> = {};

  for (let slot = 1; slot <= MAX_SLOT; slot += 1) {
    const subjRaw = item[`it_${String(slot)}_subj`];
    if (subjRaw === undefined || subjRaw === null) continue; // 2020 덤프처럼 슬롯 컬럼 자체가 없는 스키마
    const subj = asStr(subjRaw).trim();
    if (subj === '') continue;
    const value = asStr(item[`it_${String(slot)}`]).trim();
    const resolved = resolveSubjKey(subj);
    if (resolved === null) {
      if (value !== '') rawUnknown[subj] = value;
      continue;
    }
    if (resolved.kind === 'drop') continue;
    if (value === '') continue;
    if (resolved.kind === 'extract') {
      extracted[resolved.key] = value;
      continue;
    }
    spec[resolved.key] = value;
  }

  const itName = asStr(item.it_name);
  const { category, known } = normalizeMenu(extracted.menu ?? '', itName);

  const ocRaw = (extracted.orderCategory ?? '').toLowerCase();
  const orderCategoryExplicit = ocRaw === 'sample' || ocRaw === 'mass';
  const orderCategory: 'sample' | 'mass' = ocRaw === 'mass' ? 'mass' : 'sample';

  const qtyFromSpec = asInt(extracted.qty ?? '');
  const qty = qtyFromSpec > 0 ? qtyFromSpec : Math.max(1, asInt(item.it_stock_qty));
  spec.qty = String(qty); // 신규 담기 spec 에도 qty 가 들어간다(요약·재현 편의)

  return {
    spec,
    rawUnknown,
    category,
    categoryKnown: known,
    orderCategory,
    orderCategoryExplicit,
    qty,
    filePath: extracted.filePath ?? '',
    eta: extracted.eta ?? '',
    flow: extracted.status ?? '',
  };
}
