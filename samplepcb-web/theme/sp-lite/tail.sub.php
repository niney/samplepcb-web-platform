<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 인라인 계정 레이아웃 클로저 (head.sub 오프너와 대칭).
// 스킨 콘텐츠 뒤에서 .account-main/#container/#wrapper 를 닫고 공용 푸터를 붙인다(shop.tail.php 와 동일 구조).
if (defined('SP_INLINE_ACCOUNT')) {
?>
        </div><!-- } .shop-content.account-main 끝 -->
    </div><!-- } #container.is-account 끝 -->
</div><!-- } #wrapper 끝 -->
<?php
    include_once(G5_THEME_PATH.'/inc/footer.php'); // 공용 푸터
}
?>

<?php if ($is_admin == 'super') {  ?><!-- <div style='float:left; text-align:center;'>RUN TIME : <?php echo get_microtime()-$begin_time; ?><br></div> --><?php }  ?>

<?php run_event('tail_sub'); ?>

</body>
</html>
<?php echo html_end(); // HTML 마지막 처리 함수 : 반드시 넣어주시기 바랍니다.
