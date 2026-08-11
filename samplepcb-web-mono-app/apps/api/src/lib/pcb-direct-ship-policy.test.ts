import { describe, expect, it } from 'vitest';
import { resolvePcbDirectShipCountry } from '@sp/api-contract';

// 직송 판정 축(교정 08-11 · 여정 11호 X9) — 고객 배송 큐의 종결 동선([배송 처리] vs
// [직송 완료])과 Case 헤더 유도 배지가 같은 이 함수를 쓴다. 입력은 **입고된 발주들의**
// 직송지(관리자 수신 선적의 receivedAt 신호를 만든 발주 — 종결 대상이 곧 그 발주다).
describe('PCB 직송 판정 — 입고된 발주 축', () => {
  it('입고된 발주가 전부 같은 직송지면 직송으로 본다', () => {
    expect(resolvePcbDirectShipCountry(['CN'])).toBe('CN');
    expect(resolvePcbDirectShipCountry(['CN', 'CN'])).toBe('CN');
  });

  it('입고된 발주가 자사행(직송지 없음)이면 직송이 아니다 — 운송장 있는 [배송 처리]', () => {
    expect(resolvePcbDirectShipCountry([null])).toBeNull();
    expect(resolvePcbDirectShipCountry([null, null])).toBeNull();
  });

  it('입고 신호가 없으면 판정 근거도 없다', () => {
    expect(resolvePcbDirectShipCountry([])).toBeNull();
  });

  it('혼재는 보수적으로 직송 아님 — 원발주 KR 입고 + 회차 직송 CN 입고', () => {
    // 실물이 자사 창고에 있는데 "현지 수령"으로 닫는 것보다, 한 번 더 확인받는 쪽이 안전하다.
    expect(resolvePcbDirectShipCountry([null, 'CN'])).toBeNull();
    expect(resolvePcbDirectShipCountry(['CN', null])).toBeNull();
    expect(resolvePcbDirectShipCountry(['CN', 'VN'])).toBeNull();
  });
});
