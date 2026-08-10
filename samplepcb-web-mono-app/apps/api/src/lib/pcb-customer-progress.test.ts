import { describe, expect, it } from 'vitest';
import { pcbProgressLabel, resolvePcbProgressStage } from './pcb-customer-progress';

// 고객 진행 단계 판정(P4.13) — 발주 상태·발송 신호의 조합 전수.

describe('resolvePcbProgressStage', () => {
  it('생산 전(issued·eq_requested·eq_done)은 전부 EQ 단계로 묶인다', () => {
    for (const s of ['issued', 'eq_requested', 'eq_done']) {
      expect(resolvePcbProgressStage(s, null)).toBe('eq');
    }
  });

  it('producing 은 생산 중', () => {
    expect(resolvePcbProgressStage('producing', null)).toBe('producing');
  });

  it('produced 는 발송 신호에 따라 갈린다 — 없음/preparing→준비, 진행→운송, 입고확인→입고', () => {
    expect(resolvePcbProgressStage('produced', null)).toBe('produced');
    expect(resolvePcbProgressStage('produced', { status: 'preparing', receivedAt: null })).toBe(
      'produced',
    );
    expect(resolvePcbProgressStage('produced', { status: 'shipped', receivedAt: null })).toBe(
      'shipping',
    );
    // 입고확인(receivedAt)은 상태보다 우선 — 국내 3단계는 receive 가 종점을 닫는다(P4.10).
    expect(
      resolvePcbProgressStage('produced', { status: 'delivered', receivedAt: new Date() }),
    ).toBe('received');
  });
});

describe('pcbProgressLabel', () => {
  it('회차>0 이면 A/S 재생산 접두가 붙는다', () => {
    expect(pcbProgressLabel('producing', 0)).toBe('생산 진행 중');
    expect(pcbProgressLabel('producing', 1)).toBe('A/S 재생산 — 생산 진행 중');
  });
});
