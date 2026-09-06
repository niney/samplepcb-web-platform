<?php
// samplepcb 정적 페이지 — 회사 위치
// URL: /location (루트 .htaccess 가 /spcb/pages/location.php 로 내부 리라이트)
// 디자인: Figma 「GNB > 회사 위치 (지사 선택 시, 위치 안내)」(2122:7157) 2026-09-06
//   — 스타일 theme/sp-lite/css/location.css, 에셋 theme/sp-lite/img/location/
//   — 첫 프레임(2122:6908, 지사 선택 전)은 같은 페이지의 다른 상태라 선택 완료 상태만 구현.
//   — Contact Us 폼은 제외(접수 백엔드 결정 뒤 별도 작업, docs/CONTACT_INQUIRY.md). 카드 아래 여백이 폼 자리.
// 사용자 결정(09-06): 지도는 피그마의 네이버 지도 스크린샷 대신 구글 지도 임베드(레거시 URL, 키 불필요).
// 피그마와 다르게 두거나 애매해서 기록만 한 것은 docs/FIGMA_PAGES.md.

include_once __DIR__ . '/../../common.php';

$g5['title'] = '회사 위치';
add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/location.css?ver='.G5_CSS_VER.'">', 10);
include_once(G5_THEME_PATH.'/head.php');

$img = G5_THEME_URL.'/img/location';
$img_about = G5_THEME_URL.'/img/about';

// 사무실 — 피그마 2122:7356·7331 그대로. 전화·메일은 피그마 표기(푸터의 "~1" 표기와 다름, 기록).
$sp_offices = array(
    array('name' => '본사', 'addr' => '경기도 광명시 하안로 60 광명SK테크노파크 A-1303호', 'tel' => '070-8667-1080', 'email' => 'info@samplepcb.co.kr'),
    array('name' => '공사', 'addr' => '경기도 광명시 하안로 60 광명SK테크노파크 A-1407호', 'tel' => '', 'email' => ''),
);

// 구글 지도 임베드 — 레거시 theme/samplepcb/company_v2/location.php 의 광명SK테크노파크 URL(API 키 불필요)
$sp_map_src = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3167.679791144503!2d126.89230237664097!3d37.44466857207054!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x357b61b345aab48f%3A0xabf19a0d8d18009f!2z6rSR66qFU0vthYztgazrhbjtjIztgaw!5e0!3m2!1sko!2skr!4v1716888981616!5m2!1sko!2skr';
?>
<div class="sp-loc">

    <!-- 1. 배너 (남색 620 + 점 세계지도 + 지사 선택) -->
    <section class="sp-loc__banner" aria-label="회사 위치">
        <div class="sp-inner">
            <ol class="sp-loc__crumb" aria-label="현재 위치">
                <li><a href="<?php echo G5_URL; ?>/">Home</a></li>
                <li aria-hidden="true"><img src="<?php echo $img_about; ?>/ico-chevron.svg" alt=""></li>
                <li aria-current="page">회사위치</li>
            </ol>

            <div class="sp-loc__dots" aria-hidden="true">
                <img src="<?php echo $img; ?>/world-dots.svg" alt="" width="917" height="534">
                <span class="sp-loc__glow"><i class="sp-loc__glow-1"></i><i class="sp-loc__glow-2"></i><i class="sp-loc__glow-3"></i></span>
            </div>

            <h1 class="sp-loc__title">Office Location</h1>
            <p class="sp-loc__sub">We are a global SamplePCB company.<br>We have offices worldwide coordinating regional sales and support activities.</p>

            <form class="sp-loc__search" action="" method="get" onsubmit="return false">
                <label class="sp-loc__field">
                    <span class="sp-loc__label">Search the office</span>
                    <span class="sp-loc__select"><select name="region" aria-label="대륙"><option value="east-asia">East Asia</option></select></span>
                </label>
                <label class="sp-loc__field">
                    <span class="sp-loc__label">Search the office</span>
                    <span class="sp-loc__select"><select name="country" aria-label="국가"><option value="kr">Republic of Korea</option></select></span>
                </label>
            </form>
        </div>
    </section>

    <!-- 2. 위치 안내 카드 (배너 하단에 98px 걸침) + 지도 -->
    <section class="sp-inner sp-loc__card" aria-label="SamplePCB 위치 안내">
        <div class="sp-loc__info">
            <h2 class="sp-loc__card-title"><b>SamplePCB</b>&nbsp; 위치 안내</h2>
            <?php foreach ($sp_offices as $sp_o) { ?>
            <div class="sp-loc__office">
                <h3><?php echo $sp_o['name']; ?></h3>
                <ul>
                    <li class="sp-loc__addr"><?php echo $sp_o['addr']; ?></li>
                    <?php if ($sp_o['tel'] !== '') { ?><li><img src="<?php echo $img; ?>/ico-phone.svg" alt="전화" width="24" height="24"><span><?php echo $sp_o['tel']; ?></span></li><?php } ?>
                    <?php if ($sp_o['email'] !== '') { ?><li><img src="<?php echo $img; ?>/ico-mail.svg" alt="이메일" width="24" height="24"><span><?php echo $sp_o['email']; ?></span></li><?php } ?>
                </ul>
            </div>
            <?php } ?>
        </div>
        <div class="sp-loc__map">
            <iframe src="<?php echo $sp_map_src; ?>" title="광명SK테크노파크 지도" width="700" height="650" style="border:0" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
        </div>
    </section>

</div>
<?php
include_once(G5_THEME_PATH.'/tail.php');
