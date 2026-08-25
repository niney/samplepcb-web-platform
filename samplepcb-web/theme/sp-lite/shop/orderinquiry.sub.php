<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가
if (!defined("_ORDERINQUIRY_")) exit; // 개별 페이지 접근 불가

// sp-lite 주문내역 목록 (전 기기 pc 파일 사용 · 반응형: 넓은 화면 표 / 좁은 화면 카드)
// 코어 shop/orderinquiry.sub.php 의 테마 위임 훅으로 이 파일이 대체 include 됨.
// 열 구성·순서는 Figma 103:2361/103:4215 와 일치 — 마이페이지 최근 주문과 공용.
//
// ── 유형 탭(Figma 103:4507 — 전체/PCB/부품) ──────────────────────────────────
// 판별키 = 주문 카트행의 템플릿 it_id (PCB 4종 · 부품 sp-bom-parts). PCB+부품 혼합 주문은
// 정책(D17)상 없고 실데이터 16,346건에서도 0건이라 탭이 겹치지 않는다. 레거시 일반 상품
// 주문(어느 쪽도 아님)은 '전체'에서만 보인다(사용자 결정 2026-08-25). 설계·SMT 탭은
// 데이터 축이 없어 만들지 않는다.
//
// 탭·총건·페이지네이션은 **주문내역 페이지에서만**(isset($total_count) 마커 — 마이페이지의
// 최근 주문 include 는 총건 없이 limit 만 넘긴다). 코어 orderinquiry.php 는 무수정:
// get_paging 이 이 include **뒤에** 실행되므로 여기서 $total_count/$total_page/$qstr 를
// 재계산해 덮으면 총건·페이지 수·페이지 링크(track 유지)까지 탭을 따라간다.
$sp_oi_track = (isset($_GET['track']) && in_array($_GET['track'], array('pcb', 'bom'), true)) ? $_GET['track'] : '';
$sp_oi_pcb_items = "'sp-pcb-std','sp-mask','sp-pcb-adv','sp-pcb-flex'";
$sp_oi_where = '';
if ($sp_oi_track === 'pcb') {
    $sp_oi_where = " and exists (select 1 from {$g5['g5_shop_cart_table']} c
                                  where c.od_id = a.od_id and c.it_id in ({$sp_oi_pcb_items})) ";
} else if ($sp_oi_track === 'bom') {
    $sp_oi_where = " and exists (select 1 from {$g5['g5_shop_cart_table']} c
                                  where c.od_id = a.od_id and c.it_id = 'sp-bom-parts') ";
}

if (isset($total_count)) {
    if ($sp_oi_where !== '') {
        // 필터된 모수로 총건·페이지 재계산(코어 계산을 덮는다 — 코어 get_paging 은 이 뒤에 돈다).
        $tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_order_table']} a
                            where a.mb_id = '{$member['mb_id']}' {$sp_oi_where} ");
        $total_count = (int) $tmp['cnt'];
        $total_page  = max(1, ceil($total_count / $rows));
        // 페이지 링크가 탭을 물고 다니게 — get_paging 이 기존 page= 는 지우고 다시 붙인다.
        $qstr = ($qstr ? $qstr . '&amp;' : '') . 'track=' . $sp_oi_track;
    }
    $sp_oi_url = G5_SHOP_URL . '/orderinquiry.php';
?>
<div class="sp-quotes-tabs sp-oi-tabs" role="tablist">
    <a class="sp-quotes-tab<?php echo $sp_oi_track === '' ? ' is-active' : ''; ?>" href="<?php echo $sp_oi_url; ?>">전체</a>
    <a class="sp-quotes-tab<?php echo $sp_oi_track === 'pcb' ? ' is-active' : ''; ?>" href="<?php echo $sp_oi_url; ?>?track=pcb">PCB</a>
    <a class="sp-quotes-tab<?php echo $sp_oi_track === 'bom' ? ' is-active' : ''; ?>" href="<?php echo $sp_oi_url; ?>?track=bom">부품</a>
</div>
<?php } ?>

