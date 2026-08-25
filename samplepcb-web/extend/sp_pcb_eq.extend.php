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

/** 주문을 가로지르는 **내 확인 요청** 목록(마이페이지 /shop/eq).
 *  $scope: 'open'=확인 대기만(기본) · 'all'=이력 포함.
 *  돌려주는 값: array('reviews' => array, 'openCount' => int) — 실패는 빈 목록·0. */
function sp_pcb_eq_reviews_mine($scope = 'open')
{
    $scope = ($scope === 'all') ? 'all' : 'open';
    $empty = array('reviews' => array(), 'openCount' => 0);
    $res = sp_pcb_node_call('GET', '/api/pcb-eq-reviews/mine?scope=' . $scope);
    if ($res === null || $res['status'] !== 200) return $empty;
    if (!isset($res['json']['data']['reviews']) || !is_array($res['json']['data']['reviews'])) {
        return $empty;
    }
    return array(
        'reviews'   => $res['json']['data']['reviews'],
        'openCount' => isset($res['json']['data']['openCount']) ? (int) $res['json']['data']['openCount'] : 0,
    );
}

/** 사이드바 배지용 **대기 건수만** — 여기서는 API 를 부르지 않고 DB 를 직접 센다.
 *
 *  이 함수는 계정 사이드바(_account_nav.php)가 부르고, 사이드바는 마이페이지·장바구니·
 *  포인트·쪽지 등 **모든 계정 페이지**에서 렌더된다. API 를 태우면 그 전부에 HTTP 왕복이
 *  하나씩 붙는다(주문내역 배지도 같은 이유로 직접 count 다). sp_* 는 그누보드와 같은 DB 에
 *  동거하므로 조인 한 방이면 된다.
 *
 *  ⚠ 이건 **판정이 아니라 세기**다 — 목록·결정의 판정은 전부 sp-node 다(브리지 규약).
 *  'requested' 가 곧 유효한 대기인 근거: EQ 전이가 열린 요청을 닫는다(closeOpenEqReviews). */
function sp_pcb_eq_open_count($mb_id)
{
    if ($mb_id === '') return 0;
    $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $row = sql_fetch(" select count(*) as cnt
                         from sp_pcb_eq_review r
                         join sp_order_spec s on s.id = r.specId
                        where s.mbId = '{$esc}' and r.status = 'requested' ", false);
    return isset($row['cnt']) ? (int) $row['cnt'] : 0;
}

/** PCB 제작 진행 단계(P4.13) — od 상태와 별개의 협력 트랙 파생. 라벨은 sp-node 가
 *  완성해 내려주고 여기서는 그대로 출력한다(협력사·발주 정보 비노출). */
function sp_pcb_progress($od_id)
{
    $res = sp_pcb_node_call('GET', '/api/pcb-progress?odId=' . rawurlencode((string) $od_id));
    if ($res === null || $res['status'] !== 200) return array();
    if (!isset($res['json']['data']['items']) || !is_array($res['json']['data']['items'])) {
        return array();
    }
    return $res['json']['data']['items'];
}

/** 확인 요청 첨부 다운로드 URL — nginx 가 /api 를 sp-node 로 넘긴다(브라우저는 세션 쿠키가
 *  아니라 이 URL 을 그대로 열 수 없으므로, 다운로드는 eq-file.php 브리지를 거친다). */
function sp_pcb_eq_file_url($review_id, $file_id)
{
    return G5_URL . '/spcb/api/eq-file?review=' . (int) $review_id . '&file=' . (int) $file_id;
}

/** 좌표파일(메탈마스크) 다운로드 URL — 확인 요청과 **다른 축**이다: 요청도 결정도 없고
 *  통보도 없다. 고객이 주문내역을 열면 그냥 거기 있다(사용자 결정 2026-08-16).
 *  소유권·단계·종류 판정은 전부 sp-node 가 다시 한다. */
function sp_pcb_coord_file_url($file_id)
{
    return G5_URL . '/spcb/api/coord-file?file=' . (int) $file_id;
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
