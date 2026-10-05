import type { Prisma } from '@prisma/client';
import { BOM_QUOTE_CUSTOMER_CANCELABLE_STATUSES } from '@sp/api-contract';
import { getCanceledQuoteRetentionDays } from './bom-quote-retention-config';
import { closeRfqsForQuote } from './bom-rfq';
import { prisma } from './prisma';

// ── BOM 견적 취소 — "취소된 견적은 아무 일도 하지 않는 기록이다"(docs/BOM_QUOTE.md "취소와 보존 기간") ──
//
// 취소 뒤에 남은 문은 셋이었다(e2e 여정 25호): 협력사 회신이 계속 저장되고, 검색 중 표시가 풀리지
// 않고, 관리자 회신 확정과 겹치면 둘 다 성공했다. 그래서 취소는 한 트랜잭션에서
//   상태 조건부 전이 → 삭제 예정일 고지값 기록 → RFQ 마감 → 검색 흔적 종결
// 을 함께 한다. 관리자 경로(PATCH status=canceled)는 자체 가드가 있어 낱개 헬퍼만 빌려 쓴다.

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 취소 시각과, 그때의 보존 기간으로 고객에게 약속하는 삭제 예정 시각.
 * 예정 시각은 저장해 둔다 — 나중에 보존 기간을 줄여도 이미 고지한 날보다 먼저 지우지 않는다.
 */
export function canceledQuoteStamp(
  now: Date,
  retentionDays: number,
): { canceledAt: Date; purgeAfter: Date | null } {
  return {
    canceledAt: now,
    purgeAfter: retentionDays > 0 ? new Date(now.getTime() + retentionDays * 86_400_000) : null,
  };
}

/** 지금 취소하는 견적에 찍을 값 — 관리자 PATCH 처럼 자체 update 를 가진 경로가 data 에 펼쳐 쓴다. */
export async function canceledQuoteStampNow(): Promise<{ canceledAt: Date; purgeAfter: Date | null }> {
  return canceledQuoteStamp(new Date(), await getCanceledQuoteRetentionDays());
}

/**
 * 취소된 견적에 남은 검색 흔적을 종결한다 — 멱등.
 *
 * 취소 견적에는 검색 결과가 반영되지 않고(allowedStatuses), 게으른 치유도 draft 만 돌린다.
 * 그대로 두면 enrichStatus 가 searching 에 굳어 고객 화면이 "확인 중"을 계속 띄우고, 자동 정리는
 * "진행 중인 작업"으로 판정해 영영 지우지 못한다(강제 삭제의 ENGINE_JOB_IN_PROGRESS).
 * 엔진 잡 자체는 건드리지 않는다 — 결과가 뒤늦게 와도 취소 견적에는 반영되지 않는다.
 */
export async function settleCanceledQuoteSearchState(quoteId: bigint, db: Db = prisma): Promise<void> {
  await db.spBomSupplierSearchRun.updateMany({
    where: { quoteId, status: { in: ['preparing', 'running'] } },
    data: { status: 'failed', error: 'quote_canceled', completedAt: new Date() },
  });
  await db.spBomQuote.updateMany({
    where: { id: quoteId, status: 'canceled', enrichStatus: 'searching' },
    data: { enrichStatus: 'failed' },
  });
}

/**
 * 관리자 조작이 상태 가드에 걸렸을 때의 문구. 취소는 관리자에게 따로 통지하지 않으므로, 열어 둔
 * 화면에서 이어서 조작하다 받는 이 문구가 취소를 알게 되는 경로다 — 일반 문구 대신 그렇다고 말한다.
 */
export const CANCELED_QUOTE_NOTICE =
  '취소된 견적입니다. 더 진행할 수 없습니다 — 화면을 새로 고쳐 확인해 주세요.';
export const statusGuardMessage = (status: string, fallback: string): string =>
  status === 'canceled' ? CANCELED_QUOTE_NOTICE : fallback;

export type CancelBomQuoteOutcome = 'canceled' | 'stale';

/**
 * 고객 취소 — 요청·검토 중일 때만 성립한다.
 *
 * 쓰기는 상태를 조건으로 건다. 상태를 읽은 뒤 관리자 회신 확정이 먼저 끝났다면 0건이 되어
 * 'stale' 을 돌려준다(호출부는 409). 요청↔검토 중 사이의 전이는 취소를 막지 않는다.
 */
export async function cancelBomQuoteByCustomer(quoteId: bigint): Promise<CancelBomQuoteOutcome> {
  const stamp = await canceledQuoteStampNow();
  return prisma.$transaction(async (tx) => {
    const flipped = await tx.spBomQuote.updateMany({
      where: { id: quoteId, status: { in: [...BOM_QUOTE_CUSTOMER_CANCELABLE_STATUSES] } },
      data: { status: 'canceled', activeSearchCartKey: null, ...stamp },
    });
    if (flipped.count !== 1) return 'stale';
    await closeRfqsForQuote(quoteId, tx);
    await settleCanceledQuoteSearchState(quoteId, tx);
    return 'canceled';
  });
}
