import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  poFindUnique: vi.fn(),
  poFindFirst: vi.fn(),
  transaction: vi.fn(),
  txPoUpdateMany: vi.fn(),
  txReviewFindMany: vi.fn(),
  txReviewUpdateMany: vi.fn(),
  txEventCreate: vi.fn(),
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
    prismaMocks.txReviewFindMany.mockResolvedValue([]);
    prismaMocks.txReviewUpdateMany.mockResolvedValue({ count: 0 });
    prismaMocks.txEventCreate.mockResolvedValue({});
    prismaMocks.transaction.mockImplementation(
      async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          spPcbPo: { updateMany: prismaMocks.txPoUpdateMany },
          spPcbEqReview: {
            findMany: prismaMocks.txReviewFindMany,
            updateMany: prismaMocks.txReviewUpdateMany,
          },
          spPcbEqReviewEvent: { create: prismaMocks.txEventCreate },
        }),
    );
  });

  it('되돌리기: 읽은 상태를 조건으로 쓰고, 이력을 남기고, 고객 확인(작성 중 포함)을 닫는다', async () => {
    prismaMocks.poFindUnique.mockResolvedValue(po());
    prismaMocks.txPoUpdateMany.mockResolvedValue({ count: 1 });
    // 열린 회차 둘 — 하나는 그사이 고객이 답해 조건부 갱신이 비켜 간다(이벤트도 없어야 한다).
    prismaMocks.txReviewFindMany.mockResolvedValue([{ id: 31n }, { id: 32n }]);
    prismaMocks.txReviewUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

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
    expect(prismaMocks.txReviewFindMany).toHaveBeenCalledWith({
      where: { poId: 7n, status: { in: ['draft', 'requested'] } },
      select: { id: true },
    });
    expect(prismaMocks.txReviewUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 31n, status: { in: ['draft', 'requested'] } },
      data: { status: 'canceled', version: { increment: 1 } },
    });
    // 닫힌 회차에만 시스템 이벤트 — answered 로 비켜 간 32 에는 남기지 않는다.
    expect(prismaMocks.txEventCreate).toHaveBeenCalledTimes(1);
    expect(prismaMocks.txEventCreate).toHaveBeenCalledWith({
      data: { reviewId: 31n, action: 'canceled', actorRole: 'system', note: '발주 EQ 상태 변경' },
    });
  });

  it('되돌리기: 그사이 상태가 바뀌었으면 아무것도 더 쓰지 않고 INVALID_STATUS', async () => {
    prismaMocks.poFindUnique.mockResolvedValue(po());
    prismaMocks.txPoUpdateMany.mockResolvedValue({ count: 0 });

    const result = await revertPcbPoEq(7n, { kind: 'admin' });

    expect(result).toEqual({ ok: false, error: 'INVALID_STATUS' });
    expect(prismaMocks.txPoUpdateMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.txReviewFindMany).not.toHaveBeenCalled();
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
