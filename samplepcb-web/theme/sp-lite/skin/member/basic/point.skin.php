<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 계정 레이아웃 인라인 스킨 (팝업 아님). 스타일은 default_shop.css 의 .sp-acc-* 사용.
// 데이터($list·$member·get_paging)는 코어 bbs/point.php 가 준비 — 여기선 표현만.
?>

<!-- 포인트 내역 { -->
<div class="sp-acc sp-acc-point">
    <section class="sp-acc-panel">
        <div class="smb_panel_h">
            <h2>포인트 내역</h2>
            <a class="smb_panel_more" href="<?php echo G5_SHOP_URL ?>/mypage.php">마이페이지</a>
        </div>

        <div class="sp-acc-sum">
            <span class="sp-acc-sum__label">보유 포인트</span>
            <span class="sp-acc-sum__value"><?php echo number_format($member['mb_point']); ?><small>P</small></span>
        </div>

        <ul class="sp-acc-plist">
            <?php
            $sum_point1 = $sum_point2 = 0;
            $i = 0;
            foreach ((array) $list as $row) {
                $point1 = $point2 = 0;
                $is_use = false;
                if ($row['po_point'] > 0) {
                    $point1 = '+'.number_format($row['po_point']);
                    $sum_point1 += $row['po_point'];
                } else {
                    $point2 = number_format($row['po_point']);
                    $sum_point2 += $row['po_point'];
                    $is_use = true;
                }
                $expired = ($row['po_expired'] == 1);
            ?>
            <li class="sp-acc-plist__li<?php echo $is_use ? ' is-use' : ''; ?><?php echo $expired ? ' is-expired' : ''; ?>">
                <div class="sp-acc-plist__main">
                    <span class="sp-acc-plist__title"><?php echo $row['po_content']; ?></span>
                    <span class="sp-acc-plist__num"><?php echo $point1 ? $point1 : $point2; ?><small>P</small></span>
                </div>
                <div class="sp-acc-plist__meta">
                    <span class="sp-acc-plist__date"><i class="fa fa-clock-o" aria-hidden="true"></i> <?php echo $row['po_datetime']; ?></span>
                    <?php if ($expired) { ?>
                    <span class="sp-acc-plist__exp">만료됨</span>
                    <?php } else if ($row['po_expire_date'] && $row['po_expire_date'] != '9999-12-31') { ?>
                    <span class="sp-acc-plist__exp"><?php echo $row['po_expire_date']; ?> 만료</span>
                    <?php } ?>
                </div>
            </li>
            <?php $i++; } // end foreach ?>

            <?php if ($i == 0) { ?>
            <li class="sp-acc-empty">포인트 내역이 없습니다.</li>
            <?php } ?>
        </ul>

        <?php if ($i > 0) { ?>
        <div class="sp-acc-subtotal">
            <span class="sp-acc-subtotal__label">이 페이지 소계</span>
            <span class="sp-acc-subtotal__nums">
                <strong class="up"><?php echo $sum_point1 > 0 ? '+'.number_format($sum_point1) : '0'; ?></strong>
                <strong class="down"><?php echo number_format($sum_point2); ?></strong>
            </span>
        </div>
        <?php } ?>

        <div class="sp-acc-paging">
            <?php echo get_paging($config['cf_write_pages'], $page, $total_page, $_SERVER['SCRIPT_NAME'].'?'.$qstr.'&amp;page='); ?>
        </div>
    </section>
</div>
<!-- } 포인트 내역 -->
