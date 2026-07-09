// 증분 동기화 오케스트레이터 — 덤프 이관 후, 레거시 운영 DB 직결(읽기 전용)로 델타를 반복 반영.
//
// 실행(apps/api): pnpm migrate:sync [-- --dry-run --window=90 --final]
//   --window  주문 재대조 최근 생성 창(일). 기본 90 — 비종결·지문 상이는 창과 무관하게 전량 후보.
//   --final   컷오버 마지막 1회: 노이즈 컬럼(mb_today_login 등)까지 최종 반영.
//
// 파이프라인(계획 승인 2026-07-07): gate → (a) 신규분(기존 phase 멱등 재사용, 주문은 차집합+원장
// 무시 — P0-1) → (b) 재대조(회원/주문/게시판/1:1/주소록) → (c) 삭제·이상 검출(리포트만) →
// 갱신 주문 금액 항등 자가검증. 충돌 정책: 컷오버 전 신규 플랫폼은 조회 전용 — 레거시 정본 단방향.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { closeLegacyPool, legacySelect } from '../../lib/legacy-db';
import { buildCopyPlan, Report, SchemaCache } from './lib/context';
import type { MigrateCtx } from './lib/context';
import { G5Writer } from './lib/g5-writer';
import type { Row } from './lib/g5-writer';
import { Ledger } from './lib/ledger';
import { prepareTargetSchema } from './lib/schema-prep';
import { asInt, asStr, chunk, resolveMigrateTmpDir } from './lib/util';
import { resyncMembers, tailAppendPoints, protectedMbIds } from './lib/sync/member-resync';
import { resyncOrders, verifyOrdersMoney } from './lib/sync/order-resync';
import { normValue, syncTableRows } from './lib/sync/row-diff';
import { MIGRATE_BOARDS, runGate } from './manifest';
import { runMembersPhase } from './phases/01-members';
import { prepareShopDeps, runShopPhase } from './phases/02-shop';
import { runBoardsPhase } from './phases/03-boards';
import { runMiscPhase } from './phases/04-misc';
import { emptyReviewStats, loadReviewLineIndex, upsertReview } from './phases/05-reviews';

