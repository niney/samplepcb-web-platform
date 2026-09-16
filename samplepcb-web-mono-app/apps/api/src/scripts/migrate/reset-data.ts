// 운영 재이관용 전체 업무 데이터 초기화. 기본은 미리보기이며 설정·스키마는 보존한다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { apiDirectory, databaseTarget } from '../../lib/db-snapshot';
import { resetMigrationData } from './lib/reset-data';

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((value) => value !== '--'),
    options: { yes: { type: 'boolean', default: false }, 'confirm-database': { type: 'string' }, help: { type: 'boolean', default: false } },
  });
  if (values.help) {
    console.log('미리보기: pnpm migrate:reset-data\n실행: pnpm migrate:reset-data -- --yes --confirm-database samplepcb\n설정·고정 상품·스키마 보존 / 전체 백업 성공 후 업무·회원 데이터 초기화');
    return;
  }
  const runtime = parseEnv(await readFile(join(apiDirectory, '.env'), 'utf8'));
  const targetOf = (env: Record<string, string | undefined>, key: string) => {
    const raw = env[key];
    if (!raw) throw new Error(`${key} 설정이 필요합니다 (.env 및 .env.migration 확인)`);
    return databaseTarget(raw);
  };
  const targets = {
    target: targetOf(process.env, 'DATABASE_URL'), g5: targetOf(process.env, 'G5_DATABASE_URL'),
    legacy: targetOf(process.env, 'LEGACY_DATABASE_URL'), runtime: targetOf(runtime, 'DATABASE_URL'), runtimeG5: targetOf(runtime, 'G5_DATABASE_URL'),
  };
  console.log(`초기화 대상: ${targets.target.host}:${String(targets.target.port)}/${targets.target.database}`);
  console.log('운영 PHP/API/배치 쓰기를 중지한 뒤 실행하세요. 레거시 DB·공유 ES·실파일은 변경하지 않습니다.');
  const result = await resetMigrationData({
    targets, execute: values.yes,
    ...(values['confirm-database'] === undefined ? {} : { confirmDatabase: values['confirm-database'] }),
    onPlan: (plan) => {
      for (const item of plan) {
        console.log(`[${item.action === 'preserve' ? '보존' : item.action === 'anchors' ? '일부 보존' : '초기화'}] ${item.table}: 전체 ${String(item.rows)} / 삭제 ${String(item.deleteRows)} — ${item.reason}`);
      }
    },
    onProgress: (message) => { console.log(message); },
  });
  if (!result.executed) {
    console.log('\n미리보기 완료 — DB 변경 없음. 실제 실행에는 --yes --confirm-database <대상DB>가 필요합니다.');
    return;
  }
  console.log(`\n업무 데이터 초기화·빈 데이터 검증 완료. 백업: ${result.backup ?? ''}`);
  console.log('이전 이관 원장이 있으면 백업 폴더에 보관했습니다. 필수 상품 확인 후 migrate:gate → migrate:dry → migrate:run → migrate:verify 순서로 실행하세요.');
}

await main();
