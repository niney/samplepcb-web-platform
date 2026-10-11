import { describe, expect, it } from 'vitest';
import { pcbShipConfirmPending, pcbShipmentSenderDone } from '@sp/api-contract';

// 협력사 '선적 완료' 확인(2026-10-11) — 상태 사전에 없는 기록 하나(shipConfirmedAt)로 두 가지를 가른다:
//   ① 지금이 협력사의 [선적 완료] 차례인가  ② 협력사에게 이 발송이 끝났는가(보내기 보드 ↔ 완료 내역)
const intl = (status: string, over: { shipConfirmedAt?: string | null; receivedAt?: string | null } = {}) => ({
  mode: 'international' as const,
  status: status as never,
  shipConfirmedAt: over.shipConfirmedAt ?? null,
  receivedAt: over.receivedAt ?? null,
});
const domestic = (status: string, receivedAt: string | null = null) => ({
  mode: 'domestic' as const,
  status: status as never,
  shipConfirmedAt: null,
  receivedAt,
});
const AT = '2026-10-11T03:00:00.000Z';

describe('pcbShipConfirmPending — 협력사의 [선적 완료] 차례', () => {
  it("받는 쪽이 국제 '선적'을 진행했고 아직 확인이 없을 때만", () => {
    expect(pcbShipConfirmPending(intl('shipped'))).toBe(true);
    expect(pcbShipConfirmPending(intl('requested')), '선적 전').toBe(false);
    expect(pcbShipConfirmPending(intl('shipped', { shipConfirmedAt: AT })), '이미 확인').toBe(false);
    expect(pcbShipConfirmPending(intl('arrived')), '받는 쪽이 다음 단계로 넘겼다').toBe(false);
    expect(pcbShipConfirmPending(intl('shipped', { receivedAt: AT })), '입고 확인이 먼저 났다').toBe(false);
  });

  it('국내(택배)에는 이 단계가 없다 — 협력사가 송장을 직접 넣는다', () => {
    expect(pcbShipConfirmPending(domestic('shipping'))).toBe(false);
  });
});

describe('pcbShipmentSenderDone — 협력사에게 끝난 발송', () => {
  it('국제: 선적 완료를 확인하면 끝난다(받는 쪽 단계가 남아 있어도)', () => {
    expect(pcbShipmentSenderDone(intl('shipped')), '확인 전 — 아직 내 일이 남았다').toBe(false);
    expect(pcbShipmentSenderDone(intl('shipped', { shipConfirmedAt: AT }))).toBe(true);
  });

  it("국제: 확인이 없어도 받는 쪽이 '선적'을 지나면 끝난 것으로 본다 — 할 일로 남기지 않는다", () => {
    for (const status of ['arrived', 'customs', 'done']) expect(pcbShipmentSenderDone(intl(status)), status).toBe(true);
  });

  it('선적 전(준비·요청)은 끝나지 않았다', () => {
    expect(pcbShipmentSenderDone(intl('preparing'))).toBe(false);
    expect(pcbShipmentSenderDone(intl('requested'))).toBe(false);
  });

  it('입고 확인·마지막 단계는 예전 그대로 끝이다(국내 포함)', () => {
    expect(pcbShipmentSenderDone(intl('requested', { receivedAt: AT })), '조기 입고 확인').toBe(true);
    expect(pcbShipmentSenderDone(domestic('shipping')), '국내 — 송장만으로는 끝나지 않는다').toBe(false);
    expect(pcbShipmentSenderDone(domestic('shipping', AT))).toBe(true);
    expect(pcbShipmentSenderDone(domestic('delivered'))).toBe(true);
  });
});
