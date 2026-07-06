<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

if (!defined('G5_USE_SHOP') || !G5_USE_SHOP) return;

/*
 * sp 견적 장바구니 보정 — 코어 "선택(ct_select) 최소 단위 = it_id" 불변식 깨짐 대응.
 *
 * 거버 견적 행은 템플릿 상품 4종의 it_id 를 공유한 채 ct_id 단위로 선택된다
 * (sp-node selectCartRows, 테마 sp-lite/shop/cart.php). 코어는 선택이 it_id 단위
 * (cartupdate.php act=buy)라는 전제로 짜여 있어 두 군데가 어긋난다:
 *
 * ① 주문서(orderform.sub.php)의 옵션 나열 — 원본 print_item_options() 는 ct_select
 *    를 안 보므로 같은 템플릿의 미선택 견적까지 나열된다. 원본은 cart.php(진입 시
 *    ct_select 전체 0 초기화)와 공유 함수라 필터를 넣을 수 없어, 주문서 전용 대체
 *    함수를 여기 둔다. 호출부 교체는 orderform.sub.php 의 sp 커스텀 2곳 중 하나.
 *
 * ② 혼합 카트(일반 상품+견적) 주문 — 테마 cart.php 가 코어 폼(cartupdate)으로
 *    주문하면 it_id 단위 UPDATE 라 같은 템플릿의 미체크 견적까지 ct_select=1 이
 *    된다. 테마 JS 가 미체크 견적 ct_id 를 쿠키(sp_cart_deselect)에 실어 보내면,
 *    orderform.php 진입 시(extend 는 _common.php 말미 로드 → 본문보다 먼저 실행)
 *    세션 카트(od_id) 소유 행에 한해 ct_select=0 으로 되돌린다.
 *
 * ③ 견적 템플릿 it_id 목록 — 장바구니(테마 cart.php)와 주문서(pc·mobile
 *    orderform.sub.php)가 같은 목록으로 "일반 상품 = it_id 집계 / 견적 = 건별
 *    (ct_id) 행" 이원 렌더를 하도록 여기서 공유한다.
 */

// ③ 거버 견적 템플릿 상품 it_id — sp-node g5-db.ts TEMPLATE_ITEMS 와 동일하게 유지.
function sp_quote_it_ids()
{
    return array('sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex');
}

// ③ SQL IN 절용 목록 — "'sp-pcb-std','sp-mask',..."
function sp_quote_it_ids_in()
{
    return implode(',', array_map(function ($x) {
        return "'" . sql_real_escape_string($x) . "'";
    }, sp_quote_it_ids()));
}

