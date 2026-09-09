import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apiDirectory, createDatabaseSnapshot, databaseTarget, inspectDatabaseSnapshot, restoreDatabaseSnapshot } from './db-snapshot';

interface ValueRow extends RowDataPacket { id: number; value: string; payload: Buffer }
interface CountRow extends RowDataPacket { n: number }

describe.skipIf(process.env.DB_SNAPSHOT_INTEGRATION !== '1')('격리 DB 스냅샷 실제 복원', () => {
  const name = `samplepcb_snapshot_test_${String(Date.now())}`;
  const target = databaseTarget(`mysql://root@127.0.0.1:3306/${name}`);
  const directory = resolve(apiDirectory, '../../../.tmp/db-snapshot-verification');
  let snapshot = '';
  beforeAll(async () => {
    const root = await createConnection({ host: target.host, port: target.port, user: 'root' });
    try { await root.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`); } finally { await root.end(); }
    const connection = await createConnection(target);
    try {
      await connection.query('CREATE TABLE saved_order (id INT PRIMARY KEY, value TEXT, payload BLOB) ENGINE=InnoDB');
      await connection.execute('INSERT INTO saved_order VALUES (1,?,?)', ["기존 주문 · 줄바꿈\n따옴표 ' \\ 문자", Buffer.from([0, 255, 10, 13])]);
    } finally { await connection.end(); }
    snapshot = await createDatabaseSnapshot({ target, directory, label: 'baseline' });
  });
  afterAll(async () => {
    // 이 테스트 실행에서 생성한 고유 DB만 제거한다.
    const root = await createConnection({ host: target.host, port: target.port, user: 'root' });
    try { await root.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await root.end(); }
  });
  it('새 테이블·신규 행·기존 행 변경을 백업 시점으로 돌리고 직전 상태도 보존한다', async () => {
    const connection = await createConnection(target);
    try { await connection.query("UPDATE saved_order SET value='changed' WHERE id=1"); await connection.query("INSERT INTO saved_order VALUES (2,'new',NULL)"); await connection.query('CREATE TABLE sp_develop_workflow (id INT)'); }
    finally { await connection.end(); }
    const beforeRestore = await restoreDatabaseSnapshot(snapshot, name, target, directory);
    expect((await inspectDatabaseSnapshot(beforeRestore)).tables.some((t) => t.name === 'sp_develop_workflow')).toBe(true);
    const restored = await createConnection(target);
    try {
      const [rows] = await restored.query<ValueRow[]>('SELECT * FROM saved_order ORDER BY id');
      expect(rows).toHaveLength(1); expect(rows[0]?.value).toBe("기존 주문 · 줄바꿈\n따옴표 ' \\ 문자"); expect(rows[0]?.payload).toEqual(Buffer.from([0, 255, 10, 13]));
      const [extra] = await restored.query<CountRow[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sp_develop_workflow'"); expect(extra[0]?.n).toBe(0);
    } finally { await restored.end(); }
  });
  it('손상된 파일은 DB를 변경하기 전에 거부한다', async () => {
    const folder = resolve(directory, `${name}-bad-hash`); await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, 'manifest.json'), await readFile(resolve(snapshot, 'manifest.json'))); await writeFile(resolve(folder, 'database.sql.gz'), 'broken');
    await expect(restoreDatabaseSnapshot(folder, name, target, directory)).rejects.toThrow('SHA-256');
    const connection = await createConnection(target); try { const [rows] = await connection.query<CountRow[]>('SELECT COUNT(*) n FROM saved_order'); expect(rows[0]?.n).toBe(1); } finally { await connection.end(); }
  });
  it('가져오기 실패 시 복원 직전 DB로 자동 복구한다', async () => {
    const folder = resolve(directory, `${name}-bad-sql`); await mkdir(folder, { recursive: true });
    const content = gzipSync('INVALID SQL FOR RESTORE TEST;'); const original = await inspectDatabaseSnapshot(snapshot);
    await writeFile(resolve(folder, 'database.sql.gz'), content); await writeFile(resolve(folder, 'manifest.json'), JSON.stringify({ ...original, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }));
    await expect(restoreDatabaseSnapshot(folder, name, target, directory)).rejects.toThrow('복원 직전 상태로 되돌렸습니다');
    const connection = await createConnection(target); try { const [rows] = await connection.query<CountRow[]>('SELECT COUNT(*) n FROM saved_order'); expect(rows[0]?.n).toBe(1); } finally { await connection.end(); }
  });
});
