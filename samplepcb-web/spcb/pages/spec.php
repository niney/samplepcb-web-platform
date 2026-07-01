<?php
// samplepcb 정적 페이지 — 생산규격
// URL: /spec (루트 .htaccess 가 /spcb/pages/spec.php 로 내부 리라이트)
// 새 정적 페이지 추가법: 이 폴더에 {슬러그}.php 를 만들면 /{슬러그} 로 바로 열린다.

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $config, $member, 테마 상수

$g5['title'] = '생산규격';
include_once(G5_THEME_PATH.'/head.php');
?>

<div class="sp-page">
    <p>생산규격 페이지 콘텐츠가 준비 중입니다.</p>
</div>

<?php
include_once(G5_THEME_PATH.'/tail.php');
