import { describe, expect, it, vi } from 'vitest';

// thinking 단계 가드·타임아웃 배수 — 'max'(§13.13)는 사고량이 high 의 ~23배라 def.timeoutMs 의 2배로 잡는다.
vi.mock('../prisma', () => ({ prisma: {} }));

import { AI_USECASE_DEFS, THINK_MAX_TIMEOUT_MULTIPLIER, asThinkLevel, toOllamaThink, usecaseTimeoutMs } from './usecases';

describe('asThinkLevel', () => {
  it('허용 5단계는 그대로, 그 밖(null·옛 값·오타)은 fallback', () => {
    for (const v of ['off', 'low', 'medium', 'high', 'max'] as const) expect(asThinkLevel(v, 'high')).toBe(v);
    expect(asThinkLevel(null, 'high')).toBe('high');
    expect(asThinkLevel('ultra', 'low')).toBe('low');
    expect(asThinkLevel('', 'medium')).toBe('medium');
  });

  it('toOllamaThink — off 만 false, 나머지는 단계 문자열 그대로(max 포함)', () => {
    expect(toOllamaThink('off')).toBe(false);
    expect(toOllamaThink('high')).toBe('high');
    expect(toOllamaThink('max')).toBe('max');
  });
});

describe('usecaseTimeoutMs', () => {
  it('max 만 def.timeoutMs × 배수, 나머지는 def 값', () => {
    const def = AI_USECASE_DEFS['market.dev-diagram'];
    expect(usecaseTimeoutMs(def, 'high')).toBe(def.timeoutMs);
    expect(usecaseTimeoutMs(def, 'off')).toBe(def.timeoutMs);
    expect(usecaseTimeoutMs(def, 'max')).toBe(def.timeoutMs * THINK_MAX_TIMEOUT_MULTIPLIER);
    expect(usecaseTimeoutMs(def, 'max')).toBe(1_800_000);
  });
});
