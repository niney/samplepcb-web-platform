<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 — 도움이 필요하신가요? (Figma 「웹 메인」 2286:2134 Group 1000008814, y 8326~9049 · 723px, 흰 배경)
 *   제목(42px) → [FAQ 카드 332 | Q&A 카드(제목·더보기 + 최신 3건: "Q." 제목 날짜)] → [공지 한 줄: "공지" 제목 날짜 더보기]
 *   데이터: 게시판 qa(3건)·notice(1건) → latest('theme/home-help', …), 스킨 skin/latest/home-help/latest.skin.php 가 $bo_table 별 마크업.
 *   FAQ 카드는 피그마 문구만(목록 없음). 링크: 더보기는 비움(사용자 결정) — $sp_help_more 에 URL 을 넣으면 <a>. 글 제목은 글 보기 링크.
 *   ⚠ latest() 는 1시간 캐시(data/cache/latest-*-home-help-*.php) — 스킨을 고치면 지울 것.
 *   스타일: css/home/42-help.css
 */
$sp_help_more = array('faq' => '', 'qa' => '', 'notice' => '');   // 예: get_pretty_url('qa')
if (!function_exists('sp_help_more')) {
    function sp_help_more($url, $class = 'sp-help__more') {
        if ($url) return '<a href="'.$url.'" class="'.$class.'">더보기 →</a>';
        return '<span class="'.$class.'">더보기 →</span>';
    }
}
$sp_hh = G5_THEME_URL.'/img/home/help';
?>
<section class="sp-help" aria-label="도움이 필요하신가요?">
    <div class="sp-inner">
        <h2 class="sp-help__title">도움이 필요하신가요?</h2>

        <div class="sp-help__row">
            <!-- FAQ 카드 (2286:2148) -->
            <div class="sp-help__card sp-help__faq">
                <div class="sp-help__head">
                    <img src="<?php echo $sp_hh; ?>/ico-faq.png" width="60" height="60" alt="">
                    <h3 class="sp-help__h">FAQ</h3>
                </div>
                <p class="sp-help__desc">고객들이 주문 시, 자주 묻는 질문과 답변을 찾아보세요. </p>
                <?php echo sp_help_more($sp_help_more['faq']); ?>
            </div>

            <!-- Q&A 카드 (2286:2157) — 최신 3건 -->
            <div class="sp-help__card sp-help__qa">
                <div class="sp-help__head sp-help__head--between">
                    <div class="sp-help__head-l">
                        <img src="<?php echo $sp_hh; ?>/ico-qa.png" width="54" height="54" alt="">
                        <h3 class="sp-help__h">Q&amp;A</h3>
                    </div>
                    <?php echo sp_help_more($sp_help_more['qa']); ?>
                </div>
                <?php echo latest('theme/home-help', 'qa', 3, 40); ?>
            </div>
        </div>

        <!-- 공지 한 줄 (2286:2212) — 최신 1건 -->
        <div class="sp-help__card sp-help__notice">
            <div class="sp-help__nt">
                <b class="sp-help__nt-label">공지</b>
                <?php echo latest('theme/home-help', 'notice', 1, 60); ?>
                <?php echo sp_help_more($sp_help_more['notice']); ?>
            </div>
        </div>
    </div>
</section>
