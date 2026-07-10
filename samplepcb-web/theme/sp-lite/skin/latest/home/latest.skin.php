<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// 홈 3단 게시판 그리드용 최신글 스킨. 색상/레이아웃 CSS 는 theme/sp-lite/index.php 에 집중.
// index.php 가 각 latest() 호출을 .sp-home-board--{notice|qa|faq} 래퍼로 감싼다.
$list_count = (is_array($list) && $list) ? count($list) : 0;
$list_url = get_pretty_url($bo_table);
?>
<div class="sp-hb">
    <div class="sp-hb__head">
        <h2 class="sp-hb__title"><a href="<?php echo $list_url; ?>"><?php echo $bo_subject; ?></a></h2>
        <a class="sp-hb__more" href="<?php echo $list_url; ?>">MORE</a>
    </div>
    <ul class="sp-hb__list">
    <?php for ($i = 0; $i < $list_count; $i++) { ?>
        <li class="sp-hb__item">
            <a href="<?php echo get_pretty_url($bo_table, $list[$i]['wr_id']); ?>" class="sp-hb__link">
                <?php if ($list[$i]['icon_secret']) { ?><i class="fa fa-lock sp-hb__lock" aria-hidden="true"></i><span class="sound_only">비밀글</span><?php } ?>
                <span class="sp-hb__subj"><?php echo $list[$i]['subject']; ?></span>
                <?php if ($list[$i]['icon_new']) { ?><span class="sp-hb__new">N<span class="sound_only">새글</span></span><?php } ?>
            </a>
        </li>
    <?php } ?>
    <?php if ($list_count == 0) { ?>
        <li class="sp-hb__empty">게시물이 없습니다.</li>
    <?php } ?>
    </ul>
</div>
