<?php
// PCB 좌표파일(메탈마스크) 다운로드 브리지 (sp-php → sp-node)
// URL: GET /spcb/api/coord-file?file=
//
// eq-file.php 와 같은 구조지만 **다른 축**이다: 확인 요청(D16)은 관리자가 고른 파일을 물어보는
// 것이고, 여기는 통보 없이 열어 두는 열람이다(사용자 결정 2026-08-16 — 요청하는 고객이 있다).
// 그래서 review 파라미터가 없고 파일 하나만 받는다.
//
// 공개 판정은 전부 sp-node 가 한다: 종류(coord)·단계(관리자 확인 완료)·소유권(spec.mbId).
// 파일명도 sp-node 가 중립 이름으로 바꿔 내려준다(협력사명이 원본 파일명에 섞일 수 있다).

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_member_token(), SPCB_NODE_BASE

/** 다운로드 실패 — 온 곳(주문내역)으로 되돌리며 결과 문구를 실어 보낸다(eq-file.php 와 동일). */
function sp_coord_file_fail()
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

$file_id = isset($_GET['file']) ? (int) $_GET['file'] : 0;
if ($file_id <= 0) {
    sp_coord_file_fail();
}

$token = sp_pcb_member_token();
if ($token === '') {
    sp_coord_file_fail();
}

$url = SPCB_NODE_BASE . '/api/pcb-progress/coord-files/' . $file_id;
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
    sp_coord_file_fail();
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