function dbNameOf(url: string | undefined): string {
  if (url === undefined || url === '') return '(미설정)';
  try {
    return new URL(url.split('?')[0] ?? url).pathname.replace(/^\//, '');
  } catch {
    return '(파싱 불가)';
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const { values } = parseArgs({
    args,
    options: {
      'dry-run': { type: 'boolean', default: false },
      window: { type: 'string', default: '90' },
      final: { type: 'boolean', default: false },
      'allow-unknown': { type: 'boolean', default: false },
    },
  });
  const dryRun = values['dry-run'];
  const windowDays = Math.max(1, Math.trunc(Number(values.window)));

  const g5 = new G5Writer();
  const prisma = new PrismaClient();
  const tmpDir = await resolveMigrateTmpDir();
  const ledger = await Ledger.open(tmpDir, g5.dbName);
  const report = new Report();
  const schema = new SchemaCache(g5, legacySelect);
  const ctx: MigrateCtx = {
    g5,
    prisma,
    legacy: legacySelect,
    ledger,
    report,
    schema,
    dryRun,
    allowUnknown: values['allow-unknown'],
    tmpDir,
  };

  try {
    const legacyDb = asStr((await legacySelect(`SELECT DATABASE() db`))[0]?.db);
    console.log('══ 레거시 → 신규 증분 동기화(sync) ══');
    console.log(`  소스: ${legacyDb} · 타깃: ${g5.dbName} (prisma: ${dbNameOf(process.env.DATABASE_URL)})`);
    console.log(`  모드: ${dryRun ? 'DRY-RUN' : '실행'} · window=${String(windowDays)}일 · final=${String(values.final)}`);
    if (legacyDb === g5.dbName) {
      throw new Error(`소스와 타깃이 같은 DB(${legacyDb})입니다 — .env.migration 확인.`);
    }
    if (dbNameOf(process.env.DATABASE_URL) !== g5.dbName) {
      throw new Error('DATABASE_URL 과 G5_DATABASE_URL 이 다른 DB — 공유 DB 전제 위반.');
    }
    // 원장 sanity(P0-1): sync 에서 원장 done 마커는 권위 없음 — 어긋나면 로그로 알린다.
    const targetOdCount = Number(
      asStr((await g5.select(`SELECT COUNT(*) c FROM g5_shop_order`))[0]?.c),
    );
    if (ledger.orderDoneCount() !== targetOdCount) {
      console.log(
        `  [원장 sanity] done 마커 ${String(ledger.orderDoneCount())} ≠ 타깃 주문 ${String(targetOdCount)} — sync 는 차집합/대조 기준으로 동작(원장 무시)`,
      );
    }

    // ── 게이트(운영 드리프트 감시 — 매회) ──
    const gate = await runGate(ctx);
    for (const line of gate.info) console.log(`  [게이트] ${line}`);
    if (gate.violations.length > 0) {
      for (const v of gate.violations) console.log(`  ✗ ${v}`);
      if (!ctx.allowUnknown) throw new Error('게이트 위반 — 처분 확정 후 재실행(또는 --allow-unknown).');
    }
    await prepareTargetSchema(ctx);

    // ── (a) 신규분 — 기존 phase 멱등 재사용 ──
    console.log('\n━━ (a) 신규분 ━━');
    await runMembersPhase(ctx);
    const legacyOds = new Set(
      (await legacySelect(`SELECT od_id FROM g5_shop_order`)).map((r) => asStr(r.od_id)),
    );
    const targetOds = new Set(
      (await g5.select(`SELECT od_id FROM g5_shop_order`)).map((r) => asStr(r.od_id)),
    );
    const newOds = [...legacyOds].filter((od) => !targetOds.has(od)).sort();
    report.count('sync.신규 주문(차집합)', newOds.length);
    if (newOds.length > 0) {
      await runShopPhase(ctx, { odIds: newOds, ignoreLedger: true });
    }
    await runBoardsPhase(ctx);
    await runMiscPhase(ctx);
    await tailAppendPoints(ctx);

    // ── (b) 변경분 — 재대조 ──
    console.log('\n━━ (b) 변경분 재대조 ━━');
    await resyncMembers(ctx, { final: values.final });
    const deps = await prepareShopDeps(ctx);
    const { touchedOds } = await resyncOrders(ctx, deps, { windowDays });
    await resyncBoards(ctx);
    await resyncQa(ctx);
    await resyncAddresses(ctx);
    await resyncReviews(ctx);

    // ── (c) 삭제·이상 검출(리포트만) ──
    console.log('\n━━ (c) 삭제·이상 검출 ━━');
    await detectDeletions(ctx, legacyOds);

    // ── 갱신 주문 금액 항등 자가검증 ──
    if (!dryRun && touchedOds.length > 0) {
      const mismatch = await verifyOrdersMoney(ctx, touchedOds);
      report.count('sync.금액 항등 검증(갱신분)', touchedOds.length);
      if (mismatch > 0) report.count('sync.금액 항등 불일치', mismatch);
    }
  } finally {
    report.print();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(tmpDir, `sync-report-${g5.dbName}-${stamp}.json`);
    await writeFile(reportPath, JSON.stringify(report.toJSON(), null, 2), 'utf8');
    console.log(`\n리포트 저장: ${reportPath}`);
    await ledger.save();
    await Promise.allSettled([g5.end(), prisma.$disconnect(), closeLegacyPool()]);
  }
}

/** 게시판 9종 + 첨부 메타 재대조(수정 반영 — wr_last 는 신뢰 불가라 전행 대조). */
async function resyncBoards(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy } = ctx;
  console.log('── sync: boards 재대조 ──');
  for (const boTable of MIGRATE_BOARDS) {
    const table = `g5_write_${boTable}`;
    if (!(await g5.tableExists(table))) continue;
    const plan = await buildCopyPlan(ctx.schema, table);
    await syncTableRows(ctx, {
      table,
      keyCols: ['wr_id'],
      plan,
      legacyRows: await legacy(`SELECT * FROM \`${table}\``),
      targetRows: await g5.select(`SELECT * FROM \`${table}\``),
      reportPrefix: `sync.게시판(${boTable})`,
    });
  }
  const bfPlan = await buildCopyPlan(ctx.schema, 'g5_board_file');
  await syncTableRows(ctx, {
    table: 'g5_board_file',
    keyCols: ['bo_table', 'wr_id', 'bf_no'],
    plan: bfPlan,
    legacyRows: (await legacy(`SELECT * FROM g5_board_file`)).filter((r) =>
      MIGRATE_BOARDS.includes(asStr(r.bo_table)),
    ),
    targetRows: await g5.select(`SELECT * FROM g5_board_file`),
    reportPrefix: 'sync.게시판 첨부',
  });
}

/**
 * 별점후기 재대조 — 후기 수정·관리자 답변 추가가 in-place UPDATE 라 전행 대조(61건 소형 루프).
 * row-diff.syncTableRows 는 g5 writer 기반이라 Prisma 소유 sp_review 에 못 쓴다 → 전용 루프.
 * 신규+갱신은 upsertReview(legacyIsId 멱등) 가 겸하고, 삭제(레거시 부재)는 리포트-온리.
 */
async function resyncReviews(ctx: MigrateCtx): Promise<void> {
  const { legacy, prisma, report } = ctx;
  console.log('── sync: reviews 재대조 ──');
  const reviews = await legacy(`SELECT * FROM g5_shop_item_use ORDER BY is_id`);
  const index = await loadReviewLineIndex(
    ctx,
    reviews.map((r) => asStr(r.it_id)),
  );
  const stats = emptyReviewStats();
  for (const r of reviews) await upsertReview(ctx, r, index, stats);
  if (stats.inserted > 0) report.count('sync.후기 삽입', stats.inserted);
  if (stats.updated > 0) report.count('sync.후기 갱신', stats.updated);
  if (stats.unmapped > 0) report.count('sync.후기 귀속 실패(보존)', stats.unmapped);

  // 삭제 검출(리포트-온리) — 타깃 이관분(legacyIsId 보유) 중 레거시에 없는 것.
  const legacyIsIds = new Set(reviews.map((r) => asInt(r.is_id)));
  const targetRows = await prisma.spReview.findMany({
    where: { legacyIsId: { not: null } },
    select: { legacyIsId: true },
  });
  for (const t of targetRows) {
    if (t.legacyIsId !== null && !legacyIsIds.has(t.legacyIsId)) {
      report.note('sync.후기 삭제 검출(레거시 부재 — 수동 확인)', `is_id ${String(t.legacyIsId)}`, 30);
    }
  }
}

/** 1:1문의 재대조 — 답변 등록이 질문 행 qa_status 를 UPDATE 하므로 전행 대조 필수(P1-7). */
async function resyncQa(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy } = ctx;
  const plan = await buildCopyPlan(ctx.schema, 'g5_qa_content');
  await syncTableRows(ctx, {
    table: 'g5_qa_content',
    keyCols: ['qa_id'],
    plan,
    legacyRows: await legacy(`SELECT * FROM g5_qa_content`),
    targetRows: await g5.select(`SELECT * FROM g5_qa_content`),
    reportPrefix: 'sync.1:1문의',
  });
}

