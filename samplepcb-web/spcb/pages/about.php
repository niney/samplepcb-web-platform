<?php
// 회사소개 /about — Figma 2122:6136, 2026-09-21 갱신(본문 2337:36242~36586).
// 배너·문제 5종·원스톱 플랫폼·Why SamplePCB. 공용 헤더/푸터는 테마를 재사용한다.
include_once __DIR__ . '/../../common.php';

$g5['title'] = '회사소개';
add_stylesheet('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Questrial&display=swap">', 9);
add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/about.css?ver='.G5_CSS_VER.'">', 10);
include_once(G5_THEME_PATH.'/head.php');

$img = G5_THEME_URL.'/img/about';
$sp_about_problems = array(
    'PCB 설계 오류<br>사전 검토의 어려움',
    '부품 재고·가격 변동<br>대응의 어려움',
    '신뢰할 수 있는<br>제조사 탐색의 어려움',
    '제작 전 오류 검토와<br>품질관리의 어려움',
    '전문 개발·제조<br>파트너 정보 부족',
);
$sp_about_services = array(
    array('title' => '회로·PCB 설계', 'detail' => '회로 설계부터 PCB Artwork까지', 'image' => 'card-01.jpg', 'alt' => ''),
    array('title' => 'PCB제작', 'detail' => '온라인 견적 및 PCB 주문', 'image' => 'card-02.jpg', 'alt' => ''),
    array('title' => '부품 조달', 'detail' => 'Smart BOM 기반<br>재고·가격 확인 및 부품 주문', 'image' => 'card03-logos-2x.png', 'alt' => '유니키·Avnet·DigiKey·Mouser·Nordic 유통사 로고'),
    array('title' => 'PCB 조립', 'detail' => '부품 실장부터 완성 보드 제작까지', 'image' => 'card-04.jpg', 'alt' => ''),
);
$sp_about_benefits = array(
    array('title' => '업무 시간 단축', 'detail' => '온라인 견적과 간편 주문으로<br>반복 업무를 줄입니다.'),
    array('title' => '개발 리소스 절감', 'detail' => '필요한 설계·조달·생산 업무를<br>효율적으로 지원합니다.'),
    array('title' => '합리적인 비용', 'detail' => '제조·유통 네트워크를 기반으로<br>경쟁력 있는 견적을 제공합니다.'),
    array('title' => '체계적인 품질관리', 'detail' => '제작 진행부터 품질 확인까지<br>전문적으로 관리합니다.'),
);
?>
<div class="sp-about">
    <section class="sp-about__banner" aria-label="회사소개">
        <div class="sp-inner">
            <ol class="sp-about__crumb" aria-label="현재 위치">
                <li><a href="<?php echo G5_URL; ?>/">Home</a></li>
                <li aria-hidden="true"><img src="<?php echo $img; ?>/ico-chevron.svg" alt=""></li>
                <li aria-current="page">회사소개</li>
            </ol>
            <h1 class="sp-about__title">About<b>SamplePCB</b></h1>
            <p class="sp-about__sub">전자제품 개발과 제조를 연결하는 One-Stop 플랫폼</p>
        </div>
    </section>

    <section class="sp-inner sp-about__box sp-about__intro" aria-label="PCB 제작의 문제점">
        <img class="sp-about__mag" src="<?php echo $img; ?>/ico-magnifier-2x.png" alt="" width="80" height="80">
        <p class="sp-about__slogan">PCB는 다양한 산업에 필수적으로 사용되지만,<br>설계부터 부품 조달, 제작과 조립까지 여전히 많은 시간과 반복 업무가 필요합니다.</p>
        <ol class="sp-about__probs">
            <?php foreach ($sp_about_problems as $sp_index => $sp_problem) { ?>
            <li><i aria-hidden="true"><?php echo $sp_index + 1; ?></i><img src="<?php echo $img; ?>/prob-<?php echo $sp_index + 1; ?>.svg" alt=""><p><?php echo $sp_problem; ?></p></li>
            <?php } ?>
        </ol>
    </section>

    <section class="sp-inner sp-about__box sp-about__platform" aria-label="PCB ONE-STOP 제조플랫폼">
        <div class="sp-about__lead">
            <img class="sp-about__lead-art" src="<?php echo $img; ?>/platform-lead.svg" alt="" width="960" height="115">
            <div class="sp-about__lead-text">
                <h2>PCB ONE-STOP 제조플랫폼 ㈜샘플피씨비는</h2>
                <p>PCB제조과정중 단순 반복업무가 개선되지 않고 있어,<br><b>업무 개선과 Digital Transformation 전환을 위한 혁신</b>을 이루고자 서비스를 시작하였습니다.</p>
            </div>
        </div>
        <div class="sp-about__diagram">
            <div class="sp-about__ring-wrap">
                <img class="sp-about__ring" src="<?php echo $img; ?>/ring-2x.png" alt="설계·제작·부품 조달·조립을 연결하는 원스톱 플랫폼">
                <div class="sp-about__center">
                    <img src="<?php echo $img; ?>/logo-round-2x.png" alt="PCB 온라인 플랫폼 SAMPLEPCB">
                    <h3>PCB ONE-STOP<br>제조 플랫폼</h3>
                    <p>설계부터 부품 조달, PCB 제작과 조립까지<br>하나의 플랫폼에서 연결합니다.</p>
                </div>
                <span class="sp-about__dot sp-about__dot--1" aria-hidden="true"></span>
                <span class="sp-about__dot sp-about__dot--2" aria-hidden="true"></span>
                <span class="sp-about__dot sp-about__dot--3" aria-hidden="true"></span>
                <span class="sp-about__dot sp-about__dot--4" aria-hidden="true"></span>
            </div>
            <?php foreach ($sp_about_services as $sp_index => $sp_service) { ?>
            <article class="sp-about__ocard sp-about__ocard--<?php echo $sp_index + 1; ?>">
                <i aria-hidden="true">0<?php echo $sp_index + 1; ?></i>
                <h3><?php echo $sp_service['title']; ?></h3>
                <p><?php echo $sp_service['detail']; ?></p>
                <span class="sp-about__ocard-img"><img src="<?php echo $img.'/'.$sp_service['image']; ?>" alt="<?php echo $sp_service['alt']; ?>"></span>
            </article>
            <?php } ?>
        </div>
        <div class="sp-about__our">
            <h2 class="sp-about__our-head"><span><img class="sp-about__star" src="<?php echo $img; ?>/ico-star.svg" alt="" width="28" height="28">Why SamplePCB</span></h2>
            <p>온라인에서 견적과 주문을 간편하게 진행하고, 검증된 제조·유통 네트워크를 통해 합리적인 비용과 안정적인 품질을 제공합니다.<br>SamplePCB가 제작 진행과 품질관리를 지원하여 고객이 제품 개발에 집중할 수 있도록 돕습니다.</p>
        </div>
        <ul class="sp-about__sols">
            <?php foreach ($sp_about_benefits as $sp_index => $sp_benefit) { ?>
            <li><img src="<?php echo $img; ?>/sol-<?php echo $sp_index + 1; ?>.svg" alt=""><h3><?php echo $sp_benefit['title']; ?></h3><p><?php echo $sp_benefit['detail']; ?></p></li>
            <?php } ?>
        </ul>
    </section>
</div>
<?php include_once(G5_THEME_PATH.'/tail.php'); ?>
