<?php
// samplepcb 정적 페이지 — 회사 연혁
// URL: /history (루트 .htaccess 가 /spcb/pages/history.php 로 내부 리라이트)
// 디자인: Figma 「GNB > 회사 연혁」(2122:6658) 2026-09-06 — 스타일 theme/sp-lite/css/history.css, 에셋 theme/sp-lite/img/history/
// 피그마와 다르게 둔 것(사용자 결정, docs/FIGMA_PAGES.md 기록):
//   · 배너 사진: 피그마는 Unsplash+ 워터마크 프리뷰라 회사소개 배너 사진으로 대체
//   · 배너 제목 "History": 피그마에선 이미지 레이어 아래 묻혀 있으나 보이게 둠
//   · Company History·Certification 설명문: 피그마가 회사소개 문장 복사본이라 레거시 사이트 문구로 대체
//   · 숫자 블록: 피그마는 타사 스크린샷 → HTML 로 재구성, 수치는 피그마 그대로 자리표시(운영 전 교체 필수)
//   · 인증서: 피그마는 같은 특허증 7장 복제 → 레거시 사이트 실물 6종 사용, 가로 스크롤

include_once __DIR__ . '/../../common.php';

$g5['title'] = '회사 연혁';
add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/history.css?ver='.G5_CSS_VER.'">', 10);
include_once(G5_THEME_PATH.'/head.php');

$img = G5_THEME_URL.'/img/history';
$img_about = G5_THEME_URL.'/img/about';

// 연혁 데이터 — 피그마 2122:6813 (2023년 5월까지). 항목 추가 시 여기만 고치면 된다. month 가 빈 줄은 같은 달의 연속 항목.
$sp_history = array(
    array('year' => '2023', 'rows' => array(
        array('05', '기업회원 3,100 달성'),
        array('',   'Smart Bom ‘Parts Eyes’ 런칭'),
        array('04', 'Gerber Eyes 3.0 출시'),
        array('03', '스마트 BOM 시스템 특허출원'),
    )),
    array('year' => '2022', 'rows' => array(
        array('02', '기업회원 2,600 달성'),
        array('',   '벤처기업 인증'),
        array('03', '특허 (스마트 SMT 주문시스템) 1건'),
        array('',   '특허출원 2건'),
    )),
    array('year' => '2021', 'rows' => array(
        array('12', '기업회원 1,700 달성'),
        array('',   '상표 1건'),
        array('',   '공장등록, 여성기업인증'),
        array('',   '연구전담부서등록'),
        array('',   '사무실 이전 (독산 → 금천)'),
    )),
    array('year' => '2020', 'rows' => array(
        array('12', '기업회원 1,000 달성'),
        array('06', '사무실 이전'),
        array('03', '회사설립, 서비스 시작'),
    )),
);

// 숫자 블록 — ⚠ 피그마 스크린샷의 타사 수치를 자리표시로 둔 것. 운영 배포 전 실수치로 교체할 것(docs/FIGMA_PAGES.md).
$sp_stats = array(
    array('19+',    'years of expertise'),
    array('3,500+', 'IT professionals'),
    array('1,600+', 'delivered projects'),
    array('400+',   'professionals certified'),
);

