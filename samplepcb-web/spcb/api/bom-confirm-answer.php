<?php
// 스마트 BOM 결제 후 부품 확인 요청(D43) 고객 회신 브리지 (sp-php → sp-node)
// URL: POST /spcb/api/bom-confirm-answer   (spcb/.htaccess 가 무확장 → .php 라우팅)
//
// 주문내역 상세(theme/sp-lite/shop/orderinquiryview.php)의 '부품 확인 요청' 폼이 여기로 POST 하고,
// 이 파일이 회원 JWT 를 만들어 sp-node(POST /api/bom/confirms/:id/answer)로 넘긴 뒤 원래 화면
// (#bomc-{id})으로 되돌린다. 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
//
// ⚠ **POST 전용**이다 — 메일 보안 게이트웨이가 링크를 자동 GET 하므로 GET 으로는 아무것도 하지 않는다.
// ⚠ 판정(소유권·판본·선택지·받는 방법)은 전부 sp-node 가 한다. 여기서는 CSRF 와 형식만 본다.
// ※ spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다.

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_node_call(), sp_pcb_check_token()

/** 원래 주문내역의 그 요청 자리로 되돌리며 결과 문구를 실어 보낸다(sp-dialog.js 가 모달로 표시). */
function sp_bomc_back($msg, $tone = 'default', $request_id = 0)
{
    $od_id = isset($_POST['od_id']) ? $_POST['od_id'] : (isset($_GET['od_id']) ? $_GET['od_id'] : '');
    $url = G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode((string) $od_id)
         . '&sp_msg=' . urlencode((string) $msg)
         . '&sp_tone=' . urlencode((string) $tone)
         . ($request_id > 0 ? '#bomc-' . (int) $request_id : '');
    goto_url($url);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sp_bomc_back('잘못된 접근입니다.', 'danger');
}
if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php');
}
if (!sp_pcb_check_token()) {
    sp_bomc_back('보안 토큰이 만료되었습니다. 새로고침 후 다시 시도해 주세요.', 'danger');
}

$request_id = isset($_POST['request_id']) ? (int) $_POST['request_id'] : 0;
$version    = isset($_POST['version']) ? (int) $_POST['version'] : 0;
$note       = isset($_POST['note']) ? trim((string) $_POST['note']) : '';
$choice_in  = isset($_POST['choice']) && is_array($_POST['choice']) ? $_POST['choice'] : array();
$ship_in    = isset($_POST['ship']) && is_array($_POST['ship']) ? $_POST['ship'] : array();

if ($request_id <= 0 || $version <= 0) {
    sp_bomc_back('확인 요청을 찾을 수 없습니다.', 'danger');
}

$choices = array();
foreach ($choice_in as $issue_id => $code) {
    $issue_id = preg_replace('/[^0-9]/', '', (string) $issue_id);
    $code = strtoupper(preg_replace('/[^A-Ea-e]/', '', (string) $code));
    if ($issue_id === '' || $code === '') continue;
    $entry = array('issueId' => $issue_id, 'code' => $code);
    if (isset($ship_in[$issue_id]) && ($ship_in[$issue_id] === 'together' || $ship_in[$issue_id] === 'split')) {
        $entry['shipPreference'] = $ship_in[$issue_id];
    }
    $choices[] = $entry;
}
if (empty($choices)) {
    sp_bomc_back('부품마다 처리 방법을 골라 주세요.', 'danger', $request_id);
}

$body = array('expectedVersion' => $version, 'choices' => $choices);
if ($note !== '') $body['note'] = mb_substr($note, 0, 2000);

$res = sp_pcb_node_call('POST', '/api/bom/confirms/' . $request_id . '/answer', $body);

if ($res === null) {
    sp_bomc_back('처리에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'danger', $request_id);
}
if ($res['status'] !== 200) {
    // 409 = 이미 회신했거나 그사이 담당자가 요청을 바꿈/닫음, 400 = 선택 누락 — 문구는 sp-node 가 안다.
    $msg = isset($res['json']['message']) ? $res['json']['message'] : '처리에 실패했습니다.';
    sp_bomc_back($msg, 'danger', $request_id);
}

$net = null;
if (isset($res['json']['data']['request']['netDelta'])) $net = (int) $res['json']['data']['request']['netDelta'];
$tail = "\n담당자가 확인해 바로 진행하겠습니다.";
if ($net !== null && $net > 0) $tail = "\n추가결제 " . number_format($net) . "원이 생겼습니다. 아래 [추가결제 하기]로 결제해 주세요.";
if ($net !== null && $net < 0) $tail = "\n" . number_format(-$net) . "원은 처리 후 환불해 드립니다.";

sp_bomc_back('회신을 보냈습니다.' . $tail, 'success', $request_id);
