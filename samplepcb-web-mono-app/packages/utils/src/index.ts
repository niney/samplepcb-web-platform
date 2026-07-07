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

/**
 * 이름 마스킹 — 첫 글자와 끝 글자만 남기고 '*' 처리한다.
 * (예: "박용한" → "박*한", "이수" → "이*", "김" → "김", "주식회사 테크노바" → "주*******바")
 * 재능마켓 공개 화면의 의뢰인 표시용 — 서버가 적용하고 원명은 응답에 싣지 않는다(이중 방어).
 */
export function maskName(name: string): string {
  // 그래픽 문자(grapheme) 단위 분해 — 서로게이트·결합 문자 안전(no-misused-spread 권장 방식).
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  const chars = Array.from(segmenter.segment(name.trim()), (s) => s.segment);
  const first = chars[0];
  if (first === undefined) return '';
  if (chars.length === 1) return first;
  const last = chars[chars.length - 1];
  if (chars.length === 2 || last === undefined) return `${first}*`;
  return `${first}${'*'.repeat(chars.length - 2)}${last}`;
}
