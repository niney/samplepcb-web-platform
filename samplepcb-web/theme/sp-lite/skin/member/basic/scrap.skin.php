<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 계정 레이아웃 인라인 스킨(팝업 아님). opener.document.location 팝업 의존 제거 → 순수 href 동일창 이동.
// 데이터($list[i]: opener_href_wr_id·opener_href·subject·bo_subject·ms_datetime·del_href)는 코어 bbs/scrap.php.
?>

<!-- 스크랩 { -->
<div class="sp-acc sp-acc-scrap">
    <section class="sp-acc-panel">
        <div class="smb_panel_h">
            <h2>스크랩</h2>
            <a class="smb_panel_more" href="<?php echo G5_SHOP_URL ?>/mypage.php">마이페이지</a>
        </div>

        <ul class="sp-acc-scraps">
            <?php for ($i = 0; $i < count($list); $i++) { ?>
            <li class="sp-acc-scrap-li">
                <div class="sp-acc-scrap-li__body">
                    <a href="<?php echo $list[$i]['opener_href_wr_id']; ?>" class="sp-acc-scrap-li__tit"><?php echo $list[$i]['subject']; ?></a>
                    <div class="sp-acc-scrap-li__meta">
                        <a href="<?php echo $list[$i]['opener_href']; ?>" class="sp-acc-scrap-li__cate"><i class="fa fa-folder-o" aria-hidden="true"></i> <?php echo $list[$i]['bo_subject']; ?></a>
                        <span class="sp-acc-scrap-li__date"><i class="fa fa-clock-o" aria-hidden="true"></i> <?php echo $list[$i]['ms_datetime']; ?></span>
                    </div>
                </div>
                <a href="<?php echo $list[$i]['del_href']; ?>" onclick="del(this.href); return false;" class="sp-acc-scrap-li__del" aria-label="삭제"><i class="fa fa-trash-o" aria-hidden="true"></i></a>
            </li>
            <?php } ?>

            <?php if ($i == 0) { ?>
            <li class="sp-acc-empty">스크랩한 게시글이 없습니다.</li>
            <?php } ?>
        </ul>

        <div class="sp-acc-paging"><?php echo get_paging($config['cf_write_pages'], $page, $total_page, "?$qstr&amp;page="); ?></div>
    </section>
</div>
<!-- } 스크랩 -->
