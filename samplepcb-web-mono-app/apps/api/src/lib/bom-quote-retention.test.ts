import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quoteCount: vi.fn(),
  quoteFindMany: vi.fn(),
  quoteFindFirst: vi.fn(),
  configFindUnique: vi.fn(),
  configUpsert: vi.fn(),
  loadPlan: vi.fn(),
  purge: vi.fn(),
  retentionDays: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spBomQuote: {
      count: mocks.quoteCount,
      findMany: mocks.quoteFindMany,
      findFirst: mocks.quoteFindFirst,
    },
    spConfig: { findUnique: mocks.configFindUnique, upsert: mocks.configUpsert },
  },
}));
vi.mock('./bom-case-delete', () => ({
  loadBomCaseDeletePlan: mocks.loadPlan,
  purgeBomCase: mocks.purge,
}));
vi.mock('./bom-quote-cancel', () => ({ settleCanceledQuoteSearchState: mocks.settle }));
vi.mock('./bom-quote-retention-config', () => ({ getCanceledQuoteRetentionDays: mocks.retentionDays }));

import {
  CANCELED_QUOTE_CLEANUP_INTERVAL_MS,
  getCanceledQuoteCleanupStatus,
  retentionHealth,
  runCanceledQuoteCleanup,
} from './bom-quote-retention';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

const target = (id: bigint, title = `견적 ${String(id)}`) => ({
  id,
  title,
  canceledAt: new Date('2026-09-01T00:00:00.000Z'),
  purgeAfter: new Date('2026-10-01T00:00:00.000Z'),
});

const plan = (overrides: { status?: string; ctId?: number | null; blockers?: string[] } = {}) => ({
  preview: { previewToken: 'a'.repeat(64), blockers: overrides.blockers ?? [] },
  quote: { status: overrides.status ?? 'canceled', ctId: overrides.ctId ?? null },
});

describe('취소 견적 자동 정리 — 실행', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retentionDays.mockResolvedValue(30);
    mocks.settle.mockResolvedValue(undefined);
    mocks.configUpsert.mockResolvedValue({});
    mocks.purge.mockResolvedValue({});
  });

  it('보존 기간이 0 이면 아무것도 읽거나 쓰지 않는다(꺼짐)', async () => {
    mocks.retentionDays.mockResolvedValue(0);

    expect(await runCanceledQuoteCleanup(log, { trigger: 'timer' })).toEqual({
      ok: false,
      reason: 'disabled',
    });
    expect(mocks.quoteFindMany).not.toHaveBeenCalled();
    expect(mocks.configUpsert).not.toHaveBeenCalled();
  });

  it('기한이 지난 취소 견적만 고르고, 관리자 강제 삭제와 같은 경로로 시스템 이름으로 지운다', async () => {
    mocks.quoteCount.mockResolvedValue(2);
    mocks.quoteFindMany.mockResolvedValue([target(1n), target(2n)]);
    mocks.loadPlan.mockResolvedValue(plan());

    const result = await runCanceledQuoteCleanup(log, { trigger: 'manual', actorMbId: 'admin' });

    const where = (mocks.quoteFindMany.mock.calls[0]?.[0] as { where: { status: string; purgeAfter: { lte: Date } } }).where;
    expect(where.status).toBe('canceled');
    expect(where.purgeAfter.lte).toBeInstanceOf(Date);
    expect(mocks.settle).toHaveBeenCalledTimes(2); // 굳은 검색 상태를 먼저 푼다
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    const [, body, actor] = mocks.purge.mock.calls[0] as [unknown, Record<string, unknown>, unknown];
    expect(body).toMatchObject({ mode: 'audited', previewToken: 'a'.repeat(64), acknowledgeIrreversible: true });
    expect(String(body.reason)).toContain('보존 기간 경과');
    expect(actor).toEqual({ mbId: 'system:retention', ip: '' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run).toMatchObject({ trigger: 'manual', actorMbId: 'admin', due: 2, deleted: 2, deferred: 0 });
    expect(result.run.skipped).toEqual([]);
    expect(result.run.failed).toEqual([]);
    // 실행 요약은 설정 테이블 한 행에 덮어쓴다
    const upsert = mocks.configUpsert.mock.calls[0]?.[0] as { where: { key: string }; update: { value: string } };
    expect(upsert.where.key).toBe('bom_canceled_quote_cleanup_last_run');
    expect(JSON.parse(upsert.update.value)).toMatchObject({ deleted: 2 });
  });

  it('차단 사유·주문 연결·상태 불일치는 건드리지 않고, 한 건의 실패는 그 건에만 머문다', async () => {
    mocks.quoteCount.mockResolvedValue(6);
    mocks.quoteFindMany.mockResolvedValue([target(1n), target(2n), target(3n), target(4n), target(5n), target(6n)]);
    mocks.loadPlan
      .mockResolvedValueOnce(plan({ blockers: ['ENGINE_JOB_IN_PROGRESS'] }))
      .mockResolvedValueOnce(plan({ ctId: 77 }))
      .mockResolvedValueOnce(plan({ status: 'answered' }))
      .mockResolvedValueOnce(null) // 그 사이 관리자가 지웠다
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(plan());
    mocks.purge.mockRejectedValueOnce(new Error('engine down')).mockResolvedValueOnce({});

    const result = await runCanceledQuoteCleanup(log, { trigger: 'timer' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.skipped).toEqual([
      { quoteId: '1', title: '견적 1', blockers: ['ENGINE_JOB_IN_PROGRESS'] },
      { quoteId: '2', title: '견적 2', blockers: ['ORDER_LINKED'] },
      { quoteId: '3', title: '견적 3', blockers: ['NOT_CANCELED'] },
    ]);
    expect(result.run.failed).toEqual([{ quoteId: '5', title: '견적 5', error: 'Error: engine down' }]);
    expect(result.run.deleted).toBe(1);
  });

  it('1회 상한을 넘는 건수는 다음 주기로 미룬다', async () => {
    mocks.quoteCount.mockResolvedValue(120);
    mocks.quoteFindMany.mockResolvedValue([target(1n)]);
    mocks.loadPlan.mockResolvedValue(plan());

    const result = await runCanceledQuoteCleanup(log, { trigger: 'timer' });

    expect(result.ok && result.run.deferred).toBe(119);
  });

  it('도는 중에 다시 부르면 running 으로 돌려보낸다', async () => {
    let release: (value: number) => void = () => undefined;
    mocks.quoteCount.mockReturnValue(new Promise<number>((resolve) => { release = resolve; }));
    mocks.quoteFindMany.mockResolvedValue([]);

    const first = runCanceledQuoteCleanup(log, { trigger: 'timer' });
    await Promise.resolve();
    await Promise.resolve();
    expect(await runCanceledQuoteCleanup(log, { trigger: 'manual' })).toEqual({ ok: false, reason: 'running' });
    release(0);
    expect((await first).ok).toBe(true);
  });
});

