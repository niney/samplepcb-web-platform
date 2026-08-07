export interface VatIncludedAmounts {
  supply: number;
  vat: number;
  total: number;
}

/**
 * 부가세 포함 총액을 영카트와 같은 방식으로 공급가액과 부가세로 역산한다.
 *
 * 총액은 견적·주문 계약에서 검증된 0 이상의 원화 정수라는 전제다. 부가세를 잔액으로
 * 계산해 공급가액 + 부가세가 항상 입력 총액과 정확히 일치하도록 한다.
 */
export function splitVatIncluded(total: number): VatIncludedAmounts {
  const supply = Math.round(total / 1.1);
  return { supply, vat: total - supply, total };
}
