// 로컬/운영 그누보드(영카트) DB — 담기 API 의 g5_shop_cart 접근 전용.
//
// "그누보드 스키마 직접 결합 금지" 원칙의 **한정 예외**(HANDOFF 결정 로그 #6):
// 허용 범위는 ① g5_shop_cart INSERT ② g5_shop_item_option INSERT(견적 옵션 행)
// ③ 템플릿 상품/카트 파생 SELECT ④ g5_shop_cart ct_select/ct_select_time
// UPDATE(주문 선택 플래그 — 바로 주문) ⑤ g5_member read-only SELECT(관리자
// 견적 관리의 신청자 표시용 — 최소 컬럼, 쓰기 절대 금지) ⑥ g5_shop_cart 견적 행
// UPDATE(io_id/io_price/ct_option — 담긴 견적 수량 변경 시 재견적 동기화)·DELETE
// (장바구니에서 견적 행 제거 — ct_id 단위. 코어 cartupdate 는 it_id 단위라 같은
// 템플릿 견적이 뭉텅이로 처리되므로 ct_id 정밀 조작이 필요) ⑦ g5_shop_default
// read-only SELECT(관리자 견적서의 발신처 정보 — 회사명·대표·주소·연락처·담당자·
// 결제계좌 컬럼만, 쓰기 절대 금지) ⑧ g5_member·g5_config read-only SELECT(관리자
// 회원 관리의 목록/검색/카운트/상세 — 컬럼 화이트리스트만; mb_password·mb_dupinfo·
// mb_lost_certify·mb_certify·mb_email_certify2 등 인증·비밀번호 컬럼은 SELECT 목록에서도
// 절대 제외, g5_config 는 cf_admin 1컬럼만) ⑨ g5_member UPDATE — mb_intercept_date·
// mb_level 2컬럼 한정(차단/해제·레벨 변경. 그 외 컬럼 쓰기 절대 금지. 가드 3종 필수:
// 탈퇴 회원 409 / 자기 자신 409 / cf_admin 계정 409 — 라우트가 강제) 뿐이다.
// 운영 전용 커스텀 컬럼(mb_partner_auth, mb_11~mb_20)은 로컬 신설 DB 에 없어 참조 금지.
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

// ── 발신처(쇼핑몰) 견적 프로필 SELECT (한정 예외 ⑦) ─────────────────────────
// 관리자 견적서(A4)의 발신(공급자) 정보. 하드코딩 대신 영카트 기본환경설정
// (g5_shop_default)을 재사용한다 — read-only, 아래 컬럼만. 쓰기 절대 금지.
// 로컬 DB 는 설치 더미값("회사명" 등)이 그대로 표시되는 것이 정상(실값은 운영 절차).
export interface ShopEstimateProfile {
  name: string; // de_admin_company_name (상호)
  owner: string; // de_admin_company_owner (대표자)
  tel: string; // de_admin_company_tel
  zip: string; // de_admin_company_zip
  addr: string; // de_admin_company_addr
  managerName: string; // de_admin_info_name (담당자)
  managerEmail: string; // de_admin_info_email
  bankAccount: string; // de_bank_account (결제계좌)
}

export async function getShopEstimateProfile(): Promise<ShopEstimateProfile | null> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT de_admin_company_name, de_admin_company_owner, de_admin_company_tel,
            de_admin_company_zip, de_admin_company_addr, de_admin_info_name,
            de_admin_info_email, de_bank_account
       FROM g5_shop_default LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    name: String(row.de_admin_company_name ?? ''),
    owner: String(row.de_admin_company_owner ?? ''),
    tel: String(row.de_admin_company_tel ?? ''),
    zip: String(row.de_admin_company_zip ?? ''),
    addr: String(row.de_admin_company_addr ?? ''),
    managerName: String(row.de_admin_info_name ?? ''),
    managerEmail: String(row.de_admin_info_email ?? ''),
    bankAccount: String(row.de_bank_account ?? ''),
  };
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

// ── 회원 관리 목록/검색/카운트 (한정 예외 ⑧) ────────────────────────────────
// 관리자 회원 관리(/app/admin/members)의 read-only 조회. WHERE 는 파라미터 바인딩,
// LIKE 특수문자(%,_,\)는 escape(레거시엔 없던 방어). 가입일(from/to)은 g5 가 KST
// native 저장이라 문자열 그대로 비교한다(sp 의 UTC 저장과 다름) — to 는 +1일 미만.
// counts 는 탭 제외 필터만 적용한 단일 쿼리(배타 SUM), total 은 탭 카운트로 파생한다.

export interface MemberListRow {
  mbId: string;
  name: string;
  nick: string;
  email: string;
  hp: string;
  tel: string;
  level: number;
  point: number;
  memberType: string; // mb_1 (회원구분)
  legacyCompany: string; // mb_2 (레거시 회사명)
  interceptDate: string; // mb_intercept_date (YYYYMMDD 또는 '')
  leaveDate: string; // mb_leave_date (YYYYMMDD 또는 '')
  joinedAt: string; // DATE_FORMAT(mb_datetime)
  lastLoginAt: string | null; // NULLIF zero-date → null
}

