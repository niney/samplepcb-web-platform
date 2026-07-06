// 레거시 → 신규 DB 마이그레이션 오케스트레이터.
//
// 실행(apps/api): pnpm migrate:run [-- --phase=members,shop --dry-run --allow-unknown]
//   env 파일: .env.migration (소스 LEGACY_DATABASE_URL · 타깃 G5_DATABASE_URL/DATABASE_URL)
//   --phase   gate | members | shop | boards | misc | all(기본) — 콤마 나열 가능
//   --dry-run 쓰기 없이 게이트+변환 통계만
//   --allow-unknown 게이트 위반을 경고로 강등(운영 드리프트를 **검토한 뒤** 의식적으로만)
//
// 게이트(manifest.ts)는 항상 먼저 돈다 — 처분 미정 테이블/컬럼/상태 발견 시 중단이 기본값.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { closeLegacyPool, legacySelect } from '../../lib/legacy-db';
import { Report, SchemaCache } from './lib/context';
import type { MigrateCtx } from './lib/context';
import { G5Writer } from './lib/g5-writer';
import { Ledger } from './lib/ledger';
import { prepareTargetSchema } from './lib/schema-prep';
import { asStr, resolveMigrateTmpDir } from './lib/util';
import { runGate } from './manifest';
import { runMembersPhase } from './phases/01-members';
import { runShopPhase } from './phases/02-shop';
import { runBoardsPhase } from './phases/03-boards';
import { runMiscPhase } from './phases/04-misc';

const PHASE_ORDER = ['members', 'shop', 'boards', 'misc'] as const;
type PhaseName = (typeof PHASE_ORDER)[number];

function dbNameOf(url: string | undefined): string {
  if (url === undefined || url === '') return '(미설정)';
  try {
    return new URL(url.split('?')[0] ?? url).pathname.replace(/^\//, '');
  } catch {
    return '(파싱 불가)';
  }
}

async function main(): Promise<void> {
  // pnpm run 이 '--' 구분 토큰까지 전달하므로 걸러낸다(파싱 시 위치 인자 오인 방지)
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const { values } = parseArgs({
    args,
    options: {
      phase: { type: 'string', default: 'all' },
      'dry-run': { type: 'boolean', default: false },
      'allow-unknown': { type: 'boolean', default: false },
    },
  });
  const dryRun = values['dry-run'];
  const allowUnknown = values['allow-unknown'];
  const phaseArg = values.phase.trim();

  const g5 = new G5Writer();
  const prisma = new PrismaClient();
  const tmpDir = await resolveMigrateTmpDir();
  const ledger = await Ledger.open(tmpDir, g5.dbName);
  const report = new Report();
  const schema = new SchemaCache(g5, legacySelect);
  const ctx: MigrateCtx = {
    g5,
    prisma,
    legacy: legacySelect,
    ledger,
    report,
    schema,
    dryRun,
    allowUnknown,
    tmpDir,
  };

  try {
    // ── 연결·안전 가드 ──
    const legacyDbRow = (await legacySelect(`SELECT DATABASE() db`))[0];
    const legacyDb = asStr(legacyDbRow?.db);
    const prismaDb = dbNameOf(process.env.DATABASE_URL);
    console.log('══ 레거시 → 신규 마이그레이션 ══');
    console.log(`  소스(LEGACY_DATABASE_URL): ${legacyDb}`);
    console.log(`  타깃 g5(G5_DATABASE_URL): ${g5.dbName}`);
    console.log(`  타깃 sp(DATABASE_URL/Prisma): ${prismaDb}`);
    console.log(`  모드: ${dryRun ? 'DRY-RUN(쓰기 없음)' : '실행'} · 원장: ${ledger.path}`);
    if (legacyDb === g5.dbName) {
      throw new Error(
        `소스와 타깃이 같은 DB(${legacyDb})입니다 — .env.migration 의 LEGACY_DATABASE_URL 을 레거시 덤프 DB 로 바꾸세요.`,
      );
    }
    if (prismaDb !== g5.dbName) {
      throw new Error(
        `DATABASE_URL(${prismaDb})과 G5_DATABASE_URL(${g5.dbName})이 다른 DB 를 봅니다 — 공유 DB 전제 위반.`,
      );
    }

    // ── 게이트(항상) ──
    const gate = await runGate(ctx);
    for (const line of gate.info) console.log(`  [게이트] ${line}`);
    for (const line of gate.warnings) console.log(`  [게이트 경고] ${line}`);
    if (gate.violations.length > 0) {
      console.log(`\n■ 게이트 위반 ${String(gate.violations.length)}건 — 처분 미정 항목:`);
      for (const v of gate.violations) console.log(`  ✗ ${v}`);
      if (!allowUnknown) {
        throw new Error(
          '게이트 위반으로 중단합니다. 항목별 처분을 정해 manifest/계획을 갱신하거나(권장), 검토를 마쳤다면 --allow-unknown 으로 강등 실행하세요.',
        );
      }
      console.log('  (--allow-unknown: 경고로 강등하고 계속합니다)');
    }
    if (phaseArg === 'gate') return;

    // ── 타깃 스키마 준비(무손실 DDL — mb_id 확폭·mb_password2) ──
    await prepareTargetSchema(ctx);

    // ── phase 실행 ──
    const requested = new Set(
      phaseArg === 'all' || phaseArg === '' ? PHASE_ORDER : phaseArg.split(',').map((s) => s.trim()),
    );
    const unknownPhases = [...requested].filter(
      (p) => !(PHASE_ORDER as readonly string[]).includes(p),
    );
    if (unknownPhases.length > 0) {
      throw new Error(`알 수 없는 phase: ${unknownPhases.join(', ')} (사용 가능: ${PHASE_ORDER.join('/')})`);
    }
    const runners: Record<PhaseName, (c: MigrateCtx) => Promise<void>> = {
      members: runMembersPhase,
      shop: runShopPhase,
      boards: runBoardsPhase,
      misc: runMiscPhase,
    };
    for (const phase of PHASE_ORDER) {
      if (!requested.has(phase)) continue;
      const started = Date.now();
      await runners[phase](ctx);
      console.log(`  ✓ phase ${phase} 완료 (${String(Math.round((Date.now() - started) / 100) / 10)}s)`);
    }
  } finally {
    report.print();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(tmpDir, `report-${g5.dbName}-${stamp}.json`);
    await writeFile(reportPath, JSON.stringify(report.toJSON(), null, 2), 'utf8');
    console.log(`\n리포트 저장: ${reportPath}`);
    await ledger.save();
    await Promise.allSettled([g5.end(), prisma.$disconnect(), closeLegacyPool()]);
  }
}

await main();
