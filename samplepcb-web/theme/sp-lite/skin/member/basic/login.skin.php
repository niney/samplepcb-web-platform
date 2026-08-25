<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// add_stylesheet('css 구문', 출력순서); 숫자가 작을 수록 먼저 출력됨
// 소셜로그인 스킨 css(순서 10)보다 뒤에 실어 #sns_login 재스타일이 이기게 한다
add_stylesheet('<link rel="stylesheet" href="'.$member_skin_url.'/style.css?ver='.G5_CSS_VER.'">', 20);
?>

<!-- 로그인 시작 { -->
<!-- Figma: Samplepcb_Web › 일반고객_로그인 (node 103:3337) -->
<div id="mb_login" class="mbskin">
    <div class="mb_login_card">
        <div class="mb_login_visual" aria-hidden="true">
            <img class="mb_login_visual__photo" src="<?php echo $member_skin_url ?>/img/login-hero.jpg" alt="">
            <div class="mb_login_visual__brand">
                <img class="mb_login_visual__mark" src="<?php echo $member_skin_url ?>/img/pcb-mark-white.png" alt="">
                <span class="mb_login_visual__logo"><img src="<?php echo $member_skin_url ?>/img/logo-white.svg" alt="SamplePCB"></span>
            </div>
        </div>

        <div class="mb_login_panel">
            <div class="mb_login_head">
                <h2><span class="sound_only">회원</span>로그인</h2>
                <p>Welcome to SAMPLE PCB</p>
            </div>

            <form name="flogin" action="<?php echo $login_action_url ?>" onsubmit="return flogin_submit(this);" method="post">
            <input type="hidden" name="url" value="<?php echo $login_url ?>">

            <fieldset id="login_fs">
                <legend class="sound_only">회원로그인</legend>

                <div class="mb_login_field mb_login_field--id">
                    <label for="login_id" class="sound_only">회원아이디<strong class="sound_only"> 필수</strong></label>
                    <input type="text" name="mb_id" id="login_id" required class="frm_input required" size="20" maxLength="20" placeholder="User ID" autocomplete="username">
                </div>
                <div class="mb_login_field mb_login_field--pw">
                    <label for="login_pw" class="sound_only">비밀번호<strong class="sound_only"> 필수</strong></label>
                    <input type="password" name="mb_password" id="login_pw" required class="frm_input required" size="20" maxLength="20" placeholder="Password" autocomplete="current-password">
                </div>

                <div id="login_info">
                    <div class="login_if_remember chk_box">
                        <input type="checkbox" id="login_remember_id" class="selec_chk">
                        <label for="login_remember_id">아이디 기억하기</label>
                    </div>
                    <div class="login_if_auto chk_box">
                        <input type="checkbox" name="auto_login" id="login_auto_login" class="selec_chk">
                        <label for="login_auto_login">자동로그인</label>
                    </div>
                </div>

                <button type="submit" class="btn_submit">로그인</button>
            </fieldset>
            </form>

            <div class="mb_login_links">
                <a href="<?php echo G5_BBS_URL ?>/register.php" class="join">회원가입</a>
                <a href="<?php echo G5_BBS_URL ?>/password_lost.php">비밀번호 초기화</a>
            </div>

            <?php @include_once(get_social_skin_path().'/social_login.skin.php'); // 소셜로그인 사용시 소셜로그인 버튼 ?>
        </div>
    </div>

    <?php // 쇼핑몰 사용시 여기부터 ?>
    <?php if (isset($default['de_level_sell']) && $default['de_level_sell'] == 1) { // 상품구입 권한 ?>

	<!-- 주문하기, 신청하기 -->
	<?php if (preg_match("/orderform.php/", $url)) { ?>
    <section id="mb_login_notmb" class="mb_login_sub">
        <h2>비회원 구매</h2>
        <p>비회원으로 주문하시는 경우 포인트는 지급하지 않습니다.</p>

        <div id="guest_privacy">
            <?php echo conv_content($default['de_guest_privacy'], $config['cf_editor']); ?>
        </div>

		<div class="chk_box">
			<input type="checkbox" id="agree" value="1" class="selec_chk">
        	<label for="agree">개인정보수집에 대한 내용을 읽었으며 이에 동의합니다.</label>
		</div>

        <div class="btn_confirm">
            <a href="javascript:guest_submit(document.flogin);" class="btn_submit">비회원으로 구매하기</a>
        </div>

        <script>
        function guest_submit(f)
        {
            if (document.getElementById('agree')) {
                if (!document.getElementById('agree').checked) {
                    alert("개인정보수집에 대한 내용을 읽고 이에 동의하셔야 합니다.");
                    return;
                }
            }

            f.url.value = "<?php echo $url; ?>";
            f.action = "<?php echo $url; ?>";
            f.submit();
        }
        </script>
    </section>

    <?php } else if (preg_match("/orderinquiry.php$/", $url)) { ?>
    <div id="mb_login_od_wr" class="mb_login_sub">
        <h2>비회원 주문조회</h2>

        <fieldset id="mb_login_od">
            <legend class="sound_only">비회원 주문조회</legend>

            <form name="forderinquiry" method="post" action="<?php echo urldecode($url); ?>" autocomplete="off">

            <label for="od_id" class="od_id sound_only">주문서번호<strong class="sound_only"> 필수</strong></label>
            <input type="text" name="od_id" value="<?php echo get_text($od_id); ?>" id="od_id" required class="frm_input required" size="20" placeholder="주문서번호">
            <label for="od_pwd" class="od_pwd sound_only">비밀번호 <strong>필수</strong></label>
            <input type="password" name="od_pwd" size="20" id="od_pwd" required class="frm_input required" placeholder="비밀번호">
            <button type="submit" class="btn_submit">확인</button>

            </form>
        </fieldset>

        <section id="mb_login_odinfo">
            <p>메일로 발송해드린 주문서의 <strong>주문번호</strong> 및 주문 시 입력하신 <strong>비밀번호</strong>를 정확히 입력해주십시오.</p>
        </section>

    </div>
    <?php } ?>

    <?php } ?>
    <?php // 쇼핑몰 사용시 여기까지 반드시 복사해 넣으세요 ?>

</div>

<script>
jQuery(function($){
    // 소셜로그인 스킨(코어 skin/social)의 제목을 디자인 문구로 — 마크업은 코어라 여기서 바꾼다
    $("#sns_login h3").text("SNS 계정으로 로그인");

    // 아이디 기억하기 — 브라우저 localStorage 에만 저장(서버 무관)
    var REMEMBER_KEY = 'sp_login_remember_id';
    var $id = $("#login_id"), $remember = $("#login_remember_id");
    try {
        var saved = window.localStorage.getItem(REMEMBER_KEY);
        if (saved) {
            $id.val(saved);
            $remember.prop('checked', true);
            $("#login_pw").trigger('focus');
        }
    } catch (e) {}

    $("#login_auto_login").click(function(){
        if (this.checked) {
            this.checked = confirm("자동로그인을 사용하시면 다음부터 회원아이디와 비밀번호를 입력하실 필요가 없습니다.\n\n공공장소에서는 개인정보가 유출될 수 있으니 사용을 자제하여 주십시오.\n\n자동로그인을 사용하시겠습니까?");
        }
    });
});

function flogin_submit(f)
{
    try {
        var remember = document.getElementById('login_remember_id');
        if (remember && remember.checked) {
            window.localStorage.setItem('sp_login_remember_id', f.mb_id.value);
        } else {
            window.localStorage.removeItem('sp_login_remember_id');
        }
    } catch (e) {}

    if( $( document.body ).triggerHandler( 'login_sumit', [f, 'flogin'] ) !== false ){
        return true;
    }
    return false;
}
</script>
<!-- } 로그인 끝 -->
