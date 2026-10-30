import { describe, expect, it, vi } from 'vitest';

// thinking 단계 가드·타임아웃 배수 — 'max'(§13.13)는 사고량이 high 의 ~23배라 def.timeoutMs 의 2배로 잡는다.
vi.mock('../prisma', () => ({ prisma: {} }));

import { AI_USECASE_DEFS, THINK_MAX_TIMEOUT_MULTIPLIER, asThinkLevel, toOllamaThink, usecaseThinkLevel, usecaseTimeoutMs } from './usecases';

describe('usecaseThinkLevel', () => {
  it('개별 메뉴 맞춤 질문은 낮음·끔이 저장돼 있어도 기본값(medium)으로 돈다', () => {
    const def = AI_USECASE_DEFS['develop.area-followup'];
    expect(def.think).toBe('medium');
    expect(usecaseThinkLevel(def, 'low')).toBe('medium');
    expect(usecaseThinkLevel(def, 'off')).toBe('medium');
    expect(usecaseThinkLevel(def, 'high')).toBe('high');
    expect(usecaseThinkLevel(def, 'max')).toBe('max');
    expect(usecaseThinkLevel(def, null)).toBe('medium');
  });

  it('제한이 없는 유스케이스는 저장값 그대로', () => {
    expect(usecaseThinkLevel(AI_USECASE_DEFS['develop.followup'], 'low')).toBe('low');
    expect(usecaseThinkLevel(AI_USECASE_DEFS['develop.followup'], 'off')).toBe('off');
  });
});

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

describe('pcb.eq-parse 기본값(프로빙 결정 — docs/PCB_EQ_AI_PROBE.md §7.1)', () => {
  it('kimi-k3 · think low · temperature 0 · 120초 · 출하 프롬프트 판', () => {
    // 승인요청마다 도는 잡이라 기본값이 조용히 바뀌면 지연·비용이 통째로 달라진다.
    expect(AI_USECASE_DEFS['pcb.eq-parse']).toEqual({
      defaultModel: 'kimi-k3',
      promptVersion: 'eq-parse-v3',
      think: 'low',
      temperature: 0,
      timeoutMs: 120_000,
    });
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
