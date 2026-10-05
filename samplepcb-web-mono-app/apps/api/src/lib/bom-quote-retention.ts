import type { FastifyBaseLogger } from 'fastify';
import { BomQuoteRetentionRun, DELETE_AUDIT_SYSTEM_ACTOR } from '@sp/api-contract';
import type {
  AdminBomQuoteRetentionStatusType,
  BomQuoteRetentionHealthType,
  BomQuoteRetentionRunType,
} from '@sp/api-contract';
import { loadBomCaseDeletePlan, purgeBomCase } from './bom-case-delete';
import { settleCanceledQuoteSearchState } from './bom-quote-cancel';
import { getCanceledQuoteRetentionDays } from './bom-quote-retention-config';
import { prisma } from './prisma';

// ── 취소 견적 자동 정리(보존 기간 배치) — docs/BOM_QUOTE.md "취소와 보존 기간" ─────────────────
//
// 고객에게 고지한 삭제 예정 시각(purgeAfter)이 지난 취소 견적을 지운다. 삭제 로직은 새로 만들지
// 않는다 — 관리자가 누르는 "Case 강제 영구 삭제"(loadBomCaseDeletePlan → purgeBomCase, audited)를
// 시스템 이름으로 그대로 부른다. 그래서 지우는 범위·순서(엔진 잡 → 파일서버 → DB)·감사 기록이
// 사람이 지울 때와 같고, 중간에 실패해도 견적 행이 남아 다음 주기가 같은 일을 되풀이한다.
//
// 실행 이력 테이블은 두지 않는다. 성공은 감사 원장(sp_delete_audit)에 남고, 못 지운 견적은 해결될
// 때까지 "기한 경과 미삭제"로 계속 세어지기 때문이다. 마지막 실행 요약만 sp_config 한 행에 덮어쓴다.

/** 정리 주기 — 서버 시작 때 한 번 + 이 간격(server.ts 타이머). */
export const CANCELED_QUOTE_CLEANUP_INTERVAL_MS = 6 * 3_600_000;
/** 1회 실행당 삭제 상한 — 한꺼번에 기한이 몰려도(마이그레이션 직후 등) 한 주기를 짧게 끝낸다. */
export const CANCELED_QUOTE_CLEANUP_MAX_PER_RUN = 50;
const LAST_RUN_KEY = 'bom_canceled_quote_cleanup_last_run';
const OVERDUE_LIST_LIMIT = 20;

const KST_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const kstDate = (value: Date | null): string => (value === null ? '-' : KST_DATE.format(value));

const errorText = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);

async function readLastRun(): Promise<BomQuoteRetentionRunType | null> {
  const row = await prisma.spConfig.findUnique({ where: { key: LAST_RUN_KEY } });
  if (row === null) return null;
  try {
    const parsed = BomQuoteRetentionRun.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let cleanupRunning = false;

export type CanceledQuoteCleanupResult =
  | { ok: true; run: BomQuoteRetentionRunType }
  | { ok: false; reason: 'running' | 'disabled' };

/**
 * 기한이 지난 취소 견적을 지운다. throw 하지 않는다(한 건의 실패는 그 건에만 머문다).
 * 동시에 한 번만 돈다 — 타이머와 "지금 실행"이 겹치면 뒤쪽은 'running' 으로 돌아간다.
 */
export async function runCanceledQuoteCleanup(
  log: FastifyBaseLogger,
  options: { trigger: 'timer' | 'manual'; actorMbId?: string | null },
): Promise<CanceledQuoteCleanupResult> {
  if (cleanupRunning) return { ok: false, reason: 'running' };
  cleanupRunning = true;
  try {
    const retentionDays = await getCanceledQuoteRetentionDays();
    // 0 = 꺼짐. 이미 약속한 날이 지난 견적이 있어도 지우지 않는다(운영 중 급히 멈추는 스위치).
    if (retentionDays === 0) return { ok: false, reason: 'disabled' };

    const startedAt = new Date();
    const dueWhere = { status: 'canceled', purgeAfter: { lte: startedAt } };
    const [due, targets] = await Promise.all([
      prisma.spBomQuote.count({ where: dueWhere }),
      prisma.spBomQuote.findMany({
        where: dueWhere,
        select: { id: true, title: true, canceledAt: true, purgeAfter: true },
        orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }],
        take: CANCELED_QUOTE_CLEANUP_MAX_PER_RUN,
      }),
    ]);

    let deleted = 0;
    const skipped: BomQuoteRetentionRunType['skipped'] = [];
    const failed: BomQuoteRetentionRunType['failed'] = [];
    for (const target of targets) {
      const quoteId = String(target.id);
      try {
        // 검색 중에 취소돼 굳은 상태는 여기서도 푼다 — 취소 시점의 정리를 놓친 옛 견적 대비.
        await settleCanceledQuoteSearchState(target.id);
        const plan = await loadBomCaseDeletePlan(target.id);
        if (plan === null) continue; // 그 사이 관리자가 지웠다
        // 취소는 종착 상태라 바뀌었을 리 없지만, 되돌릴 수 없는 삭제라 조건을 한 번 더 본다.
        if (plan.quote.status !== 'canceled') {
          skipped.push({ quoteId, title: target.title, blockers: ['NOT_CANCELED'] });
          continue;
        }
        // 취소 견적에는 주문이 붙을 수 없다(주문은 회신 완료 뒤). 붙어 있다면 데이터가 어긋난 것이라
        // 자동으로는 건드리지 않고 사람이 보게 남긴다.
        if (plan.quote.ctId !== null) {
          skipped.push({ quoteId, title: target.title, blockers: ['ORDER_LINKED'] });
          continue;
        }
        if (plan.preview.blockers.length > 0) {
          skipped.push({ quoteId, title: target.title, blockers: [...plan.preview.blockers] });
          continue;
        }
        await purgeBomCase(
          plan,
          {
            mode: 'audited',
            previewToken: plan.preview.previewToken,
            acknowledgeIrreversible: true,
            reason:
              `취소 견적 보존 기간 경과 — 자동 정리` +
              `(취소 ${kstDate(target.canceledAt)} · 삭제 예정 ${kstDate(target.purgeAfter)})`,
          },
          { mbId: DELETE_AUDIT_SYSTEM_ACTOR, ip: '' },
        );
        deleted += 1;
      } catch (error) {
        failed.push({ quoteId, title: target.title, error: errorText(error) });
        log.warn({ err: error, quoteId }, '취소 견적 자동 정리 실패 — 다음 주기에 다시 시도');
      }
    }

    const run: BomQuoteRetentionRunType = {
      trigger: options.trigger,
      actorMbId: options.actorMbId ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      retentionDays,
      due,
      deleted,
      skipped,
      failed,
      deferred: Math.max(0, due - targets.length),
    };
    const value = JSON.stringify(run);
    await prisma.spConfig.upsert({
      where: { key: LAST_RUN_KEY },
      create: { key: LAST_RUN_KEY, value },
      update: { value },
    });
    if (deleted > 0 || skipped.length > 0 || failed.length > 0) {
      log.info(
        { trigger: run.trigger, due, deleted, skipped: skipped.length, failed: failed.length },
        '취소 견적 보존 기간 정리',
      );
    }
    return { ok: true, run };
  } finally {
    cleanupRunning = false;
  }
}

