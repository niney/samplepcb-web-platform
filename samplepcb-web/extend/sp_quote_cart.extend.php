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
