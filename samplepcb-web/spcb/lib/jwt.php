<?php
// HS256 JWT 인코더 (Composer 없이 순수 PHP). sp-node @fastify/jwt(HS256)와 호환.
// include 전용 — 직접 웹 접근은 아래 가드 + lib/.htaccess 로 차단.
if (!defined('_GNUBOARD_')) exit;

require_once __DIR__ . '/secret.php';  // define('SPCB_JWT_SECRET', ...)  (gitignore)

function spcb_base64url_encode($bin) {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

// $claims(연관배열) → 서명된 JWT 문자열. 알고리즘 HS256 고정.
// json_encode 기본값은 유니코드를 \uXXXX 로 이스케이프 → 어떤 JWT 디코더와도 안전.
function spcb_jwt_encode(array $claims, $secret) {
    $header   = array('alg' => 'HS256', 'typ' => 'JWT');
    $segments = array(
        spcb_base64url_encode(json_encode($header, JSON_UNESCAPED_SLASHES)),
        spcb_base64url_encode(json_encode($claims, JSON_UNESCAPED_SLASHES)),
    );
    $signing_input = implode('.', $segments);
    $signature     = hash_hmac('sha256', $signing_input, $secret, true);
    $segments[]    = spcb_base64url_encode($signature);
    return implode('.', $segments);
}
