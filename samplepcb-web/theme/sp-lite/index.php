<?php
if (!defined('_INDEX_')) define('_INDEX_', true);
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

if(G5_COMMUNITY_USE === false) {
    include_once(G5_THEME_SHOP_PATH.'/index.php');
    return;
}

/*
 * 홈(/) — Figma 「웹 메인」(2122:5280) 2026-09-06
 *   히어로 슬라이더(inc/main_slider.php) → 서비스 탭 → 왜 우리를 선택 → 특징 카드 3 → 세 가지 방법 → FAQ·공지·Q&A → 공용 푸터
 *   스타일: css/home.css(홈 전용) · 스크립트: js/home.js(모듈: 슬라이더·배경 애니메이션·FAQ)
 *   피그마에 없는 것: 링크(전부 비움, 사용자 결정) · 영상(정적 이미지) · 1023px 이하 레이아웃(우리 정의)
 *   문구 교정: '세 가지 방법' 카드 2·3 은 피그마가 1번 복제 상태라 사진·탭에 맞춰 부품 구매·SMT 조립로 씀, 특징 카드 3 의 타사명 제거
 */
add_stylesheet('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600&display=swap">', 5);
add_stylesheet('<link rel="stylesheet" href="'.G5_THEME_CSS_URL.'/home.css?ver='.G5_CSS_VER.'">', 10);

include_once(G5_THEME_PATH.'/head.php');

