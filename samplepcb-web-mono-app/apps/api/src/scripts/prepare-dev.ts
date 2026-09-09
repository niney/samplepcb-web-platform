import { prepareDatabase } from '../lib/db-prepare';

// pnpm dev에서 API watch 전에 한 번 실행한다. 변경이 없으면 백업·DDL 없이 바로 끝난다.
await prepareDatabase({ localOnly: true });
