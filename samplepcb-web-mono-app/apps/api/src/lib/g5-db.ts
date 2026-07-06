// 로컬/운영 그누보드(영카트) DB — sp-node 의 모든 g5_* 접근은 이 파일로 일원화한다.
//
// 방침(2026-07-04 개정, HANDOFF 결정 로그 #11): sp-php 에서 이 프로젝트 업무에 필요한
// 기능은 sp-vue/sp-node 모노레포로 **점진 마이그레이션**한다 — g5 읽기/쓰기는 "원칙
// 금지"가 아니라 **규율된 확장** 대상이다. 규율 4가지:
//   (1) 접근 일원화 — g5 는 이 파일의 함수로만(mysql2). Prisma 는 sp_* 전용.
//   (2) 아래 접근 카탈로그를 함수·컬럼 단위로 전수 유지(무엇을 읽고 쓰는지 기록).
//   (3) 코어 정합성 — 그누보드/영카트가 병행 동작하므로 쓰기 추가 시 코어 부수효과
//       (회원삭제 8테이블 연쇄·수신동의 agree_log·포인트 g5_point 연동 등)를 확인하고,
//       단순 UPDATE 로 재현 안 되는 도메인은 그 로직까지 이식할 것.
//   (4) 카탈로그 확장 시 HANDOFF 결정 로그 + GERBER_ORDER_FLOW 5장 동시 갱신.
//
// 접근 카탈로그(결정 로그 #6 계열):
// ① g5_shop_cart INSERT ② g5_shop_item_option INSERT(견적 옵션 행)
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
// 절대 제외, g5_config 는 cf_admin 1컬럼만. 회원 정보 편집의 중복 검사(mb_email·mb_nick·
// mb_hp COUNT)도 ⑧ 범위) ⑨ g5_member UPDATE — (a) 차단/레벨: mb_intercept_date·mb_level
// (가드 3종: 탈퇴 409 / 자기 자신 409 / cf_admin 계정 409) · (b) 회원 정보/메모 편집:
// mb_name·mb_nick·mb_email·mb_hp·mb_tel·mb_zip1·mb_zip2·mb_addr1·mb_addr2·mb_addr3·
// mb_addr_jibeon·mb_memo (가드 2종: 미존재 404 + 탈퇴 409 만 — self·cf_admin 허용, 권한
// 공격 벡터가 아니라 차등). 코어 정합성(adm/member_form_update.php): 닉/이메일/hp 중복
// 거부·hp 하이픈 정규화·zip 3+2 분해·주소 변경 시 mb_addr_jibeon 초기화·mb_nick_date
// 미갱신. 화이트리스트(updateMemberInfo 맵) 밖 컬럼 쓰기 금지.
// ⑩ g5_shop_order·g5_shop_cart read-only SELECT(관리자 견적 삭제 프리뷰 — 주문됨 견적이
// 묶인 주문의 결제상태·수납액·PG거래·같은 주문의 다른 견적 파악: od_status·od_receipt_price·
// od_cart_price·od_settle_case·od_tno·od_pg·od_misu + cart od_id/it_name/io_id, 쓰기 없음).
// ⑪ g5_shop_order 미입금 주문 삭제(관리자 견적 완전삭제 — 코어 adm/shop_admin/orderlistdelete.php
// 이식: od_status='주문'만, g5_shop_order_delete 백업(serialize) → g5_shop_cart ct_status='삭제'
// → g5_shop_order DELETE. 결제완료(od_status≠'주문')는 PG환불 취소 도메인이라 차단. 포인트/쿠폰
// 환급 불필요=미입금 부수효과 없음). 코어 정합성(규율 3): 미입금만·백업·cart 소프트 그대로 재현.
// ⑫ g5_shop_order·g5_shop_cart read-only SELECT(관리자 주문내역 — adm/shop_admin/orderlist.php
// 이식. 목록/상세/카운트/누적주문수, **읽기 전용**. 쓰기(상태 전이·삭제)는 별도 WP). 함수:
// searchOrders(목록+배타 counts), getOrderRow(상세 헤더), getCartRowsByOdId(카트 라인),
// getMemberOrderCounts(누적주문수 배치), getDeliveryExcelRows(엑셀 배송처리 대상 —
// orderdeliveryexcel.php 이식: od_status='준비' AND od_misu=0, od_id desc, 받는분 연락처·주소
// 포함). WHERE 조립은 순수 함수 buildOrderListWhere/
// buildOrderBaseConds/buildOrderTabCond(파라미터 바인딩, 문자열 보간 없음 — qField·정렬 컬럼은
// 화이트리스트 상수). 컬럼: 목록은 ORDER_LIST_COLUMNS, 상세는 ORDER_DETAIL_COLUMNS(둘 다
// 화이트리스트). **민감 컬럼 od_pwd·od_cash·od_cash_info 는 SELECT 에서 절대 제외**. 날짜는
// KST native 문자열(DATE_FORMAT), zero-date 는 NULLIF→null. 쓰기 없음.
// 운영 전용 커스텀 컬럼(mb_partner_auth, mb_11~mb_20)은 로컬 신설 DB 에 없어 참조 금지.
// ⑬ g5_shop_order·g5_shop_cart·g5_shop_item·g5_shop_item_option 쓰기(관리자 주문 상태 전이·
// 선택삭제 — adm/shop_admin/orderlistupdate.php·orderlistdelete.php 이식). 함수·컬럼·가드:
//   • setOrdersReceipt   주문→입금: change_status(od_status/ct_status='입금' WHERE ='주문') +
//       order_update_receipt(od_receipt_price=od_misu·od_misu=0·od_receipt_time=NOW WHERE od_status
//       ='입금'). 가드: 현재 od_status='주문' AND od_settle_case='무통장'(무통장만 관리자 수동 입금).
//   • setOrdersPreparing 입금→준비: change_status(='준비' WHERE ='입금'). 가드: 현재 '입금'.
//   • setOrdersDelivery  준비→배송: order_update_delivery(od_delivery_company·od_invoice·
//       od_invoice_time UPDATE WHERE od_status='준비' + 카트 행 재고차감 loop: !ct_stock_use 면
//       subtract_io_stock(io_id 있으면 g5_shop_item_option.io_stock_qty-=ct_qty, 없으면 g5_shop_item.
//       it_stock_qty-=ct_qty)·ct_stock_use=1) + change_status(='배송' WHERE ='준비'). 가드: 현재 '준비'
//       + 운송장 3필드(회사·번호·시각). 견적 행은 io_id=quoteId 로 per-quote 옵션 행(9999999)만 감소.
//   • setOrdersComplete  배송→완료: change_status(='완료' WHERE ='배송') + it_sum_qty 갱신(주문의
//       '완료' 카트 각 it_id 에 대해 전 주문 통틀어 SUM(ct_qty) '완료' 를 g5_shop_item.it_sum_qty 에
//       기록 — 판매 통계, 공유 템플릿 무해). 가드: 현재 '배송'.
//   • deleteOrders       미입금 선택삭제: ⑪ deleteUnpaidOrder 배치화(od 루프). 가드: od_status='주문'.
//   • 공통: 전이 성공 후 recomputeOrderMoney(get_order_info :1745-1795 미러) — g5_shop_order
//       od_misu·od_tax_mny·od_vat_mny·od_free_mny·od_send_cost UPDATE. **send_cost·od_coupon·
//       od_send_coupon 은 저장값 재사용**(상태 전이는 get_sendcost/쿠폰 산식의 상태 WHERE 집합
//       쇼핑~완료 내부 이동이라 불변 — get_sendcost/쿠폰테이블 포트는 미이식, 갭 기록). 순수
//       산식은 computeOrderMoney(테스트 대상). 상태·금액 UPDATE 는 전부 WHERE od_id AND od_status
//       (가드 원자성 — 읽고-쓰기 레이스 방지). 시각은 NOW()(기존 파일 관례; DB 세션 tz=KST 면
//       코어 G5_TIME_YMDHIS 와 동등). **코어 change_status 는 od_mod_history 를 append 하지 않는다**
//       (이력은 주문 생성 orderform 에서만 기록 — 상태 전이 흐름엔 이력 append 없음).
// ⑭ g5_shop_order 상세 편집 UPDATE(관리자 주문 편집 — adm/shop_admin/orderformupdate.php·
// orderformreceiptupdate.php 이식). 함수·컬럼:
//   • updateOrderInfo — 주문자/받는분/배송지/희망일 화이트리스트 동적 SET(od_name·od_email·
//       od_tel·od_hp·od_zip1/2·od_addr1~3·od_addr_jibeon·od_b_* 동형·od_deposit_name·od_hope_date).
//       화이트리스트 밖 컬럼 쓰기 불가. jibeon 은 코어처럼 패스스루(⑨-b 회원과 달리 addr 변경 시
//       미초기화). 상태 무관(코어 동일). zip 은 FE 가 zip1/zip2 분리 전송(코어는 합본 분해).
//   • updateOrderShopMemo — od_shop_memo 평문(주문자 요청 od_memo 는 비대상).
//   • updateOrderReceipt — 무통장 입금 조정 od_receipt_price·od_receipt_time·od_deposit_name
//       (원자 가드 WHERE od_settle_case='무통장') + recomputeOrderMoney. 코어 receiptupdate 의
//       배송/에스크로/재고/상태전이/메일 부수효과는 스코프 밖(WP3 전이·배송이 담당 — 갭 기록).
//   • 인쇄(GET .../print)는 읽기 전용 — getOrderRow(⑫)+getShopEstimateProfile(⑦) 조합, 신규 쓰기 없음.
// ⑮ 카트행 단위 취소/반품/품절(관리자 — adm/shop_admin/orderformcartupdate.php 이식, 무통장 한정).
// setOrderItemsStatus(odId, ctIds, target, actor, ip) — ct 단위 독립 처리. 컬럼·부수효과:
//   • g5_shop_cart UPDATE(원자 가드 WHERE ct_id AND ct_status=현재): ct_status=target·ct_stock_use=0·
//       ct_point_use=0·ct_history=CONCAT("\n{target}|{actor}|{KST}|{ip}"). 이미 취소류/미소속/포인트
//       딸린 행은 skip(ALREADY_CANCELLED/NOT_IN_ORDER/HAS_POINT).
//   • 재고 복원(restoreStock=add_io_stock 미러): ct_stock_use=1(배송 후 차감) 행만 — io_id 있으면
//       g5_shop_item_option.io_stock_qty+=ct_qty, 없으면 g5_shop_item.it_stock_qty+=ct_qty. 차감 안 된
//       행(주문/입금/준비)은 복원 없음. **claim-first**(상태 UPDATE 성공 후 복원 — 레이스 이중복원 방지).
//   • g5_shop_item it_sum_qty 재계산(영향 it_id 별 '완료' SUM).
//   • 전량 취소류(총=취소류 카운트) → g5_shop_order od_status='취소' + od_mod_history CONCAT
//       ("{KST} {actor} 주문{target} 처리\n"). **orderformcartupdate 는 od_mod_history 를 append 한다**
//       (WP3 상태전이 change_status 와 다른 지점 — 여기선 append).
//   • 미수금/취소금액 재계산 recomputeOrderMoneyOnItemChange(WP3 recomputeOrderMoney 와 별개 —
//       전이 경로 회귀 방지): 활성/취소류 카트 집계로 od_cart_price(활성+취소)·od_cart_coupon(활성 cp)·
//       od_cancel_price(취소류)·od_misu·od_tax_mny·od_vat_mny·od_free_mny 재계산(computeOrderMoney 재사용).
//       **od_send_cost·od_coupon·od_send_coupon 은 저장값 재사용**(WP3 갭과 동일 — get_sendcost/쿠폰테이블
//       포트 미이식; PCB 는 쿠폰 미사용이라 무영향, 차등배송이면 send_cost 드리프트 가능 — 캐베앗 유지).
//   • **포인트 복원(delete_point) no-op**: PCB 카트행은 ct_point=0(insertCartRow)이라 코어 조건 미발동.
//       g5_point 원장 캐스케이드 포트는 미이식 — ct_point>0 행은 HAS_POINT 로 skip(구주문 유입 안전판,
//       PHP 관리자로 위임). PG 취소 분기(코어 190-336)는 무통장 guard(라우트 409)로 제외.
// ⑯ 주문 임의 상태 변경(관리자 드로어 — orderformcartupdate.php 정상 상태 분기 이식, ⑮ 취소류의 짝).
// setOrderForceStatus(odId, target, delivery?, actor, ip) — 주문 라인(쇼핑/삭제 제외, **취소류 포함**)
// ct_status=target + od_status=target. 취소류 행 → 정상 상태 = **un-cancel**(코어 정상 분기가 담당 —
// 취소류를 빼면 전량취소 주문에 걸 때 od_status/카트행 불일치). 스톡 앵커(resolveForceStatusStock 순수
// 판정): 배송/완료 진입 시 미차감 행 차감(취소 행은 WP6 가 ct_stock_use=0 복원해둠 → 진입 시 차감)
// (adjustStock -ct_qty)·주문 역방향 시 차감 행 복원(+ct_qty)·그 외 무변화. it_sum_qty 는 코어 조건의
// 정상 부분집합 {주문,완료} 만 재계산. 금액은 recomputeOrderMoneyOnItemChange(⑮) 재사용. od_mod_history
// append 없음(코어 정상 분기 미기록). **결제수단 가드·운송장 요구 없음**(코어 정상 분기 무검사 —
// 임의 변경 허용). delivery 는 target='배송' 제공 시만 운송장 반영(계약 필드 존중). 포인트 딸린 활성
// 행(ct_point>0)은 HAS_POINT 로 전체 거부(⑮와 동일 안전판, PCB 미발생). claim-first 원자 가드.
// ⑱ g5_shop_default 사업자정보 read/write (관리자 설정 > 사업자정보 —
// adm/shop_admin/configform.php·configformupdate.php 의 "사업자정보" 섹션 이식).
// read getBusinessInfo: de_admin_company_name/owner/saupja_no/tel/fax · de_admin_tongsin_no ·
//   de_admin_buga_no · de_admin_company_zip/addr · de_admin_info_name/email 11컬럼 SELECT(LIMIT 1).
// write updateBusinessInfo: 위 11컬럼만 UPDATE(코어 configformupdate.php:273 은 ~150컬럼을 일괄
//   UPDATE 하지만 우리는 11컬럼 한정 — PHP 관리자 병행 시 결제/PG/SMS 무관 설정 미훼손, 코어보다
//   안전). WHERE 없음(g5_shop_default 는 설치 후 항상 1행인 싱글턴).
// 코어 정합성(규율 3): 저장 전 부수 규칙 3종을 라우트(routes/admin-settings.ts)가 강제한다 —
//   (1) de_admin_company_tel 은 isValidCallback(lib/shop-config.ts, check_vaild_callback 이식)
//       통과 필수(SMS 발신번호 겸용), 실패 400. (2) de_admin_company_owner 공백이면 저장 전체
//       거부(코어는 설정유실 방지 silent 리다이렉트 — API 는 400 으로 명시화). (3) 11필드
//       cleanXssTags(lib/shop-config.ts, clean_xss_tags 이식) 정제 후 저장. addslashes/
//       stripslashes 는 mysql2 파라미터 바인딩이 대체하므로 미이식.
// ⑦ getShopEstimateProfile(read-only 발신처, bankAccount 포함 8컬럼)과 컬럼 일부 겹치나
//   목적·쓰기여부가 달라 분리(⑱은 writable, businessNo/fax/mailOrderNo/bugaNo 4컬럼 더 가진 상위집합).
// (번호: ⑰은 2026-07-05 PCB 제작단계 작업이 ACTIVE_ORDER_STATUSES SSOT 로 선점 — GERBER_ORDER_FLOW
//  갱신 로그 참조. 미커밋 병존 작업이라 사업자정보는 ⑱로 매긴다.)
// 카탈로그 밖 접근을 추가할 때는 위 규율 (3)(4)를 따를 것. 불변 원칙: 민감 컬럼(비밀번호·
// 본인확인·인증 계열) SELECT 배제 · 이 파일 밖에서의 g5 직접 접근 금지 · Prisma 에 g5 비편입.
//
// LEGACY_DATABASE_URL(운영 읽기 전용, 검증 스크립트용)과 반드시 구분한다.
// 이 모듈은 서비스가 실제로 쓰는 DB(G5_DATABASE_URL — 로컬 개발은 로컬 XAMPP)를 본다.