/** 주소록 재대조 — ad_id 재발급 구조라 행 매칭 불가 → 회원별 내용 상이 시 replace-all. */
async function resyncAddresses(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy, report } = ctx;
  const protectedIds = protectedMbIds();
  const plan = await buildCopyPlan(ctx.schema, 'g5_shop_order_address', { dropAutoIncrement: true });
  const contentOf = (rows: Row[]): string =>
    rows
      .map((r) => plan.cols.filter((c) => c !== 'mb_id').map((c) => normValue(r[c])).join(''))
      .sort()
      .join('\n');

  const groupBy = (rows: Row[]): Map<string, Row[]> => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const mb = asStr(r.mb_id);
      const list = m.get(mb) ?? [];
      list.push(r);
      m.set(mb, list);
    }
    return m;
  };
  const legacyByMb = groupBy((await legacy(`SELECT * FROM g5_shop_order_address`)));
  const targetByMb = groupBy(await g5.select(`SELECT * FROM g5_shop_order_address`));
  const targetMembers = new Set(
    (await g5.select(`SELECT mb_id FROM g5_member`)).map((r) => asStr(r.mb_id)),
  );

  let replaced = 0;
  for (const [mbId, legacyRows] of legacyByMb.entries()) {
    if (!targetMembers.has(mbId) || protectedIds.has(mbId)) continue;
    const targetRows = targetByMb.get(mbId) ?? [];
    if (contentOf(legacyRows) === contentOf(targetRows)) continue;
    if (!ctx.dryRun) {
      await g5.execute(`DELETE FROM g5_shop_order_address WHERE mb_id = ?`, [mbId]);
      const insertRows = legacyRows.map((r) => {
        const out: Row = {};
        for (const c of plan.cols) out[c] = r[c] ?? null;
        for (const [k, v] of Object.entries(plan.fillers)) out[k] = v;
        return out;
      });
      for (const part of chunk(insertRows, 200)) {
        await g5.insertMany('g5_shop_order_address', plan.insertCols, part);
      }
    }
    replaced += 1;
  }
  report.count('sync.주소록 replace(회원 수)', replaced);
}

