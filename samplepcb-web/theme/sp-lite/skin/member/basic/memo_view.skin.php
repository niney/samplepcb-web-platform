<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 계정 레이아웃 인라인 스킨(팝업 아님). 답장/쪽지쓰기(memo_form) 링크에 ?inline=1 마커.
// 데이터($mb·$memo·$list_link·$del_link·$prev_link·$next_link)는 코어 bbs/memo_view.php.
$nick      = get_sideview($mb['mb_id'], $mb['mb_nick'], $mb['mb_email'], $mb['mb_homepage']);
$kind_date = ($kind == 'recv') ? '받은' : '보낸';
?>

<!-- 쪽지 보기 { -->
<div class="sp-acc sp-acc-memo">
    <section class="sp-acc-panel">
        <div class="smb_panel_h">
            <h2>쪽지 보기</h2>
            <a class="smb_panel_more" href="<?php echo $list_link; ?>">목록</a>
        </div>

        <div class="sp-acc-tabs">
            <a href="./memo.php?kind=recv"<?php echo ($kind == 'recv') ? ' class="is-on"' : ''; ?>>받은쪽지</a>
            <a href="./memo.php?kind=send"<?php echo ($kind == 'send') ? ' class="is-on"' : ''; ?>>보낸쪽지</a>
            <a href="./memo_form.php?inline=1" class="sp-acc-tabs__write"><i class="fa fa-pencil" aria-hidden="true"></i> 쪽지쓰기</a>
        </div>

        <article class="sp-acc-memo-view">
            <div class="sp-acc-memo-view__head">
                <span class="sp-acc-memo-view__ava"><?php echo get_member_profile_img($mb['mb_id']); ?></span>
                <div class="sp-acc-memo-view__who">
                    <span class="sp-acc-memo-view__nick"><?php echo $nick; ?></span>
                    <span class="sp-acc-memo-view__date"><span class="sound_only"><?php echo $kind_date; ?>시간</span><i class="fa fa-clock-o" aria-hidden="true"></i> <?php echo $memo['me_send_datetime']; ?></span>
                </div>
                <a href="<?php echo $del_link; ?>" onclick="del(this.href); return false;" class="sp-acc-memo-view__del" aria-label="삭제"><i class="fa fa-trash-o" aria-hidden="true"></i></a>
            </div>
            <div class="sp-acc-memo-view__body"><?php echo conv_content($memo['me_memo'], 0); ?></div>
        </article>

        <div class="sp-acc-memo-nav">
            <span class="sp-acc-memo-nav__side">
                <?php if ($prev_link) { ?><a href="<?php echo $prev_link; ?>"><i class="fa fa-chevron-left" aria-hidden="true"></i> 이전쪽지</a><?php } ?>
            </span>
            <?php if ($kind == 'recv') { ?>
            <a href="./memo_form.php?inline=1&amp;me_recv_mb_id=<?php echo $mb['mb_id']; ?>&amp;me_id=<?php echo $memo['me_id']; ?>" class="sp-acc-btn sp-acc-btn--primary">답장</a>
            <?php } ?>
            <span class="sp-acc-memo-nav__side sp-acc-memo-nav__side--right">
                <?php if ($next_link) { ?><a href="<?php echo $next_link; ?>">다음쪽지 <i class="fa fa-chevron-right" aria-hidden="true"></i></a><?php } ?>
            </span>
        </div>
    </section>
</div>
<!-- } 쪽지 보기 -->
