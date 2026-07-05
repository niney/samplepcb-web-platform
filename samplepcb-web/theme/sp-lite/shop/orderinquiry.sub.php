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

        switch($row['od_status']) {
            case '주문':
                $od_status = '<span class="status_01">입금확인중</span>';
                break;
            case '입금':
                $od_status = '<span class="status_02">입금완료</span>';
                break;
            case '준비':
                $od_status = '<span class="status_03">상품준비중</span>';
                break;
            // PCB 제작 단계(레거시 이식) — 고객노출 라벨은 korForCustomer, 색은 '진행 중'(status_03) 공용.
            case '가격확인':
                $od_status = '<span class="status_03">상품준비중</span>';
                break;
            case '파일검사':
                $od_status = '<span class="status_03">파일검사</span>';
                break;
            case 'EQ':
                $od_status = '<span class="status_03">EQ</span>';
                break;
            case '생산시작':
                $od_status = '<span class="status_03">생산시작</span>';
                break;
            case '생산중':
                $od_status = '<span class="status_03">생산중</span>';
                break;
            case '품질시험':
                $od_status = '<span class="status_03">품질시험</span>';
                break;
            case '생산완료':
                $od_status = '<span class="status_03">생산완료</span>';
                break;
            case 'A/S':
                $od_status = '<span class="status_03">A/S</span>';
                break;
            case '배송':
                $od_status = '<span class="status_04">상품배송</span>';
                break;
            case '완료':
                $od_status = '<span class="status_05">배송완료</span>';
                break;
            default:
                $od_status = '<span class="status_06">주문취소</span>';
                break;
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
