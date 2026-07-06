<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 코어 shop/coupon.php 의 테마 오버라이드(코어가 G5_THEME_SHOP_PATH/coupon.php 훅으로 include+return).
// 계정 레이아웃은 head.sub.php 화이트리스트(coupon.php)가 자동 적용 — 이 파일은 콘텐츠(쿠폰 카드)만 담당.
// 쿼리·헬퍼(is_used_coupon·get_shop_item)는 코어와 동일 계약. 모바일은 코어 L4 에서 이미 분리됨.

if ($is_guest)
    alert_close('회원만 조회하실 수 있습니다.');

$g5['title'] = get_text($member['mb_nick']).' 님의 쿠폰';
include_once(G5_PATH.'/head.sub.php');

$sql = " select cp_id, cp_subject, cp_method, cp_target, cp_start, cp_end, cp_type, cp_price
            from {$g5['g5_shop_coupon_table']}
            where mb_id IN ( '{$member['mb_id']}', '전체회원' )
              and cp_start <= '".G5_TIME_YMD."'
              and cp_end >= '".G5_TIME_YMD."'
            order by cp_no ";
$result = sql_query($sql);
?>

<!-- 쿠폰 { -->
<div class="sp-acc sp-acc-coupon">
    <section class="sp-acc-panel">
        <div class="smb_panel_h">
            <h2>사용 가능 쿠폰</h2>
            <a class="smb_panel_more" href="<?php echo G5_SHOP_URL ?>/mypage.php">마이페이지</a>
        </div>

        <ul class="sp-acc-coupons">
        <?php
        $cp_count = 0;
        for ($i=0; $row=sql_fetch_array($result); $i++) {
            if (is_used_coupon($member['mb_id'], $row['cp_id']))
                continue;

            if ($row['cp_method'] == 1) {
                $ca = sql_fetch(" select ca_name from {$g5['g5_shop_category_table']} where ca_id = '".sql_real_escape_string($row['cp_target'])."' ");
                $cp_target = $ca['ca_name'].' 상품할인';
            } else if ($row['cp_method'] == 2) {
                $cp_target = '결제금액 할인';
            } else if ($row['cp_method'] == 3) {
                $cp_target = '배송비 할인';
            } else {
                $it = get_shop_item($row['cp_target'], true);
                $cp_target = $it['it_name'].' 상품할인';
            }

            $cp_price = $row['cp_type'] ? $row['cp_price'].'%' : number_format($row['cp_price']).'원';
            $cp_count++;
        ?>
            <li class="sp-acc-coupon-card">
                <div class="sp-acc-coupon-card__amt"><?php echo $cp_price; ?></div>
                <div class="sp-acc-coupon-card__body">
                    <span class="sp-acc-coupon-card__tit"><?php echo get_text($row['cp_subject']); ?></span>
                    <span class="sp-acc-coupon-card__target"><i class="fa fa-tag" aria-hidden="true"></i> <?php echo get_text($cp_target); ?></span>
                    <span class="sp-acc-coupon-card__date"><i class="fa fa-clock-o" aria-hidden="true"></i> <?php echo substr($row['cp_start'], 2, 8); ?> ~ <?php echo substr($row['cp_end'], 2, 8); ?></span>
                </div>
            </li>
        <?php } // end for ?>

        <?php if (!$cp_count) { ?>
            <li class="sp-acc-empty">사용할 수 있는 쿠폰이 없습니다.</li>
        <?php } ?>
        </ul>
    </section>
</div>
<!-- } 쿠폰 -->

<?php
include_once(G5_PATH.'/tail.sub.php');
