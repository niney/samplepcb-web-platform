<?php
// samplepcb 정적 페이지 — 회사소개
// URL: /about (루트 .htaccess 가 /spcb/pages/about.php 로 내부 리라이트)
// 디자인: Figma 「GNB > 회사소개」(2122:6136) 2026-09-06 — 스타일 theme/sp-lite/css/about.css, 에셋 theme/sp-lite/img/about/
// 피그마 그대로 두고 나중에 고칠 문구·확인 항목은 docs/FIGMA_PAGES.md 에 적어 둠(배너 부제 미완성 문장, Customer 카드 제목·내용 불일치, 로고 사용 허락).
// 사용자 결정(09-06): 04 카드 문구만 교정(PCBA(SMT) / 부품 실장·조립), 링크는 비움, 회사소개 서브메뉴는 이후 페이지에서.

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $config, $member, 테마 상수

$g5['title'] = '회사소개';
add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/about.css?ver='.G5_CSS_VER.'">', 10);
include_once(G5_THEME_PATH.'/head.php');

$img = G5_THEME_URL.'/img/about';
?>
<div class="sp-about">

    <!-- 1. 배너 -->
    <section class="sp-about__banner" aria-label="회사소개">
        <div class="sp-inner">
            <ol class="sp-about__crumb" aria-label="현재 위치">
                <li><a href="<?php echo G5_URL; ?>/">Home</a></li>
                <li aria-hidden="true"><img src="<?php echo $img; ?>/ico-chevron.svg" alt=""></li>
                <li aria-current="page">회사소개</li>
            </ol>
            <h1 class="sp-about__title">About<b>SamplePCB</b></h1>
            <p class="sp-about__sub"><b>PCB</b>는 모든 산업에서 사용되고 </p>
        </div>
    </section>

    <!-- 2. 문제 제기 -->
    <section class="sp-inner sp-about__box sp-about__intro" aria-label="PCB 제작의 문제점">
        <img class="sp-about__mag" src="<?php echo $img; ?>/ico-magnifier-2x.png" alt="" width="80" height="80">
        <p class="sp-about__slogan"><b>PCB</b>는 모든 산업에서 사용되고 있는 필수 소재이지만, 개발에서 생산까지에는<br>많은 인력과 비용, 시간이 소요되고 있는 <b>아래와 같은 문제점은 계속 진행중</b>입니다.</p>
        <ol class="sp-about__probs">
            <li><i>1</i><img src="<?php echo $img; ?>/prob-1.svg" alt=""><p>PCB 설계상 오류<br>검증의 어려움</p></li>
            <li><i>2</i><img src="<?php echo $img; ?>/prob-2.svg" alt=""><p>부품의 재고&amp;가격<br>확인의 어려움</p></li>
            <li><i>3</i><img src="<?php echo $img; ?>/prob-3.svg" alt=""><p>신뢰할 수 있는<br>생산공장 정보부족</p></li>
            <li><i>4</i><img src="<?php echo $img; ?>/prob-4.svg" alt=""><p>사전불량 검출,<br>품질관리의 어려움</p></li>
            <li><i>5</i><img src="<?php echo $img; ?>/prob-5.svg" alt=""><p>전문성과 책임감있는<br>외주업체 정보부족</p></li>
        </ol>
    </section>

    <!-- 3. PCB ONE-STOP 제조플랫폼 -->
    <section class="sp-inner sp-about__box sp-about__platform" aria-label="PCB ONE-STOP 제조플랫폼">
        <div class="sp-about__lead">
            <h2>PCB ONE-STOP 제조플랫폼 ㈜샘플피씨비는</h2>
            <p>PCB제조과정중 단순 반복업무가 개선되지 않고 있어,<br><b>업무 개선과 Digital Transformation 전환을 위한 혁신</b>을 이루고자 서비스를 시작하였습니다.</p>
        </div>

        <div class="sp-about__diagram">
            <div class="sp-about__ring-wrap">
                <img class="sp-about__ring" src="<?php echo $img; ?>/ring-2x.png" alt="설계·제작·유통·실장이 순환하는 원스톱 플랫폼 다이어그램">
                <div class="sp-about__center">
                    <img src="<?php echo $img; ?>/logo-round-2x.png" alt="PCB 온라인 플랫폼 SAMPLEPCB">
                    <h3>PCB ONE-STOP<br>제조 플랫폼</h3>
                    <p>설계부터 제작, 유통, 실장까지<br>한 번에 해결하는 토탈 솔루션</p>
                </div>
                <span class="sp-about__dot sp-about__dot--1" aria-hidden="true"></span>
                <span class="sp-about__dot sp-about__dot--2" aria-hidden="true"></span>
                <span class="sp-about__dot sp-about__dot--3" aria-hidden="true"></span>
                <span class="sp-about__dot sp-about__dot--4" aria-hidden="true"></span>
            </div>
            <article class="sp-about__ocard sp-about__ocard--1">
                <i>01</i>
                <h3>회로설계</h3>
                <p>회로 및 PCB 설계</p>
                <span class="sp-about__ocard-img"><img src="<?php echo $img; ?>/card-01.jpg" alt=""></span>
            </article>
            <article class="sp-about__ocard sp-about__ocard--2">
                <i>02</i>
                <h3>PCB제작</h3>
                <p>온라인 견적시스템</p>
                <span class="sp-about__ocard-img"><img src="<?php echo $img; ?>/card-02.jpg" alt=""></span>
            </article>
            <article class="sp-about__ocard sp-about__ocard--3">
                <i>03</i>
                <h3>부품유통</h3>
                <p>150여 유통사 실시간<br>재고검색 S/W Smart BOM</p>
                <span class="sp-about__ocard-img"><img src="<?php echo $img; ?>/card03-logos-2x.png" alt="유니키·Avnet·DigiKey·Mouser·Nordic 유통사 로고"></span>
            </article>
            <article class="sp-about__ocard sp-about__ocard--4">
                <i>04</i>
                <h3>PCBA(SMT)</h3>
                <p>부품 실장·조립</p>
                <span class="sp-about__ocard-img"><img src="<?php echo $img; ?>/card-04.jpg" alt=""></span>
            </article>
        </div>

        <div class="sp-about__our">
            <h2 class="sp-about__our-head"><span><i class="sp-about__star" aria-hidden="true"></i>Our Solution</span></h2>
            <p>언제 어디서나 손쉽게 주문 할 수 있어 시간이 절약되고, 필요한 부분 외주처리를 함으로써 인원절감을 할 수 있고, 전세계 생산, 유통업체와 협력으로 경쟁력 있는 가격으로 대응 함으로써 비용절감을 할 수 있으며, 전문적인 생산관리와 품질관리를 통해 고객은 매우 편리함을 제공 받을 수 있습니다.</p>
        </div>
        <ul class="sp-about__sols">
            <li><img src="<?php echo $img; ?>/sol-1.svg" alt=""><h3>시간 절약</h3><p>언제 어디서나 손쉽게<br>주문가능</p></li>
            <li><img src="<?php echo $img; ?>/sol-2.svg" alt=""><h3>인원절감</h3><p>필요한 부분<br>외주처리 가능</p></li>
            <li><img src="<?php echo $img; ?>/sol-3.svg" alt=""><h3>비용절감</h3><p>전세계 생산, 유통업체와<br>협력으로 경쟁력 있는 가격</p></li>
            <li><img src="<?php echo $img; ?>/sol-4.svg" alt=""><h3>편리함</h3><p>전문적인 생산관리와<br>품질관리</p></li>
        </ul>
    </section>

    <!-- 4. Customer -->
    <section class="sp-about__customer" id="customer" aria-label="주요 고객"><!-- id: 헤더 회사소개 서브메뉴 Customer 앵커 -->
        <div class="sp-inner sp-about__box">
            <div class="sp-about__cust-head">
                <h2>Customer</h2>
                <p><b>(주)샘플피씨비</b> 주요고객<br>현재도 수 많은 신규고객이 증가하고 있습니다.</p>
            </div>
            <img class="sp-about__cust-logo" src="<?php echo $img; ?>/logo-round-2x.png" alt="PCB 온라인 플랫폼 SAMPLEPCB" width="163" height="54">
            <img class="sp-about__cust-tri" src="<?php echo $img; ?>/ico-tri.svg" alt="" width="11" height="11">
            <div class="sp-about__venn" role="img" aria-label="국내와 해외 고객"><span>국내</span><span>해외</span></div>

            <article class="sp-about__ccard sp-about__ccard--l">
                <h3>중소 스타트업 2,500개 이상</h3>
                <hr>
                <p class="sp-about__chip sp-about__chip--1">주요 대학 (KAIST, 서울대 등)</p>
                <ul class="sp-about__logos sp-about__logos--1">
                    <li><img src="<?php echo $img; ?>/logo-snu.png" alt="서울대학교" width="143" height="33"></li>
                    <li><img src="<?php echo $img; ?>/logo-korea.png" alt="고려대학교" width="104" height="28"></li>
                    <li><img src="<?php echo $img; ?>/logo-kaist.png" alt="KAIST" width="80" height="26"></li>
                    <li><img src="<?php echo $img; ?>/logo-postech.png" alt="POSTECH" width="149" height="21"></li>
                </ul>
                <p class="sp-about__chip sp-about__chip--2">중소 스타트업 170여개 사</p>
                <ul class="sp-about__logos sp-about__logos--2">
                    <li><img src="<?php echo $img; ?>/logo-nueyne.png" alt="NuEyne" width="134" height="24"></li>
                    <li><img src="<?php echo $img; ?>/logo-lorze.png" alt="RORZE" width="106" height="24"></li>
                </ul>
            </article>
            <article class="sp-about__ccard sp-about__ccard--r">
                <h3>대학 및 연구소 200개</h3>
                <hr>
                <p class="sp-about__chip sp-about__chip--1">중국</p>
                <p class="sp-about__chip sp-about__chip--2">미국</p>
                <p class="sp-about__chip sp-about__chip--3">한국</p>
                <ul class="sp-about__logos sp-about__logos--1">
                    <li><img src="<?php echo $img; ?>/logo-samsung.png" alt="삼성중공업" width="151" height="24"></li>
                    <li><img src="<?php echo $img; ?>/logo-skku.svg" alt="성균관대학교" width="117" height="28"></li>
                </ul>
            </article>
        </div>
    </section>

</div>
<?php
include_once(G5_THEME_PATH.'/tail.php');
