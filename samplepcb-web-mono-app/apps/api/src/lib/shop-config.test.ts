import { describe, expect, it } from 'vitest';
import { cleanXssTags, isValidCallback } from './shop-config';

// 코어 common.lib.php 의 check_vaild_callback / clean_xss_tags 이식 정합성 고정.

describe('isValidCallback (발신번호 형식)', () => {
  it('1588 은 8자리만 허용', () => {
    expect(isValidCallback('15881234')).toBe(true);
    expect(isValidCallback('1588123')).toBe(false); // 7자리
  });

  it('02 지역번호는 9~10자리', () => {
    expect(isValidCallback('021234567')).toBe(true); // 9자리
    expect(isValidCallback('0212345678')).toBe(true); // 10자리
    expect(isValidCallback('02123456789')).toBe(false); // 11자리
  });

  it('휴대폰(010) 허용', () => {
    expect(isValidCallback('01012345678')).toBe(true);
    expect(isValidCallback('0101234567')).toBe(true);
  });

  it('중간 국번이 전부 0 인 번호는 거부', () => {
    expect(isValidCallback('020001234')).toBe(false);
    expect(isValidCallback('0100001234')).toBe(false);
  });

  it('하이픈/공백은 무시(숫자만 추출)', () => {
    expect(isValidCallback('02-1234-5678')).toBe(true);
    expect(isValidCallback('010 1234 5678')).toBe(true);
  });

  it('형식에 맞지 않으면 거부', () => {
    expect(isValidCallback('123')).toBe(false);
    expect(isValidCallback('')).toBe(false);
    expect(isValidCallback('abc')).toBe(false);
  });
});

describe('cleanXssTags (XSS 정제)', () => {
  it('script 태그 제거(내용은 남김)', () => {
    expect(cleanXssTags('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('위험 속성 달린 태그 제거', () => {
    expect(cleanXssTags('<b onerror=alert(1)>hi')).toBe('hi');
    expect(cleanXssTags('<iframe src=x></iframe>')).toBe('');
  });

  it('javascript 스킴 제거', () => {
    expect(cleanXssTags('javascript:alert')).not.toContain('javascript');
    expect(cleanXssTags('vbscript:foo')).not.toContain('vbscript');
  });

  it('엔티티 우회 문자 제거', () => {
    expect(cleanXssTags('a&colon;b')).toBe('ab');
    expect(cleanXssTags('x&lpar;y&rpar;z')).toBe('xyz');
  });

  it('제어문자(탭·개행) 제거', () => {
    expect(cleanXssTags('a\tb\nc\rd')).toBe('abcd');
  });

  it('정상 한글·공백·괄호 값은 보존', () => {
    expect(cleanXssTags('주식회사 샘플피씨비')).toBe('주식회사 샘플피씨비');
    expect(cleanXssTags('서울시 강남구 역삼동 (1층)')).toBe('서울시 강남구 역삼동 (1층)');
    expect(cleanXssTags('02-1234-5678')).toBe('02-1234-5678');
  });
});
