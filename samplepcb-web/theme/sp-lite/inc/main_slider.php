<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 히어로 슬라이더 — Figma 「웹 메인」(2286:1275) 상단 배너 5장 (2026-09-18, 디자이너 9/17 "상단배너·컨텐츠 전반" 업데이트)
 * ------------------------------------------------------------------
 *   banner 01 Gerber Eyes 4.0            2286:5331 (= 메인 프레임의 2286:60902)
 *   banner 02 제작까지 바로 (카드 3장)     2286:5332
 *   banner 03 KORLINX AIoT               2286:27009
 *   banner 04 One-Stop 제조서비스(카드 4) 2286:27054
 *   banner 05 RAPID PROTOTYPING          2286:5165
 *   각 1920×666 프레임의 위 72px 는 헤더 자리 → 화면 594px, 좌표 = 피그마 y − 72. 텍스트·카드는 1280 컨테이너 기준(x − 320),
 *   배경 장식은 1920 프레임 기준(가운데 정렬·넘침 잘림). 스타일 css/home/05-hero.css, 동작 js/home/hero.js.
 *   배경: 01 = 프로빙 채택안 연속 회전(center-swap) 유지 — 윤곽 Vector(2286:60907) + 블롭(Ellipse 4). 02~04 = 디자이너 "bg img"
 *   3720×666 리소스(2286:60998 · 60963 · 61007)를 아주 느리게 좌우로 팬. 05 = 정지 사진.
 * 하이브리드(2026-09-06 결정) 유지:
 *   · 템플릿 슬라이드 = 코드(이 파일). 관리자 /app/admin/slides(= 영카트 배너관리 '메인', g5_shop_banner) 이미지는 템플릿 **뒤에** 붙는다.
 *   · 템플릿 on/off·순서 = sp_config key 'home_slides' (JSON {"templates":["gerber-eyes","order-now","korlinx","one-stop","rapid-proto"]}).
 *     행이 없으면 5장 전부, 피그마 순서.
 * 링크는 아직 비움(사용자 결정) — sp_hero_link() 에 URL 만 넣으면 <a>, 비면 <span>.
 */

$sp_hi = G5_THEME_URL.'/img/home/hero';

// 템플릿 on/off (sp_config 는 Node 쪽이 소유한 표 — 읽기만, 없으면 조용히 기본값)
$sp_tpl_all = array('gerber-eyes', 'order-now', 'korlinx', 'one-stop', 'rapid-proto');
$sp_tpl_on = $sp_tpl_all;
$sp_cfg = sql_fetch("select `value` from sp_config where `key` = 'home_slides'", false);
if ($sp_cfg && isset($sp_cfg['value'])) {
    $sp_cfg_j = json_decode($sp_cfg['value'], true);
    if (is_array($sp_cfg_j) && isset($sp_cfg_j['templates']) && is_array($sp_cfg_j['templates'])) {
        $sp_tpl_on = array_values(array_intersect($sp_cfg_j['templates'], $sp_tpl_all));
    }
}

