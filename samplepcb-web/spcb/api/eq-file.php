<?php
// PCB EQ 확인 요청 첨부 다운로드 브리지 (sp-php → sp-node)
// URL: GET /spcb/api/eq-file?review=&file=
//
// sp-node 의 파일 라우트는 Bearer JWT 를 요구하므로 브라우저가 <a href> 로 직접 열 수 없다.
// 이 브리지가 세션으로 회원을 식별해 단기 JWT 를 만들고, 받은 바이트를 그대로 흘려보낸다.
// 공개 여부(sharedFileIds) 판정은 sp-node 가 한다 — 관리자가 고른 파일만 내려간다.

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_member_token(), SPCB_NODE_BASE

/** 다운로드 실패 — 온 곳(주문내역)으로 되돌리며 결과 문구를 실어 보낸다.
 *  코어 alert() 은 빈 페이지 + 네이티브 팝업이라 쓰지 않는다(sp-dialog.js 가 모달로 띄운다).
 *  Referer 가 없으면 주문내역 목록으로 — 다운로드는 늘 그 화면에서 시작된다. */
function sp_eq_file_fail()
{
    $back = isset($_SERVER['HTTP_REFERER']) && $_SERVER['HTTP_REFERER'] !== ''
        ? $_SERVER['HTTP_REFERER']
        : G5_SHOP_URL . '/orderinquiry.php';
    $sep = (strpos($back, '?') === false) ? '?' : '&';
    goto_url($back . $sep . 'sp_msg=' . urlencode('파일을 찾을 수 없습니다.') . '&sp_tone=danger');
}

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php');
}

$review_id = isset($_GET['review']) ? (int) $_GET['review'] : 0;
$file_id   = isset($_GET['file']) ? (int) $_GET['file'] : 0;
if ($review_id <= 0 || $file_id <= 0) {
    sp_eq_file_fail();
}

$token = sp_pcb_member_token();
if ($token === '') {
    sp_eq_file_fail();
}

$url = SPCB_NODE_BASE . '/api/pcb-eq-reviews/' . $review_id . '/files/' . $file_id;
$ch  = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, array('Authorization: Bearer ' . $token));
$raw = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$header_size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

if ($raw === false || $status !== 200) {
    sp_eq_file_fail();
}

$head = substr($raw, 0, $header_size);
$body = substr($raw, $header_size);

// 파일명·타입은 sp-node 응답 헤더를 그대로 승계한다(한글 파일명 UTF-8'' 인코딩 포함).
foreach (explode("\r\n", $head) as $line) {
    if (preg_match('/^(Content-Type|Content-Disposition):/i', $line)) {
        header($line);
    }
}
header('Content-Length: ' . strlen($body));
header('Cache-Control: no-store');
echo $body;
