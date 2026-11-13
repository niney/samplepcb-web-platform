<?php
// SmartSMT 로그인 인계 (samplepcb 로그인 → SmartSMT)
// URL: GET /spcb/sso/smartsmt?state={state}   (spcb/.htaccess 가 무확장 → .php 라우팅)
//
// SmartSMT 가 세션 없는 회원의 브라우저를 이 주소로 보낸다. 여기서 그누보드 로그인을 확인하고
// (안 돼 있으면 로그인 화면을 거쳐 돌아온다), 회원 아이디가 든 2분짜리 토큰(HS256)을 주소에 실어
// 등록된 SmartSMT 로그인 수신 주소로 돌려보낸다. 서버끼리 부르는 단계는 없다.
// 정본: docs/SMARTSMT_INTEGRATION.md §4.2 · SmartSMT 전달 규격 docs/SMARTSMT_AUTH_REQUEST.html 4장.
//
// ⚠ 서명 비밀은 SmartSMT 전용 값(SPCB_SMARTSMT_SECRET)이다. SPCB_JWT_SECRET 을 쓰면 SmartSMT 가
//   우리 회원·관리자 토큰을 만들 수 있게 되므로, 같은 값이면 여기서 동작을 거부한다.
// ⚠ 돌려보낼 주소는 설정값(SPCB_SMARTSMT_LOGIN_URL)뿐이다 — 요청 파라미터로 받지 않는다
//   (받으면 다른 사이트가 토큰을 받아 갈 수 있다).
// ※ spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다.

include_once __DIR__ . '/../../common.php';  // 그누보드 부트스트랩 → $member, $is_member
include_once __DIR__ . '/../lib/jwt.php';    // spcb_jwt_encode(), secret.php 의 상수들

header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex');

/** 설정이 빠졌거나 위험한 값이면 토큰을 만들지 않고 멈춘다. */
function sp_smartsmt_sso_fail($status, $message)
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

$secret    = defined('SPCB_SMARTSMT_SECRET') ? (string) SPCB_SMARTSMT_SECRET : '';
$login_url = defined('SPCB_SMARTSMT_LOGIN_URL') ? (string) SPCB_SMARTSMT_LOGIN_URL : '';

if ($secret === '' || $login_url === '') {
    sp_smartsmt_sso_fail(503, 'SmartSMT 연동이 설정되지 않았습니다.');
}
if (strlen($secret) < 32 || $secret === SPCB_JWT_SECRET) {
    sp_smartsmt_sso_fail(503, 'SmartSMT 연동 설정이 올바르지 않습니다.');
}
if (!preg_match('#^https?://[^\s]+$#i', $login_url)) {
    sp_smartsmt_sso_fail(503, 'SmartSMT 연동 설정이 올바르지 않습니다.');
}

// state — SmartSMT 가 정한 임의의 표시. 뜻을 보지 않고 그대로 돌려준다.
// 주소에 그대로 붙이므로 글자 종류를 좁게 받는다(200자 이하, 영문·숫자·-·_).
$state = isset($_GET['state']) ? (string) $_GET['state'] : '';
if (!preg_match('/^[A-Za-z0-9_-]{0,200}$/', $state)) {
    sp_smartsmt_sso_fail(400, 'state 형식이 올바르지 않습니다.');
}

// 비로그인(차단·탈퇴 회원은 common.php 가 이미 로그아웃시킨다) → 로그인 화면을 거쳐 이 주소로 돌아온다.
if (empty($is_member) || empty($member['mb_id'])) {
    $self = G5_URL . '/spcb/sso/smartsmt' . ($state !== '' ? '?state=' . $state : '');
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode($self));
}

// 로그인 토큰 — 넘기는 회원 정보는 아이디와 이름 두 가지뿐이다.
$now    = time();
$claims = array(
    'iss'  => 'samplepcb',
    'aud'  => 'smartsmt-login',
    'sub'  => (string) $member['mb_id'],
    'name' => function_exists('mb_substr')
        ? mb_substr((string) $member['mb_name'], 0, 100, 'UTF-8')
        : (string) $member['mb_name'],
    'iat'  => $now,
    'exp'  => $now + 120,   // 2분
);
$token = spcb_jwt_encode($claims, $secret);

$sep      = strpos($login_url, '?') === false ? '?' : '&';
$location = $login_url . $sep . 'token=' . rawurlencode($token)
          . ($state !== '' ? '&state=' . $state : '');

header('Location: ' . $location, true, 302);
exit;
