<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite 공용 헤더 — 커뮤니티(head.php)와 쇼핑몰(shop/shop.head.php) 양쪽에서 include
// 구성: 로고(임시 텍스트 워드마크) + 로그인 영역 + GNB(DB 메뉴). 반응형: <1024px 에서 햄버거 토글.
?>
<div id="hd">
    <h1 id="hd_h1"><?php echo $g5['title'] ?></h1>
    <div id="skip_to_container"><a href="#container">본문 바로가기</a></div>

    <header class="sp-header">
        <div class="sp-inner sp-header__bar">
            <button type="button" class="sp-gnb-toggle" aria-expanded="false" aria-controls="gnb">
                <i class="fa fa-bars" aria-hidden="true"></i><span class="sound_only">전체메뉴 열기</span>
            </button>

            <a href="<?php echo G5_URL ?>/" class="sp-logo"><img src="<?php echo G5_THEME_URL ?>/img/logo.png" alt="<?php echo get_text($config['cf_title']); ?>"></a>

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

            <ul class="sp-util">
                <?php if ($is_member) { ?>
                <li class="sp-util__member"><a href="<?php echo G5_BBS_URL ?>/member_confirm.php?url=<?php echo G5_BBS_URL ?>/register_form.php"><b><?php echo get_text($member['mb_nick']); ?></b>님</a></li>
                <li><a href="<?php echo G5_BBS_URL ?>/logout.php">로그아웃</a></li>
                <?php if ($is_admin) { ?>
                <li><a href="<?php echo correct_goto_url(G5_ADMIN_URL); ?>">관리자</a></li>
                <?php } ?>
                <?php } else { ?>
                <li><a href="<?php echo G5_BBS_URL ?>/login.php?url=<?php echo isset($urlencode) ? $urlencode : ''; ?>">로그인</a></li>
                <li><a href="<?php echo G5_BBS_URL ?>/register.php" class="sp-util__cta">회원가입</a></li>
                <?php } ?>
                <?php if (defined('G5_USE_SHOP') && G5_USE_SHOP && function_exists('get_boxcart_datas_count')) { ?>
                <li class="sp-util__quotes">
                    <a href="<?php echo G5_URL; ?>/shop/quotes">
                        <i class="fa fa-file-text-o" aria-hidden="true"></i><span class="sound_only">견적관리</span>
                    </a>
                </li>
                <li class="sp-util__cart">
                    <a href="<?php echo G5_SHOP_URL; ?>/cart.php">
                        <i class="fa fa-shopping-cart" aria-hidden="true"></i><span class="sound_only">장바구니</span>
                        <span class="sp-util__cart-count"><?php echo get_boxcart_datas_count(); ?></span>
                    </a>
                </li>
                <?php } ?>
            </ul>
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
