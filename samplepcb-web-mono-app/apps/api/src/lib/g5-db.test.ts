import { describe, expect, it } from 'vitest';
import {
  buildOrderBaseConds,
  buildOrderListWhere,
  buildOrderTabCond,
  computeOrderMoney,
  matchDeliveryRows,
  orderTransitionGuard,
  phpRound,
  resolveForceStatusStock,
  resolveItemCancelSkip,
  resolveOrderSort,
} from './g5-db';
import type {
  DeliveryInput,
  OrderMoneyInput,
  OrderTab,
  SearchOrdersParams,
} from './g5-db';

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

// ── 상태 전이·삭제(⑬) 순수 로직 — 코어 orderlistupdate.php 이식 정합성 ─────────

describe('phpRound — round half away from zero(코어 PHP round 미러)', () => {
  it('양수 0.5 는 올림', () => {
    expect(phpRound(2.5)).toBe(3);
    expect(phpRound(0.5)).toBe(1);
  });
  it('음수 0.5 는 0 에서 먼 쪽(내림) — JS Math.round 와 갈리는 지점', () => {
    expect(phpRound(-2.5)).toBe(-3);
    expect(phpRound(-0.5)).toBe(-1);
    expect(Math.round(-2.5)).toBe(-2); // 대비: 코어와 달라 phpRound 가 필요한 이유
  });
  it('일반 반올림·0', () => {
    expect(phpRound(11363.636363)).toBe(11364);
    expect(phpRound(2.4)).toBe(2);
    expect(phpRound(0)).toBe(0);
  });
});

describe('computeOrderMoney — get_order_info(:1745-1795) 산식 미러', () => {
  const money = (over: Partial<OrderMoneyInput> = {}): OrderMoneyInput => ({
    taxFlag: true,
    cartPrice: 10000,
    cartCoupon: 0,
    taxMny: 10000,
    freeMny: 0,
    sendCost: 2500,
    sendCost2: 0,
    odCoupon: 0,
    odSendCoupon: 0,
    receiptPrice: 0,
    receiptPoint: 0,
    refundPrice: 0,
    ...over,
  });

  it('과세(taxFlag) — 미수/과세/부가세 산출', () => {
    const r = computeOrderMoney(money());
    // totTaxMny = 10000 + 2500 = 12500 → tax=round(12500/1.1)=11364, vat=1136
    expect(r.odTaxMny).toBe(11364);
    expect(r.odVatMny).toBe(1136);
    expect(r.odFreeMny).toBe(0);
    expect(r.odSendCost).toBe(2500); // 저장값 그대로 되씀
    expect(r.odMisu).toBe(12500);
  });

  it('주문→입금 멱등 — receiptPrice=미수 로 바뀌면 misu=0, 과세/부가세 불변', () => {
    const before = computeOrderMoney(money());
    const after = computeOrderMoney(money({ receiptPrice: before.odMisu }));
    expect(after.odMisu).toBe(0);
    expect(after.odTaxMny).toBe(before.odTaxMny);
    expect(after.odVatMny).toBe(before.odVatMny);
  });

  it('비과세(taxFlag=false) — freeMny 합산 후 0 으로', () => {
    const r = computeOrderMoney(money({ taxFlag: false, taxMny: 8000, freeMny: 2000, sendCost: 0 }));
    // totTaxMny = 8000 + 2000 = 10000 → tax=round(10000/1.1)=9091, vat=909, free=0
    expect(r.odTaxMny).toBe(9091);
    expect(r.odVatMny).toBe(909);
    expect(r.odFreeMny).toBe(0);
  });

  it('과세 총액 음수는 0 클램프 + 초과분을 freeMny 로', () => {
    const r = computeOrderMoney(money({ taxMny: 1000, sendCost: 0, receiptPoint: 2000 }));
    // totTaxMny = 1000 - 2000 = -1000 < 0 → free += -1000, tot=0
    expect(r.odTaxMny).toBe(0);
    expect(r.odVatMny).toBe(0);
    expect(r.odFreeMny).toBe(-1000);
  });

  it('쿠폰·환불 반영 — misu 산식', () => {
    const r = computeOrderMoney(
      money({ cartCoupon: 500, odCoupon: 1000, odSendCoupon: 300, refundPrice: 200, receiptPoint: 100 }),
    );
    // misu = (10000+2500+0) - (500+1000+300) - (0+100-200) = 12500 - 1800 + 100 = 10800
    expect(r.odMisu).toBe(10800);
  });
});

