import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip, createGzip } from 'node:zlib';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';

export const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const snapshotDirectory = resolve(apiDirectory, '../../../../samplepcb-db-backups');
export const SnapshotManifest = z.object({
  format: z.literal(1), createdAt: z.string(), label: z.string(), database: z.string(),
  host: z.string(), port: z.number(), serverVersion: z.string(), codeRef: z.string().nullable(),
  archive: z.literal('database.sql.gz'), bytes: z.number(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tables: z.array(z.object({ name: z.string(), engine: z.string().nullable(), type: z.string() })),
});
export type SnapshotManifestType = z.infer<typeof SnapshotManifest>;
export interface DatabaseTarget { host: string; port: number; user: string; password: string; database: string }
interface TableRow extends RowDataPacket { TABLE_NAME: string; ENGINE: string | null; TABLE_TYPE: string }
interface VersionRow extends RowDataPacket { version: string }
interface PacketRow extends RowDataPacket { packet: number }

export function databaseTarget(raw = process.env.DATABASE_URL): DatabaseTarget {
  if (!raw) throw new Error('기존 DATABASE_URL 설정을 찾을 수 없습니다');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL 형식이 올바르지 않습니다'); }
  if (url.protocol !== 'mysql:') throw new Error('MySQL/MariaDB URL만 지원합니다');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+$/.test(database) || ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(database)) throw new Error('업무 DB 이름을 확인해 주세요');
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database };
}

