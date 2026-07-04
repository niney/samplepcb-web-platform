// 로컬/운영 그누보드(영카트) DB — 담기 API 의 g5_shop_cart 접근 전용.
//
// "그누보드 스키마 직접 결합 금지" 원칙의 **한정 예외**(HANDOFF 결정 로그 #6):
// 허용 범위는 ① g5_shop_cart INSERT ② g5_shop_item_option INSERT(견적 옵션 행)
// ③ 템플릿 상품/카트 파생 SELECT ④ g5_shop_cart ct_select/ct_select_time
// UPDATE(주문 선택 플래그 — 바로 주문) ⑤ g5_member read-only SELECT(관리자
// 견적 관리의 신청자 표시용 — 최소 컬럼, 쓰기 절대 금지) ⑥ g5_shop_cart 견적 행
// UPDATE(io_id/io_price/ct_option — 담긴 견적 수량 변경 시 재견적 동기화)·DELETE
// (장바구니에서 견적 행 제거 — ct_id 단위. 코어 cartupdate 는 it_id 단위라 같은
// 템플릿 견적이 뭉텅이로 처리되므로 ct_id 정밀 조작이 필요) 뿐이다.
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

// ── 견적 옵션 행 INSERT ──────────────────────────────────────────────────────
// 가격은 ct_price 가 아닌 **io_price(옵션가)** 에 싣는다:
//   영카트 코어 before_check_cart_price(cart.php:22 등)가 매 조회마다
//   ct_price ≠ it_price 면 상품가로 덮어쓴다(레거시는 주문마다 상품을 만들며
//   it_price=견적가로 통과시켰음). io_price 는 g5_shop_item_option 의 같은
//   io_id 행과 비교·재검증되므로, 견적마다 io_id=quoteId 옵션 행을 실등록해
//   두 값을 일치시킨다 → 코어 재검증을 회피가 아니라 정당하게 통과.
//   (미등록 io_id 로 회피하는 방식은 sql_fetch null 로 PHP 8 경고를 유발해 폐기.)
//   행 합계 = (ct_price 0 + io_price 견적가) × ct_qty — 영카트 표준 계산식 그대로.
//   템플릿 상품은 노출 차단(ca_id=10)이라 옵션이 상품 페이지에 보일 일 없음.
//   행은 견적마다 쌓임 — 만료 견적 정리 배치에서 함께 삭제한다.
export async function insertQuoteOption(itId: string, quoteId: string, price: number): Promise<void> {
  await getG5Pool().query(
    `INSERT INTO g5_shop_item_option
       (io_id, io_type, it_id, io_price, io_stock_qty, io_noti_qty, io_use)
     VALUES (?, 0, ?, ?, 9999999, 0, 1)`,
    [quoteId, itId, price],
  );
}

export async function deleteQuoteOption(itId: string, quoteId: string): Promise<void> {
  await getG5Pool().query(`DELETE FROM g5_shop_item_option WHERE it_id = ? AND io_id = ?`, [
    itId,
    quoteId,
  ]);
}

// ── 장바구니 INSERT ─────────────────────────────────────────────────────────
// cartupdate.php:291 의 스냅샷 INSERT 를 재현. od_id = JWT cartId(= PHP 세션 ss_cart_id).
// io_id/io_price 는 위 insertQuoteOption 으로 먼저 등록한 견적 옵션 행과 짝을 이룬다.
//
// ⚠ ct_qty 는 항상 1 — 견적가(io_price)가 이미 "해당 수량 전체의 총액"이라서
//   ct_qty=수량 으로 넣으면 코어 합계식 (가격×ct_qty)이 총액을 수량배 뻥튀기한다.
//   레거시도 동일하게 ct_qty=1 고정(gerber_cart.js:202), PCB 수량은 사양 정보
//   (ct_option 요약 · sp_order_spec.qty)로만 다룬다.
export interface CartInsert {
  odId: string; // JWT cartId (숫자 문자열)
  mbId: string;
  item: TemplateItem;
  itemName: string; // 스냅샷 표시명 (예: "Standard PCB · mood.zip")
  ioId: string; // 견적 옵션 io_id (= quoteId)
  price: number; // 서버 계산 견적 총액 (= 옵션 행 io_price 와 동일해야 함)
  option: string; // 사양 요약 (cart 화면 표시용, 수량 포함)
  ip: string;
}

export async function insertCartRow(c: CartInsert): Promise<number> {
  const [result] = await getG5Pool().query<ResultSetHeader>(
    `INSERT INTO g5_shop_cart
       (od_id, mb_id, it_id, it_name, it_sc_type, it_sc_method, it_sc_price, it_sc_minimum, it_sc_qty,
        ct_status, ct_price, ct_point, ct_point_use, ct_stock_use, ct_option, ct_qty, ct_notax,
        io_id, io_type, io_price, ct_time, ct_ip, ct_send_cost, ct_direct, ct_select, ct_select_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
             '쇼핑', 0, 0, 0, 0, ?, ?, ?,
             ?, 0, ?, NOW(), ?, 0, 0, 0, '0000-00-00 00:00:00')`,
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
      c.option,
      1, // ct_qty — 항상 1 (위 주석 참조)
      c.item.notax,
      c.ioId,
      c.price, // → io_price (위 주석 참조)
      c.ip,
    ],
  );
  return result.insertId; // = ct_id
}

