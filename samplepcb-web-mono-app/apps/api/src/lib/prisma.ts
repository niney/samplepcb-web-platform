import { PrismaClient } from '@prisma/client';

// 앱 전역 단일 Prisma 클라이언트 (samplepcb_app DB, sp_* 테이블 소유).
export const prisma = new PrismaClient();
