<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가
/*
 * 공용 계정 사이드바 — 마이페이지·주문내역·주문상세·장바구니·견적관리·제조확인·A/S 접수 공유(SSOT).
 * 진입점이 $sp_account_active 로 활성 메뉴 지정(home|orders|cart|wish|quotes|eq|as|point|coupon|memo|scrap).
 *   · 쇼핑 페이지: 테마 shop.head.php 가 SCRIPT_NAME 으로 자동 판별해 #aside 에 include.
 *   · 커스텀 페이지(/shop/quotes·/shop/eq·/shop/as): 다른 head(theme/head.php)라
 *     페이지가 .account-layout 로 직접 감싸 include.
 * $member 로그인 전제(호출 측이 로그인 게이트). 배지 건수는 여기서 1회 조회.
 *
 * 디자인(2026-08-25, Figma 103:2361): 상단 프로필 카드(아바타·스탯 타일) 폐기 →
 * 이름 + [정보수정 | 로그아웃] 알약. 건수는 pill 이 아니라 우측 정렬 굵은 텍스트(.nav_badge
 * 숫자 + .nav_unit 단위) — 제조 확인만 파랑(고객 차례). 아이콘은 라인 SVG(<img>, 회색 baked).
 * ⚠ 클래스 훅(nav_group·nav_glabel·lbl·nav_badge·aria-current)은 e2e(customer-eq-menu·
 *   customer-as-menu·여정 44호)가 읽으므로 유지한다. .nav_badge 안에는 **숫자만** 둔다
 *   (단위는 .nav_unit 형제) — 테스트가 textContent 를 Number() 로 파싱한다.
 */
if (!isset($sp_account_active)) $sp_account_active = '';
$cur = array('home' => '', 'orders' => '', 'cart' => '', 'wish' => '', 'quotes' => '', 'eq' => '', 'as' => '', 'point' => '', 'coupon' => '', 'memo' => '', 'scrap' => '');
if (isset($cur[$sp_account_active])) $cur[$sp_account_active] = ' aria-current="page"';

$sp_ico   = G5_THEME_URL . '/img/account'; // theme/sp-lite/img/account (라인 아이콘 SVG)
$sp_esc   = function_exists('sql_real_escape_string') ? sql_real_escape_string($member['mb_id']) : addslashes($member['mb_id']);
$sp_cp    = function_exists('get_shop_member_coupon_count') ? (int) get_shop_member_coupon_count($member['mb_id'], true) : 0;
$sp_memo  = isset($member['mb_memo_cnt'])  ? (int) $member['mb_memo_cnt']  : 0;
$sp_scrap = isset($member['mb_scrap_cnt']) ? (int) $member['mb_scrap_cnt'] : 0;
$tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_order_table']} where mb_id = '{$sp_esc}' ");
$sp_od = (int) $tmp['cnt'];
// 장바구니(담김) 행 수 — 헤더 카트 배지와 같은 모수(ct_status='쇼핑').
$tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_cart_table']} where mb_id = '{$sp_esc}' and ct_status = '쇼핑' ");
$sp_cart = (int) $tmp['cnt'];
// 위시리스트 숨김(SP_USE_WISHLIST=false)이면 배지 쿼리도 생략. 복구·근거: docs/wishlist-hidden.md
$sp_wi = 0;
if (defined('SP_USE_WISHLIST') && SP_USE_WISHLIST) {
    $tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_wish_table']} where mb_id = '{$sp_esc}' ");
    $sp_wi = (int) $tmp['cnt'];
}
// 제조 확인(PCB·메탈마스크 공용) 대기 건수 — 고객 차례(파랑). 브리지 미배치여도 안 죽게 함수 확인.
$sp_eq = function_exists('sp_pcb_eq_open_count') ? sp_pcb_eq_open_count($member['mb_id']) : 0;
// A/S 접수 진행 중(PCB+BOM) — 관리자 차례(중립색). 세기만 DB 직접(브리지 규약, 판정은 sp-node).
$sp_as = (function_exists('sp_pcb_claim_active_count') ? sp_pcb_claim_active_count($member['mb_id']) : 0)
       + (function_exists('sp_bom_claim_active_count') ? sp_bom_claim_active_count($member['mb_id']) : 0);