import { createPool } from 'mysql2/promise';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { kstDateTimeStr } from './kst';

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

// ── 주문 삭제 프리뷰용 조회 (한정 예외 ⑩) ───────────────────────────────────
// 관리자 견적 완전삭제 프리뷰 — 주문됨(ordered) 견적이 묶인 주문의 결제상태·수납액·
// PG거래 유무와, 같은 주문(od_id)에 함께 묶인 다른 cart 행(다른 견적)을 파악한다.
// 견적↔주문은 1:N(영카트는 order_item 없이 cart 행이 주문 라인) — 이 조회로 "이 견적을
// 지우면 함께 걸리는 것"을 프리뷰가 정직하게 노출한다. isPaid(od_status≠'주문')는 삭제
// 차단(결제완료=PG환불 취소 도메인) 판정에 쓰인다. read-only.
export interface OrderInfo {
  odId: string;
  odStatus: string; // '주문'(미입금)|'입금'|'배송'|'완료'…
  isPaid: boolean; // od_status !== '주문' — 결제완료(삭제 차단 대상) 판정
  receiptPrice: number; // od_receipt_price 수납액
  cartPrice: number; // od_cart_price 주문 상품 합계
  settleCase: string; // od_settle_case 결제수단
  hasPgTransaction: boolean; // od_tno 유무 — PG 거래(대사 근거) 존재 신호
  pg: string; // od_pg PG사
  misu: number; // od_misu 미수금
  siblingCarts: { ctId: number; itName: string; ioId: string }[]; // 같은 주문의 다른 cart 행
}

export async function getOrderInfoByCtId(ctId: number): Promise<OrderInfo | null> {
  const pool = getG5Pool();
  const [cartRows] = await pool.query<RowDataPacket[]>(
    `SELECT od_id FROM g5_shop_cart WHERE ct_id = ?`,
    [ctId],
  );
  const cart = cartRows[0];
  if (cart === undefined) return null;
  const odId = String(cart.od_id);
  const [orderRows] = await pool.query<RowDataPacket[]>(
    `SELECT od_status, od_receipt_price, od_cart_price, od_settle_case, od_tno, od_pg, od_misu
       FROM g5_shop_order WHERE od_id = ?`,
    [odId],
  );
  const order = orderRows[0];
  if (order === undefined) return null; // 주문 헤더 없음 = 아직 담김(임시 cart_id)
  const [siblings] = await pool.query<RowDataPacket[]>(
    `SELECT ct_id, it_name, io_id FROM g5_shop_cart WHERE od_id = ? AND ct_id <> ?`,
    [odId, ctId],
  );
  return {
    odId,
    odStatus: String(order.od_status),
    isPaid: String(order.od_status) !== '주문',
    receiptPrice: Number(order.od_receipt_price ?? 0),
    cartPrice: Number(order.od_cart_price ?? 0),
    settleCase: String(order.od_settle_case ?? ''),
    hasPgTransaction: String(order.od_tno ?? '') !== '',
    pg: String(order.od_pg ?? ''),
    misu: Number(order.od_misu ?? 0),
    siblingCarts: siblings.map((s) => ({
      ctId: Number(s.ct_id),
      itName: String(s.it_name),
      ioId: String(s.io_id),
    })),
  };
}

// ── 미입금 주문 삭제 (한정 예외 ⑪) ─────────────────────────────────────────
// 관리자 견적 완전삭제가 주문됨 견적을 지울 때, 코어 adm/shop_admin/orderlistdelete.php
// (:29-45)를 그대로 이식한다. 미입금(od_status='주문')만 대상 — 결제완료는 PG환불 포함
// 취소 도메인이라 여기서 삭제하지 않는다(반환 'paid' 로 호출부가 차단). 순서(코어 동일):
//   ① g5_shop_order_delete 백업(serialize($od) 형식) ② g5_shop_cart ct_status='삭제'
//   (그 주문의 '주문' 행 전부 — 물리삭제 아님) ③ g5_shop_order DELETE.
// 포인트/쿠폰 환급은 코어도 하지 않는다(미입금이라 결제 부수효과가 없음).
// ⚠ 견적↔주문 1:N — 이 od_id 에 묶인 다른 견적의 cart 행도 함께 '삭제' 처리된다(프리뷰 고지).
export type OrderDeleteOutcome = 'deleted' | 'paid' | 'not_found';

export async function deleteUnpaidOrder(
  odId: string,
  actorMbId: string,
  ip: string,
): Promise<OrderDeleteOutcome> {
  const pool = getG5Pool();
  // 백업 정확도를 위해 모든 컬럼을 DB 문자열 표현 그대로 받는다(PHP sql_fetch 와 동일 —
  // datetime 도 'Y-m-d H:i:s' 문자열). serialize 바이트가 코어와 일치해 복원 UI 와 호환.
  const [rows] = await pool.query<RowDataPacket[]>(
    {
      sql: `SELECT * FROM g5_shop_order WHERE od_id = ?`,
      typeCast: (field: { string: () => string | null }) => field.string(),
    },
    [odId],
  );
  const od = rows[0];
  if (od === undefined) return 'not_found';
  if (String(od.od_status) !== '주문') return 'paid'; // 결제완료 — 삭제 금지(호출부 차단)

  const deData = phpSerializeAssoc(od);
  await pool.query(
    `INSERT INTO g5_shop_order_delete
       SET de_key = ?, de_data = ?, mb_id = ?, de_ip = ?, de_datetime = NOW()`,
    [odId, deData, actorMbId, ip],
  );
  await pool.query(
    `UPDATE g5_shop_cart SET ct_status = '삭제' WHERE od_id = ? AND ct_status = '주문'`,
    [odId],
  );
  await pool.query(`DELETE FROM g5_shop_order WHERE od_id = ?`, [odId]);
  return 'deleted';
}

// PHP serialize() 재현 — g5_shop_order 백업을 코어(orderlistdelete.php)와 동일 형식으로
// 저장하기 위한 최소 구현. 입력은 전 컬럼이 문자열(or NULL)인 assoc(위 typeCast 로 보장).
// 문자열 길이는 PHP strlen 과 같이 UTF-8 바이트 기준.
function phpSerializeAssoc(row: Record<string, string | null>): string {
  const entries = Object.entries(row);
  const phpStr = (s: string): string => `s:${String(Buffer.byteLength(s, 'utf8'))}:"${s}";`;
  let out = `a:${String(entries.length)}:{`;
  for (const [key, val] of entries) {
    out += phpStr(key);
    out += val === null ? 'N;' : phpStr(val);
  }
  out += '}';
  return out;
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

// ── 사업자정보 read/write (카탈로그 ⑱) ──────────────────────────────────────
// 관리자 설정 > 사업자정보 탭. g5_shop_default 의 de_admin_* 11컬럼(싱글턴 행)을 읽고
// 쓴다. ⑦ getShopEstimateProfile 과 목적·쓰기여부가 달라 분리. 필드명은 api-contract
// BusinessInfo 와 일치시켜 라우트에서 매핑 없이 그대로 응답에 실을 수 있게 한다.
export interface BusinessInfo {
  companyName: string; // de_admin_company_name (회사명)
  ownerName: string; // de_admin_company_owner (대표자명)
  businessNo: string; // de_admin_company_saupja_no (사업자등록번호)
  tel: string; // de_admin_company_tel (대표전화 = SMS 발신번호)
  fax: string; // de_admin_company_fax (팩스)
  mailOrderNo: string; // de_admin_tongsin_no (통신판매업 신고번호)
  bugaNo: string; // de_admin_buga_no (부가통신 사업자번호)
  zip: string; // de_admin_company_zip (사업장우편번호)
  addr: string; // de_admin_company_addr (사업장주소)
  infoManagerName: string; // de_admin_info_name (정보관리책임자명)
  infoManagerEmail: string; // de_admin_info_email (정보책임자 e-mail)
}

export async function getBusinessInfo(): Promise<BusinessInfo | null> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT de_admin_company_name, de_admin_company_owner, de_admin_company_saupja_no,
            de_admin_company_tel, de_admin_company_fax, de_admin_tongsin_no,
            de_admin_buga_no, de_admin_company_zip, de_admin_company_addr,
            de_admin_info_name, de_admin_info_email
       FROM g5_shop_default LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    companyName: String(row.de_admin_company_name ?? ''),
    ownerName: String(row.de_admin_company_owner ?? ''),
    businessNo: String(row.de_admin_company_saupja_no ?? ''),
    tel: String(row.de_admin_company_tel ?? ''),
    fax: String(row.de_admin_company_fax ?? ''),
    mailOrderNo: String(row.de_admin_tongsin_no ?? ''),
    bugaNo: String(row.de_admin_buga_no ?? ''),
    zip: String(row.de_admin_company_zip ?? ''),
    addr: String(row.de_admin_company_addr ?? ''),
    infoManagerName: String(row.de_admin_info_name ?? ''),
    infoManagerEmail: String(row.de_admin_info_email ?? ''),
  };
}

