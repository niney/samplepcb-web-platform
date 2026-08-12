const DAY_MS = 86_400_000;

export interface PcbDeliveryDateRange {
  from: Date;
  toExclusive: Date;
}

/**
 * 계약이 검증한 YYYY-MM-DD 양끝 포함 범위를 Prisma용 KST 시각 범위로 바꾼다.
 * 종료일 23:59:59.999 대신 다음 날 0시 미만을 써 DB 정밀도와 무관하게 하루 전체를 포함한다.
 */
export const resolvePcbDeliveryDateRange = (
  deliveryFrom: string | undefined,
  deliveryTo: string | undefined,
): PcbDeliveryDateRange | undefined => {
  if (deliveryFrom === undefined || deliveryTo === undefined) return undefined;
  const from = new Date(`${deliveryFrom}T00:00:00+09:00`);
  const to = new Date(`${deliveryTo}T00:00:00+09:00`);
  return { from, toExclusive: new Date(to.getTime() + DAY_MS) };
};
