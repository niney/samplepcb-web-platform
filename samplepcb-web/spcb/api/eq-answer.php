<?php
// PCB 제조 확인 — 문항형 회차(D20) 고객 회신 브리지 (sp-php → sp-node)
// URL: POST /spcb/api/eq-answer   (spcb/.htaccess 가 무확장 → .php 라우팅)
//
// 주문내역 상세(theme/sp-lite/shop/_pcb_eq_items_round.php)의 문항형 회신 폼이 여기로 POST 하고,
// 이 파일이 회원 JWT 를 만들어 sp-node(POST /api/pcb-eq-reviews/:id/answer)로 넘긴 뒤 원래 화면
// (#eq-{id})으로 되돌린다. 정본 docs/PCB_PARTNER_TRACK.md 「D20 설계」.
// 문구형(D16) 승인·반려는 eq-decide.php 다 — 문항형 회차에 그쪽을 부르면 sp-node 가 409(WRONG_FORMAT).
//
// ⚠ **POST 전용**이다 — 메일 보안 게이트웨이가 링크를 자동 GET 하므로 GET 으로는 아무것도 하지 않는다.
// ⚠ 판정(소유권·판본·전 문항·선택지·의견 필수)은 전부 sp-node 가 한다. 여기서는 CSRF 와 형식,
//   그리고 "동의" 체크만 본다(계약 agree 는 literal true 라 빠지면 sp-node 가 고객 말이 아닌
//   스키마 오류로 거절한다 — 고객 문구로 먼저 막는다).
// ⚠ 거절되면 고객이 고른 값을 세션에 한 번 남긴다(sp_pcb_eq_answer_draft_save) — 문항 N개를
//   처음부터 다시 고르게 하지 않으려고. 화면이 그 값을 되살리고 문제 문항을 표시한다.
// ※ spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다.

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_node_call(), sp_pcb_check_token()

/** 원래 주문내역의 그 회차(또는 문제 문항) 자리로 되돌리며 결과 문구를 실어 보낸다(sp-dialog.js 가 모달로 표시). */
function sp_eqi_back($msg, $tone = 'default', $anchor = '')
{
    $od_id = isset($_POST['od_id']) ? $_POST['od_id'] : '';
    $url = G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode((string) $od_id)
         . '&sp_msg=' . urlencode((string) $msg)
         . '&sp_tone=' . urlencode((string) $tone)
         . ($anchor !== '' ? '#' . $anchor : '');
    goto_url($url);
}

/**
 * 거절 문구에 **어느 항목인지**를 붙인다. sp-node 는 오류 코드만 돌려주고 문항 id 는 싣지 않는다
 * (고객 라우트 응답 = {error, message}) — 이 회차를 다시 읽어 보낸 답과 대조해 첫 문제 문항을 찾는다.
 * 판정이 아니라 **이미 거절된 뒤의 안내**다(규칙 정본은 sp-node validateEqAnswers).
 * 돌려주는 값: array('no' => 화면 번호(1부터), 'itemId' => id) 또는 null.
 */
function sp_eqi_locate_problem($od_id, $review_id, $error, $answers, $comments)
{
    if ($error !== 'ANSWERS_INCOMPLETE' && $error !== 'COMMENT_REQUIRED' && $error !== 'ANSWER_BAD_KEY') return null;
    foreach (sp_pcb_eq_reviews($od_id) as $rv) {
        if ((int) $rv['id'] !== $review_id || empty($rv['items'])) continue;
        foreach ($rv['items'] as $n => $item) {
            $iid = (int) $item['id'];
            $key = isset($answers[$iid]) ? $answers[$iid] : '';
            $opt = null;
            foreach ($item['options'] as $o) {
                if ((string) $o['key'] === $key) { $opt = $o; break; }
            }
            $bad = ($key === '' && $error === 'ANSWERS_INCOMPLETE')
                || ($key !== '' && $opt === null && $error === 'ANSWER_BAD_KEY')
                || ($opt !== null && !empty($opt['requiresComment']) && $error === 'COMMENT_REQUIRED'
                    && mb_strlen(isset($comments[$iid]) ? $comments[$iid] : '') < 2);
            if ($bad) return array('no' => $n + 1, 'itemId' => $iid);
        }
    }
    return null;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sp_eqi_back('잘못된 접근입니다.', 'danger');
}
if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php');
}
if (!sp_pcb_check_token()) {
    sp_eqi_back('보안 토큰이 만료되었습니다. 새로고침 후 다시 시도해 주세요.', 'danger');
}

