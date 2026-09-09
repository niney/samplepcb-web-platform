import { createDatabaseSnapshot, databaseTarget, inspectDatabaseSnapshot, restoreDatabaseSnapshot } from '../lib/db-snapshot';
import { prepareDatabase } from '../lib/db-prepare';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const reference = option('--code-ref');
switch (args[0]) {
  case 'backup': console.log(await createDatabaseSnapshot({ label: option('--label') ?? 'manual', ...(reference === undefined ? {} : { codeRef: reference }) })); break;
  case 'prepare': await prepareDatabase({ alwaysBackup: args.includes('--always-backup'), ...(reference === undefined ? {} : { codeRef: reference }) }); break;
  case 'inspect': {
    const folder = args[1]; if (!folder) throw new Error('백업 폴더를 지정해 주세요');
    console.log(JSON.stringify(await inspectDatabaseSnapshot(folder), null, 2)); break;
  }
  case 'restore': {
    const folder = args[1]; if (!folder) throw new Error('복원할 백업 폴더를 지정해 주세요');
    const target = databaseTarget();
    console.log(`DB 전체 복원 대상: ${target.host}:${String(target.port)}/${target.database}`);
    const previous = await restoreDatabaseSnapshot(folder, option('--confirm-database') ?? '', target);
    console.log(`DB 복원 완료. 복원 직전 상태 백업: ${previous}`); break;
  }
  default: throw new Error('사용: db:snapshot backup | inspect <폴더> | restore <폴더> --confirm-database <DB명> | prepare');
}
