import { describe, expect, it } from 'vitest';
import {
  applyQtyToOffer,
  computeTotals,
  isSevereOrderSurplus,
  neededQty,
  pickBreak,
  pickDefaultOffer,
  stampOrderQty,
  toKrw,
  type BomOfferInput,
} from './bom-pricing';

// BOM 견적 가격·수량 골든 명세 — 레거시 보존 규칙과 신규 보정의 경계를 고정한다.

function offer(partial: Partial<BomOfferInput> & { supplier: string }): BomOfferInput {
  return {
    supplierSku: `${partial.supplier}-sku`,
    packaging: null,
    currency: 'KRW',
    stock: 10000,
    moq: null,
    orderMultiple: null,
    fetchedAt: '2026-07-19T00:00:00Z',
    priceBreaks: [{ qty: 1, price: 100 }],
    ...partial,
  };
}

describe('수량 박제(레거시 보존 + 주문배수 신규)', () => {
  it('필요수량 = BOM수량 × (세트+예비)', () => {
    expect(neededQty(3, 10, 2)).toBe(36);
    expect(neededQty(1, 1, 0)).toBe(1);
  });

  it('MOQ 바닥: 필요수량이 MOQ 미만이면 MOQ 로', () => {
    expect(stampOrderQty(100, 4000, null)).toBe(4000);
    expect(stampOrderQty(5000, 4000, null)).toBe(5000);
  });

  it('주문배수 올림(레거시 미구현 보정): 5000 필요·배수 4000 → 8000', () => {
    expect(stampOrderQty(5000, 4000, 4000)).toBe(8000);
    expect(stampOrderQty(100, null, 250)).toBe(250);
    expect(stampOrderQty(100, null, 1)).toBe(100);
  });

  it('절대 초과량과 비율이 모두 큰 주문만 자동추천 제한 대상으로 분류한다', () => {
    expect(isSevereOrderSurplus(1, 5)).toBe(false);
    expect(isSevereOrderSurplus(1, 5_000)).toBe(true);
    expect(isSevereOrderSurplus(3, 5_000)).toBe(true);
    expect(isSevereOrderSurplus(1_000, 1_500)).toBe(false);
    expect(isSevereOrderSurplus(100, 201)).toBe(true);
  });
});

describe('가격구간 선택(레거시 보존)', () => {
  const breaks = [
    { qty: 1, price: 100 },
    { qty: 100, price: 80 },
    { qty: 1000, price: 60 },
  ];

  it('주문수량 이상 구간 중 최대 구간', () => {
    expect(pickBreak(breaks, 500)?.qty).toBe(100);
    expect(pickBreak(breaks, 1000)?.qty).toBe(1000);
  });

  it('최소구간 미달이면 최소구간 단가', () => {
    const b = [
      { qty: 10, price: 50 },
      { qty: 100, price: 40 },
    ];
    expect(pickBreak(b, 3)?.qty).toBe(10);
  });

  it('빈 구간은 null', () => {
    expect(pickBreak([], 10)).toBeNull();
  });
});

describe('통화 환산(예상치)', () => {
  it('KRW 그대로, USD 는 환율 적용, 미지·무환율은 null', () => {
    expect(toKrw(100, 'KRW', null)).toBe(100);
    expect(toKrw(2, 'USD', 1400)).toBe(2800);
    expect(toKrw(2, 'USD', null)).toBeNull();
    expect(toKrw(2, 'CNY', 1400)).toBeNull();
  });
});

