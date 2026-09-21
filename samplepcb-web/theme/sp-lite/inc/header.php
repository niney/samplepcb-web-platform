<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite 공용 헤더 — 커뮤니티(head.php)와 쇼핑몰(shop/shop.head.php) 양쪽에서 include
// 디자인: Figma 「웹 메인」(2286:1275) 의 top(2331:30387) 2026-09-21 — 72px 흰 바, 로고(심볼+SAMPLEPCB) ·
//   GNB(DB 메뉴, 하위메뉴 있으면 ▾ + 드롭다운 2286:1436) · 우측 [로그인 검정 알약 + 회원가입 회색 알약] + 아이콘 3개(견적관리·장바구니·마이페이지).
//   사용자 요청으로 표시명·회사소개 하위 3항목을 시안과 통일. 링크·노출 순서는 관리자 메뉴설정(g5_menu)을 사용한다.
//   반응형: <1024px 햄버거 토글.
// 로그인 상태는 피그마에 없어 사용자 결정(2026-08-27)대로: 알약 자리에 '로그아웃'(회원가입과 같은 회색 알약) + 승인 파트너 '파트너 포탈',
//   super '관리자'·'시스템 관리자' 밑줄 텍스트 링크. 건수 배지는 견적관리 화면(103:2659) 헤더의 파란 pill. 스타일은 css/default.css 헤더 블록.
$sp_hd_ico = G5_THEME_URL.'/img/header';
$sp_header_labels = array('PCB 설계' => '개발', 'PCB 주문' => 'PCB', '부품 주문' => '전자 부품', 'PCBA 주문' => 'PCBA');
$sp_header_keys = array('개발' => 'develop', 'PCB' => 'pcb', '전자 부품' => 'parts', 'PCBA' => 'pcba', '회사소개' => 'company', '블로그' => 'blog');
$sp_company_labels = array('about us' => 'About US', 'history' => 'History', 'location' => 'Location');
$sp_header_path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
?>
<div id="hd">
    <h1 id="hd_h1"><?php echo $g5['title'] ?></h1>
    <div id="skip_to_container"><a href="#container">본문 바로가기</a></div>

    <header class="sp-header">
        <div class="sp-inner sp-header__bar">
            <button type="button" class="sp-gnb-toggle" aria-expanded="false" aria-controls="gnb">
                <i class="fa fa-bars" aria-hidden="true"></i><span class="sound_only">전체메뉴 열기</span>
            </button>

            <a href="<?php echo G5_URL ?>/" class="sp-logo"><img src="<?php echo $sp_hd_ico; ?>/logo.png" width="177" height="30" alt="<?php echo get_text($config['cf_title']); ?>"></a>

            <nav class="sp-gnb" id="gnb">
                <h2 class="sound_only">메인메뉴</h2>
                <ul class="sp-gnb__list">
                    <?php
                    $menu_datas = get_menu_db(0, true);
                    $menu_count = 0;
                    foreach ($menu_datas as $row) {
                        if (empty($row)) continue;
                        $sp_menu_label = isset($sp_header_labels[$row['me_name']]) ? $sp_header_labels[$row['me_name']] : $row['me_name'];
                        $sp_menu_key = isset($sp_header_keys[$sp_menu_label]) ? $sp_header_keys[$sp_menu_label] : '';
                        $sp_submenus = array();
                        foreach ((array) ($row['sub'] ?? array()) as $sp_sub) {
                            if (empty($sp_sub)) continue;
                            if ($sp_menu_key === 'company') {
                                $sp_sub_key = strtolower(trim($sp_sub['me_name']));
                                if (!isset($sp_company_labels[$sp_sub_key])) continue;
                                $sp_sub['me_name'] = $sp_company_labels[$sp_sub_key];
                            }
                            $sp_submenus[] = $sp_sub;
                        }
                        $has_sub = !empty($sp_submenus);
                        $menu_count++;
                        $sp_sub_id = 'sp-gnb-sub-'.$menu_count;
                        $sp_current_sub = -1;
                        foreach ($sp_submenus as $sp_sub_index => $sp_sub) {
                            if (parse_url($sp_sub['me_link'], PHP_URL_PATH) === $sp_header_path && !parse_url($sp_sub['me_link'], PHP_URL_FRAGMENT)) $sp_current_sub = $sp_sub_index;
                        }
                    ?>
                    <li class="sp-gnb__item<?php echo $has_sub ? ' has-sub' : ''; ?>" data-menu="<?php echo $sp_menu_key; ?>">
                        <a href="<?php echo $row['me_link']; ?>" target="_<?php echo $row['me_target']; ?>" class="sp-gnb__link"<?php if ($has_sub) { ?> aria-expanded="false" aria-controls="<?php echo $sp_sub_id; ?>"<?php } ?>><span><?php echo get_text($sp_menu_label); ?></span><?php if ($has_sub) { ?><span class="sp-gnb__chevron" aria-hidden="true"><img src="<?php echo $sp_hd_ico; ?>/ico-chevron.svg" width="10" height="6" alt=""></span><?php } ?></a>
                        <?php if ($has_sub) { ?>
                        <ul class="sp-gnb__sub" id="<?php echo $sp_sub_id; ?>">
                            <?php foreach ($sp_submenus as $sp_sub_index => $row2) { ?>
                            <li><a href="<?php echo $row2['me_link']; ?>" target="_<?php echo $row2['me_target']; ?>"<?php if ($sp_current_sub === $sp_sub_index) { ?> aria-current="page"<?php } else if ($sp_current_sub === -1 && $sp_sub_index === 0) { ?> class="is-default"<?php } ?>><?php echo get_text($row2['me_name']); ?></a></li>
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
                    <a href="<?php echo G5_BBS_URL ?>/register.php" class="sp-util__link sp-util__signup">회원가입</a>
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
        var $items = $(".sp-gnb .has-sub");
        var desktop = window.matchMedia("(min-width: 1024px)");
        function setOpen($item, open) {
            $item.toggleClass("is-open", open).children(".sp-gnb__link").attr("aria-expanded", open ? "true" : "false");
        }
        function openItem($item) {
            setOpen($items.not($item), false);
            setOpen($item, true);
        }
        $(".sp-gnb-toggle").on("click", function() {
            var opened = $("#hd").toggleClass("gnb-open").hasClass("gnb-open");
            $(this).attr("aria-expanded", opened ? "true" : "false");
            if (!opened) setOpen($items, false);
        });
        $items.on("mouseenter focusin", function() {
            if (desktop.matches) openItem($(this));
        }).on("mouseleave", function() {
            if (desktop.matches && !this.contains(document.activeElement)) setOpen($(this), false);
        }).on("focusout", function(event) {
            if (!this.contains(event.relatedTarget)) setOpen($(this), false);
        });
        // 모바일에서 하위메뉴가 있는 1차 메뉴는 첫 탭에 하위를 펼친다
        $(".sp-gnb .has-sub > .sp-gnb__link").on("click", function(e) {
            if (!desktop.matches) {
                var $li = $(this).parent();
                if (!$li.hasClass("is-open")) {
                    e.preventDefault();
                    openItem($li);
                }
            }
        });
        $(document).on("keydown", function(event) {
            if (event.key !== "Escape") return;
            var $opened = $items.filter(".is-open");
            if (!desktop.matches && $("#hd").hasClass("gnb-open")) $(".sp-gnb-toggle").trigger("focus");
            else if ($opened.length && $opened[0].contains(document.activeElement)) $opened.children(".sp-gnb__link").trigger("focus");
            setOpen($items, false);
            $("#hd").removeClass("gnb-open");
            $(".sp-gnb-toggle").attr("aria-expanded", "false");
        }).on("click", function(event) {
            if (!$(event.target).closest(".sp-header").length) {
                setOpen($items, false);
                $("#hd").removeClass("gnb-open");
                $(".sp-gnb-toggle").attr("aria-expanded", "false");
            }
        });
        if (desktop.addEventListener) desktop.addEventListener("change", function() {
            setOpen($items, false);
            $("#hd").removeClass("gnb-open");
            $(".sp-gnb-toggle").attr("aria-expanded", "false");
        });
    });
    </script>
</div>
