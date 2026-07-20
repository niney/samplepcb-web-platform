import { describe, expect, it } from 'vitest';
import {
  BOM_QUOTE_DELETE_CHUNK_SIZE,
  bomQuoteDeleteCounts,
  chunkBomQuoteDeletionIds,
  planBomQuoteDeletion,
  resolveDeletedBomQuoteIds,
} from './bom-quote-delete';

describe('BOM 견적 일괄 삭제 대상 산정', () => {
  it('본인 견적 중 draft만 삭제 대상으로 삼는다', () => {
    const plan = planBomQuoteDeletion([
      { id: 1n, mbId: 'member-a', status: 'draft' },
      { id: 2n, mbId: 'member-a', status: 'requested' },
      { id: 3n, mbId: 'member-b', status: 'draft' },
    ], 'member-a');

    expect(plan.targets.map((row) => row.id)).toEqual([1n, 2n]);
    expect(plan.deletableIds).toEqual([1n]);
  });

  it('scope=all에서도 요청·검토·답변 견적을 보존한다', () => {
    const plan = planBomQuoteDeletion([
      { id: 1n, mbId: 'member-a', status: 'draft' },
      { id: 2n, mbId: 'member-a', status: 'requested' },
      { id: 3n, mbId: 'member-a', status: 'reviewing' },
      { id: 4n, mbId: 'member-a', status: 'answered' },
    ], 'member-a');

    expect(plan.deletableIds).toEqual([1n]);
    expect(plan.targets.filter((row) => !plan.deletableIds.includes(row.id)).map((row) => row.status))
      .toEqual(['requested', 'reviewing', 'answered']);
  });

  it('상태 가드 뒤 생존한 견적은 실제 삭제 ID에서 제외한다', () => {
    expect(resolveDeletedBomQuoteIds([1n, 2n, 3n], [2n, 3n])).toEqual([1n]);
  });

  it('존재하지 않는 선택 ID는 retainedCount에 포함하지 않는다', () => {
    expect(bomQuoteDeleteCounts(4, 3, 1)).toEqual({
      requestedCount: 4,
      deletedCount: 1,
      retainedCount: 2,
    });
  });

  it('삭제 청크를 최대 200건으로 제한한다', () => {
    const chunks = chunkBomQuoteDeletionIds(Array.from({ length: 451 }, (_, index) => BigInt(index + 1)));

    expect(BOM_QUOTE_DELETE_CHUNK_SIZE).toBe(200);
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 51]);
    expect(chunks.every((chunk) => chunk.length <= BOM_QUOTE_DELETE_CHUNK_SIZE)).toBe(true);
  });
});
