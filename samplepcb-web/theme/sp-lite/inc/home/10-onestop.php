<?php
if (!defined('_GNUBOARD_')) exit;

// One-Stop Manufacturing — 2026-09-21 시안의 PCB 4종 + 제조 서비스 4종.
// 금액/기간은 시안의 안내 문구이며 견적 계산이나 주문 정책을 구현하지 않는다.
// 사용자 확정: Parts Sourcing 제목 교정, Turnkey 이미지 비움, Metal Mask 사진/설명 유지.
// 견적 버튼의 링크는 기존 사용자 결정대로 미연결. 선택 동작은 js/home/onestop.js.
$sp_os = $sp_hi.'/onestop';
$sp_os_tabs = array('pcbs' => 'PCBs', 'metal-mask' => 'Metal Mask', 'parts-sourcing' => 'Parts Sourcing', 'pcb-assembly' => 'PCB Assembly', 'turnkey' => 'Turnkey Service');
$sp_os_pcbs = array('fr4', 'flexible', 'rigid-flex', 'aluminum');
$sp_os_variants = array(
    'fr4' => array(
        'title' => 'FR-4 PCB',
        'features' => array('시제품 기준 40층 이상 고다층 제작 대응', '시제품부터 소량·양산까지 지원', '다양한 두께·표면처리 선택', '생산기간 : 기본 사양 3~4일'),
        'prices' => array(array('가격 :', '33,000원~')),
        'image' => 'pcb-fr4.webp', 'alt' => 'FR-4 PCB 보드',
        'media' => array(162, 52, 425, 579),
    ),
    'flexible' => array(
        'title' => 'Flexible PCB',
        'features' => array('유연한 Polyimide 소재', '단면·양면·다층 FPCB 제작', '다양한 형상과 굴곡 구조 대응', '기준 사양 : 1 Layer·100 × 100mm', '생산기간 : 7~8일'),
        'prices' => array(array('가격 :', '250,000원~')),
        'image' => 'pcb-flexible.webp', 'alt' => '유연한 Flexible PCB',
        'media' => array(97, 51, 582, 582),
    ),
    'rigid-flex' => array(
        'title' => 'Rigid-Flex PCB',
        'features' => array('Rigid PCB와 Flexible PCB의 일체형 구조', '배선 및 커넥터 공간 절감', '복잡한 형상과 고집적 설계 대응', '생산기간 : 사양별 별도 안내'),
        'prices' => array(array('가격 :', '맞춤 견적')),
        'image' => 'pcb-rigid-flex.webp', 'alt' => '경성 보드와 연성 케이블이 연결된 Rigid-Flex PCB',
        'media' => array(110, 55, 573, 573),
    ),
    'aluminum' => array(
        'title' => 'Aluminum PCB',
        'features' => array('방열 성능에 특화된 알루미늄 PCB', 'LED·전원장치·고발열 제품에 적합', '단면 및 다층 구조 제작 지원', '기준 사양 : 1W·1 Layer·100 × 100mm', '생산기간 : 7~8일'),
        'prices' => array(array('가격 :', '250,000원~')),
        'image' => 'pcb-aluminum.webp', 'alt' => '방열용 Aluminum PCB',
        'media' => array(102, 53, 577, 577),
    ),
    'metal-mask' => array(
        'title' => 'Metal Mask',
        'features' => array('SMT 공정용 정밀 스텐실', 'Gerber 데이터 기반 정밀 레이저 가공', '국내 제작 Non-Frame 타입', '기준 크기 : 300 × 400mm', '출고일: 오후 1시 이전 주문 시 당일 발송'),
        'prices' => array(array('가격 :', '80,000원~')),
        'image' => 'metal-mask.webp', 'alt' => 'SMT 공정용 메탈마스크',
        'media' => array(102, 0, 602.674, 683.589),
    ),
    'parts-sourcing' => array(
        'title' => 'Parts Sourcing',
        'features' => array('BOM 기반 전자부품 일괄 조달', '부품별 재고·가격·납기 비교', '대체품 및 단종 부품 검토 지원', '조달기간 : 부품 재고에 따라 상이'),
        'prices' => array(array('가격 :', 'BOM 기준 견적')),
        'image' => 'parts-sourcing.webp', 'alt' => 'Parts Eyes BOM 분석과 부품 조달 화면',
        'media' => array(45, 145, 702, 395),
    ),
    'pcb-assembly' => array(
        'title' => 'PCB Assembly',
        'features' => array('SMT·DIP·수삽 공정 지원', '단면·양면 실장 및 소량 제작 대응', '부품 종류와 실장점수별 단가 적용', '생산기간 : 작업 사양별 별도 안내'),
        'prices' => array(array('SMT 셋업 :', '180,000원~'), array('개당 생산비 :', '10,000원~'), array('DIP 작업 :', '150원/Point')),
        'image' => 'pcb-assembly.webp', 'alt' => '부품 실장이 완료된 PCB Assembly 보드',
        'media' => array(153, 82, 487, 520),
    ),
    'turnkey' => array(
        'title' => 'Turnkey Service',
        'features' => array('PCB 제작·부품 조달·조립 통합 진행', '제조 일정과 품질을 한 번에 관리', '시제품 제작부터 양산 전환까지 지원', '생산기간 : 프로젝트별 협의'),
        'prices' => array(array('가격 :', '프로젝트별 견적')),
        'image' => '', 'alt' => '', 'media' => array(0, 0, 0, 0),
    ),
);
?>
<section class="sp-onestop" id="sp-onestop" aria-labelledby="sp-onestop-title" data-service="fr4">
    <div class="sp-inner">
        <div class="sp-onestop__intro">
            <p class="sp-onestop__hand">
                <img src="<?php echo $sp_os; ?>/smarter-faster-connected.svg" alt="" width="435" height="26" aria-hidden="true">
                <span class="sound_only">Smarter. Faster. Connected.</span>
            </p>
            <h2 class="sp-onestop__headline">Transforming Electronics Manufacturing</h2>
            <p class="sp-onestop__lead">AI와 디지털 기술을 기반으로 전자제조의 새로운 기준을 만들어갑니다.</p>
        </div>
        <h3 class="sp-onestop__title" id="sp-onestop-title">One-Stop Manufacturing</h3>
        <p class="sp-onestop__desc">PCB 제작, 부품 조달, 조립까지 제품 개발에 필요한 모든 제조 견적을 한곳에서 빠르게 확인하세요.</p>

        <div class="sp-onestop__tabs-wrap">
            <ul class="sp-onestop__tabs" role="tablist" aria-label="제조 서비스">
                <?php foreach ($sp_os_tabs as $sp_key => $sp_label) { $sp_pcb_tab = $sp_key === 'pcbs'; ?>
                <li class="sp-onestop__tab<?php echo $sp_pcb_tab ? ' is-active has-menu' : ''; ?>" role="presentation">
                    <button type="button" class="sp-onestop__tab-btn" id="sp-onestop-tab-<?php echo $sp_key; ?>" data-service="<?php echo $sp_key; ?>" role="tab" aria-selected="<?php echo $sp_pcb_tab ? 'true' : 'false'; ?>" tabindex="<?php echo $sp_pcb_tab ? '0' : '-1'; ?>" aria-controls="sp-onestop-panel-<?php echo $sp_pcb_tab ? 'fr4' : $sp_key; ?>"<?php if ($sp_pcb_tab) { ?> aria-haspopup="menu" aria-expanded="false"<?php } ?>>
                        <span><?php echo get_text($sp_label); ?></span>
                        <?php if ($sp_pcb_tab) { ?><img class="sp-onestop__chev" src="<?php echo $sp_os; ?>/ico-chevron.svg" alt="" width="14" height="14"><?php } ?>
                    </button>
                </li>
                <?php } ?>
            </ul>
            <div class="sp-onestop__menu" role="menu" aria-label="PCB 종류" hidden>
                <?php foreach ($sp_os_pcbs as $sp_key) { ?>
                <button type="button" class="sp-onestop__menu-item<?php echo $sp_key === 'fr4' ? ' is-active' : ''; ?>" role="menuitemradio" tabindex="-1" data-service="<?php echo $sp_key; ?>" aria-checked="<?php echo $sp_key === 'fr4' ? 'true' : 'false'; ?>"><?php echo get_text($sp_os_variants[$sp_key]['title']); ?></button>
                <?php } ?>
            </div>
        </div>

        <div class="sp-onestop__panels" id="sp-onestop-panel">
            <?php foreach ($sp_os_variants as $sp_key => $sp_variant) {
                $sp_media = $sp_variant['media'];
                $sp_owner = in_array($sp_key, $sp_os_pcbs, true) ? 'pcbs' : $sp_key;
            ?>
            <div class="sp-onestop__panel" id="sp-onestop-panel-<?php echo $sp_key; ?>" data-service="<?php echo $sp_key; ?>" data-title="<?php echo get_text($sp_variant['title']); ?>" role="tabpanel" aria-labelledby="sp-onestop-tab-<?php echo $sp_owner; ?>" tabindex="0"<?php echo $sp_key !== 'fr4' ? ' hidden' : ''; ?>>
                <?php if ($sp_variant['image'] !== '') { ?>
                <div class="sp-onestop__photo sp-onestop__photo--<?php echo $sp_key; ?>" style="--os-x:<?php echo $sp_media[0]; ?>px;--os-y:<?php echo $sp_media[1]; ?>px;--os-w:<?php echo $sp_media[2]; ?>px;--os-h:<?php echo $sp_media[3]; ?>px;--os-ratio:<?php echo $sp_media[2].' / '.$sp_media[3]; ?>">
                    <img <?php echo $sp_key === 'fr4' ? 'src' : 'data-src'; ?>="<?php echo $sp_os.'/'.$sp_variant['image']; ?>?ver=<?php echo G5_CSS_VER; ?>" alt="<?php echo get_text($sp_variant['alt']); ?>" width="<?php echo (int) $sp_media[2]; ?>" height="<?php echo (int) $sp_media[3]; ?>" decoding="async">
                </div>
                <?php } ?>
                <div class="sp-onestop__card">
                    <div class="sp-onestop__card-body">
                        <h4 class="sp-onestop__card-title"><?php echo get_text($sp_variant['title']); ?></h4>
                        <hr class="sp-onestop__card-hr">
                        <ul class="sp-onestop__card-list">
                            <?php foreach ($sp_variant['features'] as $sp_feature) { ?><li><?php echo get_text($sp_feature); ?></li><?php } ?>
                        </ul>
                        <div class="sp-onestop__prices">
                            <?php foreach ($sp_variant['prices'] as $sp_price) { ?><p><?php echo get_text($sp_price[0]); ?> <strong><?php echo get_text($sp_price[1]); ?></strong></p><?php } ?>
                        </div>
                    </div>
                    <span class="sp-onestop__card-btn">견적 요청하기</span>
                </div>
            </div>
            <?php } ?>
        </div>
        <p class="sp-onestop__note">※ 표시된 가격과 생산기간은 기준 사양에 따른 것으로, 크기·수량·층수·소재·가공 조건 및 부품 수급 상황에 따라 달라질 수 있습니다. 배송기간은 생산기간에 포함되지 않습니다.</p>
    </div>
</section>