// 11컬럼 일괄 UPDATE — WHERE 없음(싱글턴 행). fields 는 이미 검증·정제 완료된 값이며
// 도메인 판단(tel 검증·owner 가드·sanitize)은 라우트가 수행한다(updateMemberInfo 철학).
// 코어 configformupdate.php:273-283 미러(단 사업자정보 11컬럼만 SET).
export async function updateBusinessInfo(fields: BusinessInfo): Promise<number> {
  const [res] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_shop_default SET
        de_admin_company_name = ?, de_admin_company_owner = ?, de_admin_company_saupja_no = ?,
        de_admin_company_tel = ?, de_admin_company_fax = ?, de_admin_tongsin_no = ?,
        de_admin_buga_no = ?, de_admin_company_zip = ?, de_admin_company_addr = ?,
        de_admin_info_name = ?, de_admin_info_email = ?`,
    [
      fields.companyName,
      fields.ownerName,
      fields.businessNo,
      fields.tel,
      fields.fax,
      fields.mailOrderNo,
      fields.bugaNo,
      fields.zip,
      fields.addr,
      fields.infoManagerName,
      fields.infoManagerEmail,
    ],
  );
  return res.affectedRows;
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
  addrJibeon: string; // mb_addr_jibeon (지번 주소 — 주소 검색이 채운 값, '' 가능)
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
            mb_zip1, mb_zip2, mb_addr1, mb_addr2, mb_addr3, mb_addr_jibeon,
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
    addrJibeon: String(row.mb_addr_jibeon),
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

// ── 알림(메일/SMS) 발송 설정 SELECT (한정 예외 ⑧·⑦ — read-only) ────────────────
// 관리자 주문 화면의 메일/SMS 체크박스 노출 게이트. 코어 orderform.php(:717·825·851)의
// 설정 게이트를 sp-vue 목록·상세 공통으로 이식한다. 단 SMS 는 코어 상세(cf_sms_use truthy)
// 보다 좁혀 실발송(spcb/api/order-notify.php:119)과 동일하게 cf_sms_use==='icode' + 전이별
// de_sms_use4(입금)/de_sms_use5(배송) 로 맞춘다(노출-발송 정합). 정책 계산은 여기서 끝내고
// 라우트는 boolean 만 그대로 응답한다. 쓰기 절대 금지.
export interface NotifyConfig {
  mailAvailable: boolean;
  smsDepositAvailable: boolean;
  smsShippingAvailable: boolean;
}

export async function getNotifyConfig(): Promise<NotifyConfig> {
  const [cfgRows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT cf_email_use, cf_sms_use FROM g5_config LIMIT 1`,
  );
  const [defRows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT de_sms_use4, de_sms_use5 FROM g5_shop_default LIMIT 1`,
  );
  const cfg = cfgRows[0];
  const def = defRows[0];
  // cf_sms_use 는 문자열('icode'|''|…), cf_email_use·de_sms_useN 은 0/1(문자열일 수 있어 Number 정규화).
  const smsIcode = cfg !== undefined && String(cfg.cf_sms_use ?? '') === 'icode';
  return {
    mailAvailable: cfg !== undefined && Number(cfg.cf_email_use ?? 0) > 0,
    smsDepositAvailable: smsIcode && def !== undefined && Number(def.de_sms_use4 ?? 0) > 0,
    smsShippingAvailable: smsIcode && def !== undefined && Number(def.de_sms_use5 ?? 0) > 0,
  };
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

// ── 회원 정보/메모 편집 UPDATE (카탈로그 ⑨-b) ────────────────────────────────
// 코어(adm/member_form_update.php) 정합성 이식. 가드 2종(미존재 404·탈퇴 409)은 라우트가
// 강제하며 self·cf_admin 은 허용(차단/레벨과 차등). affectedRows 는 반환만(멱등, ⑨-a 관례).

// 휴대폰 하이픈 정규화 — 코어 hyphen_hp_number(lib/common.lib.php:3419) 취지 이식.
// 숫자만 추출 후 (02|01X|3자리)-(가운데)-(끝 4자리) 하이픈. 휴대폰(01X 10~11자리)은 코어와
// 결과 100% 동일. 단 02 국번은 코어(끝 기준 3-N-4 → "021-234-…")와 달리 02- 로 분리 —
// mb_hp 는 휴대폰 필드라 실사용 무영향이고 오입력엔 우리 쪽이 정확(의도적 미세 개선).
export function hyphenHpNumber(hp: string): string {
  if (hp === '') return '';
  const digits = hp.replace(/[^0-9]/g, '');
  return digits.replace(/(^02.{0}|^01.{1}|[0-9]{3})([0-9]+)([0-9]{4})/, '$1-$2-$3');
}

// 중복 검사(카탈로그 ⑧) — 코어 exist_mb_* 와 동일하게 `= ? AND mb_id <> ?`(utf8 ci).
async function existsMemberColumn(
  column: 'mb_email' | 'mb_nick' | 'mb_hp',
  value: string,
  excludeMbId: string,
): Promise<boolean> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM g5_member WHERE ${column} = ? AND mb_id <> ?`,
    [value, excludeMbId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
export const existsMemberEmail = (email: string, excludeMbId: string): Promise<boolean> =>
  existsMemberColumn('mb_email', email, excludeMbId);
export const existsMemberNick = (nick: string, excludeMbId: string): Promise<boolean> =>
  existsMemberColumn('mb_nick', nick, excludeMbId);
export const existsMemberHp = (hp: string, excludeMbId: string): Promise<boolean> =>
  existsMemberColumn('mb_hp', hp, excludeMbId);

// 회원 정보 부분 갱신 — 컬럼 화이트리스트 맵으로 동적 SET(맵 밖 키는 타입 차원에서 불가).
// zip 3+2 분해·주소 변경 시 mb_addr_jibeon 초기화·hp 하이픈 정규화는 라우트가 결정해
// fields 로 전달한다(도메인 판단은 라우트, 이 함수는 화이트리스트 UPDATE 만).
export interface MemberInfoFields {
  mb_name?: string;
  mb_nick?: string;
  mb_email?: string;
  mb_hp?: string;
  mb_tel?: string;
  mb_zip1?: string;
  mb_zip2?: string;
  mb_addr1?: string;
  mb_addr2?: string;
  mb_addr3?: string;
  mb_addr_jibeon?: string;
}

const MEMBER_INFO_COLUMNS = [
  'mb_name',
  'mb_nick',
  'mb_email',
  'mb_hp',
  'mb_tel',
  'mb_zip1',
  'mb_zip2',
  'mb_addr1',
  'mb_addr2',
  'mb_addr3',
  'mb_addr_jibeon',
] as const;

export async function updateMemberInfo(mbId: string, fields: MemberInfoFields): Promise<number> {
  const sets: string[] = [];
  const bind: string[] = [];
  for (const col of MEMBER_INFO_COLUMNS) {
    const v = fields[col];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      bind.push(v);
    }
  }
  if (sets.length === 0) return 0; // 방어 — 라우트가 최소 1개를 보장
  bind.push(mbId);
  const [result] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_member SET ${sets.join(', ')} WHERE mb_id = ?`,
    bind,
  );
  return result.affectedRows;
}

// 관리자 메모 — 평문 저장, 부수효과 없음(코어 :110).
export async function updateMemberMemo(mbId: string, memo: string): Promise<number> {
  const [result] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_member SET mb_memo = ? WHERE mb_id = ?`,
    [memo, mbId],
  );
  return result.affectedRows;
}

// ── 관리자 주문내역 조회 (한정 예외 ⑫ — read-only) ──────────────────────────
// 레거시 adm/shop_admin/orderlist.php 의 필터·컬럼 시맨틱을 이식한다. WHERE 는 전부
// 파라미터 바인딩(스톡 PHP 는 문자열 보간했지만 우리는 금지). qField·정렬 컬럼은 Zod
// enum + 아래 화이트리스트로 이중 고정된 상수라 식별자 위치에 안전하게 놓는다.

export type OrderTab =
  | '전체'
  | '주문'
  | '입금'
  | '준비'
  | '가격확인'
  | '파일검사'
  | 'EQ'
  | '생산시작'
  | '생산중'
  | '품질시험'
  | '생산완료'
  | 'A/S'
  | '배송'
  | '완료'
  | '취소'
  | '부분취소';
export type OrderSortColumn =
  | 'od_id'
  | 'od_cart_price'
  | 'od_receipt_price'
  | 'od_cancel_price'
  | 'od_misu'
  | 'od_time';

export interface SearchOrdersParams {
  tab: OrderTab;
  qField: string | undefined; // 화이트리스트 검색 대상 컬럼
  q: string | undefined; // contains (qField 동반 필수)
  from: string | undefined; // YYYY-MM-DD
  to: string | undefined; // YYYY-MM-DD
  settleCase: string | undefined; // 결제수단('간편결제'는 IN 확장)
  misu: boolean | undefined;
  cancelled: boolean | undefined;
  refund: boolean | undefined;
  point: boolean | undefined;
  coupon: boolean | undefined;
  sort: OrderSortColumn | undefined;
  order: 'asc' | 'desc' | undefined;
  page: number;
  pageSize: number;
}

// LIKE 특수문자 escape(memberBaseFilter 와 동일 — MySQL 기본 escape = 백슬래시).
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// 검색 대상 컬럼 화이트리스트(계약 enum 과 동일 — 식별자 인라인 방어).
const ORDER_QFIELDS = new Set<string>([
  'od_id',
  'mb_id',
  'od_name',
  'od_tel',
  'od_hp',
  'od_b_name',
  'od_b_tel',
  'od_b_hp',
  'od_deposit_name',
  'od_invoice',
]);
// 정렬 컬럼 화이트리스트.
const ORDER_SORT_COLUMNS = new Set<string>([
  'od_id',
  'od_cart_price',
  'od_receipt_price',
  'od_cancel_price',
  'od_misu',
  'od_time',
]);
// '간편결제' 등호 대신 확장되는 결제수단 집합(코어 orderlist.php:75).
const SETTLE_SIMPLE_PAY = ['간편결제', '삼성페이', 'lpay', 'inicis_kakaopay'];
// PCB 제작 단계(레거시 lib/common.lib.php get_order_status_list 이식) — '준비'와 '배송' 사이 커스텀 상태.
// od_status/ct_status 에 그대로 저장되며 자체 부수 로직은 없다(재고차감·송장은 '배송' 진입에서만).
export const PRODUCTION_STATUSES = [
  '가격확인',
  '파일검사',
  'EQ',
  '생산시작',
  '생산중',
  '품질시험',
  '생산완료',
  'A/S',
] as const;
// '정상 진행 중' 주문 상태(표준 5 + 제작 8). 매출/미수 정상합계·'부분취소' 판정·목록 카운트가 공유한다.
// 취소/반품/품절/쇼핑만 제외 — 리터럴로 흩뿌리면 하나만 빠져도 금액·카운트가 조용히 틀어지므로 이 상수를 참조한다.
const ACTIVE_ORDER_STATUSES = ['주문', '입금', '준비', ...PRODUCTION_STATUSES, '배송', '완료'] as const;
// SQL IN(...) 리터럴 조립 — 값이 신뢰 가능한 내부 상수라 식별자 위치에 인라인해도 안전.
const sqlStatusList = (arr: readonly string[]): string => arr.map((s) => `'${s}'`).join(', ');
// '부분취소' 판정에 쓰는 진행상태 집합(코어 orderlist.php:50) — 제작 단계도 정상 진행이라 포함한다.
const CANCELABLE_STATUSES = ACTIVE_ORDER_STATUSES;