export interface MemberCounts {
  all: number;
  normal: number;
  intercepted: number;
  left: number;
}

export interface SearchMembersParams {
  tab: 'all' | 'normal' | 'intercepted' | 'left';
  q: string | undefined;
  from: string | undefined; // YYYY-MM-DD
  to: string | undefined; // YYYY-MM-DD
  sort: 'joined' | 'lastLogin';
  page: number;
  pageSize: number;
}

export interface SearchMembersResult {
  rows: MemberListRow[];
  total: number;
  counts: MemberCounts;
}

// 목록/상세 공용 SELECT 컬럼(화이트리스트) — 민감 컬럼(mb_password·mb_dupinfo·
// mb_lost_certify·mb_certify·mb_email_certify2)은 절대 넣지 않는다.
const MEMBER_LIST_COLUMNS = `mb_id, mb_name, mb_nick, mb_email, mb_hp, mb_tel, mb_level, mb_point,
    mb_1, mb_2, mb_leave_date, mb_intercept_date,
    DATE_FORMAT(mb_datetime, '%Y-%m-%d %H:%i') AS joined_at,
    DATE_FORMAT(NULLIF(mb_today_login, '0000-00-00 00:00:00'), '%Y-%m-%d %H:%i') AS last_login_at`;

function mapMemberListRow(row: RowDataPacket): MemberListRow {
  return {
    mbId: String(row.mb_id),
    name: String(row.mb_name),
    nick: String(row.mb_nick),
    email: String(row.mb_email),
    hp: String(row.mb_hp),
    tel: String(row.mb_tel),
    level: Number(row.mb_level),
    point: Number(row.mb_point),
    memberType: String(row.mb_1),
    legacyCompany: String(row.mb_2),
    interceptDate: String(row.mb_intercept_date),
    leaveDate: String(row.mb_leave_date),
    joinedAt: String(row.joined_at ?? ''),
    lastLoginAt: row.last_login_at === null ? null : String(row.last_login_at),
  };
}

// 검색어·가입일 필터(탭 제외 — counts 와 목록이 공유). 바인딩 파라미터를 함께 반환.
function memberBaseFilter(params: SearchMembersParams): { conds: string[]; bind: string[] } {
  const conds: string[] = [];
  const bind: string[] = [];
  const q = params.q?.trim() ?? '';
  if (q !== '') {
    // LIKE 특수문자 escape 후 %…% 바인딩(MySQL 기본 escape 문자 = 백슬래시)
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(
      '(mb_id LIKE ? OR mb_name LIKE ? OR mb_nick LIKE ? OR mb_email LIKE ? OR mb_hp LIKE ?)',
    );
    bind.push(like, like, like, like, like);
  }
  if (params.from !== undefined) {
    conds.push('mb_datetime >= ?');
    bind.push(`${params.from} 00:00:00`);
  }
  if (params.to !== undefined) {
    // 해당 일 포함 — 다음 날 00:00:00 미만
    conds.push('mb_datetime < DATE_ADD(?, INTERVAL 1 DAY)');
    bind.push(`${params.to} 00:00:00`);
  }
  return { conds, bind };
}

const whereClause = (conds: string[]): string =>
  conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

// 탭 조건(배타식) — 플레이스홀더 없는 상수 SQL.
const MEMBER_TAB_COND: Record<'normal' | 'intercepted' | 'left', string> = {
  normal: "mb_intercept_date = '' AND mb_leave_date = ''",
  intercepted: "mb_intercept_date <> '' AND mb_leave_date = ''",
  left: "mb_leave_date <> ''",
};

const MEMBER_SORT_COLUMN: Record<'joined' | 'lastLogin', string> = {
  joined: 'mb_datetime',
  lastLogin: 'mb_today_login',
};

