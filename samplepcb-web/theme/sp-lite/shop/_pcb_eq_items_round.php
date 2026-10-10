<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가
/*
 * 주문 상세 — 제조 확인 **문항형 회차**(D20) 카드 하나. 정본 docs/PCB_PARTNER_TRACK.md 「D20 설계」.
 * orderinquiryview.php 의 제조 확인 섹션(#sp_eq_wrap)이 format=items 인 회차마다 include 한다
 * ($rv = 계약 CustomerPcbEqReviewView, $od_id 전제). 문구형(D16, format=message)은 이 파일을 쓰지 않는다.
 *
 * 형식은 BOM 부품 확인(D43, _bom_confirm_section.php)을 따른다 — 항목 카드 · 선택지 라디오 ·
 * 확대 대화상자 · 회신 폼. 메일·마이페이지 목록(/shop/eq)의 링크가 모두 #eq-{회차 id} 로 온다.
 *
 * 판정·저장은 전부 sp-node 다: 회신 = POST+CSRF 브리지(spcb/api/eq-answer.php → POST /api/pcb-eq-reviews/:id/answer).
 * 여기서 하는 검사(전 항목·의견 필수·동의)는 **안내용**이고 최종 판정은 서버가 한다.
 * ⚠ 어휘: 'EQ'·협력사명·공장 원문을 쓰지 않는다(P4.1-b — 메탈마스크도 같은 축을 쓴다). 원문·비공개 그림은
 *   서버가 고객 응답에서 이미 뺐고, 그림 파일명도 공장 이름이 섞일 수 있어 화면에 쓰지 않는다('참고 그림 N').
 */

$eqi_id    = (int) $rv['id'];
$eqi_open  = ($rv['status'] === 'requested');
$eqi_items = isset($rv['items']) && is_array($rv['items']) ? $rv['items'] : array();
$eqi_round = isset($rv['roundNo']) ? (int) $rv['roundNo'] : 0;
$eqi_st    = sp_pcb_eq_status_label($rv['status']);
// 회신이 거절돼 되돌아온 경우 — 고른 값을 한 번 되살린다(eq-answer.php 가 세션에 남김).
$eqi_draft = $eqi_open && function_exists('sp_pcb_eq_answer_draft_take') ? sp_pcb_eq_answer_draft_take($eqi_id) : null;

/** 선택지 목록에서 기호로 찾기 — 없으면 null(선택지가 고쳐져 사라진 기호). */
if (!function_exists('sp_eqi_option_of')) {
    function sp_eqi_option_of($options, $key)
    {
        if ($key === null || $key === '') return null;
        foreach ($options as $o) {
            if ((string) $o['key'] === (string) $key) return $o;
        }
        return null;
    }
}

/** 고른 답 한 줄 — "B. 위치를 지정하겠습니다" (선택지가 사라졌으면 기호만). */
if (!function_exists('sp_eqi_answer_text')) {
    function sp_eqi_answer_text($key, $label)
    {
        return sp_pcb_eq_h($key) . ($label !== null && $label !== '' ? '. ' . sp_pcb_eq_h($label) : '');
    }
}