$sp_hi = G5_THEME_URL.'/img/home';
?>
<div class="sp-home">

    <!-- 1. 히어로 슬라이더 (템플릿 4장 + 배너관리 이미지) -->
    <?php include G5_THEME_PATH.'/inc/main_slider.php'; ?>

    <div class="sp-inner">
        <!-- 2. 서비스 탭 (링크 미정) -->
        <nav class="sp-home-tabs" aria-label="서비스 바로가기">
            <ul class="sp-home-tabs__row">
                <li><span class="sp-home-tab is-active">PCB 주문</span></li>
                <li><span class="sp-home-tab">Smart Bom 이란?</span></li>
                <li><span class="sp-home-tab">Smart Bom 사용법</span></li>
                <li><span class="sp-home-tab">PCB 공정</span></li>
            </ul>
            <ul class="sp-home-tabs__row">
                <li><span class="sp-home-tab">회로개발 요청</span></li>
                <li><span class="sp-home-tab">PCB조립(SMT) 주문</span></li>
                <li><span class="sp-home-tab">Metal mask 주문</span></li>
                <li><span class="sp-home-tab">SMT 공정</span></li>
            </ul>
        </nav>

        <!-- 3. 왜 우리를 선택 (영상 자리는 정적 이미지 — 추후 교체) -->
        <section class="sp-why">
            <div class="sp-why__text">
                <h2 class="sp-why__title">많은 기업들이<br><span class="sp-grad">왜 우리를 선택</span> 할까요?</h2>
                <p class="sp-why__desc">PCB 제작 오류를 견적 전에 확인하세요.<br>DFM 분석과 미니맵으로 거버파일 검토부터 최종 양산 견적까지 더 빠르게 진행하세요.</p>
            </div>
            <div class="sp-why__media"><img src="<?php echo $sp_hi; ?>/why-video.jpg" alt="플랫폼 소개 영상" width="728" height="410"></div>
        </section>

        <!-- 4. 특징 카드 3장 -->
        <section class="sp-feats" aria-label="샘플피씨비의 강점">
            <div class="sp-feat sp-feat--1">
                <h3 class="sp-feat__title">즉시 가격 확인</h3>
                <p class="sp-feat__desc">파일을 업로드하고 몇 초 만에 경쟁력 있는 총 가격을 받아보세요. 공급업체와 일일이 연락할 필요가 없습니다.</p>
                <span class="sp-feat__icon"><img src="<?php echo $sp_hi; ?>/feat-icons.png" alt=""></span>
            </div>
            <div class="sp-feat sp-feat--2">
                <h3 class="sp-feat__title">검증된 제조 네트워크</h3>
                <p class="sp-feat__desc">저희는 300개 이상의 파트너 네트워크 중에서 가장 적합한 공장으로 모든 주문을 배송합니다. 고객님은 주문만 하시면 됩니다.</p>
                <span class="sp-feat__icon"><img src="<?php echo $sp_hi; ?>/feat-icons.png" alt=""></span>
            </div>
            <div class="sp-feat sp-feat--3">
                <h3 class="sp-feat__title">품질 보장 배송</h3>
                <p class="sp-feat__desc">모든 주문에는 IPC 검사, 완벽한 추적성, 그리고 정시 배송이 포함되며, 샘플피씨비의 품질 보증이 뒷받침됩니다.</p>
                <span class="sp-feat__icon"><img src="<?php echo $sp_hi; ?>/feat-icons.png" alt=""></span>
            </div>
        </section>
    </div>

    <!-- 5. 세 가지 방법 -->
    <section class="sp-ways">
        <div class="sp-inner">
            <h2 class="sp-ways__title"><img class="sp-ways__hl" src="<?php echo $sp_hi; ?>/way-highlight.svg" alt="" aria-hidden="true"><span>견적을 즉시 받고 몇 분 안에 주문할 수 있는 세 가지 방법.</span></h2>
            <p class="sp-ways__desc">회로 기판 제작부터 완제품 조립까지, 주문만 하시면 저희가 검증된 파트너를 통해 제작해드립니다.<br>가버뷰어, BOM, SMT 서비스를 통해 쉽고 빠르게 파일을 업로드하고 실시간 제작 가격을 확인 할 수 있습니다.</p>
            <div class="sp-ways__grid">
                <article class="sp-way sp-way--pcb">
                    <span class="sp-way__media"><img src="<?php echo $sp_hi; ?>/way-pcb.jpg" alt=""></span>
                    <div class="sp-way__body">
                        <h3 class="sp-way__title">PCB 제조</h3>
                        <p class="sp-way__desc">Gerber ZIP 파일을 업로드하세요. 몇 초 만에 정확한 가격과 납기를 확인하고 바로 주문할 수 있습니다.</p>
                    </div>
                    <ul class="sp-way__list">
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">즉시 DFM 및 스택업 확인</li>
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">숨겨진 수수료 없이 모든 비용이 포함된 가격입니다</li>
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">원클릭으로 주문하세요</li>
                    </ul>
                    <span class="sp-way__btn">PCB 견적 받기  →</span>
                </article>
                <article class="sp-way sp-way--parts">
                    <span class="sp-way__media"><img src="<?php echo $sp_hi; ?>/way-parts.jpg" alt=""></span>
                    <div class="sp-way__body">
                        <h3 class="sp-way__title">부품 구매</h3>
                        <p class="sp-way__desc">BOM 파일을 업로드하세요. 여러 공급업체의 재고와 가격을 한 번에 비교해 가장 경쟁력 있는 견적을 바로 확인할 수 있습니다.</p>
                    </div>
                    <ul class="sp-way__list">
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">BOM 업로드로 즉시 견적</li>
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">재고·대체 부품 자동 매칭</li>
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">구매부터 입고까지 한 번에</li>
                    </ul>
                    <span class="sp-way__btn">BOM 견적 받기  →</span>
                </article>
                <article class="sp-way sp-way--smt">
                    <span class="sp-way__media"><img src="<?php echo $sp_hi; ?>/way-smt.jpg" alt=""></span>
                    <div class="sp-way__body">
                        <h3 class="sp-way__title">SMT 조립</h3>
                        <p class="sp-way__desc">거버와 BOM을 함께 올리세요. PCB 제작부터 부품 실장까지 한 번에 견적받고 바로 주문할 수 있습니다.</p>
                    </div>
                    <ul class="sp-way__list">
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">PCB·부품·실장 통합 견적</li>
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">IPC 기준 품질 검사</li>
                        <li><img src="<?php echo $sp_hi; ?>/ico-check.svg" alt="">제작 진행 상황 실시간 확인</li>
                    </ul>
                    <span class="sp-way__btn">SMT 견적 받기  →</span>
                </article>
            </div>
        </div>
    </section>

    <!-- 6. FAQ · 공지사항 · Q&A (게시판 faq / notice / qa, 스킨 skin/latest/home-fig) -->
    <section class="sp-boards">
        <div class="sp-inner">
            <div class="sp-boards__faq">
                <h2 class="sp-boards__h">자주 묻는 질문<br>FAQ</h2>
                <div class="sp-boards__faq-body" id="sp-faq">
                    <?php echo latest('theme/home-fig', 'faq', 40, 60); ?>
                </div>
            </div>
            <div class="sp-boards__row2">
                <div class="sp-boards__col">
                    <h2 class="sp-boards__h">공지사항</h2>
                    <?php echo latest('theme/home-fig', 'notice', 5, 40); ?>
                </div>
                <div class="sp-boards__col">
                    <h2 class="sp-boards__h">Q&amp;A</h2>
                    <?php echo latest('theme/home-fig', 'qa', 5, 40); ?>
                </div>
            </div>
        </div>
    </section>

</div>
<script type="module" src="<?php echo G5_THEME_URL; ?>/js/home.js?ver=<?php echo G5_JS_VER; ?>"></script>

<?php
include_once(G5_THEME_PATH.'/tail.php');
