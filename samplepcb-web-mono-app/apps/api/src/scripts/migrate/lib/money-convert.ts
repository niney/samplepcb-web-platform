// 금액 변환(순수) — 계획 §금액 변환(치명 #1).
//
// 레거시: 라인가(ct_price)는 **공급가**이고, 미수금 산식에 `(int)(cart_price*0.1)` VAT 별도항이
// 붙는다(레거시 lib/shop.lib.php:1739-1743 — 코어 커스텀). 신규 computeOrderMoney(g5-db.ts)는
// 라인가를 **부가세 포함**으로 전제한다(과세 분해는 ÷1.1 역산).
// 그대로 옮기면 신규 admin 의 모든 전이/취소 재계산에서 od_misu 가 -0.1×cart 로 왜곡된다.
//
// 변환 규칙: 상태 그룹(활성/취소류)별로
//   vatTotal = floor(Σsupply × 0.1)   ← 레거시 (int) 캐스트 = trunc 와 동일
//   라인별 vat_i = floor(supply_i×0.1) 선배분 후, 잔여를 소수부(supply_i×0.1) 큰 순으로 +1
//   incl_i = supply_i + vat_i  →  Σincl_i == Σsupply + vatTotal  (그룹 불변식)
// 활성 그룹 불변식이 곧 "변환 후 misu == 레거시 misu"를 보장한다(od_receipt_price 보존 전제).
export interface LineMoneyInput {
  key: string; // 레거시 ct_id (문자열)
  supply: number; // 레거시 라인 공급가 = (ct_price + io_price) × ct_qty
  cancelled: boolean; // 취소/반품/품절 라인 여부(정규화 후)
}

export interface OrderMoneyConversion {
  /** 레거시 ct_id → 부가세 포함 라인 금액(신규 io_price 로 들어갈 값) */
  inclByKey: Record<string, number>;
  activeSupply: number;
  activeIncl: number; // = od_cart_price(신규 헤더)
  cancelIncl: number; // = od_cancel_price(신규 헤더, 취소 라인 존재 시)
  activeVat: number;
  cancelVat: number;
}

/** 한 그룹(공급가 배열)에 VAT 를 최대잔여법으로 배분해 부가세 포함가 배열을 만든다. */
export function allocateVatIncl(supplies: readonly number[]): number[] {
  const total = supplies.reduce((a, b) => a + b, 0);
  const vatTotal = Math.floor(total * 0.1);
  const base = supplies.map((s) => Math.floor(s * 0.1));
  let remainder = vatTotal - base.reduce((a, b) => a + b, 0);
  if (remainder > 0) {
    // 소수부 큰 순(동률이면 앞 라인 우선)으로 +1 — 결정적 분배
    const order = supplies
      .map((s, i) => ({ i, frac: s * 0.1 - Math.floor(s * 0.1) }))
      .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
    for (const { i } of order) {
      if (remainder <= 0) break;
      const cur = base[i];
      if (cur !== undefined) {
        base[i] = cur + 1;
        remainder -= 1;
      }
    }
  }
  return supplies.map((s, i) => s + (base[i] ?? 0));
}

export function convertOrderLineMoney(lines: readonly LineMoneyInput[]): OrderMoneyConversion {
  const active = lines.filter((l) => !l.cancelled);
  const cancel = lines.filter((l) => l.cancelled);
  const activeIncls = allocateVatIncl(active.map((l) => l.supply));
  const cancelIncls = allocateVatIncl(cancel.map((l) => l.supply));

  const inclByKey: Record<string, number> = {};
  active.forEach((l, i) => {
    inclByKey[l.key] = activeIncls[i] ?? l.supply;
  });
  cancel.forEach((l, i) => {
    inclByKey[l.key] = cancelIncls[i] ?? l.supply;
  });

  const activeSupply = active.reduce((a, l) => a + l.supply, 0);
  const activeIncl = activeIncls.reduce((a, b) => a + b, 0);
  const cancelIncl = cancelIncls.reduce((a, b) => a + b, 0);
  return {
    inclByKey,
    activeSupply,
    activeIncl,
    cancelIncl,
    activeVat: activeIncl - activeSupply,
    cancelVat: cancelIncl - cancel.reduce((a, l) => a + l.supply, 0),
  };
}
