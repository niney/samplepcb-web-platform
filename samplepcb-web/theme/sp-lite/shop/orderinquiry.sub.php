<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가
if (!defined("_ORDERINQUIRY_")) exit; // 개별 페이지 접근 불가

// sp-lite 주문내역 목록 (전 기기 pc 파일 사용 · 반응형: 넓은 화면 표 / 좁은 화면 카드)
// 코어 shop/orderinquiry.sub.php 의 테마 위임 훅으로 이 파일이 대체 include 됨.
?>

<!-- 주문 내역 목록 (sp-lite) 시작 { -->
<?php if (isset($total_count)) { ?>
<p class="sod_v_count">총 <strong><?php echo number_format($total_count); ?></strong> 건</p>
<?php } ?>

<div class="sod_list_wrap">
    <table class="sod_list_tbl">
    <thead>
    <tr>
        <th scope="col">주문번호</th>
        <th scope="col">주문일시</th>
        <th scope="col">상품수</th>
        <th scope="col">주문금액</th>
        <th scope="col">입금액</th>
        <th scope="col">미입금액</th>
        <th scope="col">상태</th>
    </tr>
    </thead>
    <tbody>
    <?php
    $sql = " select *
               from {$g5['g5_shop_order_table']}
              where mb_id = '{$member['mb_id']}'
              order by od_id desc
              $limit ";
    $result = sql_query($sql);
    for ($i=0; $row=sql_fetch_array($result); $i++)
    {
        $uid = function_exists('get_shop_uid') ? get_shop_uid('order', $row['od_id'], $row['od_time'], $row['od_ip']) : md5($row['od_id'].$row['od_time'].$row['od_ip']);

        // 상태 배지 — 고객노출 라벨/색은 공용 헬퍼(extend/sp_order_status.extend.php)로 일원화.
        // 상세(orderinquiryview.php)와 같은 함수를 써 목록↔상세 표기가 어긋나지 않게 한다.
        if (function_exists('sp_order_status_customer')) {
            $sc = sp_order_status_customer($row['od_status']);
            $od_status = '<span class="'.$sc['cls'].'">'.$sc['label'].'</span>';
        } else {
            $od_status = '<span class="status_06">'.$row['od_status'].'</span>';
        }

        $view_url = G5_SHOP_URL.'/orderinquiryview.php?od_id='.$row['od_id'].'&amp;uid='.$uid;
    ?>
    <tr>
        <td class="sod_col_id" data-th="주문번호"><a href="<?php echo $view_url; ?>"><?php echo $row['od_id']; ?></a></td>
        <td class="sod_col_time" data-th="주문일시"><?php echo substr($row['od_time'],2,14); ?> (<?php echo get_yoil($row['od_time']); ?>)</td>
        <td class="sod_col_cnt" data-th="상품수"><?php echo (int)$row['od_cart_count']; ?></td>
        <td class="sod_col_price" data-th="주문금액"><?php echo display_price($row['od_cart_price'] + $row['od_send_cost'] + $row['od_send_cost2']); ?></td>
        <td class="sod_col_pay" data-th="입금액"><?php echo display_price($row['od_receipt_price']); ?></td>
        <td class="sod_col_misu" data-th="미입금액"><?php echo display_price($row['od_misu']); ?></td>
        <td class="sod_col_status" data-th="상태"><?php echo $od_status; ?></td>
    </tr>
    <?php
    }

    if ($i == 0)
        echo '<tr class="empty_list_row"><td colspan="7">주문 내역이 없습니다.</td></tr>';
    ?>
    </tbody>
    </table>
</div>
<!-- } 주문 내역 목록 (sp-lite) 끝 -->
