import { formatBytes, formatDateTime, formatKrw } from '@/lib/format';

// SMT 화면의 표시 포맷 — 금액·시각·크기. 원화와 시각은 관리자 공용 포맷터(@/lib/format)를 그대로 쓴다.
//
// 금액의 약속(docs/SMARTSMT_INTEGRATION.md §2 "금액을 읽는 법"): **null = 미정, 0 = 0원**. 둘을 섞지 않는다.
// 최종 금액은 통합 합계(finalTotal)이고 smtTotal 은 SMT 작업비만이다 — 이름을 바꿔 부르지 않는다.

const FOREIGN = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

/** 금액 한 칸 — null 이면 '미정', 원화는 '1,234원', 그 밖의 통화는 '1,234.5 USD'. 통화를 모르면 숫자만. */
export const smtAmount = (value: number | null, currency?: string | null): string => {
  if (value === null) return '미정';
  if (currency === 'KRW') return formatKrw(value);
  if (currency === undefined || currency === null || currency === '') return FOREIGN.format(value);
  return `${FOREIGN.format(value)} ${currency}`;
};

/**
 * 확정 금액이 미정인데 추정 금액이 있으면 '추정 1,234원' — 확정처럼 읽히지 않게 이름을 앞에 붙인다.
 * 추정은 SmartSMT 가 고객 화면에 가견적으로 보이는 값(estimated_total)이다.
 */
export const smtEstimate = (estimated: number | null, currency?: string | null): string | null =>
  estimated === null ? null : `추정 ${smtAmount(estimated, currency)}`;

/** 수량·개수 — null 이면 '—'(금액이 아니므로 '미정'이라 하지 않는다). */
export const smtCount = (value: number | null): string => (value === null ? '—' : FOREIGN.format(value));

/** 시각(KST, YYYY-MM-DD HH:mm). 비었거나 날짜로 읽히지 않는 글자는 받은 그대로 둔다 — 견적서의 시각은 바깥 값이다. */
export const smtDateTime = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  return Number.isNaN(new Date(value).getTime()) ? value : formatDateTime(value);
};

/** 파일·요청 크기 — null 이면 '—'. */
export const smtBytes = (value: number | null): string => (value === null ? '—' : formatBytes(value));
