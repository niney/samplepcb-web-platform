<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: G5_THEME_DEVICE='pc' → 모든 기기가 이 파일을 사용(반응형 CSS로 대응). 모바일 분기 없음.

if(G5_COMMUNITY_USE === false) {
    define('G5_IS_COMMUNITY_PAGE', true);
    include_once(G5_THEME_SHOP_PATH.'/shop.head.php');
    return;
}
include_once(G5_THEME_PATH.'/head.sub.php');

// 콘텐츠/스킨 호환용 lib (index.php의 latest() 등에서 사용)
include_once(G5_LIB_PATH.'/latest.lib.php');
include_once(G5_LIB_PATH.'/outlogin.lib.php');
include_once(G5_LIB_PATH.'/poll.lib.php');
include_once(G5_LIB_PATH.'/visit.lib.php');
include_once(G5_LIB_PATH.'/connect.lib.php');
include_once(G5_LIB_PATH.'/popular.lib.php');

if(defined('_INDEX_')) { // index에서만 실행
    include G5_BBS_PATH.'/newwin.inc.php'; // 팝업레이어
}

include_once(G5_THEME_PATH.'/inc/header.php'); // 공용 헤더
?>

<!-- 콘텐츠 시작 { -->
<div id="wrapper">
    <main id="container">
        <?php if (!defined("_INDEX_")) { ?><h2 id="container_title"><span title="<?php echo get_text($g5['title']); ?>"><?php echo get_head_title($g5['title']); ?></span></h2><?php } ?>
