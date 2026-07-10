<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * SEO 메타 브릿지 (P1) — sp_seo 를 페이지 전역변수로 매칭해 <head> 메타를 출력한다.
 * ------------------------------------------------------------------
 * - head.sub.php 의 <title> 직전에서 include 된다. PHP include 는 호출 스코프를 상속하므로
 *   $it/$bo_table/$g5_head_title/$config 가 여기서 직접 보인다(URL 파싱이 아니라 전역변수 매칭).
 * - 관리 UI 는 sp-vue /app/admin/seo, 저장은 sp-node → Prisma sp_seo. 여기선 read-only 조회만.
 * - 정본: docs/SEO_MANAGEMENT.md.  폴백: 엔티티 오버라이드 → 전역기본(global) → 자동유도 → 코어 title.
 */

// ── 1) 현재 페이지의 (scope, refKey) 판별 — 전역변수 매칭 ─────────────────────
$sp_seo_script = basename(isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '');
$sp_seo_scope = 'global';
$sp_seo_ref   = '';
if ($sp_seo_script === 'item.php' && !empty($it['it_id'])) {
    $sp_seo_scope = 'item';               // 상품 상세 — 레코드 없으면 아래 자동유도로 폴백(P2 에서 확장)
    $sp_seo_ref   = (string) $it['it_id'];
} elseif (isset($bo_table) && $bo_table !== '') {
    $sp_seo_scope = 'board';              // 게시판(P3)
    $sp_seo_ref   = (string) $bo_table;
} elseif ($sp_seo_script !== '' && $sp_seo_script !== 'index.php') {
    $sp_seo_scope = 'page';              // spcb 정적 페이지 등 — 파일명으로 매칭
    $sp_seo_ref   = $sp_seo_script;
}

// ── 2) 엔티티 + 전역기본을 1쿼리로 조회, 폴백 병합 (전 페이지 경유 → 실패해도 페이지 유지) ──
$sp_seo_row = array();      // 엔티티 오버라이드
$sp_seo_global = array();   // 전역 기본
$sp_seo_sql = " select scope, refKey, metaTitle, metaDescription, ogImage, canonical, robots
                  from sp_seo
                 where (scope = '" . sql_escape_string($sp_seo_scope) . "' and refKey = '" . sql_escape_string($sp_seo_ref) . "')
                    or (scope = 'global' and refKey = '') ";
$sp_seo_res = sql_query($sp_seo_sql, false); // 2번째 인자 false = 에러 시 die 안 함
if ($sp_seo_res) {
    while ($sp_seo_r = sql_fetch_array($sp_seo_res)) {
        if ($sp_seo_r['scope'] === 'global') $sp_seo_global = $sp_seo_r;
        else $sp_seo_row = $sp_seo_r;
    }
}

// 폴백 헬퍼: 엔티티 → 전역기본 → ''(없음)
if (!function_exists('sp_seo_val')) {
    function sp_seo_val($row, $global, $key) {
        if (isset($row[$key]) && $row[$key] !== '' && $row[$key] !== null) return $row[$key];
        if (isset($global[$key]) && $global[$key] !== '' && $global[$key] !== null) return $global[$key];
        return '';
    }
}

$sp_seo_title  = sp_seo_val($sp_seo_row, $sp_seo_global, 'metaTitle');
$sp_seo_desc   = sp_seo_val($sp_seo_row, $sp_seo_global, 'metaDescription');
$sp_seo_ogimg  = sp_seo_val($sp_seo_row, $sp_seo_global, 'ogImage');
$sp_seo_canon  = sp_seo_val($sp_seo_row, $sp_seo_global, 'canonical');
$sp_seo_robots = sp_seo_val($sp_seo_row, $sp_seo_global, 'robots');

// ── 3) 자동 유도 — 레코드가 없어도 상품 SEO 가 서도록(맹점 a). 코어 sns_title 관례 재사용 ──
if ($sp_seo_scope === 'item' && !empty($it['it_id'])) {
    if ($sp_seo_title === '') {
        $sp_seo_title = get_text($it['it_name']) . ' | ' . get_text($config['cf_title']);
    }
    // og:image 상품 대표이미지 자동유도는 이미지 경로 정합성(P2)에서 다룬다 — 여기선 명시 저장값만 사용.
}

// ── 4) 절대 URL 화 & canonical 계산(기본=현재 URL, G5_DOMAIN='' 호스트 무관 설계) ──────────
$sp_seo_scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https://' : 'http://';
$sp_seo_host   = $sp_seo_scheme . (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '');
$sp_seo_reqpath = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$sp_seo_cur_url = $sp_seo_host . strtok($sp_seo_reqpath, '?'); // 쿼리스트링 제거

if ($sp_seo_canon === '') {
    $sp_seo_canon = $sp_seo_cur_url;                 // 미설정 → 현재 URL 계산
} elseif (strpos($sp_seo_canon, 'http') !== 0) {
    $sp_seo_canon = $sp_seo_host . $sp_seo_canon;    // 상대경로 오버라이드 → 절대화
}
if ($sp_seo_ogimg !== '' && strpos($sp_seo_ogimg, 'http') !== 0) {
    $sp_seo_ogimg = $sp_seo_host . $sp_seo_ogimg;    // OG 이미지 절대 URL 필수(스크래퍼 요건)
}

// ── 5) <title> 오버라이드 — 뒤따르는 head.sub.php 의 <title> 이 이 값을 사용 ────────────────
if ($sp_seo_title !== '') {
    $g5_head_title = $sp_seo_title;
}
$sp_seo_og_title = ($sp_seo_title !== '') ? $sp_seo_title : $g5_head_title;

// ── 6) 메타 태그 출력 ────────────────────────────────────────────────────────────────────
$sp_seo_esc = function ($v) { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); };
$sp_seo_out = '';
if ($sp_seo_desc !== '')   $sp_seo_out .= '<meta name="description" content="' . $sp_seo_esc($sp_seo_desc) . '">' . PHP_EOL;
if ($sp_seo_robots !== '') $sp_seo_out .= '<meta name="robots" content="' . $sp_seo_esc($sp_seo_robots) . '">' . PHP_EOL;
$sp_seo_out .= '<link rel="canonical" href="' . $sp_seo_esc($sp_seo_canon) . '">' . PHP_EOL;
// Open Graph
$sp_seo_out .= '<meta property="og:type" content="' . ($sp_seo_scope === 'item' ? 'product' : 'website') . '">' . PHP_EOL;
$sp_seo_out .= '<meta property="og:title" content="' . $sp_seo_esc($sp_seo_og_title) . '">' . PHP_EOL;
if ($sp_seo_desc !== '') $sp_seo_out .= '<meta property="og:description" content="' . $sp_seo_esc($sp_seo_desc) . '">' . PHP_EOL;
$sp_seo_out .= '<meta property="og:url" content="' . $sp_seo_esc($sp_seo_canon) . '">' . PHP_EOL;
if ($sp_seo_ogimg !== '') $sp_seo_out .= '<meta property="og:image" content="' . $sp_seo_esc($sp_seo_ogimg) . '">' . PHP_EOL;
$sp_seo_out .= '<meta property="og:site_name" content="' . $sp_seo_esc(get_text($config['cf_title'])) . '">' . PHP_EOL;
echo $sp_seo_out;
