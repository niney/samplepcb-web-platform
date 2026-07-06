// phase 03 — 게시판 8종: g5_group/g5_board 구성 + g5_write_* 데이터(wr_id 보존) + 첨부.
//
// 정책(계획 §게시판):
// - 동명 게시판(notice/qa — 설치 기본과 겹침)은 타깃 g5_board 행 유지, **데이터만 주입**
//   (bo_notice·카운트만 갱신). 나머지 6개는 행 신설 — 스킨은 sp-lite 보유 스킨(basic/gallery)로
//   정규화(레거시 'theme/…' 스킨명은 구테마 의존이라 승계하지 않음).
// - wr_id 보존이 전부를 지배: bo_notice CSV·wr_parent(댓글)·g5_board_file 키가 전부 wr_id 의존.
// - 실파일: data/file/<bo_table>/ + (에디터·회원 이미지) data/editor·member_image 복사.
//   소스 미러(MIGRATE_LEGACY_DATA_DIR) 미설정이면 DB 만 이관하고 리포트에 남긴다.
import { cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATE_BOARDS } from '../manifest';
import { buildCopyPlan, rowFromLegacy } from '../lib/context';
import type { MigrateCtx } from '../lib/context';
import type { Row } from '../lib/g5-writer';
import { asInt, asStr, chunk } from '../lib/util';

/** 레거시 스킨 성격 실측(gallery 형) — 나머지는 basic. 관리자에서 언제든 조정 가능. */
const GALLERY_BOARDS = new Set(['customer_center', 'review', 'portfolio']);

function targetDataDir(): string {
  return (
    process.env.MIGRATE_TARGET_DATA_DIR ??
    fileURLToPath(new URL('../../../../../../../samplepcb-web/data', import.meta.url))
  );
}

async function copyDataSubdir(ctx: MigrateCtx, subdir: string): Promise<void> {
  const srcRoot = process.env.MIGRATE_LEGACY_DATA_DIR;
  if (srcRoot === undefined || srcRoot === '') {
    ctx.report.note('boards.실파일 복사 생략(MIGRATE_LEGACY_DATA_DIR 미설정)', subdir, 20);
    return;
  }
  const src = path.join(srcRoot, subdir);
  try {
    await access(src);
  } catch {
    ctx.report.note('boards.실파일 소스 없음', src, 40);
    return;
  }
  if (ctx.dryRun) return;
  const dst = path.join(targetDataDir(), subdir);
  // force:false + errorOnExist:false = 기존 파일 보존(타깃 우선) — 재실행 멱등
  await cp(src, dst, { recursive: true, force: false, errorOnExist: false });
  ctx.report.count(`boards.실파일 복사(${subdir})`);
}

