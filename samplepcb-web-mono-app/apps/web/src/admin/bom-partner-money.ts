import type {
  AdminBomRfqItemViewType,
  AdminBomRfqViewType,
  BomRfqChildSelectionType,
  BomRfqChildViewType,
  BomPartnerFxCurrencyType,
  BomPartnerFxRateType,
  BomPartnerFxRatesType,
} from '@sp/api-contract';
import { PCB_CURRENCY_SYMBOLS } from '@sp/api-contract';
import { effectiveRfqReplyQty } from '@sp/utils';
import { fmtPcbAmount } from '../lib/pcb-money';

// BOM 협력사 외화 표시(docs/SMARTBOM_PARTNER_RFQ.md "외화 회신").
// 협력사 금액의 정본은 결제통화고, 비교·합계는 견적에 굳힌 환율로 환산한 원화로 한다.
// 옛 관리자 화면과 새 화면(src/next)이 같은 규칙을 쓰도록 계산·문구를 여기 모은다.

export const isForeignCurrency = (currency: string): boolean => currency !== 'KRW';

/** 마스터딜러가 하위에 보낸 재요청의 회신 현황 — "회신 2/3곳". */
export const childReplyCountText = (children: readonly Pick<BomRfqChildViewType, 'status'>[]): string =>
  `회신 ${String(children.filter((child) => child.status === 'quoted').length)}/${String(children.length)}곳`;

/** 마스터딜러 회신 행의 근거 한 줄 — "하위 e2e부품 $0.03 × 1,400 + 8%". */
export const childSelectionText = (selection: BomRfqChildSelectionType): string =>
  `하위 ${selection.childPartnerName} ${partnerUnitPriceText(selection.sourceUnitPrice, selection.sourceCurrency)}${
    selection.sourceRate === 1 ? '' : ` × ${selection.sourceRate.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}`
  } + ${String(selection.marginRate)}%`;

const FX_CURRENCIES: readonly BomPartnerFxCurrencyType[] = ['USD', 'CNY'];

export const asFxCurrency = (currency: string): BomPartnerFxCurrencyType | null =>
  FX_CURRENCIES.find((code) => code === currency) ?? null;

/** 금액 — 원화 "12,250원", 외화 "$11.66". */
export const partnerAmountText = (amount: number | null, currency: string): string => {
  if (amount === null) return '—';
  return currency === 'KRW'
    ? `${Math.round(amount).toLocaleString('ko-KR')}원`
    : fmtPcbAmount(currency, amount);
};

/** 단가 — 부품 단가는 센트 아래가 흔해 4자리까지 적는다("$0.035"). */
export const partnerUnitPriceText = (price: number, currency: string): string => {
  if (currency === 'KRW') return `${price.toLocaleString('ko-KR')}원`;
  const symbol = (PCB_CURRENCY_SYMBOLS as Record<string, string>)[currency] ?? (currency + ' ');
  return symbol + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

type ReplyQty = Pick<AdminBomRfqItemViewType, 'replyQty' | 'moq'>;

/**
 * 회신 행합계(원화) — 실효 수량(회신수량 ?? 필요수량, MOQ 바닥) × 원화 환산 단가(§6.38).
 * 외화 회신인데 환율이 아직 없으면 null — 비교·선정에서 빠진다.
 */
export const rfqReplyLineTotalKrw = (
  orderQty: number,
  reply: ReplyQty & Pick<AdminBomRfqItemViewType, 'unitPriceKrw'>,
): number | null =>
  reply.unitPriceKrw === null
    ? null
    : Math.round(reply.unitPriceKrw * effectiveRfqReplyQty(orderQty, reply.replyQty, reply.moq));

/** 회신 행합계(결제통화) — 협력사가 실제로 받는 금액. */
export const rfqReplyLineTotalOriginal = (
  orderQty: number,
  reply: ReplyQty & Pick<AdminBomRfqItemViewType, 'unitPrice' | 'currency'>,
): number => {
  const amount = (reply.unitPrice ?? 0) * effectiveRfqReplyQty(orderQty, reply.replyQty, reply.moq);
  return reply.currency === 'KRW' ? Math.round(amount) : Math.round(amount * 100) / 100;
};

/** 회신 협력사들이 쓰는 외화 목록 — 환율 띠를 띄울지 가른다. */
export const foreignCurrenciesOf = (
  rfqs: readonly Pick<AdminBomRfqViewType, 'currency'>[],
): BomPartnerFxCurrencyType[] =>
  FX_CURRENCIES.filter((code) => rfqs.some((rfq) => rfq.currency === code));

const FX_SOURCE_LABELS: Record<BomPartnerFxRateType['source'], string> = {
  'quote-usd': '이 견적의 달러 환율',
  koreaexim: '수출입은행 고시',
  manual: '직접 입력',
};

/** "1,400원 · 수출입은행 고시 2026-10-08 · 여유 1% 포함" */
export const partnerFxText = (fx: BomPartnerFxRateType): string => {
  const parts = [
    `${fx.rate.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}원`,
    fx.rateDate === null ? FX_SOURCE_LABELS[fx.source] : `${FX_SOURCE_LABELS[fx.source]} ${fx.rateDate}`,
  ];
  if (fx.safetyMarginPercent > 0) parts.push(`여유 ${String(fx.safetyMarginPercent)}% 포함`);
  return parts.join(' · ');
};

export const partnerFxOf = (
  rates: BomPartnerFxRatesType | undefined,
  currency: string,
): BomPartnerFxRateType | null => {
  const code = asFxCurrency(currency);
  return code === null ? null : (rates?.[code] ?? null);
};
