// 레거시 가격 API body → 엔진 QuoteInput 어댑터.
// 거버 뷰어가 samplepcb_pricing_api.php 로 보내는 body(레거시 어휘)를 신규 정규화
// spec(camelCase)으로 변환한다. legacy-parity.test.ts 와 /api/pcb-pricing 라우트가
// 공유한다 — 매핑이 두 곳으로 갈라지면 파리티 테스트가 라우트를 보증하지 못한다.
import type { QuoteInput } from './engine';

// 신규 spec 은 camelCase 정규화 어휘를 쓴다. 레거시 가격 body 와의 별칭 목록:
const ALIAS: Record<string, string> = {
  mixTrace: 'minTraceSpacing',
  goldfingers: 'goldFingers',
  edgerail: 'edgeRail',
  frame: 'framework',
  // differentDesign 은 신규 정본과 동일명(통일 결정) — 매핑 불필요.
  // impedance 는 신규 spec 키도 impedance (가격표의 impedence 오탈자는 엔진 내부 매핑).
};

// 배송지 등 가격 계산과 무관한 메타 필드 + 최상위로 승격되는 필드
const META = new Set([
  'ShipType', 'Country', 'CountryCode', 'Postalcode', 'City', 'mm_comp', 'gb_type',
  'menu', 'category', 'qty',
]);

/** 레거시 body 를 QuoteInput 으로. now 는 eta 결정론이 필요한 테스트 주입용(기본 = 현재). */
export const legacyBodyToQuoteInput = (
  body: Record<string, unknown>,
  now?: Date,
): QuoteInput => {
  const spec: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(body)) {
    if (META.has(k)) continue;
    // 레거시 body 값은 전부 스칼라 — 객체/배열이 오면 버린다(PHP 캐스팅도 의미를 못 만든다).
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    spec[ALIAS[k] ?? k] = v;
  }
  const rawQty = body.qty;
  const qty =
    typeof rawQty === 'string' || typeof rawQty === 'number'
      ? parseInt(String(rawQty), 10)
      : NaN;
  return {
    category: typeof body.menu === 'string' ? body.menu : '',
    orderCategory: typeof body.category === 'string' ? body.category : 'sample',
    qty: Number.isNaN(qty) ? 0 : qty, // PHP (int) 캐스팅 동형
    spec,
    ...(now !== undefined ? { now } : {}),
  };
};
