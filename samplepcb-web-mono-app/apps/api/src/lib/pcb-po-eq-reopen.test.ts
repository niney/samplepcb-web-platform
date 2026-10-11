import { beforeEach, describe, expect, it, vi } from 'vitest';

// D20 후속 — ① EQ 승인이 고객 회신을 협력사에 함께 전달한다(R-1) ② 협력사의 추가 EQ 요청(R-2·R-4)
// ③ '그 뒤 새 파일'의 경계가 반려뿐 아니라 추가 EQ 요청이기도 하다. DB 는 가짜다 — 가드·쓰기 모양만 본다.

const m = vi.hoisted(() => ({
  poFindUnique: vi.fn(),
  poFindFirst: vi.fn(),
  specFindMany: vi.fn(),
  specFindUnique: vi.fn(),
  transaction: vi.fn(),
  txPoUpdateMany: vi.fn(),
  txReviewFindMany: vi.fn(),
  txReviewUpdateMany: vi.fn(),
  txEventCreate: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spPcbPo: { findUnique: m.poFindUnique, findFirst: m.poFindFirst },
    // 트랙(category)과 주문 취소 가드(ctId 없음 = 취소 아님)가 스펙을 읽는다.
    spOrderSpec: { findMany: m.specFindMany, findUnique: m.specFindUnique },
    $transaction: m.transaction,
  },
}));

import { advancePcbPoEq, eqReworkStamps, reopenPcbPoEq } from './pcb-po';

const po = (overrides: Record<string, unknown> = {}) => ({
  id: 7n,
  specId: 100n,
  partnerId: 3n,
  parentPartnerId: 0n,
  reorderRound: 0,
  fulfillmentMode: 'self',
  status: 'eq_done',
  eqHistory: [],
  ...overrides,
});

const PARTNER = { kind: 'partner' as const, partnerId: 3n };

beforeEach(() => {
  vi.clearAllMocks();
  m.poFindFirst.mockResolvedValue(null);
  m.specFindMany.mockResolvedValue([{ id: 100n, category: 'standard' }]);
  m.specFindUnique.mockResolvedValue({ id: 100n, ctId: null });
  m.txPoUpdateMany.mockResolvedValue({ count: 1 });
  m.txReviewFindMany.mockResolvedValue([]);
  m.txReviewUpdateMany.mockResolvedValue({ count: 1 });
  m.txEventCreate.mockResolvedValue({});
  m.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) =>
    run({
      spPcbPo: { updateMany: m.txPoUpdateMany },
      spPcbEqReview: { findMany: m.txReviewFindMany, updateMany: m.txReviewUpdateMany },
      spPcbEqReviewEvent: { create: m.txEventCreate },
    }),
  );
});

describe('EQ 승인 — 고객 회신을 협력사에 함께 전달한다(R-1)', () => {
  it('회신이 왔고 아직 전달 전인 문항형 회차를 같은 트랜잭션에서 전달 처리한다', async () => {
    m.poFindUnique.mockResolvedValue(po({ status: 'eq_requested' }));
    m.txReviewFindMany
      .mockResolvedValueOnce([]) // 열린 회차(닫을 것) 없음
      .mockResolvedValueOnce([{ id: 41n }, { id: 42n }]); // 회신 왔고 미전달
    m.txReviewUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // 42 는 그사이 수동 전달이 먼저 갔다

    const res = await advancePcbPoEq(7n, { kind: 'admin', mbId: 'boss' }, 'eq_requested');

    expect(res).toEqual({ ok: true, to: 'eq_done', forwardedReviewIds: [41n] });
    // 전달 대상 = 문항형 · answered · 미전달(문구형·이미 전달된 회차·회신 전 회차는 대상이 아니다).
    expect(m.txReviewFindMany.mock.calls[1]?.[0]).toMatchObject({
      where: { poId: 7n, format: 'items', status: 'answered', forwardedAt: null },
    });
    const write = m.txReviewUpdateMany.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(write.where).toEqual({ id: 41n, status: 'answered', forwardedAt: null });
    expect(write.data).toMatchObject({ forwardedBy: 'boss', version: { increment: 1 } });
    expect(write.data.forwardedAt).toBeInstanceOf(Date);
    // 이벤트는 실제로 전달된 회차에만.
    expect(m.txEventCreate).toHaveBeenCalledTimes(1);
    expect(m.txEventCreate).toHaveBeenCalledWith({
      data: { reviewId: 41n, action: 'forwarded', actorRole: 'admin', actorMbId: 'boss', note: '승인과 함께 전달' },
    });
  });

  it('승인이 밀리면(동시 조작) 전달도 일어나지 않는다', async () => {
    m.poFindUnique.mockResolvedValue(po({ status: 'eq_requested' }));
    m.txPoUpdateMany.mockResolvedValue({ count: 0 });
    expect(await advancePcbPoEq(7n, { kind: 'admin', mbId: 'boss' }, 'eq_requested')).toEqual({
      ok: false,
      error: 'INVALID_STATUS',
    });
    expect(m.txReviewFindMany).not.toHaveBeenCalled();
    expect(m.txEventCreate).not.toHaveBeenCalled();
  });

  it('승인이 아닌 전이(생산 시작)는 전달을 건드리지 않는다', async () => {
    m.poFindUnique.mockResolvedValue(po({ status: 'eq_done' }));
    const res = await advancePcbPoEq(7n, PARTNER, 'eq_done');
    expect(res).toEqual({ ok: true, to: 'producing', forwardedReviewIds: [] });
    expect(m.txReviewFindMany).toHaveBeenCalledTimes(1); // 열린 회차 조회뿐
  });
});

