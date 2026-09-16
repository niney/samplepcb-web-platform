import { constants } from 'node:fs';
import { copyFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createConnection } from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createDatabaseSnapshot, inspectDatabaseSnapshot } from '../../../lib/db-snapshot';
import {
  assertResetTargets, RESET_ANCHOR_COLUMNS, RESET_ANCHOR_ITEM_IDS,
  RESET_PRESERVED_TABLES, resetTableAction,
} from './reset-data-policy';
import type { ResetAction, ResetTargets } from './reset-data-policy';
import { resolveMigrateTmpDir } from './util';

interface TableMeta extends RowDataPacket { name: string; type: string }
interface CountRow extends RowDataPacket { n: number | string }
interface ColumnRow extends RowDataPacket { name: string }
interface ForeignKeyRow extends RowDataPacket { sourceSchema: string; sourceTable: string; targetTable: string }
interface TriggerRow extends RowDataPacket { tableName: string; event: string }
interface FlagRow extends RowDataPacket { value: number | null }

export interface ResetTablePlan {
  table: string;
  action: ResetAction;
  rows: number;
  deleteRows: number;
  reason: string;
}

export interface ResetDataOptions {
  targets: ResetTargets;
  execute?: boolean;
  confirmDatabase?: string;
  backupDirectory?: string;
  ledgerDirectory?: string;
  onPlan?: (plan: readonly ResetTablePlan[]) => void;
  onProgress?: (message: string) => void | Promise<void>;
}

export interface ResetDataResult {
  executed: boolean;
  plan: ResetTablePlan[];
  backup: string | null;
}

function identifier(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`지원하지 않는 SQL 식별자: ${name}`);
  return `\`${name}\``;
}

function anchorFilter(table: string): { where: string; values: string[] } {
  const columns = RESET_ANCHOR_COLUMNS[table];
  if (columns === undefined) return { where: '', values: [] };
  const placeholders = RESET_ANCHOR_ITEM_IDS.map(() => '?').join(', ');
  return {
    where: ` WHERE NOT (${columns.map((col) => `COALESCE(${identifier(col)} IN (${placeholders}), 0)`).join(' AND ')})`,
    values: columns.flatMap(() => [...RESET_ANCHOR_ITEM_IDS]),
  };
}

async function countRows(connection: Connection, table: string, removable = false): Promise<number> {
  const filter = removable ? anchorFilter(table) : { where: '', values: [] };
  const [rows] = await connection.query<CountRow[]>(`SELECT COUNT(*) n FROM ${identifier(table)}${filter.where}`, filter.values);
  const value = Number(rows[0]?.n);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`행 수 확인 실패: ${table}`);
  return value;
}

async function inspectPlan(connection: Connection, database: string): Promise<ResetTablePlan[]> {
  const [tables] = await connection.query<TableMeta[]>(
    'SELECT TABLE_NAME name, TABLE_TYPE type FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [database],
  );
  const baseTables = tables.filter((table) => table.type === 'BASE TABLE');
  for (const required of ['g5_config', 'g5_shop_default', 'g5_member', '_prisma_migrations']) {
    if (!baseTables.some((table) => table.name === required)) throw new Error(`플랫폼 DB 필수 테이블이 없습니다: ${required}`);
  }
  const unsupported = tables.filter((table) => !['BASE TABLE', 'VIEW'].includes(table.type));
  if (unsupported.length > 0) throw new Error(`초기화를 지원하지 않는 테이블 형식: ${unsupported.map((t) => t.name).join(', ')}`);
  const plan: ResetTablePlan[] = [];
  for (const { name } of baseTables) {
    const action = resetTableAction(name);
    const rows = await countRows(connection, name);
    const deleteRows = action === 'preserve' ? 0 : action === 'anchors' ? await countRows(connection, name, true) : rows;
    plan.push({ table: name, action, rows, deleteRows,
      reason: RESET_PRESERVED_TABLES[name] ?? (action === 'anchors' ? '고정 결제 상품·연결만 보존' : '업무·회원·이력 데이터 초기화') });
  }
  for (const table of ['g5_config', 'g5_shop_default']) {
    if (plan.find((item) => item.table === table)?.rows !== 1) {
      throw new Error(`보존할 사이트 설정은 정확히 1행이어야 합니다: ${table}`);
    }
  }
  const [events] = await connection.query<CountRow[]>(
    "SELECT COUNT(*) n FROM information_schema.EVENTS WHERE EVENT_SCHEMA=? AND STATUS='ENABLED'", [database],
  );
  if (Number(events[0]?.n) > 0) throw new Error('대상 DB에 실행 중인 예약 이벤트가 있습니다. 해당 이벤트를 중지한 뒤 다시 확인하세요');
  const [triggers] = await connection.query<TriggerRow[]>(
    'SELECT EVENT_OBJECT_TABLE tableName, EVENT_MANIPULATION event FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', [database],
  );
  for (const trigger of triggers) {
    const deletesRows = trigger.event === 'DELETE' && plan.some((item) => item.table === trigger.tableName && item.action === 'anchors');
    const updatesCounters = trigger.event === 'UPDATE' && ['g5_board', 'g5_shop_item'].includes(trigger.tableName);
    if (deletesRows || updatesCounters) {
      throw new Error(`초기화 중 실행될 트리거를 먼저 확인해야 합니다: ${trigger.tableName} ${trigger.event}`);
    }
  }
  const [references] = await connection.query<ForeignKeyRow[]>(
    `SELECT TABLE_SCHEMA sourceSchema, TABLE_NAME sourceTable, REFERENCED_TABLE_NAME targetTable
       FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=?`, [database],
  );
  const byTable = new Map(plan.map((item) => [item.table, item]));
  for (const ref of references) {
    if (byTable.get(ref.targetTable)?.action === 'preserve') continue;
    if (ref.sourceSchema !== database || byTable.get(ref.sourceTable)?.action !== 'truncate') {
      throw new Error(`보존/외부 테이블이 초기화 데이터에 FK로 연결되어 있습니다: ${ref.sourceSchema}.${ref.sourceTable} → ${ref.targetTable}`);
    }
  }
  return plan;
}

