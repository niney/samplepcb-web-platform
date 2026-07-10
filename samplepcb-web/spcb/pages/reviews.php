<?php
// samplepcb 고객후기 목록 — 영카트 상품 별점후기(sp_review) 공개 열람 페이지
// URL: /reviews (루트 .htaccess 규칙 2가 /spcb/pages/reviews.php 로 내부 리라이트)
//
// 배경: 레거시 영카트 상품후기(g5_shop_item_use)는 sp_review 로 변환 이관됐다. 신규는 상품이
//   템플릿 5종뿐이라 상품 축이 무너져 후기를 주문/프로젝트(quoteId) 단위로 재귀속했고, 표준
//   /shop/itemuselist.php 는 ① g5_shop_item_use 0건 ② 후기 it_id(레거시 50종) ∩ 타깃상품(5종)=0
//   INNER JOIN 으로 구조적 표시 불가다. 그래서 sp_review 를 직접 조회해 상품 무관 최신순으로
//   노출한다 — 메인 슬라이드 theme/sp-lite/inc/main_slider.php 와 동형 브릿지. 근거 docs/review-naming.md.
//   코어(subtree) 무변경 — spcb/pages 신규 파일 하나(+진입점 quicklinks 한 줄).
//
// 안전: 본문은 태그 전부 제거+이스케이프(레거시 56/61 이 인라인 style HTML — XSS 차단), 작성자는
//   실명이라 가운데 마스킹(mbId=이메일 PII 는 어디에도 노출 안 함). 읽기 전용(로그인·작성 불필요).

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $config, 테마 상수, sql_* 함수
include_once G5_THEME_PATH . '/inc/reviews_lib.php'; // sp_review_mask/name/body/stars 공용 헬퍼

$g5['title'] = '고객후기';
include_once(G5_THEME_PATH . '/head.php');

// ── 통계(노출 승인분만) ──
$stat = sql_fetch(" select count(*) as cnt, round(avg(score), 1) as avg from sp_review where isConfirm = 1 ");
$total = (int) $stat['cnt'];
$avg   = $total > 0 ? number_format((float) $stat['avg'], 1) : '0.0';

// ── 페이지네이션 ──
$rows = 10;
$page = max(1, (int) (isset($_GET['page']) ? $_GET['page'] : 1));
$total_page = max(1, (int) ceil($total / $rows));
if ($page > $total_page) $page = $total_page;
$from = ($page - 1) * $rows;

$list = array();
if ($total > 0) {
    $sql = " select id, score, subject, content, writeDate, replySubject, replyContent, replyName,
                    json_unquote(json_extract(legacyJson, '$.is_name')) as is_name
               from sp_review
              where isConfirm = 1
              order by writeDate desc, id desc
              limit $from, $rows ";
    $res = sql_query($sql);
    while ($row = sql_fetch_array($res)) $list[] = $row;
}
?>