describe('pickDefaultOffer — 실효 총비용 최저', () => {
  it('MOQ 부담이 큰 최저 단가보다 실효 총비용 낮은 오퍼 선택', () => {
    // 필요 100개: A 단가 60원 MOQ 4000 → 24만원 / B 단가 100원 MOQ 없음 → 1만원
    const pick = pickDefaultOffer(
      [
        offer({ supplier: 'digikey', moq: 4000, priceBreaks: [{ qty: 1, price: 60 }] }),
        offer({ supplier: 'mouser', priceBreaks: [{ qty: 1, price: 100 }] }),
      ],
      100,
      null,
    );
    expect(pick?.offer.supplier).toBe('mouser');
    expect(pick?.orderQty).toBe(100);
  });

  it('재고 충분 오퍼 우선 — 부족 오퍼는 전량 부족일 때만(stockShort 표시)', () => {
    const pick = pickDefaultOffer(
      [
        offer({ supplier: 'mouser', stock: 10, priceBreaks: [{ qty: 1, price: 50 }] }),
        offer({ supplier: 'digikey', stock: 5000, priceBreaks: [{ qty: 1, price: 80 }] }),
      ],
      100,
      null,
    );
    expect(pick?.offer.supplier).toBe('digikey');
    expect(pick?.stockShort).toBe(false);

    const short = pickDefaultOffer(
      [offer({ supplier: 'mouser', stock: 10, priceBreaks: [{ qty: 1, price: 50 }] })],
      100,
      null,
    );
    expect(short?.stockShort).toBe(true);
  });

  it('환산 가능(KRW·USD+환율) 오퍼 우선, 환율 있으면 통화 넘어 비교', () => {
    // USD 0.05×1400=70원 < KRW 90원 → 환율 주면 digikey 선택
    const withRate = pickDefaultOffer(
      [
        offer({ supplier: 'digikey', currency: 'USD', priceBreaks: [{ qty: 1, price: 0.05, currency: 'USD' }] }),
        offer({ supplier: 'mouser', priceBreaks: [{ qty: 1, price: 90 }] }),
      ],
      100,
      1400,
    );
    expect(withRate?.offer.supplier).toBe('digikey');
    expect(withRate?.unitPriceKrw).toBeCloseTo(70);

    // 환율 없으면 USD 미환산 → KRW 오퍼 우선
    const noRate = pickDefaultOffer(
      [
        offer({ supplier: 'digikey', currency: 'USD', priceBreaks: [{ qty: 1, price: 0.05, currency: 'USD' }] }),
        offer({ supplier: 'mouser', priceBreaks: [{ qty: 1, price: 90 }] }),
      ],
      100,
      null,
    );
    expect(noRate?.offer.supplier).toBe('mouser');
  });

  it('환산할 수 없는 서로 다른 원통화끼리는 숫자만으로 비교하지 않는다', () => {
    const pick = pickDefaultOffer(
      [
        offer({ supplier: 'digikey', currency: 'USD', priceBreaks: [{ qty: 1, price: 0.05, currency: 'USD' }] }),
        offer({ supplier: 'mouser', currency: 'EUR', priceBreaks: [{ qty: 1, price: 0.04, currency: 'EUR' }] }),
      ],
      100,
      null,
    );
    expect(pick).toBeNull();
  });

  it('samplepcb 파생 오퍼는 후보 제외(순환 방지)', () => {
    const pick = pickDefaultOffer(
      [
        offer({ supplier: 'samplepcb', priceBreaks: [{ qty: 1, price: 1 }] }),
        offer({ supplier: 'mouser', priceBreaks: [{ qty: 1, price: 90 }] }),
      ],
      10,
      null,
    );
    expect(pick?.offer.supplier).toBe('mouser');
  });

  it('동률이면 재고 → 패키지 우선순위(Cut>Tape)', () => {
    const pick = pickDefaultOffer(
      [
        offer({ supplier: 'a', stock: 500, packaging: 'Tape & Reel', priceBreaks: [{ qty: 1, price: 70 }] }),
        offer({ supplier: 'b', stock: 500, packaging: 'Cut Tape', priceBreaks: [{ qty: 1, price: 70 }] }),
      ],
      100,
      null,
    );
    expect(pick?.offer.supplier).toBe('b');
  });
});

describe('applyQtyToOffer — pinned 라인 수량 변경', () => {
  it('선택 오퍼 안에서 구간·박제만 재계산', () => {
    const o = offer({
      supplier: 'mouser',
      moq: 100,
      orderMultiple: 100,
      priceBreaks: [
        { qty: 1, price: 100 },
        { qty: 500, price: 60 },
      ],
    });
    const pick = applyQtyToOffer(o, 450, null);
    expect(pick?.orderQty).toBe(500); // 배수 올림
    expect(pick?.unitPrice).toBe(60); // 올림 후 구간 재적용
  });
});

describe('computeTotals — items=합계 기준 동일(레거시 결함 교정)', () => {
  it('included 라인만 합산 + 운송료·관리비, 미산정 라인 카운트', () => {
    const totals = computeTotals(
      [
        { included: true, lineTotalKrw: 10000 },
        { included: false, lineTotalKrw: 99999 }, // 제외 라인은 금액도 제외
        { included: true, lineTotalKrw: null }, // 미산정
        { included: true, lineTotalKrw: 2500.4 },
      ],
      30000,
      25000,
    );
    expect(totals.itemsTotal).toBe(12500);
    expect(totals.finalTotal).toBe(67500);
    expect(totals.uncostedCount).toBe(1);
  });
});
