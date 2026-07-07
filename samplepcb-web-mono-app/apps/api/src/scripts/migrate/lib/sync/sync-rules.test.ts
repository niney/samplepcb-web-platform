import { afterEach, describe, expect, it } from 'vitest';
import { MEMBER_NOISE_COLS, protectedMbIds, resolvePasswordSync } from './member-resync';
import { diffCols, normValue } from './row-diff';

describe('resolvePasswordSync — 비번 앵커 규칙(계획 P1-6)', () => {
  const OLD = '*8CB2EFA90181D907C4D00FC7E65B34496C7AA634'; // 구형 41자
  const NEW_OLD = '*AAAA1111181D907C4D00FC7E65B34496C7AA634'; // 레거시에서 바뀐 새 구형 해시
  const REHASHED = 'sha256:12000:abcdef:0123456789'; // 코어 자동 재해시 형식

  it('타깃 미재해시 + 동일 해시 → 무변경', () => {
    expect(resolvePasswordSync(OLD, OLD, '').set).toBeNull();
  });

  it('타깃 미재해시 + 레거시 비번 변경 → 레거시 해시 채택', () => {
    expect(resolvePasswordSync(NEW_OLD, OLD, '').set).toEqual({
      mb_password: NEW_OLD,
      mb_password2: '',
    });
  });

  it('재해시됨 + 앵커(mb_password2)==레거시 → 재해시 보존(무변경)', () => {
    expect(resolvePasswordSync(OLD, REHASHED, OLD).set).toBeNull();
  });

  it('재해시됨 + 앵커≠레거시(재해시 후 레거시에서 비번 변경) → 레거시 채택+앵커 초기화', () => {
    expect(resolvePasswordSync(NEW_OLD, REHASHED, OLD).set).toEqual({
      mb_password: NEW_OLD,
      mb_password2: '',
    });
  });
});

describe('회원 대조 상수', () => {
  const originalEnv = process.env.MIGRATE_PROTECTED_MB_IDS;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MIGRATE_PROTECTED_MB_IDS;
    else process.env.MIGRATE_PROTECTED_MB_IDS = originalEnv;
  });

  it('노이즈 컬럼(로그인마다 갱신)은 대조 제외 대상으로 고정', () => {
    expect(MEMBER_NOISE_COLS).toEqual(['mb_today_login', 'mb_login_ip']);
  });

  it('보호 계정: 기본(admin·kpeter) + ENV 확장', () => {
    delete process.env.MIGRATE_PROTECTED_MB_IDS;
    expect([...protectedMbIds()].sort()).toEqual(['admin', 'kpeter']);
    process.env.MIGRATE_PROTECTED_MB_IDS = 'ops@samplepcb.co.kr, tester ';
    expect(protectedMbIds().has('ops@samplepcb.co.kr')).toBe(true);
    expect(protectedMbIds().has('tester')).toBe(true);
  });
});

describe('normValue/diffCols — mysql2 타입 관용 비교', () => {
  it('number vs 문자열, null vs 빈 문자열을 동치로', () => {
    expect(normValue(35200)).toBe('35200');
    expect(normValue(null)).toBe('');
    expect(normValue(undefined)).toBe('');
    expect(normValue(Buffer.from('한글'))).toBe('한글');
  });

  it('diffCols 는 값이 실제로 다른 컬럼만 골라낸다', () => {
    const legacy = { a: 1, b: 'x', c: null, d: '2026-07-02 10:00:00' };
    const target = { a: '1', b: 'y', c: '', d: '2026-07-02 10:00:01' };
    expect(diffCols(legacy, target, ['a', 'b', 'c', 'd'])).toEqual(['b', 'd']);
  });
});
