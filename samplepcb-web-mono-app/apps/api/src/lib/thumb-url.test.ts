import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signedThumbUrl, thumbExpiry, verifyThumbSig } from './thumb-url';

const TTL = 15 * 60;

describe('썸네일 서명 URL', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JWT_SECRET;
  });

  it('만료 시각은 창 경계에 맞고 남은 시간은 항상 TTL 초과 ~ 2×TTL 이하다', () => {
    for (const now of [0, 1, TTL - 1, TTL, TTL + 1, 2 * TTL - 1, 1_790_000_000, 1_790_000_899]) {
      const exp = thumbExpiry(now);
      expect(exp % TTL).toBe(0);
      expect(exp - now).toBeGreaterThan(TTL);
      expect(exp - now).toBeLessThanOrEqual(2 * TTL);
    }
  });

  it('같은 창 안에서 발급한 URL 은 같다(브라우저 캐시 적중)', () => {
    vi.setSystemTime(new Date(1_790_000_100_000));
    const first = signedThumbUrl(42n);
    vi.setSystemTime(new Date(1_790_000_400_000)); // 5분 뒤, 같은 15분 창
    expect(signedThumbUrl(42n)).toBe(first);
    vi.setSystemTime(new Date(1_790_001_000_000)); // 다음 창
    expect(signedThumbUrl(42n)).not.toBe(first);
  });

  it('발급한 URL 은 만료 전까지 검증되고 만료 뒤·변조는 거부된다', () => {
    vi.setSystemTime(new Date(1_790_000_100_000));
    const url = new URL(signedThumbUrl(42n), 'https://example.test');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') ?? '';
    expect(url.pathname).toBe('/api/pcb-thumbs/42');
    expect(verifyThumbSig('42', exp, sig)).toBe(true);
    expect(verifyThumbSig('43', exp, sig)).toBe(false); // 다른 파일
    expect(verifyThumbSig('42', exp + TTL, sig)).toBe(false); // 만료 연장 시도
    vi.setSystemTime(new Date((exp + 1) * 1000));
    expect(verifyThumbSig('42', exp, sig)).toBe(false); // 만료
  });
});