// 개정 회차 안내 — 이전 답을 그대로 둔 항목이 하나라도 있으면 "바뀐 항목만 보시면 된다"고 먼저 말한다.
$eqi_has_kept = false;
foreach ($eqi_items as $it) {
    if ($eqi_open && $it['change'] === 'same' && !empty($it['prev']['answer'])
        && sp_eqi_option_of($it['options'], $it['prev']['answer']['key']) !== null) {
        $eqi_has_kept = true;
        break;
    }
}
?>
<div class="sp_eq_item sp_eqi_round<?php echo $eqi_open ? ' sp_eq_open' : ''; ?>" id="eq-<?php echo $eqi_id; ?>">
    <div class="sp_eq_head">
        <span class="sp_eq_badge <?php echo $eqi_st['cls']; ?>"><?php echo $eqi_st['label']; ?></span>
        <strong class="sp_eq_proj"><?php echo sp_pcb_eq_h($rv['projectName']); ?></strong>
        <?php if ($eqi_round >= 2): ?>
            <span class="sp_eqi_round_no"><?php echo $eqi_round; ?>차 확인</span>
        <?php endif; ?>
        <?php if ($eqi_open && !empty($rv['overdue'])): ?>
            <span class="sp_eq_badge sp_eq_no">회신 기한 지남</span>
        <?php elseif ($eqi_open && !empty($rv['dueOn'])): ?>
            <span class="sp_eq_due">회신 기한 <?php echo date('Y-m-d', strtotime($rv['dueOn'])); ?></span>
        <?php endif; ?>
    </div>

    <?php if (trim((string) $rv['message']) !== ''): ?>
    <?php // .sp_eq_msg 는 white-space:pre-wrap 이라 nl2br 없이 줄바꿈이 산다(겹 줄바꿈 방지). ?>
    <div class="sp_eq_msg"><?php echo sp_pcb_eq_h($rv['message']); ?></div>
    <?php endif; ?>

    <?php if (!empty($rv['files'])): ?>
    <ul class="sp_eq_files">
        <?php foreach ($rv['files'] as $f): ?>
        <li><a href="<?php echo sp_pcb_eq_file_url($eqi_id, $f['fileId']); ?>">⬇ <?php echo sp_pcb_eq_h($f['name']); ?></a></li>
        <?php endforeach; ?>
    </ul>
    <?php endif; ?>

    <?php if ($eqi_open): ?>
    <?php if ($eqi_has_kept): ?>
    <p class="sp_eqi_revnote">지난 확인 이후 제조사가 내용을 고쳐 다시 보냈습니다. 이전과 같은 항목은 지난 답변을 그대로 두었으니, <b>바뀐 항목과 새 항목</b>만 골라 주세요.</p>
    <?php endif; ?>
    <form method="post" action="<?php echo G5_URL; ?>/spcb/api/eq-answer" class="sp_eqi_form" novalidate<?php echo $eqi_draft ? ' data-eqi-restored="1"' : ''; ?>>
        <!-- get_token() 은 hidden 을 출력하지 않고 **값만 반환**한다(그냥 echo 하면 화면에 찍힌다 — P4.1 함정). -->
        <input type="hidden" name="token" value="<?php echo get_token(); ?>">
        <input type="hidden" name="od_id" value="<?php echo sp_pcb_eq_h($od_id); ?>">
        <input type="hidden" name="review_id" value="<?php echo $eqi_id; ?>">
        <input type="hidden" name="version" value="<?php echo (int) $rv['version']; ?>">
    <?php endif; ?>

    <?php $eqi_picked_n = 0; // 진행 "n/N 답변"의 첫 값(미리 고른 항목 수) — 이후는 스크립트가 센다 ?>
    <ol class="sp_eqi_list">
        <?php foreach ($eqi_items as $n => $it):
            $iid     = (int) $it['id'];
            $no      = $n + 1;
            $options = isset($it['options']) && is_array($it['options']) ? $it['options'] : array();
            $figures = isset($it['figures']) && is_array($it['figures']) ? $it['figures'] : array();
            $change  = isset($it['change']) ? (string) $it['change'] : '';
            $prev    = !empty($it['prev']) ? $it['prev'] : null;
            $prev_ans = ($prev && !empty($prev['answer'])) ? $prev['answer'] : null;

            // ── 미리 고를 값 — 되살린 값(거절 뒤) > '동일' 항목의 이전 답. 화면에 없는 기호는 버린다.
            $pick_key = null;
            $pick_cmt = '';
            $kept     = false; // 이전 답을 그대로 두고 접은 항목
            if ($eqi_open) {
                $prev_ok = ($change === 'same' && $prev_ans && sp_eqi_option_of($options, $prev_ans['key']) !== null);
                if ($eqi_draft && (isset($eqi_draft['answers'][$iid]) || isset($eqi_draft['comments'][$iid]))) {
                    $dk = isset($eqi_draft['answers'][$iid]) ? (string) $eqi_draft['answers'][$iid] : '';
                    $pick_key = sp_eqi_option_of($options, $dk) !== null ? $dk : null;
                    $pick_cmt = isset($eqi_draft['comments'][$iid]) ? (string) $eqi_draft['comments'][$iid] : '';
                    // 되살린 값이 이전 답과 같으면 계속 접어 둔다(고객이 펼쳐 바꾼 게 아니다).
                    $kept = $prev_ok && $pick_key === (string) $prev_ans['key']
                         && $pick_cmt === (string) (isset($prev_ans['comment']) ? $prev_ans['comment'] : '');
                } elseif ($prev_ok) {
                    $pick_key = (string) $prev_ans['key'];
                    $pick_cmt = isset($prev_ans['comment']) ? (string) $prev_ans['comment'] : '';
                    $kept = true;
                }
            }
            $pick_opt  = sp_eqi_option_of($options, $pick_key);
            $need_cmt  = $pick_opt !== null && !empty($pick_opt['requiresComment']);
            $answer    = !empty($it['answer']) ? $it['answer'] : null;
            $ans_opt   = $answer ? sp_eqi_option_of($options, $answer['key']) : null;
            $chg_label = sp_pcb_eq_item_change_label($change);
            if ($pick_opt !== null) $eqi_picked_n += 1;
        ?>
        <li class="sp_eqi_card<?php echo $kept ? ' is-kept' : ''; ?><?php echo $eqi_open ? '' : ' is-readonly'; ?>"
            id="eqi-<?php echo $iid; ?>" data-item="<?php echo $iid; ?>" data-no="<?php echo $no; ?>">
            <div class="sp_eqi_h">
                <span class="sp_eqi_no">항목 <?php echo $no; ?></span>
                <span class="sp_eqi_cat"><?php echo sp_pcb_eq_item_category_label($it['category']); ?></span>
                <?php
                // '동일'은 배지 대신 접힘으로 말한다 — 접을 수 없는 경우(이전 답이 없음)에만 조용한 배지.
                if ($change === 'new' || $change === 'changed'): ?>
                    <span class="sp_eqi_chg sp_eqi_chg--<?php echo $change; ?>"><?php echo $chg_label; ?></span>
                <?php elseif ($change === 'same' && !$kept): ?>
                    <span class="sp_eqi_chg sp_eqi_chg--same"><?php echo $chg_label; ?></span>
                <?php endif; ?>
            </div>

            <?php if ($kept): ?>
            <div class="sp_eqi_keep">
                <?php // 펼친 뒤에는 '유지'가 아니라 비교 기준이 된다 — 같은 줄의 말만 바꾼다(CSS .is-unfolded). ?>
                <span class="sp_eqi_keep_t"><span class="sp_eqi_when_kept">이전 답변 유지</span><span class="sp_eqi_when_open">지난번 답변</span></span>
                <span class="sp_eqi_keep_v">
                    <b><?php echo sp_eqi_answer_text($prev_ans['key'], $prev['answerLabel']); ?></b>
                    <?php if (!empty($prev_ans['comment'])): ?>
                        <span class="sp_eqi_keep_c">의견: <?php echo sp_pcb_eq_h($prev_ans['comment']); ?></span>
                    <?php endif; ?>
                </span>
                <button type="button" class="sp_eqi_unfold" aria-expanded="false" aria-controls="eqi-body-<?php echo $iid; ?>">바꾸기</button>
            </div>
            <?php endif; ?>

            <div class="sp_eqi_body" id="eqi-body-<?php echo $iid; ?>"<?php echo $kept ? ' hidden' : ''; ?>>
                <div class="sp_eqi_q"><?php echo sp_pcb_eq_h($it['question']); ?></div>

                <?php if ($eqi_open && $change === 'changed' && $prev_ans): ?>
                <p class="sp_eqi_prev">지난번 답변: <b><?php echo sp_eqi_answer_text($prev_ans['key'], $prev['answerLabel']); ?></b>
                    <?php if (!empty($prev_ans['comment'])): ?> — <?php echo sp_pcb_eq_h($prev_ans['comment']); ?><?php endif; ?>
                </p>
                <?php endif; ?>

                <?php if ($figures): ?>
                <ul class="sp_eqi_figs">
                    <?php foreach ($figures as $fi => $fg):
                        $furl = sp_pcb_eq_figure_url($eqi_id, $fg['fileId']);
                        $falt = '항목 ' . $no . ' 참고 그림' . (count($figures) > 1 ? ' ' . ($fi + 1) : '');
                    ?>
                    <li>
                        <a class="sp_eqi_fig" href="<?php echo $furl; ?>" target="_blank" rel="noopener" data-eqi-fig title="크게 보기">
                            <img src="<?php echo $furl; ?>" alt="<?php echo $falt; ?>" loading="lazy">
                        </a>
                    </li>
                    <?php endforeach; ?>
                </ul>
                <?php endif; ?>

                <?php if ($eqi_open): ?>
                <fieldset class="sp_eqi_opts">
                    <legend class="sound_only">항목 <?php echo $no; ?> 처리 방법</legend>
                    <?php foreach ($options as $op):
                        $ok = (string) $op['key'];
                    ?>
                    <label class="sp_eqi_opt">
                        <input type="radio" name="answer[<?php echo $iid; ?>]" value="<?php echo sp_pcb_eq_h($ok); ?>"
                               data-need-comment="<?php echo !empty($op['requiresComment']) ? '1' : '0'; ?>"
                               <?php echo $pick_key !== null && $pick_key === $ok ? 'checked' : ''; ?>>
                        <span class="sp_eqi_key"><?php echo sp_pcb_eq_h($ok); ?></span>
                        <span class="sp_eqi_olabel"><?php echo sp_pcb_eq_h($op['label']); ?></span>
                        <?php if (!empty($op['recommended'])): ?><span class="sp_eqi_rec">제조사 권장</span><?php endif; ?>
                        <?php if (!empty($op['requiresComment'])): ?><span class="sp_eqi_needtag">의견 필요</span><?php endif; ?>
                    </label>
                    <?php endforeach; ?>
                </fieldset>
                <label class="sp_eqi_cmt">
                    <span class="sp_eqi_cmt_t">의견 <em data-eqi-cmt-hint><?php echo $need_cmt ? '(필수 — 2자 이상)' : '(선택)'; ?></em></span>
                    <textarea name="comment[<?php echo $iid; ?>]" rows="2" maxlength="2000"<?php echo $need_cmt ? ' required' : ''; ?>
                              placeholder="원하시는 내용을 적어 주세요. 예) 좌측 하단 빈 곳에 넣어 주세요."><?php echo sp_pcb_eq_h($pick_cmt); ?></textarea>
                </label>
                <p class="sp_eqi_err" data-eqi-err role="alert" hidden></p>
                <?php else: ?>
                    <?php if ($answer): ?>
                    <dl class="sp_eqi_ans">
                        <dt>선택</dt>
                        <dd>
                            <b><?php echo sp_eqi_answer_text($answer['key'], $ans_opt ? $ans_opt['label'] : null); ?></b>
                            <?php if ($ans_opt && !empty($ans_opt['recommended'])): ?><span class="sp_eqi_rec">제조사 권장</span><?php endif; ?>
                        </dd>
                        <?php if (!empty($answer['comment'])): ?>
                        <dt>의견</dt>
                        <dd class="sp_eqi_ans_c"><?php echo sp_pcb_eq_h($answer['comment']); ?></dd>
                        <?php endif; ?>
                    </dl>
                    <?php else: ?>
                    <ul class="sp_eqi_optlist">
                        <?php foreach ($options as $op): ?>
                        <li><span class="sp_eqi_key"><?php echo sp_pcb_eq_h($op['key']); ?></span> <?php echo sp_pcb_eq_h($op['label']); ?>
                            <?php if (!empty($op['recommended'])): ?><span class="sp_eqi_rec">제조사 권장</span><?php endif; ?></li>
                        <?php endforeach; ?>
                    </ul>
                    <?php endif; ?>
                <?php endif; ?>
            </div>
        </li>
        <?php endforeach; ?>
    </ol>

    <?php if ($eqi_open): ?>
        <div class="sp_eqi_foot">
            <p class="sp_eqi_progress" aria-live="polite"><b data-eqi-progress><?php echo $eqi_picked_n; ?>/<?php echo count($eqi_items); ?></b> 답변</p>
            <label class="sp_eqi_agree">
                <input type="checkbox" name="agree" value="1"<?php echo $eqi_draft && !empty($eqi_draft['agree']) ? ' checked' : ''; ?>>
                이 답변대로 제작 진행에 동의합니다
            </label>
            <div class="sp_eq_btns">
                <button type="submit" class="sp_eq_approve sp_eqi_submit">회신 제출</button>
            </div>
        </div>
    </form>
    <?php else: ?>
    <p class="sp_eq_done">
        <?php if ($rv['status'] === 'answered'): ?>
            회신 완료<?php if (!empty($rv['decidedAt'])): ?> · <?php echo date('Y-m-d', strtotime($rv['decidedAt'])); ?><?php endif; ?>
            <?php if (!empty($rv['answeredByAdmin'])): ?>
                <span class="sp_eq_note sp_eqi_proxy">담당자가 확인해 대신 입력한 답변입니다 — 전화·메일로 말씀해 주신 내용을 옮겼습니다.</span>
            <?php else: ?>
                <span class="sp_eq_note">담당자가 회신을 확인해 제작을 이어 갑니다. 바꾸실 내용이 있으면 담당자에게 연락해 주세요.</span>
            <?php endif; ?>
        <?php elseif ($rv['status'] === 'canceled'): ?>
            <?php echo $eqi_st['label']; ?>
            <span class="sp_eq_note">담당자가 확인을 마쳐 회신 요청이 취소되었습니다 — 따로 하실 일은 없습니다.</span>
        <?php else: ?>
            <?php echo $eqi_st['label']; ?>
        <?php endif; ?>
    </p>
    <?php endif; ?>
