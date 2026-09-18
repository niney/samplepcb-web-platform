<?php
if (!defined('_INDEX_')) define('_INDEX_', true);
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

if(G5_COMMUNITY_USE === false) {
    include_once(G5_THEME_SHOP_PATH.'/index.php');
    return;
}

/*
 * 홈(/) — Figma 「웹 메인」(2286:1275, 1920×9395) 2026-09-18 (디자이너 9/17 "웹메인 컨텐츠 업데이트 — 상단배너·컨텐츠 전반")
 *   섹션(피그마 y 기준, 헤더 72 포함):
 *     0 ~  666  히어로 슬라이더 5장(banner 01~05)            inc/main_slider.php
 *   666 ~ 2052  Transforming Electronics Manufacturing + One-Stop Manufacturing 탭   inc/home/10-onestop.php
 *  2052 ~ 4856  3 EYES(Gerber Eyes 4.0 · Parts Eyes 2.0 · SMT Eyes)                inc/home/20-eyes.php
 *  4855 ~ 7095  Your Idea. Our Expertise. 프로세스 5단계 + Development Portfolio     inc/home/30-idea.php
 *  7095 ~ 7606  숫자로 보는 SamplePCB                                                inc/home/40-stats.php
 *  7606 ~ 8326  Our Network(고객·파트너 로고)                                        inc/home/41-network.php
 *  8326 ~ 9049  도움이 필요하신가요?(FAQ · Q&A · 공지)                                inc/home/42-help.php
 *  9049 ~ 9395  공용 푸터                                                            inc/footer.php(tail.php)
 *   스타일: css/home.css(홈 전용 — 개발 중엔 css/home/NN-*.css 부분 파일을 순서대로 로드) · 스크립트: js/home.js(진입) + js/home/*.js(섹션 모듈)
 *   원칙: 데스크톱(≥1280)은 피그마 좌표 그대로, 1023px 이하는 피그마에 없어 우리 정의. 링크는 비움(사용자 결정, 연결은 별도 작업).
 *   피그마와 다르게 둔 것·미결은 docs/FIGMA_PAGES.md 에 적는다.
 */
add_stylesheet('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap">', 5);

// CSS — css/home/ 에 부분 파일이 있으면(개발 중) 이름순으로 전부, 없으면(병합 뒤) home.css 하나
$sp_home_css_parts = glob(G5_THEME_PATH.'/css/home/*.css');
if ($sp_home_css_parts) {
    foreach ($sp_home_css_parts as $sp_i => $sp_f) {
        add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/home/'.basename($sp_f).'?ver='.G5_CSS_VER.'">', 10 + $sp_i);
    }
} else {
    add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/home.css?ver='.G5_CSS_VER.'">', 10);
}

include_once(G5_THEME_PATH.'/head.php');

$sp_hi = G5_THEME_URL.'/img/home';
?>
<div class="sp-home">

    <!-- 히어로 슬라이더 5장(피그마 banner 01~05) + 배너관리 이미지 -->
    <?php include G5_THEME_PATH.'/inc/main_slider.php'; ?>

    <?php
    // 섹션 부분 파일 — 파일명 앞 번호 순서 = 피그마 순서
    // ($sp_hi 는 main_slider.php 가 img/home/hero 로 바꿔 쓰므로 부분 파일마다 img/home 으로 되돌린다)
    foreach ((array) glob(G5_THEME_PATH.'/inc/home/*.php') as $sp_home_part) {
        $sp_hi = G5_THEME_URL.'/img/home';
        include $sp_home_part;
    }
    ?>

</div>
<script type="module" src="<?php echo G5_THEME_URL; ?>/js/home.js?ver=<?php echo G5_JS_VER; ?>"></script>

<?php
include_once(G5_THEME_PATH.'/tail.php');
