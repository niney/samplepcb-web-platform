<?php
// 회사 연혁 /history — Figma 2122:6658, 2026-09-21 (본문 2337:36933~37117).
// 소개 문장은 사용자 확정 문구. 가로 목록 뒤에 기존 2021~2019년 연혁을 보존한다.
include_once __DIR__ . '/../../common.php';

$g5['title'] = '회사 연혁';
add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/history.css?ver='.G5_CSS_VER.'">', 10);
add_javascript('<script src="'.G5_THEME_URL.'/js/history.js?ver='.G5_JS_VER.'" defer></script>', 10);
include_once(G5_THEME_PATH.'/head.php');

$img = G5_THEME_URL.'/img/history';
$sp_history_groups = array(
    array(
        array('year' => '2026', 'events' => array(
            array('AI 제조 혁신 솔루션 ‘3 EYES’ 출시', '(Gerber Eyes 4.0 / Parts Eyes 2.0 / SMT Eyes)'),
            '특허 1건 등록',
            '경기도 유망중소기업 선정',
            '뿌리기업 확인',
            'KC 인증 4건 획득',
            'CE 적합성 인증서(CoC) 1건 획득',
            'FCC 적합성 선언(DoC) 1건 완료',
        )),
    ),
    array(
        array('year' => '2025', 'events' => array('KC 인증 획득', '2025 ICT 이노베이션 페어 우수기업 선정')),
        array('year' => '2024', 'events' => array('사무실 확장 이전(가산 → 광명)', 'SMT 공장 설립', '베트남 기술개발연구소 설립')),
    ),
    array(
        array('year' => '2023', 'events' => array('스마트 BOM 시스템 특허 등록', '‘SamplePCB’ 상표 등록', '중소기업 혁신바우처 수행기관 등록')),
        array('year' => '2022', 'events' => array('벤처기업 확인(혁신성장유형)', '스마트 SMT 견적 산출 시스템 특허 등록', '사무실 확장 이전(독산 → 가산)')),
    ),
    array(
        array('year' => '2021', 'events' => array('12월 · 기업회원 1,700 달성', '상표 1건', '공장등록, 여성기업인증', '연구전담부서등록', '사무실 이전 (독산 → 금천)')),
    ),
    array(
        array('year' => '2020', 'events' => array('12월 · 기업회원 1,000 달성', '06월 · 사무실 이전', '03월 · 회사설립, 서비스 시작')),
        array('year' => '2019', 'events' => array('08월 · Beta 서비스 시작')),
    ),
);
// 시안의 실제 자료 10종. 마스크 바깥의 반복 특허증 2장은 장식 복제라 목록에서 제외한다.
$sp_certs = array(
    array('patent-smart-bom.png', '특허증', '(스마트 BOM 시스템)', ''),
    array('patent-smart-smt.png', '특허증', '(스마트 SMT 견적산출 시스템)', ''),
    array('patent-test-automation.png', '특허증', '(엔드투엔드 테스트 자동화를 위한 분산 장치<br>및 그 장치의 구동방법, 그리고 시스템)', ''),
    array('trademark-samplepcb.png', '상표등록증', '(PCB온라인플랫폼SAMPLEPCB)', ''),
    array('venture-2025.png', '벤처기업확인서', '', ''),
    array('gyeonggi-promising.svg', '경기도유망중소기업', '', ' is-mark'),
    array('root-company.png', '뿌리기업확인서', '', ''),
    array('research-institute.png', '기업부설연구소', '', ''),
    array('factory-registration.png', '공장등록증', '', ''),
    array('women-enterprise.png', '여성기업확인서', '', ''),
);
?>
<div class="sp-hist">
    <section class="sp-hist__banner" aria-label="회사 연혁">
        <div class="sp-inner">
            <ol class="sp-hist__crumb" aria-label="현재 위치">
                <li><a href="<?php echo G5_URL; ?>/">Home</a></li>
                <li aria-hidden="true"><img src="<?php echo G5_THEME_URL; ?>/img/about/ico-chevron.svg" alt=""></li>
                <li aria-current="page">회사연혁</li>
            </ol>
            <h1 class="sp-hist__title">History</h1>
            <p class="sp-hist__sub">최고의 경쟁력을 가진 <b>(주)샘플피씨비</b></p>
        </div>
    </section>

    <section class="sp-hist__history" aria-labelledby="sp-history-heading">
        <div class="sp-hist__inner">
            <div class="sp-hist__head">
                <h2 id="sp-history-heading">SamplePCB<br>History</h2>
                <p>SamplePCB의 주요 서비스 출시와 기술 개발, 인증 및 사업 확장 과정을 소개합니다.</p>
            </div>
            <div class="sp-hist__viewport" id="sp-history-viewport" tabindex="0" role="region" aria-label="회사 연혁, 좌우로 이동하여 과거 연혁 보기">
                <div class="sp-hist__track">
                    <?php foreach ($sp_history_groups as $sp_group_index => $sp_group) { ?>
                    <div class="sp-hist__group sp-hist__group--<?php echo $sp_group_index + 1; ?>">
                        <?php foreach ($sp_group as $sp_year) { ?>
                        <article class="sp-hist__year-block">
                            <h3><?php echo get_text($sp_year['year']); ?></h3>
                            <ul>
                                <?php foreach ($sp_year['events'] as $sp_event) { ?>
                                <li><?php if (is_array($sp_event)) { echo get_text($sp_event[0]); ?><span class="sp-hist__event-note"><?php echo get_text($sp_event[1]); ?></span><?php } else { echo get_text($sp_event); } ?></li>
                                <?php } ?>
                            </ul>
                        </article>
                        <?php } ?>
                    </div>
                    <?php } ?>
                </div>
            </div>
            <input class="sp-hist__scroll" type="range" min="0" max="100" step="1" value="0" aria-label="연혁 좌우 이동" aria-controls="sp-history-viewport">
        </div>
    </section>

    <section class="sp-hist__cert" id="certification" aria-labelledby="sp-cert-heading">
        <div class="sp-hist__cert-head">
            <h2 id="sp-cert-heading">Patents &amp; Certifications</h2>
            <p>기술력과 신뢰를 증명하는 SamplePCB의 특허·인증 및 공식 확인 자료를 소개합니다</p>
        </div>
        <ul class="sp-hist__cards">
            <?php foreach ($sp_certs as $sp_cert) { ?>
            <li><figure>
                <span class="sp-hist__paper<?php echo $sp_cert[3]; ?>"><img src="<?php echo $img.'/'.$sp_cert[0]; ?>" alt="<?php echo get_text($sp_cert[1].' '.str_replace('<br>', ' ', $sp_cert[2])); ?>" width="184" height="260" loading="lazy"></span>
                <figcaption><?php echo get_text($sp_cert[1]); ?><?php if ($sp_cert[2] !== '') { ?><small><?php echo $sp_cert[2]; ?></small><?php } ?></figcaption>
            </figure></li>
            <?php } ?>
        </ul>
    </section>
</div>
<?php include_once(G5_THEME_PATH.'/tail.php'); ?>
