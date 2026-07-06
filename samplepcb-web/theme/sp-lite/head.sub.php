<?php
// 이 파일은 새로운 파일 생성시 반드시 포함되어야 함
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

$g5_debug['php']['begin_time'] = $begin_time = get_microtime();

if (!isset($g5['title'])) {
    $g5['title'] = $config['cf_title'];
    $g5_head_title = $g5['title'];
}
else {
    // 상태바에 표시될 제목
    $g5_head_title = implode(' | ', array_filter(array($g5['title'], $config['cf_title'])));
}

$g5['title'] = strip_tags($g5['title']);
$g5_head_title = strip_tags($g5_head_title);

// 현재 접속자
// 게시판 제목에 ' 포함되면 오류 발생
$g5['lo_location'] = addslashes($g5['title']);
if (!$g5['lo_location'])
    $g5['lo_location'] = addslashes(clean_xss_tags($_SERVER['REQUEST_URI']));
$g5['lo_url'] = addslashes(clean_xss_tags($_SERVER['REQUEST_URI']));
if (strstr($g5['lo_url'], '/'.G5_ADMIN_DIR.'/') || $is_admin == 'super') $g5['lo_url'] = '';

/*
// 만료된 페이지로 사용하시는 경우
header("Cache-Control: no-cache"); // HTTP/1.1
header("Expires: 0"); // rfc2616 - Section 14.21
header("Pragma: no-cache"); // HTTP/1.0
*/

// sp-lite: 계정 팝업 페이지(포인트·쿠폰·쪽지·스크랩)를 인라인 계정 레이아웃으로 승격 (로그인 회원·PC 한정).
// 코어(bbs/point.php·shop/coupon.php·bbs/memo*.php·bbs/scrap.php)는 비수정 — 여기서 표현만 승격한다.
// point/coupon/memo/memo_view/scrap 은 라이브 팝업 진입점이 없어 무조건 인라인.
// memo_form.php 는 코어 lib(get_sideview)의 전역 "쪽지보내기" 팝업과 이중 역할이라 ?inline=1 마커일 때만 승격.
$sp_inline_map = array(
    'point.php'     => 'point',
    'coupon.php'    => 'coupon',
    'memo.php'      => 'memo',
    'memo_view.php' => 'memo',
    'scrap.php'     => 'scrap',
);
// 계정 스킨(sp-acc 마크업)을 쓰는 페이지 — memo_form 은 마커 없이(팝업)도 여기 포함해 CSS 는 항상 로드.
$sp_acc_pages      = array('point.php', 'coupon.php', 'memo.php', 'memo_view.php', 'scrap.php', 'memo_form.php');
$sp_cur_sub        = basename($_SERVER['SCRIPT_NAME']);
$sp_account_active = '';
$sp_inline_account = false;                                                   // 계정 레이아웃(사이드바) 승격 여부
$sp_acc_css        = false;                                                   // default_shop.css(sp-acc 스타일) 로드 여부
if (!empty($member['mb_id']) && !G5_IS_MOBILE) {
    $sp_acc_css = in_array($sp_cur_sub, $sp_acc_pages, true);
    if (isset($sp_inline_map[$sp_cur_sub])) {
        $sp_inline_account = true;
        $sp_account_active = $sp_inline_map[$sp_cur_sub];
    } else if ($sp_cur_sub === 'memo_form.php' && isset($_GET['inline']) && $_GET['inline'] === '1') {
        $sp_inline_account = true;
        $sp_account_active = 'memo';
    }
}
?>
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" id="meta_viewport" content="width=device-width,initial-scale=1">
<meta name="format-detection" content="telephone=no">
<?php
if($config['cf_add_meta'])
    echo $config['cf_add_meta'].PHP_EOL;
?>
<title><?php echo $g5_head_title; ?></title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<?php
// sp-lite: default.css를 항상 로드하고, 쇼핑몰 페이지는 default_shop.css를 추가 로드
echo '<link rel="stylesheet" href="'.run_replace('head_css_url', G5_THEME_CSS_URL.'/default.css?ver='.G5_CSS_VER, G5_THEME_URL).'">'.PHP_EOL;
if (defined('_SHOP_') || $sp_acc_css) // sp-lite: 계정 스킨(sp-acc) 페이지는 bbs 경로·팝업이어도 default_shop.css 필요
    echo '<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/default_shop.css?ver='.G5_CSS_VER.'">'.PHP_EOL;