?>
<aside class="smb_nav" aria-label="계정 메뉴">
    <div class="nav_head">
        <a class="nav_name" href="<?php echo G5_SHOP_URL ?>/mypage.php"><?php echo $member['mb_name']; ?>님</a>
        <div class="nav_acts">
            <a href="<?php echo G5_BBS_URL ?>/member_confirm.php?url=register_form.php"><img class="nav_ai" src="<?php echo $sp_ico ?>/ico-edit.svg" alt="">정보수정</a>
            <span class="nav_acts_sep" aria-hidden="true"></span>
            <a href="<?php echo G5_BBS_URL ?>/logout.php"><img class="nav_ai" src="<?php echo $sp_ico ?>/ico-logout.svg" alt="">로그아웃</a>
        </div>
    </div>

    <div class="nav_body">
        <div class="nav_group">
            <p class="nav_glabel">나의 쇼핑 정보</p>
            <ul>
                <li><a href="<?php echo G5_SHOP_URL ?>/mypage.php"<?php echo $cur['home']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-home.svg" alt=""><span class="lbl">마이페이지 홈</span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/orderinquiry.php"<?php echo $cur['orders']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-orders.svg" alt=""><span class="lbl">주문내역</span><?php if ($sp_od) { ?><span class="nav_badge"><?php echo number_format($sp_od); ?></span><span class="nav_unit">건</span><?php } ?></a></li>
                <li><a href="<?php echo G5_URL ?>/shop/quotes"<?php echo $cur['quotes']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-quotes.svg" alt=""><span class="lbl">견적 관리</span><span class="nav_new">NEW</span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/cart.php"<?php echo $cur['cart']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-cart.svg" alt=""><span class="lbl">장바구니</span><?php if ($sp_cart) { ?><span class="nav_badge"><?php echo number_format($sp_cart); ?></span><span class="nav_unit">건</span><?php } ?></a></li>
                <?php if (defined('SP_USE_WISHLIST') && SP_USE_WISHLIST) { // 위시리스트 숨김 토글 — docs/wishlist-hidden.md ?>
                <li><a href="<?php echo G5_SHOP_URL ?>/wishlist.php"<?php echo $cur['wish']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-scrap.svg" alt=""><span class="lbl">위시리스트</span><?php if ($sp_wi) { ?><span class="nav_badge"><?php echo number_format($sp_wi); ?></span><span class="nav_unit">건</span><?php } ?></a></li>
                <?php } ?>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">확인 요청</p>
            <ul>
                <?php /* 트랙 중립어 — 메탈마스크(스텐실)도 같은 축이나 'EQ' 라는 말이 없다(pcbEqEventLabel).
                        피그마엔 EQ 확인·워킹 파일 확인 두 줄이나, 고객 워킹 확인 단계는 없어 제조 확인 하나로. */ ?>
                <li><a href="<?php echo G5_URL ?>/shop/eq"<?php echo $cur['eq']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-eq.svg" alt=""><span class="lbl">제조 확인</span><?php if ($sp_eq) { ?><span class="nav_badge on"><?php echo number_format($sp_eq); ?></span><span class="nav_unit on">건</span><?php } ?></a></li>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">혜택</p>
            <ul>
                <li><a href="<?php echo G5_BBS_URL ?>/point.php"<?php echo $cur['point']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-point.svg" alt=""><span class="lbl">포인트</span><span class="nav_badge"><?php echo number_format((int) $member['mb_point']); ?></span><span class="nav_unit">P</span></a></li>
                <li><a href="<?php echo G5_SHOP_URL ?>/coupon.php"<?php echo $cur['coupon']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-coupon.svg" alt=""><span class="lbl">쿠폰</span><?php if ($sp_cp) { ?><span class="nav_badge"><?php echo number_format($sp_cp); ?></span><span class="nav_unit">개</span><?php } ?></a></li>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">활동</p>
            <ul>
                <li><a href="<?php echo G5_BBS_URL ?>/memo.php"<?php echo $cur['memo']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-memo.svg" alt=""><span class="lbl">쪽지</span><?php if ($sp_memo) { ?><span class="nav_badge on"><?php echo number_format($sp_memo); ?></span><span class="nav_unit on">건</span><?php } ?></a></li>
                <li><a href="<?php echo G5_BBS_URL ?>/scrap.php"<?php echo $cur['scrap']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-scrap.svg" alt=""><span class="lbl">스크랩</span><?php if ($sp_scrap) { ?><span class="nav_badge"><?php echo number_format($sp_scrap); ?></span><span class="nav_unit">건</span><?php } ?></a></li>
            </ul>
        </div>
        <div class="nav_group">
            <p class="nav_glabel">문의</p>
            <ul>
                <?php /* "요청"이 아니라 "접수" — 확인 요청은 자사→고객, 이쪽은 고객→자사다.
                        결과(재생산·환불·안내)는 관리자 판정이라 이름이 결과를 정하지 않는다. */ ?>
                <li><a href="<?php echo G5_URL ?>/shop/as"<?php echo $cur['as']; ?>><img class="nav_ico" src="<?php echo $sp_ico ?>/ico-working.svg" alt=""><span class="lbl">A/S 접수</span><?php if ($sp_as) { ?><span class="nav_badge"><?php echo number_format($sp_as); ?></span><span class="nav_unit">건</span><?php } ?></a></li>
            </ul>
        </div>
    </div>

    <div class="nav_foot">
        <a class="leave" href="<?php echo G5_BBS_URL ?>/member_confirm.php?url=member_leave.php" onclick="return confirm('정말 회원에서 탈퇴 하시겠습니까?');">회원탈퇴</a>
    </div>
</aside>