<style>
/* /reviews 전용 (sp-lite 토큰 사용, 값은 fallback 동반) */
.sp-reviews { max-width: 860px; margin: 0 auto; padding: 8px 0 48px; }
.sp-reviews__head { text-align: center; margin: 8px 0 28px; }
.sp-reviews__eyebrow {
    font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--sp-primary, #0b57d0); margin: 0 0 8px;
}
.sp-reviews__title { margin: 0; font-size: 26px; font-weight: 800; color: var(--sp-ink, #1b1b1f); }
.sp-reviews__stat {
    display: inline-flex; align-items: center; gap: 10px; margin-top: 16px;
    padding: 10px 18px; border-radius: 999px; background: var(--sp-primary-soft, #eef3fe);
}
.sp-reviews__stat .avg { font-size: 20px; font-weight: 800; color: var(--sp-primary, #0b57d0); }
.sp-reviews__stat .stars { color: #f5b301; letter-spacing: 1px; }
.sp-reviews__stat .cnt { font-size: 14px; color: var(--sp-muted, #5b6472); }

.sp-review-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.sp-review-card {
    border: 1px solid var(--sp-border, #e5e7eb); border-radius: 14px;
    padding: 20px 22px; background: #fff;
}
.sp-review-card__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sp-review-card__stars { color: #f5b301; font-size: 16px; letter-spacing: 1px; }
.sp-review-card__date { font-size: 13px; color: var(--sp-muted, #5b6472); }
.sp-review-card__subject { margin: 0 0 8px; font-size: 16.5px; font-weight: 700; color: var(--sp-ink, #1b1b1f); }
.sp-review-card__body { font-size: 14.5px; line-height: 1.75; color: var(--sp-ink, #1b1b1f); word-break: break-word; }
.sp-review-card__foot { margin-top: 14px; font-size: 13px; color: var(--sp-muted, #5b6472); }
.sp-review-card__foot .name { font-weight: 700; color: var(--sp-ink, #1b1b1f); }

.sp-review-card__reply {
    margin-top: 16px; padding: 14px 16px; border-radius: 10px;
    background: var(--sp-primary-soft, #eef3fe); border-left: 3px solid var(--sp-primary, #0b57d0);
}
.sp-review-card__reply .who { font-size: 13px; font-weight: 700; color: var(--sp-primary, #0b57d0); margin-bottom: 6px; }
.sp-review-card__reply .txt { font-size: 14px; line-height: 1.7; color: var(--sp-ink, #1b1b1f); }

.sp-reviews__empty { text-align: center; padding: 72px 0; color: var(--sp-muted, #5b6472); }

/* 페이징 — /reviews 는 shop.head 밖(default_shop.css 미로드)이라 여기서 직접 스타일 */
.sp-reviews .pg_wrap { margin-top: 32px; text-align: center; }
.sp-reviews .pg { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.sp-reviews .pg_page,
.sp-reviews .pg_current {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 38px; height: 38px; padding: 0 12px; box-sizing: border-box;
    border: 1px solid var(--sp-border, #e5e7eb); border-radius: 9px;
    font-size: 14px; font-weight: 600; line-height: 1;
    color: var(--sp-ink, #1b1b1f); background: #fff; text-decoration: none;
    transition: border-color .15s, color .15s, background .15s;
}
.sp-reviews .pg_page:hover {
    border-color: var(--sp-primary, #0b57d0);
    color: var(--sp-primary, #0b57d0);
    background: var(--sp-primary-soft, #eef3fe);
}
.sp-reviews .pg_current {
    border-color: var(--sp-primary, #0b57d0);
    background: var(--sp-primary, #0b57d0);
    color: #fff; cursor: default;
}

@media (max-width: 767.98px) {
    .sp-reviews__title { font-size: 21px; }
    .sp-review-card { padding: 16px 16px; }
}
</style>

<div class="sp-reviews">
    <div class="sp-reviews__head">
        <p class="sp-reviews__eyebrow">Customer Reviews</p>
        <h1 class="sp-reviews__title">고객후기</h1>
        <?php if ($total > 0) { ?>
        <div class="sp-reviews__stat">
            <span class="avg"><?php echo $avg; ?></span>
            <span class="stars"><?php echo sp_review_stars(round((float) $stat['avg'])); ?></span>
            <span class="cnt">· 총 <?php echo number_format($total); ?>건</span>
        </div>
        <?php } ?>
    </div>

    <?php if ($total === 0) { ?>
    <p class="sp-reviews__empty">등록된 후기가 없습니다.</p>
    <?php } else { ?>
    <ul class="sp-review-list">
        <?php foreach ($list as $r) { ?>
        <li class="sp-review-card">
            <div class="sp-review-card__top">
                <span class="sp-review-card__stars" aria-label="<?php echo (int) $r['score']; ?>점"><?php echo sp_review_stars($r['score']); ?></span>
                <span class="sp-review-card__date"><?php echo substr((string) $r['writeDate'], 0, 10); ?></span>
            </div>
            <?php if (trim((string) $r['subject']) !== '') { ?>
            <p class="sp-review-card__subject"><?php echo htmlspecialchars($r['subject'], ENT_QUOTES, 'UTF-8'); ?></p>
            <?php } ?>
            <div class="sp-review-card__body"><?php echo sp_review_body($r['content']); ?></div>
            <div class="sp-review-card__foot"><span class="name"><?php echo sp_review_name($r['is_name']); ?></span> 님</div>

            <?php if (trim((string) $r['replyContent']) !== '') { ?>
            <div class="sp-review-card__reply">
                <div class="who"><i class="fa fa-reply" aria-hidden="true"></i> 샘플피씨비 답변</div>
                <div class="txt"><?php echo sp_review_body($r['replyContent'], trim((string) $r['is_name'])); ?></div>
            </div>
            <?php } ?>
        </li>
        <?php } ?>
    </ul>

    <?php echo get_paging($config['cf_write_pages'], $page, $total_page, '?page='); ?>
    <?php } ?>
</div>

<?php
include_once(G5_THEME_PATH . '/tail.php');
