// 재능마켓 앵커 상품 시드 — 계약 결제 카트행이 참조하는 단일 용역 상품 sp-market-svc 를
// g5_shop_item 에 1회 등록한다(존재하면 건너뜀). 멱등 키 = it_id 존재.
// 실행: pnpm --filter api run market:seed-anchor
// ⚠ 자체 mysql2 풀 + end() — g5-db 전역 풀은 스크립트가 닫을 수 없어 프로세스 잔류
//   (seed-template-items·seed-market-house-expert 관례).
// ⚠ it_price=0(코어 before_check_cart_price 통과) · it_sc_type=1(무료배송 명시 — 기본 0은
//   "쇼핑몰 기본 배송정책 사용"이라 차등 배송비가 계약에 붙는 사고) · ca_id='10'(노출 억제) ·
//   it_notax=0(과세). 노출 여부는 관리자 분류 설정으로도 확인할 것.
import { createPool } from 'mysql2/promise';
import { MARKET_ANCHOR_IT_ID } from '../lib/g5-db';

const url = process.env.G5_DATABASE_URL;
if (url === undefined || url === '') {
  throw new Error('G5_DATABASE_URL 이 필요합니다 (apps/api/.env)');
}
const pool = createPool({ uri: url.split('?')[0] ?? url, connectionLimit: 2 });

const [found] = await pool.query('SELECT it_id FROM g5_shop_item WHERE it_id = ?', [
  MARKET_ANCHOR_IT_ID,
]);
if (Array.isArray(found) && found.length > 0) {
  console.log(`skip (exists): ${MARKET_ANCHOR_IT_ID}`);
} else {
  await pool.query(
    `INSERT INTO g5_shop_item
       (it_id, ca_id, it_name, it_price, it_use, it_soldout, it_stock_qty,
        it_sc_type, it_sc_price, it_sc_minimum, it_sc_qty, it_notax, it_time, it_update_time)
     VALUES (?, '10', '재능마켓 용역', 0, 1, 0, 9999999,
             1, 0, 0, 0, 0, NOW(), NOW())`,
    [MARKET_ANCHOR_IT_ID],
  );
  console.log(`seeded: ${MARKET_ANCHOR_IT_ID} (재능마켓 용역)`);
}

await pool.end();