describe('orderTransitionGuard — 전이 가드 판정(코어 orderlistupdate.php switch)', () => {
  it('입금: 주문+무통장만 허용', () => {
    expect(orderTransitionGuard('입금', '주문', '무통장')).toEqual({ ok: true });
    expect(orderTransitionGuard('입금', '주문', '신용카드')).toEqual({
      ok: false,
      reason: 'NOT_BANK_TRANSFER',
    });
    expect(orderTransitionGuard('입금', '입금', '무통장')).toEqual({
      ok: false,
      reason: 'NOT_ORDER_STATUS',
    });
  });
  it('준비: 입금에서만', () => {
    expect(orderTransitionGuard('준비', '입금', '')).toEqual({ ok: true });
    expect(orderTransitionGuard('준비', '주문', '')).toEqual({
      ok: false,
      reason: 'NOT_DEPOSIT_STATUS',
    });
  });
  it('배송: 준비에서만(운송장 유무는 matchDeliveryRows 담당)', () => {
    expect(orderTransitionGuard('배송', '준비', '')).toEqual({ ok: true });
    expect(orderTransitionGuard('배송', '입금', '')).toEqual({
      ok: false,
      reason: 'NOT_READY_STATUS',
    });
  });
  it('완료: 배송에서만', () => {
    expect(orderTransitionGuard('완료', '배송', '')).toEqual({ ok: true });
    expect(orderTransitionGuard('완료', '준비', '')).toEqual({
      ok: false,
      reason: 'NOT_SHIPPING_STATUS',
    });
  });
});

describe('resolveOrderSort — 정렬 컬럼 화이트리스트', () => {
  it("'od_time' 정렬 지원(FE 요청 반영) — order 방향 반영", () => {
    expect(resolveOrderSort(base({ sort: 'od_time', order: 'asc' }))).toEqual({
      column: 'od_time',
      direction: 'asc',
    });
    expect(resolveOrderSort(base({ sort: 'od_time' }))).toEqual({
      column: 'od_time',
      direction: 'desc',
    });
  });
  it('sort 미지정 시 탭 기본(전체→od_id desc)', () => {
    expect(resolveOrderSort(base())).toEqual({ column: 'od_id', direction: 'desc' });
  });
});

describe('matchDeliveryRows — 배송 rows 매칭(운송장 필드 검증)', () => {
  const row = (over: Partial<DeliveryInput> & { odId: string }): DeliveryInput => ({
    deliveryCompany: 'CJ',
    invoiceNo: '1234',
    invoiceTime: '2026-07-05 10:00:00',
    ...over,
  });

  it('행 있는 odId 는 rows, 없는 odId 는 MISSING_INVOICE', () => {
    const r = matchDeliveryRows(['A', 'B'], [row({ odId: 'A' })]);
    expect(r.rows.map((d) => d.odId)).toEqual(['A']);
    expect(r.skipped).toEqual([{ odId: 'B', reason: 'MISSING_INVOICE' }]);
  });

  it('3필드 중 하나라도 비면 MISSING_INVOICE', () => {
    const r = matchDeliveryRows(
      ['A', 'B', 'C'],
      [row({ odId: 'A', invoiceNo: '' }), row({ odId: 'B', deliveryCompany: '  ' }), row({ odId: 'C' })],
    );
    expect(r.rows.map((d) => d.odId)).toEqual(['C']);
    expect(r.skipped).toEqual([
      { odId: 'A', reason: 'MISSING_INVOICE' },
      { odId: 'B', reason: 'MISSING_INVOICE' },
    ]);
  });

  it('odIds 순서 보존 + odIds 밖 delivery 행 무시', () => {
    const r = matchDeliveryRows(['B', 'A'], [row({ odId: 'A' }), row({ odId: 'Z' }), row({ odId: 'B' })]);
    expect(r.rows.map((d) => d.odId)).toEqual(['B', 'A']);
    expect(r.skipped).toEqual([]);
  });
});

