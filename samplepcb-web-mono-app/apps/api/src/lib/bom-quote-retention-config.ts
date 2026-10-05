import { BOM_CANCELED_QUOTE_RETENTION_DEFAULT_DAYS } from '@sp/api-contract';
import { prisma } from './prisma';

// 취소 견적 보존 기간 설정 — 취소 처리(bom-quote-cancel)·자동 정리(bom-quote-retention)·고객 응답
// (bom-quote 의 상세 DTO)이 함께 읽는다. 순환 import 를 피하려고 설정 읽기만 따로 둔다.

/** sp_config 키 — 값은 일수(정수). 0 = 자동 삭제하지 않음. 설정 UI 는 두지 않는다(발송 이력과 같은 관례). */
export const CANCELED_QUOTE_RETENTION_KEY = 'bom_canceled_quote_retention_days';

export function parseRetentionDays(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === '') {
    return BOM_CANCELED_QUOTE_RETENTION_DEFAULT_DAYS;
  }
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 ? days : BOM_CANCELED_QUOTE_RETENTION_DEFAULT_DAYS;
}

export async function getCanceledQuoteRetentionDays(): Promise<number> {
  const row = await prisma.spConfig.findUnique({ where: { key: CANCELED_QUOTE_RETENTION_KEY } });
  return parseRetentionDays(row?.value);
}