/** 타이머용 — 어떤 경우에도 throw 하지 않는다(놓친 거절로 올리지 않는다). */
export async function runCanceledQuoteCleanupSafely(log: FastifyBaseLogger): Promise<void> {
  try {
    await runCanceledQuoteCleanup(log, { trigger: 'timer' });
  } catch (error) {
    log.error({ err: error }, '취소 견적 자동 정리 실행 실패');
  }
}

export function retentionHealth(input: {
  retentionDays: number;
  lastRunFinishedAt: Date | null;
  overdueCount: number;
  now: Date;
}): BomQuoteRetentionHealthType {
  if (input.retentionDays === 0) return 'disabled';
  // 두 주기 넘게 실행 기록이 없으면 배치가 돌지 않는 것이다(한 주기는 재시작·지연 여유).
  if (
    input.lastRunFinishedAt === null ||
    input.now.getTime() - input.lastRunFinishedAt.getTime() > 2 * CANCELED_QUOTE_CLEANUP_INTERVAL_MS
  ) {
    return 'stale';
  }
  return input.overdueCount > 0 ? 'backlog' : 'ok';
}

/**
 * 관리자 화면용 상태. "기한 경과 미삭제"는 실행 기록이 아니라 **데이터에서** 센다:
 * 삭제 예정 시각이 한 주기 넘게 지났는데 아직 남아 있는 취소 견적 — 배치가 성공했다고 적어도
 * 견적이 남아 있으면 드러난다. 한 주기 안쪽은 다음 실행을 기다리는 정상 대기다.
 */
export async function getCanceledQuoteCleanupStatus(
  now: Date = new Date(),
): Promise<AdminBomQuoteRetentionStatusType> {
  const overdueBefore = new Date(now.getTime() - CANCELED_QUOTE_CLEANUP_INTERVAL_MS);
  const overdueWhere = { status: 'canceled', purgeAfter: { lte: overdueBefore } };
  const pendingWhere = { status: 'canceled', purgeAfter: { gt: overdueBefore } };
  const [retentionDays, lastRun, overdueCount, overdueRows, pendingCount, nextPending] =
    await Promise.all([
      getCanceledQuoteRetentionDays(),
      readLastRun(),
      prisma.spBomQuote.count({ where: overdueWhere }),
      prisma.spBomQuote.findMany({
        where: overdueWhere,
        select: { id: true, title: true, mbId: true, canceledAt: true, purgeAfter: true },
        orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }],
        take: OVERDUE_LIST_LIMIT,
      }),
      prisma.spBomQuote.count({ where: pendingWhere }),
      prisma.spBomQuote.findFirst({
        where: pendingWhere,
        select: { purgeAfter: true },
        orderBy: { purgeAfter: 'asc' },
      }),
    ]);

  // 못 지운 이유는 마지막 실행이 남긴 것을 붙인다 — 조회할 때마다 삭제 계획을 다시 세우지 않는다.
  const reasons = new Map<string, string[]>();
  for (const entry of lastRun?.skipped ?? []) reasons.set(entry.quoteId, entry.blockers);
  for (const entry of lastRun?.failed ?? []) reasons.set(entry.quoteId, [entry.error]);

  return {
    health: retentionHealth({
      retentionDays,
      lastRunFinishedAt: lastRun === null ? null : new Date(lastRun.finishedAt),
      overdueCount,
      now,
    }),
    retentionDays,
    intervalHours: CANCELED_QUOTE_CLEANUP_INTERVAL_MS / 3_600_000,
    lastRun,
    overdueCount,
    overdue: overdueRows.flatMap((row) =>
      row.purgeAfter === null
        ? []
        : [
            {
              quoteId: String(row.id),
              title: row.title,
              mbId: row.mbId,
              canceledAt: row.canceledAt?.toISOString() ?? null,
              purgeAfter: row.purgeAfter.toISOString(),
              reasons: reasons.get(String(row.id)) ?? [],
            },
          ],
    ),
    pendingCount,
    nextPurgeAfter: nextPending?.purgeAfter?.toISOString() ?? null,
  };
}