?>
<script>
// 자바스크립트에서 사용하는 전역변수 선언
var g5_url       = "<?php echo G5_URL ?>";
var g5_bbs_url   = "<?php echo G5_BBS_URL ?>";
var g5_is_member = "<?php echo isset($is_member)?$is_member:''; ?>";
var g5_is_admin  = "<?php echo isset($is_admin)?$is_admin:''; ?>";
var g5_is_mobile = "<?php echo G5_IS_MOBILE ?>";
var g5_bo_table  = "<?php echo isset($bo_table)?$bo_table:''; ?>";
var g5_sca       = "<?php echo isset($sca)?$sca:''; ?>";
var g5_editor    = "<?php echo ($config['cf_editor'] && $board['bo_use_dhtml_editor'])?$config['cf_editor']:''; ?>";
var g5_cookie_domain = "<?php echo G5_COOKIE_DOMAIN ?>";
<?php if (defined('G5_USE_SHOP') && G5_USE_SHOP) { ?>
var g5_theme_shop_url = "<?php echo G5_THEME_SHOP_URL; ?>";
var g5_shop_url = "<?php echo G5_SHOP_URL; ?>";
<?php } ?>
<?php if(defined('G5_IS_ADMIN')) { ?>
var g5_admin_url = "<?php echo G5_ADMIN_URL; ?>";
<?php } ?>
</script>
<?php
add_javascript('<script src="'.G5_JS_URL.'/jquery-1.12.4.min.js"></script>', 0);
add_javascript('<script src="'.G5_JS_URL.'/jquery-migrate-1.4.1.min.js"></script>', 0);
// sp-lite: jquery.menu.js / jquery.shop.menu.js 제거 — GNB는 CSS(:hover) + 자체 토글로 동작
add_javascript('<script src="'.G5_JS_URL.'/common.js?ver='.G5_JS_VER.'"></script>', 0);
add_javascript('<script src="'.G5_JS_URL.'/wrest.js?ver='.G5_JS_VER.'"></script>', 0);
// sp-lite: placeholders.min.js 제거 (IE9 이하 placeholder 폴리필 — 모던 브라우저는 네이티브 지원)
add_stylesheet('<link rel="stylesheet" href="'.G5_JS_URL.'/font-awesome/css/font-awesome.min.css">', 0);

if(!defined('G5_IS_ADMIN'))
    echo $config['cf_add_script'];
?>
</head>
<body<?php echo isset($g5['body_script']) ? $g5['body_script'] : ''; ?>>
<?php
if ($is_member) { // 회원이라면 로그인 중이라는 메세지를 출력해준다.
    $sr_admin_msg = '';
    if ($is_admin == 'super') $sr_admin_msg = "최고관리자 ";
    else if ($is_admin == 'group') $sr_admin_msg = "그룹관리자 ";
    else if ($is_admin == 'board') $sr_admin_msg = "게시판관리자 ";

    echo '<div id="hd_login_msg">'.$sr_admin_msg.get_text($member['mb_nick']).'님 로그인 중 ';
    echo '<a href="'.G5_BBS_URL.'/logout.php">로그아웃</a></div>';
}

// sp-lite: 인라인 계정 레이아웃 오프너 — 팝업 베어 대신 GNB + 계정 사이드바로 감싼다(tail.sub 가 대칭으로 닫음).
if ($sp_inline_account) {
    // inc/header.php(GNB) 및 콘텐츠/스킨 호환 lib (head.php 와 동일 세트)
    include_once(G5_LIB_PATH.'/outlogin.lib.php');
    include_once(G5_LIB_PATH.'/poll.lib.php');
    include_once(G5_LIB_PATH.'/visit.lib.php');
    include_once(G5_LIB_PATH.'/connect.lib.php');
    include_once(G5_LIB_PATH.'/popular.lib.php');
    include_once(G5_LIB_PATH.'/latest.lib.php');
    include_once(G5_THEME_PATH.'/inc/header.php'); // 공용 헤더(GNB)
    define('SP_INLINE_ACCOUNT', true);
?>
<div id="wrapper">
    <div id="container" class="is-account">
        <div id="aside" class="account-aside">
            <?php include G5_THEME_SHOP_PATH.'/_account_nav.php'; ?>
        </div>
        <div class="shop-content account-main">
            <div id="wrapper_title"><?php echo $g5['title']; ?></div>
<?php
}