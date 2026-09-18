<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 섹션 2 — "Smarter. Faster. Connected. / Transforming Electronics Manufacturing" 소개 + One-Stop Manufacturing 탭
 *   Figma 「웹 메인」(2286:1275) 의 Group 1000008862(2286:2483, y 666~2052 · 1386px)
 *   · 배경 2286:2484(세로 그라데이션 #fcfdff→#f3f9ff) · 소개 2286:2515(Group 182) · One-Stop 2286:2485(Group 1000008855)
 *   · 탭 6개(2290:90473) 중 피그마엔 PCBS 패널(FR-4 PCB 카드 2286:2505 + 보드 사진 2286:2514)만 있다 → 탭은 활성 표시만 바뀌고 패널은 그대로.
 *   · PCBS 드롭다운(2294:90517: FR-4 / Flexible / Rigid-Flex)은 피그마에 열린 상태로 그려져 있으나 호버·클릭 시에만 연다.
 *   · "Smarter. Faster. Connected." 는 Bradley Hand(웹폰트 없음) → 피그마 아웃라인 SVG(img/home/onestop/smarter-faster-connected.svg) + sr-only 텍스트.
 *   · 링크는 전부 비움(사용자 결정) — 버튼은 <button type="button">/<span>. 동작: js/home/onestop.js
 */
$sp_os = $sp_hi.'/onestop';
$sp_os_tabs = array('PCBS', 'Aluminum PCB', 'MetalMask', 'Parts Sourcing', 'PCB Assembly', 'Turnkey Service'); // 피그마 문구 그대로(PCBS 대문자·MetalMask 붙여쓰기)
$sp_os_menu = array('FR-4 PCB', 'Flexible PCB', 'Rigid-Flex PCB');
?>
<section class="sp-onestop" id="sp-onestop" aria-labelledby="sp-onestop-title">
    <div class="sp-inner">

        <!-- 소개(2286:2515) -->
        <div class="sp-onestop__intro">
            <p class="sp-onestop__hand">
                <img src="<?php echo $sp_os; ?>/smarter-faster-connected.svg" alt="" width="435" height="26" aria-hidden="true">
                <span class="sound_only">Smarter. Faster. Connected.</span>
            </p>
            <h2 class="sp-onestop__headline">Transforming Electronics Manufacturing</h2>
            <p class="sp-onestop__lead">AI와 디지털 기술을 기반으로 전자제조의 새로운 기준을 만들어갑니다.</p>
        </div>

        <!-- One-Stop Manufacturing(2286:2485) -->
        <h3 class="sp-onestop__title" id="sp-onestop-title">One-Stop Manufacturing</h3>
        <p class="sp-onestop__desc">PCB 제작, 부품 조달, 조립까지 제품 개발에 필요한 모든 제조 견적을 한곳에서 빠르게 확인하세요.</p>

        <!-- 탭(2290:90473) — 첫 탭 PCBS 는 드롭다운(2294:90517) 을 연다 -->
        <ul class="sp-onestop__tabs" role="tablist" aria-label="제조 서비스">
        <?php foreach ($sp_os_tabs as $sp_i => $sp_tab) { $sp_first = ($sp_i === 0); ?>
            <li class="sp-onestop__tab<?php echo $sp_first ? ' is-active has-menu' : ''; ?>">
                <button type="button" class="sp-onestop__tab-btn" role="tab" aria-selected="<?php echo $sp_first ? 'true' : 'false'; ?>" aria-controls="sp-onestop-panel"<?php echo $sp_first ? ' aria-haspopup="true" aria-expanded="false"' : ''; ?>>
                    <span><?php echo $sp_tab; ?></span>
                    <?php if ($sp_first) { ?><img class="sp-onestop__chev" src="<?php echo $sp_os; ?>/ico-chevron.svg" alt="" width="14" height="14"><?php } ?>
                </button>
                <?php if ($sp_first) { ?>
                <div class="sp-onestop__menu" role="menu" aria-label="PCB 종류" hidden>
                    <?php foreach ($sp_os_menu as $sp_j => $sp_item) { ?>
                    <button type="button" class="sp-onestop__menu-item<?php echo $sp_j === 0 ? ' is-active' : ''; ?>" role="menuitemradio" aria-checked="<?php echo $sp_j === 0 ? 'true' : 'false'; ?>"><?php echo $sp_item; ?></button>
                    <?php } ?>
                </div>
                <?php } ?>
            </li>
        <?php } ?>
        </ul>

        <!-- 패널: 보드 사진(2286:2514) + FR-4 PCB 카드(2286:2505). 피그마에 PCBS(FR-4) 패널만 있어 탭을 바꿔도 내용은 그대로 -->
        <div class="sp-onestop__panel" id="sp-onestop-panel" role="tabpanel">
            <div class="sp-onestop__photo">
                <img src="<?php echo $sp_os; ?>/pcb-fr4.webp" alt="FR-4 다층 PCB 보드" width="632" height="507">
            </div>
            <div class="sp-onestop__card">
                <div class="sp-onestop__card-body">
                    <h4 class="sp-onestop__card-title">FR-4 PCB</h4>
                    <hr class="sp-onestop__card-hr">
                    <ul class="sp-onestop__card-list">
                        <li>1 - 32 layers</li>
                        <li>6개 이상의 레이어에 대한 무료 POFV</li>
                        <li>10% 임피던스 제어 가능</li>
                    </ul>
                </div>
                <span class="sp-onestop__card-btn">견적 요청하기</span>
            </div>
        </div>

    </div>
</section>
