<?php
// samplepcb 정적 페이지 — 회사소개
// URL: /about (루트 .htaccess 가 /spcb/pages/about.php 로 내부 리라이트)
// 출처: 레거시 theme/samplepcb/company_v2/about.php 마이그레이션
//       (이미지: theme/sp-lite/img/company/ 로 복사, 카피는 원문 유지)

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $config, $member, 테마 상수

$g5['title'] = '회사소개';
include_once(G5_THEME_PATH.'/head.php');

$img = G5_THEME_URL.'/img/company';
?>

<style>
/* /about 전용 스타일 (sp-lite 토큰 사용) */
.sp-about { text-align: center; }
.sp-about__eyebrow {
    margin: 16px 0 20px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: .12em;
    color: var(--sp-primary);
    text-transform: uppercase;
}
.sp-about__headline { margin: 0 auto; max-width: 44em; font-size: 22px; font-weight: 700; line-height: 1.75; }
.sp-about__para { margin: 72px auto; max-width: 46em; font-size: 18px; line-height: 1.9; color: var(--sp-muted); }
.sp-about__para b { color: var(--sp-primary); font-weight: 700; }

.sp-about__cards {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
    margin: 48px 0 0;
    padding: 32px;
    background: var(--sp-primary-soft);
    border-radius: 16px;
    list-style: none;
}
.sp-about__cards li { font-size: 14.5px; line-height: 1.6; color: var(--sp-ink); }
.sp-about__cards img { display: block; height: 72px; width: auto; margin: 0 auto 14px; }

.sp-about__cards--benefit { background: var(--sp-primary); color: #fff; grid-template-columns: repeat(4, 1fr); }
.sp-about__cards--benefit li { color: #fff; }
.sp-about__cards--benefit .t { display: block; font-size: 17px; font-weight: 700; margin-bottom: 6px; }

.sp-about__brand { margin: 0 0 64px; }
.sp-about__brand img { display: block; margin: 0 auto; max-width: 100%; }
.sp-about__brand img + img { margin-top: 40px; }

@media (max-width: 1023.98px) {
    .sp-about__headline { font-size: 18px; }
    .sp-about__para { margin: 48px auto; font-size: 16px; }
    .sp-about__cards { grid-template-columns: repeat(2, 1fr); gap: 24px 12px; }
    .sp-about__cards--benefit { grid-template-columns: repeat(2, 1fr); }
}
</style>

<div class="sp-about">
    <p class="sp-about__eyebrow">About SamplePCB</p>
    <p class="sp-about__headline">
        PCB는 모든 산업에서 사용되고 있는 필수 소재이지만, 개발에서 생산까지에는<br>
        많은 인력과 비용, 시간이 소요되고 있고 아래와 같은 문제점은 계속 진행중입니다.
    </p>

    <ul class="sp-about__cards">
        <li><img src="<?php echo $img ?>/about1.png" alt="">PCB 설계상 오류<br>검증의 어려움</li>
        <li><img src="<?php echo $img ?>/about2.png" alt="">부품의 재고&amp;가격<br>확인의 어려움</li>
        <li><img src="<?php echo $img ?>/about3.png" alt="">신뢰할 수 있는<br>생산공장 정보부족</li>
        <li><img src="<?php echo $img ?>/about4.png" alt="">사전불량 검출, 품질관리<br>관리의 어려움</li>
        <li><img src="<?php echo $img ?>/about5.png" alt="">전문성과 책임감있는<br>외주업체 정보부족</li>
    </ul>

    <p class="sp-about__para">
        PCB ONE-STOP 제조플랫폼 <b>"㈜샘플피씨비"</b>는<br>
        PCB제조과정중 단순 반복업무가 개선되지 않고 있어,<br>
        업무 개선과 Digital Transformation 전환을 위한 혁신을 이루고자 시작하였습니다.
    </p>

    <div class="sp-about__brand">
        <img src="<?php echo $img ?>/logo.png" alt="샘플피씨비 로고">
        <img src="<?php echo $img ?>/about_onestop.png" alt="PCB 원스톱 제조 플랫폼 개요">
    </div>

    <p class="sp-about__para">
        언제 어디서나 손쉽게 주문 할 수 있어 시간이 절약되고, 필요한 부분 외주처리를 함으로써 인원절감을 할 수 있고,<br>
        전세계 생산, 유통업체와 협력으로 경쟁력 있는 가격으로 대응 함으로써 비용절감을 할 수 있으며,<br>
        전문적인 생산관리와 품질관리를 통해 고객은 매우 편리함을 제공 받을 수 있습니다.
    </p>

    <ul class="sp-about__cards sp-about__cards--benefit">
        <li><img src="<?php echo $img ?>/feat1.png" alt=""><span class="t">시간절약</span>언제 어디서나 손쉽게 주문가능</li>
        <li><img src="<?php echo $img ?>/feat2.png" alt=""><span class="t">인원절감</span>필요한 부분 외주처리가능</li>
        <li><img src="<?php echo $img ?>/feat3.png" alt=""><span class="t">비용절감</span>전세계 생산, 유통업체와 협력으로<br>경쟁력 있는 가격</li>
        <li><img src="<?php echo $img ?>/feat4.png" alt=""><span class="t">편리함</span>전문적인 생산관리와 품질관리</li>
    </ul>
</div>

<?php
include_once(G5_THEME_PATH.'/tail.php');
