import { describe, expect, it } from 'vitest';
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
