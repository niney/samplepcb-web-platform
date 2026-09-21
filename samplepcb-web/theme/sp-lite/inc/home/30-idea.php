<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 섹션 — "Your Idea. Our Expertise." 프로세스 5단계 + Development Portfolio
 *   Figma 「웹 메인」(2286:1275) Group 173(2286:2333) — y 4855~7095(높이 2240). 아래 좌표는 피그마 y − 4855.
 *   · 상단 사진 띠 2286:2389: 0~321px(사용자 요청으로 상단 1px 틈 제거), 아래로 투명해지는 마스크 + 흰 51% 덮개 → export JPG 에 구움(img/home/idea/photo-strip.jpg)
 *   · 제목 2286:2480(281px) · 단계 카드 2286:2522(01~03, 611px) · 2286:2551(04~05, 977px): 306×288, 점선 화살표 2286:2549(71×15)
 *   · Development Portfolio 2286:2393: 제목 1422 · 카드 트랙 1604(329×496, 간격 30, 6장) · 좌/우 가장자리 페이드 2289:90439 · 2286:2475
 *   · 트랙 동작은 디자이너 메모("Development Portfolio 구현 부분은 korlinx 참고 사이트")대로 무한 가로 마퀴 —
 *     js/home/portfolio.js 가 카드 세트를 복제(aria-hidden)해 CSS 애니메이션으로 돈다(호버 정지·reduced-motion 이면 정지)
 *   · 링크 전부 비움(사용자 결정). 피그마와 다르게 둔 것·이상 징후는 docs/FIGMA_PAGES.md
 */
$sp_idea = G5_THEME_URL.'/img/home/idea';

// 프로세스 5단계 — 제목의 가운뎃점(·)은 피그마가 1·2번만 Regular 로 따로 뒀다(3~5번은 Bold 한 덩어리). 설명 3줄은 피그마가 5장 모두 같은 문장(복제 상태).
// icon: 원본 PNG(512px 등)를 피그마 표시 크기로. top: 카드 안 아이콘 y(피그마 36·37·37·32·32).
$sp_idea_steps = array(
    array('no' => '01', 'title' => '상담<span class="sp-idea__dot">·</span>요구사항',                                        'semi' => true,  'icon' => 'ico-chat.png',   'iw' => 68, 'ih' => 68, 'top' => 36),
    array('no' => '02', 'title' => 'HW<span class="sp-idea__dot">·</span>FW<span class="sp-idea__dot">·</span>SW 개발',      'semi' => true,  'icon' => 'ico-code.png',   'iw' => 84, 'ih' => 65, 'top' => 37),
    array('no' => '03', 'title' => 'PCB 제작·조립',  'semi' => false, 'icon' => 'ico-layers.png', 'iw' => 64, 'ih' => 65, 'top' => 37),
    array('no' => '04', 'title' => '통합 시험·검증', 'semi' => false, 'icon' => 'ico-test.png',   'iw' => 72, 'ih' => 72, 'top' => 32),
    array('no' => '05', 'title' => '인증·양산 지원', 'semi' => false, 'icon' => 'ico-shield.png', 'iw' => 72, 'ih' => 72, 'top' => 32),
);
$sp_idea_desc = '제품 아이디어와 요구사항을<br>함께 정리하고, 최적의 개발<br>방향을 제안합니다.';