/** (c) 삭제·이상 검출 — 리포트만(자동 삭제 금지, 사용자 확정 정책). */
async function detectDeletions(ctx: MigrateCtx, legacyOds: Set<string>): Promise<void> {
  const { g5, legacy, report } = ctx;

  // od: 타깃에 있고 레거시에 없음 — 신규 플랫폼 자체 주문(v4 quoteId 라인 보유)만 제외하고
  // 전부 리포트. 이관분 판별을 "v5 라인 보유"로 하면 오염 라인(io_id='')뿐인 옛 주문이
  // 빠진다(리허설 실증) — 삭제 검출은 과검출이 미검출보다 안전(리포트-온리 정책).
  const NEW_PLATFORM_QUOTE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const targetOnly = (await g5.select(`SELECT od_id FROM g5_shop_order`))
    .map((r) => asStr(r.od_id))
    .filter((od) => !legacyOds.has(od));
  for (const part of chunk(targetOnly, 200)) {
    for (const odId of part) {
      const lines = await g5.select(
        `SELECT io_id FROM g5_shop_cart WHERE od_id = ? AND io_id <> ''`,
        [odId],
      );
      const isNewPlatformOrder = lines.some((l) => NEW_PLATFORM_QUOTE_RE.test(asStr(l.io_id)));
      if (!isNewPlatformOrder) {
        report.note('sync.주문 삭제 검출(레거시 부재 — 수동 확인)', odId, 50);
      }
    }
  }

  // wr: 게시판별 타깃 wr_id ∖ 레거시
  for (const boTable of MIGRATE_BOARDS) {
    const table = `g5_write_${boTable}`;
    if (!(await g5.tableExists(table))) continue;
    const legacyIds = new Set(
      (await legacy(`SELECT wr_id FROM \`${table}\``)).map((r) => asStr(r.wr_id)),
    );
    const targetIds = (await g5.select(`SELECT wr_id FROM \`${table}\``)).map((r) =>
      asStr(r.wr_id),
    );
    for (const wrId of targetIds) {
      if (!legacyIds.has(wrId)) {
        report.note('sync.게시글 삭제 검출(레거시 부재 — 수동 확인)', `${boTable}/${wrId}`, 50);
      }
    }
  }
}

await main();
