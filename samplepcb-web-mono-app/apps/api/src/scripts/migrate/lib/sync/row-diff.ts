// 공용 행 대조·동기(순수 비교 + 제네릭 테이블 sync) — 증분 동기화(migrate:sync) 전용.
//
// 레거시에 수정시각 컬럼이 없어(계획 §Context) 시간 기반 증분이 불가하므로,
// "레거시 행 vs 타깃 행"을 컬럼 단위로 대조해 상이분만 UPDATE 한다. 규모(회원 6천·글 1.2천·
// 1:1 0.7천)가 작아 전량 대조 비용이 수 초 — 단순함이 정확성을 이긴다.
import type { LegacyRow } from '../../../../lib/legacy-db';
import type { MigrateCtx, CopyPlan } from '../context';
import { rowFromLegacy } from '../context';
import type { Row } from '../g5-writer';
import { asStr } from '../util';

/**
 * 값 정규화 — mysql2 가 컬럼 타입에 따라 number/string/Buffer 로 돌려주는 값을
 * 문자열로 통일해 비교한다(dateStrings: true 라 datetime 도 문자열).
 * null/undefined 는 ''(그누보드 관례상 NOT NULL DEFAULT '' 가 지배적).
 */
export function normValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return asStr(v);
}

/** 두 행에서 값이 다른 컬럼 목록. */
export function diffCols(
  legacyRow: LegacyRow,
  targetRow: Row,
  cols: readonly string[],
): string[] {
  const out: string[] = [];
  for (const c of cols) {
    if (normValue(legacyRow[c]) !== normValue(targetRow[c])) out.push(c);
  }
  return out;
}

export interface TableSyncResult {
  inserted: number;
  updated: number;
}

export interface TableSyncOptions {
  table: string;
  /** 자연키 컬럼(레거시·타깃 공통 보존 키 — 예: wr_id, qa_id, (bo_table,wr_id,bf_no)) */
  keyCols: readonly string[];
  plan: CopyPlan;
  legacyRows: readonly LegacyRow[];
  targetRows: readonly Row[];
  /** 대조에서 제외할 컬럼(키 컬럼은 자동 제외) */
  excludeCols?: readonly string[];
  reportPrefix: string;
}

const keyOf = (row: LegacyRow | Row, keyCols: readonly string[]): string =>
  keyCols.map((c) => normValue((row)[c])).join('');

/**
 * 자연키 보존 테이블의 제네릭 동기: 부재 → INSERT(plan 전체+filler), 존재·상이 → 상이 컬럼만 UPDATE.
 * (filler 는 INSERT 에만 — UPDATE SET 은 plan.cols 교집합에서만 뽑는다)
 */
export async function syncTableRows(ctx: MigrateCtx, opts: TableSyncOptions): Promise<TableSyncResult> {
  const { g5, report } = ctx;
  const exclude = new Set([...(opts.excludeCols ?? []), ...opts.keyCols]);
  const compareCols = opts.plan.cols.filter((c) => !exclude.has(c));

  const targetByKey = new Map<string, Row>();
  for (const row of opts.targetRows) targetByKey.set(keyOf(row, opts.keyCols), row);

  let inserted = 0;
  let updated = 0;
  for (const legacyRow of opts.legacyRows) {
    const key = keyOf(legacyRow, opts.keyCols);
    const target = targetByKey.get(key);
    if (target === undefined) {
      if (!ctx.dryRun) await g5.insertRow(opts.table, rowFromLegacy(legacyRow, opts.plan));
      inserted += 1;
      continue;
    }
    const changed = diffCols(legacyRow, target, compareCols);
    if (changed.length === 0) continue;
    const set: Row = {};
    for (const c of changed) set[c] = legacyRow[c] ?? null;
    if (!ctx.dryRun) {
      const where: Row = {};
      for (const c of opts.keyCols) where[c] = legacyRow[c];
      await g5.updateRow(opts.table, set, where);
    }
    updated += 1;
  }
  if (inserted > 0) report.count(`${opts.reportPrefix} 삽입`, inserted);
  if (updated > 0) report.count(`${opts.reportPrefix} 갱신`, updated);
  return { inserted, updated };
}
