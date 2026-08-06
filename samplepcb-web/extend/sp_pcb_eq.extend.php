<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// ── PCB EQ 고객 확인 브리지 (sp-php → sp-node) ────────────────────────────────
// 설계 정본: docs/PCB_PARTNER_TRACK.md D16 (P4.1).
//
// 협력사 EQ(제조 확인 사항)를 고객에게 물어보는 축. 판정·저장은 전부 sp-node 가 하고
// PHP 는 **화면만 그린다** — sp_ 테이블에 직접 쓰지 않는다(권한·상태·회차 판정을 두 곳에
// 복제하면 반드시 어긋난다). 조회도 API 를 쓴다.
//
// 인증: 그누보드 세션 → spcb_jwt_encode() 로 단기 회원 JWT 를 만들어 Bearer 로 보낸다
// (spcb/api/me.php 와 같은 브리지 방식, 클레임 shape 도 동일).
//
// ⚠ 메일 링크는 이 함수를 부르지 않는다. 링크는 주문내역 화면을 열 뿐이고 결정은
//   화면 안 POST(spcb/api/eq-decide)로만 일어난다 — 메일 보안 스캐너의 링크
//   프리페치(GET)로 승인이 자동 처리되는 사고를 막는 규칙이다.

if (!defined('SPCB_NODE_BASE')) {
    // 같은 호스트의 sp-node. nginx 를 거치지 않고 내부로 직접 부른다(빠르고 외부 노출 없음).
    define('SPCB_NODE_BASE', 'http://127.0.0.1:3333');
}

/** 현재 로그인 회원의 단기 JWT. 비로그인이면 빈 문자열. */
function sp_pcb_member_token()
{
    global $member, $is_member, $config;

    if (empty($is_member) || empty($member['mb_id'])) return '';

    $jwt_lib     = G5_PATH . '/spcb/lib/jwt.php';
    $secret_file = G5_PATH . '/spcb/lib/secret.php';
    // secret.php 는 gitignore 대상 — 미배치 환경에서 Fatal 로 주문내역이 통째로 죽지 않게
    // 존재 확인 후에만 로드한다(sp_quote_thumb_url 과 같은 방어).
    if (!defined('SPCB_JWT_SECRET')) {
        if (!is_file($jwt_lib) || !is_file($secret_file)) return '';
        require_once $jwt_lib;
    }
    if (!defined('SPCB_JWT_SECRET') || !function_exists('spcb_jwt_encode')) return '';

    $is_admin = (isset($config['cf_admin']) && $member['mb_id'] === $config['cf_admin']);
    $now = time();
    return spcb_jwt_encode(array(
        'mbId'    => (string) $member['mb_id'],
        'mbNick'  => (string) $member['mb_nick'],
        'level'   => (int) $member['mb_level'],
        'isAdmin' => (bool) $is_admin,
        'iat'     => $now,
        'exp'     => $now + 120,   // 2분 — 요청 1회용
    ), SPCB_JWT_SECRET);
}

/** sp-node 호출 공통. 실패는 null(화면은 섹션을 감추고 계속 뜬다 — 주문내역이 죽으면 안 된다). */
function sp_pcb_node_call($method, $path, $body = null)
{
    $token = sp_pcb_member_token();
    if ($token === '') return null;

    $ch = curl_init(SPCB_NODE_BASE . $path);
    $headers = array('Authorization: Bearer ' . $token);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $raw    = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) return null;
    $json = json_decode($raw, true);
    return array('status' => $status, 'json' => is_array($json) ? $json : null);
}

/** 이 주문의 EQ 확인 요청 목록. 실패·비로그인·없음은 모두 빈 배열. */
function sp_pcb_eq_reviews($od_id)
{
    $res = sp_pcb_node_call('GET', '/api/pcb-eq-reviews?odId=' . rawurlencode((string) $od_id));
    if ($res === null || $res['status'] !== 200) return array();
    if (!isset($res['json']['data']['reviews']) || !is_array($res['json']['data']['reviews'])) {
        return array();
    }
    return $res['json']['data']['reviews'];
}

/** 확인 요청 첨부 다운로드 URL — nginx 가 /api 를 sp-node 로 넘긴다(브라우저는 세션 쿠키가
 *  아니라 이 URL 을 그대로 열 수 없으므로, 다운로드는 eq-file.php 브리지를 거친다). */
function sp_pcb_eq_file_url($review_id, $file_id)
{
    return G5_URL . '/spcb/api/eq-file?review=' . (int) $review_id . '&file=' . (int) $file_id;
}

/** 상태 라벨 — 계약(PCB_EQ_REVIEW_STATUS_LABELS)과 같은 말을 쓴다. */
function sp_pcb_eq_status_label($status)
{
    switch ($status) {
        case 'approved': return array('label' => '승인함',   'cls' => 'sp_eq_ok');
        case 'rejected': return array('label' => '반려함',   'cls' => 'sp_eq_no');
        case 'canceled': return array('label' => '요청 취소', 'cls' => 'sp_eq_off');
        default:         return array('label' => '확인 대기', 'cls' => 'sp_eq_wait');
    }
}

/** 그누보드 CSRF 토큰 검증 — **alert 없이 참/거짓만** 돌려준다.
 *
 *  코어 check_token() 은 실패하면 자체적으로 alert() 을 띄우고 끝난다(bbs/alert.php 로
 *  페이지 이동 + 네이티브 팝업). 그러면 커스텀 팝업으로 감쌀 수 없어서, 검증 로직만
 *  같게 복제하고 결과 안내는 호출부가 하도록 분리했다.
 *  ⚠ 코어(lib/common.lib.php check_token)가 바뀌면 여기도 맞춰야 한다. */
function sp_pcb_check_token($expire = 7200)
{
    $token = isset($_POST['token']) ? $_POST['token'] : '';
    $dot = strpos($token, '.');
    if (!$token || $dot === false) return false;

    $time = (int) substr($token, 0, $dot);
    $hmac = substr($token, $dot + 1);
    if (abs(time() - $time) > $expire) return false;

    if (!function_exists('_get_token_key') || !function_exists('_get_token_secret')) return false;
    $expected = hash_hmac('sha256', _get_token_secret() . '|csrf_token|' . $time, _get_token_key());

    return hash_equals($expected, $hmac);
}
