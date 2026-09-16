import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createConnection } from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as snapshots from '../../../lib/db-snapshot';
import { RESET_ANCHOR_ITEM_IDS, RESET_PRESERVED_TABLES } from './reset-data-policy';
import type { ResetTargets } from './reset-data-policy';
import { resetMigrationData } from './reset-data';

interface ValueRow extends RowDataPacket { value: string; n: number }

describe.skipIf(process.env.MIGRATION_RESET_INTEGRATION !== '1')('업무 데이터 초기화 — 격리 MariaDB 실증', () => {
  let root: Connection;
  let targets: ResetTargets;
  let directory: string;
  let ledgerDirectory: string;
  const ownedDatabases: string[] = [];

  const table = (name: string): string => `\`${targets.target.database}\`.\`${name}\``;
  const count = async (name: string, database = targets.target.database): Promise<number> => {
    const [rows] = await root.query<ValueRow[]>(`SELECT COUNT(*) n FROM \`${database}\`.\`${name}\``);
    return Number(rows[0]?.n);
  };
  const options = () => ({ targets, execute: true, confirmDatabase: targets.target.database,
    backupDirectory: join(directory, 'backups'), ledgerDirectory });

  beforeEach(async () => {
    root = await createConnection({ host: '127.0.0.1', port: 3306, user: 'root' });
    const name = `samplepcb_reset_test_${String(Date.now())}_${randomBytes(3).toString('hex')}`;
    const target = snapshots.databaseTarget(`mysql://root@127.0.0.1:3306/${name}`);
    targets = { target, g5: target, runtime: target, runtimeG5: target, legacy: { ...target, database: `${name}_legacy` } };
    for (const database of [name, targets.legacy.database, `${name}_dev`]) {
      await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
      ownedDatabases.push(database);
    }
    for (const database of [targets.legacy.database, `${name}_dev`]) {
      await root.query(`CREATE TABLE \`${database}\`.sentinel (value VARCHAR(30))`);
      await root.query(`INSERT INTO \`${database}\`.sentinel VALUES ('unchanged')`);
    }
    for (const name of Object.keys(RESET_PRESERVED_TABLES)) {
      if (name === 'g5_board') {
        await root.query(`CREATE TABLE ${table(name)} (value VARCHAR(50), bo_count_write INT, bo_count_comment INT, bo_notice VARCHAR(30)) ENGINE=MyISAM`);
        await root.query(`INSERT INTO ${table(name)} VALUES ('board settings',3,2,'1,2')`);
      } else {
        await root.query(`CREATE TABLE ${table(name)} (id INT PRIMARY KEY, value VARCHAR(50)) ENGINE=InnoDB`);
        await root.query(`INSERT INTO ${table(name)} VALUES (1,?)`, [`keep ${name}`]);
      }
    }
    for (const name of ['g5_member', 'g5_auth', 'g5_point', 'g5_member_social_profiles', 'g5_member_auto_login',
      'g5_shop_order_address', 'g5_shop_order', 'g5_shop_cart', 'g5_write_notice', 'g5_board_file',
      'sp_quote', 'sp_order_spec', 'sp_pcb_po', 'sp_develop_request', 'sp_develop_document',
      'sp_market_expert', 'sp_market_project', 'sp_market_contract', 'sp_member_profile', 'sp_partner_member',
      'sp_part', 'sp_file', 'sp_mail_log', 'sp_ai_job']) {
      await root.query(`CREATE TABLE ${table(name)} (id INT PRIMARY KEY AUTO_INCREMENT, value VARCHAR(40)) ENGINE=${name.startsWith('g5_') ? 'MyISAM' : 'InnoDB'}`);
      await root.query(`INSERT INTO ${table(name)} (value) VALUES ('business data')`);
    }
    await root.query(`CREATE TABLE ${table('sp_bom_quote')} (id INT PRIMARY KEY) ENGINE=InnoDB`);
    await root.query(`CREATE TABLE ${table('sp_bom_quote_item')} (id INT PRIMARY KEY, quote_id INT, FOREIGN KEY (quote_id) REFERENCES ${table('sp_bom_quote')}(id)) ENGINE=InnoDB`);
    await root.query(`INSERT INTO ${table('sp_bom_quote')} VALUES (1)`);
    await root.query(`INSERT INTO ${table('sp_bom_quote_item')} VALUES (1,1)`);
    await root.query(`CREATE TABLE ${table('g5_shop_item')} (it_id VARCHAR(30) PRIMARY KEY, value VARCHAR(50), it_sum_qty INT, it_use_cnt INT, it_use_avg DECIMAL(2,1)) ENGINE=MyISAM`);
    for (const id of [...RESET_ANCHOR_ITEM_IDS, 'legacy-product']) {
      await root.query(`INSERT INTO ${table('g5_shop_item')} VALUES (?, 'product settings', 7, 2, 4.5)`, [id]);
    }
    await root.query(`CREATE TABLE ${table('g5_shop_event_item')} (it_id VARCHAR(30))`);
    await root.query(`INSERT INTO ${table('g5_shop_event_item')} VALUES ('sp-pcb-std'),('legacy-product')`);
    await root.query(`CREATE TABLE ${table('g5_shop_item_relation')} (it_id VARCHAR(30), it_id2 VARCHAR(30))`);
    await root.query(`INSERT INTO ${table('g5_shop_item_relation')} VALUES ('sp-pcb-std','sp-bom-parts'),('sp-pcb-std','legacy-product')`);
    directory = await mkdtemp(join(tmpdir(), 'samplepcb-reset-test-'));
    ledgerDirectory = join(directory, 'ledger');
    await mkdir(ledgerDirectory);
    await writeFile(join(ledgerDirectory, `ledger-${targets.target.database}.json`), '{"orders":{"old-order":1}}');
  }, 30_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      // 이 테스트가 CREATE DATABASE로 만든 이름만 제거한다. 레거시/운영 DB에는 접근하지 않는다.
      for (const name of ownedDatabases.splice(0).reverse()) {
        if (!/^samplepcb_reset_test_\d+_[a-f0-9]{6}(?:_legacy|_dev)?$/.test(name)) throw new Error('Unexpected fixture DB');
        await root.query(`DROP DATABASE \`${name}\``);
      }
    } finally {
      await root.end();
    }
    if (directory) {
      const resolved = resolve(directory);
      if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('samplepcb-reset-test-')) throw new Error('Unexpected fixture directory');
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it('미리보기는 설정/데이터/원장에 쓰지 않고 BOM·개발·회원 삭제 건수를 보여준다', async () => {
    const result = await resetMigrationData({ ...options(), execute: false });
    expect(result.executed).toBe(false);
    expect(result.backup).toBeNull();
    for (const name of ['sp_bom_quote', 'sp_develop_request', 'sp_market_contract', 'g5_member']) {
      expect(result.plan.find((item) => item.table === name)?.deleteRows).toBe(1);
      expect(await count(name)).toBe(1);
    }
    expect(await count('sp_develop_settings')).toBe(1);
    await expect(stat(join(ledgerDirectory, `ledger-${targets.target.database}.json`))).resolves.toBeDefined();
  });

  it('설정과 7개 앵커를 보존하고 FK가 있는 BOM까지 모든 업무 행을 비우며 재실행도 가능하다', async () => {
    const result = await resetMigrationData(options());
    expect(result.executed).toBe(true);
    for (const item of result.plan.filter((item) => item.action === 'truncate')) expect(await count(item.table), item.table).toBe(0);
    for (const name of Object.keys(RESET_PRESERVED_TABLES).filter((name) => name !== 'g5_board')) {
      const [rows] = await root.query<ValueRow[]>(`SELECT value FROM ${table(name)}`);
      expect(rows[0]?.value, name).toBe(`keep ${name}`);
    }
    expect(await count('g5_shop_item')).toBe(7);
    expect(await count('g5_shop_event_item')).toBe(1);
    expect(await count('g5_shop_item_relation')).toBe(1);
    const [board] = await root.query<RowDataPacket[]>(`SELECT * FROM ${table('g5_board')}`);
    expect(board[0]).toMatchObject({ value: 'board settings', bo_count_write: 0, bo_count_comment: 0, bo_notice: '' });
    const [items] = await root.query<RowDataPacket[]>(`SELECT it_sum_qty, it_use_cnt, it_use_avg FROM ${table('g5_shop_item')}`);
    expect(items.every((row) => row.it_sum_qty === 0 && row.it_use_cnt === 0 && Number(row.it_use_avg) === 0)).toBe(true);
    expect(await count('sentinel', targets.legacy.database)).toBe(1);
    expect(await count('sentinel', `${targets.target.database}_dev`)).toBe(1);
    if (result.backup === null) throw new Error('Missing backup');
    await snapshots.inspectDatabaseSnapshot(result.backup, targets.target);
    expect(await readFile(join(result.backup, `ledger-${targets.target.database}.before.json`), 'utf8')).toContain('old-order');
    await expect(stat(join(ledgerDirectory, `ledger-${targets.target.database}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(result.backup, 'reset-report.json'), 'utf8')).toContain('"status": "complete"');
    expect((await resetMigrationData(options())).executed).toBe(true);
  }, 30_000);

  it('백업 실패 시 데이터와 기존 이관 원장을 그대로 둔다', async () => {
    vi.spyOn(snapshots, 'createDatabaseSnapshot').mockRejectedValueOnce(new Error('fixture backup failure'));
    await expect(resetMigrationData(options())).rejects.toThrow('fixture backup failure');
    expect(await count('g5_member')).toBe(1);
    expect(await count('sp_bom_quote')).toBe(1);
    await expect(stat(join(ledgerDirectory, `ledger-${targets.target.database}.json`))).resolves.toBeDefined();
  });

  it('백업 검증 실패도 삭제 전에 중단한다', async () => {
    vi.spyOn(snapshots, 'inspectDatabaseSnapshot').mockRejectedValueOnce(new Error('fixture hash failure'));
    await expect(resetMigrationData(options())).rejects.toThrow('fixture hash failure');
    expect(await count('g5_member')).toBe(1);
    expect(await count('sp_develop_request')).toBe(1);
  });

  it('다른 초기화/DDL 작업이 잠금을 보유하면 실행하지 않는다', async () => {
    const name = `samplepcb-schema-${targets.target.database}`.slice(0, 64);
    await root.query('SELECT GET_LOCK(?,0)', [name]);
    try {
      await expect(resetMigrationData(options())).rejects.toThrow('다른 DB 준비/초기화');
      expect(await count('g5_member')).toBe(1);
    } finally { await root.query('SELECT RELEASE_LOCK(?)', [name]); }
  });

  it('개발 DB가 대상 데이터를 FK로 참조하면 원본을 비우지 않는다', async () => {
    await root.query(`CREATE TABLE \`${targets.target.database}_dev\`.sp_link (id INT, FOREIGN KEY (id) REFERENCES ${table('sp_bom_quote')}(id)) ENGINE=InnoDB`);
    await expect(resetMigrationData(options())).rejects.toThrow('보존/외부 테이블');
    expect(await count('sp_bom_quote')).toBe(1);
  });

  it('분류되지 않은 테이블은 미리보기부터 거부한다', async () => {
    await root.query(`CREATE TABLE ${table('unclassified_settings')} (id INT)`);
    await expect(resetMigrationData({ ...options(), execute: false })).rejects.toThrow('분류하지 못한');
    expect(await count('g5_member')).toBe(1);
  });

  it('사이트 설정이 없는 DB는 다른 데이터를 비우지 않는다', async () => {
    await root.query(`DELETE FROM ${table('g5_config')}`);
    await expect(resetMigrationData(options())).rejects.toThrow('정확히 1행');
    expect(await count('g5_member')).toBe(1);
  });

  it('설정 테이블이 삭제 대상에 FK로 연결되면 보존 정합성 확인을 요구한다', async () => {
    await root.query(`ALTER TABLE ${table('sp_develop_settings')} ADD quote_id INT DEFAULT 1, ADD FOREIGN KEY (quote_id) REFERENCES ${table('sp_bom_quote')}(id)`);
    await expect(resetMigrationData(options())).rejects.toThrow('보존/외부 테이블');
    expect(await count('sp_bom_quote')).toBe(1);
  });

  it('활성 예약 이벤트가 있는 DB는 먼저 중지를 요구한다', async () => {
    await root.query(`CREATE EVENT \`${targets.target.database}\`.fixture_event ON SCHEDULE EVERY 1 DAY STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY DO SET @reset_fixture=1`);
    await expect(resetMigrationData(options())).rejects.toThrow('예약 이벤트');
    expect(await count('g5_member')).toBe(1);
  });

  it('부분 실패를 기록하고 자동 백업으로 회원·BOM·개발 데이터를 복구할 수 있다', async () => {
    let backup = '';
    await expect(resetMigrationData({ ...options(), onProgress: async (message) => {
      if (message.startsWith('검증된 전체 백업: ')) {
        backup = message.slice('검증된 전체 백업: '.length);
        // 백업 직후 외부 DDL이 끼어든 상황을 테스트 DB 한정으로 재현한다.
        await root.query(`DROP TABLE ${table('g5_shop_item')}`);
      }
    } })).rejects.toThrow('초기화 실패');
    expect(backup).not.toBe('');
    expect(await count('g5_member')).toBe(0);
    expect(await readFile(join(backup, 'reset-report.json'), 'utf8')).toContain('"status": "failed"');
    await snapshots.restoreDatabaseSnapshot(backup, targets.target.database, targets.target, join(directory, 'backups'));
    expect(await count('g5_member')).toBe(1);
    expect(await count('sp_bom_quote')).toBe(1);
    expect(await count('sp_develop_request')).toBe(1);
    expect(await count('g5_shop_item')).toBe(8);
  }, 30_000);

  it('부분 삭제나 카운터 갱신이 트리거를 실행할 경우 먼저 중단한다', async () => {
    await root.query(`CREATE TRIGGER \`${targets.target.database}\`.fixture_trigger BEFORE DELETE ON ${table('g5_shop_item')} FOR EACH ROW SET @reset_fixture=1`);
    await expect(resetMigrationData(options())).rejects.toThrow('트리거');
    expect(await count('g5_member')).toBe(1);
    expect(await count('g5_shop_item')).toBe(8);
  });
});
