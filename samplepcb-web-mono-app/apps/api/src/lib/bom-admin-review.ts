import { createHash } from 'node:crypto';
import type {
  AdminBomQuoteItemReviewType,
  BomQuoteItemType,
} from '@sp/api-contract';
import { bomQuoteAdminAttention } from '@sp/utils';
import { prisma } from './prisma';
import type { QuoteItemRow } from './bom-quote';

// 판정 정책 자체가 바뀌어 재확인이 필요하면 이 값을 올린다.
const ADMIN_ITEM_REVIEW_POLICY_VERSION = 1;

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  if (value === undefined) return null;
  if (typeof value === 'symbol') return value.description ?? '';
  if (typeof value === 'function') return value.name;
  return null;
};

/** 관리자 확인이 유효한 행 버전인지 비교하는 안정 SHA-256 지문. */
export function bomQuoteItemReviewFingerprint(row: QuoteItemRow): string {
  const snapshot = {
    reviewPolicyVersion: ADMIN_ITEM_REVIEW_POLICY_VERSION,
    rowIdx: row.rowIdx,
    included: row.included,
    mpn: row.mpn,
    manufacturerName: row.manufacturerName,
    description: row.description,
    bomQty: row.bomQty,
    orderQty: row.orderQty,
    matchStatus: row.matchStatus,
    matchEvidence: row.matchEvidence,
    searchRequirements: row.searchRequirements,
    recommendedCandidateKey: row.recommendedCandidateKey,
    selectedCandidateKey: row.selectedCandidateKey,
    selectionSource: row.selectionSource,
    partId: row.partId,
    selectedOffer: row.selectedOffer,
    selectedRfqItemId: row.selectedRfqItemId,
    lineTotalKrw: row.lineTotalKrw?.toString() ?? null,
    sourceRow: row.sourceRow,
    sourceSheetIndex: row.sourceSheetIndex,
    sourceSheetName: row.sourceSheetName,
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest('hex');
}

interface BomQuoteItemReviewRecord {
  action: string;
  fingerprint: string;
  actorMbId: string;
  reason: string | null;
  createdAt: Date;
}

/** DB 조회와 분리한 현재 확인 상태 계산. 테스트와 회신 게이트가 같은 의미를 공유한다. */
export function resolveBomQuoteItemReviewState(
  row: QuoteItemRow,
  required: boolean,
  latest: BomQuoteItemReviewRecord | null,
): AdminBomQuoteItemReviewType {
  const fingerprint = bomQuoteItemReviewFingerprint(row);
  // 현재 확인 대상이 아닌 정상/제외 행에는 과거 지문 불일치를 재확인 경고로 노출하지 않는다.
  const stale = required && latest !== null && latest.fingerprint !== fingerprint;
  const validConfirmation = latest !== null
    && !stale
    && latest.action === 'confirmed';
  return {
    required,
    completed: !required || validConfirmation,
    stale,
    reviewedBy: validConfirmation ? latest.actorMbId : null,
    reviewedAt: validConfirmation ? latest.createdAt.toISOString() : null,
    reason: validConfirmation ? latest.reason : null,
  };
}

/** 활성 관리자 상세 품목별 현재 확인 상태. 과거 버전의 확인은 stale로만 알리고 완료로 보지 않는다. */
export async function loadBomQuoteItemReviewStates(
  rows: readonly QuoteItemRow[],
  items: readonly BomQuoteItemType[],
): Promise<Map<string, AdminBomQuoteItemReviewType>> {
  const itemIds = rows.map((row) => row.id);
  const latestGroups = itemIds.length === 0
    ? []
    : await prisma.spBomQuoteItemReview.groupBy({
        by: ['quoteItemId'],
        where: { quoteItemId: { in: itemIds } },
        _max: { id: true },
      });
  const latestIds = latestGroups
    .map((group) => group._max.id)
    .filter((id): id is bigint => id !== null);
  const reviews = latestIds.length === 0
    ? []
    : await prisma.spBomQuoteItemReview.findMany({ where: { id: { in: latestIds } } });
  const latestByItem = new Map(reviews.map((review) => [review.quoteItemId, review]));

  const rowById = new Map(rows.map((row) => [String(row.id), row]));
  return new Map(items.map((item) => {
    const row = rowById.get(item.id);
    if (row === undefined) {
      throw new Error(`관리자 검토 상태의 견적 품목을 찾을 수 없습니다: ${item.id}`);
    }
    const required = bomQuoteAdminAttention(item).reviewRequired;
    const latest = latestByItem.get(row.id) ?? null;
    return [item.id, resolveBomQuoteItemReviewState(row, required, latest)];
  }));
}
