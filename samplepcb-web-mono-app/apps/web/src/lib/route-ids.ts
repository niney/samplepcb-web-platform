// Prisma/MariaDB BigInt PK를 받는 SPA 상세 라우트의 공용 선검증.
// 잘못된 문자열이나 BIGINT 범위 밖 숫자를 API에 보내 400/500을 만든 뒤 "재시도"로
// 오안내하지 않도록, 화면에서 영구적인 잘못된 주소로 먼저 분류한다.
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function isPositiveBigIntId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  return BigInt(value) <= MAX_SIGNED_BIGINT;
}