async function clearDerivedSettings(connection: Connection, plan: readonly ResetTablePlan[]): Promise<void> {
  const updates: Readonly<Record<string, Readonly<Record<string, string | number>>>> = {
    g5_board: { bo_count_write: 0, bo_count_comment: 0, bo_notice: '' },
    g5_shop_item: { it_sum_qty: 0, it_use_cnt: 0, it_use_avg: 0 },
  };
  for (const [table, values] of Object.entries(updates)) {
    if (!plan.some((item) => item.table === table)) continue;
    const [columns] = await connection.query<ColumnRow[]>(
      'SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table],
    );
    const present = Object.entries(values).filter(([name]) => columns.some((column) => column.name === name));
    if (present.length > 0) {
      await connection.query(`UPDATE ${identifier(table)} SET ${present.map(([name]) => `${identifier(name)}=?`).join(', ')}`, present.map(([, value]) => value));
    }
  }
}

async function archiveLedger(database: string, backup: string, directory?: string): Promise<void> {
  const source = path.join(directory ?? await resolveMigrateTmpDir(), `ledger-${database}.json`);
  try {
    await copyFile(source, path.join(backup, `ledger-${database}.before.json`), constants.COPYFILE_EXCL);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  await unlink(source);
}

/** 기본은 조회. 실제 삭제는 대상 확인과 검증된 전체 백업 뒤 전용 연결 하나에서 수행한다. */
export async function resetMigrationData(options: ResetDataOptions): Promise<ResetDataResult> {
  const execute = options.execute === true;
  assertResetTargets(options.targets, execute, options.confirmDatabase);
  const target = options.targets.target;
  const connection = await createConnection(target);
  const lockName = `samplepcb-schema-${target.database}`.slice(0, 64);
  let locked = false;
  let foreignKeyChecks: number | null = null;
  const completed: string[] = [];
  try {
    const [actual] = await connection.query<(RowDataPacket & { name: string })[]>('SELECT DATABASE() name');
    if (actual[0]?.name !== target.database) throw new Error('실제 접속 DB가 설정한 초기화 대상과 다릅니다');
    if (execute) {
      const [lock] = await connection.query<FlagRow[]>('SELECT GET_LOCK(?, 0) value', [lockName]);
      if (lock[0]?.value !== 1) throw new Error('다른 DB 준비/초기화 작업이 실행 중입니다');
      locked = true;
    }
    const plan = await inspectPlan(connection, target.database);
    options.onPlan?.(plan);
    if (!execute) return { executed: false, plan, backup: null };

    const backup = await createDatabaseSnapshot({ target, label: 'before-legacy-reset',
      ...(options.backupDirectory === undefined ? {} : { directory: options.backupDirectory }) });
    await inspectDatabaseSnapshot(backup, target);
    await options.onProgress?.(`검증된 전체 백업: ${backup}`);
    const reportFile = path.join(backup, 'reset-report.json');
    const report = { database: target.database, host: target.host, port: target.port,
      startedAt: new Date().toISOString(), plan, completed };
    const saveReport = async (status: string, error?: string): Promise<void> => {
      await writeFile(reportFile, JSON.stringify({ ...report, status, updatedAt: new Date().toISOString(), ...(error === undefined ? {} : { error }) }, null, 2), { mode: 0o600 });
    };
    await saveReport('running');
    try {
      await archiveLedger(target.database, backup, options.ledgerDirectory);
      const [checks] = await connection.query<FlagRow[]>('SELECT @@SESSION.FOREIGN_KEY_CHECKS value');
      foreignKeyChecks = checks[0]?.value ?? 1;
      await connection.query('SET SESSION FOREIGN_KEY_CHECKS=0');
      for (const item of plan) {
        if (item.action === 'preserve') continue;
        if (item.action === 'truncate') {
          await connection.query(`TRUNCATE TABLE ${identifier(target.database)}.${identifier(item.table)}`);
        } else {
          const filter = anchorFilter(item.table);
          await connection.query(`DELETE FROM ${identifier(target.database)}.${identifier(item.table)}${filter.where}`, filter.values);
        }
        completed.push(item.table);
        await options.onProgress?.(`초기화: ${item.table}`);
        await saveReport('running');
      }
      await clearDerivedSettings(connection, plan);
      for (const item of plan) {
        const remaining = await countRows(connection, item.table);
        if (remaining !== item.rows - item.deleteRows) {
          throw new Error(`초기화 후 행 수 불일치: ${item.table} (예상 ${String(item.rows - item.deleteRows)}, 실제 ${String(remaining)}). 실행 중인 쓰기 작업을 확인하세요`);
        }
        if (item.action === 'anchors' && await countRows(connection, item.table, true) !== 0) {
          throw new Error(`고정 상품 이외 데이터가 남아 있습니다: ${item.table}`);
        }
      }
      await saveReport('complete');
    } catch (error) {
      await saveReport('failed', error instanceof Error ? error.message : String(error));
      throw new Error(`초기화 실패. 운영 중지 상태를 유지하고 백업/리포트를 확인하세요: ${backup}`, { cause: error });
    }
    return { executed: true, plan, backup };
  } finally {
    try {
      if (foreignKeyChecks !== null) await connection.query('SET SESSION FOREIGN_KEY_CHECKS=?', [foreignKeyChecks]);
    } finally {
      try { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); }
      finally { await connection.end(); }
    }
  }
}