// 포트폴리오 카드 — 피그마 트랙 6장. project는 카드별 시안 좌표를 적용하며 마퀴 복제에도 유지된다.
// 5·6번은 별도 업데이트 시안 2341:39596·39614를 사용: BLE 태그 + 모델명, 파트너 표기 없음.
// 기존 원본 이미지·크롭·사진 회색 덮개(tint)는 새 시안과 동일하다.
$sp_idea_cards = array(
    array('project' => 'mppt',     'img' => 'pf-mppt.jpg',     'alt' => 'MPPT Optimizer 가 적용된 태양광 패널',  'tag' => 'BLE', 'tone' => 'ble', 'code' => 'NX40',       'title' => 'MPPT Optimizer'),
    array('project' => 'cabinet',  'img' => 'pf-cabinet.jpg',  'alt' => 'Smart Cabinet 산업용 제어반',           'tag' => 'BLE', 'tone' => 'ble', 'code' => 'NX15',       'title' => 'Smart Cabinet'),
    array('project' => 'pdd',      'img' => 'pf-pdd.jpg',      'alt' => 'Partial Discharge Detector 계측 장비',  'tag' => 'LTE', 'tone' => 'lte', 'code' => 'KSE-91A',    'title' => 'Partial Discharge Detector'),
    array('project' => 'backcare', 'img' => 'pf-backcare.jpg', 'alt' => 'Back Care Device 지압 매트',            'tag' => 'BLE', 'tone' => 'ble', 'code' => 'NX40',       'title' => 'Back Care Device'),
    array('project' => 'forklift', 'img' => 'pf-forklift.jpg', 'alt' => '지게차 포크 높이 감지 센서가 달린 지게차', 'tag' => 'BLE', 'tone' => 'ble', 'code' => 'NX15',       'title' => 'Forklift Fork Height Detection Sensor', 'tint' => '.2'),
    array('project' => 'rooftop',  'img' => 'pf-rooftop.jpg',  'alt' => '루프탑 텐트를 얹은 차량',                'tag' => 'BLE', 'tone' => 'ble', 'code' => 'NX40',       'title' => 'Rooftop Tent Perimeter Detection Radar', 'tint' => '.3'),
);
$sp_idea_step_n = count($sp_idea_steps);
?>
<section class="sp-idea" aria-labelledby="sp-idea-title">
    <div class="sp-idea__photo" aria-hidden="true"><img src="<?php echo $sp_idea; ?>/photo-strip.jpg" alt="" width="1920" height="321"></div>

    <div class="sp-inner">
        <div class="sp-idea__head">
            <h2 class="sp-idea__title" id="sp-idea-title"><span class="sp-idea__title-en">Your Idea. <span class="sp-grad sp-idea__title-grad">Our Expertise.</span></span><br>당신의 아이디어에 우리의 전문성을 더합니다.</h2>
            <p class="sp-idea__sub">아이디어부터 설계 개발 검증 양산까지, 하나의 흐름으로 연결합니다.</p>
        </div>

        <ol class="sp-idea__steps" aria-label="개발 프로세스 5단계">
        <?php foreach ($sp_idea_steps as $sp_i => $sp_st) {
            $sp_row2 = $sp_i >= 3;                       // 04·05 는 둘째 줄(피그마 화살표 y 가 첫째 줄과 다르다)
            $sp_arrow = ($sp_i !== $sp_idea_step_n - 1); // 마지막(05) 뒤엔 화살표 없음. 03 뒤 화살표는 데스크톱(줄 끝)에선 CSS 로 숨기고 세로 흐름에선 보인다
        ?>
            <li class="sp-idea__step<?php echo $sp_row2 ? ' sp-idea__step--row2' : ''; ?>" style="--ico-top:<?php echo $sp_st['top']; ?>px">
                <span class="sp-idea__no" aria-hidden="true"><?php echo $sp_st['no']; ?></span>
                <span class="sp-idea__ico"><img src="<?php echo $sp_idea.'/'.$sp_st['icon']; ?>" alt="" width="<?php echo $sp_st['iw']; ?>" height="<?php echo $sp_st['ih']; ?>"></span>
                <div class="sp-idea__step-body">
                    <h3 class="sp-idea__step-title<?php echo $sp_st['semi'] ? ' sp-idea__step-title--semi' : ''; ?>"><span class="sound_only"><?php echo $sp_st['no']; ?>단계 </span><?php echo $sp_st['title']; ?></h3>
                    <p class="sp-idea__step-desc"><?php echo $sp_idea_desc; ?></p>
                </div>
                <?php if ($sp_arrow) { ?><img class="sp-idea__arrow" src="<?php echo $sp_idea; ?>/arrow.svg" alt="" width="71" height="15" aria-hidden="true"><?php } ?>
            </li>
        <?php } ?>
        </ol>
    </div>

    <div class="sp-idea__pf">
        <h3 class="sp-idea__pf-title">Development Portfolio</h3>
        <p class="sp-idea__pf-desc">다양한 산업 분야에서 축적한 SamplePCB의 제품 개발 경험을 확인해 보세요.</p>
        <div class="sp-idea__pf-viewport" id="sp-portfolio" role="region" aria-label="개발 포트폴리오">
            <div class="sp-idea__pf-track">
            <?php foreach ($sp_idea_cards as $sp_c) { ?>
                <article class="sp-idea__card" data-project="<?php echo $sp_c['project']; ?>">
                    <span class="sp-idea__card-media"<?php if (!empty($sp_c['tint'])) echo ' style="--tint:'.$sp_c['tint'].'"'; ?>><img src="<?php echo $sp_idea.'/'.$sp_c['img']; ?>" alt="<?php echo $sp_c['alt']; ?>" width="329" height="320" loading="lazy"></span>
                    <?php if (!empty($sp_c['tag'])) { ?><span class="sp-idea__tag sp-idea__tag--<?php echo $sp_c['tone']; ?>"><i aria-hidden="true"></i><?php echo $sp_c['tag']; ?></span><?php } ?>
                    <div class="sp-idea__card-body">
                        <p class="sp-idea__card-code"><?php echo $sp_c['code']; ?></p>
                        <h4 class="sp-idea__card-title"><?php echo $sp_c['title']; ?></h4>
                    </div>
                </article>
            <?php } ?>
            </div>
            <span class="sp-idea__pf-fade sp-idea__pf-fade--l" aria-hidden="true"></span>
            <span class="sp-idea__pf-fade sp-idea__pf-fade--r" aria-hidden="true"></span>
        </div>
    </div>
</section>
