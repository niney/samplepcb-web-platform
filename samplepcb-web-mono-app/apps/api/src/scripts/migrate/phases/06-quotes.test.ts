import { describe, expect, it } from 'vitest';
import type { LegacyRow } from '../../../lib/legacy-db';
import { isPendingQuoteScope, quoteStageQuoteId } from './06-quotes';
import { uuidV5 } from '../lib/util';

// 견적 이관의 두 순수 규칙 — 여기가 깨지면 중복 spec(승격 앵커 상실) 또는 대상 불일치가 난다.

describe('quoteStageQuoteId — 승격 앵커', () => {
  it('ct_id 만으로 결정된다(주문번호 무관 — 승격 후에도 같은 값)', () => {
    expect(quoteStageQuoteId('12345')).toBe(quoteStageQuoteId('12345'));
  });

  it('주문 단계 quoteId(uuidV5(`od:ct`))와 절대 겹치지 않는다', () => {
    expect(quoteStageQuoteId('12345')).not.toBe(uuidV5('2026080421031540:12345'));
    // 'cart:' 접두 덕에 od_id 가 'cart' 인 병리적 경우에도 분리된다
    expect(quoteStageQuoteId('12345')).not.toBe(uuidV5('cart:12345:0'));
  });

  it('ct_id 가 다르면 다른 값', () => {
    expect(quoteStageQuoteId('1')).not.toBe(quoteStageQuoteId('2'));
  });
});

const cart = (ctStatus: string): LegacyRow => ({ ct_status: ctStatus });
const item = (over: Record<string, unknown>): LegacyRow => ({
  it_23: 'rfq',
  it_use: 1,
  ca_id: '10',
  ...over,
});

describe('isPendingQuoteScope — 이관 대상 판정(upload-files 와 공유)', () => {
  it('거버 rfq 견적이 장바구니(쇼핑)에 있으면 대상', () => {
    expect(isPendingQuoteScope(cart('쇼핑'), item({}))).toBe(true);
  });

  it('주문 상태 집합 밖의 견적 단계 ct_status(협력사 견적요청·견적완료)도 대상', () => {
    expect(isPendingQuoteScope(cart('협력사 견적요청'), item({}))).toBe(true);
    expect(isPendingQuoteScope(cart('협력사 견적완료'), item({}))).toBe(true);
    expect(isPendingQuoteScope(cart('견적완료'), item({}))).toBe(true);
  });

  it('수동견적(ca_id=30)은 it_23 과 무관하게 대상', () => {
    expect(isPendingQuoteScope(cart('쇼핑'), item({ it_23: '', ca_id: '30' }))).toBe(true);
  });

  it('BOM(40·41)은 전용 트랙이라 제외(사용자 확정 2026-08-04)', () => {
    expect(isPendingQuoteScope(cart('쇼핑'), item({ ca_id: '40' }))).toBe(false);
    expect(isPendingQuoteScope(cart('쇼핑'), item({ ca_id: '41' }))).toBe(false);
  });

  it('취소류·고아 주문 라인은 견적으로 되살리지 않는다', () => {
    expect(isPendingQuoteScope(cart('취소'), item({}))).toBe(false);
    expect(isPendingQuoteScope(cart('반품'), item({}))).toBe(false);
    expect(isPendingQuoteScope(cart('입금'), item({}))).toBe(false);
    expect(isPendingQuoteScope(cart('완료'), item({}))).toBe(false);
    // '가격확인'은 레거시 어감과 달리 플랫폼 PRODUCTION_STATUSES 소속(=주문 진행) —
    // 주문 헤더 없이 이 상태면 고아 라인이므로 견적으로 되살리지 않고 리포트만 한다.
    expect(isPendingQuoteScope(cart('가격확인'), item({}))).toBe(false);
  });

  it('미사용 상품(it_use=0)·rfq 아님·상품 부재는 제외', () => {
    expect(isPendingQuoteScope(cart('쇼핑'), item({ it_use: 0 }))).toBe(false);
    expect(isPendingQuoteScope(cart('쇼핑'), item({ it_23: 'order' }))).toBe(false);
    expect(isPendingQuoteScope(cart('쇼핑'), undefined)).toBe(false);
  });
});
