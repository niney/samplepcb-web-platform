import { describe, expect, it } from 'vitest';
import { isPcbDeliveryOverdue } from '@sp/api-contract';

// 납기 경과 판정(여정 14호 T2) — Case 상세와 발주 큐가 같은 규칙으로 말하게 하는 순수 함수.
// 명세는 셋이다: ① 지난 날짜만 초과 ② 당일은 아직 아님 ③ 생산완료부터는 납기의 몫이 끝난다.
describe('isPcbDeliveryOverdue', () => {
  const today = '2026-08-11';

  it('납기가 지났고 아직 생산 중이면 초과', () => {
    expect(isPcbDeliveryOverdue('issued', '2026-08-10', today)).toBe(true);
    expect(isPcbDeliveryOverdue('eq_requested', '2026-07-01', today)).toBe(true);
    expect(isPcbDeliveryOverdue('producing', '2026-08-10', today)).toBe(true);
  });

  it('당일은 아직 지난 것이 아니다 — 납기는 "그날까지"의 약속이다', () => {
    expect(isPcbDeliveryOverdue('producing', today, today)).toBe(false);
  });

  it('앞으로의 납기는 초과가 아니다', () => {
    expect(isPcbDeliveryOverdue('issued', '2026-09-01', today)).toBe(false);
  });

  // 만들어 놓은 건을 계속 빨간 줄로 두면 **진짜 늦은 건이 묻힌다**. 그 뒤(발송·입고)는
  // 선적 축이 따로 기한을 가진다.
  it('생산완료부터는 지연이 아니다', () => {
    expect(isPcbDeliveryOverdue('produced', '2026-07-01', today)).toBe(false);
  });

  it('납기 미지정은 지연이 아니다 — 약속 자체가 없다', () => {
    expect(isPcbDeliveryOverdue('producing', null, today)).toBe(false);
    expect(isPcbDeliveryOverdue('producing', '', today)).toBe(false);
  });

  // ⚠ 인자는 **KST 'YYYY-MM-DD'** 여야 한다. 납기는 KST 자정 앵커로 저장되므로 ISO 를 그냥
  //   자르면 하루 앞당겨진다(packages/utils kst-date.test.ts 의 실측 회귀). 호출부가
  //   kstDateOnly 를 거치는 이유이고, 그 규약이 깨지면 경계 하루가 통째로 뒤집힌다.
  it('KST 날짜 문자열끼리의 사전식 비교다(경계 하루)', () => {
    expect(isPcbDeliveryOverdue('producing', '2026-08-10', '2026-08-11')).toBe(true);
    expect(isPcbDeliveryOverdue('producing', '2026-08-11', '2026-08-11')).toBe(false);
    expect(isPcbDeliveryOverdue('producing', '2025-12-31', '2026-01-01')).toBe(true);
  });
});
