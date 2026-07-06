<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// sp-lite: 계정 레이아웃 인라인 스킨(팝업 아님). 자기/탭 링크에 ?inline=1 마커 유지.
// form action($memo_action_url)·fmemoform_submit·captcha 는 코어 계약 유지.
$sp_cap = function_exists('captcha_html') ? captcha_html() : '';
?>

<!-- 쪽지 보내기 { -->
<div class="sp-acc sp-acc-memo">
    <section class="sp-acc-panel">
        <div class="smb_panel_h"><h2>쪽지 보내기</h2></div>

        <div class="sp-acc-tabs">
            <a href="./memo.php?kind=recv">받은쪽지</a>
            <a href="./memo.php?kind=send">보낸쪽지</a>
            <a href="./memo_form.php?inline=1" class="is-on sp-acc-tabs__write"><i class="fa fa-pencil" aria-hidden="true"></i> 쪽지쓰기</a>
        </div>

        <form name="fmemoform" action="<?php echo $memo_action_url; ?>" onsubmit="return fmemoform_submit(this);" method="post" autocomplete="off" class="sp-acc-form">
            <div class="sp-acc-field">
                <label for="me_recv_mb_id">받는 회원아이디 <b class="req">*</b></label>
                <input type="text" name="me_recv_mb_id" value="<?php echo $me_recv_mb_id; ?>" id="me_recv_mb_id" required class="frm_input required" placeholder="받는 회원아이디">
                <span class="sp-acc-field__hint">여러 회원에게 보낼 땐 컴마(,)로 구분하세요.<?php if ($config['cf_memo_send_point']) { ?> 회원당 <?php echo number_format($config['cf_memo_send_point']); ?>점이 차감됩니다.<?php } ?></span>
            </div>
            <div class="sp-acc-field">
                <label for="me_memo">내용 <b class="req">*</b></label>
                <textarea name="me_memo" id="me_memo" required class="required" placeholder="내용을 입력하세요."><?php echo $content; ?></textarea>
            </div>
            <?php if ($sp_cap) { ?>
            <div class="sp-acc-field sp-acc-field--captcha"><?php echo $sp_cap; ?></div>
            <?php } ?>
            <div class="sp-acc-formbtns">
                <a href="./memo.php?kind=recv" class="sp-acc-btn sp-acc-btn--ghost">취소</a>
                <button type="submit" id="btn_submit" class="sp-acc-btn sp-acc-btn--primary">보내기</button>
            </div>
        </form>
    </section>
</div>

<script>
function fmemoform_submit(f)
{
    <?php echo chk_captcha_js(); ?>

    return true;
}
</script>
<!-- } 쪽지 보내기 -->
