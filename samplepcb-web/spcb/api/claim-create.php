<?php
// PCB 고객 A/S 접수 브리지 (sp-php → sp-node, P5)
// URL: POST /spcb/api/claim-create   (spcb/.htaccess 가 무확장 → .php 라우팅)
//
// 주문내역 상세(theme/sp-lite/shop/orderinquiryview.php)의 A/S 접수 폼이 여기로
// multipart POST 하고, 이 파일이 회원 JWT 를 만들어 sp-node /api/pcb-claims 로
// **사진 파일까지 함께** 중계한 뒤 원래 화면으로 되돌린다(eq-decide 와 같은 구조).
//
// ⚠ POST 전용 — GET 으로는 아무 일도 하지 않는다(메일 스캐너 프리페치 사고 방지 규칙).
// ⚠ 소유권·접수 가능 판정(배송 후·활성 클레임·수량)은 전부 sp-node 가 한다.
//   여기서는 CSRF 토큰과 로그인만 본다.
// ※ spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다.

include_once __DIR__ . '/../../common.php';
include_once G5_PATH . '/extend/sp_pcb_eq.extend.php'; // sp_pcb_member_token()

/** 원래 주문내역으로 되돌리며 결과 문구를 실어 보낸다(sp-dialog.js 가 모달로 표시). */
function sp_claim_back($msg, $tone = 'default')
{
    $od_id = isset($_POST['od_id']) ? $_POST['od_id'] : (isset($_GET['od_id']) ? $_GET['od_id'] : '');
    $url = G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode((string) $od_id)
         . '&sp_msg=' . urlencode((string) $msg)
         . '&sp_tone=' . urlencode((string) $tone);
    goto_url($url);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sp_claim_back('잘못된 접근입니다.', 'danger');
}
if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php');
}
if (!sp_pcb_check_token()) {
    sp_claim_back('보안 토큰이 만료되었습니다. 새로고침 후 다시 시도해 주세요.', 'danger');
}

$spec_id      = isset($_POST['spec_id']) ? (int) $_POST['spec_id'] : 0;
$kind         = isset($_POST['kind']) ? (string) $_POST['kind'] : '';
$affected_qty = isset($_POST['affected_qty']) ? (int) $_POST['affected_qty'] : 0;
$description  = isset($_POST['description']) ? trim((string) $_POST['description']) : '';
$remedy       = isset($_POST['requested_remedy']) ? (string) $_POST['requested_remedy'] : '';
$ack          = isset($_POST['acknowledge']) && $_POST['acknowledge'] === '1';

if ($spec_id <= 0) {
    sp_claim_back('접수 대상을 찾을 수 없습니다.', 'danger');
}
if (!$ack) {
    sp_claim_back('안내 확인에 체크해 주세요 — 접수만으로 주문 취소·환불이 자동 진행되지 않습니다.', 'danger');
}
if (mb_strlen($description) < 5) {
    sp_claim_back('증상 설명을 5자 이상 적어 주세요.', 'danger');
}

$token = sp_pcb_member_token();
if ($token === '') {
    sp_claim_back('로그인 상태를 확인해 주세요.', 'danger');
}

// multipart 중계 — 필드는 sp-node 계약(PcbClaimCreateFields)의 이름 그대로,
// 사진은 임시 업로드 파일을 CURLFile 로 붙인다(용량·형식 최종 검증은 sp-node 측).
$fields = array(
    'specId'          => (string) $spec_id,
    'kind'            => $kind,
    'affectedQty'     => (string) $affected_qty,
    'description'     => $description,
    'requestedRemedy' => $remedy,
    'acknowledge'     => '1',
);
$i = 0;
if (isset($_FILES['photos']) && is_array($_FILES['photos']['tmp_name'])) {
    foreach ($_FILES['photos']['tmp_name'] as $idx => $tmp) {
        if (!is_uploaded_file($tmp)) continue;
        $name = isset($_FILES['photos']['name'][$idx]) ? (string) $_FILES['photos']['name'][$idx] : 'photo';
        $type = isset($_FILES['photos']['type'][$idx]) ? (string) $_FILES['photos']['type'][$idx] : 'application/octet-stream';
        $fields['file' . $i] = new CURLFile($tmp, $type, $name);
        $i++;
        if ($i >= 10) break; // 과대 첨부 방어 — 접수에 10장이면 충분하다
    }
}

$ch = curl_init(SPCB_NODE_BASE . '/api/pcb-claims');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30); // 사진 동반 업로드 — eq-decide(5s)보다 넉넉히
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $fields);
curl_setopt($ch, CURLOPT_HTTPHEADER, array('Authorization: Bearer ' . $token));
$raw    = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($raw === false) {
    sp_claim_back('접수에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'danger');
}
$json = json_decode($raw, true);
if ($status !== 200) {
    $msg = isset($json['message']) ? $json['message'] : '접수에 실패했습니다.';
    sp_claim_back($msg, 'danger');
}

sp_claim_back("A/S 접수가 완료되었습니다.\n담당자가 검토 후 처리 방안을 안내드립니다.", 'success');
