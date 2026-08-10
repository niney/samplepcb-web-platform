import { describe, expect, it } from 'vitest';
import {
  isPcbRoundResolved,
  pcbCaseStepOf,
  pcbStepOf,
  resolvePcbAsRoundState,
  type PcbStepInput,
  type PcbTopPoSignal,
} from './pcb-case-step';

const base = (over: Partial<PcbStepInput> = {}): PcbStepInput => ({
  rfqTotal: 0,
  rfqQuoted: 0,
  rfqSelected: false,
  finalPrice: null,
  cartState: 'none',
  isPaid: false,
  poCount: 0,
  eqDone: false,
  produced: false,
  hasShipment: false,
  odStatus: null,
  ...over,
});

const po = (over: Partial<PcbTopPoSignal> = {}): PcbTopPoSignal => ({
  reorderRound: 0,
  status: 'produced',
  shipment: null,
  ...over,
});

describe('pcbStepOf — 현행 12단계 판정(이동 전 라우트 로직 그대로)', () => {
  it('신호가 없으면 1(견적요청)', () => {
    expect(pcbStepOf(base())).toBe(1);
  });
  it('RFQ→회신→선정→확정가→주문→결제 사다리', () => {
    expect(pcbStepOf(base({ rfqTotal: 2 }))).toBe(2);
    expect(pcbStepOf(base({ rfqTotal: 2, rfqQuoted: 1 }))).toBe(3);
    expect(pcbStepOf(base({ rfqTotal: 2, rfqQuoted: 1, rfqSelected: true }))).toBe(4);
    expect(pcbStepOf(base({ finalPrice: 60_000 }))).toBe(5);
    expect(pcbStepOf(base({ finalPrice: 60_000, cartState: 'ordered' }))).toBe(6);
    expect(pcbStepOf(base({ cartState: 'ordered', isPaid: true }))).toBe(7);
  });
  it('발주→EQ→생산→선적→배송 사다리', () => {
    expect(pcbStepOf(base({ isPaid: true, poCount: 1 }))).toBe(8);
    expect(pcbStepOf(base({ poCount: 1, eqDone: true }))).toBe(9);
    expect(pcbStepOf(base({ poCount: 1, eqDone: true, produced: true }))).toBe(10);
    expect(pcbStepOf(base({ poCount: 1, produced: true, hasShipment: true }))).toBe(11);
    expect(pcbStepOf(base({ odStatus: '배송' }))).toBe(12);
    expect(pcbStepOf(base({ odStatus: '완료' }))).toBe(12);
  });
});

describe('isPcbRoundResolved — 회차 종결 = 선적 done/delivered 또는 입고확인', () => {
  it('발송 없음·진행 중 상태는 미종결', () => {
    expect(isPcbRoundResolved(null)).toBe(false);
    for (const status of ['preparing', 'requested', 'shipped', 'arrived', 'customs', 'shipping']) {
      expect(isPcbRoundResolved({ status, receivedAt: null }), status).toBe(false);
    }
  });
  it('최종 상태·입고확인은 종결', () => {
    expect(isPcbRoundResolved({ status: 'done', receivedAt: null })).toBe(true);
    expect(isPcbRoundResolved({ status: 'delivered', receivedAt: null })).toBe(true);
    expect(isPcbRoundResolved({ status: 'customs', receivedAt: new Date() })).toBe(true);
  });
});

describe('resolvePcbAsRoundState — 최상위 발주 최신 회차 판정', () => {
  it('발주 없음·원발주(round 0)뿐이면 닫힘 — 현행 축 유지(회귀 무영향의 근거)', () => {
    expect(resolvePcbAsRoundState([])).toEqual({ asRound: 0, asOpen: false });
    expect(resolvePcbAsRoundState([po(), po({ status: 'issued' })])).toEqual({
      asRound: 0,
      asOpen: false,
    });
    // round 0 발주의 선적 유무는 A/S 판정과 무관하다.
    expect(
      resolvePcbAsRoundState([po({ shipment: { status: 'shipped', receivedAt: null } })]),
    ).toEqual({ asRound: 0, asOpen: false });
  });
  it('회차(>0) 발주가 종결 전이면 열림 — 선적 없음·이동 중 모두', () => {
    expect(resolvePcbAsRoundState([po(), po({ reorderRound: 1, status: 'issued' })])).toEqual({
      asRound: 1,
      asOpen: true,
    });
    expect(
      resolvePcbAsRoundState([
        po(),
        po({ reorderRound: 1, shipment: { status: 'shipped', receivedAt: null } }),
      ]),
    ).toEqual({ asRound: 1, asOpen: true });
  });
  it('회차 선적이 종결되면 닫힘 — done·delivered·입고확인', () => {
    for (const shipment of [
      { status: 'done', receivedAt: null },
      { status: 'delivered', receivedAt: null },
      { status: 'arrived', receivedAt: new Date() },
    ]) {
      expect(resolvePcbAsRoundState([po(), po({ reorderRound: 1, shipment })])).toEqual({
        asRound: 1,
        asOpen: false,
      });
    }
  });
  it('판정은 최신 회차만 본다 — 1차 종결·2차 진행이면 2차 기준 열림', () => {
    expect(
      resolvePcbAsRoundState([
        po(),
        po({ reorderRound: 1, shipment: { status: 'done', receivedAt: null } }),
        po({ reorderRound: 2, status: 'producing' }),
      ]),
    ).toEqual({ asRound: 2, asOpen: true });
  });
});

describe('pcbCaseStepOf — A/S 진행 중이면 최신 회차 축, 아니면 현행 판정 그대로', () => {
  it('닫힘(원발주-only 포함)이면 base 판정과 동일 — 회귀 무영향', () => {
    const closed = { asRound: 0, asOpen: false };
    expect(pcbCaseStepOf(base({ odStatus: '완료' }), closed, [])).toBe(12);
    expect(
      pcbCaseStepOf(base({ poCount: 1, produced: true, hasShipment: true }), closed, []),
    ).toBe(11);
    // A/S 회차가 종결된 스펙도 현행(전 회차 집계+od 12) 그대로다.
    expect(pcbCaseStepOf(base({ odStatus: '완료' }), { asRound: 1, asOpen: false }, [])).toBe(12);
  });
  it('열림이면 od 완료여도 12 고정이 풀리고 회차 발주의 실단계가 선다', () => {
    const open = { asRound: 1, asOpen: true };
    const b = base({ odStatus: '완료', isPaid: true, cartState: 'ordered' as const, produced: true, hasShipment: true });
    expect(pcbCaseStepOf(b, open, [po({ reorderRound: 1, status: 'issued' })])).toBe(8);
    expect(pcbCaseStepOf(b, open, [po({ reorderRound: 1, status: 'eq_done' })])).toBe(9);
    expect(pcbCaseStepOf(b, open, [po({ reorderRound: 1, status: 'produced' })])).toBe(10);
    expect(
      pcbCaseStepOf(b, open, [
        po({ reorderRound: 1, shipment: { status: 'shipped', receivedAt: null } }),
      ]),
    ).toBe(11);
  });
  it('열림 판정에서 원발주의 EQ·생산·선적 신호는 섞이지 않는다', () => {
    // 원발주는 완주(produced+shipment)했지만 회차는 갓 발행 — 8이어야 한다.
    const b = base({ odStatus: '완료', poCount: 2, eqDone: true, produced: true, hasShipment: true });
    expect(
      pcbCaseStepOf(b, { asRound: 1, asOpen: true }, [po({ reorderRound: 1, status: 'issued' })]),
    ).toBe(8);
  });
});
