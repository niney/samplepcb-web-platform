import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { apiDirectory, createDatabaseSnapshot, databaseTarget, prismaExecutable } from './db-snapshot';

interface MigrationRow extends RowDataPacket { migration_name: string }
interface ExistsRow extends RowDataPacket { count: number }
interface LockRow extends RowDataPacket { acquired: number | null }

// Prisma가 정렬한 공백·주석은 무시하되 문자열 기본값 내부의 공백은 보존한다.
export function prismaSchemaSignature(source: string): string {
  return (source.match(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[^\s]/g) ?? []).filter((token) => !token.startsWith('//') && !token.startsWith('/*')).join('');
}
async function runPrisma(args: string[]): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const child = spawn(process.execPath, [prismaExecutable(), ...args], { cwd: apiDirectory, stdio: 'inherit', windowsHide: true, env: { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' } });
    child.once('error', reject); child.once('close', (code) => { if (code === 0) accept(); else reject(new Error(`prisma ${args.join(' ')} 실패`)); });
  });
}
async function preparePrismaClient(): Promise<void> {
  const source = await readFile(join(apiDirectory, 'prisma/schema.prisma'), 'utf8');
  let generated = '';
  try {
    const require = createRequire(import.meta.url);
    const path = resolve(dirname(require.resolve('@prisma/client/package.json')), '../../.prisma/client/schema.prisma');
    generated = await readFile(path, 'utf8');
  } catch { /* 최초 설치는 generate가 처리한다. */ }
  if (prismaSchemaSignature(source) !== prismaSchemaSignature(generated)) await runPrisma(['generate']);
}

export async function pendingDatabaseMigrations(): Promise<string[]> {
  const connection = await createConnection(databaseTarget());
  try {
    const [exists] = await connection.query<ExistsRow[]>('SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=\'_prisma_migrations\'');
    const applied = exists[0]?.count ? (await connection.query<MigrationRow[]>('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'))[0] : [];
    const names = new Set(applied.map((row) => row.migration_name));
    const folders = await readdir(join(apiDirectory, 'prisma/migrations'), { withFileTypes: true });
    return folders.filter((folder) => folder.isDirectory() && !names.has(folder.name)).map((folder) => folder.name).sort();
  } finally { await connection.end(); }
}

export async function prepareDatabase(options: { localOnly?: boolean; codeRef?: string; alwaysBackup?: boolean } = {}): Promise<void> {
  const target = databaseTarget();
  if (options.localOnly && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.host)) throw new Error('개발 서버의 자동 DB 준비는 로컬 DB만 지원합니다. 운영은 배포 스크립트를 사용해 주세요');
  const lock = await createConnection(target);
  const name = `samplepcb-schema-${target.database}`.slice(0, 64);
  try {
    const [result] = await lock.query<LockRow[]>('SELECT GET_LOCK(?, 30) acquired', [name]);
    if (result[0]?.acquired !== 1) throw new Error('다른 DB 준비 작업이 실행 중입니다. 완료 후 다시 실행해 주세요');
    const pending = await pendingDatabaseMigrations();
    if (pending.length === 0 && !options.alwaysBackup) { await preparePrismaClient(); return; }
    process.stdout.write(pending.length > 0 ? `DB 변경 ${String(pending.length)}건 준비: ${pending.join(', ')}\n` : '배포 전 DB 원복 백업을 만듭니다.\n');
    const snapshot = await createDatabaseSnapshot({ label: pending.length > 0 ? 'before-migration' : 'before-deploy', ...(options.codeRef === undefined ? {} : { codeRef: options.codeRef }) });
    process.stdout.write(`DB 원복 백업: ${snapshot}\n`);
    try { if (pending.length > 0) await runPrisma(['migrate', 'deploy']); }
    catch (error) { throw new Error(`DB 마이그레이션 실패. 백업: ${snapshot}`, { cause: error }); }
    await preparePrismaClient();
  } finally { await lock.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined); await lock.end(); }
}
