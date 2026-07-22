import { beforeEach, describe, expect, it, vi } from 'vitest';

// backfillQuotePartIds(카탈로그 인제스트 후 partId 지연 보강) 전용 스위트. bom-quote.test.ts 는
// prisma/engineFetch 를 목하지 않는 순수 함수 테스트만 모으므로(bom-quote-reprice.test.ts 참조),
// DB 호출이 필요한 이 스위트는 별도 파일로 분리한다(vi.mock 은 파일 전체에 호이스트되기 때문).

const prismaMocks = vi.hoisted(() => ({
  itemFindMany: vi.fn(),
  partFindMany: vi.fn(),
  itemUpdateMany: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spBomQuoteItem: {
      findMany: prismaMocks.itemFindMany,
      updateMany: prismaMocks.itemUpdateMany,
    },
    spPart: { findMany: prismaMocks.partFindMany },
  },
}));

import { backfillQuotePartIds } from './bom-quote';

describe('backfillQuotePartIds', () => {
  const quoteId = 42n;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.itemUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('제조사가 확인되고 exact(mpn+제조사) 부품이 있으면 partId 를 연결한다', async () => {
    prismaMocks.itemFindMany.mockResolvedValue([
      { id: 1n, mpn: '1N4148', manufacturerName: 'onsemi', selectedCandidateKey: 'cand-1' },
    ]);
    prismaMocks.partFindMany.mockResolvedValue([
      { id: 201n, mpnNorm: '1N4148', manufacturerNorm: 'onsemi' },
    ]);

    const updated = await backfillQuotePartIds(quoteId);

    expect(updated).toBe(1);
    expect(prismaMocks.itemUpdateMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { partId: 201n } }),
    );
  });

  it('제조사가 확인되면 같은 MPN 의 다른 제조사 부품으로 교차 연결하지 않는다', async () => {
    // 1N4148 처럼 여러 제조사가 공유하는 MPN — item 은 onsemi 인데 카탈로그엔 vishay 만 있다.
    prismaMocks.itemFindMany.mockResolvedValue([
      { id: 2n, mpn: '1N4148', manufacturerName: 'onsemi', selectedCandidateKey: 'cand-2' },
    ]);
    prismaMocks.partFindMany.mockResolvedValue([
      { id: 202n, mpnNorm: '1N4148', manufacturerNorm: 'vishay' },
    ]);

    const updated = await backfillQuotePartIds(quoteId);

    expect(updated).toBe(0);
    expect(prismaMocks.itemUpdateMany).not.toHaveBeenCalled();
  });

  it('제조사 미상 행은 exact 실패 시 mpn 단독 부품으로 fallback 연결한다', async () => {
    // 제조사 미상(빈 문자열 → norm "unknown") — exact 는 없지만 mpn 단독 fallback 을 허용한다.
    prismaMocks.itemFindMany.mockResolvedValue([
      { id: 3n, mpn: '1N4148', manufacturerName: '', selectedCandidateKey: 'cand-3' },
    ]);
    prismaMocks.partFindMany.mockResolvedValue([
      { id: 203n, mpnNorm: '1N4148', manufacturerNorm: 'vishay' },
    ]);

    const updated = await backfillQuotePartIds(quoteId);

    expect(updated).toBe(1);
    expect(prismaMocks.itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { partId: 203n } }),
    );
  });

  it('갱신은 조회 시점 스냅샷 가드 where 로 경합 편집을 보호한다', async () => {
    prismaMocks.itemFindMany.mockResolvedValue([
      { id: 4n, mpn: '1N4148', manufacturerName: 'onsemi', selectedCandidateKey: 'cand-4' },
    ]);
    prismaMocks.partFindMany.mockResolvedValue([
      { id: 204n, mpnNorm: '1N4148', manufacturerNorm: 'onsemi' },
    ]);

    await backfillQuotePartIds(quoteId);

    expect(prismaMocks.itemUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 4n,
        quoteId,
        partId: null,
        selectionSource: 'auto',
        selectedCandidateKey: 'cand-4',
        mpn: '1N4148',
        manufacturerName: 'onsemi',
      },
      data: { partId: 204n },
    });
  });
});
