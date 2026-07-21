import { describe, expect, it } from 'vitest';
import { supplierSearchIngestFingerprint } from './parts-ingest';

function product(sku: string, stock: number): Record<string, unknown> {
  return {
    supplier: 'mouser',
    manufacturer_part_number: 'RC0603FR-0710KL',
    manufacturer: 'Yageo',
    normalized_specs: { resistance_ohm: 10_000 },
    offers: [{
      supplier: 'mouser',
      supplier_sku: sku,
      stock,
      fetched_at: '2026-07-21T00:00:00.000Z',
      price_breaks: [{ quantity: 1, unit_price: 0.01, currency: 'USD' }],
    }],
  };
}

function envelope(products: Record<string, unknown>[], decision = 'automatic'): unknown {
  return {
    search: {
      components: products.map((value) => ({
        procurement_decision: { recommendation: decision },
        candidates: [{ product: value }],
      })),
    },
  };
}

describe('supplierSearchIngestFingerprint', () => {
  it('후보 순서와 견적 판단 문맥이 달라도 같은 카탈로그 입력이면 동일하다', () => {
    const first = product('SKU-A', 100);
    const second = product('SKU-B', 200);
    expect(supplierSearchIngestFingerprint(envelope([first, second], 'automatic'))).toBe(
      supplierSearchIngestFingerprint(envelope([second, first], 'manual_review')),
    );
  });

  it('실제 공급사 재고가 달라지면 다른 실행으로 판정한다', () => {
    expect(supplierSearchIngestFingerprint(envelope([product('SKU-A', 100)]))).not.toBe(
      supplierSearchIngestFingerprint(envelope([product('SKU-A', 101)])),
    );
  });

  it('계약이 아닌 값은 fingerprint를 만들지 않는다', () => {
    expect(supplierSearchIngestFingerprint({ invalid: true })).toBeNull();
  });
});
