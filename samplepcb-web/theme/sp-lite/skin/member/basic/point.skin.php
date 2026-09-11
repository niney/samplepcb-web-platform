<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// Figma 2254:9041 — 요약 2칸 + 날짜/내역/상태 표. 목록·보유액·페이지 이동은 코어 데이터 사용.
// 소멸 예정은 오늘부터 30일 이내의 미사용 잔여액. 코어의 유효기간 설정과 원장을 읽기만 한다.
$sp_point_expire_until = date('Y-m-d', strtotime('+30 days', strtotime(G5_TIME_YMD)));
$sp_point_expiring = 0;
if ((int) $config['cf_point_term'] > 0) {
    $sp_point_member_id = sql_real_escape_string($member['mb_id']);
    $sp_point_expiry = sql_fetch(" select coalesce(sum(po_point - po_use_point), 0) as amount
        from {$g5['point_table']}
        where mb_id = '{$sp_point_member_id}'
          and po_expired = 0 and po_point > po_use_point
          and po_expire_date <> '9999-12-31'
          and po_expire_date between '".G5_TIME_YMD."' and '{$sp_point_expire_until}' ", false);
    $sp_point_expiring = $sp_point_expiry ? (int) $sp_point_expiry['amount'] : null;
}
?>

<!-- 포인트 내역 { -->
<div class="sp-acc sp-acc-point">
    <dl class="sp-point-summary" aria-label="포인트 요약">
        <div class="sp-point-summary__cell">
            <dt>사용 가능 포인트</dt>
            <dd><strong><?php echo number_format((int) $member['mb_point']); ?></strong>P</dd>
        </div>
        <div class="sp-point-summary__cell" title="<?php echo G5_TIME_YMD; ?>부터 <?php echo $sp_point_expire_until; ?>까지 소멸 예정인 잔여 포인트">
            <dt>소멸 예정 포인트<span class="sound_only"> (30일 이내)</span></dt>
            <dd><?php if ($sp_point_expiring !== null) { ?><strong><?php echo number_format($sp_point_expiring); ?></strong>P<?php } else { ?><span class="sp-point-summary__unavailable">조회 불가</span><?php } ?></dd>
        </div>
    </dl>

    <section class="sp-point-history" aria-labelledby="sp-point-history-title">
        <div class="smb_panel_h">
            <h2 id="sp-point-history-title">포인트 현황</h2>
        </div>
        <table class="sp-point-table">
            <caption class="sound_only">포인트 적립 및 사용 내역</caption>
            <colgroup>
                <col class="sp-point-table__date-col">
                <col>
                <col class="sp-point-table__amount-col">
            </colgroup>
            <thead>
                <tr><th scope="col">날짜</th><th scope="col">내역</th><th scope="col">상태</th></tr>
            </thead>
            <tbody>
                <?php foreach ((array) $list as $row) {
                    $sp_point_amount = (int) $row['po_point'];
                    $sp_point_date = substr($row['po_datetime'], 0, 10);
                    $sp_point_content = $row['po_content'];
                    // 코어의 일일 로그인 문구만 정리해 날짜 열과의 중복을 없앤다. 원장은 유지한다.
                    if ($sp_point_content === $sp_point_date.' 첫로그인') {
                        $sp_point_content = '첫 로그인';
                    }
                    $sp_point_detail = $row['po_datetime'];
                    if ($sp_point_amount > 0 && (int) $row['po_expired'] === 1) {
                        $sp_point_detail .= ' · 만료됨';
                    } else if ($sp_point_amount > 0 && $row['po_expire_date'] && $row['po_expire_date'] !== '9999-12-31') {
                        $sp_point_detail .= ' · '.$row['po_expire_date'].' 만료';
                    }
                ?>
                <tr>
                    <td class="sp-point-table__date"><time datetime="<?php echo htmlspecialchars($sp_point_date, ENT_QUOTES, 'UTF-8'); ?>" title="<?php echo htmlspecialchars($sp_point_detail, ENT_QUOTES, 'UTF-8'); ?>"><?php echo htmlspecialchars(str_replace('-', '.', $sp_point_date), ENT_QUOTES, 'UTF-8'); ?></time></td>
                    <td class="sp-point-table__content"><?php echo get_text($sp_point_content); ?></td>
                    <td class="sp-point-table__amount<?php echo $sp_point_amount < 0 ? ' is-use' : ''; ?>"><?php echo ($sp_point_amount > 0 ? '+' : '').number_format($sp_point_amount); ?>원</td>
                </tr>
                <?php } ?>
                <?php if (empty($list)) { ?>
                <tr><td colspan="3" class="sp-acc-empty">포인트 내역이 없습니다.</td></tr>
                <?php } ?>
            </tbody>
        </table>

        <?php if ($total_page > 1) { ?>
        <div class="sp-acc-paging">
            <?php echo get_paging($config['cf_write_pages'], $page, $total_page, $_SERVER['SCRIPT_NAME'].'?'.$qstr.'&amp;page='); ?>
        </div>
        <?php } ?>
    </section>
</div>
<!-- } 포인트 내역 -->
