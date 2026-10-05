import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  getConnection: vi.fn(),
  poolEnd: vi.fn(),
  query: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));

vi.mock('mysql2/promise', () => ({ createPool: mocks.createPool }));

import { closeG5Pool, reduceOrderedBomRowAmount } from './g5-db';

// 주문 헤더 1건 + BOM 카트행 1건을 흉내 내는 가짜 DB — 감액·이력이 실제로 누적되는지 본다.
interface FakeDb {
  history: string;
  ioPrice: number;
  ioId: string;
  ctStatus: string;
  orderExists: boolean;
}

let db: FakeDb;

const input = {
  odId: '2026093012345678',
  ctId: 77,
  ioId: 'bom-31',
  amount: 300,
  actorMbId: 'admin',
  note: '부품 확인 요청 #5 환불분',
  applyOnceKey: '정산#12',
};

describe('reduceOrderedBomRowAmount — BOM 주문행 감액', () => {
  beforeEach(async () => {
    await closeG5Pool();
    vi.resetAllMocks();
    process.env.G5_DATABASE_URL = 'mysql://test:test@localhost:3306/test';
    db = { history: '', ioPrice: 1000, ioId: 'bom-31', ctStatus: '입금', orderExists: true };
    mocks.getConnection.mockResolvedValue({
      query: mocks.query,
      beginTransaction: mocks.beginTransaction,
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    });
    mocks.createPool.mockReturnValue({ getConnection: mocks.getConnection, end: mocks.poolEnd });
    mocks.query.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes('LOCATE(?, od_mod_history)')) {
        return db.orderExists
          ? [[{ od_id: input.odId, applied: db.history.includes(String(params[0])) ? 1 : 0 }], []]
          : [[], []];
      }
      if (sql.includes('SELECT ct_status, io_id, io_price FROM g5_shop_cart')) {
        return [[{ ct_status: db.ctStatus, io_id: db.ioId, io_price: db.ioPrice }], []];
      }
      if (sql.includes('UPDATE g5_shop_cart SET io_price = ?')) {
        db.ioPrice = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('SET od_mod_history = CONCAT(od_mod_history, ?)')) {
        db.history += String(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      // recomputeOrderMoneyOnItemChange 의 조회 2건·갱신 1건
      if (sql.includes('SELECT od_tax_flag')) return [[{ od_tax_flag: 0, od_receipt_price: 1000 }], []];
      if (sql.includes('AS active_price')) return [[{ active_price: db.ioPrice, cancel_price: 0 }], []];
      return [{ affectedRows: 1 }, []];
    });
  });

  afterEach(async () => {
    await closeG5Pool();
    delete process.env.G5_DATABASE_URL;
  });

  it('잠근 뒤 읽은 금액에서 빼고 표식을 이력에 남긴다', async () => {
    const result = await reduceOrderedBomRowAmount(input);
    expect(result).toEqual({ result: 'ok', fromPrice: 1000, toPrice: 700 });
    expect(db.ioPrice).toBe(700);
    expect(db.history).toContain('1,000→700원');
    expect(db.history).toContain('[정산#12]');
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('같은 표식으로 다시 부르면 금액을 다시 깎지 않는다(더블클릭·재시도)', async () => {
    await reduceOrderedBomRowAmount(input);
    const second = await reduceOrderedBomRowAmount(input);
    expect(second).toEqual({ result: 'ALREADY_APPLIED' });
    expect(db.ioPrice).toBe(700);
    expect(db.history.match(/\[정산#12\]/g)).toHaveLength(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.rollback).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('다른 정산은 같은 주문행을 이어서 줄인다(표식 앞부분이 겹쳐도 구분)', async () => {
    await reduceOrderedBomRowAmount(input);
    const other = await reduceOrderedBomRowAmount({ ...input, amount: 100, applyOnceKey: '정산#1' });
    expect(other).toEqual({ result: 'ok', fromPrice: 700, toPrice: 600 });
    expect(db.ioPrice).toBe(600);
  });

  it('감액액이 현재 금액보다 크면 아무것도 바꾸지 않는다', async () => {
    const result = await reduceOrderedBomRowAmount({ ...input, amount: 1001 });
    expect(result).toEqual({ result: 'AMOUNT_EXCEEDS' });
    expect(db.ioPrice).toBe(1000);
    expect(db.history).toBe('');
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('전액 감액(0원)은 허용한다', async () => {
    const result = await reduceOrderedBomRowAmount({ ...input, amount: 1000 });
    expect(result).toEqual({ result: 'ok', fromPrice: 1000, toPrice: 0 });
  });

  it('주문이 없거나 줄이 바뀌었으면 거부한다', async () => {
    db.orderExists = false;
    expect(await reduceOrderedBomRowAmount(input)).toEqual({ result: 'ORDER_NOT_FOUND' });
    db.orderExists = true;
    db.ioId = 'bom-99';
    expect(await reduceOrderedBomRowAmount(input)).toEqual({ result: 'ROW_CHANGED' });
    db.ioId = 'bom-31';
    db.ctStatus = '취소';
    expect(await reduceOrderedBomRowAmount(input)).toEqual({ result: 'ROW_CHANGED' });
    expect(db.ioPrice).toBe(1000);
  });

  it('0 이하·정수가 아닌 감액액은 호출 오류다', async () => {
    await expect(reduceOrderedBomRowAmount({ ...input, amount: 0 })).rejects.toThrow();
    await expect(reduceOrderedBomRowAmount({ ...input, amount: 1.5 })).rejects.toThrow();
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
});