// ── 장바구니 견적 행 재견적 동기화 / 제거 (한정 예외 ⑥) ─────────────────────
// 담긴 견적의 수량을 바꾸면 서버가 새 quoteId 로 재견적한다 → cart 행이 새 견적
// (새 io_id·io_price)과 사양요약(ct_option)을 가리키도록 갱신한다. 코어
// before_check_cart_price 는 cart.io_price 를 같은 io_id 의 옵션 행과 대조하므로,
// 호출부는 반드시 "새 옵션 행 등록 → 이 UPDATE → 옛 옵션 행 삭제" 순서를 지켜
// cart 행이 항상 실재하는 옵션 행을 참조하게 한다(g5-db.ts insertQuoteOption 참조).
export async function updateCartQuoteRow(
  ctId: number,
  ioId: string,
  price: number,
  option: string,
): Promise<void> {
  await getG5Pool().query(
    `UPDATE g5_shop_cart SET io_id = ?, io_price = ?, ct_option = ? WHERE ct_id = ?`,
    [ioId, price, option, ctId],
  );
}

// 장바구니에서 견적 행 한 건 제거 — ct_id 단위(코어 seldelete 는 it_id 단위라
// 같은 템플릿의 다른 견적까지 함께 지운다). 옵션 행 삭제는 deleteQuoteOption 로 별도.
export async function deleteCartRow(ctId: number): Promise<void> {
  await getG5Pool().query(`DELETE FROM g5_shop_cart WHERE ct_id = ?`, [ctId]);
}

// ── 카트 파생 상태 SELECT ───────────────────────────────────────────────────
// HANDOFF 3장: cart 관계는 저장하지 않고 ct_id 조인으로 파생.
//   '쇼핑' = 담김(cart) · 그 외 상태 행 존재 = 주문됨(ordered) · 행 없음 = 견적 보관(none)
//   ※ 운영 커스텀 ct_status(생산완료 등) 매핑은 나중 결정(기록됨) — 현재는 ≠'쇼핑' → ordered.
export type CartState = 'none' | 'cart' | 'ordered';

export async function getCartStates(ctIds: number[]): Promise<Map<number, CartState>> {
  const states = new Map<number, CartState>();
  if (ctIds.length === 0) return states;
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT ct_id, ct_status FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
    ctIds,
  );
  for (const row of rows) {
    states.set(Number(row.ct_id), String(row.ct_status) === '쇼핑' ? 'cart' : 'ordered');
  }
  return states;
}

// ── 회원 표시 정보 SELECT (한정 예외 ⑤) ─────────────────────────────────────
// 관리자 견적 관리에서 신청자(이름·연락처·이메일)를 보여주기 위한 read-only 조회.
// sp_order_spec.mbId(JWT 클레임 유래)와 표시 시점에만 조인하며, 이 최소 컬럼
// SELECT 이상으로 스키마 결합을 넓히지 않는다.
export interface G5Member {
  mbId: string;
  name: string;
  nick: string;
  email: string;
  hp: string;
  tel: string;
}

export async function getMembersByIds(mbIds: string[]): Promise<Map<string, G5Member>> {
  const map = new Map<string, G5Member>();
  const ids = [...new Set(mbIds)].filter((id) => id !== '');
  if (ids.length === 0) return map;
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT mb_id, mb_name, mb_nick, mb_email, mb_hp, mb_tel
       FROM g5_member WHERE mb_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  for (const row of rows) {
    const mbId = String(row.mb_id);
    map.set(mbId, {
      mbId,
      name: String(row.mb_name),
      nick: String(row.mb_nick),
      email: String(row.mb_email),
      hp: String(row.mb_hp),
      tel: String(row.mb_tel),
    });
  }
  return map;
}

// ── 주문 선택 플래그 UPDATE ─────────────────────────────────────────────────
// 코어 "주문하기"(cartupdate.php act=buy)를 행 단위로 재현: 버킷 선택 초기화(:45) 후
// 이번 주문 행만 ct_select=1. orderform.sub.php 는 ct_select='1' 행만 주문서에 올린다.
// 코어 경로는 it_id 단위 선택이라 공유 템플릿 상품에서는 견적 행이 뭉텅이로 선택됨 →
// ct_id 단위 정밀 선택이 필요해 sp-node 가 직접 수행(한정 예외 ④).
export async function selectCartRows(odId: string, ctIds: number[]): Promise<void> {
  if (ctIds.length === 0) return;
  const pool = getG5Pool();
  await pool.query(
    `UPDATE g5_shop_cart SET ct_select = '0', ct_select_time = '0000-00-00 00:00:00' WHERE od_id = ?`,
    [odId],
  );
  await pool.query(
    `UPDATE g5_shop_cart SET ct_select = '1', ct_select_time = NOW()
      WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
    ctIds,
  );
}

export async function closeG5Pool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
