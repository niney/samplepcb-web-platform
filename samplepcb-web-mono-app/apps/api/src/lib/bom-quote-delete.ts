import { Prisma } from '@prisma/client';
import { deleteFromFileServer } from './file-server';
import { prisma } from './prisma';

// 후보 스냅샷 등 cascade 자식이 견적당 수천 행이라, 한 DELETE 문장의 작업량을 짧게 묶는다.
export const BOM_QUOTE_DELETE_CHUNK_SIZE = 20;
export const CUSTOMER_DELETABLE_BOM_QUOTE_STATUSES = ['draft', 'canceled'] as const;

export function isCustomerDeletableBomQuoteStatus(status: string): boolean {
  return CUSTOMER_DELETABLE_BOM_QUOTE_STATUSES.some((candidate) => candidate === status);
}

export interface BomQuoteDeleteTarget {
  id: bigint;
  mbId: string;
  status: string;
}

/** 조회 결과를 다시 소유권으로 제한하고, 그중 작성 중·취소 견적만 삭제 후보로 만든다. */
export function planBomQuoteDeletion(
  rows: readonly BomQuoteDeleteTarget[],
  mbId: string,
): { targets: BomQuoteDeleteTarget[]; deletableIds: bigint[] } {
  const targets = rows.filter((row) => row.mbId === mbId);
  return {
    targets,
    deletableIds: targets.filter((row) => isCustomerDeletableBomQuoteStatus(row.status)).map((row) => row.id),
  };
}

/** 한 DELETE 문장이 cascade 삭제할 견적 수를 제한한다. */
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

export interface ForcedBomQuoteDeletionResult {
  quotes: number;
  quoteItems: number;
  pathTokens: string[];
}

const catalogRelatedQuoteItemWhere = {
  OR: [
    { partId: { not: null } },
    { selectedOffer: { not: Prisma.DbNull } },
    { matchStatus: { not: 'none' } },
  ],
} satisfies Prisma.SpBomQuoteItemWhereInput;

/**
 * 카탈로그 전체 초기화 전용 — partId 직접 연결뿐 아니라 카탈로그 매칭·구매 조건 스냅샷이
 * 남은 BOM 견적도 상태와 무관하게 견적 단위로 완전 삭제한다. sp_file은 FK가 없는
 * 느슨한 참조이므로 같은 DB 트랜잭션에서 함께 지운다. 대형 견적의 cascade가
 * 인터랙티브 트랜잭션 제한을 넘지 않도록 20건씩 재조회·삭제한다.
 */
export async function forceDeleteCatalogRelatedBomQuotes(): Promise<ForcedBomQuoteDeletionResult> {
  const quoteItems = await prisma.spBomQuoteItem.count({ where: catalogRelatedQuoteItemWhere });
  const pathTokens: string[] = [];
  let quotes = 0;

  for (;;) {
    const rows = await prisma.spBomQuote.findMany({
      where: { items: { some: catalogRelatedQuoteItemWhere } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BOM_QUOTE_DELETE_CHUNK_SIZE,
    });
    if (rows.length === 0) break;

    const ids = rows.map((row) => row.id);
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_bom_quote', refId: { in: ids } },
      select: { pathToken: true },
    });
    const [removed] = await prisma.$transaction([
      prisma.spBomQuote.deleteMany({ where: { id: { in: ids } } }),
      prisma.spFile.deleteMany({ where: { refType: 'sp_bom_quote', refId: { in: ids } } }),
    ]);
    quotes += removed.count;
    pathTokens.push(...files.map((file) => file.pathToken));
  }

  return { quotes, quoteItems, pathTokens };
}

/** 파일서버 정리는 응답을 막지 않되 동시 요청을 5건으로 제한한다. */
export async function deleteBomFiles(pathTokens: readonly string[]): Promise<void> {
  const batchSize = 5;
  for (let start = 0; start < pathTokens.length; start += batchSize) {
    await Promise.all(
      pathTokens.slice(start, start + batchSize).map((pathToken) =>
        deleteFromFileServer(pathToken).catch(() => undefined),
      ),
    );
  }
}
