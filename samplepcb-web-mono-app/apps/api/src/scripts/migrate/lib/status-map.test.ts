import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ORDER_STATUSES,
  CANCEL_STATUSES,
  isCancelStatus,
  normalizeStatus,
  resolvePartialCancelOdStatus,
} from './status-map';
import { uuidV5 } from './util';

describe('상태 상수 미러(g5-db.ts SSOT 동기 확인)', () => {
  it('ACTIVE 13종(표준 5 + 제작 8) + 취소류 3종', () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual([
      '주문',
      '입금',
      '준비',
      '가격확인',
      '파일검사',
      'EQ',
      '생산시작',
      '생산중',
      '품질시험',
      '생산완료',
      'A/S',
      '배송',
      '완료',
    ]);
    expect(CANCEL_STATUSES).toEqual(['취소', '반품', '품절']);
  });
});

describe('normalizeStatus', () => {
  it('신규 세트는 통과(레거시 생산 단계 포함 — 문자열 체계 동일)', () => {
    for (const s of ['주문', '입금', '생산중', '생산완료', '완료', '취소', '반품', '품절']) {
      expect(normalizeStatus(s)).toEqual({ status: s, mapped: false });
    }
  });

  it('레거시 전용 상태 매핑: 전체취소 → 취소', () => {
    expect(normalizeStatus('전체취소')).toEqual({ status: '취소', mapped: true });
  });

  it('미지 상태(협력사 견적 단계 등)는 null — 게이트/phase 중단 대상', () => {
    expect(normalizeStatus('협력사 견적요청')).toBeNull();
    expect(normalizeStatus('협력사 견적완료')).toBeNull();
    expect(normalizeStatus('견적완료')).toBeNull();
    expect(normalizeStatus('쇼핑')).toBeNull(); // 주문 연결분엔 나오면 안 되는 상태
  });

  it('공백 트림', () => {
    expect(normalizeStatus(' 완료 ')).toEqual({ status: '완료', mapped: false });
  });
});

describe('resolvePartialCancelOdStatus — 부분취소 od 해소', () => {
  it('활성 라인 중 가장 진행된 상태로', () => {
    expect(resolvePartialCancelOdStatus(['입금', '생산중'])).toBe('생산중');
    expect(resolvePartialCancelOdStatus(['완료', '배송'])).toBe('완료');
    expect(resolvePartialCancelOdStatus(['주문'])).toBe('주문');
  });

  it('활성 라인이 없으면 취소', () => {
    expect(resolvePartialCancelOdStatus([])).toBe('취소');
    expect(resolvePartialCancelOdStatus(['알수없음'])).toBe('취소');
  });
});

describe('isCancelStatus / uuidV5(결정적 quoteId)', () => {
  it('취소류 판정', () => {
    expect(isCancelStatus('취소')).toBe(true);
    expect(isCancelStatus('완료')).toBe(false);
  });

  it('uuidV5 는 같은 입력에 항상 같은 값(멱등 키) + v5/variant 비트', () => {
    const a = uuidV5('2019102121360056:6820');
    const b = uuidV5('2019102121360056:6820');
    const c = uuidV5('2019102121360056:6821');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
