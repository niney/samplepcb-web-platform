export const BOM_QUOTE_DELETE_CHUNK_SIZE = 200;

export interface BomQuoteDeleteTarget {
  id: bigint;
  mbId: string;
  status: string;
}

/** 조회 결과를 다시 소유권으로 제한하고, 그중 draft만 삭제 후보로 만든다. */
export function planBomQuoteDeletion(
  rows: readonly BomQuoteDeleteTarget[],
  mbId: string,
): { targets: BomQuoteDeleteTarget[]; deletableIds: bigint[] } {
  const targets = rows.filter((row) => row.mbId === mbId);
  return {
    targets,
    deletableIds: targets.filter((row) => row.status === 'draft').map((row) => row.id),
  };
}

/** 한 트랜잭션이 cascade 삭제할 견적 수를 제한한다. */
export function chunkBomQuoteDeletionIds(ids: readonly bigint[]): bigint[][] {
  const chunks: bigint[][] = [];
  for (let start = 0; start < ids.length; start += BOM_QUOTE_DELETE_CHUNK_SIZE) {
    chunks.push(ids.slice(start, start + BOM_QUOTE_DELETE_CHUNK_SIZE));
  }
  return chunks;
}

/** 상태 가드 삭제 뒤에도 남은 ID를 빼서 파일 정리 대상을 확정한다. */
export function resolveDeletedBomQuoteIds(
  deletableIds: readonly bigint[],
  survivorIds: readonly bigint[],
): bigint[] {
  const survivors = new Set(survivorIds);
  return deletableIds.filter((id) => !survivors.has(id));
}

export function bomQuoteDeleteCounts(
  requestedCount: number,
  targetCount: number,
  deletedCount: number,
): { requestedCount: number; deletedCount: number; retainedCount: number } {
  return {
    requestedCount,
    deletedCount,
    retainedCount: targetCount - deletedCount,
  };
}
