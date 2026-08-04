import { PCB_CURRENCY_SYMBOLS } from '@sp/api-contract';

// PCB 파트너 트랙 다중통화 표시(§7-5) — 외화 견적은 선정 전 KRW 가 null 이므로
// 표시는 항상 main(결제통화 원본) 기준, KRW 환산(krwAmount)은 병기다.
// 레거시 utils/currency.ts 의 mainMoneyText/subMoneySuffix 축약 이식.

const symbolOf = (currency: string): string =>
  (PCB_CURRENCY_SYMBOLS as Record<string, string>)[currency] ?? `${currency} `;

export const fmtPcbAmount = (currency: string, value: number | null): string => {
  if (value === null) return '—';
  const digits = currency === 'KRW' ? 0 : 2;
  return `${symbolOf(currency)}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
};

/** 결제통화 정본 + 입력 원본 병기 — "US$1,080.86 (¥7,200)". */
export const pcbMoneyWithSub = (
  currency: string,
  priceOriginal: number | null,
  subCurrency: string | null,
  subPriceOriginal: number | null,
): string => {
  if (priceOriginal === null) return '—';
  const main = fmtPcbAmount(currency, priceOriginal);
  return subCurrency !== null && subPriceOriginal !== null
    ? `${main} (${fmtPcbAmount(subCurrency, subPriceOriginal)})`
    : main;
};

/** 선정 후 KRW 환산 병기 — "≈ ₩1,560,000" (KRW 결제는 중복이라 생략). */
export const pcbKrwSuffix = (currency: string, krwAmount: number | null): string =>
  currency !== 'KRW' && krwAmount !== null ? ` ≈ ${fmtPcbAmount('KRW', krwAmount)}` : '';
