import { describe, expect, it } from 'vitest';
import { PcbRfqChildSelectBody, pcbMdQuoteAmount } from '@sp/api-contract';
import { computePcbCrossRate, roundPcbAmount } from './exchange-rate';

// PCB 통화쌍 교차(KRW 경유, tts 기준) — docs/PCB_PARTNER_TRACK.md §6 D2.
// 실측 예시 근사: USD/KRW tts 1444.19, CNH/KRW tts 200 가정.
describe('computePcbCrossRate', () => {
  const USD = 1444.19;
  const CNH = 200;

  it('동일 통화는 항상 1', () => {
    expect(computePcbCrossRate(null, null, 'KRW', 'KRW')).toBe(1);
    expect(computePcbCrossRate(null, null, 'USD', 'USD')).toBe(1);
  });

  it('KRW 기준 직접 환율 — USD→KRW = tts 그대로', () => {
    expect(computePcbCrossRate(USD, null, 'USD', 'KRW')).toBe(1444.19);
    expect(computePcbCrossRate(null, CNH, 'CNY', 'KRW')).toBe(200);
  });

  it('역수 — KRW→USD, 소수 6자리 HALF_UP', () => {
    expect(computePcbCrossRate(USD, null, 'KRW', 'USD')).toBe(
      Math.round((1 / USD) * 1_000_000) / 1_000_000,
    );
  });

  it('교차 — CNY→USD = (CNY→KRW)/(USD→KRW)', () => {
    const rate = computePcbCrossRate(USD, CNH, 'CNY', 'USD');
    expect(rate).toBe(Math.round((CNH / USD) * 1_000_000) / 1_000_000);
    // 레거시 기본값 감각 확인(0.139 부근) — 200/1444.19 ≈ 0.138486
    expect(rate).toBeCloseTo(0.138486, 6);
  });

  it('필요 통화 캐시가 없으면 null(미준비 축퇴 — 폴백 계산 금지)', () => {
    expect(computePcbCrossRate(null, CNH, 'CNY', 'USD')).toBeNull();
    expect(computePcbCrossRate(USD, null, 'CNY', 'KRW')).toBeNull();
  });
});

describe('roundPcbAmount', () => {
  it('KRW 는 0자리 HALF_UP', () => {
    expect(roundPcbAmount(1080.5, 'KRW')).toBe(1081);
    expect(roundPcbAmount(1080.4, 'KRW')).toBe(1080);
  });

  it('USD/CNY 는 2자리 HALF_UP', () => {
    // 레거시 감사 예시: ¥7,200 × 0.139 × 1.08 = $1,080.864 → $1,080.86
    expect(roundPcbAmount(7200 * 0.139 * 1.08, 'USD')).toBe(1080.86);
    expect(roundPcbAmount(1.005, 'CNY')).toBe(1.01);
  });
});

// 마스터딜러 회신가 — 포털 미리보기와 서버 박제가 같은 함수를 쓴다(따로 계산하면 1원·1센트가 갈린다).
describe('pcbMdQuoteAmount', () => {
  it('하위가 × 환율 × (1+마진%) 를 한 번에 곱하고 마지막에 한 번만 반올림한다', () => {
    // 레거시 감사 예시와 같은 값: ¥7,200 × 0.139 × 1.08 = $1,080.864 → $1,080.86
    expect(pcbMdQuoteAmount(7200, 0.139, 8, 'USD')).toBe(1080.86);
    // 중간에 반올림하면 갈린다: 1 × 0.335 × 1.5 = 0.5025 → 0.50 인데, 환산을 먼저 반올림하면 0.34 × 1.5 = 0.51 이다.
    expect(pcbMdQuoteAmount(1, 0.335, 50, 'USD')).toBe(0.5);
    expect(pcbMdQuoteAmount(200, 1352.59, 15, 'KRW')).toBe(Math.round(200 * 1352.59 * 1.15));
  });

  it('마진 0% · 같은 통화(환율 1)는 하위가 그대로다', () => {
    expect(pcbMdQuoteAmount(180, 1, 0, 'USD')).toBe(180);
    expect(pcbMdQuoteAmount(1500000, 1, 0, 'KRW')).toBe(1500000);
  });
});

describe('PcbRfqChildSelectBody — 하위 선정에 납기·메모', () => {
  it('납기·메모 없이도 된다(납기 = 하위 납기 그대로, 메모 = 그대로)', () => {
    const parsed = PcbRfqChildSelectBody.parse({ childRfqId: 3, marginRate: 8 });
    expect(parsed.quotedDeliveryDate).toBeUndefined();
    expect(parsed.memo).toBeUndefined();
  });

  it('납기는 날짜 꼴만, 메모는 다듬어 받고 null 로 비울 수 있다', () => {
    expect(PcbRfqChildSelectBody.safeParse({ childRfqId: 3, marginRate: 8, quotedDeliveryDate: '11/24' }).success).toBe(false);
    const parsed = PcbRfqChildSelectBody.parse({ childRfqId: 3, marginRate: 8, quotedDeliveryDate: '2026-11-24', memo: '  검사 4일  ' });
    expect([parsed.quotedDeliveryDate, parsed.memo]).toEqual(['2026-11-24', '검사 4일']);
    expect(PcbRfqChildSelectBody.parse({ childRfqId: null, memo: null }).memo).toBeNull();
  });
});
