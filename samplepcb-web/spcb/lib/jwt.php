<?php
// HS256 JWT 인코더 (Composer 없이 순수 PHP). sp-node @fastify/jwt(HS256)와 호환.
// include 전용 — 직접 웹 접근은 아래 가드 + lib/.htaccess 로 차단.
if (!defined('_GNUBOARD_')) exit;

require_once __DIR__ . '/secret.php';  // define('SPCB_JWT_SECRET', ...)  (gitignore)

function spcb_base64url_encode($bin) {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function spcb_base64url_decode($str) {
    $pad = strlen($str) % 4;
    if ($pad) $str .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($str, '-_', '+/'));
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

// 서명된 JWT 문자열 → 클레임(연관배열) 또는 false. sp-node(@fastify/jwt HS256)가 서명한
// 서비스 토큰을 검증한다. 서명 불일치·alg 불일치·형식 오류·만료(exp)는 모두 false.
// 서명 검증은 hash_equals(타이밍 안전). exp 는 필수(없으면 거부) — 서비스 토큰은 단기 발급.
function spcb_jwt_decode($jwt, $secret) {
    if (!is_string($jwt) || $jwt === '') return false;
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) return false;
    list($h64, $p64, $s64) = $parts;

    $header = json_decode(spcb_base64url_decode($h64), true);
    if (!is_array($header) || !isset($header['alg']) || $header['alg'] !== 'HS256') return false;

    $expected = hash_hmac('sha256', $h64 . '.' . $p64, $secret, true);
    $actual   = spcb_base64url_decode($s64);
    if (!is_string($actual) || !hash_equals($expected, $actual)) return false;

    $claims = json_decode(spcb_base64url_decode($p64), true);
    if (!is_array($claims)) return false;

    // exp 필수 + 만료 검사(약간의 시계 오차 허용 없이 엄격 — 발급 exp 가 넉넉).
    if (!isset($claims['exp']) || !is_numeric($claims['exp']) || time() >= (int) $claims['exp']) {
        return false;
    }

    return $claims;
}