// 탭 제외 base 조건(검색·기간·결제수단·플래그) — 목록과 counts 가 공유한다.
// PHP 원본과 다른 점: fr_date·to_date 를 BETWEEN(둘 다 필수) 대신 각각 >=,<= 로 분리해
// 한쪽만 줘도 열린 범위로 동작한다(둘 다 주면 BETWEEN 과 동일하므로 상위 호환).
export function buildOrderBaseConds(params: SearchOrdersParams): {
  conds: string[];
  values: (string | number)[];
} {
  const conds: string[] = [];
  const values: (string | number)[] = [];

  const q = params.q?.trim() ?? '';
  if (params.qField !== undefined && ORDER_QFIELDS.has(params.qField) && q !== '') {
    conds.push(`${params.qField} LIKE ?`); // qField 는 화이트리스트 상수(바인딩 불가한 식별자)
    values.push(`%${escapeLike(q)}%`);
  }

  if (params.settleCase !== undefined && params.settleCase !== '') {
    if (params.settleCase === '간편결제') {
      conds.push(`od_settle_case IN (${SETTLE_SIMPLE_PAY.map(() => '?').join(', ')})`);
      values.push(...SETTLE_SIMPLE_PAY);
    } else {
      conds.push('od_settle_case = ?');
      values.push(params.settleCase);
    }
  }

  if (params.misu === true) conds.push('od_misu <> 0');
  if (params.cancelled === true) conds.push('od_cancel_price <> 0');
  if (params.refund === true) conds.push('od_refund_price <> 0');
  if (params.point === true) conds.push('od_receipt_point <> 0');
  if (params.coupon === true) conds.push('(od_cart_coupon + od_coupon + od_send_coupon) > 0');

  if (params.from !== undefined) {
    conds.push('od_time >= ?');
    values.push(`${params.from} 00:00:00`);
  }
  if (params.to !== undefined) {
    conds.push('od_time <= ?');
    values.push(`${params.to} 23:59:59`);
  }

  return { conds, values };
}

// 탭 조건(배타식). '전체'=조건 없음 · '취소'=od_status='취소'(스톡 '전체취소') ·
// '부분취소'=진행상태 IN AND od_cancel_price>0 · 그 외=od_status 등호.
export function buildOrderTabCond(tab: OrderTab): { conds: string[]; values: string[] } {
  switch (tab) {
    case '전체':
      return { conds: [], values: [] };
    case '취소':
      return { conds: ['od_status = ?'], values: ['취소'] };
    case '부분취소':
      return {
        conds: [
          `od_status IN (${CANCELABLE_STATUSES.map(() => '?').join(', ')}) AND od_cancel_price > 0`,
        ],
        values: [...CANCELABLE_STATUSES],
      };
    default:
      return { conds: ['od_status = ?'], values: [tab] };
  }
}

// 목록 WHERE(base + 탭) — 순수 함수(파라미터 바인딩). counts 는 base 만 쓴다.
export function buildOrderListWhere(params: SearchOrdersParams): {
  sql: string;
  values: (string | number)[];
} {
  const base = buildOrderBaseConds(params);
  const tab = buildOrderTabCond(params.tab);
  const conds = [...base.conds, ...tab.conds];
  const values = [...base.values, ...tab.values];
  return { sql: conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '', values };
}

// 정렬 해석 — sort 지정 시 그 컬럼(+order, 기본 desc). 미지정 시 탭별 기본(코어 orderlist.php:57):
//   입금→od_receipt_time desc · 배송→od_invoice_time desc · 그 외→od_id desc.
// 반환 컬럼/방향은 전부 상수(화이트리스트)라 ORDER BY 에 인라인해도 안전하다.
export function resolveOrderSort(params: SearchOrdersParams): {
  column: string;
  direction: 'asc' | 'desc';
} {
  if (params.sort !== undefined && ORDER_SORT_COLUMNS.has(params.sort)) {
    return { column: params.sort, direction: params.order === 'asc' ? 'asc' : 'desc' };
  }
  if (params.tab === '입금') return { column: 'od_receipt_time', direction: 'desc' };
  if (params.tab === '배송') return { column: 'od_invoice_time', direction: 'desc' };
  return { column: 'od_id', direction: 'desc' };
}

export interface OrderListRow {
  odId: string;
  odName: string;
  mbId: string; // '' = 비회원
  odTel: string;
  odHp: string;
  odBName: string;
  status: string;
  settleCase: string;
  orderPrice: number;
  receiptPrice: number;
  cancelPrice: number;
  couponPrice: number;
  misu: number;
  cartCount: number;
  deliveryCompany: string | null;
  invoiceNo: string | null;
  invoiceTime: string | null;
  receiptTime: string | null;
  odTime: string;
  isMobile: boolean;
  isTest: boolean;
}

export type OrderCounts = Record<OrderTab, number>;

export interface SearchOrdersResult {
  rows: OrderListRow[];
  total: number;
  counts: OrderCounts;
}

// 목록 SELECT 컬럼(화이트리스트) — 계산 컬럼(order_price·coupon_price)은 SQL 에서.
// 날짜는 KST native 문자열 그대로, zero-date 는 NULLIF→null.
const ORDER_LIST_COLUMNS = `od_id, od_name, mb_id, od_tel, od_hp, od_b_name, od_status, od_settle_case,
    (od_cart_price + od_send_cost + od_send_cost2) AS order_price,
    od_receipt_price, od_cancel_price,
    (od_cart_coupon + od_coupon + od_send_coupon) AS coupon_price,
    od_misu, od_cart_count, od_delivery_company, od_invoice,
    DATE_FORMAT(NULLIF(od_invoice_time, '0000-00-00 00:00:00'), '%Y-%m-%d %H:%i:%s') AS invoice_time,
    DATE_FORMAT(NULLIF(od_receipt_time, '0000-00-00 00:00:00'), '%Y-%m-%d %H:%i:%s') AS receipt_time,
    DATE_FORMAT(od_time, '%Y-%m-%d %H:%i:%s') AS od_time,
    od_mobile, od_test`;

// counts — 탭 제외 base 필터만. 배타 SUM(조건부, 상수 SQL). mysql2 는 SUM 을 string 으로
// 줄 수 있어 Number 정규화.
const ORDER_COUNTS_SELECT = `COUNT(*) AS all_count,
    SUM(od_status = '주문') AS s_order,
    SUM(od_status = '입금') AS s_deposit,
    SUM(od_status = '준비') AS s_ready,
    SUM(od_status = '가격확인') AS s_price_check,
    SUM(od_status = '파일검사') AS s_file_check,
    SUM(od_status = 'EQ') AS s_eq,
    SUM(od_status = '생산시작') AS s_prod_start,
    SUM(od_status = '생산중') AS s_producing,
    SUM(od_status = '품질시험') AS s_quality_test,
    SUM(od_status = '생산완료') AS s_prod_done,
    SUM(od_status = 'A/S') AS s_as,
    SUM(od_status = '배송') AS s_ship,
    SUM(od_status = '완료') AS s_done,
    SUM(od_status = '취소') AS s_cancel,
    SUM(od_status IN (${sqlStatusList(ACTIVE_ORDER_STATUSES)}) AND od_cancel_price > 0) AS s_pcancel`;

// '' → null 정규화(빈 문자열 varchar 컬럼). 경계에서 String() 으로 좁힌 뒤 넘긴다.
const emptyToNull = (s: string): string | null => (s === '' ? null : s);

function mapOrderListRow(row: RowDataPacket): OrderListRow {
  return {
    odId: String(row.od_id),
    odName: String(row.od_name ?? ''),
    mbId: String(row.mb_id ?? ''),
    odTel: String(row.od_tel ?? ''),
    odHp: String(row.od_hp ?? ''),
    odBName: String(row.od_b_name ?? ''),
    status: String(row.od_status ?? ''),
    settleCase: String(row.od_settle_case ?? ''),
    orderPrice: Number(row.order_price ?? 0),
    receiptPrice: Number(row.od_receipt_price ?? 0),
    cancelPrice: Number(row.od_cancel_price ?? 0),
    couponPrice: Number(row.coupon_price ?? 0),
    misu: Number(row.od_misu ?? 0),
    cartCount: Number(row.od_cart_count ?? 0),
    deliveryCompany: emptyToNull(String(row.od_delivery_company ?? '')),
    invoiceNo: emptyToNull(String(row.od_invoice ?? '')),
    invoiceTime: row.invoice_time == null ? null : String(row.invoice_time),
    receiptTime: row.receipt_time == null ? null : String(row.receipt_time),
    odTime: String(row.od_time ?? ''),
    // od_mobile·od_test 는 tinyint(0/1) — 코어 if($row['od_mobile']) truthy 재현.
    isMobile: Number(row.od_mobile ?? 0) > 0,
    isTest: Number(row.od_test ?? 0) > 0,
  };
}