describe('추가 EQ 요청 — eq_done → issued(R-2·R-4)', () => {
  it('수주 협력사가 사유와 함께 요청하면 발주접수로 돌아가고 사유가 이력에 남는다', async () => {
    m.poFindUnique.mockResolvedValue(po());
    expect(await reopenPcbPoEq(7n, PARTNER, '  2번 문항 답대로면 랜드가 부족합니다  ')).toEqual({ ok: true });
    const write = m.txPoUpdateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { status: string; eqHistory: Record<string, unknown>[] };
    };
    expect(write.where).toEqual({ id: 7n, status: 'eq_done' });
    expect(write.data.status).toBe('issued');
    expect(write.data.eqHistory.at(-1)).toMatchObject({
      byRole: 'PARTNER',
      fromStatus: 'eq_done',
      toStatus: 'issued',
      note: '2번 문항 답대로면 랜드가 부족합니다',
    });
    // 회신 전달은 승인의 일이다 — 여기서는 일어나지 않는다.
    expect(m.txEventCreate).not.toHaveBeenCalled();
  });

  it('MD 가 하위 수주자 대신 요청하면 byRole MASTER_DEALER, 상위 발주서에 상태를 미러한다', async () => {
    m.poFindUnique.mockResolvedValue(po({ partnerId: 12n, parentPartnerId: 9n, reorderRound: 1 }));
    expect(await reopenPcbPoEq(7n, { kind: 'partner', partnerId: 9n }, '추가 확인')).toEqual({ ok: true });
    const first = m.txPoUpdateMany.mock.calls[0]?.[0] as { data: { eqHistory: { byRole: string }[] } };
    expect(first.data.eqHistory.at(-1)?.byRole).toBe('MASTER_DEALER');
    expect(m.txPoUpdateMany.mock.calls[1]?.[0]).toEqual({
      where: { specId: 100n, partnerId: 9n, parentPartnerId: 0n, reorderRound: 1 },
      data: { status: 'issued' },
    });
  });

  it('관리자 대행은 차례와 무관하게 되고 byRole ADMIN 으로 남는다(D11)', async () => {
    m.poFindUnique.mockResolvedValue(po());
    expect(await reopenPcbPoEq(7n, { kind: 'admin', mbId: 'boss' }, '협력사 요청 대행')).toEqual({ ok: true });
    const write = m.txPoUpdateMany.mock.calls[0]?.[0] as { data: { eqHistory: { byRole: string }[] } };
    expect(write.data.eqHistory.at(-1)?.byRole).toBe('ADMIN');
  });

  it('사유가 비면 REASON_REQUIRED — 아무것도 읽지 않는다', async () => {
    expect(await reopenPcbPoEq(7n, PARTNER, '   ')).toEqual({ ok: false, error: 'REASON_REQUIRED' });
    expect(m.poFindUnique).not.toHaveBeenCalled();
  });

  it('스텐실 발주는 어느 단계에서든 NOT_EQ_TRACK(R-4)', async () => {
    m.specFindMany.mockResolvedValue([{ id: 100n, category: 'metalMask' }]);
    for (const status of ['eq_done', 'issued', 'producing']) {
      m.poFindUnique.mockResolvedValue(po({ status }));
      expect(await reopenPcbPoEq(7n, PARTNER, '좌표 수정')).toEqual({ ok: false, error: 'NOT_EQ_TRACK' });
    }
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('승인 전·생산 시작 뒤에는 INVALID_STATUS — 생산이 시작되면 EQ 가 아니라 A/S 의 일이다', async () => {
    for (const status of ['issued', 'eq_requested', 'producing', 'produced']) {
      m.poFindUnique.mockResolvedValue(po({ status }));
      expect(await reopenPcbPoEq(7n, PARTNER, '추가 확인')).toEqual({ ok: false, error: 'INVALID_STATUS' });
    }
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('위임 상위(MD 수주, 하위에 맡긴 건)에서는 DELEGATED — 하위 발주서에서 한다', async () => {
    m.poFindUnique.mockResolvedValue(po({ fulfillmentMode: 'delegated' }));
    m.poFindFirst.mockResolvedValue({ id: 8n }); // 하위 발주서가 있다
    expect(await reopenPcbPoEq(7n, PARTNER, '추가 확인')).toEqual({ ok: false, error: 'DELEGATED' });
    expect(await reopenPcbPoEq(7n, { kind: 'admin' }, '추가 확인')).toEqual({ ok: false, error: 'DELEGATED' });
  });

  it('남의 발주서는 NOT_YOUR_TURN, 없는 발주서는 PO_NOT_FOUND', async () => {
    m.poFindUnique.mockResolvedValue(po());
    expect(await reopenPcbPoEq(7n, { kind: 'partner', partnerId: 99n }, '추가 확인')).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    m.poFindUnique.mockResolvedValue(null);
    expect(await reopenPcbPoEq(7n, PARTNER, '추가 확인')).toEqual({ ok: false, error: 'PO_NOT_FOUND' });
  });

  it('그사이 생산이 시작됐으면(동시 조작) 아무것도 쓰지 않고 INVALID_STATUS', async () => {
    m.poFindUnique.mockResolvedValue(po());
    m.txPoUpdateMany.mockResolvedValue({ count: 0 });
    expect(await reopenPcbPoEq(7n, PARTNER, '추가 확인')).toEqual({ ok: false, error: 'INVALID_STATUS' });
    expect(m.txReviewFindMany).not.toHaveBeenCalled();
  });
});

describe("'그 뒤 새 파일'의 경계 — 반려 또는 추가 EQ 요청 중 가장 최근", () => {
  const ev = (at: string, fromStatus: string, toStatus: string, note: string | null = null) => ({
    at,
    byRole: 'ADMIN',
    fromStatus,
    toStatus,
    note,
  });
  const REJECT = ev('2026-10-01T00:00:00.000Z', 'eq_requested', 'issued', '도면 누락');
  const REOPEN = ev('2026-10-05T00:00:00.000Z', 'eq_done', 'issued', '랜드 부족');

  it('경계가 없으면 셋 다 null — 요청 취소(사유 없는 되돌리기)는 경계가 아니다', () => {
    expect(eqReworkStamps([])).toEqual({ rejectedAt: null, reopenedAt: null, boundaryAt: null });
    expect(eqReworkStamps([ev('2026-10-01T00:00:00.000Z', 'eq_requested', 'issued')])).toEqual({
      rejectedAt: null,
      reopenedAt: null,
      boundaryAt: null,
    });
  });

  it('반려만 있으면 rejectedAt', () => {
    expect(eqReworkStamps([REJECT])).toEqual({ rejectedAt: REJECT.at, reopenedAt: null, boundaryAt: REJECT.at });
  });

  it('예전에 반려된 건을 승인 뒤 다시 열었으면 reopenedAt 만 선다 — 옛 반려를 남기면 목록이 거짓말한다', () => {
    const history = [
      REJECT,
      ev('2026-10-02T00:00:00.000Z', 'issued', 'eq_requested'),
      ev('2026-10-03T00:00:00.000Z', 'eq_requested', 'eq_done'),
      REOPEN,
    ];
    expect(eqReworkStamps(history)).toEqual({ rejectedAt: null, reopenedAt: REOPEN.at, boundaryAt: REOPEN.at });
  });

  it('다시 연 뒤 재요청이 반려되면 경계는 그 반려로 옮겨 간다', () => {
    const laterReject = ev('2026-10-07T00:00:00.000Z', 'eq_requested', 'issued', '아직 부족');
    const history = [REOPEN, ev('2026-10-06T00:00:00.000Z', 'issued', 'eq_requested'), laterReject];
    expect(eqReworkStamps(history)).toEqual({
      rejectedAt: laterReject.at,
      reopenedAt: null,
      boundaryAt: laterReject.at,
    });
  });

  it('승인 취소(eq_done → eq_requested)는 추가 EQ 요청이 아니다', () => {
    expect(eqReworkStamps([ev('2026-10-05T00:00:00.000Z', 'eq_done', 'eq_requested')]).reopenedAt).toBeNull();
  });
});
