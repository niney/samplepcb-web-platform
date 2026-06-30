/** 값이 null/undefined 가 아님을 좁혀주는 타입 가드. */
export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/** 원화 금액을 천 단위 구분 + "원" 접미사 문자열로 포맷한다. (예: 1234567 → "1,234,567원") */
export function formatPrice(won: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(won)}원`;
}

/** 문자열을 URL 친화적인 소문자 하이픈 슬러그로 변환한다. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 배열에서 무작위 원소 하나를 반환한다. 빈 배열이면 undefined. */
export function pickRandom<T>(arr: readonly T[]): T | undefined {
  const index = Math.floor(Math.random() * arr.length);
  return arr[index];
}
