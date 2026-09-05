<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite 공용 푸터 — 커뮤니티(tail.php)와 쇼핑몰(shop/shop.tail.php) 양쪽에서 include
// 디자인: Figma 「웹 메인」(2122:5280) 의 푸터(2122:6043) 2026-09-06 — 다크(#202a37) 346px.
//   [회사명 | CEO] / [주소 · Fax] / [사업자등록번호 | 통신판매업신고번호 | 개인정보관리자] / 구분선 /
//   [회사소개 · 서비스 이용약관 · 개인정보처리방침]  …  [전화 · 이메일] / 구분선 / [로고 · copyright  …  SNS 4]
// 회사정보: 쇼핑몰 설정($default)이 있으면 사용, 없으면 피그마 문구. SNS·전화·이메일 링크는 미정(사용자 결정) — 아이콘·문구만.
function sp_ft_val($key, $fallback) {
    global $default;
    return (isset($default[$key]) && trim($default[$key]) !== '') ? $default[$key] : $fallback;
}
$sp_ft = array(
    'company' => sp_ft_val('de_admin_company_name', '주식회사 샘플피씨비'),
    'owner'   => sp_ft_val('de_admin_company_owner', '오혜영'),
    'addr'    => sp_ft_val('de_admin_company_addr', '경기도 광명시 하안로 60 광명SK테크노파크 A-1303,1407'),
    'fax'     => '02-6455-4490', // 쇼핑몰 설정에 팩스 항목이 없어 고정
    'saupja'  => sp_ft_val('de_admin_company_saupja_no', '331-88-01750'),
    'tongsin' => sp_ft_val('de_admin_tongsin_no', '2024-경기광명-0624'),
    'privacy' => sp_ft_val('de_admin_info_name', '오혜영'),
    'tel'     => sp_ft_val('de_admin_company_tel', '070-8667-1080~1'),
    'email'   => sp_ft_val('de_admin_info_email', 'info@samplepcb.co.kr'),
);
$sp_ft_ico = G5_THEME_URL.'/img/footer';
?>
<footer id="ft" class="sp-footer">
    <h2 class="sound_only">사이트 정보</h2>
    <div class="sp-inner">
        <div class="sp-footer__co">
            <p class="sp-footer__co-name"><span><?php echo $sp_ft['company']; ?></span><i class="sp-footer__vr" aria-hidden="true"></i><span>CEO&nbsp;&nbsp;<?php echo $sp_ft['owner']; ?></span></p>
            <p class="sp-footer__co-line"><span><?php echo $sp_ft['addr']; ?></span><span>Fax. <?php echo $sp_ft['fax']; ?></span></p>
            <p class="sp-footer__co-line sp-footer__co-line--tight">
                <span>사업자등록번호&nbsp;&nbsp;<?php echo $sp_ft['saupja']; ?></span><i class="sp-footer__vr" aria-hidden="true"></i>
                <span>통신판매업신고번호&nbsp;&nbsp;<?php echo $sp_ft['tongsin']; ?></span><i class="sp-footer__vr" aria-hidden="true"></i>
                <span>개인정보관리자&nbsp;&nbsp;<?php echo $sp_ft['privacy']; ?></span>
            </p>
        </div>

        <div class="sp-footer__mid">
            <ul class="sp-footer__links">
                <li><a href="<?php echo G5_URL ?>/about">회사소개</a></li>
                <li><a href="<?php echo get_pretty_url('content', 'provision'); ?>">서비스 이용약관</a></li>
                <li><a href="<?php echo get_pretty_url('content', 'privacy'); ?>">개인정보처리방침</a></li>
            </ul>
            <ul class="sp-footer__contact">
                <li><img src="<?php echo $sp_ft_ico; ?>/ico-phone.svg" alt="전화" width="16" height="16"><span><?php echo $sp_ft['tel']; ?></span></li>
                <li><img src="<?php echo $sp_ft_ico; ?>/ico-mail.svg" alt="이메일" width="16" height="16"><span><?php echo $sp_ft['email']; ?></span></li>
            </ul>
        </div>

        <div class="sp-footer__bottom">
            <a href="<?php echo G5_URL ?>/" class="sp-footer__logo"><img src="<?php echo G5_THEME_URL ?>/img/logo-header.png" width="175" height="28" alt="SAMPLEPCB"></a>
            <p class="sp-footer__copy">Copyright &copy; samplepcb.co.kr all rights reserved.</p>
            <ul class="sp-footer__sns" aria-label="소셜 채널">
                <li><span class="sp-footer__sns-ico" title="Facebook"><img src="<?php echo $sp_ft_ico; ?>/sns-facebook.svg" alt="Facebook" width="30" height="30"></span></li>
                <li><span class="sp-footer__sns-ico" title="Blog"><img src="<?php echo $sp_ft_ico; ?>/sns-blog.svg" alt="Blog" width="29" height="29"></span></li>
                <li><span class="sp-footer__sns-ico" title="YouTube"><img src="<?php echo $sp_ft_ico; ?>/sns-youtube.svg" alt="YouTube" width="34" height="24"></span></li>
                <li><span class="sp-footer__sns-ico" title="KakaoTalk"><img src="<?php echo $sp_ft_ico; ?>/sns-kakao.svg" alt="KakaoTalk" width="35" height="32"></span></li>
            </ul>
        </div>
    </div>
</footer>

<?php include_once(G5_THEME_PATH.'/inc/quicklinks.php'); // 우측 하단 플로팅: 미배치 링크 + 상단으로 ?>

<script>
$(function() {
    // 폰트 리사이즈 쿠키가 있으면 적용 (common.js)
    font_resize("container", get_cookie("ck_font_resize_rmv_class"), get_cookie("ck_font_resize_add_class"));
});
</script>

<?php
if ($config['cf_analytics']) {
    echo $config['cf_analytics'];
}
