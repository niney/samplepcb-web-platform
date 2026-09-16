import { tmpdir } from 'node:os';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Report, SchemaCache } from '../lib/context';
import type { LegacySelectFn, MigrateCtx } from '../lib/context';
import { G5Writer } from '../lib/g5-writer';
import type { ColumnMeta, Row } from '../lib/g5-writer';
import { Ledger } from '../lib/ledger';
import { buildProfileInput, runMembersPhase } from './01-members';

const legacyAdmin = { mb_no: 1, mb_id: 'admin', mb_name: '레거시 관리자', mb_level: 10, mb_password: '*legacy-admin-password', mb_2: '레거시 회사' };
const installedAdmin = { mb_no: 99, mb_id: 'admin', mb_name: '설치 관리자', mb_level: 2, mb_password: 'sha256:install', mb_password2: '', local_only: '보존' };
const point = { po_id: 1, mb_id: 'admin', po_point: 42, po_mb_point: 42 };
const auth = { mb_id: 'admin', au_menu: '200100', au_auth: 'r,w,d' };
const address = { ad_id: 1, mb_id: 'admin', ad_name: '관리자 배송지' };
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function columns(table: string, target: boolean): ColumnMeta[] {
  const names: Record<string, string[]> = {
    g5_member: ['mb_no', 'mb_id', 'mb_name', 'mb_level', 'mb_password', 'mb_2', ...(target ? ['mb_password2', 'local_only'] : [])],
    g5_member_social_profiles: ['mp_no', 'mb_id', 'provider', 'identifier'],
    g5_point: ['po_id', 'mb_id', 'po_point', 'po_mb_point'],
    g5_auth: ['mb_id', 'au_menu', 'au_auth'],
    g5_shop_order_address: ['ad_id', 'mb_id', 'ad_name'],
  };
  const found = names[table];
  if (found === undefined) throw new Error(`Unexpected table: ${table}`);
  return found.map((name) => ({
    name, dataType: 'varchar', isNullable: false, hasDefault: name !== 'local_only',
    isAutoIncrement: ['mb_no', 'mp_no', 'po_id', 'ad_id'].includes(name), maxLen: 255,
  }));
}