<!-- 주문 내역 목록 (sp-lite) 시작 { -->
<?php if (isset($total_count)) { ?>
<p class="sod_v_count">총 <strong><?php echo number_format($total_count); ?></strong> 건</p>
<?php } ?>

<div class="sod_list_wrap">
    <table class="sod_list_tbl">
    <thead>
    <tr>
        <th scope="col">주문일</th>
        <th scope="col">주문번호</th>
        <th scope="col">상품명</th>
        <th scope="col">상품수</th>
        <th scope="col">주문금액</th>
        <th scope="col">결제액</th>
        <th scope="col">미입금액</th>
        <th scope="col">상태</th>
    </tr>
    </thead>
    <tbody>
    <?php
    $sql = " select a.*
               from {$g5['g5_shop_order_table']} a
              where a.mb_id = '{$member['mb_id']}'
              {$sp_oi_where}
              order by a.od_id desc
              $limit ";
    $result = sql_query($sql);
    // 협력 트랙 진행(P4.13)을 목록 배지에 겹치려면 od_id 를 먼저 모아 **한 번에** 물어야 한다
    // (행마다 HTTP 왕복 금지). 진행이 없는 주문은 od 매핑 그대로다.
    $sp_oi_rows = array();
    while ($sp_oi_r = sql_fetch_array($result)) $sp_oi_rows[] = $sp_oi_r;
    $sp_oi_od_ids = array();
    foreach ($sp_oi_rows as $sp_oi_r) $sp_oi_od_ids[] = $sp_oi_r['od_id'];
    $sp_oi_progress = function_exists('sp_pcb_progress_batch') ? sp_pcb_progress_batch($sp_oi_od_ids) : array();
    $i = count($sp_oi_rows); // 아래 빈 목록 판정(if ($i == 0))이 코어 for 루프의 $i 를 기대한다.
    foreach ($sp_oi_rows as $row)
    {
        $uid = function_exists('get_shop_uid') ? get_shop_uid('order', $row['od_id'], $row['od_time'], $row['od_ip']) : md5($row['od_id'].$row['od_time'].$row['od_ip']);
        // 과거 주문은 같은 템플릿 PCB 여러 줄이 od_cart_count=1로 저장돼 있을 수 있다.
        // 커스텀 행 건별 집계가 있으면 실제 cart 구성으로 보정하고, 미배치 환경은 저장값 폴백.
        $cart_count = function_exists('sp_order_cart_count')
                    ? sp_order_cart_count($row['od_id'])
                    : (int) $row['od_cart_count'];

        // 상품명 — 주문의 첫 카트행 it_name + "외 N건". 어느 주문인지 목록에서 바로 알게 한다.
        $od_esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($row['od_id']) : addslashes($row['od_id']);
        $it_row = sql_fetch(" select it_name from {$g5['g5_shop_cart_table']}
                               where od_id = '{$od_esc}' order by ct_id asc limit 1 ");
        $it_name = (isset($it_row['it_name']) && $it_row['it_name'] !== '') ? $it_row['it_name'] : '-';
        $it_more = ($cart_count > 1) ? ' 외 '.($cart_count - 1).'건' : '';

        // 부분취소 환불 뒤에도 총수납만 보이면 실제로 남은 결제액보다 크게 보인다.
        // 영카트 미수 산식과 같은 수납 + 포인트 - 환불을 목록의 결제액으로 쓴다.
        $net_receipt_price = (int) $row['od_receipt_price']
                           + (int) $row['od_receipt_point']
                           - (int) $row['od_refund_price'];

        // 상태 배지 — 고객노출 라벨/색은 공용 헬퍼(extend/sp_order_status.extend.php)로 일원화.
        // 상세(orderinquiryview.php)와 같은 함수를 써 목록↔상세 표기가 어긋나지 않게 한다.
        // 헤더 배지 = od 매핑 + 줄 집계(반품/품절·일부 취소) + 협력 트랙 진행(결제 뒤·배송 전).
        if (function_exists('sp_order_status_customer_order')) {
            $sc = sp_order_status_customer_order(
                $row,
                isset($sp_oi_progress[(string) $row['od_id']]) ? $sp_oi_progress[(string) $row['od_id']] : null
            );
            $od_status = sp_order_status_badge_html($sc);
        } else {
            $od_status = '<span class="status_06">'.$row['od_status'].'</span>';
        }

        $view_url = G5_SHOP_URL.'/orderinquiryview.php?od_id='.$row['od_id'].'&amp;uid='.$uid;
    ?>
    <tr>
        <td class="sod_col_time" data-th="주문일"><?php echo str_replace('-', '.', substr($row['od_time'], 0, 10)); /* 2026.08.25 (YYYY.MM.DD) */ ?></td>
        <td class="sod_col_id" data-th="주문번호"><a href="<?php echo $view_url; ?>"><?php echo $row['od_id']; ?></a></td>
        <td class="sod_col_name" data-th="상품명"><a href="<?php echo $view_url; ?>" title="<?php echo get_text($it_name.$it_more); ?>"><?php echo get_text($it_name); ?><?php echo $it_more; ?></a></td>
        <td class="sod_col_cnt" data-th="상품수"><?php echo $cart_count; ?></td>
        <td class="sod_col_price" data-th="주문금액"><?php echo display_price($row['od_cart_price'] + $row['od_send_cost'] + $row['od_send_cost2']); ?></td>
        <td class="sod_col_pay" data-th="결제액"><?php echo display_price($net_receipt_price); ?></td>
        <td class="sod_col_misu" data-th="미입금액"><?php echo display_price($row['od_misu']); ?></td>
        <td class="sod_col_status" data-th="상태"><?php echo $od_status; ?></td>
    </tr>
    <?php
    }

    if ($i == 0)
        echo '<tr class="empty_list_row"><td colspan="8">주문 내역이 없습니다.</td></tr>';
    ?>
    </tbody>
    </table>
</div>
<?php if (isset($total_count)) { ?>
<script>
// 페이지네이션 ‹ › 보강(Figma 103:4498) — 코어 get_paging 은 '이전/다음'을 10페이지 블록을
// 넘을 때만 내고 그마저 블록 점프다. 피그마는 **한 페이지씩** ‹ › — 코어 무수정으로 테마가
// 앵커를 세우거나(없을 때) 단일 스텝으로 고쳐 단다(있을 때). 마크업이 sub 뒤에 렌더되므로
// DOMContentLoaded 에서 처리한다.
document.addEventListener('DOMContentLoaded', function () {
    var pg = document.querySelector('#sod_v .pg');
    if (!pg) return;
    var cur = <?php echo (int) $page; ?>;
    var total = <?php echo (int) $total_page; ?>;
    var base = '<?php echo G5_SHOP_URL; ?>/orderinquiry.php?<?php echo $qstr ? str_replace('&amp;', '&', $qstr) . '&' : ''; ?>page=';
    function ensure(cls, label, target, first) {
        var a = pg.querySelector('.' + cls);
        if (!a) {
            a = document.createElement('a');
            a.className = 'pg_page ' + cls;
            a.textContent = label;
            if (first) pg.insertBefore(a, pg.firstChild); else pg.appendChild(a);
        }
        // Figma 103:4498 — 화살표는 항상 양쪽에 서고, 갈 곳이 없으면 비활성으로 남는다.
        if (target === null) { a.removeAttribute('href'); a.classList.add('is-disabled'); }
        else { a.href = base + target; a.classList.remove('is-disabled'); }
    }
    ensure('pg_prev', '이전', cur > 1 ? cur - 1 : null, true);
    ensure('pg_next', '다음', cur < total ? cur + 1 : null, false);
});
</script>
<?php } ?>
<!-- } 주문 내역 목록 (sp-lite) 끝 -->
