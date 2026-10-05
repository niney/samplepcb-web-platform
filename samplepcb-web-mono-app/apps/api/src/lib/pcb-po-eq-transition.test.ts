import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  poFindUnique: vi.fn(),
  poFindFirst: vi.fn(),
  transaction: vi.fn(),
  txPoUpdateMany: vi.fn(),
  txReviewUpdateMany: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spPcbPo: { findUnique: prismaMocks.poFindUnique, findFirst: prismaMocks.poFindFirst },
    $transaction: prismaMocks.transaction,
  },
}));

import { rejectPcbPoEq, revertPcbPoEq } from './pcb-po';

// 전이 저장은 "읽은 상태가 그대로일 때만" 쓴다 — 동시 조작으로 상태가 바뀌었으면
// 이력·고객 확인·상위 미러 어느 것도 건드리지 않고 INVALID_STATUS 로 끝난다.
const po = (overrides: Record<string, unknown> = {}) => ({
  id: 7n,
  specId: 100n,
  partnerId: 3n,
  parentPartnerId: 0n,
  reorderRound: 0,
  fulfillmentMode: 'self',
  status: 'eq_requested',
  eqHistory: [],
  ...overrides,
});

describe('PCB 발주 EQ 전이 — 상태 가드', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.poFindFirst.mockResolvedValue(null);
    prismaMocks.txReviewUpdateMany.mockResolvedValue({ count: 0 });
    prismaMocks.transaction.mockImplementation(
      async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          spPcbPo: { updateMany: prismaMocks.txPoUpdateMany },
          spPcbEqReview: { updateMany: prismaMocks.txReviewUpdateMany },
        }),
    );
  });

  it('되돌리기: 읽은 상태를 조건으로 쓰고, 이력을 남기고, 고객 확인을 닫는다', async () => {
    prismaMocks.poFindUnique.mockResolvedValue(po());
    prismaMocks.txPoUpdateMany.mockResolvedValue({ count: 1 });

    const result = await revertPcbPoEq(7n, { kind: 'admin' });

    expect(result).toEqual({ ok: true, to: 'issued' });
    expect(prismaMocks.txPoUpdateMany).toHaveBeenCalledTimes(1);
    const call = prismaMocks.txPoUpdateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { status: string; eqHistory: { fromStatus: string; toStatus: string; note: string | null }[] };
    };
    expect(call.where).toEqual({ id: 7n, status: 'eq_requested' });
    expect(call.data.status).toBe('issued');
    expect(call.data.eqHistory).toHaveLength(1);
    expect(call.data.eqHistory[0]).toMatchObject({ fromStatus: 'eq_requested', toStatus: 'issued', note: null });
    expect(prismaMocks.txReviewUpdateMany).toHaveBeenCalledWith({
      where: { poId: 7n, status: 'requested' },
      data: { status: 'canceled' },
    });
  });

  it('되돌리기: 그사이 상태가 바뀌었으면 아무것도 더 쓰지 않고 INVALID_STATUS', async () => {
    prismaMocks.poFindUnique.mockResolvedValue(po());
    prismaMocks.txPoUpdateMany.mockResolvedValue({ count: 0 });

    const result = await revertPcbPoEq(7n, { kind: 'admin' });

    expect(result).toEqual({ ok: false, error: 'INVALID_STATUS' });
    expect(prismaMocks.txPoUpdateMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.txReviewUpdateMany).not.toHaveBeenCalled();
  });

  it('반려: 밀리면 INVALID_STATUS, 성공하면 사유가 이력에 남는다', async () => {
    prismaMocks.poFindUnique.mockResolvedValue(po());
    prismaMocks.txPoUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await rejectPcbPoEq(7n, '도면 누락')).toEqual({ ok: false, error: 'INVALID_STATUS' });

    prismaMocks.txPoUpdateMany.mockResolvedValueOnce({ count: 1 });
    expect(await rejectPcbPoEq(7n, '도면 누락')).toEqual({ ok: true });
    const call = prismaMocks.txPoUpdateMany.mock.calls[1]?.[0] as {
      data: { status: string; eqHistory: { byRole: string; note: string | null }[] };
    };
    expect(call.data.status).toBe('issued');
    expect(call.data.eqHistory[0]).toMatchObject({ byRole: 'ADMIN', note: '도면 누락' });
  });

  it('하위 발주(MD 경유)는 같은 회차 상위 발주서에 상태를 미러한다', async () => {
    prismaMocks.poFindUnique.mockResolvedValue(po({ parentPartnerId: 9n, partnerId: 12n, reorderRound: 1 }));
    prismaMocks.txPoUpdateMany.mockResolvedValue({ count: 1 });

    const result = await revertPcbPoEq(7n, { kind: 'admin' });

    expect(result).toEqual({ ok: true, to: 'issued' });
    expect(prismaMocks.txPoUpdateMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.txPoUpdateMany.mock.calls[1]?.[0]).toEqual({
      where: { specId: 100n, partnerId: 9n, parentPartnerId: 0n, reorderRound: 1 },
      data: { status: 'issued' },
    });
  });
});