</div>
<?php
// ── 공용 자산(확대 대화상자 + 스크립트) — 섹션당 한 번만. 폼 밖에 둔다(폼 안 <dialog> 는 제출 대상이 섞인다).
if (empty($sp_eqi_assets_done)):
    $sp_eqi_assets_done = true;
?>
<dialog class="sp_eqi_figdlg" id="sp_eqi_figdlg" aria-labelledby="sp_eqi_figdlg_h">
    <div class="sp_eqi_figdlg_h">
        <h3 id="sp_eqi_figdlg_h">참고 그림</h3>
        <button type="button" class="sp_eqi_figdlg_x" data-close aria-label="닫기">×</button>
    </div>
    <div class="sp_eqi_figdlg_b"><img alt=""></div>
</dialog>
<script>
(function () {
    'use strict';

    // 항목 하나의 상태 — 'missing'(안 고름) · 'comment'(의견 필요한 선택지인데 2자 미만) · 'ok'.
    // 서버 규칙(sp-node validateEqAnswers, 의견 2자 이상)과 같게 두되 **안내용**이다 — 최종 판정은 서버.
    function picked(card) { return card.querySelector('input[type=radio]:checked'); }
    function stateOf(card) {
        var p = picked(card);
        if (!p) return 'missing';
        var ta = card.querySelector('textarea');
        if (p.getAttribute('data-need-comment') === '1' && (!ta || ta.value.trim().length < 2)) return 'comment';
        return 'ok';
    }
    function expand(card) {
        var body = card.querySelector('.sp_eqi_body');
        if (body) body.hidden = false;
        card.classList.remove('is-kept');
        card.classList.add('is-unfolded');
        var btn = card.querySelector('.sp_eqi_unfold');
        if (btn) btn.setAttribute('aria-expanded', 'true');
    }
    function showErr(card, state) {
        var err = card.querySelector('[data-eqi-err]');
        if (state === 'ok') {
            card.classList.remove('is-invalid');
            if (err) err.hidden = true;
            return;
        }
        card.classList.add('is-invalid');
        if (err) {
            err.hidden = false;
            err.textContent = state === 'missing'
                ? '처리 방법을 하나 골라 주세요.'
                : '고르신 처리 방법은 의견이 필요합니다 — 2자 이상 적어 주세요.';
        }
    }
    function refresh(form) {
        var cards = form.querySelectorAll('.sp_eqi_card');
        var done = 0;
        cards.forEach(function (card) {
            var p = picked(card);
            var need = !!p && p.getAttribute('data-need-comment') === '1';
            var ta = card.querySelector('textarea');
            if (ta) ta.required = need;
            var hint = card.querySelector('[data-eqi-cmt-hint]');
            if (hint) hint.textContent = need ? '(필수 — 2자 이상)' : '(선택)';
            card.classList.toggle('is-need-comment', need);
            card.classList.toggle('is-answered', !!p);
            if (p) done += 1;
            // 고치는 대로 오류 표시를 거둔다(새로 생기게 하지는 않는다 — 제출 때만 띄운다).
            if (card.classList.contains('is-invalid')) showErr(card, stateOf(card));
        });
        var out = form.querySelector('[data-eqi-progress]');
        if (out) out.textContent = done + '/' + cards.length;
        return cards;
    }
    // 문제 항목을 모두 표시하고 첫째를 돌려준다.
    function validate(form) {
        var first = null;
        form.querySelectorAll('.sp_eqi_card').forEach(function (card) {
            var s = stateOf(card);
            showErr(card, s);
            if (s !== 'ok') {
                expand(card);
                if (!first) first = card;
            }
        });
        return first;
    }
    function focusCard(card) {
        card.scrollIntoView({ block: 'center' });
        var target = stateOf(card) === 'comment' ? card.querySelector('textarea') : card.querySelector('input[type=radio]');
        if (target) target.focus({ preventScroll: true });
    }

    // 이 스크립트는 첫 문항형 카드 바로 뒤에서 실행된다 — 뒤에 오는 회차 카드까지 잡으려면 문서를 다 읽은 뒤 묶는다.
    function init() {
        var wrap = document.getElementById('sp_eq_wrap');
        if (!wrap) return;
        wrap.querySelectorAll('.sp_eqi_form').forEach(function (form) {
            refresh(form);
            form.addEventListener('change', function () { refresh(form); });
            form.addEventListener('input', function () { refresh(form); });

            // 거절 뒤 되돌아온 화면 — 되살린 값으로 문제 항목을 바로 표시한다(문구는 sp-dialog 가 띄운다).
            if (form.getAttribute('data-eqi-restored') === '1') {
                var bad = validate(form);
                if (bad && !location.hash) bad.scrollIntoView({ block: 'center' });
            }

            form.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.sp_eqi_unfold') : null;
                if (!btn) return;
                var card = btn.closest('.sp_eqi_card');
                expand(card);
                var first = card.querySelector('input[type=radio]:checked') || card.querySelector('input[type=radio]');
                if (first) first.focus();
            });

            form.addEventListener('submit', function (e) {
                if (form.dataset.spConfirmed === '1') return; // 승낙 후 재제출 — 그대로 통과
                e.preventDefault();
                refresh(form);
                var bad = validate(form);
                if (bad) {
                    var no = bad.getAttribute('data-no');
                    window.spDialog
                        .alert(stateOf(bad) === 'missing'
                            ? '모든 항목에 답해 주세요.\n항목 ' + no + '의 처리 방법을 골라 주세요.'
                            : '항목 ' + no + ': 고르신 처리 방법은 의견이 필요합니다.\n의견을 2자 이상 적어 주세요.',
                            { tone: 'danger' })
                        .then(function () { focusCard(bad); });
                    return;
                }
                var agree = form.querySelector('input[name=agree]');
                if (agree && !agree.checked) {
                    window.spDialog
                        .alert("'이 답변대로 제작 진행에 동의합니다'에 체크해 주세요.", { tone: 'danger' })
                        .then(function () { agree.focus(); });
                    return;
                }
                window.spDialog
                    .confirm('이 답변으로 회신하시겠습니까?\n회신하면 담당자가 확인해 제작을 이어 갑니다.\n회신 뒤에는 이 화면에서 바꿀 수 없습니다 — 바꾸시려면 담당자에게 연락해 주세요.', {
                        title: '제조 확인 회신',
                        tone: 'success',
                        okText: '회신 제출',
                    })
                    .then(function (ok) {
                        if (!ok) return;
                        form.dataset.spConfirmed = '1';
                        var sb = form.querySelector('.sp_eqi_submit');
                        if (sb) sb.disabled = true; // 연타로 두 번 나가지 않게(두 번째는 서버가 409 로 막는다)
                        form.submit();
                    });
            });
        });

        // 그림 확대 — <dialog> 하나를 돌려 쓴다. 대화상자가 없는 브라우저는 링크(새 탭)로 연다.
        var dlg = document.getElementById('sp_eqi_figdlg');
        wrap.addEventListener('click', function (e) {
            var a = e.target.closest ? e.target.closest('[data-eqi-fig]') : null;
            if (!a || !dlg || typeof dlg.showModal !== 'function') return;
            e.preventDefault();
            var img = a.querySelector('img');
            var big = dlg.querySelector('.sp_eqi_figdlg_b img');
            big.src = a.getAttribute('href');
            big.alt = img ? img.alt : '';
            dlg.querySelector('#sp_eqi_figdlg_h').textContent = img && img.alt ? img.alt : '참고 그림';
            dlg.showModal();
        });
        if (dlg) {
            dlg.addEventListener('click', function (e) {
                // 닫기 버튼 · 배경(대화상자 바깥) 클릭
                if (e.target === dlg || (e.target.closest && e.target.closest('[data-close]'))) dlg.close();
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
</script>
<?php endif; ?>
