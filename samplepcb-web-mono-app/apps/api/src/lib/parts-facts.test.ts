import { describe, expect, it } from 'vitest';
import {
  deriveSamplepcbOffer,
  resolvePartFacts,
  type DeriveSource,
  type FactsSource,
} from './parts-facts';

// 부품 정본 해소·자체 오퍼 파생의 골든 명세 — 정책 변경 시 여기부터 갱신한다.

const T0 = new Date('2026-07-19T00:00:00Z');
const T1 = new Date('2026-07-19T01:00:00Z');
const T2 = new Date('2026-07-19T02:00:00Z');

function src(partial: Partial<FactsSource> & { supplier: string }): FactsSource {
  return {
    fetchedAt: T0,
    specs: {},
    description: null,
    category: null,
    packageCode: null,
    lifecycle: null,
    datasheetUrl: null,
    ...partial,
  };
}

describe('resolvePartFacts — 스펙 병합·충돌 해소', () => {
  it('union 보강: 서로 다른 필드는 합쳐진다', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'mouser', specs: { capacitance_f: 1e-7 } }),
      src({ supplier: 'digikey', specs: { voltage_v: 16 } }),
    ]);
    expect(facts.specsSi).toEqual({ capacitanceF: 1e-7, voltageV: 16 });
    expect(facts.specConflicts).toEqual({});
  });

  it('표기·정밀도 차이(상대 오차 이내)는 충돌이 아니다', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'mouser', specs: { capacitance_f: 1e-7 } }),
      src({ supplier: 'digikey', specs: { capacitance_f: 1.0000001e-7 } }),
    ]);
    expect(facts.specConflicts).toEqual({});
    expect(facts.specsSi.capacitanceF).toBeCloseTo(1e-7, 12);
  });

  it('진짜 충돌은 다수결로 채택하고 전체 그룹을 기록한다', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'mouser', specs: { voltage_v: 16 } }),
      src({ supplier: 'unikeyic', specs: { voltage_v: 16 } }),
      src({ supplier: 'digikey', specs: { voltage_v: 25 } }),
    ]);
    expect(facts.specsSi.voltageV).toBe(16);
    const groups = facts.specConflicts.voltage_v;
    expect(groups).toHaveLength(2);
    expect(groups?.[0]?.value).toBe(16); // 채택 그룹이 첫 번째
    expect(groups?.[0]?.suppliers).toEqual(['mouser', 'unikeyic']);
    expect(groups?.[1]?.value).toBe(25);
  });

  it('다수결 동률이면 공급사 신뢰 순위(digikey 우선)', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'mouser', specs: { voltage_v: 16 } }),
      src({ supplier: 'digikey', specs: { voltage_v: 25 } }),
    ]);
    expect(facts.specsSi.voltageV).toBe(25);
    expect(facts.specConflicts.voltage_v).toHaveLength(2);
  });

  it('미지 공급사보다 알려진 공급사가 우선', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'newvendor', specs: { voltage_v: 50 } }),
      src({ supplier: 'unikeyic', specs: { voltage_v: 35 } }),
    ]);
    expect(facts.specsSi.voltageV).toBe(35);
  });

  it('신뢰 순위까지 동률이면 최신 fetchedAt 승', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'vendorA', fetchedAt: T0, specs: { voltage_v: 10 } }),
      src({ supplier: 'vendorB', fetchedAt: T2, specs: { voltage_v: 20 } }),
    ]);
    expect(facts.specsSi.voltageV).toBe(20);
  });

  it('문자열 스펙: 대소문자·공백 차이는 충돌이 아니고, 실충돌은 기록', () => {
    const same = resolvePartFacts([
      src({ supplier: 'mouser', specs: { dielectric: 'X7R' } }),
      src({ supplier: 'digikey', specs: { dielectric: ' x7r ' } }),
    ]);
    expect(same.specConflicts).toEqual({});

    const diff = resolvePartFacts([
      src({ supplier: 'mouser', specs: { dielectric: 'X7R' } }),
      src({ supplier: 'digikey', specs: { dielectric: 'X5R' } }),
    ]);
    expect(diff.specsJson.dielectric).toBe('X5R'); // 동률 → digikey
    expect(diff.specConflicts.dielectric).toHaveLength(2);
  });

  it('스칼라(설명 등): 빈 값은 건너뛰고 신뢰 순위→최신', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'unikeyic', fetchedAt: T2, description: 'from unikeyic' }),
      src({ supplier: 'mouser', fetchedAt: T0, description: '  ' }),
      src({ supplier: 'digikey', fetchedAt: T1, description: 'from digikey' }),
    ]);
    expect(facts.description).toBe('from digikey');
  });

  it('samplepcb 파생 오퍼는 입력에서 무시된다', () => {
    const facts = resolvePartFacts([
      src({ supplier: 'samplepcb', specs: { voltage_v: 99 } }),
      src({ supplier: 'mouser', specs: { voltage_v: 16 } }),
    ]);
    expect(facts.specsSi.voltageV).toBe(16);
    expect(facts.specConflicts).toEqual({});
  });
});