export async function runBoardsPhase(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy, report } = ctx;
  console.log('\n── phase 03: boards ──');

  // 1) 게시판 그룹
  const groupPlan = await buildCopyPlan(ctx.schema, 'g5_group');
  for (const row of await legacy(`SELECT * FROM g5_group`)) {
    const grId = asStr(row.gr_id);
    if (await g5.exists('g5_group', { gr_id: grId })) continue;
    if (!ctx.dryRun) await g5.insertRow('g5_group', rowFromLegacy(row, groupPlan));
    report.count('boards.그룹 삽입');
  }

  // 2) 게시판 설정 + write 테이블 + 데이터
  const boardPlan = await buildCopyPlan(ctx.schema, 'g5_board');
  const legacyBoards = await legacy(`SELECT * FROM g5_board`);
  for (const boTable of MIGRATE_BOARDS) {
    const legacyBoard = legacyBoards.find((b) => asStr(b.bo_table) === boTable);
    if (legacyBoard === undefined) {
      report.note('boards.레거시에 없음', boTable, 10);
      continue;
    }
    const writeTable = `g5_write_${boTable}`;
    const skin = GALLERY_BOARDS.has(boTable) ? 'gallery' : 'basic';

    // 2-a) g5_board 행 — 동명 유지 / 신설
    const boardExists = await g5.exists('g5_board', { bo_table: boTable });
    if (!boardExists && !ctx.dryRun) {
      const overrides: Row = { bo_skin: skin, bo_mobile_skin: skin };
      if (boardPlan.insertCols.includes('bo_device')) overrides.bo_device = 'both';
      await g5.insertRow('g5_board', rowFromLegacy(legacyBoard, boardPlan, overrides));
      report.count('boards.게시판 신설');
    }

    // 2-b) write 테이블 생성(신규 구조 기준 — 설치 기본 g5_write_free 를 원형으로 복제)
    if (!(await g5.tableExists(writeTable))) {
      const proto = (await g5.tableExists('g5_write_free')) ? 'g5_write_free' : 'g5_write_notice';
      const createSql = (await g5.showCreateTable(proto)).replace(
        `\`${proto}\``,
        `\`${writeTable}\``,
      );
      if (!ctx.dryRun) {
        await g5.execute(createSql);
        ctx.schema.invalidateTarget(writeTable);
      }
      report.count('boards.write 테이블 생성');
    }
    if (ctx.dryRun && !(await g5.tableExists(writeTable))) {
      // dry-run 에서 테이블이 아직 없으면 행 수만 집계
      const cnt = await legacy(`SELECT COUNT(*) c FROM \`${writeTable}\``);
      report.count(`boards.${boTable} 글(dry-run 예정)`, asInt(cnt[0]?.c));
      continue;
    }

    // 2-c) 글 복사(wr_id 보존)
    const writePlan = await buildCopyPlan(ctx.schema, writeTable);
    const existingIds = new Set(
      (await g5.select(`SELECT wr_id FROM \`${writeTable}\``)).map((r) => asInt(r.wr_id)),
    );
    const legacyRows = await legacy(`SELECT * FROM \`${writeTable}\` ORDER BY wr_id`);
    const rows: Row[] = [];
    for (const row of legacyRows) {
      if (existingIds.has(asInt(row.wr_id))) continue;
      rows.push(rowFromLegacy(row, writePlan));
    }
    if (!ctx.dryRun && rows.length > 0) {
      for (const part of chunk(rows, 200)) {
        await g5.insertMany(writeTable, writePlan.insertCols, part);
      }
    }
    report.count(`boards.${boTable} 글 삽입`, rows.length);

    // 2-d) 카운트·공지 갱신(동명 유지 게시판 포함)
    if (!ctx.dryRun) {
      await g5.execute(
        `UPDATE g5_board bo SET
           bo_count_write = (SELECT COUNT(*) FROM \`${writeTable}\` WHERE wr_is_comment = 0),
           bo_count_comment = (SELECT COUNT(*) FROM \`${writeTable}\` WHERE wr_is_comment = 1),
           bo_notice = ?
         WHERE bo_table = ?`,
        [asStr(legacyBoard.bo_notice), boTable],
      );
    }
  }

  // 3) 첨부 메타(g5_board_file) — (bo_table, wr_id, bf_no) 자연키
  const filePlan = await buildCopyPlan(ctx.schema, 'g5_board_file');
  let fileRows = 0;
  for (const row of await legacy(`SELECT * FROM g5_board_file`)) {
    const boTable = asStr(row.bo_table);
    if (!MIGRATE_BOARDS.includes(boTable)) {
      report.note('boards.첨부 스킵(비이관 게시판)', boTable, 10);
      continue;
    }
    const where = { bo_table: boTable, wr_id: asInt(row.wr_id), bf_no: asInt(row.bf_no) };
    if (await g5.exists('g5_board_file', where)) continue;
    if (!ctx.dryRun) await g5.insertRow('g5_board_file', rowFromLegacy(row, filePlan));
    fileRows += 1;
  }
  report.count('boards.첨부 메타 삽입', fileRows);

  // 4) 실파일 복사 — 게시판 첨부 + 에디터/회원 이미지(계획 결정 ④)
  for (const boTable of MIGRATE_BOARDS) await copyDataSubdir(ctx, path.join('file', boTable));
  await copyDataSubdir(ctx, 'editor');
  await copyDataSubdir(ctx, 'member_image');

  if (!ctx.dryRun) await ctx.ledger.markPhaseDone('boards');
}
