<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가

unset($list);

$ttotal_price = 0;
$ttotal_point = 0;

//==============================================================================
// 메일보내기
//------------------------------------------------------------------------------
// Loop 배열 자료를 만들고
// sp 커스텀: 이 루프는 일반 상품 전용 — 거버 견적 템플릿은 뒤의 건별 루프에서
// group by 없이 따로 구성한다(주문서 orderform.sub.php 와 동일한 이원 렌더).
// 상세: extend/sp_quote_cart.extend.php ③
$sp_quote_in = function_exists('sp_quote_it_ids_in') ? sp_quote_it_ids_in() : "''";
$sql = " select a.it_id,
                a.it_name,
                a.ct_qty,
                a.ct_price,
                a.ct_point,
                b.it_sell_email,
                b.it_origin
           from {$g5['g5_shop_cart_table']} a left join {$g5['g5_shop_item_table']} b on ( a.it_id = b.it_id )
          where a.od_id = '$od_id'
            and a.ct_select = '1'
            and a.it_id not in ($sp_quote_in)
          group by a.it_id
          order by a.ct_id asc ";
$result = sql_query($sql);
for ($i=0; $row=sql_fetch_array($result); $i++)
{
    // 합계금액 계산
    $sql = " select SUM(IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))) as price,
                    SUM(ct_point * ct_qty) as point,
                    SUM(ct_qty) as qty
                from {$g5['g5_shop_cart_table']}
                where it_id = '{$row['it_id']}'
                  and od_id = '$od_id'
                  and ct_select = '1' ";
    $sum = sql_fetch($sql);

    // 옵션정보
    $sql2 = " select ct_option, ct_qty, io_price
                from {$g5['g5_shop_cart_table']}
                where it_id = '{$row['it_id']}' and od_id = '$od_id' and ct_select = '1'
                order by io_type asc, ct_id asc ";
    $result2 = sql_query($sql2);

    $options = '';
    $options_ul = ' style="margin:0;padding:0"'; // ul style
    $options_li = ' style="padding:5px 0;list-style:none"'; // li style
    for($k=0; $row2=sql_fetch_array($result2); $k++) {
        if($k == 0)
            $options .= '<ul'.$options_ul.'>'.PHP_EOL;
        $price_plus = '';
        if($row2['io_price'] >= 0)
            $price_plus = '+';
        $options .= '<li'.$options_li.'>'.$row2['ct_option'].' ('.$price_plus.display_price($row2['io_price']).') '.$row2['ct_qty'].'개</li>'.PHP_EOL;
    }

    if($k > 0)
        $options .= '</ul>';

    $list[$i]['g_dir']         = G5_URL;
    $list[$i]['it_id']         = $row['it_id'];
    $list[$i]['it_simg']       = get_it_image($row['it_id'], 70, 70);
    $list[$i]['it_name']       = $row['it_name'];
    $list[$i]['it_origin']     = $row['it_origin'];
    $list[$i]['it_opt']        = $options;
    $list[$i]['ct_price']      = $row['ct_price'];
    $list[$i]['stotal_price']  = $sum['price'];
    $list[$i]['stotal_point']  = $sum['point'];

    $ttotal_price  += $list[$i]['stotal_price'];
    $ttotal_point  += $list[$i]['stotal_point'];
}

// sp 커스텀: 거버 견적 행 — 코어 group by(it_id) 를 풀어 건별(ct_id) 행으로.
// 견적은 템플릿 상품 4종의 it_id 를 공유하므로 집계하면 서로 다른 견적이 한
// 상품으로 묶이고 판매가(ct_price=0)도 0원으로 나간다. 주문서(orderform.sub.php)의
// 견적 루프와 동일 공식. 행 인덱스 $i 는 위 루프에서 이어간다.
// 상세: extend/sp_quote_cart.extend.php ③
if (function_exists('sp_quote_it_ids_in')) {
    $sqlq = " select a.ct_id,
                     a.it_id,
                     a.it_name,
                     a.ct_price,
                     a.ct_point,
                     a.ct_qty,
                     a.io_type,
                     a.io_price,
                     a.ct_option,
                     b.it_origin
                from {$g5['g5_shop_cart_table']} a left join {$g5['g5_shop_item_table']} b on ( a.it_id = b.it_id )
               where a.od_id = '$od_id'
                 and a.ct_select = '1'
                 and a.it_id in (".sp_quote_it_ids_in().")
               order by a.ct_id ";
    $resultq = sql_query($sqlq);

    for (; $row=sql_fetch_array($resultq); $i++)
    {
        // 행 금액 — 견적은 ct_price=0·ct_qty=1, 총액은 io_price (주문서 견적 루프와 동일 공식)
        if ($row['io_type'])
            $srow_price = $row['io_price'] * $row['ct_qty'];
        else
            $srow_price = ($row['ct_price'] + $row['io_price']) * $row['ct_qty'];
        $srow_point = $row['ct_point'] * $row['ct_qty'];

        // 옵션 — 해당 견적 행의 ct_option 하나만, 메일 기존 <ul><li> 스타일 유지
        $options = '<ul style="margin:0;padding:0"><li style="padding:5px 0;list-style:none">'.get_text($row['ct_option']).'</li></ul>';

        $list[$i]['g_dir']         = G5_URL;
        $list[$i]['it_id']         = $row['it_id'];
        $list[$i]['it_simg']       = get_it_image($row['it_id'], 70, 70);
        $list[$i]['it_name']       = $row['it_name'];
        $list[$i]['it_origin']     = $row['it_origin'];
        $list[$i]['it_opt']        = $options;
        $list[$i]['ct_price']      = $srow_price; // 견적 ct_price=0 → 행 총액으로 교정(주문서와 동일)
        $list[$i]['stotal_price']  = $srow_price;
        $list[$i]['stotal_point']  = $srow_point;

        $ttotal_price  += $list[$i]['stotal_price'];
        $ttotal_point  += $list[$i]['stotal_point'];
    }
}
//------------------------------------------------------------------------------

// 배송비가 있다면 총계에 더한다
if ($od_send_cost)
    $ttotal_price += $od_send_cost;

// 추가배송비가 있다면 총계에 더한다
if ($od_send_cost2)
    $ttotal_price += $od_send_cost2;