export async function searchOrders(params: SearchOrdersParams): Promise<SearchOrdersResult> {
  const pool = getG5Pool();
  const base = buildOrderBaseConds(params);
  const baseWhere = base.conds.length > 0 ? `WHERE ${base.conds.join(' AND ')}` : '';

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ORDER_COUNTS_SELECT} FROM g5_shop_order ${baseWhere}`,
    base.values,
  );
  const cr = countRows[0];
  const counts: OrderCounts = {
    전체: Number(cr?.all_count ?? 0),
    주문: Number(cr?.s_order ?? 0),
    입금: Number(cr?.s_deposit ?? 0),
    준비: Number(cr?.s_ready ?? 0),
    가격확인: Number(cr?.s_price_check ?? 0),
    파일검사: Number(cr?.s_file_check ?? 0),
    EQ: Number(cr?.s_eq ?? 0),
    생산시작: Number(cr?.s_prod_start ?? 0),
    생산중: Number(cr?.s_producing ?? 0),
    품질시험: Number(cr?.s_quality_test ?? 0),
    생산완료: Number(cr?.s_prod_done ?? 0),
    'A/S': Number(cr?.s_as ?? 0),
    배송: Number(cr?.s_ship ?? 0),
    완료: Number(cr?.s_done ?? 0),
    취소: Number(cr?.s_cancel ?? 0),
    부분취소: Number(cr?.s_pcancel ?? 0),
  };
  // total = 선택 탭의 카운트(목록 WHERE 술어와 동일 집합이라 별도 total 쿼리 불필요).
  const total = counts[params.tab];

  const where = buildOrderListWhere(params);
  const { column, direction } = resolveOrderSort(params);
  // od_id 가 아닌 정렬이면 od_id desc 타이브레이크(안정 페이지네이션 — 스톡엔 없던 보정).
  const orderBy = column === 'od_id' ? `od_id ${direction}` : `${column} ${direction}, od_id desc`;
  const offset = (params.page - 1) * params.pageSize;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ORDER_LIST_COLUMNS} FROM g5_shop_order ${where.sql}
      ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...where.values, params.pageSize, offset],
  );

  return { rows: rows.map(mapOrderListRow), total, counts };
}

// 상세 헤더 SELECT 컬럼(화이트리스트) — 민감 컬럼(od_pwd·od_cash·od_cash_info) 절대 제외.
const ORDER_DETAIL_COLUMNS = `od_id, od_name, mb_id, od_email, od_tel, od_hp, od_b_name,
    od_zip1, od_zip2, od_addr1, od_addr2, od_addr3, od_addr_jibeon,
    od_b_tel, od_b_hp, od_b_zip1, od_b_zip2, od_b_addr1, od_b_addr2, od_b_addr3, od_b_addr_jibeon,
    od_deposit_name, od_memo, od_shop_memo,
    od_status, od_settle_case,
    (od_cart_price + od_send_cost + od_send_cost2) AS order_price,
    od_receipt_price, od_cancel_price,
    (od_cart_coupon + od_coupon + od_send_coupon) AS coupon_price,
    od_misu, od_cart_count, od_delivery_company, od_invoice,
    od_send_cost, od_send_cost2, od_send_coupon, od_cart_coupon, od_coupon,
    od_refund_price, od_receipt_point, od_tax_mny, od_vat_mny, od_free_mny,
    od_pg, od_tno, od_app_no, od_ip,
    DATE_FORMAT(NULLIF(od_hope_date, '0000-00-00'), '%Y-%m-%d') AS hope_date,
    DATE_FORMAT(NULLIF(od_invoice_time, '0000-00-00 00:00:00'), '%Y-%m-%d %H:%i:%s') AS invoice_time,
    DATE_FORMAT(NULLIF(od_receipt_time, '0000-00-00 00:00:00'), '%Y-%m-%d %H:%i:%s') AS receipt_time,
    DATE_FORMAT(od_time, '%Y-%m-%d %H:%i:%s') AS od_time,
    od_mobile, od_test`;

export interface OrderDetailRow extends OrderListRow {
  email: string;
  zip1: string;
  zip2: string;
  addr1: string;
  addr2: string;
  addr3: string;
  addrJibeon: string;
  bTel: string;
  bHp: string;
  bZip1: string;
  bZip2: string;
  bAddr1: string;
  bAddr2: string;
  bAddr3: string;
  bAddrJibeon: string;
  depositName: string;
  memo: string;
  shopMemo: string;
  hopeDate: string | null;
  sendCost: number;
  sendCost2: number;
  sendCoupon: number;
  cartCoupon: number;
  coupon: number;
  refundPrice: number;
  receiptPoint: number;
  taxMny: number;
  vatMny: number;
  freeMny: number;
  pg: string;
  tno: string;
  appNo: string;
  ip: string;
}

export async function getOrderRow(odId: string): Promise<OrderDetailRow | null> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT ${ORDER_DETAIL_COLUMNS} FROM g5_shop_order WHERE od_id = ?`,
    [odId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    ...mapOrderListRow(row),
    email: String(row.od_email ?? ''),
    zip1: String(row.od_zip1 ?? ''),
    zip2: String(row.od_zip2 ?? ''),
    addr1: String(row.od_addr1 ?? ''),
    addr2: String(row.od_addr2 ?? ''),
    addr3: String(row.od_addr3 ?? ''),
    addrJibeon: String(row.od_addr_jibeon ?? ''),
    bTel: String(row.od_b_tel ?? ''),
    bHp: String(row.od_b_hp ?? ''),
    bZip1: String(row.od_b_zip1 ?? ''),
    bZip2: String(row.od_b_zip2 ?? ''),
    bAddr1: String(row.od_b_addr1 ?? ''),
    bAddr2: String(row.od_b_addr2 ?? ''),
    bAddr3: String(row.od_b_addr3 ?? ''),
    bAddrJibeon: String(row.od_b_addr_jibeon ?? ''),
    depositName: String(row.od_deposit_name ?? ''),
    memo: String(row.od_memo ?? ''),
    shopMemo: String(row.od_shop_memo ?? ''),
    hopeDate: row.hope_date == null ? null : String(row.hope_date),
    sendCost: Number(row.od_send_cost ?? 0),
    sendCost2: Number(row.od_send_cost2 ?? 0),
    sendCoupon: Number(row.od_send_coupon ?? 0),
    cartCoupon: Number(row.od_cart_coupon ?? 0),
    coupon: Number(row.od_coupon ?? 0),
    refundPrice: Number(row.od_refund_price ?? 0),
    receiptPoint: Number(row.od_receipt_point ?? 0),
    taxMny: Number(row.od_tax_mny ?? 0),
    vatMny: Number(row.od_vat_mny ?? 0),
    freeMny: Number(row.od_free_mny ?? 0),
    pg: String(row.od_pg ?? ''),
    tno: String(row.od_tno ?? ''),
    appNo: String(row.od_app_no ?? ''),
    ip: String(row.od_ip ?? ''),
  };
}

export interface CartRow {
  ctId: number;
  itId: string;
  itName: string;
  ctOption: string;
  ctQty: number;
  ctPrice: number;
  ioId: string;
  ioType: number;
  ioPrice: number;
  ctStatus: string;
  ctSelect: number;
}

// 주문의 카트 라인 — GROUP BY 없이 실물 그대로(ct_id asc, io_type asc).
export async function getCartRowsByOdId(odId: string): Promise<CartRow[]> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT ct_id, it_id, it_name, ct_option, ct_qty, ct_price, io_id, io_type, io_price,
            ct_status, ct_select
       FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id ASC, io_type ASC`,
    [odId],
  );
  return rows.map((row) => ({
    ctId: Number(row.ct_id),
    itId: String(row.it_id ?? ''),
    itName: String(row.it_name ?? ''),
    ctOption: String(row.ct_option ?? ''),
    ctQty: Number(row.ct_qty ?? 0),
    ctPrice: Number(row.ct_price ?? 0),
    ioId: String(row.io_id ?? ''),
    ioType: Number(row.io_type ?? 0),
    ioPrice: Number(row.io_price ?? 0),
    ctStatus: String(row.ct_status ?? ''),
    ctSelect: Number(row.ct_select ?? 0),
  }));
}

// 회원 누적주문수 배치(코어의 N+1 서브쿼리 대체) — GROUP BY mb_id COUNT. 필터 무관 전체.
export async function getMemberOrderCounts(mbIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(mbIds)].filter((id) => id !== '');
  if (ids.length === 0) return map;
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT mb_id, COUNT(*) AS cnt FROM g5_shop_order
      WHERE mb_id IN (${ids.map(() => '?').join(', ')}) GROUP BY mb_id`,
    ids,
  );
  for (const row of rows) {
    map.set(String(row.mb_id), Number(row.cnt ?? 0));
  }
  return map;
}

// ── 엑셀 배송처리 대상 조회 (⑫ 확장 — read-only) ─────────────────────────────
// 레거시 adm/shop_admin/orderdeliveryexcel.php 의 다운로드 대상. od_status='생산완료' AND od_misu=0
// (미수금 없는 배송 직전 주문)만, od_id desc. 엑셀 10열에 필요한 컬럼만(주문자/받는분 연락처·
// 배송지 주소·현재 운송장). 목록 컬럼셋(ORDER_LIST_COLUMNS)엔 받는분 연락처·주소가 없어 전용.
export interface DeliveryExcelRow {
  odId: string;
  odName: string;
  odTel: string;
  odHp: string;
  bName: string;
  bTel: string;
  bHp: string;
  bAddr1: string;
  bAddr2: string;
  bAddr3: string;
  bAddrJibeon: string;
  deliveryCompany: string;
  invoiceNo: string;
}

export async function getDeliveryExcelRows(): Promise<DeliveryExcelRow[]> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT od_id, od_name, od_tel, od_hp, od_b_name, od_b_tel, od_b_hp,
            od_b_addr1, od_b_addr2, od_b_addr3, od_b_addr_jibeon,
            od_delivery_company, od_invoice
       FROM g5_shop_order
      WHERE od_status = '생산완료' AND od_misu = 0
      ORDER BY od_id DESC`,
  );
  return rows.map((r) => ({
    odId: String(r.od_id ?? ''),
    odName: String(r.od_name ?? ''),
    odTel: String(r.od_tel ?? ''),
    odHp: String(r.od_hp ?? ''),
    bName: String(r.od_b_name ?? ''),
    bTel: String(r.od_b_tel ?? ''),
    bHp: String(r.od_b_hp ?? ''),
    bAddr1: String(r.od_b_addr1 ?? ''),
    bAddr2: String(r.od_b_addr2 ?? ''),
    bAddr3: String(r.od_b_addr3 ?? ''),
    bAddrJibeon: String(r.od_b_addr_jibeon ?? ''),
    deliveryCompany: String(r.od_delivery_company ?? ''),
    invoiceNo: String(r.od_invoice ?? ''),
  }));
}

// ── 관리자 주문 상태 전이·선택삭제 (카탈로그 ⑬ — 쓰기) ───────────────────────
// 레거시 adm/shop_admin/orderlistupdate.php(일괄 상태 전이)·orderlistdelete.php(미입금 선택삭제)
// 이식. 메일/SMS 는 여기서 하지 않는다(PHP 브리지 spcb/api/order-notify.php 재사용 — 라우트가 호출).

// 선형 전이 target — 표준 흐름 + 제작 7단계(A/S 제외 — A/S 는 사후 단계라 force-status 전용).
// 체인: 주문→입금→준비→가격확인→파일검사→EQ→생산시작→생산중→품질시험→생산완료→배송→완료.
export type OrderTransitionTarget =
  | '입금'
  | '준비'
  | '가격확인'
  | '파일검사'
  | 'EQ'
  | '생산시작'
  | '생산중'
  | '품질시험'
  | '생산완료'
  | '배송'
  | '완료';

export type OrderActionReason =
  | 'NOT_FOUND'
  | 'NOT_ORDER_STATUS'
  | 'NOT_DEPOSIT_STATUS'
  | 'NOT_READY_STATUS'
  | 'NOT_SHIPPING_STATUS'
  | 'NOT_BANK_TRANSFER'
  | 'MISSING_INVOICE'
  | 'NOT_PREV_STAGE'; // 제작 단계·배송 전이에서 직전 단계가 아님

// od 단위 독립 처리 결과 — 성공(processed)·가드 위반(skipped). 하나 실패해도 나머지 진행.
export interface OrderActionResult {
  processed: string[];
  skipped: { odId: string; reason: OrderActionReason }[];
}

// target(전이 후 상태) → 필요한 현재 상태와 불일치 시 reason. 순수 판정(테스트 대상).
const TRANSITION_REQUIRED_STATUS: Record<
  OrderTransitionTarget,
  { from: string; reason: OrderActionReason }
> = {
  입금: { from: '주문', reason: 'NOT_ORDER_STATUS' },
  준비: { from: '입금', reason: 'NOT_DEPOSIT_STATUS' },
  // 제작 7단계 선형 체인(각 직전 단계에서만) — reason 은 공용 NOT_PREV_STAGE.
  가격확인: { from: '준비', reason: 'NOT_PREV_STAGE' },
  파일검사: { from: '가격확인', reason: 'NOT_PREV_STAGE' },
  EQ: { from: '파일검사', reason: 'NOT_PREV_STAGE' },
  생산시작: { from: 'EQ', reason: 'NOT_PREV_STAGE' },
  생산중: { from: '생산시작', reason: 'NOT_PREV_STAGE' },
  품질시험: { from: '생산중', reason: 'NOT_PREV_STAGE' },
  생산완료: { from: '품질시험', reason: 'NOT_PREV_STAGE' },
  // 배송은 이제 '생산완료' 다음(기존 '준비'에서 이동) — 운송장·재고차감은 여기서.
  배송: { from: '생산완료', reason: 'NOT_PREV_STAGE' },
  완료: { from: '배송', reason: 'NOT_SHIPPING_STATUS' },
};

// 전이 가드 판정(순수). 현재 상태·결제수단으로 진행 여부를 결정한다. 입금 전이는 무통장만 허용
// (코어 orderlistupdate.php:56 — 무통장 외 결제수단은 PG 승인이 입금을 결정하므로 관리자 수동
// 입금 전이 대상이 아니다). 반환 ok=false 면 skipped(reason). 배송의 MISSING_INVOICE 는 여기가
// 아니라 matchDeliveryRows(운송장 필드 유무)가 판정한다.
export function orderTransitionGuard(
  target: OrderTransitionTarget,
  current: string,
  settleCase: string,
): { ok: true } | { ok: false; reason: OrderActionReason } {
  const req = TRANSITION_REQUIRED_STATUS[target];
  if (current !== req.from) return { ok: false, reason: req.reason };
  if (target === '입금' && settleCase !== '무통장') {
    return { ok: false, reason: 'NOT_BANK_TRANSFER' };
  }
  return { ok: true };
}

// 배송 rows 매칭(순수) — 선택 odIds 를 운송장 입력 행과 짝짓는다. 행이 없거나 3필드 중 하나라도
// 비면 MISSING_INVOICE 로 skip. 코어 orderlistupdate.php 는 od_id 별 od_invoice/od_invoice_time/
// od_delivery_company 를 폼에서 받으므로, 선택은 odIds·데이터는 delivery 행이 담당한다.
export interface DeliveryInput {
  odId: string;
  deliveryCompany: string;
  invoiceNo: string;
  invoiceTime: string;
}

export function matchDeliveryRows(
  odIds: string[],
  delivery: DeliveryInput[],
): { rows: DeliveryInput[]; skipped: { odId: string; reason: 'MISSING_INVOICE' }[] } {
  const byId = new Map<string, DeliveryInput>();
  for (const d of delivery) byId.set(d.odId, d);
  const rows: DeliveryInput[] = [];
  const skipped: { odId: string; reason: 'MISSING_INVOICE' }[] = [];
  for (const odId of odIds) {
    const d = byId.get(odId);
    if (
      d === undefined ||
      d.deliveryCompany.trim() === '' ||
      d.invoiceNo.trim() === '' ||
      d.invoiceTime.trim() === ''
    ) {
      skipped.push({ odId, reason: 'MISSING_INVOICE' });
      continue;
    }
    rows.push(d);
  }
  return { rows, skipped };
}

// PHP round() 재현 — "0.5 는 0 에서 먼 쪽으로"(round half away from zero). JS Math.round 는
// 0.5 를 +∞ 쪽으로 올려 음수에서 코어와 갈린다(get_order_info 의 od_tax_mny=round(x/1.1)).
export function phpRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

// 미수금·과세 재계산 순수 산식 — 코어 get_order_info(lib/shop.lib.php:1745-1795) 미러.
// 카트 집계(cartPrice·cartCoupon·taxMny·freeMny)와 주문 저장 컬럼을 입력받아 od_misu·od_tax_mny·
// od_vat_mny·od_free_mny·od_send_cost 를 낸다. **sendCost·odCoupon·odSendCoupon 은 저장값 그대로**
// (상태 전이는 get_sendcost/쿠폰 산식의 상태 WHERE 집합 내부 이동이라 불변 — 헤더 ⑬ 갭 참조).
export interface OrderMoneyInput {
  taxFlag: boolean; // od_tax_flag
  cartPrice: number; // 카트 SUM(주문금액) — get_order_info:1668 price
  cartCoupon: number; // 카트 SUM(cp_price) — od_cart_coupon 과 동치
  taxMny: number; // 카트 SUM 과세대상 — get_order_info:1670
  freeMny: number; // 카트 SUM 비과세대상 — get_order_info:1671
  sendCost: number; // od_send_cost (저장값 재사용)
  sendCost2: number; // od_send_cost2
  odCoupon: number; // od_coupon (저장값 재사용)
  odSendCoupon: number; // od_send_coupon (저장값 재사용)
  receiptPrice: number; // od_receipt_price (입금 전이에서 변함)
  receiptPoint: number; // od_receipt_point
  refundPrice: number; // od_refund_price
}

export interface OrderMoneyResult {
  odMisu: number;
  odTaxMny: number;
  odVatMny: number;
  odFreeMny: number;
  odSendCost: number;
}

export function computeOrderMoney(input: OrderMoneyInput): OrderMoneyResult {
  const { cartPrice, cartCoupon, taxMny, sendCost, sendCost2, odCoupon, odSendCoupon } = input;
  let freeMny = input.freeMny;
  let totTaxMny: number;
  if (input.taxFlag) {
    totTaxMny = taxMny + sendCost + sendCost2 - (odCoupon + odSendCoupon + input.receiptPoint);
    if (totTaxMny < 0) {
      freeMny += totTaxMny;
      totTaxMny = 0;
    }
  } else {
    totTaxMny =
      taxMny + freeMny + sendCost + sendCost2 - (odCoupon + odSendCoupon + input.receiptPoint);
    freeMny = 0;
  }
  const odTaxMny = phpRound(totTaxMny / 1.1);
  const odVatMny = totTaxMny - odTaxMny;
  const odMisu =
    cartPrice +
    sendCost +
    sendCost2 -
    (cartCoupon + odCoupon + odSendCoupon) -
    (input.receiptPrice + input.receiptPoint - input.refundPrice);
  return { odMisu, odTaxMny, odVatMny, odFreeMny: freeMny, odSendCost: sendCost };
}

// 미수금·과세 재계산 후 g5_shop_order UPDATE(코어 orderlistupdate.php:148-158 미러).
// 카트 집계는 get_order_info 의 SUM(:1668-1674)을 그대로 — 상태 WHERE 집합 동일.
async function recomputeOrderMoney(odId: string): Promise<void> {
  const pool = getG5Pool();
  const [orderRows] = await pool.query<RowDataPacket[]>(
    `SELECT od_tax_flag, od_send_cost, od_send_cost2, od_coupon, od_send_coupon,
            od_receipt_price, od_receipt_point, od_refund_price
       FROM g5_shop_order WHERE od_id = ?`,
    [odId],
  );
  const od = orderRows[0];
  if (od === undefined) return;

  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT
        SUM(IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))) AS price,
        SUM(cp_price) AS coupon,
        SUM(IF(ct_notax = 0, (IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty)) - cp_price), 0)) AS tax_mny,
        SUM(IF(ct_notax = 1, (IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty)) - cp_price), 0)) AS free_mny
       FROM g5_shop_cart
      WHERE od_id = ? AND ct_status IN (${sqlStatusList(ACTIVE_ORDER_STATUSES)})`,
    [odId],
  );
  const agg = aggRows[0];

  const money = computeOrderMoney({
    taxFlag: Number(od.od_tax_flag ?? 0) > 0,
    cartPrice: Number(agg?.price ?? 0),
    cartCoupon: Number(agg?.coupon ?? 0),
    taxMny: Number(agg?.tax_mny ?? 0),
    freeMny: Number(agg?.free_mny ?? 0),
    sendCost: Number(od.od_send_cost ?? 0),
    sendCost2: Number(od.od_send_cost2 ?? 0),
    odCoupon: Number(od.od_coupon ?? 0),
    odSendCoupon: Number(od.od_send_coupon ?? 0),
    receiptPrice: Number(od.od_receipt_price ?? 0),
    receiptPoint: Number(od.od_receipt_point ?? 0),
    refundPrice: Number(od.od_refund_price ?? 0),
  });

  await pool.query(
    `UPDATE g5_shop_order
        SET od_misu = ?, od_tax_mny = ?, od_vat_mny = ?, od_free_mny = ?, od_send_cost = ?
      WHERE od_id = ?`,
    [money.odMisu, money.odTaxMny, money.odVatMny, money.odFreeMny, money.odSendCost, odId],
  );
}

