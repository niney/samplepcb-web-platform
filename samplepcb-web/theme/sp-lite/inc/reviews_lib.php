<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 별점후기(sp_review) 공용 헬퍼
 * ------------------------------------------------------------------
 * 두 곳에서 재사용한다:
 *   · spcb/pages/reviews.php            — 전체 후기 목록(/reviews)
 *   · theme/sp-lite/inc/main_reviews.php — 홈 별점후기 쇼케이스
 * function_exists 가드로 중복 include 시에도 안전.
 */

if (!function_exists('sp_review_mask')) {
    // 작성자 실명 마스킹: 박종현 → 박*현, 이태중 → 이*중, 홍길 → 홍* (순수 문자열)
    function sp_review_mask($name)
    {
        $name = trim((string) $name);
        $len = mb_strlen($name, 'UTF-8');
        if ($len <= 1) return $name;
        if ($len === 2) return mb_substr($name, 0, 1, 'UTF-8') . '*';
        return mb_substr($name, 0, 1, 'UTF-8') . str_repeat('*', $len - 2) . mb_substr($name, -1, 1, 'UTF-8');
    }
}

if (!function_exists('sp_review_name')) {
    // 마스킹 + HTML 이스케이프. 빈 값이면 '고객'.
    function sp_review_name($raw)
    {
        $name = trim((string) $raw);
        if ($name === '') return '고객';
        return htmlspecialchars(sp_review_mask($name), ENT_QUOTES, 'UTF-8');
    }
}

if (!function_exists('sp_review_body')) {
    // 본문 새니타이즈: 문단/줄바꿈만 개행으로 남기고 모든 태그 제거 → 엔티티 정규화 → 재이스케이프 → nl2br
    //   · strip_tags 로 script/style/span/on* 전부 소거 → XSS 원천 차단.
    //   · html_entity_decode 로 &nbsp; 등 레거시 엔티티를 실제 문자로 되돌린 뒤 htmlspecialchars 로 재인코딩.
    //   · $maskName 지정 시(관리자 답변) 본문이 호칭하는 작성자 실명을 동일 규칙으로 마스킹 — 공개 PII 최소화.
    function sp_review_body($html, $maskName = '')
    {
        $t = preg_replace('#</p\s*>|<br\s*/?>#i', "\n", (string) $html);
        $t = strip_tags($t);
        $t = html_entity_decode($t, ENT_QUOTES, 'UTF-8');
        $t = trim($t);
        if ($maskName !== '' && mb_strlen($maskName, 'UTF-8') >= 2) {
            $t = str_replace($maskName, sp_review_mask($maskName), $t);
        }
        return nl2br(htmlspecialchars($t, ENT_QUOTES, 'UTF-8'));
    }
}

if (!function_exists('sp_review_text')) {
    // 본문을 평문(태그·개행 제거, 이스케이프)으로. 쇼케이스 카드 미리보기용.
    function sp_review_text($html, $maskName = '')
    {
        $t = preg_replace('#</p\s*>|<br\s*/?>#i', ' ', (string) $html);
        $t = strip_tags($t);
        $t = html_entity_decode($t, ENT_QUOTES, 'UTF-8');
        $t = preg_replace('/\s+/u', ' ', $t);
        $t = trim($t);
        if ($maskName !== '' && mb_strlen($maskName, 'UTF-8') >= 2) {
            $t = str_replace($maskName, sp_review_mask($maskName), $t);
        }
        return $t; // 이스케이프는 호출부(htmlspecialchars/mb_strimwidth)에서
    }
}

if (!function_exists('sp_review_stars')) {
    // 별점(5점 만점)
    function sp_review_stars($score)
    {
        $s = max(0, min(5, (int) $score));
        return str_repeat('★', $s) . str_repeat('☆', 5 - $s);
    }
}
