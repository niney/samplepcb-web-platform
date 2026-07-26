import { Prisma } from '@prisma/client';
import { PartsResetBody } from '@sp/api-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  quoteItemCount: vi.fn(),
  quoteFindMany: vi.fn(),
  quoteDeleteMany: vi.fn(),
  fileFindMany: vi.fn(),
  fileDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spBomQuoteItem: { count: prismaMocks.quoteItemCount },
    spBomQuote: {
      findMany: prismaMocks.quoteFindMany,
      deleteMany: prismaMocks.quoteDeleteMany,
    },
    spFile: {
      findMany: prismaMocks.fileFindMany,
      deleteMany: prismaMocks.fileDeleteMany,
    },
    $transaction: prismaMocks.transaction,
  },
}));

import { forceDeleteCatalogRelatedBomQuotes } from './bom-quote-delete';

describe('카탈로그 관련 BOM 견적 강제 삭제', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMocks.transaction.mockImplementation(async (operations: unknown) => {
      if (!Array.isArray(operations)) throw new Error('unexpected transaction form');
      return Promise.all(operations as Promise<unknown>[]);
    });
  });

  it('상태 가드 없이 연결 견적 전체와 느슨한 파일 참조를 함께 삭제한다', async () => {
    prismaMocks.quoteItemCount.mockResolvedValue(115);
    prismaMocks.quoteFindMany
      .mockResolvedValueOnce([{ id: 10n }, { id: 20n }])
      .mockResolvedValueOnce([]);
    prismaMocks.fileFindMany.mockResolvedValue([
      { pathToken: 'bom/token-a' },
      { pathToken: 'bom/token-b' },
    ]);
    prismaMocks.quoteDeleteMany.mockResolvedValue({ count: 2 });
    prismaMocks.fileDeleteMany.mockResolvedValue({ count: 2 });

    await expect(forceDeleteCatalogRelatedBomQuotes()).resolves.toEqual({
      quotes: 2,
      quoteItems: 115,
      pathTokens: ['bom/token-a', 'bom/token-b'],
    });
    const relatedItemWhere = {
      OR: [
        { partId: { not: null } },
        { selectedOffer: { not: Prisma.DbNull } },
        { matchStatus: { not: 'none' } },
      ],
    };
    expect(prismaMocks.quoteItemCount).toHaveBeenCalledWith({ where: relatedItemWhere });
    expect(prismaMocks.quoteFindMany).toHaveBeenNthCalledWith(1, {
      where: { items: { some: relatedItemWhere } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
    expect(prismaMocks.quoteDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10n, 20n] } },
    });
    expect(prismaMocks.fileDeleteMany).toHaveBeenCalledWith({
      where: {
        refType: 'sp_bom_quote',
        refId: { in: [10n, 20n] },
      },
    });
    expect(prismaMocks.transaction).toHaveBeenCalledOnce();
  });

  it('기존 RESET 문자열은 거부하고 확장된 파괴 범위를 명시한 확인만 받는다', () => {
    expect(PartsResetBody.safeParse({ confirm: 'RESET' }).success).toBe(false);
    expect(PartsResetBody.safeParse({ confirm: 'RESET_WITH_QUOTES' }).success).toBe(true);
  });
});
