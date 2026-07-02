// 레거시 가격 엔진 이식 (samplepcb_php/lib/pcb_price*.lib.php → TS).
// 원본과의 계산 일치는 engine.test.ts 의 "PHP 골든 값"(레거시 코드를 직접 실행해 얻은
// 기대값)으로 검증한다. 동작이 이상해 보여도 레거시와 다르게 "고치지" 말 것 —
// 충실 이식이 원칙이고, 개선은 골든 테스트를 깨는 별도 결정으로 진행한다.
//
// 레거시와 의도적으로 다른 점(단순화):
// - 파트너 할인(setDiscountPartner): 그누보드 세션 의존 → 미이식 (추후 JWT 클레임 기반)
// - eta 공휴일: 공공데이터 API 의존 → 주말만 스킵 (TODO: 휴일 API)
import pricingDataJson from './pricing-data.json';

// ── 가격표(pricing_data.json — 레거시 원본 그대로) ─────────────────────────
interface RangeBracket {
  gt?: string;
  lt?: string;
  layers?: string;
  days?: string;
  marginRate?: string;
}
interface MenuPricing {
  name: string;
  rate: string;
  ttCostPercent: string;
  duty: string;
  setPrice: RangeBracket[];
  buildTime?: RangeBracket[];
  [option: string]: unknown;
}
interface PricingData {
  menus: MenuPricing[];
  transferCost: Record<string, string>;
  eta?: string;
}

const pricingData = pricingDataJson as unknown as PricingData;

// 가격표 버전 — 표를 갈아끼우면 올린다(sp_quote.priceVersion, 기존 견적 일괄 무효화 기준).
export const PRICE_VERSION = 'legacy-2026-07';

// ── 입출력 ──────────────────────────────────────────────────────────────────
// 입력은 신규 정규화 spec(camelCase). 레거시 가격표 키와의 매핑은 엔진 내부에서만.
export interface QuoteInput {
  category: string; // standard|metalMask|advance|flexible|…
  orderCategory: string; // sample|mass
  qty: number;
  spec: Record<string, string | number | undefined>;
  now?: Date; // eta 계산 기준일 (테스트 주입용, 기본 현재)
}

export interface QuoteResult {
  /** null = 자동견적 불가(rfq): 미지원 메뉴/양산/가격 0원 */
  listPrice: number | null;
  buildTimeDays: number;
  eta: string; // 'YYYY.MM.DD' 또는 ''
  weightKg: string; // 레거시 표기 그대로('' 가능)
  placeOfOrigin: string;
  priceVersion: string;
}

