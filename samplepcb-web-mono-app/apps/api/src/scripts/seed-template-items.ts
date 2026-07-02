// 템플릿 상품 시드 — 담기 API 의 cart INSERT 가 참조하는 카테고리 앵커 상품 4종을
// g5_shop_item 에 1회 등록한다(존재하면 건너뜀). 가격/사양 의미 없음(스냅샷 모델).
// 실행: pnpm --filter api exec tsx --env-file=.env src/scripts/seed-template-items.ts
// ⚠ 쇼핑몰 목록/검색 노출 여부는 분류(ca_id=10) 노출 설정으로 관리자에서 확인할 것.
import { createPool } from 'mysql2/promise';
import { TEMPLATE_ITEMS } from '../lib/g5-db';

const NAMES: Record<string, string> = {
  standard: 'Standard PCB',
  metalmask: 'Metal Mask',
  advance: 'Advance PCB',
  flexible: 'Flexible PCB',
};

const url = process.env.G5_DATABASE_URL;
if (!url) throw new Error('G5_DATABASE_URL 이 필요합니다 (apps/api/.env)');
const pool = createPool({ uri: url.split('?')[0] ?? url, connectionLimit: 2 });

const rows = Object.entries(TEMPLATE_ITEMS).map(([category, itId]) => [
  itId,
  '10', // ca_id — 레거시 거버 주문 분류 유지
  NAMES[category] ?? itId,
]);

// it_id 는 PK 가 아니지만 유니크 취급 — 존재 검사 후 삽입.
for (const [itId, caId, itName] of rows) {
  const [found] = await pool.query('SELECT it_id FROM g5_shop_item WHERE it_id = ?', [itId]);
  if (Array.isArray(found) && found.length > 0) {
    console.log(`skip (exists): ${String(itId)}`);
    continue;
  }
  // it_stock_qty: 재고 차감 검증에 걸리지 않게 사실상 무제한
  await pool.query(
    `INSERT INTO g5_shop_item (it_id, ca_id, it_name, it_price, it_use, it_soldout, it_stock_qty, it_time, it_update_time)
     VALUES (?, ?, ?, 0, 1, 0, 9999999, NOW(), NOW())`,
    [itId, caId, itName],
  );
  console.log(`seeded: ${String(itId)} (${String(itName)})`);
}

await pool.end();
