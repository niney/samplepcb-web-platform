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
            <?php if ((!$bo_table || $w == 's' ) && !defined('_INDEX_')) { ?><div id="wrapper_title"><?php echo $g5['title'] ?></div><?php } ?>
