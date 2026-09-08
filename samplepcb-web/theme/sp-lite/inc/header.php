<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite 공용 헤더 — 커뮤니티(head.php)와 쇼핑몰(shop/shop.head.php) 양쪽에서 include
// 디자인: Figma 「일반고객_로그인」(2077:15) 의 top(2089:1413) — 94px 흰 바, 로고(심볼+SAMPLEPCB) · GNB(DB 메뉴) ·
//   우측 [로그인 알약 + 회원가입] + 아이콘 3개(견적관리·장바구니·마이페이지). 반응형: <1024px 에서 햄버거 토글.
// 로그인 상태는 피그마에 없어 사용자 결정(2026-08-27)대로: 알약 자리에 '로그아웃'(+승인 파트너 '파트너 포탈',
//   super '관리자'·'시스템 관리자') 밑줄 텍스트 링크. 건수 배지는 견적관리 화면(103:2659) 헤더의 파란 pill.
$sp_hd_ico = G5_THEME_URL.'/img/header';
?>
<div id="hd">
    <h1 id="hd_h1"><?php echo $g5['title'] ?></h1>
    <div id="skip_to_container"><a href="#container">본문 바로가기</a></div>

    <header class="sp-header">
        <div class="sp-inner sp-header__bar">
            <button type="button" class="sp-gnb-toggle" aria-expanded="false" aria-controls="gnb">
                <i class="fa fa-bars" aria-hidden="true"></i><span class="sound_only">전체메뉴 열기</span>
            </button>

            <a href="<?php echo G5_URL ?>/" class="sp-logo"><img src="<?php echo G5_THEME_URL ?>/img/logo-header.png" width="175" height="28" alt="<?php echo get_text($config['cf_title']); ?>"></a>

            <nav class="sp-gnb" id="gnb">
                <h2 class="sound_only">메인메뉴</h2>
                <ul class="sp-gnb__list">
                    <?php
                    $menu_datas = get_menu_db(0, true);
                    $menu_count = 0;
                    foreach ($menu_datas as $row) {
                        if (empty($row)) continue;
                        $has_sub = !empty($row['sub']);
                        $menu_count++;
                    ?>
                    <li class="sp-gnb__item<?php echo $has_sub ? ' has-sub' : ''; ?>">
                        <a href="<?php echo $row['me_link']; ?>" target="_<?php echo $row['me_target']; ?>" class="sp-gnb__link"><?php echo $row['me_name'] ?></a>
                        <?php if ($has_sub) { ?>
                        <ul class="sp-gnb__sub">
                            <?php foreach ((array) $row['sub'] as $row2) { if (empty($row2)) continue; ?>
                            <li><a href="<?php echo $row2['me_link']; ?>" target="_<?php echo $row2['me_target']; ?>"><?php echo $row2['me_name'] ?></a></li>
                            <?php } ?>
                        </ul>
                        <?php } ?>
                    </li>
                    <?php } ?>

                    <?php if ($menu_count === 0) { ?>
                    <li class="sp-gnb__empty">메뉴 준비 중입니다.<?php if ($is_admin) { ?> <a href="<?php echo G5_ADMIN_URL; ?>/menu_list.php">관리자모드 &gt; 환경설정 &gt; 메뉴설정</a>에서 등록할 수 있습니다.<?php } ?></li>
                    <?php } ?>
                </ul>
            </nav>

            <div class="sp-util">
                <div class="sp-util__auth">
                    <?php if ($is_member) { ?>
                    <a href="<?php echo G5_BBS_URL ?>/logout.php" class="sp-util__link">로그아웃</a>
                    <?php if (function_exists('sp_is_approved_partner') && sp_is_approved_partner()) { ?>
                    <a href="<?php echo G5_URL; ?>/app/partner" class="sp-util__link sp-util__link--extra">파트너 포탈</a>
                    <?php } ?>
                    <?php if ($is_admin == 'super') { // 최고관리자(cf_admin)에게만 노출 — sp-vue 접근권(spcb/api/me.php isAdmin=cf_admin)과 일치. 접근 자체는 막지 않음(직접 URL 가능). ?>
                    <a href="<?php echo G5_URL; ?>/app/admin" class="sp-util__link sp-util__link--extra">관리자</a>
                    <a href="<?php echo correct_goto_url(G5_ADMIN_URL); ?>" class="sp-util__link sp-util__link--extra">시스템 관리자</a>
                    <?php } ?>
                    <?php } else { ?>
                    <a href="<?php echo G5_BBS_URL ?>/login.php?url=<?php echo isset($urlencode) ? $urlencode : ''; ?>" class="sp-util__login">로그인</a>
                    <a href="<?php echo G5_BBS_URL ?>/register.php" class="sp-util__link">회원가입</a>
                    <?php } ?>
                </div>

                <?php if (defined('G5_USE_SHOP') && G5_USE_SHOP && function_exists('get_boxcart_datas_count')) {
                    // 뱃지 카운트 — cart.php 표시 건수와 일치(견적 ct_id 건별)하도록 extend 헬퍼 사용.
                    // 헬퍼 부재(구버전) 시 코어 집계로 폴백. 견적관리는 순수 견적(미담김) 건수.
                    $sp_cart_cnt  = function_exists('sp_cart_badge_count')  ? sp_cart_badge_count()  : get_boxcart_datas_count();
                    $sp_quote_cnt = function_exists('sp_quote_badge_count') ? sp_quote_badge_count() : 0;
                    // 회원 전용 화면(견적관리·마이페이지)은 비회원이면 로그인으로 — 되돌아올 URL 을 실어 보낸다.
                    $sp_quotes_url = $is_member ? G5_URL.'/shop/quotes'      : G5_BBS_URL.'/login.php?url='.urlencode(G5_URL.'/shop/quotes');
                    $sp_mypage_url = $is_member ? G5_SHOP_URL.'/mypage.php' : G5_BBS_URL.'/login.php?url='.urlencode(G5_SHOP_URL.'/mypage.php');
                ?>
                <ul class="sp-util__icons">
                    <li class="sp-util__quotes">
                        <a href="<?php echo $sp_quotes_url; ?>">
                            <img src="<?php echo $sp_hd_ico; ?>/ico-quotes.svg" alt=""><span class="sound_only">견적관리</span>
                            <?php if ($sp_quote_cnt > 0) { ?><span class="sp-util__count sp-util__quotes-count"><?php echo $sp_quote_cnt; ?></span><?php } ?>
                        </a>
                    </li>
                    <li class="sp-util__cart">
                        <a href="<?php echo G5_SHOP_URL; ?>/cart.php">
                            <img src="<?php echo $sp_hd_ico; ?>/ico-cart.svg" alt=""><span class="sound_only">장바구니</span>
                            <?php if ($sp_cart_cnt > 0) { ?><span class="sp-util__count sp-util__cart-count"><?php echo $sp_cart_cnt; ?></span><?php } ?>
                        </a>
                    </li>
                    <li class="sp-util__mypage">
                        <a href="<?php echo $sp_mypage_url; ?>">
                            <img src="<?php echo $sp_hd_ico; ?>/ico-mypage.svg" alt=""><span class="sound_only">마이페이지</span>
                        </a>
                    </li>
                </ul>
                <?php } ?>
            </div>
        </div>
    </header>

    <script>
    $(function() {
        $(".sp-gnb-toggle").on("click", function() {
            var opened = $("#hd").toggleClass("gnb-open").hasClass("gnb-open");
            $(this).attr("aria-expanded", opened ? "true" : "false");
        });
        // 모바일에서 하위메뉴가 있는 1차 메뉴는 첫 탭에 하위를 펼친다
        $(".sp-gnb .has-sub > .sp-gnb__link").on("click", function(e) {
            if (window.matchMedia("(max-width: 1023px)").matches) {
                var $li = $(this).parent();
                if (!$li.hasClass("is-open")) {
                    e.preventDefault();
                    $li.addClass("is-open").siblings().removeClass("is-open");
                }
            }
        });
    });
    </script>
</div>
