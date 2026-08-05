import { describe, expect, it } from 'vitest';
import { fmtKstDate, kstDateInput, kstDateOnly, kstToday } from './kst-date';

// 명세는 "서버가 KST 자정에 앵커해 저장한 날짜가 그 날짜로 보인다" 하나다.
// 실측 회귀 케이스: 납기 2026-08-20 을 저장하면 2026-08-19T15:00:00Z 가 되는데,
// UTC 슬라이스는 '2026-08-19' 를 내놓아 하루 앞당겨 표시됐다(2026-08-05 발견).
describe('kstDateOnly', () => {
  it('KST 자정 앵커 인스턴트를 그 날짜로 되돌린다', () => {
    expect(kstDateOnly('2026-08-19T15:00:00.000Z')).toBe('2026-08-20');
    expect(kstDateOnly('2026-08-20T15:00:00.000Z')).toBe('2026-08-21');
  });

  it('KST 하루의 양 끝을 같은 날짜로 묶는다', () => {
    expect(kstDateOnly('2026-08-19T15:00:00.000Z')).toBe('2026-08-20'); // KST 00:00
    expect(kstDateOnly('2026-08-20T14:59:59.999Z')).toBe('2026-08-20'); // KST 23:59
    expect(kstDateOnly('2026-08-20T15:00:00.000Z')).toBe('2026-08-21'); // 다음 날 00:00
  });

  it('UTC 자정 직후 타임스탬프도 KST 날짜로 옮긴다(전날로 밀리지 않는다)', () => {
    // KST 09:00 = UTC 00:00 — 슬라이스 방식이 전날을 내던 구간
    expect(kstDateOnly('2026-08-20T00:00:00.000Z')).toBe('2026-08-20');
    expect(kstDateOnly('2026-08-20T02:30:00.000Z')).toBe('2026-08-20');
  });

  it('빈 값·잘못된 값은 null', () => {
    expect(kstDateOnly(null)).toBeNull();
    expect(kstDateOnly(undefined)).toBeNull();
    expect(kstDateOnly('')).toBeNull();
    expect(kstDateOnly('not-a-date')).toBeNull();
  });
});

describe('표시·입력 래퍼', () => {
  it('fmtKstDate 는 없으면 대시', () => {
    expect(fmtKstDate('2026-08-19T15:00:00.000Z')).toBe('2026-08-20');
    expect(fmtKstDate(null)).toBe('—');
    expect(fmtKstDate(null, '미정')).toBe('미정');
  });

  it('kstDateInput 은 없으면 빈 문자열(date input 왕복)', () => {
    expect(kstDateInput('2026-08-19T15:00:00.000Z')).toBe('2026-08-20');
    expect(kstDateInput(null)).toBe('');
  });

  it('프리필 → 재저장 왕복에서 날짜가 밀리지 않는다', () => {
    // 서버 parseKstDate('YYYY-MM-DD') = KST 자정 → 같은 문자열이 되돌아와야 한다.
    const stored = new Date('2026-08-20T00:00:00+09:00').toISOString();
    expect(kstDateInput(stored)).toBe('2026-08-20');
  });
});

describe('kstToday', () => {
  it('UTC 전날 15:00 이후는 이미 KST 다음 날', () => {
    expect(kstToday(new Date('2026-08-19T15:00:00.000Z'))).toBe('2026-08-20');
    expect(kstToday(new Date('2026-08-19T14:59:59.000Z'))).toBe('2026-08-19');
  });
});