// 이미지 슬라이드(배너관리 '메인') — 실이미지가 있는 것만
$sp_img_slides = array();
$sp_slider_res = sql_query(" select * from {$g5['g5_shop_banner_table']}
                              where '" . G5_TIME_YMDHIS . "' between bn_begin_time and bn_end_time
                                and ( bn_device = 'both' or bn_device = 'pc' )
                                and bn_position = '메인'
                              order by bn_order, bn_id desc ", false);
while ($sp_slider_res && ($sp_row = sql_fetch_array($sp_slider_res))) {
    $sp_bimg = G5_DATA_PATH . '/banner/' . $sp_row['bn_id'];
    if (!file_exists($sp_bimg)) continue;
    $sp_size = @getimagesize($sp_bimg);
    if (!$sp_size || $sp_size[2] < 1 || $sp_size[2] > 16) continue;
    $sp_img_slides[] = $sp_row;
}

$sp_slide_total = count($sp_tpl_on) + count($sp_img_slides);
$sp_first = true; // 첫 슬라이드에 is-active — JS 없이도 1장은 보인다
if ($sp_slide_total === 0) return;

// 링크 미정 자리: URL 이 비면 <span>, 있으면 <a>
if (!function_exists('sp_hero_link')) {
    function sp_hero_link($url, $class, $inner, $attrs = '') {
        if ($url) return '<a href="'.$url.'" class="'.$class.'"'.($attrs ? ' '.$attrs : '').'>'.$inner.'</a>';
        return '<span class="'.$class.'"'.($attrs ? ' '.$attrs : '').'>'.$inner.'</span>';
    }
}
// ✦ 별 아이콘(피그마 Vector 3, 11×12) — 색은 currentColor
if (!function_exists('sp_hero_star')) {
    function sp_hero_star() {
        return '<svg viewBox="0 0 11 12" aria-hidden="true"><path fill="currentColor" d="M6.696 3.517 5.5 0 4.304 3.517c-.064.241-.21.745-.287.828-.076.083-.382.241-.526.31L0 6l3.3 1.293c.207.069.641.227.717.31.077.083.223.621.287.88L5.5 12l1.196-3.517c.063-.259.21-.797.286-.88.077-.083.51-.241.718-.31L11 6 7.7 4.655c-.207-.103-.641-.331-.718-.414-.076-.083-.223-.517-.286-.724Z"/></svg>';
    }
}
// 태그 줄(✦ DFM Analysis …) — banner 01
if (!function_exists('sp_hero_tags')) {
    function sp_hero_tags($items) {
        $h = '<ul class="sp-tags">';
        foreach ($items as $t) $h .= '<li>'.sp_hero_star().'<span>'.$t.'</span></li>';
        return $h.'</ul>';
    }
}
// 점 태그 줄(• LTE-M • BLE …) — banner 03·04
if (!function_exists('sp_hero_dtags')) {
    function sp_hero_dtags($items) {
        $h = '<ul class="sp-dtags">';
        foreach ($items as $t) $h .= '<li>'.$t.'</li>';
        return $h.'</ul>';
    }
}
// 카드 버튼의 > 화살표(Vector 3, 8×16 stroke 2)
$sp_chev = '<svg viewBox="0 0 8 16" aria-hidden="true"><path d="M1 1l6 7-6 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
?>
<section class="sp-hero" id="sp-hero" data-count="<?php echo $sp_slide_total; ?>" data-outline="<?php echo $sp_hi; ?>/gerber-outline.svg?ver=<?php echo G5_CSS_VER; ?>" aria-roledescription="carousel" aria-label="메인 배너">
    <div class="sp-hero__frame" aria-hidden="true">
        <div class="sp-hero__anim">
            <img class="sp-hero__blob" src="<?php echo $sp_hi; ?>/gerber-blob.svg" alt="" width="1230" height="1230">
            <img class="sp-hero__lines" src="<?php echo $sp_hi; ?>/gerber-outline.svg" alt="" width="1680" height="613">
            <svg class="sp-hero__organic" viewBox="0 0 1680 613" fill="none">
                <defs>
                    <linearGradient id="sp-og" gradientUnits="userSpaceOnUse" x1="1680" y1="545.149" x2="-207.448" y2="271.528">
                        <stop offset="0.134615" stop-color="#fff"/><stop offset="0.461538" stop-color="#6EACFF"/>
                        <stop offset="0.658654" stop-color="#C3F3FF"/><stop offset="0.918269" stop-color="#fff"/>
                    </linearGradient>
                </defs>
                <path id="sp-organic-path" fill="url(#sp-og)"/>
            </svg>
        </div>
    </div>

    <div class="sp-hero__slides">
    <?php foreach ($sp_tpl_on as $sp_tpl) { ?>
        <?php if ($sp_tpl === 'gerber-eyes') { ?>
        <article class="sp-hero__slide sp-s1<?php echo $sp_first ? ' is-active' : ''; $sp_first = false; ?>" data-anim="1" aria-label="Gerber Eyes 4.0 Online Gerber Viewer">
            <div class="sp-inner"><div class="sp-slide__in">
                <?php echo sp_hero_tags(array('DFM Analysis', 'Mini Map', 'Fast File Processing')); ?>
                <h2 class="sp-s1__title">Gerber Eyes <img src="<?php echo $sp_hi; ?>/gerber-40.svg" alt="4.0" width="83" height="41"></h2>
                <p class="sp-s1__sub">Online Gerber Viewer</p>
                <p class="sp-hero__desc">PCB 제작 오류를 견적 전에 확인하세요.<br>DFM 분석과 미니맵으로 거버파일 검토부터 최종 양산 견적까지 더 빠르게 진행하세요.</p>
                <div class="sp-hero__btns">
                    <?php echo sp_hero_link('', 'sp-btn sp-btn--primary', '주문하기'); ?>
                    <?php echo sp_hero_link('', 'sp-btn sp-btn--outline', '체험하기'); ?>
                </div>
                <div class="sp-s1__visual">
                    <img class="sp-s1__monitor" src="<?php echo $sp_hi; ?>/gerber-monitor.png" alt="" width="587" height="581">
                    <img class="sp-s1__screen" src="<?php echo $sp_hi; ?>/gerber-screen.png" alt="Gerber Eyes 4.0 화면" width="551" height="372">
                </div>
            </div></div>
        </article>
        <?php } else if ($sp_tpl === 'order-now') { ?>
        <article class="sp-hero__slide sp-s2<?php echo $sp_first ? ' is-active' : ''; $sp_first = false; ?>" aria-label="Gerber Eyes로 확인하고, 제작까지 바로 진행하세요">
            <div class="sp-slide__bg" aria-hidden="true"><img class="sp-slide__pan" src="<?php echo $sp_hi; ?>/bg-order.png" alt="" width="3720" height="666"></div>
            <div class="sp-inner"><div class="sp-slide__in">
                <span class="sp-pill sp-pill--star"><?php echo sp_hero_star(); ?><span>NEW STEP</span></span>
                <h2 class="sp-s2__title">Gerber Eyes로 확인하고,<br><span class="sp-grad">제작까지 바로</span> 진행하세요</h2>
                <p class="sp-s2__sub">PCB 제작, SMT 조립, 메탈마스크까지 샘플피씨비에서<br>빠르게 연결됩니다.</p>
                <div class="sp-s2__cards">
                    <div class="sp-pcard">
                        <div class="sp-pcard__body">
                            <span class="sp-pcard__media"><img src="<?php echo $sp_hi; ?>/card-pcb.png" alt="" width="240" height="160"></span>
                            <h3 class="sp-pcard__title">PCB</h3>
                            <p class="sp-pcard__price">35,000원 ~</p>
                            <p class="sp-pcard__meta"><i class="sp-pcard__cal" aria-hidden="true"></i><span>약 5영업일</span></p>
                        </div>
                        <?php echo sp_hero_link('', 'sp-pcard__btn', '주문하기'.$sp_chev); ?>
                    </div>
                    <div class="sp-pcard">
                        <div class="sp-pcard__body">
                            <span class="sp-pcard__media"><img src="<?php echo $sp_hi; ?>/card-smt.png" alt="" width="240" height="160"></span>
                            <h3 class="sp-pcard__title">SMT</h3>
                            <p class="sp-pcard__price">250,000원 ~</p>
                            <p class="sp-pcard__meta"><i class="sp-pcard__cal" aria-hidden="true"></i><span>납기 문의</span></p>
                        </div>
                        <?php echo sp_hero_link('', 'sp-pcard__btn', '주문하기'.$sp_chev); ?>
                    </div>
                    <div class="sp-pcard">
                        <div class="sp-pcard__body">
                            <span class="sp-pcard__media"><img src="<?php echo $sp_hi; ?>/card-mask.png" alt="" width="240" height="160"></span>
                            <h3 class="sp-pcard__title">Metal Mask</h3>
                            <p class="sp-pcard__price">80,000원 ~</p>
                            <p class="sp-pcard__meta"><i class="sp-pcard__cal" aria-hidden="true"></i><span>당일</span><i class="sp-pcard__dot" aria-hidden="true"></i><span>익일 발송</span></p>
                        </div>
                        <?php echo sp_hero_link('', 'sp-pcard__btn', '주문하기'.$sp_chev); ?>
                    </div>
                </div>
            </div></div>
        </article>
        <?php } else if ($sp_tpl === 'korlinx') { ?>
        <article class="sp-hero__slide sp-s3<?php echo $sp_first ? ' is-active' : ''; $sp_first = false; ?>" aria-label="KORLINX AIoT 제품 개발을 위한 통신 솔루션">
            <div class="sp-slide__bg" aria-hidden="true"><img class="sp-slide__pan" src="<?php echo $sp_hi; ?>/bg-korlinx.png" alt="" width="3720" height="666"></div>
            <div class="sp-inner"><div class="sp-slide__in">
                <span class="sp-pill sp-pill--dot">AIoT Solution</span>
                <h2 class="sp-s3__title"><span class="sp-s3__brand">KORLINX</span><br>AIoT 제품 개발을 위한 <b class="sp-grad">통신 솔루션</b></h2>
                <p class="sp-hero__desc">디바이스 연결부터 플랫폼 연동까지, AIoT 개발을 더 빠르게 시작하세요.</p>
                <div class="sp-hero__btns">
                    <?php echo sp_hero_link('', 'sp-btn sp-s3__btn', '자세히 보기'); ?>
                </div>
                <?php echo sp_hero_dtags(array('LTE-M', 'BLE', 'Gateway', 'GNSS', 'IoT Platform')); ?>
                <img class="sp-s3__photo" src="<?php echo $sp_hi; ?>/korlinx-photo.jpg" alt="KORLINX 통신 모듈·게이트웨이·안테나" width="598" height="541">
            </div></div>
        </article>
        <?php } else if ($sp_tpl === 'one-stop') { ?>
        <article class="sp-hero__slide sp-s4<?php echo $sp_first ? ' is-active' : ''; $sp_first = false; ?>" aria-label="제품 개발 및 PCB설계가 필요하신가요? One-Stop 제조서비스">
            <div class="sp-slide__bg" aria-hidden="true"><img class="sp-slide__pan" src="<?php echo $sp_hi; ?>/bg-onestop.png" alt="" width="3720" height="666"></div>
            <div class="sp-inner"><div class="sp-slide__in">
                <span class="sp-pill sp-pill--dot">Quick Order</span>
                <h2 class="sp-s4__title"><b>제품 개발</b> 및 <b>PCB설계</b>가<br>필요하신가요?</h2>
                <p class="sp-hero__desc">디바이스 연결부터 플랫폼 연동까지, AIoT 개발을 더 빠르게 시작하세요.</p>
                <div class="sp-hero__btns">
                    <?php echo sp_hero_link('', 'sp-btn sp-s4__btn', '자세히 보기'); ?>
                </div>
                <?php echo sp_hero_dtags(array('Circuit Design', 'PCB Artwork', 'PCBA', 'Firmware')); ?>
                <div class="sp-s4__cards">
                    <div class="sp-ocard sp-ocard--top">
                        <h3 class="sp-ocard__title">1. 회로설계 및 Artwork</h3>
                        <span class="sp-ocard__media"><img src="<?php echo $sp_hi; ?>/onestop-card-1.png" alt="" width="320" height="160"></span>
                    </div>
                    <div class="sp-ocard sp-ocard--top">
                        <h3 class="sp-ocard__title">2. PCB 제작</h3>
                        <span class="sp-ocard__media"><img src="<?php echo $sp_hi; ?>/onestop-card-2.png" alt="" width="320" height="160"></span>
                    </div>
                    <div class="sp-ocard sp-ocard--bottom">
                        <span class="sp-ocard__media"><img src="<?php echo $sp_hi; ?>/onestop-card-4.png" alt="" width="320" height="160"></span>
                        <h3 class="sp-ocard__title">4. PCBA(SMT) 서비스</h3>
                    </div>
                    <div class="sp-ocard sp-ocard--bottom">
                        <span class="sp-ocard__media"><img src="<?php echo $sp_hi; ?>/onestop-card-3.png" alt="" width="320" height="160"></span>
                        <h3 class="sp-ocard__title">3. 부품유통</h3>
                    </div>
                </div>
                <div class="sp-s4__circle" aria-hidden="false">
                    <i class="sp-s4__ring" aria-hidden="true"></i>
                    <i class="sp-s4__core" aria-hidden="true"></i>
                    <p><b>One-Stop</b><br>제조서비스</p>
                </div>
            </div></div>
        </article>
        <?php } else if ($sp_tpl === 'rapid-proto') { ?>
        <article class="sp-hero__slide sp-s5<?php echo $sp_first ? ' is-active' : ''; $sp_first = false; ?>" aria-label="RAPID PROTOTYPING In-House SMT Line">
            <div class="sp-slide__bg" aria-hidden="true">
                <img class="sp-s5__photo" src="<?php echo $sp_hi; ?>/rapid-photo.png" alt="" width="1920" height="1074">
                <i class="sp-s5__shade"></i>
            </div>
            <div class="sp-inner"><div class="sp-slide__in">
                <h2 class="sp-s5__title">RAPID PROTOTYPING</h2>
                <p class="sp-s5__sub">In-House SMT Line</p>
                <p class="sp-hero__desc">시제품 제작부터 양산까지,<br>자체 생산라인으로 개발 속도를 높입니다.</p>
                <div class="sp-hero__btns">
                    <?php echo sp_hero_link('', 'sp-btn sp-s5__btn', '자세히 보기'); ?>
                </div>
            </div></div>
        </article>
        <?php } ?>
    <?php } ?>

    <?php foreach ($sp_img_slides as $sp_row) {
        $sp_src = G5_DATA_URL.'/banner/'.$sp_row['bn_id'].'?v='.$sp_row['bn_time'];
        $sp_alt = get_text($sp_row['bn_alt']);
        $sp_inner = '<img src="'.$sp_src.'" alt="'.$sp_alt.'">';
    ?>
        <article class="sp-hero__slide sp-hero__slide--image<?php echo $sp_first ? ' is-active' : ''; $sp_first = false; ?>" aria-label="<?php echo $sp_alt; ?>">
            <?php echo sp_hero_link($sp_row['bn_url'], 'sp-hero__image', $sp_inner, $sp_row['bn_new_win'] ? 'target="_blank" rel="noopener"' : ''); ?>
        </article>
    <?php } ?>
    </div>

    <div class="sp-hero__dots" role="tablist" aria-label="슬라이드 선택">
    <?php for ($sp_i = 0; $sp_i < $sp_slide_total; $sp_i++) { ?>
        <button type="button" class="sp-hero__dot<?php echo $sp_i === 0 ? ' is-active' : ''; ?>" role="tab" aria-selected="<?php echo $sp_i === 0 ? 'true' : 'false'; ?>" aria-label="<?php echo $sp_i + 1; ?>번 슬라이드"></button>
    <?php } ?>
    </div>
</section>