function validateTarget(target: DatabaseTarget): void {
  if (!/^[a-zA-Z0-9_]+$/.test(target.database) || ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(target.database)) throw new Error('업무 DB만 백업·복원할 수 있습니다');
  if (!target.host || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw new Error('DB 접속 대상을 확인해 주세요');
}

function binary(kind: 'dump' | 'client'): string {
  const candidates = kind === 'dump' ? ['mariadb-dump', 'mysqldump'] : ['mariadb', 'mysql'];
  if (process.platform === 'win32') candidates.push(`C:/xampp/mysql/bin/${kind === 'dump' ? 'mysqldump' : 'mysql'}.exe`);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { windowsHide: true, encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error(`DB ${kind === 'dump' ? '백업' : '복원'} 클라이언트를 찾을 수 없습니다. MariaDB/MySQL client 설치를 확인해 주세요`);
}
const optionValue = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
async function clientOptions<T>(target: DatabaseTarget, action: (file: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'samplepcb-db-client-'));
  const file = join(folder, 'client.cnf');
  try {
    await writeFile(file, `[client]\nprotocol=tcp\nhost=${optionValue(target.host)}\nport=${String(target.port)}\nuser=${optionValue(target.user)}\npassword=${optionValue(target.password)}\n`, { mode: 0o600, flag: 'wx' });
    return await action(file);
  } finally {
    // mkdtemp로 직접 만든 디렉터리만 정리한다. 비밀번호를 인자·manifest·로그에 남기지 않는다.
    await rm(folder, { recursive: true, force: true });
  }
}
async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function codeRef(): string | null {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: apiDirectory, windowsHide: true, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export async function createDatabaseSnapshot(options: { target?: DatabaseTarget; label?: string; directory?: string; codeRef?: string } = {}): Promise<string> {
  const target = options.target ?? databaseTarget();
  validateTarget(target);
  const connection = await createConnection(target);
  let tables: TableRow[]; let serverVersion: string;
  try {
    [tables] = await connection.query<TableRow[]>('SELECT TABLE_NAME, ENGINE, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [target.database]);
    const [version] = await connection.query<VersionRow[]>('SELECT VERSION() version'); serverVersion = version[0]?.version ?? 'unknown';
  } finally { await connection.end(); }
  const label = (options.label ?? 'manual').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  const folder = resolve(options.directory ?? snapshotDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}-${randomBytes(3).toString('hex')}`);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = join(folder, 'database.sql.gz.partial'); const archive = join(folder, 'database.sql.gz');
  await clientOptions(target, async (file) => {
    const transactional = tables.every((table) => table.TABLE_TYPE !== 'BASE TABLE' || table.ENGINE === 'InnoDB');
    const args = [`--defaults-extra-file=${file}`, '--default-character-set=utf8mb4', '--hex-blob', '--routines', '--events', '--triggers', '--quick', '--net-buffer-length=64K', '--no-autocommit', transactional ? '--single-transaction' : '--lock-tables', '--databases', target.database];
    const child = spawn(binary('dump'), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const completed = new Promise<void>((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code) => { if (code === 0) accept(); else reject(new Error(`DB 백업 실패(exit ${String(code)}). ${join(folder, 'backup-error.log')} 확인`)); });
    });
    const stream = pipeline(child.stdout, createGzip(), createWriteStream(temporary, { mode: 0o600, flags: 'wx' }));
    const errors = pipeline(child.stderr, createWriteStream(join(folder, 'backup-error.log'), { mode: 0o600 }));
    const results = await Promise.allSettled([completed, stream, errors]);
    for (const result of results) if (result.status === 'rejected') throw result.reason instanceof Error ? result.reason : new Error('DB 백업에 실패했습니다');
  });
  await rename(temporary, archive);
  const manifest: SnapshotManifestType = { format: 1, createdAt: new Date().toISOString(), label, database: target.database, host: target.host, port: target.port, serverVersion, codeRef: options.codeRef ?? codeRef(), archive: 'database.sql.gz', bytes: (await stat(archive)).size, sha256: await fileHash(archive), tables: tables.map((table) => ({ name: table.TABLE_NAME, engine: table.ENGINE, type: table.TABLE_TYPE })) };
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return folder;
}

export async function inspectDatabaseSnapshot(folder: string, target?: DatabaseTarget): Promise<SnapshotManifestType> {
  const manifest = SnapshotManifest.parse(JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as unknown);
  if (target && manifest.database !== target.database) throw new Error(`백업 DB(${manifest.database})와 복원 대상(${target.database})이 다릅니다`);
  const archive = join(folder, manifest.archive);
  if ((await stat(archive)).size !== manifest.bytes || await fileHash(archive) !== manifest.sha256) throw new Error('백업 파일 크기 또는 SHA-256이 일치하지 않습니다. DB는 변경하지 않았습니다');
  return manifest;
}

// dump의 INSERT는 한 줄이며, 루틴은 DELIMITER 블록 안에 있다. 나머지 SQL의 전체 크기를
// 더해 보수적으로 필요한 패킷 크기를 계산한다. 큰 BOM JSON/바이너리도 DROP 전에 검사한다.
async function requiredPacketSize(folder: string): Promise<number> {
  let largestInsert = 0; let otherSql = 0; let delimiter = ';';
  const input = createReadStream(join(folder, 'database.sql.gz')).pipe(createGunzip());
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const change = /^DELIMITER\s+(\S+)/i.exec(line);
    if (change?.[1]) delimiter = change[1];
    const bytes = Buffer.byteLength(line) + 2;
    if (delimiter === ';' && /^INSERT INTO /i.test(line)) largestInsert = Math.max(largestInsert, bytes);
    else otherSql += bytes;
  }
  const required = largestInsert + otherSql + 65536;
  if (required > 1073741824) throw new Error('백업 SQL이 MySQL 최대 패킷 크기를 넘습니다. DB는 변경하지 않았습니다');
  return 2 ** Math.ceil(Math.log2(Math.max(required, 1048576)));
}

async function ensureRestorePacket(target: DatabaseTarget, size: number): Promise<void> {
  const connection = await createConnection(target);
  try {
    const [rows] = await connection.query<PacketRow[]>('SELECT @@GLOBAL.max_allowed_packet packet');
    if ((rows[0]?.packet ?? 0) >= size) return;
    try { await connection.query('SET GLOBAL max_allowed_packet=?', [size]); }
    catch { throw new Error(`복원에 필요한 max_allowed_packet은 ${String(size)}바이트입니다. DB는 변경하지 않았습니다. DB 관리자에서 SET GLOBAL max_allowed_packet=${String(size)}; 실행 후 다시 시도해 주세요`); }
  } finally { await connection.end(); }
}

async function importSnapshot(folder: string, target: DatabaseTarget, errorFile: string): Promise<void> {
  const manifest = await inspectDatabaseSnapshot(folder, target);
  // 클라이언트·옵션 준비 실패가 DB 제거 뒤에 발생하지 않도록 미리 확인한다.
  const executable = binary('client');
  await writeFile(errorFile, '', { mode: 0o600 });
  await clientOptions(target, async (file) => {
    const connection = await createConnection({ host: target.host, port: target.port, user: target.user, password: target.password });
    try { await connection.query(`DROP DATABASE IF EXISTS \`${target.database}\``); } finally { await connection.end(); }
    const child = spawn(executable, [`--defaults-extra-file=${file}`, '--binary-mode', '--default-character-set=utf8mb4', '--max-allowed-packet=256M'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    const completed = new Promise<void>((accept, reject) => {
      child.once('error', reject); child.once('close', (code) => { if (code === 0) accept(); else reject(new Error(`DB 복원 실패(exit ${String(code)}). ${errorFile} 확인`)); });
    });
    const streams = [pipeline(createReadStream(join(folder, manifest.archive)), createGunzip(), child.stdin), pipeline(child.stderr, createWriteStream(errorFile, { mode: 0o600 }))];
    const results = await Promise.allSettled([completed, ...streams]);
    for (const result of results) if (result.status === 'rejected') throw result.reason instanceof Error ? result.reason : new Error('DB 복원에 실패했습니다');
  });
}

export async function restoreDatabaseSnapshot(folder: string, confirmation: string, target = databaseTarget(), directory?: string): Promise<string> {
  validateTarget(target);
  if (confirmation !== target.database) throw new Error(`전체 DB 복원에는 --confirm-database ${target.database}를 지정해야 합니다`);
  await inspectDatabaseSnapshot(folder, target);
  const selectedPacket = await requiredPacketSize(folder);
  await ensureRestorePacket(target, selectedPacket);
  const beforeRestore = await createDatabaseSnapshot({ target, label: 'before-restore', ...(directory === undefined ? {} : { directory }) });
  await ensureRestorePacket(target, Math.max(selectedPacket, await requiredPacketSize(beforeRestore)));
  try { await importSnapshot(folder, target, join(beforeRestore, 'restore-requested-error.log')); }
  catch (error) {
    try { await importSnapshot(beforeRestore, target, join(beforeRestore, 'restore-recovery-error.log')); }
    catch { throw new Error(`복원과 복원 전 상태 재적용에 실패했습니다. 보존한 백업: ${beforeRestore}`, { cause: error }); }
    throw new Error(`복원에 실패해 복원 직전 상태로 되돌렸습니다. 백업: ${beforeRestore}`, { cause: error });
  }
  return beforeRestore;
}

export function prismaExecutable(): string {
  const path = join(apiDirectory, 'node_modules/prisma/build/index.js');
  if (!existsSync(path)) throw new Error('Prisma CLI를 찾을 수 없습니다. pnpm install을 먼저 실행해 주세요');
  return path;
}