$review_id  = isset($_POST['review_id']) ? (int) $_POST['review_id'] : 0;
$version    = isset($_POST['version']) ? (int) $_POST['version'] : 0;
$od_id      = isset($_POST['od_id']) ? (string) $_POST['od_id'] : '';
$answer_in  = isset($_POST['answer']) && is_array($_POST['answer']) ? $_POST['answer'] : array();
$comment_in = isset($_POST['comment']) && is_array($_POST['comment']) ? $_POST['comment'] : array();
$agree      = isset($_POST['agree']) && $_POST['agree'] === '1';

if ($review_id <= 0 || $version <= 0) {
    sp_eqi_back('확인 요청을 찾을 수 없습니다.', 'danger');
}
$anchor = 'eq-' . $review_id;

// 폼 값 → 계약 CustomerPcbEqAnswerBody. ⚠ common.php 가 $_POST 전체에 addslashes 를 건다
// (G5_ESCAPE_FUNCTION) — 의견을 그대로 넘기면 `'`·`"`·`\` 앞에 백슬래시가 붙어 저장된다.
$answers  = array(); // itemId => key   (세션 복원·문제 문항 찾기용)
$comments = array(); // itemId => comment
$body_answers = array();
foreach ($answer_in as $item_id => $key) {
    $item_id = (int) preg_replace('/[^0-9]/', '', (string) $item_id);
    $key = trim(stripslashes((string) $key));
    if ($item_id <= 0 || $key === '') continue;
    $key = mb_substr($key, 0, 4); // 계약 max 4 — 공장 원문 기호(A/B/C)
    $comment = isset($comment_in[$item_id]) ? trim(stripslashes((string) $comment_in[$item_id])) : '';
    $comment = mb_substr($comment, 0, 2000);
    $answers[$item_id] = $key;
    $entry = array('itemId' => $item_id, 'key' => $key);
    if ($comment !== '') {
        $entry['comment'] = $comment;
        $comments[$item_id] = $comment;
    }
    $body_answers[] = $entry;
}
// 답을 안 고른 문항의 의견도 되살릴 수 있게 따로 담는다(위 루프는 답이 있는 문항만 본다).
foreach ($comment_in as $item_id => $comment) {
    $item_id = (int) preg_replace('/[^0-9]/', '', (string) $item_id);
    $comment = mb_substr(trim(stripslashes((string) $comment)), 0, 2000);
    if ($item_id > 0 && $comment !== '' && !isset($comments[$item_id])) $comments[$item_id] = $comment;
}

$keep_draft = function () use ($review_id, $answers, $comments, $agree) {
    sp_pcb_eq_answer_draft_save($review_id, array(
        'answers'  => $answers,
        'comments' => $comments,
        'agree'    => $agree,
    ));
};

if (empty($body_answers)) {
    $keep_draft();
    sp_eqi_back('항목마다 처리 방법을 골라 주세요.', 'danger', $anchor);
}
if (!$agree) {
    $keep_draft();
    sp_eqi_back("'이 답변대로 제작 진행에 동의합니다'에 체크해 주세요.", 'danger', $anchor);
}

$res = sp_pcb_node_call('POST', '/api/pcb-eq-reviews/' . $review_id . '/answer', array(
    'expectedVersion' => $version,
    'answers'         => $body_answers,
    'agree'           => true,
));

if ($res === null) {
    $keep_draft();
    sp_eqi_back('처리에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'danger', $anchor);
}
if ($res['status'] !== 200) {
    // 400 = 누락·의견 필수·없는 선택지, 409 = 이미 회신/닫힘/판본 어긋남, 404 = 남의 것·없음.
    // 문구는 sp-node 가 고객 어휘로 내려준다('제조 확인' — EQ·발주라는 말 없음).
    $msg   = isset($res['json']['message']) ? $res['json']['message'] : '처리에 실패했습니다.';
    $error = isset($res['json']['error']) ? (string) $res['json']['error'] : '';
    if ($res['status'] === 400) {
        $hit = sp_eqi_locate_problem($od_id, $review_id, $error, $answers, $comments);
        if ($hit !== null) {
            $msg = '항목 ' . $hit['no'] . ': ' . $msg;
            $anchor = 'eqi-' . $hit['itemId'];
        }
    }
    // 409·404 는 폼이 사라지거나(이미 회신·닫힘) 다시 읽어야 하는 경우라 남겨도 쓰이지 않는다 — 그래도
    // 판본 어긋남(VERSION_CONFLICT)처럼 폼이 그대로인 경우를 위해 남긴다(화면이 있는 선택지만 되살린다).
    $keep_draft();
    sp_eqi_back($msg, 'danger', $anchor);
}

sp_eqi_back("회신을 보냈습니다.\n담당자가 확인해 제작을 이어 가겠습니다.", 'success', $anchor);
