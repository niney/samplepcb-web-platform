<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite 미배치 링크 인벤토리 (작업용 임시 UI)
// - 디자인 재작성 중 아직 정식 배치하지 않은 링크를 우측 하단 플로팅 패널에 모아둔다.
// - 링크를 정식 배치하면 이 배열에서 해당 줄을 지운다. 배열이 비면 이 파일 include를 제거한다.
// - 출처: theme/basic head/tail·shop.head/shop.tail (원본은 repo의 theme/basic 에 보존)
$sp_quicklinks = array(
    '커뮤니티' => array(
        array('FAQ',        G5_BBS_URL.'/faq.php'),
        array('1:1문의',    G5_BBS_URL.'/qalist.php'),
        array('새글',       G5_BBS_URL.'/new.php'),
        array('현재접속자', G5_BBS_URL.'/current_connect.php'),
        array('전체검색',   G5_BBS_URL.'/search.php'),
    ),
);

if (defined('G5_USE_SHOP') && G5_USE_SHOP) {
    $sp_quicklinks['쇼핑몰'] = array(
        array('쇼핑몰 홈',  G5_SHOP_URL.'/'),
        array('장바구니',   G5_SHOP_URL.'/cart.php'),
        array('주문내역',   G5_SHOP_URL.'/orderinquiry.php'),
        array('마이페이지', G5_SHOP_URL.'/mypage.php'),
        // array('위시리스트', G5_SHOP_URL.'/wishlist.php'), // 숨김: SP_USE_WISHLIST=false — docs/wishlist-hidden.md
        array('쿠폰존',     G5_SHOP_URL.'/couponzone.php'),
        array('개인결제',   G5_SHOP_URL.'/personalpay.php'),
        array('사용후기',   G5_SHOP_URL.'/itemuselist.php'),
        array('상품문의',   G5_SHOP_URL.'/itemqalist.php'),
    );
}
?>
<div class="sp-float">
    <div class="sp-quick-panel" id="sp_quick_panel">
        <div class="sp-quick-panel__title">미배치 링크 <small>(작업용)</small></div>
        <?php foreach ($sp_quicklinks as $sp_group => $sp_links) { ?>
        <div class="sp-quick-panel__group">
            <div class="sp-quick-panel__label"><?php echo $sp_group; ?></div>
            <ul>
                <?php foreach ($sp_links as $sp_link) { ?>
                <li><a href="<?php echo $sp_link[1]; ?>"><?php echo $sp_link[0]; ?></a></li>
                <?php } ?>
            </ul>
        </div>
        <?php } ?>
    </div>

    <button type="button" class="sp-float__btn sp-quick-toggle" title="미배치 링크" aria-expanded="false" aria-controls="sp_quick_panel">
        <i class="fa fa-ellipsis-h" aria-hidden="true"></i><span class="sound_only">미배치 링크 열기</span>
    </button>
    <button type="button" id="top_btn" class="sp-float__btn">
        <i class="fa fa-arrow-up" aria-hidden="true"></i><span class="sound_only">상단으로</span>
    </button>
</div>

<script>
$(function() {
    $(".sp-quick-toggle").on("click", function() {
        var opened = $(".sp-float").toggleClass("is-open").hasClass("is-open");
        $(this).attr("aria-expanded", opened ? "true" : "false");
    });
    $("#top_btn").on("click", function() {
        $("html, body").animate({scrollTop: 0}, '500');
        return false;
    });
});
</script>
