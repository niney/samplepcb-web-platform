export const PARTNER_LOCALES = ['ko', 'en', 'zh-CN'] as const;
export type PartnerLocale = (typeof PARTNER_LOCALES)[number];
export type PartnerMessages = Readonly<Record<string, readonly [string, string, string]>>;
export type PartnerParams = Readonly<Record<string, string | number>>;
export const PARTNER_LOCALE_STORAGE_KEY = 'sp.partner.locale';

export const isPartnerLocale = (value: unknown): value is PartnerLocale =>
  value === 'ko' || value === 'en' || value === 'zh-CN';

export const interpolatePartnerMessage = (message: string, params: PartnerParams = {}): string =>
  message.replace(/\{(\w+)\}/g, (token: string, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : token,
  );

/** Source keys let shared components keep their original copy outside the portal.
 * Only UI strings explicitly passed by callers are translated; business data is never scanned.
 */
export function translatePartnerMessage(
  messages: PartnerMessages,
  source: string,
  locale: PartnerLocale,
  enabled: boolean,
  params?: PartnerParams,
): string {
  const entry = Object.hasOwn(messages, source) ? messages[source] : undefined;
  const index = locale === 'ko' ? 0 : locale === 'en' ? 1 : 2;
  return interpolatePartnerMessage(enabled ? (entry?.[index] ?? source) : source, params);
}

export const partnerIntlLocale = (locale: PartnerLocale): string =>
  locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'zh-CN';

/** Business dates stay on the existing Korean calendar; changing UI language must not
 * turn a promised delivery or remittance date into the previous day overseas.
 */
export function formatPartnerDate(value: string | null | undefined, locale: PartnerLocale): string {
  if (!value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+09:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(partnerIntlLocale(locale), {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** 시각까지 필요한 자리(EQ 회신 전달 등) — 날짜와 같은 한국 시각 규칙에 'KST' 를 붙인다.
 *  해외 공장이 자기 현지 시각으로 오독하지 않게 기준 시간대를 글자로 남긴다. */
export function formatPartnerDateTime(value: string | null | undefined, locale: PartnerLocale): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const text = new Intl.DateTimeFormat(partnerIntlLocale(locale), {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  return `${text} KST`;
}

export function formatPartnerMoney(value: number, currency: string, locale: PartnerLocale): string {
  // A locale changes presentation, never the currency or amount of a purchase order.
  if (locale === 'ko' && currency === 'KRW') {
    return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value)}원`;
  }
  if (!/^[A-Z]{3}$/.test(currency)) return `${new Intl.NumberFormat(partnerIntlLocale(locale)).format(value)} ${currency}`;
  return new Intl.NumberFormat(partnerIntlLocale(locale), {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: currency === 'KRW' ? 0 : 2,
    maximumFractionDigits: currency === 'KRW' ? 0 : 2,
  }).format(value);
}
