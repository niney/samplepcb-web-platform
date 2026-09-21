<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 — Our Network (Figma 「웹 메인」 2286:2046 Group 1000008858, y 7606~8326 · 720px, 배경 #f6f7f8)
 *   제목 "Our Network"(54px Bold) + 부제(36px Medium) + 로고 두 줄(위 기업·파트너 12개 gap 100 / 아래 대학 8개 gap 80)
 *   피그마는 두 줄이 화면보다 넓어 양끝이 잘린 스냅샷(마스크 = 섹션 사각형, 페이드 없음) → 무한 마퀴로 구현
 *   (트랙 = 목록 2벌, CSS keyframes linear infinite, 위줄 왼쪽·아랫줄 오른쪽, 호버 중 계속 재생, reduced-motion 정지).
 *   로고 파일 img/home/network/ — 피그마 원본(투명 PNG) 을 표시 크기 2배로 자르고 줄인 것. 크기는 피그마 박스(px).
 *   ⚠ 로고 사용 허락 확인 항목(운영 배포 전): 아래 alt 목록 전부.
 *   스타일: css/home/41-network.css
 */
$sp_hn = G5_THEME_URL.'/img/home/network';
$sp_net_rows = array(
    // 위줄(2286:2119, gap 100) — 기업·파트너
    'top' => array(
        array('unitop.png',         192, 50, '유니탑(UNI-T)'),
        array('inzinious.png',      200, 52, '인지니어스(RADAR by INZINIOUS)'),
        array('nueyne.png',         236, 92, 'NuEyne'),
        array('samsung.png',        227, 36, '삼성중공업'),
        array('rorze.png',          167, 50, 'RORZE'),
        array('nordic.png',         160, 43, 'Nordic Semiconductor'),
        array('incerasolution.png', 255, 64, 'INCERASOLUTION'),
        array('bugang.png',         138, 43, 'BUGANG'),
        array('telecons.png',       250, 50, 'TELECONS'),
        array('ekpower.png',        200, 64, 'EKPOWER'),
        array('multi.png',           97, 40, '멀티'),
        array('globalconet.png',    191, 59, '글로벌코넷(GK ESA Antenna)'),
    ),
    // 아랫줄(2286:2051, gap 80) — 대학
    'bottom' => array(
        array('sejong.png',  171, 36, '세종대학교'),
        array('hanyang.png', 148, 45, '한양대학교'),
        array('skku.svg',    183, 44, '성균관대학교'),
        array('korea.png',   130, 35, '고려대학교'),
        array('snu.png',     199, 46, '서울대학교'),
        array('kaist.png',   133, 37, 'KAIST'),
        array('postech.png', 215, 31, 'POSTECH'),
        array('dankook.png', 199, 45, '단국대학교'),
    ),
);
if (!function_exists('sp_net_list')) {
    function sp_net_list($items, $base, $hidden = false) {
        $h = '<ul class="sp-network__list"'.($hidden ? ' aria-hidden="true"' : '').'>';
        foreach ($items as $it) {
            $h .= '<li><img src="'.$base.'/'.$it[0].'" width="'.$it[1].'" height="'.$it[2].'" alt="'.($hidden ? '' : $it[3]).'" loading="lazy"></li>';
        }
        return $h.'</ul>';
    }
}
?>
<section class="sp-network" aria-label="Our Network">
    <div class="sp-inner">
        <h2 class="sp-network__title">Our Network</h2>
        <p class="sp-network__sub">Trusted by over 6,600 customers, partners, and institutions.</p>
    </div>
    <div class="sp-network__row sp-network__row--top" aria-label="고객사·파트너">
        <div class="sp-network__track">
            <?php echo sp_net_list($sp_net_rows['top'], $sp_hn); ?>
            <?php echo sp_net_list($sp_net_rows['top'], $sp_hn, true); // 무한 마퀴용 복제(보조기기엔 숨김) ?>
        </div>
    </div>
    <div class="sp-network__row sp-network__row--bottom" aria-label="대학·연구기관">
        <div class="sp-network__track">
            <?php echo sp_net_list($sp_net_rows['bottom'], $sp_hn); ?>
            <?php echo sp_net_list($sp_net_rows['bottom'], $sp_hn, true); ?>
        </div>
    </div>
</section>
