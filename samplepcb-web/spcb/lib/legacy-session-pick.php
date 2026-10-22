<?php
// 레거시 도메인 쿠키 충돌 우회 — 임시. 운영 교체 뒤 레거시가 심은 쿠키가 브라우저에서 사라지면 걷어낸다.
//
// 레거시 www.samplepcb.co.kr(그누보드)는 G5_COOKIE_DOMAIN='.samplepcb.co.kr' 이라 PHPSESSID 를
// 도메인 전체에 심고, 이 플랫폼은 호스트 전용 PHPSESSID 를 쓴다. 두 사이트를 같은 브라우저로 쓰면
// new.samplepcb.co.kr 요청에 PHPSESSID 가 둘 실리는데 PHP 는 첫 번째만 읽는다 — 레거시 쿠키가
// 먼저 만들어졌으면 이 서버에 없는 세션을 읽어 로그인이 안 붙는다.
//
// 세션 이름은 바꾸지 않는다. 세션이 시작되기 전에 원본 Cookie 헤더의 PHPSESSID 를 모두 꺼내
// 이 서버의 세션 저장소에 실제로 있는 것을 고른다(로그인된 세션 우선). 하나도 없으면 새 id 를
// 만든다 — 레거시 id 를 이 서버가 그대로 쓰기 시작하면 다음부터 둘 다 '있는 세션'이 돼 못 가른다.
//
// 걸리는 곳: *.samplepcb.co.kr 호스트만(centrafab 등 다른 도메인에는 레거시 쿠키가 실리지 않는다),
// 세션 저장이 files 이고 저장 폴더가 보일 때만. 그 밖에는 아무것도 하지 않는다(PHP 기본 동작).
// 불러오는 곳: data/dbconfig.php(서버별·gitignore) — 세션 시작(common.php session_start) 전에 읽히는
// 코어 밖 파일이 거기뿐이다. 코어·config.php 무수정. 자동 로그인 쿠키(ck_auto) 충돌은 다루지 않는다.
if (!defined('_GNUBOARD_')) exit;

(function () {
    $host = isset($_SERVER['HTTP_HOST']) ? strtolower(preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'])) : '';
    if (!preg_match('/(^|\.)samplepcb\.co\.kr$/', $host)) return;
    if (ini_get('session.save_handler') !== 'files' || empty($_SERVER['HTTP_COOKIE'])) return;

    $name = session_name();
    $ids = array();
    foreach (explode(';', $_SERVER['HTTP_COOKIE']) as $pair) {
        $kv = explode('=', trim($pair), 2);
        if (count($kv) === 2 && $kv[0] === $name && preg_match('/^[a-zA-Z0-9,-]{22,256}$/', $kv[1])) {
            $ids[] = $kv[1];
        }
    }
    if (!$ids) return;

    $dir = (string) session_save_path();
    if (($p = strrpos($dir, ';')) !== false) $dir = substr($dir, $p + 1); // "N;/path" 형식
    if ($dir === '') $dir = sys_get_temp_dir();
    if (!@is_dir($dir)) return; // 저장소를 못 보면 판정하지 않는다 — 멀쩡한 세션을 버리게 된다

    $pick = null;
    foreach (array_unique($ids) as $id) {
        $file = $dir . '/sess_' . $id;
        if (!@is_file($file)) continue;
        if ($pick === null) $pick = $id;
        if (strpos((string) @file_get_contents($file), 'ss_mb_id|') !== false) {
            $pick = $id;
            break;
        }
    }
    if ($pick === null) $pick = session_create_id();

    // PHP 가 고를 값(첫 번째 쿠키)과 같으면 손대지 않는다 — 쿠키가 하나뿐인 평소 요청은 그대로 지나간다.
    if (isset($_COOKIE[$name]) && $_COOKIE[$name] === $pick) return;
    session_id($pick);
})();
