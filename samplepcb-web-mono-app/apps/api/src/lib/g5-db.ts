// 로컬/운영 그누보드(영카트) DB — 담기 API 의 g5_shop_cart 접근 전용.
//
// "그누보드 스키마 직접 결합 금지" 원칙의 **한정 예외**(HANDOFF 결정 로그 #6):
// 허용 범위는 ① g5_shop_cart INSERT ② 템플릿 상품/카트 파생 SELECT 뿐이다.
// 그 외 g5_* 접근은 금지 — 범위를 넓히려면 HANDOFF 결정을 먼저 갱신할 것.
//
// LEGACY_DATABASE_URL(운영 읽기 전용, 검증 스크립트용)과 반드시 구분한다.
// 이 모듈은 서비스가 실제로 쓰는 DB(G5_DATABASE_URL — 로컬 개발은 로컬 XAMPP)를 본다.

import { createPool } from 'mysql2/promise';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

let pool: Pool | null = null;

function getG5Pool(): Pool {
  if (!pool) {
    const url = process.env.G5_DATABASE_URL;
    if (!url) {
      throw new Error(
        'G5_DATABASE_URL 이 설정되지 않았습니다. apps/api/.env 에 ' +
          'mysql://user:pass@localhost:3306/<그누보드DB> 형식으로 추가하세요.',
      );
    }
    pool = createPool({ uri: url.split('?')[0] ?? url, connectionLimit: 4 });
  }
  return pool;
}

// ── 템플릿 상품 ─────────────────────────────────────────────────────────────
// category(제품군) → 고정 템플릿 상품 it_id. 상품은 카테고리 앵커일 뿐,
// 가격/사양은 읽지 않는다(스냅샷 모델). 시드: scripts/seed-template-items.ts
export const TEMPLATE_ITEMS: Record<string, string> = {
  standard: 'sp-pcb-std',
  metalmask: 'sp-mask',
  advance: 'sp-pcb-adv',
  flexible: 'sp-pcb-flex',
};

export interface TemplateItem {
  itId: string;
  itName: string;
  scType: number;
  scMethod: number;
  scPrice: number;
  scMinimum: number;
  scQty: number;
  notax: number;
}

export async function getTemplateItem(category: string): Promise<TemplateItem | null> {
  const itId = TEMPLATE_ITEMS[category.toLowerCase()];
  if (itId === undefined) return null;
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT it_id, it_name, it_sc_type, it_sc_method, it_sc_price, it_sc_minimum, it_sc_qty, it_notax
       FROM g5_shop_item WHERE it_id = ?`,
    [itId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    itId: String(row.it_id),
    itName: String(row.it_name),
    scType: Number(row.it_sc_type),
    scMethod: Number(row.it_sc_method),
    scPrice: Number(row.it_sc_price),
    scMinimum: Number(row.it_sc_minimum),
    scQty: Number(row.it_sc_qty),
    notax: Number(row.it_notax),
  };
}

// ── 장바구니 INSERT ─────────────────────────────────────────────────────────
// cartupdate.php:291 의 스냅샷 INSERT 를 재현하되, 가격(ct_price)은 상품이 아닌
// 서버 계산 견적가를 주입한다. od_id = 인증 브리지 JWT 의 cartId(= PHP 세션 ss_cart_id).
export interface CartInsert {
  odId: string; // JWT cartId (숫자 문자열)
  mbId: string;
  item: TemplateItem;
  itemName: string; // 스냅샷 표시명 (예: "Standard PCB · mood.zip")
  price: number; // 서버 계산 견적가
  qty: number;
  option: string; // 사양 요약 (cart 화면 표시용)
  ip: string;
}

export async function insertCartRow(c: CartInsert): Promise<number> {
  const [result] = await getG5Pool().query<ResultSetHeader>(
    `INSERT INTO g5_shop_cart
       (od_id, mb_id, it_id, it_name, it_sc_type, it_sc_method, it_sc_price, it_sc_minimum, it_sc_qty,
        ct_status, ct_price, ct_point, ct_point_use, ct_stock_use, ct_option, ct_qty, ct_notax,
        io_id, io_type, io_price, ct_time, ct_ip, ct_send_cost, ct_direct, ct_select, ct_select_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
             '쇼핑', ?, 0, 0, 0, ?, ?, ?,
             '', 0, 0, NOW(), ?, 0, 0, 0, '0000-00-00 00:00:00')`,
    [
      c.odId,
      c.mbId,
      c.item.itId,
      c.itemName,
      c.item.scType,
      c.item.scMethod,
      c.item.scPrice,
      c.item.scMinimum,
      c.item.scQty,
      c.price,
      c.option,
      c.qty,
      c.item.notax,
      c.ip,
    ],
  );
  return result.insertId; // = ct_id
}

export async function closeG5Pool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
