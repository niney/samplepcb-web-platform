import type { GerberPriceModeType } from '@sp/api-contract';

// 거버 가격 정규화 — 견적 엔진(engine.ts)이 낸 listPrice 를 하류(카트·주문·견적서)로
// 넘기기 전 부가세 처리. engine.ts 는 레거시 충실 이식(골든 고정)이라 손대지 않고,
// 그 결과를 이 순수함수가 후처리한다.
//   supply(공급가 입력) → round(listPrice × 1.1): 부가세 10% 를 얹어 "포함 총액" 으로.
//   order (주문가=포함, 기본) → 그대로.
//   rfq(null) → 가격이 없으므로 어느 모드든 불변.
// 코어 주문은 항상 포함 총액을 round(총액/1.1)로 역산하므로(orderformupdate.php:557),
// 이 정규화로 카트·주문·견적서·PG 전 구간의 부가세 정합이 맞는다. listPrice 는 견적가라
// 항상 양수 → Math.round 로 충분(견적서 admin-pcb-projects.ts:340 과 동일 반올림).
export function applyGerberPriceMode(
  listPrice: number | null,
  mode: GerberPriceModeType,
): number | null {
  if (listPrice === null) return null;
  return mode === 'supply' ? Math.round(listPrice * 1.1) : listPrice;
}
