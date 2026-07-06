<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 계정 레이아웃 인라인 스킨(팝업 아님). 스타일 default_shop.css .sp-acc-*.
// memo_form 으로 가는 링크에만 ?inline=1 마커(코어 사이드뷰 팝업과 구분). 데이터는 코어 bbs/memo.php.
?>

<!-- 쪽지함 { -->
<div class="sp-acc sp-acc-memo">
    <section class="sp-acc-panel">
        <div class="smb_panel_h">
            <h2>쪽지함</h2>
            <span class="sp-acc-count"><?php echo $kind_title; ?>쪽지 <strong><?php echo (int) $total_count; ?></strong>통</span>
        </div>

        <div class="sp-acc-tabs">
            <a href="./memo.php?kind=recv"<?php echo ($kind == 'recv') ? ' class="is-on"' : ''; ?>>받은쪽지</a>
            <a href="./memo.php?kind=send"<?php echo ($kind == 'send') ? ' class="is-on"' : ''; ?>>보낸쪽지</a>
            <a href="./memo_form.php?inline=1" class="sp-acc-tabs__write"><i class="fa fa-pencil" aria-hidden="true"></i> 쪽지쓰기</a>
        </div>

        <ul class="sp-acc-memos">
            <?php
            for ($i = 0; $i < count($list); $i++) {
                $readed = (substr($list[$i]['me_read_datetime'], 0, 1) == 0) ? '' : 'read';
                $memo_preview = utf8_strcut(strip_tags($list[$i]['me_memo']), 60, '..');
            ?>
            <li class="sp-acc-memo-li<?php echo $readed ? '' : ' is-unread'; ?>">
                <span class="sp-acc-memo-li__ava"><?php echo get_member_profile_img($list[$i]['mb_id']); ?></span>
                <div class="sp-acc-memo-li__body">
                    <div class="sp-acc-memo-li__top">
                        <span class="sp-acc-memo-li__name"><?php echo $list[$i]['name']; ?></span>
                        <span class="sp-acc-memo-li__date"><i class="fa fa-clock-o" aria-hidden="true"></i> <?php echo $list[$i]['send_datetime']; ?></span>
                        <?php if (!$readed) { ?><span class="sp-acc-memo-li__badge">안 읽음</span><?php } ?>
                    </div>
                    <a href="<?php echo $list[$i]['view_href']; ?>" class="sp-acc-memo-li__preview"><?php echo $memo_preview ? $memo_preview : '(내용 없음)'; ?></a>
                </div>
                <a href="<?php echo $list[$i]['del_href']; ?>" onclick="del(this.href); return false;" class="sp-acc-memo-li__del" aria-label="삭제"><i class="fa fa-trash-o" aria-hidden="true"></i></a>
            </li>
            <?php } ?>

            <?php if ($i == 0) { ?>
            <li class="sp-acc-empty">쪽지가 없습니다.</li>
            <?php } ?>
        </ul>

        <div class="sp-acc-paging"><?php echo $write_pages; ?></div>

        <p class="sp-acc-note"><i class="fa fa-info-circle" aria-hidden="true"></i> 쪽지 보관일수는 최장 <strong><?php echo $config['cf_memo_del']; ?></strong>일입니다.</p>
    </section>
</div>
<!-- } 쪽지함 -->
