import { PrismaClient } from '@prisma/client';

// 앱 전역 단일 Prisma 클라이언트 (samplepcb 공유 DB, sp_* 테이블만 소유).
export const prisma = new PrismaClient();
