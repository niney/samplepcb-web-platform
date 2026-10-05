import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  transaction: vi.fn(),
  txQuoteUpdateMany: vi.fn(),
  txRunUpdateMany: vi.fn(),
  closeRfqs: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spConfig: { findUnique: mocks.configFindUnique },
    $transaction: mocks.transaction,
  },
}));
// bom-rfq 는 견적 계산 모듈 전체를 끌고 온다 — 여기서는 "같은 트랜잭션으로 닫는다"만 본다.
vi.mock('./bom-rfq', () => ({ closeRfqsForQuote: mocks.closeRfqs }));

import {
  CANCELED_QUOTE_NOTICE,
  cancelBomQuoteByCustomer,
  canceledQuoteStamp,
  statusGuardMessage,
} from './bom-quote-cancel';
import { parseRetentionDays } from './bom-quote-retention-config';

describe('취소 견적 보존 기간 설정', () => {
  it('설정이 없거나 읽을 수 없으면 기본 30일', () => {
    expect(parseRetentionDays(undefined)).toBe(30);
    expect(parseRetentionDays(null)).toBe(30);
    expect(parseRetentionDays('')).toBe(30);
    expect(parseRetentionDays('abc')).toBe(30);
    expect(parseRetentionDays('-1')).toBe(30);
    expect(parseRetentionDays('1.5')).toBe(30);
  });

  it('0 은 자동 삭제 끔, 양의 정수는 그대로', () => {
    expect(parseRetentionDays('0')).toBe(0);
    expect(parseRetentionDays('45')).toBe(45);
  });
});

describe('취소 시각과 고지할 삭제 예정 시각', () => {
  const now = new Date('2026-10-05T03:00:00.000Z');

  it('보존 기간만큼 뒤를 삭제 예정 시각으로 약속한다', () => {
    expect(canceledQuoteStamp(now, 30)).toEqual({
      canceledAt: now,
      purgeAfter: new Date('2026-11-04T03:00:00.000Z'),
    });
  });

  it('보존 기간이 꺼져 있으면 삭제 예정 시각을 약속하지 않는다', () => {
    expect(canceledQuoteStamp(now, 0)).toEqual({ canceledAt: now, purgeAfter: null });
  });
});

describe('관리자 상태 가드 문구', () => {
  it('취소된 견적이면 일반 문구 대신 취소를 알린다', () => {
    expect(statusGuardMessage('canceled', '검토 중에만 가능합니다')).toBe(CANCELED_QUOTE_NOTICE);
    expect(statusGuardMessage('answered', '검토 중에만 가능합니다')).toBe('검토 중에만 가능합니다');
  });
});

describe('고객 취소 — 한 트랜잭션', () => {
  const tx = {
    spBomQuote: { updateMany: mocks.txQuoteUpdateMany },
    spBomSupplierSearchRun: { updateMany: mocks.txRunUpdateMany },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue(null); // 기본 30일
    mocks.txRunUpdateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (run: (client: unknown) => Promise<unknown>) => run(tx));
  });

  it('요청·검토 중일 때만 쓰고, 취소 시각과 30일 뒤 삭제 예정 시각을 찍는다', async () => {
    mocks.txQuoteUpdateMany.mockResolvedValue({ count: 1 });

    expect(await cancelBomQuoteByCustomer(11n)).toBe('canceled');

    const flip = mocks.txQuoteUpdateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { status: string; activeSearchCartKey: null; canceledAt: Date; purgeAfter: Date | null };
    };
    expect(flip.where).toEqual({ id: 11n, status: { in: ['requested', 'reviewing'] } });
    expect(flip.data.status).toBe('canceled');
    expect(flip.data.activeSearchCartKey).toBeNull();
    expect((flip.data.purgeAfter?.getTime() ?? 0) - flip.data.canceledAt.getTime()).toBe(30 * 86_400_000);
  });

  it('같은 트랜잭션에서 RFQ 를 닫고 검색 흔적을 종결한다', async () => {
    mocks.txQuoteUpdateMany.mockResolvedValue({ count: 1 });

    await cancelBomQuoteByCustomer(11n);

    expect(mocks.closeRfqs).toHaveBeenCalledWith(11n, tx);
    expect(mocks.txRunUpdateMany).toHaveBeenCalledWith({
      where: { quoteId: 11n, status: { in: ['preparing', 'running'] } },
      data: { status: 'failed', error: 'quote_canceled', completedAt: expect.any(Date) as Date },
    });
    // 두 번째 견적 쓰기 = 검색 중 표시 풀기(취소된 견적에 한해)
    expect(mocks.txQuoteUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 11n, status: 'canceled', enrichStatus: 'searching' },
      data: { enrichStatus: 'failed' },
    });
  });

  it('그사이 관리자 회신 확정이 끝났으면 아무것도 더 쓰지 않고 stale', async () => {
    mocks.txQuoteUpdateMany.mockResolvedValue({ count: 0 });

    expect(await cancelBomQuoteByCustomer(11n)).toBe('stale');

    expect(mocks.txQuoteUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.closeRfqs).not.toHaveBeenCalled();
    expect(mocks.txRunUpdateMany).not.toHaveBeenCalled();
  });

  it('보존 기간이 0 이면 삭제 예정 시각 없이 취소한다', async () => {
    mocks.configFindUnique.mockResolvedValue({ key: 'bom_canceled_quote_retention_days', value: '0' });
    mocks.txQuoteUpdateMany.mockResolvedValue({ count: 1 });

    await cancelBomQuoteByCustomer(11n);

    const flip = mocks.txQuoteUpdateMany.mock.calls[0]?.[0] as { data: { purgeAfter: Date | null } };
    expect(flip.data.purgeAfter).toBeNull();
  });
});
