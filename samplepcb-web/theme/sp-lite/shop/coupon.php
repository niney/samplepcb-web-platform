<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// Figma 2334:30444 — 요약 2칸 + 내역/사용 기한 표(사용자 결정으로 날짜 열 제외).
// 코어와 같은 유효기간·미사용 판정. 요약·목록·사이드바는 같은 쿠폰 수를 사용한다.

if ($is_guest)
    alert_close('회원만 조회하실 수 있습니다.');

$sp_coupon_member_id = sql_real_escape_string($member['mb_id']);
$sp_coupon_expire_until = date('Y-m-d', strtotime('+30 days', strtotime(G5_TIME_YMD)));
$sp_coupons = array();
$sp_coupon_expiring = 0;
$sql = " select cp_id, cp_subject, cp_method, cp_target, cp_end, cp_type, cp_price, cp_minimum, cp_maximum
            from {$g5['g5_shop_coupon_table']}
            where mb_id IN ( '{$sp_coupon_member_id}', '전체회원' )
              and cp_start <= '".G5_TIME_YMD."'
              and cp_end >= '".G5_TIME_YMD."'
            order by cp_no ";
$result = sql_query($sql);
while ($row = sql_fetch_array($result)) {
    if (is_used_coupon($member['mb_id'], $row['cp_id'])) continue;
    $sp_coupons[] = $row;
    if ($row['cp_end'] <= $sp_coupon_expire_until) $sp_coupon_expiring++;
}
$sp_coupon_count = count($sp_coupons);

$g5['title'] = '쿠폰';
include_once(G5_PATH.'/head.sub.php');
?>

<!-- 쿠폰 { -->
<div class="sp-acc sp-acc-coupon">
    <dl class="sp-coupon-summary" aria-label="쿠폰 요약">
        <div class="sp-coupon-summary__cell">
            <dt>사용 가능 쿠폰</dt>
            <dd><img src="<?php echo G5_THEME_URL ?>/img/account/ico-coupon-available.svg" width="30" height="30" alt=""><span><strong><?php echo number_format($sp_coupon_count); ?></strong>개</span></dd>
        </div>
        <div class="sp-coupon-summary__cell" title="<?php echo G5_TIME_YMD; ?>부터 <?php echo $sp_coupon_expire_until; ?>까지 만료되는 미사용 쿠폰">
            <dt>소멸 예정 쿠폰 <small>(30일 이내)</small></dt>
            <dd><img src="<?php echo G5_THEME_URL ?>/img/account/ico-coupon-expiring.svg" width="30" height="30" alt=""><span><strong><?php echo number_format($sp_coupon_expiring); ?></strong>개</span></dd>
        </div>
    </dl>

    <section class="sp-coupon-history" aria-labelledby="sp-coupon-history-title">
        <div class="smb_panel_h">
            <h2 id="sp-coupon-history-title">쿠폰 현황</h2>
        </div>
        <table class="sp-coupon-table">
            <caption class="sound_only">사용 가능한 쿠폰의 할인 혜택, 적용 조건 및 사용 기한</caption>
            <colgroup><col><col class="sp-coupon-table__expiry-col"></colgroup>
            <thead><tr><th scope="col">내역</th><th scope="col">사용 기한</th></tr></thead>
            <tbody>
        <?php
        foreach ($sp_coupons as $row) {
            if ($row['cp_method'] == 1) {
                $ca = sql_fetch(" select ca_name from {$g5['g5_shop_category_table']} where ca_id = '".sql_real_escape_string($row['cp_target'])."' ");
                $cp_target = (!empty($ca['ca_name']) ? $ca['ca_name'] : '지정 분류').' 상품할인';
            } else if ($row['cp_method'] == 2) {
                $cp_target = '결제금액 할인';
            } else if ($row['cp_method'] == 3) {
                $cp_target = '배송비 할인';
            } else {
                $it = get_shop_item($row['cp_target'], true);
                $cp_target = (!empty($it['it_name']) ? $it['it_name'] : '지정 상품').' 상품할인';
            }

            $cp_price = $row['cp_type'] ? $row['cp_price'].'%' : number_format($row['cp_price']).'원';
            $cp_conditions = array($cp_target);
            if ((int) $row['cp_minimum'] > 0) $cp_conditions[] = number_format($row['cp_minimum']).'원 이상 구매 시';
            if ((int) $row['cp_maximum'] > 0) $cp_conditions[] = '최대 '.number_format($row['cp_maximum']).'원 할인';
        ?>
                <tr>
                    <td class="sp-coupon-table__content">
                        <strong class="sp-coupon-table__discount"><?php echo get_text($cp_price); ?></strong>
                        <span class="sp-coupon-table__subject"><?php echo get_text($row['cp_subject']); ?></span>
                        <span class="sp-coupon-table__conditions"><?php echo get_text(implode(' · ', $cp_conditions)); ?></span>
                    </td>
                    <td class="sp-coupon-table__expiry"><time datetime="<?php echo htmlspecialchars($row['cp_end'], ENT_QUOTES, 'UTF-8'); ?>"><?php echo get_text(str_replace('-', '.', $row['cp_end'])); ?> <span>23:59까지</span></time></td>
                </tr>
        <?php } ?>
        <?php if (!$sp_coupon_count) { ?>
                <tr><td colspan="2" class="sp-acc-empty">사용할 수 있는 쿠폰이 없습니다.</td></tr>
        <?php } ?>
            </tbody>
        </table>
    </section>
</div>
<!-- } 쿠폰 -->

<?php
include_once(G5_PATH.'/tail.sub.php');
