// 마이그레이션 실행 컨텍스트 — 커넥션·원장·리포트·스키마 캐시를 phase 들에 배달한다.
import type { PrismaClient } from '@prisma/client';
import { legacySelect } from '../../../lib/legacy-db';
import type { LegacyRow } from '../../../lib/legacy-db';
import type { ColumnMeta, Row , G5Writer} from './g5-writer';
import { notNullFiller } from './g5-writer';
import type { Ledger } from './ledger';
import { asStr } from './util';

export type LegacySelectFn = (sql: string, params?: readonly (string | number)[]) => Promise<LegacyRow[]>;

/** 실행 리포트 수집기 — 카운터 + 항목별 노트(상한 캡). 마지막에 콘솔+JSON 로 출력. */
export class Report {
  private counters = new Map<string, number>();
  private notes = new Map<string, string[]>();

  count(key: string, n = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + n);
  }

  note(listKey: string, message: string, cap = 300): void {
    const list = this.notes.get(listKey) ?? [];
    if (list.length < cap) list.push(message);
    else if (list.length === cap) list.push(`… (이후 생략 — ${listKey} ${String(cap)}건 초과)`);
    this.notes.set(listKey, list);
    this.count(`${listKey}(건수)`);
  }

  print(): void {
    console.log('\n══ 마이그레이션 리포트 ══');
    for (const [k, v] of [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${k}: ${String(v)}`);
    }
    for (const [k, list] of this.notes.entries()) {
      console.log(`\n■ ${k} (${String(list.length)}건 표시)`);
      for (const line of list.slice(0, 30)) console.log(`  - ${line}`);
      if (list.length > 30) console.log(`  … 외 ${String(list.length - 30)}건 (JSON 리포트 참조)`);
    }
  }

  toJSON(): { counters: Record<string, number>; notes: Record<string, string[]> } {
    return {
      counters: Object.fromEntries(this.counters),
      notes: Object.fromEntries(this.notes),
    };
  }
}

/** 레거시/타깃 컬럼 메타 캐시. */
export class SchemaCache {
  private target = new Map<string, ColumnMeta[]>();
  private legacy = new Map<string, ColumnMeta[]>();

  constructor(
    private readonly g5: G5Writer,
    private readonly legacyFn: LegacySelectFn,
  ) {}

  async targetColumns(table: string): Promise<ColumnMeta[]> {
    const cached = this.target.get(table);
    if (cached !== undefined) return cached;
    const cols = await this.g5.getColumns(table);
    this.target.set(table, cols);
    return cols;
  }

  async legacyColumns(table: string): Promise<ColumnMeta[]> {
    const cached = this.legacy.get(table);
    if (cached !== undefined) return cached;
    const rows = await this.legacyFn(
      `SELECT COLUMN_NAME name, DATA_TYPE dataType, IS_NULLABLE nullable, COLUMN_DEFAULT dflt, EXTRA extra,
              CHARACTER_MAXIMUM_LENGTH maxLen
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
        ORDER BY ORDINAL_POSITION`,
      [table],
    );
    const cols: ColumnMeta[] = rows.map((r) => ({
      name: asStr(r.name),
      dataType: asStr(r.dataType),
      isNullable: asStr(r.nullable) === 'YES',
      hasDefault: r.dflt !== null,
      isAutoIncrement: asStr(r.extra).includes('auto_increment'),
      maxLen: r.maxLen === null ? null : Number(r.maxLen),
    }));
    this.legacy.set(table, cols);
    return cols;
  }

  /** 타깃 테이블 신규 생성(write_*) 후 컬럼 캐시 무효화. */
  invalidateTarget(table: string): void {
    this.target.delete(table);
  }

  async legacyTables(): Promise<string[]> {
    const rows = await this.legacyFn(
      `SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
    );
    return rows.map((r) => asStr(r.t));
  }
}

export interface MigrateCtx {
  g5: G5Writer;
  prisma: PrismaClient;
  legacy: LegacySelectFn;
  ledger: Ledger;
  report: Report;
  schema: SchemaCache;
  dryRun: boolean;
  /** 게이트 위반을 중단 대신 경고로 낮춤(운영 드리프트 검토 후 의식적으로만 사용). */
  allowUnknown: boolean;
  tmpDir: string;
}

export interface CopyPlan {
  /** 교집합 복사 컬럼(레거시→타깃 동명 복사) */
  cols: string[];
  /** 타깃 전용 NOT NULL·무default 컬럼의 명시 채움값 */
  fillers: Record<string, string | number>;
  /** INSERT 대상 전체 컬럼(cols + filler 키, 순서 고정) */
  insertCols: string[];
}

/**
 * 교집합 복사 계획 — 계획 문서 §NOT NULL 규칙(#7):
 * INSERT 컬럼 = (레거시 ∩ 타깃, exclude 제외) ∪ (타깃 전용 NOT NULL 무default → 명시 채움).
 */
export async function buildCopyPlan(
  schema: SchemaCache,
  table: string,
  opts: { exclude?: readonly (string | RegExp)[]; dropAutoIncrement?: boolean } = {},
): Promise<CopyPlan> {
  const [targetCols, legacyCols] = await Promise.all([
    schema.targetColumns(table),
    schema.legacyColumns(table),
  ]);
  if (targetCols.length === 0) throw new Error(`타깃에 테이블이 없습니다: ${table}`);
  const legacyNames = new Set(legacyCols.map((c) => c.name));
  const excluded = (name: string): boolean =>
    (opts.exclude ?? []).some((e) => (typeof e === 'string' ? e === name : e.test(name)));

  const cols: string[] = [];
  const fillers: Record<string, string | number> = {};
  for (const meta of targetCols) {
    if (opts.dropAutoIncrement === true && meta.isAutoIncrement) continue;
    if (legacyNames.has(meta.name) && !excluded(meta.name)) {
      cols.push(meta.name);
      continue;
    }
    if (!meta.isNullable && !meta.hasDefault && !meta.isAutoIncrement) {
      fillers[meta.name] = notNullFiller(meta);
    }
  }
  return { cols, fillers, insertCols: [...cols, ...Object.keys(fillers)] };
}

/** 레거시 행 → 복사 계획에 따른 INSERT 행. overrides 는 마지막에 덮어쓴다(재작성 컬럼). */
export function rowFromLegacy(legacyRow: LegacyRow, plan: CopyPlan, overrides: Row = {}): Row {
  const out: Row = {};
  for (const c of plan.cols) out[c] = legacyRow[c] ?? null;
  for (const [k, v] of Object.entries(plan.fillers)) out[k] = v;
  for (const [k, v] of Object.entries(overrides)) out[k] = v;
  return out;
}

export { legacySelect };