// ── 레거시 수치 헬퍼 (PHP 캐스팅 재현) ──────────────────────────────────────
const phpInt = (v: string | number | undefined): number => {
  if (typeof v === 'number') return Math.trunc(v);
  const n = parseInt(v ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

const str = (v: string | number | undefined): string =>
  v === undefined ? '' : String(v);

const findMenu = (name: string): MenuPricing | undefined =>
  pricingData.menus.find((m) => m.name.toLowerCase() === name.toLowerCase());

// 옵션 가격표 조회 — 표에 키/값이 없으면 0 (레거시 getPrice 동일)
const optionPrice = (menu: MenuPricing, table: string, value: string): number => {
  if (value === '') return 0;
  const t = menu[table];
  if (typeof t !== 'object' || t === null) return 0;
  const p = (t as Record<string, string>)[value];
  return p === undefined ? 0 : parseFloat(p);
};

// 범위 브래킷 매칭 (PHP 느슨한 비교 재현: gt 없으면 통과, lt 없으면 탈락)
const inRange = (b: RangeBracket, v: number): boolean => {
  const gtOk = b.gt === undefined ? true : parseFloat(b.gt) <= v;
  const ltOk = b.lt === undefined ? false : v <= parseFloat(b.lt);
  return gtOk && ltOk;
};

// ── eta: 제작일 + 배송 3일, 주말 스킵 ───────────────────────────────────────
export const calEta = (buildTimeDays: number, now: Date): string => {
  if (pricingData.eta !== undefined && pricingData.eta !== '') return pricingData.eta;
  const days = buildTimeDays + 3;
  const d = new Date(now);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay(); // 0=일, 6=토
    if (w !== 0 && w !== 6) added += 1;
  }
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear())}.${mm}.${dd}`;
};

// ── 해외운송비: 무게를 0.5 단위 버킷 문자열로 만들어 표 조회 (레거시 재현) ──
const transferCostByWeight = (weight: number): number => {
  const parts = String(weight).split('.');
  let ns = parseInt(parts[0] ?? '0', 10);
  let ne = 0;
  if (parts.length > 1) {
    const p = parseInt((parts[1] ?? '').slice(0, 1), 10) || 0;
    if (p >= 5) {
      ns += 1;
      ne = 0;
    } else {
      ne = 5;
    }
  }
  if (ns === 0) ne = 5;
  const key = `${String(ns)}.${String(ne)}`;
  const cost = pricingData.transferCost[key];
  return cost === undefined ? 0 : parseInt(cost, 10);
};

// ── Standard 계열 (PcbPriceLib.calculate 이식) ──────────────────────────────
const calcStandard = (input: QuoteInput, menu: MenuPricing): QuoteResult => {
  const spec = input.spec;
  const layers = phpInt(spec.layers);
  const width = phpInt(spec.width);
  const length = phpInt(spec.length);
  const panel = str(spec.panel);
  const edgerail = str(spec.edgeRail);

  // calQty: 패널(x*y)이면 수량 배수
  let qty = input.qty;
  if (panel !== '' && panel.toLowerCase() !== 'no') {
    const p = panel.split('x');
    if (p.length >= 2) qty = qty * phpInt(p[0]) * phpInt(p[1]);
  }

  // calUsdNetPrice: 면적식 원가
  const edgerailCost = edgerail !== '' && edgerail.toLowerCase() !== 'no' ? 5 : 0;
  let usdD1 = 37.5;
  let usdD2 = 10;
  if (layers === 2) [usdD1, usdD2] = [40.5, 10];
  if (layers === 4) [usdD1, usdD2] = [80, 30];
  if (layers === 6) [usdD1, usdD2] = [175, 40];
  let usd = (width * length * qty) / 1_000_000 * usdD1 + usdD2 + edgerailCost;

  // calOption: 신규 spec 키 → 레거시 가격표 키 매핑 조회
  const optionTables: [table: string, specKey: string][] = [
    ['surfaceFinish', 'surfaceFinish'],
    ['pcbThickness', 'pcbThickness'],
    ['copperWeights', 'copperWeights'],
    ['solderMask', 'solderMask'],
    ['goldfingers', 'goldFingers'],
    ['minTraceSpacing', 'minTraceSpacing'],
    ['minHole', 'minHole'],
    ['impedence', 'impedance'], // 가격표는 레거시 오탈자 키 유지
    ['halfHole', 'halfHole'],
    ['cutting', 'cutting'],
  ];
  if (layers >= 4) optionTables.push(['finishedCopperAdvance', 'finishedCopperAdvance']);
  let optionUsd = 0;
  for (const [table, specKey] of optionTables) {
    optionUsd += optionPrice(menu, table, str(spec[specKey]));
  }
  usd += optionUsd;

  // 해외운송비 + 무게
  const weight = (3.3 * width * length * qty) / 1_000_000;
  const weightKg = String(Math.round(weight * 100) / 100);
  const transferCost = transferCostByWeight(weight);

  // 제작일
  let buildTimeDays = 0;
  for (const b of menu.buildTime ?? []) {
    const wlq = width * length * qty;
    if (inRange(b, wlq) && phpInt(b.layers) === layers) buildTimeDays = phpInt(b.days);
  }

  // 환율/수수료/관세 → 총원가
  const rate = parseFloat(menu.rate);
  const importPrice = usd * rate;
  const ttCost = importPrice * (parseFloat(menu.ttCostPercent) / 100);
  const duty = parseFloat(menu.duty);
  const netTotal = importPrice + ttCost + duty + transferCost;

  // calMargin: 가격구간 브래킷 → 이윤 → 천원 올림
  let listPrice = 0;
  for (const b of menu.setPrice) {
    if (!inRange(b, netTotal)) continue;
    if (b.layers !== undefined && phpInt(b.layers) !== layers) continue;
    const marginRate = parseFloat(b.marginRate ?? '0');
    const profit = Math.trunc(netTotal * (marginRate / 100));
    listPrice = Math.trunc(netTotal + profit);
    if (String(listPrice).length > 3 && listPrice % 1000 > 0) {
      listPrice = listPrice - (listPrice % 1000) + 1000;
    }
  }

  // calDifferentDesign — ⚠ 레거시 버그 2건 충실 재현:
  //  ① diffDesign 이 비면 가격 전체가 0 (0원 → 주문버튼 숨김 → 견적요청 유도로 동작해 왔음)
  //  ② 개당 가산금을 가격표에 없는 'differentDesign' 키로 조회 → 항상 0원 (가산 미적용)
  //     (표의 실제 키는 'diffDesign' — 골든 c2/c3 로 확인된 동작)
  const applyDiffDesign = (total: number): number => {
    const diff = phpInt(spec.diffDesign);
    if (str(spec.diffDesign) === '' || diff === 0) return 0;
    if (diff > 1) {
      const per = optionPrice(menu, 'differentDesign', 'more1'); // 항상 0 (버그 ②)
      return total + per * (diff - 1);
    }
    return total;
  };
  listPrice = applyDiffDesign(listPrice);

  // 소형 고정가 override
  const fixed = ((): number | null => {
    if (width <= 100 && length <= 100) {
      if ((layers === 1 || layers === 2) && qty <= 5) return 35_000;
      if (layers === 2 && qty > 5 && qty <= 10) return 40_000;
      if (layers === 4 && qty <= 5) return 87_000;
    }
    return null;
  })();
  if (fixed !== null) {
    const cuttingUsd = optionPrice(menu, 'cutting', str(spec.cutting));
    listPrice = fixed + Math.round((optionUsd + edgerailCost - cuttingUsd) * rate);
    listPrice = applyDiffDesign(listPrice);
    listPrice = Math.ceil(listPrice / 1000) * 1000;
  }

  // 양산은 견적요청(가격 미표시)
  if (input.orderCategory === 'mass') listPrice = 0;

  return {
    listPrice: listPrice > 0 ? listPrice : null,
    buildTimeDays,
    eta: calEta(buildTimeDays, input.now ?? new Date()),
    weightKg,
    placeOfOrigin: '중국',
    priceVersion: PRICE_VERSION,
  };
};

// ── MetalMask 국내가 (PcbKoreaMetalPriceLib 이식) ──────────────────────────
const calcMetalMask = (input: QuoteInput): QuoteResult => {
  const spec = input.spec;
  const frame = str(spec.framework);
  const size = str(spec.size);
  const stencilSide = str(spec.stencilSide);

  let listPrice: number;
  if (frame === 'framework') {
    switch (size) {
      case '320x320':
      case '370x470':
      case '400x320':
      case '450x320':
      case '650x550':
        listPrice = 100_000;
        break;
      case '736x736':
        listPrice = 110_000;
        break;
      case '800x736':
        listPrice = 120_000;
        break;
      default:
        listPrice = 0; // 레거시: 미매칭 프레임 사이즈는 가격 없음
    }
  } else {
    listPrice = size === '300x400' || size === '370x470' ? 80_000 : 85_000;
  }
  if (stencilSide === 'Both Side') listPrice += 10_000;
  listPrice *= input.qty;

  const buildTimeDays = 1;
  return {
    listPrice: listPrice > 0 ? listPrice : null,
    buildTimeDays,
    eta: calEta(buildTimeDays, input.now ?? new Date()),
    weightKg: '',
    placeOfOrigin: '국내',
    priceVersion: PRICE_VERSION,
  };
};

// ── 진입점 ──────────────────────────────────────────────────────────────────
// 자동견적 지원: standard(가격표 Standard), metalMask(국내가).
// 그 외(advance/flexible/FPCB/Rigid…)는 레거시와 동일하게 rfq(null).
export const calculateQuote = (input: QuoteInput): QuoteResult => {
  const category = input.category.toLowerCase();
  if (category === 'metalmask') return calcMetalMask(input);
  const menu = findMenu('Standard');
  if (category === 'standard' && menu !== undefined) return calcStandard(input, menu);
  return {
    listPrice: null,
    buildTimeDays: 0,
    eta: '',
    weightKg: '',
    placeOfOrigin: '',
    priceVersion: PRICE_VERSION,
  };
};
