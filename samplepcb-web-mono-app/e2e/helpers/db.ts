// apps/api 에 생성돼 있는 Prisma Client 를 그대로 빌려 쓴다(스키마·버전 단일화,
// 스모크 관례). 모델 타입까지 끌어오려면 api 워크스페이스 의존이 필요해 과해지므로
// any 로 둔다 — e2e 는 런타임 검증이 본질, 모델 명세는 apps/api/prisma/schema.prisma.
// ⚠ 공유 DB: sp_* 는 그누보드 g5_* 와 같은 DB — 시드는 직삽입+정리, 무잔재 검증까지.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { apiDir, requireDatabaseUrl } from './env';

let instance: any = null;

export function getPrisma(): any {
  if (instance === null) {
    if (process.env.DATABASE_URL === undefined) {
      process.env.DATABASE_URL = requireDatabaseUrl();
    }
    const requireFromApi = createRequire(join(apiDir, 'package.json'));
    const { PrismaClient } = requireFromApi('@prisma/client');
    instance = new PrismaClient();
  }
  return instance;
}

/** afterAll 에서 호출 — 커넥션을 안 닫으면 vitest 프로세스가 안 끝난다. */
export async function disconnectPrisma(): Promise<void> {
  if (instance !== null) {
    await instance.$disconnect();
    instance = null;
  }
}

/** Prisma BigInt id → number (JSON 직렬화·API 파라미터·비교용 — BigInt 는 stringify 불가) */
export const num = (v: bigint | number): number => Number(v);
