<?php
// PCB EQ 확인 요청 첨부 다운로드 브리지 (sp-php → sp-node)
// URL: GET /spcb/api/eq-file?review=&file=[&view=1]
//
// sp-node 의 파일 라우트는 Bearer JWT 를 요구하므로 브라우저가 <a href> 로 직접 열 수 없다.
// 이 브리지가 세션으로 회원을 식별해 단기 JWT 를 만들고, 받은 바이트를 그대로 흘려보낸다.
// 공개 여부(sharedFileIds·문항 그림 shared) 판정은 sp-node 가 한다 — 관리자가 고른 파일만 내려간다.
//
// 문항 그림(D20)은 주문 상세가 `<img>` 로 쓰므로 **인라인**으로 낸다. 단 인라인은 sp-node 가
// inline 으로 준 **이미지(png·jpeg·gif·webp)** 일 때만 — 그 밖은 무엇이 오든 attachment 로 바꾼다
// (HTML·SVG 가 같은 출처에서 열리면 스크립트가 돈다). nosniff 는 늘 붙인다.
// view=1 = `<img>` 요청: 실패를 리다이렉트가 아니라 404 로 끝낸다(이미지 요청이 주문 상세 HTML 을
// 통째로 다시 받아 sp-node 를 한 번 더 부르는 낭비 + 깨진 이미지 대신 페이지 소스가 오는 것을 막는다).

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_member_token(), SPCB_NODE_BASE

$sp_eq_view = isset($_GET['view']) && $_GET['view'] === '1';

/** 다운로드 실패 — 온 곳(주문내역)으로 되돌리며 결과 문구를 실어 보낸다.
 *  코어 alert() 은 빈 페이지 + 네이티브 팝업이라 쓰지 않는다(sp-dialog.js 가 모달로 띄운다).
 *  Referer 가 없으면 주문내역 목록으로 — 다운로드는 늘 그 화면에서 시작된다. */
function sp_eq_file_fail()
{
    global $sp_eq_view;
    if ($sp_eq_view) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        echo 'not found';
        exit;
    }
    $back = isset($_SERVER['HTTP_REFERER']) && $_SERVER['HTTP_REFERER'] !== ''
        ? $_SERVER['HTTP_REFERER']
        : G5_SHOP_URL . '/orderinquiry.php';
    $sep = (strpos($back, '?') === false) ? '?' : '&';
    goto_url($back . $sep . 'sp_msg=' . urlencode('파일을 찾을 수 없습니다.') . '&sp_tone=danger');
}

if (empty($is_member)) {
    if ($sp_eq_view) sp_eq_file_fail();
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

// 파일명·타입은 sp-node 응답 헤더를 승계한다(한글 파일명 UTF-8'' 인코딩 포함).
$content_type = 'application/octet-stream';
$disposition  = '';
foreach (explode("\r\n", $head) as $line) {
    if (preg_match('/^Content-Type:\s*(.+)$/i', $line, $m)) $content_type = trim($m[1]);
    if (preg_match('/^Content-Disposition:\s*(.+)$/i', $line, $m)) $disposition = trim($m[1]);
}

$inline_image = preg_match('#^image/(png|jpeg|gif|webp)\b#i', $content_type)
             && preg_match('/^inline\b/i', $disposition);
if ($inline_image) {
    // 문항 그림 — 파일명은 **중립 이름**으로 바꾼다. 관리자가 올린 그림 이름(추출기·공장 원본명)에
    // 공장명이 섞일 수 있고, 고객이 '다른 이름으로 저장'하면 그 이름이 그대로 보인다(좌표파일과 같은
    // 이유 — 고객 화면에 공급망을 드러내지 않는다, 여정 43호).
    $ext = strtolower(preg_replace('#^image/([a-z]+).*$#i', '$1', $content_type));
    if ($ext === 'jpeg') $ext = 'jpg';
    header('Content-Type: ' . $content_type);
    header('Content-Disposition: inline; filename="figure-' . $file_id . '.' . $ext . '"');
} else {
    header('Content-Type: ' . $content_type);
    // 인라인 이미지가 아니면 무엇이 오든 내려받기로 — 같은 출처에서 열려 스크립트가 도는 일을 막는다.
    $attachment = $disposition !== '' ? preg_replace('/^inline\b/i', 'attachment', $disposition) : 'attachment';
    header('Content-Disposition: ' . $attachment);
}
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . strlen($body));
// 그림은 회차가 열려 있는 동안 몇 번이고 다시 그려진다 — 세션 소유물이라 공유 캐시는 금지하되
// 같은 브라우저의 짧은 재사용은 허용한다(목록·확대 대화상자가 같은 URL 을 쓴다).
header('Cache-Control: ' . ($inline_image ? 'private, max-age=300' : 'no-store'));
echo $body;