// change_status 미러(admin.shop.lib.php:84-93) — od_status·ct_status 를 원자 가드 WHERE 로 전이.
// 반환 = 주문 헤더 UPDATE affectedRows(0 이면 레이스로 현재 상태가 이미 바뀐 것 → 호출부 skip).
async function changeStatus(odId: string, from: string, to: string): Promise<number> {
  const pool = getG5Pool();
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE g5_shop_order SET od_status = ? WHERE od_id = ? AND od_status = ?`,
    [to, odId, from],
  );
  await pool.query(`UPDATE g5_shop_cart SET ct_status = ? WHERE od_id = ? AND ct_status = ?`, [
    to,
    odId,
    from,
  ]);
  return res.affectedRows;
}

// 주문 헤더 1행의 상태·결제수단 조회(전이 가드 판정용). 없으면 null.
async function getOrderStatusRow(
  odId: string,
): Promise<{ status: string; settleCase: string } | null> {
  const [rows] = await getG5Pool().query<RowDataPacket[]>(
    `SELECT od_status, od_settle_case FROM g5_shop_order WHERE od_id = ?`,
    [odId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { status: String(row.od_status ?? ''), settleCase: String(row.od_settle_case ?? '') };
}

// 주문→입금 — change_status + order_update_receipt(od_receipt_price=od_misu·od_misu=0·
// od_receipt_time=NOW WHERE od_status='입금') + 미수금 재계산. 무통장만.
export async function setOrdersReceipt(odIds: string[]): Promise<OrderActionResult> {
  const result: OrderActionResult = { processed: [], skipped: [] };
  for (const odId of [...new Set(odIds)]) {
    const row = await getOrderStatusRow(odId);
    if (row === null) {
      result.skipped.push({ odId, reason: 'NOT_FOUND' });
      continue;
    }
    const guard = orderTransitionGuard('입금', row.status, row.settleCase);
    if (!guard.ok) {
      result.skipped.push({ odId, reason: guard.reason });
      continue;
    }
    const affected = await changeStatus(odId, '주문', '입금');
    if (affected === 0) {
      result.skipped.push({ odId, reason: 'NOT_ORDER_STATUS' }); // 레이스 — 이미 상태 변경됨
      continue;
    }
    await getG5Pool().query(
      `UPDATE g5_shop_order
          SET od_receipt_price = od_misu, od_misu = 0, od_receipt_time = NOW()
        WHERE od_id = ? AND od_status = '입금'`,
      [odId],
    );
    await recomputeOrderMoney(odId);
    result.processed.push(odId);
  }
  return result;
}

// 부수효과 없는 단순 선형 전이(입금→준비, 제작 7단계 간) — guard + changeStatus(직전→target) +
// 미수금 재계산. 부수효과가 있는 전이(입금=수납/배송=운송장·재고/완료=판매통계)는 전용 함수를 쓴다.
// 코어는 이 전이들에서 알림 미발송(라우트가 notify 안 함). 라우트가 준비·제작 7단계만 이 함수로 dispatch.
export async function setOrdersStage(
  odIds: string[],
  target: OrderTransitionTarget,
): Promise<OrderActionResult> {
  const req = TRANSITION_REQUIRED_STATUS[target];
  const result: OrderActionResult = { processed: [], skipped: [] };
  for (const odId of [...new Set(odIds)]) {
    const row = await getOrderStatusRow(odId);
    if (row === null) {
      result.skipped.push({ odId, reason: 'NOT_FOUND' });
      continue;
    }
    const guard = orderTransitionGuard(target, row.status, row.settleCase);
    if (!guard.ok) {
      result.skipped.push({ odId, reason: guard.reason });
      continue;
    }
    const affected = await changeStatus(odId, req.from, target);
    if (affected === 0) {
      result.skipped.push({ odId, reason: req.reason }); // 레이스 — 이미 상태 변경됨
      continue;
    }
    await recomputeOrderMoney(odId);
    result.processed.push(odId);
  }
  return result;
}

// 생산완료→배송 — order_update_delivery(운송장 UPDATE + 카트 재고차감 loop) + change_status + 재계산.
// rows 는 matchDeliveryRows 로 이미 3필드 검증된 것만. 상태 가드는 여기서 재확인(원자 WHERE).
export async function setOrdersDelivery(rows: DeliveryInput[]): Promise<OrderActionResult> {
  const result: OrderActionResult = { processed: [], skipped: [] };
  const pool = getG5Pool();
  for (const d of rows) {
    const row = await getOrderStatusRow(d.odId);
    if (row === null) {
      result.skipped.push({ odId: d.odId, reason: 'NOT_FOUND' });
      continue;
    }
    const guard = orderTransitionGuard('배송', row.status, row.settleCase);
    if (!guard.ok) {
      result.skipped.push({ odId: d.odId, reason: guard.reason });
      continue;
    }
    // order_update_delivery(admin.shop.lib.php:107-135) — 운송장 3필드 UPDATE(원자 가드 생산완료).
    const [upd] = await pool.query<ResultSetHeader>(
      `UPDATE g5_shop_order
          SET od_delivery_company = ?, od_invoice = ?, od_invoice_time = ?
        WHERE od_id = ? AND od_status = '생산완료'`,
      [d.deliveryCompany, d.invoiceNo, d.invoiceTime, d.odId],
    );
    if (upd.affectedRows === 0) {
      result.skipped.push({ odId: d.odId, reason: 'NOT_PREV_STAGE' }); // 레이스
      continue;
    }
    // 재고차감 loop — !ct_stock_use 인 카트 행만. io_id 있으면 per-quote 옵션 행(9999999) 감소,
    // 없으면 상품 재고 감소. 감소 후 ct_stock_use=1(멱등 — 재실행 시 재차감 방지).
    const [cartRows] = await pool.query<RowDataPacket[]>(
      `SELECT ct_id, it_id, ct_qty, io_id, io_type FROM g5_shop_cart
        WHERE od_id = ? AND ct_stock_use = 0`,
      [d.odId],
    );
    for (const c of cartRows) {
      const itId = String(c.it_id ?? '');
      const ioId = String(c.io_id ?? '');
      const ctQty = Number(c.ct_qty ?? 0);
      if (ioId !== '') {
        await pool.query(
          `UPDATE g5_shop_item_option SET io_stock_qty = io_stock_qty - ?
            WHERE it_id = ? AND io_id = ? AND io_type = ?`,
          [ctQty, itId, ioId, Number(c.io_type ?? 0)],
        );
      } else {
        await pool.query(`UPDATE g5_shop_item SET it_stock_qty = it_stock_qty - ? WHERE it_id = ?`, [
          ctQty,
          itId,
        ]);
      }
      await pool.query(`UPDATE g5_shop_cart SET ct_stock_use = 1 WHERE ct_id = ?`, [
        Number(c.ct_id),
      ]);
    }
    await changeStatus(d.odId, '생산완료', '배송');
    await recomputeOrderMoney(d.odId);
    result.processed.push(d.odId);
  }
  return result;
}

// 배송→완료 — change_status + it_sum_qty 갱신(주문의 '완료' 카트 각 it_id 마다 전 주문 통틀어
// SUM(ct_qty) '완료' 를 g5_shop_item.it_sum_qty 에 기록 — 판매 통계) + 재계산.
export async function setOrdersComplete(odIds: string[]): Promise<OrderActionResult> {
  const result: OrderActionResult = { processed: [], skipped: [] };
  const pool = getG5Pool();
  for (const odId of [...new Set(odIds)]) {
    const row = await getOrderStatusRow(odId);
    if (row === null) {
      result.skipped.push({ odId, reason: 'NOT_FOUND' });
      continue;
    }
    const guard = orderTransitionGuard('완료', row.status, row.settleCase);
    if (!guard.ok) {
      result.skipped.push({ odId, reason: guard.reason });
      continue;
    }
    const affected = await changeStatus(odId, '배송', '완료');
    if (affected === 0) {
      result.skipped.push({ odId, reason: 'NOT_SHIPPING_STATUS' });
      continue;
    }
    // it_sum_qty 갱신(orderlistupdate.php:125-133) — 완료 카트의 distinct it_id 별 전 주문 합계.
    const [itemRows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT it_id FROM g5_shop_cart WHERE od_id = ? AND ct_status = '완료'`,
      [odId],
    );
    for (const it of itemRows) {
      const itId = String(it.it_id ?? '');
      await pool.query(
        `UPDATE g5_shop_item SET it_sum_qty =
            (SELECT COALESCE(SUM(ct_qty), 0) FROM g5_shop_cart WHERE it_id = ? AND ct_status = '완료')
          WHERE it_id = ?`,
        [itId, itId],
      );
    }
    await recomputeOrderMoney(odId);
    result.processed.push(odId);
  }
  return result;
}

