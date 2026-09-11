// 개발(G) 프로토타입 DB 잔재 정리(2026-09-10, docs/develop-prototypes.md) — 운영·로컬 공용.
//   G 테이블 3개(sp_develop_workflow_audit → sp_develop_workflow → sp_develop_prototype, FK 순서)·제거된 마이그레이션 2행·
//   C 공존 기간의 설정 행 id=2 를 지운다. 지우기 전에 기존 스냅샷 도구로 DB 전체 백업을 남긴다(db-snapshot.ts 와 같은 폴더).
//   G 모델은 Prisma 스키마에서 빠졌으므로 raw SQL(테이블명 고정)로만 만진다. 상태 조회는 information_schema.
//
// 사용(apps/api 에서):
//   node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts --check        # 상태만 JSON 출력
//   node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts                # dry-run: 할 일을 보여 주고 멈춤
//   node --env-file=.env --import tsx src/scripts/develop-g-rollback.ts --yes [--code-ref <sha>]   # 백업 → 삭제 → 검증
// 종료 코드: 0 = 완료 또는 할 일 없음 · 1 = 오류/검증 실패.
import { createDatabaseSnapshot, databaseTarget } from '../lib/db-snapshot';
import { prisma } from '../lib/prisma';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const checkOnly = args.includes('--check');
const refIndex = args.indexOf('--code-ref');
const codeRef = refIndex >= 0 ? args[refIndex + 1] : undefined;

// FK: audit.requestId → workflow.requestId (Restrict) 라 audit 먼저.
const TABLES = ['sp_develop_workflow_audit', 'sp_develop_workflow', 'sp_develop_prototype'] as const;
const MIGRATIONS = ['20260909120000_develop_workflow', '20260910090000_develop_prototype_scope'] as const;
const DOCS_MIGRATION = '20260909120000_develop_workflow_docs';

const raw = <T>(sql: string, ...params: unknown[]): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql, ...params);
const n = (v: unknown): number => Number(v ?? 0);

interface State {
  target: string;
  tables: string[];
  counts: Record<string, number>;
  migrations: string[];
  docsMigrationApplied: boolean;
  settingsRow2: Record<string, unknown> | null;
  workflowFiles: number;
  work: boolean;
}

async function inspect(): Promise<State> {
  const t = databaseTarget();
  const found = await raw<{ table_name: string }>(
    'SELECT TABLE_NAME table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)',
    ...TABLES,
  );
  const tables = TABLES.filter((name) => found.some((f) => f.table_name === name));
  const counts: Record<string, number> = {};
  for (const name of tables) counts[name] = n((await raw<{ c: unknown }>(`SELECT COUNT(*) c FROM \`${name}\``))[0]?.c);
  const migrations = (
    await raw<{ migration_name: string }>('SELECT migration_name FROM _prisma_migrations WHERE migration_name IN (?, ?)', ...MIGRATIONS)
  ).map((r) => r.migration_name);
  const docs = await raw<{ c: unknown }>('SELECT COUNT(*) c FROM _prisma_migrations WHERE migration_name = ?', DOCS_MIGRATION);
  const settings2 = await prisma.spDevelopSettings.findUnique({ where: { id: 2 } });
  const workflowFiles = await prisma.spFile.count({ where: { refType: 'sp_develop_workflow' } });
  return {
    target: `${t.host}:${String(t.port)}/${t.database}`,
    tables,
    counts,
    migrations,
    docsMigrationApplied: n(docs[0]?.c) > 0,
    settingsRow2: settings2 === null ? null : (JSON.parse(JSON.stringify(settings2)) as Record<string, unknown>),
    workflowFiles,
    work: tables.length > 0 || migrations.length > 0 || settings2 !== null,
  };
}

function print(label: string, state: State): void {
  console.log(`[${label}] ${JSON.stringify(state, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))}`);
}

async function main(): Promise<number> {
  const before = await inspect();
  print('state', before);
  if (checkOnly) return 0;
  if (!before.work) {
    console.log('할 일 없음 — G 테이블·마이그레이션 행·설정 id=2 가 없습니다.');
    if (before.workflowFiles > 0) console.log(`참고: sp_file refType=sp_develop_workflow ${String(before.workflowFiles)}건은 고아 메타(파일서버 파일 포함)라 무해하다. 필요하면 수동 정리.`);
    return 0;
  }
  console.log(
    `지울 것: 테이블 ${before.tables.join(', ') || '(없음)'} · 마이그레이션 행 ${before.migrations.join(', ') || '(없음)'} · 설정 id=2 ${before.settingsRow2 === null ? '없음' : '있음'}`,
  );
  if (!yes) {
    console.log('dry-run — 실행하려면 --yes 를 붙여 주세요(먼저 DB 전체 스냅샷을 만든 뒤 지웁니다).');
    return 0;
  }
  const folder = await createDatabaseSnapshot({ label: 'before-develop-g-rollback', ...(codeRef === undefined ? {} : { codeRef }) });
  console.log(`스냅샷: ${folder}`);
  for (const name of TABLES) {
    if (!before.tables.includes(name)) continue;
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS \`${name}\``);
    console.log(`DROP ${name} (${String(before.counts[name] ?? 0)}행)`);
  }
  if (before.migrations.length > 0) {
    const removed = await prisma.$executeRawUnsafe('DELETE FROM _prisma_migrations WHERE migration_name IN (?, ?)', ...MIGRATIONS);
    console.log(`_prisma_migrations 삭제 ${String(removed)}행`);
  }
  if (before.settingsRow2 !== null) {
    console.log(`설정 id=2(C 공존 기간) 삭제 — 내용은 스냅샷과 이 로그에 남는다: ${JSON.stringify(before.settingsRow2)}`);
    await prisma.spDevelopSettings.deleteMany({ where: { id: 2 } });
  }
  const after = await inspect();
  print('after', after);
  if (after.work) {
    console.error('검증 실패 — 아직 남은 항목이 있습니다.');
    return 1;
  }
  console.log('완료.');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
