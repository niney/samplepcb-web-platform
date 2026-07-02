<?php
// samplepcb 인증 브리지 (sp-php → sp-node)
// URL: GET /spcb/api/me   (spcb/.htaccess 가 .php 확장 생략)
// 그누보드 세션(PHPSESSID)으로 회원을 식별해, sp-node(Fastify)가 검증할
// HS256 JWT + 회원정보(Me)를 발급한다. 세션=진실원본, JWT=단기캐시(10분).
// 설계: AGENTS.md "인증 브리지" 참조.

include_once __DIR__ . '/../../common.php';  // 그누보드 부트스트랩 → $member, $is_member, $config
include_once __DIR__ . '/../lib/jwt.php';    // spcb_jwt_encode(), SPCB_JWT_SECRET

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// 비로그인 → 401. sp-vue 는 이 응답을 받으면 익명 상태를 유지한다.
if (empty($is_member) || empty($member['mb_id'])) {
    http_response_code(401);
    echo json_encode(['message' => 'not authenticated'], JSON_UNESCAPED_UNICODE);
    return;
}

// isAdmin: 우선 최고관리자(cf_admin)만 true. 그룹/게시판 관리자는 추후 확장.
$is_admin = (isset($config['cf_admin']) && $member['mb_id'] === $config['cf_admin']);

// cartId: 영카트 장바구니 버킷 키(세션 ss_cart_id, cart 행의 od_id).
// sp-node 담기 API 가 g5_shop_cart INSERT 시 od_id 로 사용해야 cart.php 에 보인다.
// 세션에 없으면 영카트 표준 함수로 생성(로그인 상태이므로 회원 경로).
$cart_id = '';
if (function_exists('set_cart_id')) {
    set_cart_id('');
    $cart_id = (string) get_session('ss_cart_id');
}

// sp-node @sp/api-contract 의 Me 스키마와 필드·타입을 정확히 맞춘다.
$now    = time();
$claims = array(
    'mbId'    => (string) $member['mb_id'],
    'mbNick'  => (string) $member['mb_nick'],
    'level'   => (int) $member['mb_level'],
    'isAdmin' => (bool) $is_admin,
    'cartId'  => $cart_id,
    'iat'     => $now,
    'exp'     => $now + 600,   // 10분
);

$token = spcb_jwt_encode($claims, SPCB_JWT_SECRET);

echo json_encode(array(
    'token'  => $token,
    'member' => array(
        'mbId'    => $claims['mbId'],
        'mbNick'  => $claims['mbNick'],
        'level'   => $claims['level'],
        'isAdmin' => $claims['isAdmin'],
    ),
), JSON_UNESCAPED_UNICODE);
