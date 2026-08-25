<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가

// sp-lite: G5_THEME_DEVICE='pc' → 모든 기기가 이 파일을 사용(반응형 CSS로 대응). 모바일 분기 없음.

$q = isset($_GET['q']) ? clean_xss_tags($_GET['q'], 1, 1) : '';

include_once(G5_THEME_PATH.'/head.sub.php');

// 콘텐츠/스킨 호환용 lib
include_once(G5_LIB_PATH.'/outlogin.lib.php');
include_once(G5_LIB_PATH.'/poll.lib.php');
include_once(G5_LIB_PATH.'/visit.lib.php');
include_once(G5_LIB_PATH.'/connect.lib.php');
include_once(G5_LIB_PATH.'/popular.lib.php');
include_once(G5_LIB_PATH.'/latest.lib.php');

// 쇼핑몰 메인 스킨(main.*.skin.php)이 아직 owl carousel 사용 — shop 스킨 재작성 때 Swiper로 교체 예정
add_javascript('<script src="'.G5_JS_URL.'/owlcarousel/owl.carousel.min.js"></script>', 10);
add_stylesheet('<link rel="stylesheet" href="'.G5_JS_URL.'/owlcarousel/owl.carousel.css">', 0);

if(defined('_INDEX_')) { // index에서만 실행
    include G5_BBS_PATH.'/newwin.inc.php'; // 팝업레이어
}

include_once(G5_THEME_PATH.'/inc/header.php'); // 공용 헤더

$wrapper_class = array();
if( defined('G5_IS_COMMUNITY_PAGE') && G5_IS_COMMUNITY_PAGE ){
    $wrapper_class[] = 'is_community';
}

// 계정 사이드바를 붙일 쇼핑 페이지 판별(로그인 회원 한정). 견적 페이지는 다른 head(theme/head.php)라 여기 없음.
$sp_account_pages = array(
    'mypage.php'           => 'home',
    'orderinquiry.php'     => 'orders',
    'orderinquiryview.php' => 'orders',
    'cart.php'             => 'cart',
    'wishlist.php'         => 'wish',
);
$sp_cur_script = basename($_SERVER['SCRIPT_NAME']);

// 견적 주문서(PCB·부품 BOM)에만 공급가/부가세 명세를 표시한다.
// 거버 앵커 ID는 extend/sp_quote_cart.extend.php를 단일 원본으로 사용하고,
// BOM 앵커는 sp-node TEMPLATE_ITEMS.bom과 동일하게 유지한다.
if ($sp_cur_script === 'orderform.php') {
    $sp_quote_vat_item_ids = function_exists('sp_quote_it_ids')
        ? sp_quote_it_ids()
        : array('sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex');
    $sp_quote_vat_item_ids[] = 'sp-bom-parts';
    $sp_quote_vat_config = array(
        'itemIds' => array_values(array_unique($sp_quote_vat_item_ids)),
    );

    add_javascript(
        '<script>window.spQuoteVatBreakdown='.json_encode($sp_quote_vat_config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE).';</script>',
        5
    );
    add_javascript(
        '<script src="'.G5_THEME_JS_URL.'/order-vat-breakdown.js?ver='.G5_JS_VER.'" defer></script>',
        6
    );
    // 주문서 기본값(배송지·결제수단·입금계좌)과 무통장 영역 표시 동기화 — 견적 주문에 한정하지
    // 않는다. 마찰은 코어 주문서 자체에서 오고, 상품 종류와 무관하게 모든 고객이 겪는다.
    add_javascript(
        '<script src="'.G5_THEME_JS_URL.'/orderform-defaults.js?ver='.G5_JS_VER.'" defer></script>',
        7
    );
}

$sp_account_active = (!empty($member['mb_id']) && isset($sp_account_pages[$sp_cur_script])) ? $sp_account_pages[$sp_cur_script] : '';
?>
<!-- 전체 콘텐츠 시작 { -->
<div id="wrapper" class="<?php echo implode(' ', $wrapper_class); ?>">
    <!-- #container 시작 { -->
    <div id="container"<?php echo $sp_account_active ? ' class="is-account"' : ''; ?>>

        <?php if(defined('_INDEX_')) { ?>
        <div id="aside">
            <?php include_once(G5_SHOP_SKIN_PATH.'/boxcategory.skin.php'); // 상품분류 ?>
            <?php if($default['de_type4_list_use']) { ?>
            <!-- 인기상품 시작 { -->
            <section id="side_pd">
                <h2><a href="<?php echo shop_type_url('4'); ?>">인기상품</a></h2>
                <?php
                $list = new item_list();
                $list->set_type(4);
                $list->set_view('it_id', false);
                $list->set_view('it_name', true);
                $list->set_view('it_basic', false);
                $list->set_view('it_cust_price', false);
                $list->set_view('it_price', true);
                $list->set_view('it_icon', false);
                $list->set_view('sns', false);
                $list->set_view('star', true);
                echo $list->run();
                ?>
            </section>
            <!-- } 인기상품 끝 -->
            <?php } ?>

            <?php echo display_banner('왼쪽', 'boxbanner.skin.php'); ?>
            <?php echo poll('theme/shop_basic'); // 설문조사 ?>
        </div>
        <?php } elseif($sp_account_active) { // 계정 페이지: #aside 에 공용 계정 사이드바 ?>
        <div id="aside" class="account-aside">
            <?php include G5_THEME_SHOP_PATH.'/_account_nav.php'; ?>
        </div>
        <?php } // end if ?>
        <?php
            $content_class = array('shop-content');
            if( isset($it_id) && isset($it) && isset($it['it_id']) && $it_id === $it['it_id']){
                $content_class[] = 'is_item';
            }
            if( defined('IS_SHOP_SEARCH') && IS_SHOP_SEARCH ){
                $content_class[] = 'is_search';
            }
            if( defined('_INDEX_') && _INDEX_ ){
                $content_class[] = 'is_index';
            }
        ?>
        <!-- .shop-content 시작 { -->
        <div class="<?php echo implode(' ', $content_class); ?>">
            <?php
            // 페이지 제목 보정(Figma 103:4517) — 주문내역은 아이콘 + '주문내역' 36px.
            // 코어가 $g5['title']='주문내역조회' 를 넣지만 표기는 테마 몫이다(코어 무수정).
            $sp_title_html = $g5['title'];
            $sp_title_cls  = '';
            if ($sp_cur_script === 'orderinquiry.php') {
                $sp_title_cls  = ' sp-title-lg';
                $sp_title_html = '<img class="sp-title-ico" src="'.G5_THEME_URL.'/img/account/ico-title-orders.svg" alt="">주문내역';
            } else if ($sp_cur_script === 'orderinquiryview.php') {
                // 주문 상세(Figma 103:4561) — '상세주문내역' 36px, 아이콘 없음.
                $sp_title_cls  = ' sp-title-lg';
                $sp_title_html = '상세주문내역';
            }
            ?>
            <?php if ((!$bo_table || $w == 's' ) && !defined('_INDEX_')) { ?><div id="wrapper_title" class="<?php echo trim($sp_title_cls); ?>"><?php echo $sp_title_html ?></div><?php } ?>