// ④ 견적 행 거버 썸네일 서명 URL — sp-node lib/thumb-url.ts signedThumbUrl() 의 PHP 미러.
//    시크릿(SPCB_JWT_SECRET = node JWT_SECRET) 공유라 서명을 PHP 가 직접 발급하고,
//    바이트 서빙은 node(/api/pcb-thumbs)가 전담한다(파일서버·pathToken 경계 불변).
//    주문서(pc·mobile orderform.sub.php) 견적 행이 견적관리·장바구니와 같은 그림을
//    첫 페인트부터 서버 렌더로 보이게 한다(클라 img.src 교체 없이).
//    폴백(썸네일 없음·시크릿 미배치)은 '' 반환 → 호출부가 템플릿 상품 이미지로 대체.
function sp_quote_thumb_url($ct_id)
{
    $ct_id = (int) $ct_id;
    if ($ct_id <= 0) return '';

    // ct_id → sp_order_spec → sp_file(thumbnail). node /cart-items 와 동일하게
    // id 오름차순 첫 건(= 같은 그림)을 고른다. sp_* 는 g5 와 동거 DB.
    // ⚠ sp_order_spec 은 prisma @map 없음 → 실물 컬럼이 camelCase `ctId`
    //    (sp_file 만 snake_case ref_type/ref_id/file_type). snake_case 로 되돌리지 말 것.
    $row = sql_fetch(" select f.id
                         from sp_order_spec s
                         join sp_file f
                           on f.ref_type  = 'sp_order_spec'
                          and f.ref_id    = s.id
                          and f.file_type = 'thumbnail'
                        where s.`ctId` = '$ct_id'
                        order by f.id asc
                        limit 1 ");
    if (empty($row['id'])) return '';

    // secret.php 는 gitignore 대상 — 미배치 환경에서 require 가 Fatal(주문서 전체 다운)
    // 나지 않게 존재 확인 후에만 로드해 폴백이 실제로 작동하도록 한다.
    if (!defined('SPCB_JWT_SECRET')) {
        $jwt_lib     = G5_PATH . '/spcb/lib/jwt.php';
        $secret_file = G5_PATH . '/spcb/lib/secret.php';
        if (!is_file($jwt_lib) || !is_file($secret_file)) return '';
        require_once $jwt_lib; // SPCB_JWT_SECRET + spcb_base64url_encode()
    }
    if (!defined('SPCB_JWT_SECRET') || !function_exists('spcb_base64url_encode')) return '';

    $file_id = (string) $row['id'];
    $exp = time() + 15 * 60; // node THUMB_TTL_SECONDS 와 동일
    $sig = spcb_base64url_encode(
        hash_hmac('sha256', "thumb:{$file_id}:{$exp}", SPCB_JWT_SECRET, true)
    );
    return "/api/pcb-thumbs/{$file_id}?exp={$exp}&sig={$sig}";
}

// ⑤ 헤더 유틸 뱃지 카운트 — 테마 inc/header.php 의 장바구니·견적관리 아이콘 뱃지.
//
// 장바구니: 코어 get_boxcart_datas_count() 는 전 행을 it_id 로 묶어, 같은 템플릿
//   it_id 를 공유하는 견적 여러 건을 1 로 접는다(테마 cart.php 는 견적을 ct_id
//   건별 카드로 렌더) → 뱃지가 실제 카트 건수보다 적게 나온다. 여기서 일반 상품은
//   distinct it_id, 견적 템플릿 행은 ct_id 건별로 세어 cart.php 표시 건수와 일치시킨다.
function sp_cart_badge_count()
{
    global $g5;

    $cart_id = get_session('ss_cart_id');
    if (!$cart_id) return 0;
    $cart_id = sql_real_escape_string($cart_id);
    $in = sp_quote_it_ids_in();

    // 일반 상품 = distinct it_id(코어·cart.php 집계와 동일) + 견적 템플릿 = 건별(ct_id)
    $row = sql_fetch(" select
                (select count(distinct it_id) from {$g5['g5_shop_cart_table']}
                  where od_id = '$cart_id' and it_id not in ($in)) +
                (select count(*) from {$g5['g5_shop_cart_table']}
                  where od_id = '$cart_id' and it_id in ($in)) as cnt ");

    return $row ? (int) $row['cnt'] : 0;
}

// ⑤ 견적관리 뱃지 — 순수 견적(장바구니 미담김·미주문·미삭제) 건수.
//   GET /api/pcb-projects?status=active 의 visible(ctId IS NULL) 필터와 동일 결과.
//   sp_order_spec 은 prisma @map 없음 → 실물 컬럼 camelCase(`mbId`·`ctId`·status),
//   sp_* 는 g5 동거 DB. 헤더는 전 페이지에서 렌더되므로, sp-node 미배치(테이블
//   부재) 환경에서도 사이트가 죽지 않게 sql_fetch 2번째 인자 false 로 비치명 처리.
function sp_quote_badge_count()
{
    global $member;

    $mb_id = isset($member['mb_id']) ? trim($member['mb_id']) : '';
    if ($mb_id === '') return 0;
    $mb_id = sql_real_escape_string($mb_id);

    $row = sql_fetch(" select count(*) as cnt
                         from sp_order_spec
                        where `mbId` = '$mb_id'
                          and status = 'active'
                          and `ctId` is null ", false);

    return $row ? (int) $row['cnt'] : 0;
}

// ① 주문서용 옵션 나열 — 선택행(ct_select=1)만. lib/shop.lib.php print_item_options 복제+필터.
function sp_print_item_options_selected($it_id, $cart_id)
{
    global $g5;

    $sql = " select ct_option, ct_qty, io_price
                from {$g5['g5_shop_cart_table']}
                where it_id = '$it_id'
                  and od_id = '$cart_id'
                  and ct_select = '1'
                order by io_type asc, ct_id asc ";
    $result = sql_query($sql);

    $str = '';
    for($i=0; $row=sql_fetch_array($result); $i++) {
        if($i == 0)
            $str .= '<ul>'.PHP_EOL;
        $price_plus = '';
        if($row['io_price'] >= 0)
            $price_plus = '+';
        $str .= '<li>'.get_text($row['ct_option']).' '.$row['ct_qty'].'개 ('.$price_plus.display_price($row['io_price']).')</li>'.PHP_EOL;
    }

    if($i > 0)
        $str .= '</ul>';

    return $str;
}

// ② 혼합 카트 주문 보정 — orderform 진입 시 쿠키의 미체크 견적 ct_id 선택 해제(1회용).
function sp_cart_deselect_from_cookie()
{
    global $g5;

    if (!isset($_COOKIE['sp_cart_deselect'])) return;
    if (!isset($_SERVER['SCRIPT_NAME']) || basename($_SERVER['SCRIPT_NAME']) !== 'orderform.php') return;
    if (!empty($_REQUEST['sw_direct'])) return; // 바로구매 카트(ss_cart_direct)엔 견적 행이 없다

    $raw = (string) $_COOKIE['sp_cart_deselect'];
    setcookie('sp_cart_deselect', '', time() - 3600, '/'); // 적용 여부와 무관하게 즉시 만료

    $od_id = get_session('ss_cart_id');
    if (!$od_id || $raw === '') return;

    // 값 형식: ct_id 를 '-' 로 이은 목록 (테마 cart.php setDeselectCookie)
    $ct_ids = array();
    foreach (explode('-', $raw) as $tok) {
        if (preg_match('/^\d+$/', $tok)) $ct_ids[] = (int) $tok;
    }
    if (!count($ct_ids)) return;

    // 세션 카트 소유 행에 한정 — 쿠키를 위조해도 제 카트의 선택만 풀 수 있다
    $od_id = preg_replace('/[^a-z0-9_\-]/i', '', $od_id);
    sql_query(" update {$g5['g5_shop_cart_table']}
                   set ct_select = '0',
                       ct_select_time = '0000-00-00 00:00:00'
                 where od_id = '$od_id'
                   and ct_id in (".implode(',', $ct_ids).") ");
}
sp_cart_deselect_from_cookie();
