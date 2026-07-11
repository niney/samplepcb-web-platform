// 당사(샘플피씨비) 전문가 시드 — 재능마켓 "지정 1번" 행. 멱등(house 존재 검사).
// mbId 는 그누보드 최고관리자(g5_config.cf_admin)를 쓴다 — 별도 계정 정책이 생기면 교체.
// 실행: pnpm --filter api exec tsx --env-file=.env src/scripts/seed-market-house-expert.ts
//       (package.json: pnpm --filter api run market:seed)
import { createPool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import { MARKET_CAD_TOOLS, MARKET_CATEGORIES, MARKET_SERVICE_AREAS } from '@sp/api-contract';

// g5-db.ts 의 전역 풀은 스크립트가 닫을 수 없어(프로세스 잔류) 자체 풀을 쓴다
// — seed-template-items.ts 관례.
const g5Url = process.env.G5_DATABASE_URL;
if (g5Url === undefined || g5Url === '') {
  throw new Error('G5_DATABASE_URL 이 필요합니다 (apps/api/.env)');
}
const g5Pool = createPool({ uri: g5Url.split('?')[0] ?? g5Url, connectionLimit: 2 });

const cfAdminId = async (): Promise<string> => {
  const [rows] = await g5Pool.query<RowDataPacket[]>('SELECT cf_admin FROM g5_config LIMIT 1');
  const row = rows[0];
  return row === undefined ? '' : String(row.cf_admin ?? '');
};

const prisma = new PrismaClient();

const existing = await prisma.spMarketExpert.findFirst({ where: { expertType: 'house' } });
if (existing !== null) {
  // 멱등 키 = house 존재(관리자 mbId 가 바뀌어도 중복 생성 방지).
  console.log(`skip (exists): house expert #${String(existing.id)} (${existing.displayName})`);
} else {
  const mbId = await cfAdminId();
  if (mbId === '') throw new Error('g5_config.cf_admin 이 비어 있습니다 — 시드 중단');

  const dup = await prisma.spMarketExpert.findUnique({ where: { mbId } });
  if (dup !== null) {
    console.log(`skip: cf_admin(${mbId}) 계정에 이미 전문가 행 존재(#${String(dup.id)}) — house 시드 불가`);
  } else {
    const now = new Date();
    const created = await prisma.spMarketExpert.create({
      data: {
        mbId,
        expertType: 'house',
        displayName: '샘플피씨비',
        phone: '070-8667-1080', // 고객센터(프로토타입 표기)
        identityVerified: true,
        careerRange: 'over15',
        contactHours: '09:00 ~ 18:00',
        region: 'gyeonggi', // 광명
        travelRange: 'nationwide',
        intro:
          'PCB 온라인 플랫폼 샘플피씨비 당사진행 서비스입니다. 회로개발·PCB설계부터 제작·SMT 양산까지 원스톱으로 진행합니다.',
        serviceAreas: [...MARKET_SERVICE_AREAS],
        categories: [...MARKET_CATEGORIES],
        cadTools: [...MARKET_CAD_TOOLS],
        termsAgreedAt: now,
        status: 'approved',
        decidedBy: mbId,
        decidedAt: now,
      },
    });
    console.log(`seeded: house expert #${String(created.id)} (mbId=${mbId})`);
  }
}

await prisma.$disconnect();
await g5Pool.end();
