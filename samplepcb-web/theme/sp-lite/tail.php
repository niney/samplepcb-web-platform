<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

if(G5_COMMUNITY_USE === false) {
    include_once(G5_THEME_SHOP_PATH.'/shop.tail.php');
    return;
}
?>
    </main>
</div>
<!-- } 콘텐츠 끝 -->

<?php
include_once(G5_THEME_PATH.'/inc/footer.php'); // 공용 푸터
include_once(G5_THEME_PATH.'/tail.sub.php');