export async function searchMembers(params: SearchMembersParams): Promise<SearchMembersResult> {
  const pool = getG5Pool();
  const base = memberBaseFilter(params);

  // counts — 탭 제외 필터만. 배타 SUM(mysql2 는 SUM 을 string 으로 줄 수 있어 Number 정규화).
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS all_count,
            SUM(mb_leave_date <> '') AS left_count,
            SUM(mb_intercept_date <> '' AND mb_leave_date = '') AS intercepted_count
       FROM g5_member ${whereClause(base.conds)}`,
    base.bind,
  );
  const cr = countRows[0];
  const allCount = Number(cr?.all_count ?? 0);
  const leftCount = Number(cr?.left_count ?? 0);
  const interceptedCount = Number(cr?.intercepted_count ?? 0);
  const counts: MemberCounts = {
    all: allCount,
    left: leftCount,
    intercepted: interceptedCount,
    normal: allCount - leftCount - interceptedCount,
  };

  // total = 탭 카운트(배타 집계라 별도 total 쿼리 불필요)
  const total = params.tab === 'all' ? counts.all : counts[params.tab];

  // 목록 — base + 탭 조건. ORDER BY 화이트리스트 + mb_no DESC 타이브레이크.
  const listConds =
    params.tab === 'all' ? base.conds : [...base.conds, MEMBER_TAB_COND[params.tab]];
  const orderBy = `${MEMBER_SORT_COLUMN[params.sort]} DESC, mb_no DESC`;
  const offset = (params.page - 1) * params.pageSize;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${MEMBER_LIST_COLUMNS} FROM g5_member ${whereClause(listConds)}
      ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...base.bind, params.pageSize, offset],
  );

  return { rows: rows.map(mapMemberListRow), total, counts };
}

// 상세 — 목록 컬럼 + 주소·수신동의·인증일·메모·사업자 여분필드(mb_3~mb_9).
export interface MemberDetailRow extends MemberListRow {
  zip1: string;
  zip2: string;
  addr1: string;
  addr2: string;
  addr3: string;
  emailCertifiedAt: string | null; // mb_email_certify, zero-date→null
  mailling: number; // mb_mailling
  sms: number; // mb_sms
  marketingAgree: number; // mb_marketing_agree
  memo: string; // mb_memo (관리자 메모, read-only)
  mb3: string; // 사업자번호
  mb4: string; // 대표자
  mb5: string; // 업태
  mb6: string; // 종목
  mb7: string; // 담당자명
  mb8: string; // 세금계산서 이메일
  mb9: string; // 담당자 전화
}

export async function getMemberDetailRow(mbId: string): Promise<MemberDetailRow | null> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT ${MEMBER_LIST_COLUMNS},
            mb_zip1, mb_zip2, mb_addr1, mb_addr2, mb_addr3,
            DATE_FORMAT(NULLIF(mb_email_certify, '0000-00-00 00:00:00'), '%Y-%m-%d %H:%i') AS email_certified_at,
            mb_mailling, mb_sms, mb_marketing_agree, mb_memo,
            mb_3, mb_4, mb_5, mb_6, mb_7, mb_8, mb_9
       FROM g5_member WHERE mb_id = ?`,
    [mbId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    ...mapMemberListRow(row),
    zip1: String(row.mb_zip1),
    zip2: String(row.mb_zip2),
    addr1: String(row.mb_addr1),
    addr2: String(row.mb_addr2),
    addr3: String(row.mb_addr3),
    emailCertifiedAt: row.email_certified_at === null ? null : String(row.email_certified_at),
    mailling: Number(row.mb_mailling),
    sms: Number(row.mb_sms),
    marketingAgree: Number(row.mb_marketing_agree),
    memo: String(row.mb_memo),
    mb3: String(row.mb_3),
    mb4: String(row.mb_4),
    mb5: String(row.mb_5),
    mb6: String(row.mb_6),
    mb7: String(row.mb_7),
    mb8: String(row.mb_8),
    mb9: String(row.mb_9),
  };
}

// cf_admin(최고관리자 mb_id) — 차단/레벨 변경 가드용(한정 예외 ⑧, g5_config 1컬럼만).
export async function getCfAdminId(): Promise<string> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(`SELECT cf_admin FROM g5_config LIMIT 1`);
  const row = rows[0];
  return row === undefined ? '' : String(row.cf_admin ?? '');
}

// ── 회원 차단/레벨 UPDATE (한정 예외 ⑨ — 2컬럼 한정) ─────────────────────────
// 이 두 함수 외에는 g5_member 를 절대 쓰지 않는다. 가드(탈퇴/self/cf_admin)는 라우트가
// 강제. MyISAM 무트랜잭션이나 단일행·단일컬럼이라 무해. affectedRows 는 반환만 하고 흐름
// 제어에 쓰지 않는다 — 동일값 UPDATE 가 0 을 줄 수 있어 멱등 200 과 충돌하므로, 존재 판정은
// 라우트의 사전 조회 가드(getMemberDetailRow → 404)가 담당한다.

// ymd = KST 오늘 YYYYMMDD(차단) 또는 ''(해제). PHP 는 매 요청 intercept 검사로 즉시 효력,
// sp JWT 는 최대 10분 잔존 후 me.php 재발급 거부 — 수용(주석 기록).
export async function setMemberIntercept(mbId: string, ymd: string): Promise<number> {
  const [result] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_member SET mb_intercept_date = ? WHERE mb_id = ?`,
    [ymd, mbId],
  );
  return result.affectedRows;
}

export async function setMemberLevel(mbId: string, level: number): Promise<number> {
  const [result] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_member SET mb_level = ? WHERE mb_id = ?`,
    [level, mbId],
  );
  return result.affectedRows;
}

export async function closeG5Pool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
