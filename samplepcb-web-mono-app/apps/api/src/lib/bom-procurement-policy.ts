import { createHash } from 'node:crypto';
import type { BomQuoteExchangeRateSnapshotType } from '@sp/api-contract';
import {
  BOM_AUTOMATIC_SURPLUS_QUANTITY,
  BOM_AUTOMATIC_SURPLUS_RATIO,
} from '@sp/utils';

export interface EngineProcurementPolicy {
  procurement_policy_version: 'supplier-procurement-decision-v1';
  target_currency: 'KRW';
  currency_rates: { source_currency: 'USD'; target_currency: 'KRW'; rate: number }[];
  currency_rate_snapshot_id: string;
  currency_rate_as_of: string;
  currency_rate_source: string;
  allowed_suppliers: ['digikey', 'mouser', 'unikeyic'];
  allow_stock_shortage: false;
  allow_unverified_stock: false;
  excessive_surplus_quantity: 100;
  excessive_surplus_ratio: number;
}

/**
 * sp-node가 소유한 환율 스냅샷을 엔진의 결정론적 조달 정책 입력으로 투영한다.
 * 가격·재고·MOQ 순위는 이 입력을 받은 sp-engine만 판단한다.
 */
export function buildEngineProcurementPolicy(
  usdKrwRate: number | null,
  snapshot: BomQuoteExchangeRateSnapshotType | null,
  now = new Date(),
): EngineProcurementPolicy {
  const asOf = snapshot?.fetchedAt
    ?? (snapshot?.rateDate === null || snapshot?.rateDate === undefined
      ? now.toISOString()
      : `${snapshot.rateDate}T00:00:00+09:00`);
  const snapshotPayload = JSON.stringify({ asOf, snapshot, usdKrwRate });
  const snapshotId = createHash('sha256').update(snapshotPayload).digest('hex').slice(0, 24);
  return {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    target_currency: 'KRW',
    currency_rates: usdKrwRate === null
      ? []
      : [{ source_currency: 'USD', target_currency: 'KRW', rate: usdKrwRate }],
    currency_rate_snapshot_id: `sp-node:${snapshotId}`,
    currency_rate_as_of: asOf,
    currency_rate_source: `sp-node:${snapshot?.source ?? 'same-currency-only'}`,
    allowed_suppliers: ['digikey', 'mouser', 'unikeyic'],
    allow_stock_shortage: false,
    allow_unverified_stock: false,
    excessive_surplus_quantity: BOM_AUTOMATIC_SURPLUS_QUANTITY,
    excessive_surplus_ratio: BOM_AUTOMATIC_SURPLUS_RATIO,
  };
}
