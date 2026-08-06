<?php
// PCB EQ 고객 확인 결정 브리지 (sp-php → sp-node)
// URL: POST /spcb/api/eq-decide   (spcb/.htaccess 가 무확장 → .php 라우팅)
//
// 주문내역 상세(theme/sp-lite/shop/orderinquiryview.php)의 승인·반려 폼이 여기로 POST 하고,
// 이 파일이 회원 JWT 를 만들어 sp-node 로 넘긴 뒤 원래 화면으로 되돌린다.
//
// ⚠ **POST 전용**이다. GET 으로는 아무 일도 하지 않는다 — 메일 보안 게이트웨이가 링크를
//   자동 GET 하므로, GET 으로 상태가 바뀌면 고객이 열어보기도 전에 승인된다(설계 결정).
// ⚠ 판정(소유권·중복 결정·상태)은 전부 sp-node 가 한다. 여기서는 CSRF 토큰만 본다.
//
// 결과 안내는 코어 alert() 을 쓰지 않는다 — 그건 bbs/alert.php 로 페이지를 통째로
// 갈아치운 뒤 네이티브 alert 을 띄운다(빈 화면 → 시스템 팝업 → 뒤로가기). 대신 원래
// 화면으로 되돌리면서 ?sp_msg= 를 실어 보내고, sp-dialog.js 가 그 자리에서 모달로 띄운다.
// ※ spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다.

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_node_call()

/** 원래 주문내역으로 되돌리며 결과 문구를 실어 보낸다(sp-dialog.js 가 모달로 표시). */
function sp_eq_back($msg, $tone = 'default')
{
    $od_id = isset($_POST['od_id']) ? $_POST['od_id'] : (isset($_GET['od_id']) ? $_GET['od_id'] : '');
    $url = G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode((string) $od_id)
         . '&sp_msg=' . urlencode((string) $msg)
         . '&sp_tone=' . urlencode((string) $tone);
    goto_url($url);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sp_eq_back('잘못된 접근입니다.', 'danger');
}
if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php');
}
// 그누보드 표준 CSRF — 폼이 get_token() 값을 hidden 으로 심고, 여기서 $_POST['token'] 을 본다.
// ⚠ 코어 check_token() 은 실패 시 자체 alert() 을 띄우고 끝나 커스텀 팝업으로 감쌀 수 없다
//   — 검증 로직만 같게 복제한 sp_pcb_check_token()(extend)을 쓴다.
if (!sp_pcb_check_token()) {
    sp_eq_back('보안 토큰이 만료되었습니다. 새로고침 후 다시 시도해 주세요.', 'danger');
}

$review_id = isset($_POST['review_id']) ? (int) $_POST['review_id'] : 0;
$decision  = (isset($_POST['decision']) && $_POST['decision'] === 'reject') ? 'reject' : 'approve';
$note      = isset($_POST['note']) ? trim((string) $_POST['note']) : '';

if ($review_id <= 0) {
    sp_eq_back('확인 요청을 찾을 수 없습니다.', 'danger');
}
if ($decision === 'reject' && mb_strlen($note) < 2) {
    sp_eq_back('반려 사유를 입력해 주세요.', 'danger');
}

$body = array('decision' => $decision);
if ($note !== '') $body['note'] = $note;

$res = sp_pcb_node_call('POST', '/api/pcb-eq-reviews/' . $review_id . '/decide', $body);

if ($res === null) {
    sp_eq_back('처리에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'danger');
}
if ($res['status'] === 409) {
    sp_eq_back('이미 처리된 확인 요청입니다.', 'danger');
}
if ($res['status'] !== 200) {
    $msg = isset($res['json']['message']) ? $res['json']['message'] : '처리에 실패했습니다.';
    sp_eq_back($msg, 'danger');
}

sp_eq_back(
    $decision === 'approve'
        ? "확인 사항을 승인했습니다.\n제조가 그대로 진행됩니다."
        : "확인 사항을 반려했습니다.\n담당자가 사유를 확인해 연락드립니다.",
    $decision === 'approve' ? 'success' : 'default'
);