// 미입금 선택삭제 — ⑪ deleteUnpaidOrder 배치화. od 단위 결과(deleted→processed, paid→
// NOT_ORDER_STATUS, not_found→NOT_FOUND). 백업(serialize)→cart 소프트삭제→order DELETE.
export async function deleteOrders(
  odIds: string[],
  actorMbId: string,
  ip: string,
): Promise<OrderActionResult> {
  const result: OrderActionResult = { processed: [], skipped: [] };
  for (const odId of [...new Set(odIds)]) {
    const outcome = await deleteUnpaidOrder(odId, actorMbId, ip);
    if (outcome === 'deleted') result.processed.push(odId);
    else if (outcome === 'paid') result.skipped.push({ odId, reason: 'NOT_ORDER_STATUS' });
    else result.skipped.push({ odId, reason: 'NOT_FOUND' });
  }
  return result;
}

// ── 관리자 주문 상세 편집 (카탈로그 ⑭ — 쓰기) ───────────────────────────────
// 레거시 adm/shop_admin/orderformupdate.php(주문자/받는분/배송지·관리자메모)·
// orderformreceiptupdate.php(입금 조정)의 컬럼·시맨틱 이식. 화이트리스트 동적 SET(⑨-b
// updateMemberInfo 미러). 가드(미존재 404·receipt 무통장 409)는 라우트가 강제하되, receipt
// UPDATE 는 결제수단을 WHERE 에 넣어 원자화. 코어 orderformupdate.php 는 od_addr_jibeon 을
// POST 값 그대로 저장(패스스루) — 회원 ⑨-b 의 "addr 변경 시 초기화"와 달리 초기화하지 않는다.

export interface OrderInfoFields {
  od_name?: string;
  od_email?: string;
  od_tel?: string;
  od_hp?: string;
  od_zip1?: string;
  od_zip2?: string;
  od_addr1?: string;
  od_addr2?: string;
  od_addr3?: string;
  od_addr_jibeon?: string;
  od_b_name?: string;
  od_b_tel?: string;
  od_b_hp?: string;
  od_b_zip1?: string;
  od_b_zip2?: string;
  od_b_addr1?: string;
  od_b_addr2?: string;
  od_b_addr3?: string;
  od_b_addr_jibeon?: string;
  od_deposit_name?: string;
  od_hope_date?: string;
}

const ORDER_INFO_COLUMNS = [
  'od_name',
  'od_email',
  'od_tel',
  'od_hp',
  'od_zip1',
  'od_zip2',
  'od_addr1',
  'od_addr2',
  'od_addr3',
  'od_addr_jibeon',
  'od_b_name',
  'od_b_tel',
  'od_b_hp',
  'od_b_zip1',
  'od_b_zip2',
  'od_b_addr1',
  'od_b_addr2',
  'od_b_addr3',
  'od_b_addr_jibeon',
  'od_deposit_name',
  'od_hope_date',
] as const;

// 주문자/받는분/배송지 부분 갱신 — 화이트리스트 맵 밖 컬럼은 타입 차원에서 불가. 보낸 필드만
// 동적 SET. affectedRows 는 반환만(멱등 — 동일값 UPDATE 0 가능; 존재 판정은 라우트 사전 조회).
export async function updateOrderInfo(odId: string, fields: OrderInfoFields): Promise<number> {
  const sets: string[] = [];
  const bind: string[] = [];
  for (const col of ORDER_INFO_COLUMNS) {
    const v = fields[col];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      bind.push(v);
    }
  }
  if (sets.length === 0) return 0; // 방어 — 라우트/계약 refine 이 최소 1개 보장
  bind.push(odId);
  const [res] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_shop_order SET ${sets.join(', ')} WHERE od_id = ?`,
    bind,
  );
  return res.affectedRows;
}

// 관리자 메모(od_shop_memo) — 평문, 부수효과 없음(코어 orderformupdate.php else 분기). ''=비움.
export async function updateOrderShopMemo(odId: string, shopMemo: string): Promise<number> {
  const [res] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_shop_order SET od_shop_memo = ? WHERE od_id = ?`,
    [shopMemo, odId],
  );
  return res.affectedRows;
}

// 무통장 입금 수동 조정 — 3필드(입금액·입금일시·입금자명) 원자 가드 UPDATE(WHERE od_settle_case
// ='무통장') 후 미수금 재계산(recomputeOrderMoney 재사용 — od_receipt_price 반영으로 od_misu 산출).
// 코어 orderformreceiptupdate.php 의 광범위 부수효과(배송/에스크로/재고/상태전이/메일)는 스코프 밖.
export async function updateOrderReceipt(
  odId: string,
  receiptPrice: number,
  receiptTime: string,
  depositName: string,
): Promise<number> {
  const [res] = await getG5Pool().query<ResultSetHeader>(
    `UPDATE g5_shop_order
        SET od_receipt_price = ?, od_receipt_time = ?, od_deposit_name = ?
      WHERE od_id = ? AND od_settle_case = '무통장'`,
    [receiptPrice, receiptTime, depositName, odId],
  );
  if (res.affectedRows > 0) await recomputeOrderMoney(odId);
  return res.affectedRows;
}

// ── 카트행 단위 취소/반품/품절 (카탈로그 ⑮ — 쓰기, 무통장 한정) ──────────────
// 레거시 adm/shop_admin/orderformcartupdate.php 이식. 무통장 guard·PG 제외는 라우트가 강제.

export type OrderItemCancelTarget = '취소' | '반품' | '품절';
export type OrderItemSkipReason = 'NOT_IN_ORDER' | 'ALREADY_CANCELLED' | 'HAS_POINT';

const CANCEL_STATUSES = ['취소', '반품', '품절'];
// 카트 라인 금액식(get_order_info 미러) — 상수 SQL 조각(사용자 입력 없음, 컬럼만).
const CART_LINE_VALUE_SQL = `IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))`;

// 카트행 취소 처리 skip 판정(순수) — HAS_POINT(포인트 딸린 행 안전판, PCB 는 ct_point=0 이라 미발생)·
// ALREADY_CANCELLED(이미 취소류). NOT_IN_ORDER(미소속)는 DB 조회 단계라 여기서 다루지 않는다.
// null = 처리 진행. HAS_POINT 를 먼저 — 포인트 원장 미이식이라 그 행은 절대 손대지 않는다.
export function resolveItemCancelSkip(
  currentStatus: string,
  ctPoint: number,
): OrderItemSkipReason | null {
  if (ctPoint > 0) return 'HAS_POINT';
  if (CANCEL_STATUSES.includes(currentStatus)) return 'ALREADY_CANCELLED';
  return null;
}

// 재고 가감(add/subtract_io_stock 미러, admin.shop.lib.php:44-80) — io_id 있으면 옵션행, 없으면
// 상품행. delta>0 복원(add)·delta<0 차감(subtract). ⑮ 취소 복원(+)·⑯ 임의 전이 배송 차감(-)/복원(+).
async function adjustStock(
  itId: string,
  ioId: string,
  ioType: number,
  delta: number,
): Promise<void> {
  const pool = getG5Pool();
  if (ioId !== '') {
    await pool.query(
      `UPDATE g5_shop_item_option SET io_stock_qty = io_stock_qty + ?
        WHERE it_id = ? AND io_id = ? AND io_type = ?`,
      [delta, itId, ioId, ioType],
    );
  } else {
    await pool.query(`UPDATE g5_shop_item SET it_stock_qty = it_stock_qty + ? WHERE it_id = ?`, [
      delta,
      itId,
    ]);
  }
}

