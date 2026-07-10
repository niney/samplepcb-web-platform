<?php
if (!defined('_INDEX_')) define('_INDEX_', true);
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

if(G5_COMMUNITY_USE === false) {
    include_once(G5_THEME_SHOP_PATH.'/index.php');
    return;
}

include_once(G5_THEME_PATH.'/head.php');
?>

<!-- 메인 슬라이드 배너 시작 { (영카트 배너관리 '메인' 위치 재사용) -->
<?php include G5_THEME_PATH.'/inc/main_slider.php'; ?>
<!-- } 메인 슬라이드 배너 끝 -->

<!-- 별점후기 쇼케이스 시작 { (sp_review 상위 N, 전체=/reviews) -->
<?php include G5_THEME_PATH.'/inc/main_reviews.php'; ?>
<!-- } 별점후기 쇼케이스 끝 -->

<!-- 홈 게시판 3단 시작 { (공지사항 | Q&A | FAQ — 나머지 게시판은 우측 하단 '미배치 링크' 패널) -->
<style>
.sp-home-boards { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin:8px 0 44px; }
.sp-home-board { min-width:0; }
.sp-home-board .sp-hb { height:100%; box-sizing:border-box; border-radius:16px; padding:26px 24px; color:#fff; }
.sp-home-board--notice .sp-hb { background:#12b886; }
.sp-home-board--qa .sp-hb { background:var(--sp-primary,#0b57d0); }
.sp-home-board--faq .sp-hb { background:#39424e; }
.sp-hb__head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.sp-hb__title { margin:0; font-size:21px; font-weight:800; }
.sp-hb__title a { color:#fff; text-decoration:none; }
.sp-hb__more { font-size:12px; font-weight:700; letter-spacing:.04em; color:#fff; text-decoration:none; border:1px solid rgba(255,255,255,.55); border-radius:999px; padding:5px 14px; transition:background .15s; }
.sp-hb__more:hover { background:rgba(255,255,255,.2); color:#fff; }
.sp-hb__list { list-style:none; margin:0; padding:0; }
.sp-hb__item { position:relative; border-top:1px solid rgba(255,255,255,.18); }
.sp-hb__item:first-child { border-top:0; }
.sp-hb__item::before { content:""; position:absolute; left:7px; top:50%; width:4px; height:4px; margin-top:-2px; border-radius:50%; background:rgba(255,255,255,.75); pointer-events:none; }
.sp-hb__link { display:flex; align-items:center; gap:6px; padding:9px 12px 9px 20px; color:#fff; text-decoration:none; font-size:14px; }
/* 테마 전역 a:hover(파랑)가 색 패널 위에서 글자를 안 보이게 함 → 호버해도 흰색 유지(가독성) */
.sp-hb__link:hover { color:#fff; }
.sp-hb__link:hover .sp-hb__subj { text-decoration:underline; }
.sp-hb__lock { flex:0 0 auto; font-size:12px; opacity:.85; }
.sp-hb__subj { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sp-hb__new { flex:0 0 auto; font-size:10px; font-weight:800; color:#ffe36e; }
.sp-hb__empty { padding:9px 0; font-size:14px; color:rgba(255,255,255,.82); }
@media (max-width:1023.98px) { .sp-home-boards { grid-template-columns:1fr; } }
</style>
<div class="sp-home-boards">
    <div class="sp-home-board sp-home-board--notice"><?php echo latest('theme/home', 'notice', 4, 30); ?></div>
    <div class="sp-home-board sp-home-board--qa"><?php echo latest('theme/home', 'qa', 4, 30); ?></div>
    <div class="sp-home-board sp-home-board--faq"><?php echo latest('theme/home', 'faq', 4, 30); ?></div>
</div>
<!-- } 홈 게시판 3단 끝 -->

<?php
include_once(G5_THEME_PATH.'/tail.php');