describe('취소 견적 자동 정리 — 정상 판정', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * 3_600_000);

  it('보존 기간 0 이면 꺼짐', () => {
    expect(retentionHealth({ retentionDays: 0, lastRunFinishedAt: null, overdueCount: 3, now })).toBe('disabled');
  });

  it('실행 기록이 없거나 두 주기보다 오래되면 멈춤', () => {
    expect(retentionHealth({ retentionDays: 30, lastRunFinishedAt: null, overdueCount: 0, now })).toBe('stale');
    expect(retentionHealth({ retentionDays: 30, lastRunFinishedAt: hoursAgo(13), overdueCount: 0, now })).toBe('stale');
    expect(retentionHealth({ retentionDays: 30, lastRunFinishedAt: hoursAgo(11), overdueCount: 0, now })).toBe('ok');
  });

  it('돌고는 있는데 지웠어야 할 견적이 남아 있으면 밀림', () => {
    expect(retentionHealth({ retentionDays: 30, lastRunFinishedAt: hoursAgo(1), overdueCount: 2, now })).toBe('backlog');
  });
});

describe('취소 견적 자동 정리 — 상태 조회', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retentionDays.mockResolvedValue(30);
  });

  it('한 주기 넘게 지난 것만 "기한 경과 미삭제"로 세고, 못 지운 이유는 마지막 실행에서 붙인다', async () => {
    const lastRun = {
      trigger: 'timer',
      actorMbId: null,
      startedAt: '2026-10-05T09:00:00.000Z',
      finishedAt: '2026-10-05T09:00:02.000Z',
      retentionDays: 30,
      due: 2,
      deleted: 0,
      skipped: [{ quoteId: '8', title: '막힌 견적', blockers: ['ENGINE_JOB_IN_PROGRESS'] }],
      failed: [{ quoteId: '9', title: '실패한 견적', error: 'Error: engine down' }],
      deferred: 0,
    };
    mocks.configFindUnique.mockResolvedValue({ key: 'k', value: JSON.stringify(lastRun) });
    mocks.quoteCount.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    mocks.quoteFindMany.mockResolvedValue([
      { id: 8n, title: '막힌 견적', mbId: 'c1', canceledAt: null, purgeAfter: new Date('2026-10-01T00:00:00.000Z') },
      { id: 9n, title: '실패한 견적', mbId: 'c2', canceledAt: null, purgeAfter: new Date('2026-10-02T00:00:00.000Z') },
    ]);
    mocks.quoteFindFirst.mockResolvedValue({ purgeAfter: new Date('2026-10-06T00:00:00.000Z') });

    const status = await getCanceledQuoteCleanupStatus(now);

    const overdueWhere = (mocks.quoteCount.mock.calls[0]?.[0] as { where: { purgeAfter: { lte: Date } } }).where;
    expect(overdueWhere.purgeAfter.lte.getTime()).toBe(now.getTime() - CANCELED_QUOTE_CLEANUP_INTERVAL_MS);
    expect(status).toMatchObject({
      health: 'backlog',
      retentionDays: 30,
      intervalHours: 6,
      overdueCount: 2,
      pendingCount: 4,
      nextPurgeAfter: '2026-10-06T00:00:00.000Z',
    });
    expect(status.overdue.map((item) => [item.quoteId, item.reasons])).toEqual([
      ['8', ['ENGINE_JOB_IN_PROGRESS']],
      ['9', ['Error: engine down']],
    ]);
    expect(status.lastRun?.deleted).toBe(0);
  });

  it('실행 요약이 깨져 있으면 기록 없음으로 본다(멈춤 표시)', async () => {
    mocks.configFindUnique.mockResolvedValue({ key: 'k', value: '{not json' });
    mocks.quoteCount.mockResolvedValue(0);
    mocks.quoteFindMany.mockResolvedValue([]);
    mocks.quoteFindFirst.mockResolvedValue(null);

    const status = await getCanceledQuoteCleanupStatus(now);

    expect(status.lastRun).toBeNull();
    expect(status.health).toBe('stale');
  });
});