async function fixture(options: { dryRun?: boolean; existingAdmin?: boolean } = {}) {
  vi.stubEnv('MIGRATE_PROTECTED_MB_IDS', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // 모든 DB 호출을 spy로 대체한다. 누락된 호출도 실제 DB로 향하지 않도록 별도 주소를 쓴다.
  const g5 = new G5Writer('mysql://fixture@127.0.0.1:1/migration_fixture');
  const prisma = new PrismaClient({ datasourceUrl: 'mysql://fixture@127.0.0.1:1/migration_fixture' });
  cleanup.push(async () => { await Promise.all([g5.end(), prisma.$disconnect()]); });
  const target: Row[] = [
    ...(options.existingAdmin === false ? [] : [installedAdmin]),
    { mb_id: 'kpeter', mb_name: '기존 보호 계정' },
  ];
  const targetRows = (sql: string): Row[] => {
    if (sql === 'SELECT mb_id FROM g5_member') return target.map((row) => ({ mb_id: row.mb_id }));
    if (sql === 'SELECT * FROM g5_member WHERE mb_id = ?') return [installedAdmin];
    if (sql.startsWith('SELECT provider, identifier FROM g5_member_social_profiles')) return [];
    if (sql.startsWith('SELECT mb_id, COUNT(*) c FROM g5_point')) return [];
    if (sql.startsWith('SELECT mb_id, COUNT(*) c FROM g5_shop_order_address')) return [];
    if (sql.startsWith('SELECT 1 FROM `g5_auth`')) return [];
    throw new Error(`Unexpected target query: ${sql}`);
  };
  vi.spyOn(g5, 'select').mockImplementation((sql) => Promise.resolve(targetRows(sql)));
  const update = vi.spyOn(g5, 'updateRow').mockResolvedValue(1);
  const insertMany = vi.spyOn(g5, 'insertMany').mockResolvedValue(1);
  const insertRow = vi.spyOn(g5, 'insertRow').mockResolvedValue(1);
  const profile = buildProfileInput(legacyAdmin);
  if (profile === null) throw new Error('Expected profile fixture');
  const upsert = vi.spyOn(prisma.spMemberProfile, 'upsert').mockResolvedValue({
    mbId: 'admin', ...profile.data, createdAt: new Date(0), updatedAt: new Date(0),
  });
  const legacyRows = (sql: string): Row[] => {
    if (sql === 'SELECT * FROM g5_member ORDER BY mb_no') return [legacyAdmin, { ...legacyAdmin, mb_id: 'kpeter' }];
    if (sql === 'SELECT * FROM g5_member_social_profiles ORDER BY mp_no') return [];
    if (sql === 'SELECT mb_id, COUNT(*) c FROM g5_point GROUP BY mb_id') return [{ mb_id: 'admin', c: 1 }];
    if (sql === 'SELECT * FROM g5_point WHERE mb_id = ? ORDER BY po_id') return [point];
    if (sql === 'SELECT * FROM g5_auth') return [auth];
    if (sql === 'SELECT * FROM g5_shop_order_address ORDER BY ad_id') return [address];
    throw new Error(`Unexpected legacy query: ${sql}`);
  };
  const legacy: LegacySelectFn = (sql) => Promise.resolve(legacyRows(sql));
  const schema = new SchemaCache(g5, legacy);
  vi.spyOn(schema, 'targetColumns').mockImplementation((table) => Promise.resolve(columns(table, true)));
  vi.spyOn(schema, 'legacyColumns').mockImplementation((table) => Promise.resolve(columns(table, false)));
  const ledger = await Ledger.open(tmpdir(), `member-fixture-${String(process.pid)}`);
  const markPhase = vi.spyOn(ledger, 'markPhaseDone').mockResolvedValue();
  const report = new Report();
  const ctx: MigrateCtx = { g5, prisma, legacy, schema, ledger, report, dryRun: options.dryRun ?? false, allowUnknown: false, tmpDir: tmpdir() };
  return { ctx, update, insertMany, insertRow, upsert, markPhase };
}

describe('members phase — admin도 이관', () => {
  it('기존 admin 회원·프로필·포인트·권한·주소록을 이관하며 일반 기존 회원은 보존한다', async () => {
    const f = await fixture();
    await runMembersPhase(f.ctx);
    expect(f.update).toHaveBeenCalledExactlyOnceWith('g5_member', {
      mb_name: '레거시 관리자', mb_level: 10, mb_password: legacyAdmin.mb_password, mb_password2: '',
    }, { mb_id: 'admin' });
    expect(f.upsert).toHaveBeenCalledOnce();
    expect(f.upsert.mock.calls[0]?.[0].where).toEqual({ mbId: 'admin' });
    expect(f.upsert.mock.calls[0]?.[0].update.legacyJson).toBe(Prisma.DbNull);
    expect(f.insertMany).toHaveBeenCalledWith('g5_point', expect.any(Array), [expect.objectContaining({ mb_id: 'admin', po_point: 42 })]);
    expect(f.insertMany).toHaveBeenCalledWith('g5_shop_order_address', expect.any(Array), [expect.objectContaining({ mb_id: 'admin' })]);
    expect(f.insertRow).toHaveBeenCalledWith('g5_auth', auth);
    expect(JSON.stringify(f.ctx.report.toJSON())).not.toContain(legacyAdmin.mb_password);
    expect(f.markPhase).toHaveBeenCalledWith('members');
  });

  it('빈 대상의 admin은 새 회원으로 삽입한다', async () => {
    const f = await fixture({ existingAdmin: false });
    await runMembersPhase(f.ctx);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.insertMany).toHaveBeenCalledWith('g5_member', expect.any(Array), [expect.objectContaining({ mb_id: 'admin', mb_password: legacyAdmin.mb_password })]);
  });

  it('dry-run에서는 admin 갱신과 자산 이관을 계산하되 쓰지 않는다', async () => {
    const f = await fixture({ dryRun: true });
    await runMembersPhase(f.ctx);
    expect(f.ctx.report.toJSON().counters['members.기존 admin 갱신']).toBe(1);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.insertMany).not.toHaveBeenCalled();
    expect(f.insertRow).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.markPhase).not.toHaveBeenCalled();
  });

  it('환경변수로 admin 보호를 명시한 경우 기존 보존 정책을 따른다', async () => {
    const f = await fixture();
    vi.stubEnv('MIGRATE_PROTECTED_MB_IDS', 'admin');
    await runMembersPhase(f.ctx);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.insertMany.mock.calls.some(([table]) => table === 'g5_point')).toBe(false);
  });
});
