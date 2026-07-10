<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 홈 별점후기 쇼케이스 (커뮤니티 홈 전용 브릿지)
 * ------------------------------------------------------------------
 * 영카트 상품 별점후기 이관본 sp_review(구매확인 기반, isConfirm=1)를 홈 상단에
 * 카드 스트립으로 노출한다. 전체 목록은 /reviews(spcb/pages/reviews.php).
 * 라이브 www.samplepcb.co.kr 의 "별점평가가 증명하는 제조서비스" 섹션과 동형.
 *
 * 데이터/새니타이즈/마스킹은 /reviews 와 동일 헬퍼(inc/reviews_lib.php)를 재사용한다.
 */

include_once G5_THEME_PATH . '/inc/reviews_lib.php';

$sp_rv_stat = sql_fetch(" select count(*) as cnt, round(avg(score), 1) as avg from sp_review where isConfirm = 1 ");
$sp_rv_total = (int) $sp_rv_stat['cnt'];
if ($sp_rv_total <= 0) return; // 노출 승인분이 없으면 섹션 자체를 그리지 않음

$sp_rv_avg = number_format((float) $sp_rv_stat['avg'], 1);

// 최신 승인 후기 상위 N (본문 있는 것 우선 노출)
$sp_rv_cards = array();
$sp_rv_res = sql_query("
    select id, score, subject, content,
           json_unquote(json_extract(legacyJson, '$.is_name')) as is_name
      from sp_review
     where isConfirm = 1
     order by writeDate desc, id desc
     limit 8 ");
while ($sp_rv_row = sql_fetch_array($sp_rv_res)) $sp_rv_cards[] = $sp_rv_row;
?>
<style>
/* 홈 별점후기 쇼케이스 (sp-lite 토큰 사용, 값은 fallback 동반) */
.sp-home-reviews { margin: 8px 0 40px; }
.sp-home-reviews__head { text-align: center; margin-bottom: 24px; }
.sp-home-reviews__title { margin: 0; font-size: 24px; font-weight: 800; color: var(--sp-ink, #1b1b1f); }
.sp-home-reviews__title b { color: var(--sp-primary, #0b57d0); }
.sp-home-reviews__stat { margin-top: 10px; font-size: 14px; color: var(--sp-muted, #5b6472); }
.sp-home-reviews__stat .avg { font-weight: 800; color: var(--sp-primary, #0b57d0); }
.sp-home-reviews__stat .stars { color: #f5b301; letter-spacing: 1px; }

.sp-home-reviews__grid {
    display: grid; gap: 14px;
    grid-template-columns: repeat(4, 1fr);
}
.sp-hr-card {
    display: flex; flex-direction: column; gap: 10px;
    border: 1px solid var(--sp-border, #e5e7eb); border-radius: 14px;
    padding: 18px 18px 16px; background: #fff; min-height: 150px;
}
.sp-hr-card__stars { color: #f5b301; font-size: 15px; letter-spacing: 1px; }
.sp-hr-card__subject { margin: 0; font-size: 15px; font-weight: 700; color: var(--sp-ink, #1b1b1f); line-height: 1.45; }
.sp-hr-card__body {
    margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--sp-muted, #5b6472);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sp-hr-card__foot { margin-top: auto; font-size: 13px; color: var(--sp-muted, #5b6472); }
.sp-hr-card__foot .name { font-weight: 700; color: var(--sp-ink, #1b1b1f); }

.sp-home-reviews__more { text-align: center; margin-top: 22px; }
.sp-home-reviews__more a {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 11px 26px; border-radius: 999px; text-decoration: none;
    border: 1px solid var(--sp-primary, #0b57d0); color: var(--sp-primary, #0b57d0);
    font-size: 14px; font-weight: 700; background: #fff;
    transition: background .15s, color .15s;
}
.sp-home-reviews__more a:hover { background: var(--sp-primary, #0b57d0); color: #fff; }

@media (max-width: 1023.98px) { .sp-home-reviews__grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 575.98px)  { .sp-home-reviews__grid { grid-template-columns: 1fr; } }
</style>

<section class="sp-home-reviews">
    <div class="sp-home-reviews__head">
        <h2 class="sp-home-reviews__title"><b>별점후기</b>가 증명하는 (주)샘플피씨비 제조서비스</h2>
        <p class="sp-home-reviews__stat">
            <span class="avg"><?php echo $sp_rv_avg; ?></span>
            <span class="stars"><?php echo sp_review_stars(round((float) $sp_rv_stat['avg'])); ?></span>
            · 실구매 고객 <?php echo number_format($sp_rv_total); ?>명의 후기
        </p>
    </div>

    <div class="sp-home-reviews__grid">
        <?php foreach ($sp_rv_cards as $sp_c) {
            $sp_name    = trim((string) $sp_c['is_name']);
            $sp_subject = trim((string) $sp_c['subject']);
            $sp_snippet = sp_review_text($sp_c['content'], $sp_name);
            // 제목이 없으면 본문 앞부분을 제목처럼 사용
            if ($sp_subject === '') {
                $sp_subject = mb_strimwidth($sp_snippet, 0, 40, '…', 'UTF-8');
                $sp_snippet = '';
            }
            // 본문이 제목과 사실상 동일하면(구두점 차이 포함) 중복 노출 생략
            $sp_norm = function ($s) { return preg_replace('/[\s.,!~…]+$/u', '', trim((string) $s)); };
            if ($sp_snippet !== '' && $sp_norm($sp_snippet) === $sp_norm($sp_subject)) {
                $sp_snippet = '';
            }
        ?>
        <article class="sp-hr-card">
            <div class="sp-hr-card__stars" aria-label="<?php echo (int) $sp_c['score']; ?>점"><?php echo sp_review_stars($sp_c['score']); ?></div>
            <p class="sp-hr-card__subject"><?php echo htmlspecialchars($sp_subject, ENT_QUOTES, 'UTF-8'); ?></p>
            <?php if ($sp_snippet !== '') { ?>
            <p class="sp-hr-card__body"><?php echo htmlspecialchars($sp_snippet, ENT_QUOTES, 'UTF-8'); ?></p>
            <?php } ?>
            <div class="sp-hr-card__foot"><span class="name"><?php echo sp_review_name($sp_name); ?></span> 님</div>
        </article>
        <?php } ?>
    </div>

    <div class="sp-home-reviews__more">
        <a href="<?php echo G5_URL; ?>/reviews">전체 별점후기 보기 <i class="fa fa-angle-right" aria-hidden="true"></i></a>
    </div>
</section>