describe('resolveItemCancelSkip — 카트행 취소 skip 판정(무통장 취소/반품/품절)', () => {
  it('진행 상태 + ct_point=0 → 처리 진행(null)', () => {
    expect(resolveItemCancelSkip('입금', 0)).toBeNull();
    expect(resolveItemCancelSkip('배송', 0)).toBeNull();
  });
  it('ct_point>0 → HAS_POINT(안전판, 상태 무관 우선)', () => {
    expect(resolveItemCancelSkip('입금', 100)).toBe('HAS_POINT');
    expect(resolveItemCancelSkip('취소', 100)).toBe('HAS_POINT');
  });
  it('이미 취소류(취소/반품/품절) → ALREADY_CANCELLED', () => {
    expect(resolveItemCancelSkip('취소', 0)).toBe('ALREADY_CANCELLED');
    expect(resolveItemCancelSkip('반품', 0)).toBe('ALREADY_CANCELLED');
    expect(resolveItemCancelSkip('품절', 0)).toBe('ALREADY_CANCELLED');
  });
});

describe('resolveForceStatusStock — 임의 상태 변경 스톡 판정(정상 분기 미러)', () => {
  it('배송/완료 진입 + 미차감 → 차감(subtract, ct_stock_use=1)', () => {
    expect(resolveForceStatusStock('배송', false)).toEqual({ newStockUse: 1, action: 'subtract' });
    expect(resolveForceStatusStock('완료', false)).toEqual({ newStockUse: 1, action: 'subtract' });
  });
  it('배송/완료 진입 + 이미 차감 → 변화 없음(유지)', () => {
    expect(resolveForceStatusStock('배송', true)).toEqual({ newStockUse: 1, action: 'none' });
    expect(resolveForceStatusStock('완료', true)).toEqual({ newStockUse: 1, action: 'none' });
  });
  it('주문 역방향 + 차감돼 있음 → 복원(restore, ct_stock_use=0)', () => {
    expect(resolveForceStatusStock('주문', true)).toEqual({ newStockUse: 0, action: 'restore' });
  });
  it('주문 + 미차감 → 변화 없음', () => {
    expect(resolveForceStatusStock('주문', false)).toEqual({ newStockUse: 0, action: 'none' });
  });
  it('입금/준비 → 스톡 무변화(차감 상태 유지)', () => {
    expect(resolveForceStatusStock('입금', true)).toEqual({ newStockUse: 1, action: 'none' });
    expect(resolveForceStatusStock('입금', false)).toEqual({ newStockUse: 0, action: 'none' });
    expect(resolveForceStatusStock('준비', true)).toEqual({ newStockUse: 1, action: 'none' });
    expect(resolveForceStatusStock('준비', false)).toEqual({ newStockUse: 0, action: 'none' });
  });
  // un-cancel — 취소류 행은 WP6 가 ct_stock_use=0 으로 복원해뒀으므로 stockUsed=false 로 표현된다.
  // 판정 입력은 (target, stockUsed)뿐 — 현재 상태(취소 여부)는 stockUsed 로 이미 반영(문서화 테스트).
  it('취소류 행(ct_stock_use=0) 복귀: 배송/완료 → 차감, 주문/입금 → 무변화', () => {
    expect(resolveForceStatusStock('배송', false)).toEqual({ newStockUse: 1, action: 'subtract' });
    expect(resolveForceStatusStock('완료', false)).toEqual({ newStockUse: 1, action: 'subtract' });
    expect(resolveForceStatusStock('주문', false)).toEqual({ newStockUse: 0, action: 'none' });
    expect(resolveForceStatusStock('입금', false)).toEqual({ newStockUse: 0, action: 'none' });
  });
});