// 취소/반품/품절 후 미수금·취소금액 재계산(orderformcartupdate.php:344-359). WP3 recomputeOrderMoney
// 와 별개 함수(전이 경로 회귀 방지) — 활성/취소류 카트 집계로 재계산, send_cost·쿠폰은 저장값 재사용.
async function recomputeOrderMoneyOnItemChange(odId: string): Promise<void> {
  const pool = getG5Pool();
  const [orderRows] = await pool.query<RowDataPacket[]>(
    `SELECT od_tax_flag, od_send_cost, od_send_cost2, od_coupon, od_send_coupon,
            od_receipt_price, od_receipt_point, od_refund_price
       FROM g5_shop_order WHERE od_id = ?`,
    [odId],
  );
  const od = orderRows[0];
  if (od === undefined) return;

  // 활성(주문~완료) 집계 + 취소류 집계 — get_order_info(:1668-1674, :1767-1772) 미러(한 쿼리 조건합).
  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT
        SUM(IF(ct_status IN (${sqlStatusList(ACTIVE_ORDER_STATUSES)}), ${CART_LINE_VALUE_SQL}, 0)) AS active_price,
        SUM(IF(ct_status IN (${sqlStatusList(ACTIVE_ORDER_STATUSES)}), cp_price, 0)) AS active_coupon,
        SUM(IF(ct_status IN (${sqlStatusList(ACTIVE_ORDER_STATUSES)}) AND ct_notax = 0, ${CART_LINE_VALUE_SQL} - cp_price, 0)) AS tax_mny,
        SUM(IF(ct_status IN (${sqlStatusList(ACTIVE_ORDER_STATUSES)}) AND ct_notax = 1, ${CART_LINE_VALUE_SQL} - cp_price, 0)) AS free_mny,
        SUM(IF(ct_status IN ('취소','반품','품절'), ${CART_LINE_VALUE_SQL}, 0)) AS cancel_price
       FROM g5_shop_cart WHERE od_id = ?`,
    [odId],
  );
  const agg = aggRows[0];
  const cartPrice = Number(agg?.active_price ?? 0);
  const cancelPrice = Number(agg?.cancel_price ?? 0);
  const cartCoupon = Number(agg?.active_coupon ?? 0);

  const money = computeOrderMoney({
    taxFlag: Number(od.od_tax_flag ?? 0) > 0,
    cartPrice,
    cartCoupon,
    taxMny: Number(agg?.tax_mny ?? 0),
    freeMny: Number(agg?.free_mny ?? 0),
    sendCost: Number(od.od_send_cost ?? 0),
    sendCost2: Number(od.od_send_cost2 ?? 0),
    odCoupon: Number(od.od_coupon ?? 0),
    odSendCoupon: Number(od.od_send_coupon ?? 0),
    receiptPrice: Number(od.od_receipt_price ?? 0),
    receiptPoint: Number(od.od_receipt_point ?? 0),
    refundPrice: Number(od.od_refund_price ?? 0),
  });

  // od_cart_price = 활성+취소류(get_order_info:1780). od_cart_coupon = 활성 cp 합. od_coupon/
  // od_send_coupon 은 저장값 재사용이라 미기재(불변). od_send_cost 도 저장값(computeOrderMoney passthrough).
  await pool.query(
    `UPDATE g5_shop_order
        SET od_cart_price = ?, od_cart_coupon = ?, od_cancel_price = ?, od_send_cost = ?,
            od_misu = ?, od_tax_mny = ?, od_vat_mny = ?, od_free_mny = ?
      WHERE od_id = ?`,
    [
      cartPrice + cancelPrice,
      cartCoupon,
      cancelPrice,
      money.odSendCost,
      money.odMisu,
      money.odTaxMny,
      money.odVatMny,
      money.odFreeMny,
      odId,
    ],
  );
}

export interface OrderItemActionResult {
  processed: number[];
  skipped: { ctId: number; reason: OrderItemSkipReason }[];
  odStatus: string;
  orderCancelled: boolean;
}

// 카트행 취소/반품/품절 배치 — ct 단위 독립. 재고 복원·ct_history·전량취소 헤더 전환·금액 재계산.
export async function setOrderItemsStatus(
  odId: string,
  ctIds: number[],
  target: OrderItemCancelTarget,
  actorMbId: string,
  ip: string,
): Promise<OrderItemActionResult> {
  const pool = getG5Pool();
  const processed: number[] = [];
  const skipped: { ctId: number; reason: OrderItemSkipReason }[] = [];
  const affectedItemIds = new Set<string>();
  const now = kstDateTimeStr(new Date());

  for (const ctId of [...new Set(ctIds)]) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT it_id, io_id, io_type, ct_qty, ct_status, ct_stock_use, ct_point
         FROM g5_shop_cart WHERE od_id = ? AND ct_id = ?`,
      [odId, ctId],
    );
    const ct = rows[0];
    if (ct === undefined) {
      skipped.push({ ctId, reason: 'NOT_IN_ORDER' });
      continue;
    }
    const currentStatus = String(ct.ct_status ?? '');
    const skip = resolveItemCancelSkip(currentStatus, Number(ct.ct_point ?? 0));
    if (skip !== null) {
      skipped.push({ ctId, reason: skip });
      continue;
    }

    // claim-first — 원자 가드(WHERE ct_status=현재) 성공 후에만 재고 복원(레이스 이중복원 방지).
    const history = `\n${target}|${actorMbId}|${now}|${ip}`;
    const [upd] = await pool.query<ResultSetHeader>(
      `UPDATE g5_shop_cart
          SET ct_point_use = 0, ct_stock_use = 0, ct_status = ?, ct_history = CONCAT(ct_history, ?)
        WHERE od_id = ? AND ct_id = ? AND ct_status = ?`,
      [target, history, odId, ctId, currentStatus],
    );
    if (upd.affectedRows === 0) {
      skipped.push({ ctId, reason: 'ALREADY_CANCELLED' }); // 레이스 — 이미 상태 변경됨
      continue;
    }

    // 배송 후 차감된 행만 재고 복원(주문/입금/준비 행은 ct_stock_use=0 → 복원 없음). delta=+ct_qty.
    if (Number(ct.ct_stock_use ?? 0) > 0) {
      await adjustStock(
        String(ct.it_id ?? ''),
        String(ct.io_id ?? ''),
        Number(ct.io_type ?? 0),
        Number(ct.ct_qty ?? 0),
      );
    }
    processed.push(ctId);
    affectedItemIds.add(String(ct.it_id ?? ''));
  }

  let orderCancelled = false;
  if (processed.length > 0) {
    // it_sum_qty 재계산(orderformcartupdate.php:160-171) — 영향 it_id 별 '완료' SUM.
    for (const itId of affectedItemIds) {
      await pool.query(
        `UPDATE g5_shop_item SET it_sum_qty =
            (SELECT COALESCE(SUM(ct_qty), 0) FROM g5_shop_cart WHERE it_id = ? AND ct_status = '완료')
          WHERE it_id = ?`,
        [itId, itId],
      );
    }

    await recomputeOrderMoneyOnItemChange(odId);

    // 전량 취소류면 od_status='취소' + od_mod_history append(orderformcartupdate.php:173-183,339,360-365).
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(ct_status IN ('취소','반품','품절')) AS cancelled
         FROM g5_shop_cart WHERE od_id = ?`,
      [odId],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const cancelled = Number(countRows[0]?.cancelled ?? 0);
    if (total > 0 && total === cancelled) {
      orderCancelled = true;
      const modHistory = `${now} ${actorMbId} 주문${target} 처리\n`;
      await pool.query(
        `UPDATE g5_shop_order SET od_status = '취소', od_mod_history = CONCAT(od_mod_history, ?)
          WHERE od_id = ?`,
        [modHistory, odId],
      );
    }
  }

  const [statusRows] = await pool.query<RowDataPacket[]>(
    `SELECT od_status FROM g5_shop_order WHERE od_id = ?`,
    [odId],
  );
  const odStatus = String(statusRows[0]?.od_status ?? '');
  return { processed, skipped, odStatus, orderCancelled: orderCancelled || odStatus === '취소' };
}

// ── 주문 임의 상태 변경 (카탈로그 ⑯ — 쓰기) ──────────────────────────────────
// 레거시 adm/shop_admin/orderformcartupdate.php 의 **정상 상태 분기** 이식(WP6 취소류의 짝). 드로어에서
// 주문 상태를 임의 값(역방향 포함)으로 점프 — 활성 카트행 ct_status=target + od_status=target 동기.
// 스톡 실동작이 유일한 앵커(코어 정상 분기가 하는 것만): 결제수단 가드 없음·운송장 요구 없음·
// od_mod_history append 없음(mod_history 는 취소 블록·수량변경에서만 채워짐 — 정상 전이는 '').

export type OrderForceStatusTarget =
  | '주문'
  | '입금'
  | '준비'
  | '가격확인'
  | '파일검사'
  | 'EQ'
  | '생산시작'
  | '생산중'
  | '품질시험'
  | '생산완료'
  | 'A/S'
  | '배송'
  | '완료';
export type ForceStockAction = 'subtract' | 'restore' | 'none';

// force-status 스톡 판정(순수, orderformcartupdate.php:78-129 정상 분기 미러). 배송/완료 진입 시
// 미차감 행 차감(-qty), 주문 역방향 시 차감된 행 복원(+qty), 그 외(입금/준비·이미 상태 부합)는 변화 없음.
export function resolveForceStatusStock(
  target: OrderForceStatusTarget,
  stockUsed: boolean,
): { newStockUse: 0 | 1; action: ForceStockAction } {
  if ((target === '배송' || target === '완료') && !stockUsed) {
    return { newStockUse: 1, action: 'subtract' };
  }
  if (target === '주문' && stockUsed) {
    return { newStockUse: 0, action: 'restore' };
  }
  return { newStockUse: stockUsed ? 1 : 0, action: 'none' };
}

export interface ForceStatusDelivery {
  deliveryCompany: string;
  invoiceNo: string;
  invoiceTime: string;
}

export type ForceStatusOutcome = 'ok' | 'HAS_POINT';

// force-status 대상 라인 상태 집합 — 쇼핑/삭제만 제외(취소류 포함). 취소류 행에 정상 상태를 걸면
// 코어 정상 분기가 **un-cancel**(행 복귀) 역할을 한다(관리자가 취소 행 체크 + '주문' 선택). 취소류를
// 빼면 전량취소 주문에 force-status 시 od_status 만 바뀌고 카트행은 취소로 남는 불일치가 생긴다.
const FORCE_STATUS_LINE_IN = `ct_status IN (${sqlStatusList([...ACTIVE_ORDER_STATUSES, '취소', '반품', '품절'])})`;

// 주문 라인(쇼핑/삭제 제외)을 target 으로 일괄 전이 + od_status=target. HAS_POINT(포인트 딸린 행)면
// 전체 거부(PCB ct_point=0 이라 미발생 — 구주문 유입 안전판, PHP 관리자 위임). 미존재 404 는 라우트가 처리.
export async function setOrderForceStatus(
  odId: string,
  target: OrderForceStatusTarget,
  delivery: ForceStatusDelivery | undefined,
  actorMbId: string,
  ip: string,
): Promise<ForceStatusOutcome> {
  const pool = getG5Pool();

  const [ptRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM g5_shop_cart WHERE od_id = ? AND ${FORCE_STATUS_LINE_IN} AND ct_point > 0`,
    [odId],
  );
  if (Number(ptRows[0]?.n ?? 0) > 0) return 'HAS_POINT';

  const [lines] = await pool.query<RowDataPacket[]>(
    `SELECT ct_id, it_id, io_id, io_type, ct_qty, ct_status, ct_stock_use
       FROM g5_shop_cart WHERE od_id = ? AND ${FORCE_STATUS_LINE_IN}`,
    [odId],
  );
  const now = kstDateTimeStr(new Date());
  const affectedItemIds = new Set<string>();

  for (const ct of lines) {
    const currentStatus = String(ct.ct_status ?? '');
    const ctQty = Number(ct.ct_qty ?? 0);
    const { newStockUse, action } = resolveForceStatusStock(
      target,
      Number(ct.ct_stock_use ?? 0) > 0,
    );
    // claim-first — 원자 가드(WHERE ct_status=현재) 성공 후에만 재고 가감(레이스 이중반영 방지).
    const history = `\n${target}|${actorMbId}|${now}|${ip}`;
    const [upd] = await pool.query<ResultSetHeader>(
      `UPDATE g5_shop_cart
          SET ct_point_use = 0, ct_stock_use = ?, ct_status = ?, ct_history = CONCAT(ct_history, ?)
        WHERE od_id = ? AND ct_id = ? AND ct_status = ?`,
      [newStockUse, target, history, odId, Number(ct.ct_id), currentStatus],
    );
    if (upd.affectedRows === 0) continue; // 레이스 — 건너뜀
    if (action !== 'none') {
      const delta = action === 'subtract' ? -ctQty : ctQty;
      await adjustStock(String(ct.it_id ?? ''), String(ct.io_id ?? ''), Number(ct.io_type ?? 0), delta);
    }
    affectedItemIds.add(String(ct.it_id ?? ''));
  }

  // it_sum_qty 재계산 — 코어 조건(target ∈ 주문/취소/반품/품절/완료)의 정상 부분집합 {주문,완료}만
  // (코어가 입금/준비/배송 target 에선 재계산 안 함 — 미러, 스톡이 안 하는 부수효과 미창작).
  if (target === '주문' || target === '완료') {
    for (const itId of affectedItemIds) {
      await pool.query(
        `UPDATE g5_shop_item SET it_sum_qty =
            (SELECT COALESCE(SUM(ct_qty), 0) FROM g5_shop_cart WHERE it_id = ? AND ct_status = '완료')
          WHERE it_id = ?`,
        [itId, itId],
      );
    }
  }

  await recomputeOrderMoneyOnItemChange(odId);

  // target='배송' + delivery 제공 시에만 운송장 반영(계약 필드 존중 — 코어 정상 분기엔 없는 확장).
  if (target === '배송' && delivery !== undefined) {
    await pool.query(
      `UPDATE g5_shop_order SET od_delivery_company = ?, od_invoice = ?, od_invoice_time = ?
        WHERE od_id = ?`,
      [delivery.deliveryCompany, delivery.invoiceNo, delivery.invoiceTime, odId],
    );
  }

  // od_status = target(orderformcartupdate.php:367-369). 정상 분기라 od_mod_history append 없음.
  await pool.query(`UPDATE g5_shop_order SET od_status = ? WHERE od_id = ?`, [target, odId]);

  return 'ok';
}

export async function closeG5Pool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
