import { describe, expect, it } from 'vitest';
import {
  bomProgressLabel,
  bomProgressShortLabel,
  resolveBomPoStage,
  resolveBomProgress,
} from './bom-customer-progress';

// BOM 고객 진행 판정 — 발주·선적 신호 조합 전수(PCB pcb-customer-progress 의 BOM 판).

describe('resolveBomPoStage', () => {
  it('선적이 없으면 발주 상태가 말한다 — issued=조달 중 · confirmed/closed=조달 확정', () => {
    expect(resolveBomPoStage({ status: 'issued', shipment: null })).toBe('procuring');
    expect(resolveBomPoStage({ status: 'confirmed', shipment: null })).toBe('procure_confirmed');
    expect(resolveBomPoStage({ status: 'closed', shipment: null })).toBe('procure_confirmed');
  });

  it('선적 preparing/requested 는 발송 준비, 실물이 움직이면 운송, 입고확인·종결이면 입고', () => {
    const s = (status: string, receivedAt: Date | null = null, mode = 'domestic') => ({ status: 'confirmed', shipment: { status, mode, receivedAt } });
    expect(resolveBomPoStage(s('preparing'))).toBe('packing');
    expect(resolveBomPoStage(s('requested', null, 'international'))).toBe('packing');
    expect(resolveBomPoStage(s('shipping'))).toBe('inbound');
    expect(resolveBomPoStage(s('shipped', null, 'international'))).toBe('inbound');
    expect(resolveBomPoStage(s('arrived', null, 'international'))).toBe('inbound');
    expect(resolveBomPoStage(s('customs', null, 'international'))).toBe('inbound');
    expect(resolveBomPoStage(s('delivered'))).toBe('received');
    expect(resolveBomPoStage(s('done', null, 'international'))).toBe('received');
    // 상태가 뒤처져도 입고확인이 찍혔으면 입고다.
    expect(resolveBomPoStage(s('shipping', new Date()))).toBe('received');
  });
});

describe('resolveBomProgress', () => {
  it('발주 전은 조달 준비', () => {
    expect(resolveBomProgress([])).toMatchObject({ stage: 'procure_pending', partial: false });
  });

  it('여러 발주면 가장 느린 것이 단계고, 앞선 것이 있으면 partial', () => {
    const r = resolveBomProgress([
      { status: 'confirmed', shipment: { status: 'delivered', mode: 'domestic', receivedAt: new Date() } },
      { status: 'issued', shipment: null },
    ]);
    expect(r.stage).toBe('procuring');
    expect(r.partial).toBe(true);
    expect(bomProgressLabel(r)).toBe('부품 조달 중 (일부 앞서 진행 중)');
    expect(bomProgressShortLabel(r)).toBe('조달 중');
  });

  it('보류 품목(부품 확인 D43)이 있으면 나머지가 다 들어와도 입고 완료가 아니라 조달 중이다', () => {
    const received = { status: 'closed', shipment: { status: 'delivered', mode: 'domestic', receivedAt: new Date() } };
    // 여정 22호 실측 — 정상 품목 발주서만 입고되고 확인 중 품목은 발주 보류였는데 '입고 완료'로 보였다.
    expect(resolveBomProgress([received]).stage).toBe('received');
    const confirm = resolveBomProgress([received], 'confirm');
    expect(confirm).toMatchObject({ stage: 'procuring', partial: true, held: 'confirm' });
    expect(bomProgressLabel(confirm)).toBe('부품 조달 중 — 확인이 필요한 부품이 있습니다 (일부 앞서 진행 중)');
    expect(bomProgressShortLabel(confirm)).toBe('조달 중');
    const backorder = resolveBomProgress([{ status: 'issued', shipment: null }], 'backorder');
    expect(backorder).toMatchObject({ stage: 'procuring', partial: false });
    expect(bomProgressLabel(backorder)).toBe('부품 조달 중 — 입고를 기다리는 부품이 있습니다');
    // 발주 전이면 칸은 그대로(조달 준비) 두고 사유만 붙인다.
    expect(bomProgressLabel(resolveBomProgress([], 'confirm'))).toBe('부품 조달 준비 중 — 확인이 필요한 부품이 있습니다');
  });

  it('국제 선적이 운송 중이면 해외 어휘, 통관이면 통관 어휘', () => {
    const intl = resolveBomProgress([{ status: 'confirmed', shipment: { status: 'shipped', mode: 'international', receivedAt: null } }]);
    expect(bomProgressLabel(intl)).toBe('해외 부품 운송 중');
    expect(bomProgressShortLabel(intl)).toBe('해외 운송');
    const customs = resolveBomProgress([{ status: 'confirmed', shipment: { status: 'customs', mode: 'international', receivedAt: null } }]);
    expect(bomProgressLabel(customs)).toBe('해외 운송·통관 중');
    expect(bomProgressShortLabel(customs)).toBe('통관 중');
    // 국내는 입고 어휘 그대로.
    const dom = resolveBomProgress([{ status: 'confirmed', shipment: { status: 'shipping', mode: 'domestic', receivedAt: null } }]);
    expect(bomProgressLabel(dom)).toBe('부품 입고 운송 중');
  });

  it('전부 입고면 입고 완료', () => {
    const r = resolveBomProgress([
      { status: 'confirmed', shipment: { status: 'delivered', mode: 'domestic', receivedAt: new Date() } },
    ]);
    expect(r.stage).toBe('received');
    expect(r.partial).toBe(false);
    expect(bomProgressLabel(r)).toBe('부품 입고 완료 — 검수·배송 준비 중');
  });
});
