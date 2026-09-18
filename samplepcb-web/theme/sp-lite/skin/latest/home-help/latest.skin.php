<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 "도움이 필요하신가요?"(Figma 웹 메인 2286:2134) 최신글 스킨 — $bo_table 로 모양을 가른다.
 *   qa     : "Q." + 제목 + 날짜 행(구분선) — inc/home/42-help.php 의 Q&A 카드 안, 3건
 *   notice : 제목 + 날짜 한 줄 — 공지 카드 안(라벨 "공지"·더보기는 42-help.php 가 감싼다), 1건
 *   글 제목은 글 보기 링크(실존 콘텐츠). 스타일 css/home/42-help.css(.sp-help__list .sp-help__nt*).
 */
$list_count = (is_array($list) && $list) ? count($list) : 0;

if ($bo_table === 'notice') {
    if ($list_count) {
        $row = $list[0];
        $dt = strtotime($row['wr_datetime']);
?>
<div class="sp-help__nt-body">
    <a class="sp-help__nt-link" href="<?php echo get_pretty_url($bo_table, $row['wr_id']); ?>"><?php if ($row['icon_secret']) { ?><span class="sound_only">비밀글</span><?php } ?><span class="sp-help__subj"><?php echo $row['subject']; ?></span></a>
</div>
<time class="sp-help__date" datetime="<?php echo date('Y-m-d', $dt); ?>"><?php echo date('Y.m.d', $dt); ?></time>
<?php
    } else {
?>
<div class="sp-help__nt-body"><span class="sp-help__empty">등록된 공지가 없습니다.</span></div>
<?php
    }
    return;
}
?>
<ul class="sp-help__list">
<?php for ($i = 0; $i < $list_count; $i++) {
    $row = $list[$i];
    $dt = strtotime($row['wr_datetime']);
?>
    <li class="sp-help__item">
        <a class="sp-help__link" href="<?php echo get_pretty_url($bo_table, $row['wr_id']); ?>">
            <span class="sp-help__q" aria-hidden="true">Q.</span>
            <?php if ($row['icon_secret']) { ?><span class="sound_only">비밀글</span><?php } ?>
            <span class="sp-help__subj"><?php echo $row['subject']; ?></span>
        </a>
        <time class="sp-help__date" datetime="<?php echo date('Y-m-d', $dt); ?>"><?php echo date('Y.m.d', $dt); ?></time>
    </li>
<?php } ?>
<?php if ($list_count == 0) { ?>
    <li class="sp-help__item sp-help__item--empty"><span class="sp-help__empty">등록된 질문이 없습니다.</span></li>
<?php } ?>
</ul>