function offer(partial: Partial<DeriveSource> & { supplier: string }): DeriveSource {
  return {
    supplierSku: `${partial.supplier}-sku`,
    productUrl: null,
    stock: null,
    moq: null,
    orderMultiple: null,
    packaging: null,
    currency: 'KRW',
    leadTime: null,
    fetchedAt: T0,
    priceBreaks: [{ qty: 1, price: 100, currency: 'KRW' }],
    ...partial,
  };
}

describe('deriveSamplepcbOffer — 자체 오퍼 원천 선정', () => {
  it('재고>0 오퍼가 더 싼 무재고 오퍼보다 우선', () => {
    const chosen = deriveSamplepcbOffer([
      offer({ supplier: 'mouser', stock: 0, priceBreaks: [{ qty: 1, price: 50, currency: 'KRW' }] }),
      offer({ supplier: 'digikey', stock: 1000, priceBreaks: [{ qty: 1, price: 80, currency: 'KRW' }] }),
    ]);
    expect(chosen?.supplier).toBe('digikey');
  });

  it('KRW 오퍼가 더 싼 외화 오퍼보다 우선(환율 불확실성 회피)', () => {
    const chosen = deriveSamplepcbOffer([
      offer({ supplier: 'digikey', stock: 10, currency: 'USD', priceBreaks: [{ qty: 1, price: 0.01, currency: 'USD' }] }),
      offer({ supplier: 'mouser', stock: 10, priceBreaks: [{ qty: 1, price: 90, currency: 'KRW' }] }),
    ]);
    expect(chosen?.supplier).toBe('mouser');
  });

  it('같은 조건이면 최소구간 단가 최저 → 재고 많은 순', () => {
    const cheapest = deriveSamplepcbOffer([
      offer({ supplier: 'mouser', stock: 10, priceBreaks: [{ qty: 1, price: 90, currency: 'KRW' }] }),
      offer({ supplier: 'unikeyic', stock: 10, priceBreaks: [{ qty: 1, price: 70, currency: 'KRW' }] }),
    ]);
    expect(cheapest?.supplier).toBe('unikeyic');

    const tie = deriveSamplepcbOffer([
      offer({ supplier: 'mouser', stock: 10, priceBreaks: [{ qty: 1, price: 70, currency: 'KRW' }] }),
      offer({ supplier: 'unikeyic', stock: 999, priceBreaks: [{ qty: 1, price: 70, currency: 'KRW' }] }),
    ]);
    expect(tie?.supplier).toBe('unikeyic');
  });

  it('최소수량 구간 단가로 비교한다(고수량 구간이 아니라)', () => {
    const chosen = deriveSamplepcbOffer([
      offer({
        supplier: 'mouser',
        stock: 10,
        priceBreaks: [
          { qty: 1000, price: 10, currency: 'KRW' },
          { qty: 1, price: 100, currency: 'KRW' },
        ],
      }),
      offer({ supplier: 'digikey', stock: 10, priceBreaks: [{ qty: 1, price: 50, currency: 'KRW' }] }),
    ]);
    expect(chosen?.supplier).toBe('digikey');
  });

  it('가격구간 없음·0원 구간·samplepcb 자신은 원천 부적격', () => {
    expect(deriveSamplepcbOffer([offer({ supplier: 'mouser', priceBreaks: [] })])).toBeNull();
    expect(
      deriveSamplepcbOffer([offer({ supplier: 'mouser', priceBreaks: [{ qty: 1, price: 0, currency: 'KRW' }] })]),
    ).toBeNull();
    expect(deriveSamplepcbOffer([offer({ supplier: 'samplepcb' })])).toBeNull();
  });

  it('전량 무재고면 무재고 중에서 선정한다', () => {
    const chosen = deriveSamplepcbOffer([
      offer({ supplier: 'mouser', stock: 0, priceBreaks: [{ qty: 1, price: 50, currency: 'KRW' }] }),
      offer({ supplier: 'digikey', stock: 0, priceBreaks: [{ qty: 1, price: 80, currency: 'KRW' }] }),
    ]);
    expect(chosen?.supplier).toBe('mouser');
  });
});
