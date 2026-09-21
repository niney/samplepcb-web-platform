<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 — 숫자로 보는 SamplePCB (Figma 「웹 메인」 2286:2319 Group 1000008897, y 7095~7606 · 511px, 흰 배경)
 *   제목 40px("숫자로 보는 " Regular + "SamplePCB" Bold) + 통계 3칸(수치 64px Medium / 라벨 28px #2e2e2e, 라벨 위에 수치 가운데 정렬)
 *   ⚠ 수치·라벨은 피그마 자리표시 그대로 — 운영 배포 전 실수치로 교체($sp_home_stats, 회사 연혁 history.php 의 $sp_stats 와 같은 관례).
 *   스타일: css/home.css. js/home/stats.js가 화면 진입 시 카운트업·등장 효과를 적용한다.
 *   원래 수치는 항상 HTML에 남겨 JS 미사용·동작 줄이기·스크린리더에서도 최종값을 제공한다.
 */
$sp_home_stats = array(
    array('6,600+',  'Customers Served'),
    array('17,000+', 'Quotes Generated'),
    array('70%',     'Repeat Customer Rate'),
);
?>
<section class="sp-stats" id="sp-stats" aria-label="숫자로 보는 SamplePCB">
    <div class="sp-inner">
        <div class="sp-stats__body">
            <h2 class="sp-stats__title">숫자로 보는 <b>SamplePCB</b></h2>
            <ul class="sp-stats__list">
            <?php foreach ($sp_home_stats as $sp_s) { ?>
                <li class="sp-stats__item">
                    <b class="sp-stats__num"><span class="sp-stats__value"><?php echo $sp_s[0]; ?></span></b>
                    <span class="sp-stats__label"><?php echo $sp_s[1]; ?></span>
                </li>
            <?php } ?>
            </ul>
        </div>
    </div>
</section>
