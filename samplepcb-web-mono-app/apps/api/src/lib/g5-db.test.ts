import { describe, expect, it } from 'vitest';
import {
  buildOrderBaseConds,
  buildOrderListWhere,
  buildOrderTabCond,
} from './g5-db';
import type { OrderTab, SearchOrdersParams } from './g5-db';

// buildOrderListWhere/buildOrderBaseConds/buildOrderTabCond 는 순수 함수(DB 불필요).
// 레거시 orderlist.php WHERE 조립의 이식 정합성을 파라미터 바인딩 관점에서 검증한다.

const base = (over: Partial<SearchOrdersParams> = {}): SearchOrdersParams => ({
  tab: '전체',
  qField: undefined,
  q: undefined,
  from: undefined,
  to: undefined,
  settleCase: undefined,
  misu: undefined,
  cancelled: undefined,
  refund: undefined,
  point: undefined,
  coupon: undefined,
  sort: undefined,
  order: undefined,
  page: 1,
  pageSize: 20,
  ...over,
});

describe('buildOrderTabCond — 탭 8종(배타 조건)', () => {
  it("'전체' 는 조건 없음", () => {
    expect(buildOrderTabCond('전체')).toEqual({ conds: [], values: [] });
  });

  it.each([
    ['주문'],
    ['입금'],
    ['준비'],
    ['배송'],
    ['완료'],
  ] as [OrderTab][])("'%s' 는 od_status 등호 바인딩", (tab) => {
    expect(buildOrderTabCond(tab)).toEqual({ conds: ['od_status = ?'], values: [tab] });
  });

  it("'취소' 는 od_status='취소'(스톡 '전체취소' 라벨)", () => {
    expect(buildOrderTabCond('취소')).toEqual({ conds: ['od_status = ?'], values: ['취소'] });
  });

  it("'부분취소' 는 진행상태 IN + od_cancel_price>0", () => {
    const r = buildOrderTabCond('부분취소');
    expect(r.conds).toEqual([
      'od_status IN (?, ?, ?, ?, ?) AND od_cancel_price > 0',
    ]);
    expect(r.values).toEqual(['주문', '입금', '준비', '배송', '완료']);
  });
});

describe('buildOrderBaseConds — 검색/기간/결제수단/플래그', () => {
  it('빈 파라미터는 조건 없음', () => {
    expect(buildOrderBaseConds(base())).toEqual({ conds: [], values: [] });
  });

  it('qField+q 둘 다 있을 때만 LIKE(%q% 바인딩)', () => {
    const r = buildOrderBaseConds(base({ qField: 'od_name', q: '홍길동' }));
    expect(r.conds).toEqual(['od_name LIKE ?']);
    expect(r.values).toEqual(['%홍길동%']);
  });

  it('q 만 있고 qField 없으면 조건 없음', () => {
    expect(buildOrderBaseConds(base({ q: '홍길동' })).conds).toEqual([]);
  });

  it('qField 만 있고 q 없으면 조건 없음', () => {
    expect(buildOrderBaseConds(base({ qField: 'od_name' })).conds).toEqual([]);
  });

  it('LIKE 특수문자(%,_,\\)는 escape 후 바인딩', () => {
    const r = buildOrderBaseConds(base({ qField: 'od_id', q: '100%_a\\b' }));
    expect(r.values).toEqual(['%100\\%\\_a\\\\b%']);
  });

  it('화이트리스트 밖 qField 는 무시(방어)', () => {
    // 계약 enum 이 1차 차단하지만 lib 도 Set 으로 이중 방어한다.
    const r = buildOrderBaseConds(base({ qField: 'od_pwd', q: 'x' }));
    expect(r.conds).toEqual([]);
  });

  it("결제수단 등호(‘간편결제’ 외)", () => {
    const r = buildOrderBaseConds(base({ settleCase: '무통장' }));
    expect(r.conds).toEqual(['od_settle_case = ?']);
    expect(r.values).toEqual(['무통장']);
  });

  it("‘간편결제’ 는 IN 확장(4종)", () => {
    const r = buildOrderBaseConds(base({ settleCase: '간편결제' }));
    expect(r.conds).toEqual(['od_settle_case IN (?, ?, ?, ?)']);
    expect(r.values).toEqual(['간편결제', '삼성페이', 'lpay', 'inicis_kakaopay']);
  });

  it('플래그 5종은 조건부 상수 SQL(바인딩 없음)', () => {
    const r = buildOrderBaseConds(
      base({ misu: true, cancelled: true, refund: true, point: true, coupon: true }),
    );
    expect(r.conds).toEqual([
      'od_misu <> 0',
      'od_cancel_price <> 0',
      'od_refund_price <> 0',
      'od_receipt_point <> 0',
      '(od_cart_coupon + od_coupon + od_send_coupon) > 0',
    ]);
    expect(r.values).toEqual([]);
  });

  it('플래그 false/undefined 는 조건 미추가', () => {
    const r = buildOrderBaseConds(base({ misu: false, cancelled: undefined }));
    expect(r.conds).toEqual([]);
  });

  it('기간 from/to 는 각각 >=,<= 로 분리(한쪽만도 동작)', () => {
    const both = buildOrderBaseConds(base({ from: '2026-01-01', to: '2026-01-31' }));
    expect(both.conds).toEqual(['od_time >= ?', 'od_time <= ?']);
    expect(both.values).toEqual(['2026-01-01 00:00:00', '2026-01-31 23:59:59']);

    const onlyFrom = buildOrderBaseConds(base({ from: '2026-01-01' }));
    expect(onlyFrom.conds).toEqual(['od_time >= ?']);
    expect(onlyFrom.values).toEqual(['2026-01-01 00:00:00']);
  });
});

describe('buildOrderListWhere — base + 탭 결합', () => {
  it('전체 탭 + 필터 없음 = 빈 WHERE', () => {
    expect(buildOrderListWhere(base())).toEqual({ sql: '', values: [] });
  });

  it('base 다음 탭 조건 순서로 결합', () => {
    const r = buildOrderListWhere(
      base({ tab: '입금', settleCase: '무통장', misu: true, from: '2026-02-01' }),
    );
    expect(r.sql).toBe(
      'WHERE od_settle_case = ? AND od_misu <> 0 AND od_time >= ? AND od_status = ?',
    );
    expect(r.values).toEqual(['무통장', '2026-02-01 00:00:00', '입금']);
  });

  it('부분취소 탭은 base 뒤에 IN + cancel_price 조건', () => {
    const r = buildOrderListWhere(base({ tab: '부분취소', qField: 'mb_id', q: 'user1' }));
    expect(r.sql).toBe(
      'WHERE mb_id LIKE ? AND od_status IN (?, ?, ?, ?, ?) AND od_cancel_price > 0',
    );
    expect(r.values).toEqual(['%user1%', '주문', '입금', '준비', '배송', '완료']);
  });
});
