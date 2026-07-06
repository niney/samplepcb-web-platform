<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가
/*
 * 공용 계정 사이드바 — 마이페이지·주문내역·주문상세·장바구니·위시리스트·견적관리 공유(SSOT).
 * 진입점이 $sp_account_active 로 활성 메뉴 지정(home|orders|cart|wish|quotes); 미지정 시 활성 없음.
 *   · 쇼핑 페이지: 테마 shop.head.php 가 SCRIPT_NAME 으로 자동 판별해 #aside 에 include.
 *   · 견적 페이지(/shop/quotes·/shop/quotes/archive): 다른 head(theme/head.php)라
 *     페이지가 .account-layout 로 직접 감싸 include.
 * $member 로그인 전제(호출 측이 로그인 게이트). 배지 건수는 여기서 1회 조회.
 */
if (!isset($sp_account_active)) $sp_account_active = '';
$cur = array('home' => '', 'orders' => '', 'cart' => '', 'wish' => '', 'quotes' => '', 'point' => '', 'coupon' => '', 'memo' => '', 'scrap' => '');
if (isset($cur[$sp_account_active])) $cur[$sp_account_active] = ' aria-current="page"';

$sp_esc   = function_exists('sql_real_escape_string') ? sql_real_escape_string($member['mb_id']) : addslashes($member['mb_id']);
$sp_cp    = function_exists('get_shop_member_coupon_count') ? (int) get_shop_member_coupon_count($member['mb_id'], true) : 0;
$sp_memo  = isset($member['mb_memo_cnt'])  ? (int) $member['mb_memo_cnt']  : 0;
$sp_scrap = isset($member['mb_scrap_cnt']) ? (int) $member['mb_scrap_cnt'] : 0;
$tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_order_table']} where mb_id = '{$sp_esc}' ");
$sp_od = (int) $tmp['cnt'];
$tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_wish_table']} where mb_id = '{$sp_esc}' ");
$sp_wi = (int) $tmp['cnt'];
?>
<aside class="smb_nav" aria-label="계정 메뉴">
    <div class="nav_id">
        <div class="nav_id_top">
            <span class="nav_avatar"><?php echo get_member_profile_img($member['mb_id']); ?></span>
            <div class="nav_id_meta">
                <strong class="nav_name"><?php echo $member['mb_name']; ?> 님</strong>
                <span class="nav_sub"><?php echo $member['mb_id']; ?></span>
            </div>
        </div>
        <div class="nav_stats">
            <a class="nav_stat" href="<?php echo G5_BBS_URL ?>/point.php">
                <span class="v"><?php echo number_format($member['mb_point']); ?><small>P</small></span>
                <span class="k"><i class="fa fa-database" aria-hidden="true"></i>포인트</span>
            </a>
            <a class="nav_stat" href="<?php echo G5_SHOP_URL ?>/coupon.php">
                <span class="v"><?php echo number_format($sp_cp); ?><small>장</small></span>
                <span class="k"><i class="fa fa-ticket" aria-hidden="true"></i>쿠폰</span>
            </a>
        </div>
    </div>

    <div class="nav_body">
        <div class="nav_group">
            <p class="nav_glabel">쇼핑 내역</p>
            <ul>
                <li><a href="<?php echo G5_SHOP_URL ?>/mypage.php"<?php echo $cur['home']; ?>><i class="fa fa-home" aria-hidden="true"></i><span class="lbl">마이페이지 홈</span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/orderinquiry.php"<?php echo $cur['orders']; ?>><i class="fa fa-list-alt" aria-hidden="true"></i><span class="lbl">주문내역</span><?php if ($sp_od) { ?><span class="nav_badge"><?php echo number_format($sp_od); ?></span><?php } ?></a></li>
                <li><a href="<?php echo G5_URL ?>/shop/quotes"<?php echo $cur['quotes']; ?>><i class="fa fa-file-text-o" aria-hidden="true"></i><span class="lbl">견적관리</span><span class="nav_new">NEW</span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/cart.php"<?php echo $cur['cart']; ?>><i class="fa fa-shopping-cart" aria-hidden="true"></i><span class="lbl">장바구니</span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/wishlist.php"<?php echo $cur['wish']; ?>><i class="fa fa-heart-o" aria-hidden="true"></i><span class="lbl">위시리스트</span><?php if ($sp_wi) { ?><span class="nav_badge"><?php echo number_format($sp_wi); ?></span><?php } ?></a></li>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">혜택</p>
            <ul>
                <li><a href="<?php echo G5_BBS_URL ?>/point.php"<?php echo $cur['point']; ?>><i class="fa fa-database" aria-hidden="true"></i><span class="lbl">포인트</span><span class="nav_badge"><?php echo number_format($member['mb_point']); ?></span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/coupon.php"<?php echo $cur['coupon']; ?>><i class="fa fa-ticket" aria-hidden="true"></i><span class="lbl">쿠폰</span><?php if ($sp_cp) { ?><span class="nav_badge"><?php echo number_format($sp_cp); ?></span><?php } ?></a></li>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">소통</p>
            <ul>
                <li><a href="<?php echo G5_BBS_URL ?>/memo.php"<?php echo $cur['memo']; ?>><i class="fa fa-envelope-o" aria-hidden="true"></i><span class="lbl">쪽지</span><?php if ($sp_memo) { ?><span class="nav_badge on"><?php echo number_format($sp_memo); ?></span><?php } ?></a></li>
                <li><a href="<?php echo G5_BBS_URL ?>/scrap.php"<?php echo $cur['scrap']; ?>><i class="fa fa-thumb-tack" aria-hidden="true"></i><span class="lbl">스크랩</span><?php if ($sp_scrap) { ?><span class="nav_badge"><?php echo number_format($sp_scrap); ?></span><?php } ?></a></li>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">계정</p>
            <ul>
                <li><a href="<?php echo G5_BBS_URL ?>/member_confirm.php?url=register_form.php"><i class="fa fa-cog" aria-hidden="true"></i><span class="lbl">정보수정</span></a></li>
            </ul>
        </div>
    </div>

    <div class="nav_foot">
        <a class="logout" href="<?php echo G5_BBS_URL ?>/logout.php"><i class="fa fa-sign-out" aria-hidden="true"></i>로그아웃</a>
        <a class="leave" href="<?php echo G5_BBS_URL ?>/member_confirm.php?url=member_leave.php" onclick="return confirm('정말 회원에서 탈퇴 하시겠습니까?');"><i class="fa fa-user-times" aria-hidden="true"></i>회원탈퇴</a>
    </div>
</aside>