// 인증서 — 레거시 theme/samplepcb/company_v2/certificate.php 의 6종
$sp_certs = array(
    array('cert1.png',   '특허증',              '(스마트 SMT 견적산출 시스템)'),
    array('cert5.png',   '스마트 BOM 시스템',    '(특허증)'),
    array('cert2-1.png', '상표등록증',           ''),
    array('cert2.png',   '연구개발전담부서 인정서', '(koita 한국산업기술진흥협회)'),
    array('cert4.png',   '여성기업확인서',        '(서울지방중소벤처기업)'),
    array('cert3.png',   '벤처기업확인서',        '(연구개발유형)'),
);
?>
<div class="sp-hist">

    <!-- 1. 배너 -->
    <section class="sp-hist__banner" aria-label="회사 연혁">
        <div class="sp-inner">
            <ol class="sp-hist__crumb" aria-label="현재 위치">
                <li><a href="<?php echo G5_URL; ?>/">Home</a></li>
                <li aria-hidden="true"><img src="<?php echo $img_about; ?>/ico-chevron.svg" alt=""></li>
                <li aria-current="page">회사연혁</li>
            </ol>
            <h1 class="sp-hist__title">History</h1>
            <p class="sp-hist__sub">최고의 경쟁력을 가진 <b>(주)샘플피씨비</b></p>
        </div>
    </section>

    <!-- 2. Company History -->
    <section class="sp-hist__history" aria-label="Company History">
        <div class="sp-hist__photo" aria-hidden="true"></div>
        <div class="sp-inner sp-hist__box">
            <div class="sp-hist__head">
                <h2>Company History</h2>
                <p>최고의 경쟁력을 가진 <b>(주)샘플피씨비</b></p>
            </div>
            <div class="sp-hist__tl">
                <span class="sp-hist__tl-line" aria-hidden="true"></span>
                <span class="sp-hist__tl-dot sp-hist__tl-dot--top" aria-hidden="true"></span>
                <span class="sp-hist__tl-dot sp-hist__tl-dot--bottom" aria-hidden="true"></span>
                <p class="sp-hist__decade sp-hist__decade--top">2020’s</p>
                <div class="sp-hist__years">
                <?php foreach ($sp_history as $sp_y) { ?>
                    <h3 class="sp-hist__year"><?php echo $sp_y['year']; ?></h3>
                    <ul class="sp-hist__rows">
                    <?php foreach ($sp_y['rows'] as $sp_r) { ?>
                        <li<?php echo $sp_r[0] !== '' ? ' class="is-month"' : ''; ?>><i><?php echo $sp_r[0]; ?></i><span><?php echo $sp_r[1]; ?></span></li>
                    <?php } ?>
                    </ul>
                <?php } ?>
                </div>
                <div class="sp-hist__y2019">
                    <h3 class="sp-hist__year">2019</h3>
                    <p><span>Beta 서비스 시작</span><i>08</i></p>
                </div>
                <p class="sp-hist__decade sp-hist__decade--bottom">2010’s</p>
            </div>
        </div>
    </section>

    <!-- 3. 숫자로 보는 SamplePCB -->
    <section class="sp-hist__stats" aria-label="숫자로 보는 SamplePCB">
        <div class="sp-inner sp-hist__box">
            <h2>숫자로 보는 <b>SamplePCB</b></h2>
            <ul class="sp-hist__stat-list">
            <?php foreach ($sp_stats as $sp_s) { ?>
                <li><b><?php echo $sp_s[0]; ?></b><span><?php echo $sp_s[1]; ?></span></li>
            <?php } ?>
            </ul>
        </div>
    </section>

    <!-- 4. Certification -->
    <section class="sp-hist__cert" id="certification" aria-label="Certification"><!-- id: 헤더 회사소개 서브메뉴 Certification 앵커 -->
        <div class="sp-inner sp-hist__box">
            <div class="sp-hist__cert-head">
                <h2>Certification</h2>
                <p>우수한 기술로 인증받은 <b>㈜샘플피씨비</b></p>
            </div>
            <div class="sp-hist__strip">
                <ul class="sp-hist__cards">
                <?php foreach ($sp_certs as $sp_c) { ?>
                    <li><figure>
                        <span class="sp-hist__paper"><img src="<?php echo $img; ?>/<?php echo $sp_c[0]; ?>" alt="<?php echo $sp_c[1].' '.$sp_c[2]; ?>" loading="lazy"></span>
                        <figcaption><?php echo $sp_c[1]; ?><?php if ($sp_c[2] !== '') { ?><small><?php echo $sp_c[2]; ?></small><?php } ?></figcaption>
                    </figure></li>
                <?php } ?>
                </ul>
            </div>
        </div>
    </section>

</div>
<?php
include_once(G5_THEME_PATH.'/tail.php');
