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

import { closeG5Pool, deleteUnpaidOrder } from './g5-db';

const sqlText = (query: unknown): string => {
  if (typeof query === 'string') return query;
  if (typeof query === 'object' && query !== null && 'sql' in query) {
    return String(query.sql);
  }
  return '';
};

describe('SmartBOM 결제 주문 강제 로컬 삭제', () => {
  beforeEach(async () => {
    await closeG5Pool();
    vi.resetAllMocks();
    process.env.G5_DATABASE_URL = 'mysql://test:test@localhost:3306/test';
    mocks.getConnection.mockResolvedValue({
      query: mocks.query,
      beginTransaction: mocks.beginTransaction,
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    });
    mocks.createPool.mockReturnValue({
      getConnection: mocks.getConnection,
      end: mocks.poolEnd,
    });
    mocks.query.mockImplementation((query: unknown) => {
      const sql = sqlText(query);
      if (sql.includes('SELECT * FROM g5_shop_order')) {
        return [[{
          od_id: '202608010001',
          mb_id: 'member',
          od_status: '배송',
          od_receipt_price: '10000',
          od_receipt_point: '0',
          od_cart_coupon: '0',
          od_coupon: '0',
          od_send_coupon: '0',
          od_tno: 'pg-transaction',
        }], []];
      }
      if (sql.includes('FROM g5_shop_cart') && sql.includes('FOR UPDATE')) {
        return [[{
          ct_id: 77,
          ct_status: '배송',
          ct_stock_use: 1,
          ct_qty: 2,
          it_id: 'sp-bom-parts',
          io_id: 'bom-31',
        }], []];
      }
      if (sql.includes('FROM g5_point') && sql.includes('FOR UPDATE')) return [[], []];
      return [{ affectedRows: 1, insertId: 1 }, []];
    });
  });

  afterEach(async () => {
    await closeG5Pool();
    delete process.env.G5_DATABASE_URL;
  });

  it('강제 옵션이 없으면 결제 흔적을 확인한 직후 롤백한다', async () => {
    const outcome = await deleteUnpaidOrder(
      '202608010001',
      'admin',
      '127.0.0.1',
      { ctId: 77, itId: 'sp-bom-parts', ioId: 'bom-31', ctStatus: '배송' },
      { deleteExclusiveCart: true, retainBackup: false },
    );

    expect(outcome).toBe('paid');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('강제 옵션이면 주문 보조 원장·cart·주문을 트랜잭션에서 삭제하고 재고를 복원한다', async () => {
    const outcome = await deleteUnpaidOrder(
      '202608010001',
      'admin',
      '127.0.0.1',
      { ctId: 77, itId: 'sp-bom-parts', ioId: 'bom-31', ctStatus: '배송' },
      {
        deleteExclusiveCart: true,
        retainBackup: false,
        allowPaymentEvidence: true,
      },
    );

    expect(outcome).toBe('deleted');
    expect(mocks.beginTransaction).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();

    const statements = mocks.query.mock.calls.map(([query]) => sqlText(query));
    for (const table of [
      'g5_shop_order_delete',
      'g5_shop_coupon_log',
      'g5_shop_coupon',
      'g5_shop_order_data',
      'g5_shop_personalpay',
      'g5_shop_order_post_log',
      'g5_shop_inicis_log',
      'g5_shop_cart',
      'g5_shop_order',
    ]) {
      expect(statements.some((statement) => statement.includes(`DELETE FROM ${table}`))).toBe(true);
    }
    expect(
      statements.some((statement) => statement.includes('SET io_stock_qty = io_stock_qty + ?')),
    ).toBe(true);
    expect(statements.some((statement) => statement.includes('SET it_sum_qty ='))).toBe(true);
  });

  it('주문 포인트 원장을 삭제하고 사용분·누계·회원 포인트를 다시 맞춘다', async () => {
    mocks.query.mockImplementation((query: unknown) => {
      const sql = sqlText(query);
      if (sql.includes('SELECT * FROM g5_shop_order')) {
        return [[{
          od_id: '202608010001',
          mb_id: 'member',
          od_status: '입금',
          od_receipt_price: '10000',
          od_receipt_point: '100',
          od_cart_coupon: '0',
          od_coupon: '0',
          od_send_coupon: '0',
          od_tno: '',
        }], []];
      }
      if (sql.includes('FROM g5_shop_cart') && sql.includes('FOR UPDATE')) {
        return [[{
          ct_id: 77,
          ct_status: '입금',
          ct_stock_use: 0,
          ct_qty: 1,
          it_id: 'sp-bom-parts',
          io_id: 'bom-31',
        }], []];
      }
      if (sql.includes('FROM g5_point') && sql.includes('FOR UPDATE')) {
        return [[
          {
            po_id: 1,
            po_content: '기존 적립',
            po_point: 500,
            po_use_point: 100,
            po_expired: 100,
            po_expire_date: '9999-12-31',
            po_rel_table: '',
            po_rel_id: '',
            po_rel_action: '',
          },
          {
            po_id: 2,
            po_content: '주문번호 202608010001 결제',
            po_point: -100,
            po_use_point: 0,
            po_expired: 1,
            po_expire_date: '2026-08-01',
            po_rel_table: '',
            po_rel_id: '',
            po_rel_action: '',
          },
          {
            po_id: 3,
            po_content: '배송완료 적립',
            po_point: 20,
            po_use_point: 10,
            po_expired: 0,
            po_expire_date: '9999-12-31',
            po_rel_table: '@delivery',
            po_rel_id: 'member',
            po_rel_action: '202608010001,77',
          },
          {
            po_id: 4,
            po_content: '다른 적립',
            po_point: 50,
            po_use_point: 0,
            po_expired: 0,
            po_expire_date: '9999-12-31',
            po_rel_table: '',
            po_rel_id: '',
            po_rel_action: '',
          },
        ], []];
      }
      return [{ affectedRows: 1, insertId: 1 }, []];
    });

    await deleteUnpaidOrder(
      '202608010001',
      'admin',
      '127.0.0.1',
      { ctId: 77, itId: 'sp-bom-parts', ioId: 'bom-31', ctStatus: '입금' },
      {
        deleteExclusiveCart: true,
        retainBackup: false,
        allowPaymentEvidence: true,
      },
    );

    const pointDeleteCall = mocks.query.mock.calls.find(([query]) =>
      sqlText(query).includes('DELETE FROM g5_point WHERE po_id IN'),
    );
    expect(pointDeleteCall?.[1]).toEqual([2, 3]);
    const memberUpdateCall = mocks.query.mock.calls.find(([query]) =>
      sqlText(query).includes('UPDATE g5_member SET mb_point'),
    );
    expect(memberUpdateCall?.[1]).toEqual([550, 'member']);
  });
});
