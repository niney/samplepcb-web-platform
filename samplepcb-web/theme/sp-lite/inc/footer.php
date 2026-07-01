<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite 공용 푸터 — 커뮤니티(tail.php)와 쇼핑몰(shop/shop.tail.php) 양쪽에서 include
// 회사정보: 쇼핑몰 설정($default)이 있으면 사용, 없으면 placeholder
$sp_ft = array(
    'company' => isset($default['de_admin_company_name']) && $default['de_admin_company_name'] ? $default['de_admin_company_name'] : '회사명',
    'owner'   => isset($default['de_admin_company_owner']) && $default['de_admin_company_owner'] ? $default['de_admin_company_owner'] : '대표자명',
    'addr'    => isset($default['de_admin_company_addr']) && $default['de_admin_company_addr'] ? $default['de_admin_company_addr'] : '주소',
    'saupja'  => isset($default['de_admin_company_saupja_no']) && $default['de_admin_company_saupja_no'] ? $default['de_admin_company_saupja_no'] : '000-00-00000',
    'tel'     => isset($default['de_admin_company_tel']) && $default['de_admin_company_tel'] ? $default['de_admin_company_tel'] : '00-000-0000',
    'tongsin' => isset($default['de_admin_tongsin_no']) && $default['de_admin_tongsin_no'] ? $default['de_admin_tongsin_no'] : '',
    'privacy' => isset($default['de_admin_info_name']) && $default['de_admin_info_name'] ? $default['de_admin_info_name'] : '',
);
?>
<footer id="ft" class="sp-footer">
    <h2 class="sound_only">사이트 정보</h2>
    <div class="sp-inner">
        <ul class="sp-footer__links">
            <li><a href="<?php echo get_pretty_url('content', 'company'); ?>">회사소개</a></li>
            <li><a href="<?php echo get_pretty_url('content', 'provision'); ?>">서비스이용약관</a></li>
            <li><a href="<?php echo get_pretty_url('content', 'privacy'); ?>"><b>개인정보처리방침</b></a></li>
        </ul>

        <div class="sp-footer__body">
            <div class="sp-footer__brand">SAMPLE<span>PCB</span></div>
            <p class="sp-footer__info">
                <span><b>회사명</b> <?php echo $sp_ft['company']; ?></span>
                <span><b>대표</b> <?php echo $sp_ft['owner']; ?></span>
                <span><b>사업자등록번호</b> <?php echo $sp_ft['saupja']; ?></span><br>
                <span><b>주소</b> <?php echo $sp_ft['addr']; ?></span>
                <span><b>전화</b> <?php echo $sp_ft['tel']; ?></span>
                <?php if ($sp_ft['tongsin']) { ?><br><span><b>통신판매업신고번호</b> <?php echo $sp_ft['tongsin']; ?></span><?php } ?>
                <?php if ($sp_ft['privacy']) { ?><span><b>개인정보 보호책임자</b> <?php echo $sp_ft['privacy']; ?></span><?php } ?>
            </p>
            <!-- 소셜 채널 자리 (추후 아이콘 배치) -->
            <ul class="sp-footer__sns"></ul>
        </div>

        <div class="sp-footer__copy">Copyright &copy; <b>SAMPLEPCB</b>. All rights reserved.</div>
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
