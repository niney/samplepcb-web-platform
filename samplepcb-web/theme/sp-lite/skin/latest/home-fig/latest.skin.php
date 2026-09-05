<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈(Figma 웹 메인 2122:5280) FAQ·공지사항·Q&A 최신글 스킨 — $bo_table 로 세 모양을 가른다.
 *   faq    : 카테고리 탭(게시판 분류) + 아코디언(카테고리당 4건, 첫 건 펼침 — js/home.js 가 제어). 40건을 받아 클라이언트에서 거른다.
 *   notice : 제목 + 날짜 5줄
 *   qa     : "Q." + 제목 + 날짜 5줄
 * 스타일은 css/home.css(.sp-card .sp-faq* .sp-bl*).
 */
$list_count = (is_array($list) && $list) ? count($list) : 0;
$list_url = get_pretty_url($bo_table);

if ($bo_table === 'faq') {
    $cats = array();
    $board_faq = (isset($board['bo_category_list'])) ? $board : get_board_db($bo_table, true); // latest() 캐시 히트 시 $board 가 비어 분류를 못 읽는다
    if (isset($board_faq['bo_category_list']) && trim($board_faq['bo_category_list']) !== '') {
        foreach (explode('|', $board_faq['bo_category_list']) as $c) { $c = trim($c); if ($c !== '') $cats[] = $c; }
    }
?>
<?php if ($cats) { ?>
<ul class="sp-faq-tabs" role="tablist">
    <?php foreach ($cats as $k => $c) { ?>
    <li><button type="button" role="tab" data-ca="<?php echo get_text($c); ?>"<?php echo $k === 0 ? ' class="is-active"' : ''; ?>><?php echo get_text($c); ?></button></li>
    <?php } ?>
</ul>
<?php } ?>
<div class="sp-card sp-faq">
    <?php for ($i = 0; $i < $list_count; $i++) {
        $row = $list[$i];
        $ca = isset($row['ca_name']) ? trim($row['ca_name']) : '';
        $href = get_pretty_url($bo_table, $row['wr_id']);
        $answer = isset($row['wr_content']) ? trim(preg_replace('/\s+/u', ' ', strip_tags(html_entity_decode($row['wr_content'], ENT_QUOTES, 'UTF-8')))) : '';
        $answer = cut_str($answer, 220, '…');
    ?>
    <div class="sp-faq__item" data-ca="<?php echo get_text($ca); ?>"<?php echo $i > 0 ? ' hidden' : ''; ?>>
        <button type="button" class="sp-faq__head" aria-expanded="false">
            <span class="sp-faq__lead">
                <?php if ($ca !== '') { ?><span class="sp-faq__badge"><?php echo get_text($ca); ?></span><?php } ?>
                <span class="sp-faq__q"><?php echo $row['subject']; ?></span>
            </span>
            <span class="sp-faq__toggle" aria-hidden="true"></span>
        </button>
        <div class="sp-faq__body">
            <?php if ($answer !== '') { ?><p class="sp-faq__a"><?php echo $answer; ?></p><?php } ?>
            <a class="sp-faq__more" href="<?php echo $href; ?>">View more →</a>
        </div>
    </div>
    <?php } ?>
    <p class="sp-faq__empty sp-bl__empty"<?php echo $list_count ? ' hidden' : ''; ?>>등록된 질문이 없습니다.</p>
</div>
<?php
    return;
}
?>
<div class="sp-card">
    <ul class="sp-bl">
    <?php for ($i = 0; $i < $list_count; $i++) {
        $row = $list[$i];
        $date = date('Y.m.d', strtotime($row['wr_datetime']));
    ?>
        <li class="sp-bl__item">
            <a class="sp-bl__link" href="<?php echo get_pretty_url($bo_table, $row['wr_id']); ?>">
                <?php if ($bo_table === 'qa') { ?><span class="sp-bl__q" aria-hidden="true">Q.</span><?php } ?>
                <?php if ($row['icon_secret']) { ?><span class="sound_only">비밀글</span><?php } ?>
                <span class="sp-bl__subj"><?php echo $row['subject']; ?></span>
            </a>
            <time class="sp-bl__date" datetime="<?php echo date('Y-m-d', strtotime($row['wr_datetime'])); ?>"><?php echo $date; ?></time>
        </li>
    <?php } ?>
    <?php if ($list_count == 0) { ?>
        <li class="sp-bl__empty">게시물이 없습니다.</li>
    <?php } ?>
    </ul>
</div>
