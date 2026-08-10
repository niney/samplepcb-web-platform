import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpOrderSpec } from '@prisma/client';

// purgeQuoteData 의 불변식 — 실파일(파일서버) 먼저, 전부 성공했을 때만 DB.
// 특히 **PCB 협력 트랙 첨부(EQ·선적)** 를 함께 지우는지 본다. sp_pcb_* 원장은 spec FK
// cascade 로 사라지지만 sp_file 은 refType/refId 규약(FK 없음)이라 따라가지 않아,
// 빠뜨리면 파일서버 실파일과 DB 행이 영구 고아로 남는다(2026-08-06 실측).

const mocks = vi.hoisted(() => ({
  deleteCartRow: vi.fn(),
  deleteQuoteOption: vi.fn(),
  deleteFromFileServer: vi.fn(),
  fileFindMany: vi.fn(),
  fileDeleteMany: vi.fn(),
  poFindMany: vi.fn(),
  shipmentFindMany: vi.fn(),
  asCaseFindMany: vi.fn(),
  quoteDeleteMany: vi.fn(),
  specDelete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./g5-db', () => ({
  TEMPLATE_ITEMS: { standard: 'sp-pcb-std' },
  deleteCartRow: mocks.deleteCartRow,
  deleteQuoteOption: mocks.deleteQuoteOption,
}));
vi.mock('./file-server', () => ({ deleteFromFileServer: mocks.deleteFromFileServer }));
vi.mock('./prisma', () => ({
  prisma: {
    spFile: { findMany: mocks.fileFindMany, deleteMany: mocks.fileDeleteMany },
    spPcbPo: { findMany: mocks.poFindMany },
    spPcbShipment: { findMany: mocks.shipmentFindMany },
    spPcbAsCase: { findMany: mocks.asCaseFindMany },
    spQuote: { deleteMany: mocks.quoteDeleteMany },
    spOrderSpec: { delete: mocks.specDelete },
    $transaction: mocks.transaction,
  },
}));

import { purgeQuoteData } from './quote-delete';

const spec = {
  id: 7n,
  quoteId: 'quote-7',
  category: 'standard',
  ctId: null,
} as unknown as SpOrderSpec;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockResolvedValue(undefined);
  mocks.poFindMany.mockResolvedValue([]);
  mocks.shipmentFindMany.mockResolvedValue([]);
  mocks.asCaseFindMany.mockResolvedValue([]);
  mocks.fileFindMany.mockResolvedValue([]);
});

describe('purgeQuoteData', () => {
  it('스펙 파일과 PCB 협력 첨부를 모두 파일서버에서 지운다', async () => {
    mocks.poFindMany.mockResolvedValue([{ id: 11n }]);
    mocks.shipmentFindMany.mockResolvedValue([{ id: 21n }]);
    mocks.fileFindMany
      // 1회차 = 스펙 파일(거버·썸네일)
      .mockResolvedValueOnce([{ pathToken: 'gerber' }, { pathToken: 'thumb' }])
      // 2회차 = PCB 협력 첨부(EQ·선적)
      .mockResolvedValueOnce([
        { id: 101n, pathToken: 'eq' },
        { id: 102n, pathToken: 'invoice' },
      ]);

    await purgeQuoteData(spec);

    const tokens = mocks.deleteFromFileServer.mock.calls.map((c) => c[0] as string);
    expect(tokens).toEqual(['gerber', 'thumb', 'eq', 'invoice']);
  });

  it('PCB 첨부 행을 DB 삭제 트랜잭션에 포함한다', async () => {
    mocks.poFindMany.mockResolvedValue([{ id: 11n }]);
    mocks.fileFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 101n, pathToken: 'eq' }]);

    await purgeQuoteData(spec);

    // 스펙 파일 · PCB 첨부 · sp_quote · spec = 4개 오퍼레이션
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.fileDeleteMany).toHaveBeenCalledWith({ where: { id: { in: [101n] } } });
  });

  it('A/S 케이스 첨부도 협력 트랙 첨부로 함께 걷는다(발주·선적이 없어도)', async () => {
    mocks.asCaseFindMany.mockResolvedValue([{ id: 31n }]);
    mocks.fileFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 301n, pathToken: 'as-photo' }]);

    await purgeQuoteData(spec);

    const query = mocks.fileFindMany.mock.calls[1]?.[0] as {
      where: { OR: { refType: string }[] };
    };
    expect(query.where.OR.map((o) => o.refType)).toEqual(['sp_pcb_as_case']);
    const tokens = mocks.deleteFromFileServer.mock.calls.map((c) => c[0] as string);
    expect(tokens).toEqual(['as-photo']);
  });

  it('협력 트랙이 없으면 첨부 조회 자체를 건너뛴다(불필요한 쿼리 금지)', async () => {
    await purgeQuoteData(spec);

    // 스펙 파일 1회만 조회 — PCB 첨부 조회는 원장이 없으면 하지 않는다
    expect(mocks.fileFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.fileDeleteMany).toHaveBeenCalledTimes(1); // 스펙 파일 정리분만
  });

  it('파일서버 삭제가 실패하면 DB 를 건드리지 않는다(재시도 멱등)', async () => {
    mocks.fileFindMany.mockResolvedValueOnce([{ pathToken: 'gerber' }]).mockResolvedValueOnce([]);
    mocks.deleteFromFileServer.mockRejectedValueOnce(new Error('file server down'));

    await expect(purgeQuoteData(spec)).rejects.toThrow('file server down');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
