<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * 메인 슬라이드 배너 (커뮤니티 홈 전용 브릿지)
 * ------------------------------------------------------------------
 * 영카트 "배너관리"(관리자 > 쇼핑몰현황/기타 > 배너관리, 위치='메인')에
 * 등록한 배너를 커뮤니티 홈(theme/sp-lite/index.php) 최상단에 풀너비 슬라이드로 출력한다.
 *
 * 왜 브릿지가 필요한가:
 *   - 쇼핑몰 홈(shop/index.php)은 display_banner('메인', ...) 로 배너를 그린다.
 *   - 그러나 커뮤니티 홈은 shop.lib.php 를 로드하지 않아 display_banner() 가 정의되지 않는다.
 *   - 그래서 g5_shop_banner 를 직접 조회하고, shop 전용 상수(G5_SHOP_*) 없이 owlCarousel 로 렌더한다.
 *   - 데이터/이미지 관리는 전적으로 기존 "배너관리" 화면을 재사용한다(추가 관리 UI 없음).
 */

$sp_slider_sql = " select * from {$g5['g5_shop_banner_table']}
                    where '" . G5_TIME_YMDHIS . "' between bn_begin_time and bn_end_time
                      and ( bn_device = 'both' or bn_device = 'pc' )
                      and bn_position = '메인'
                    order by bn_order, bn_id desc ";
$sp_slider_res = sql_query($sp_slider_sql);

// 실이미지가 존재하는 배너만 슬라이드로 채택
$sp_slides = array();
while ($sp_row = sql_fetch_array($sp_slider_res)) {
    $sp_bimg = G5_DATA_PATH . '/banner/' . $sp_row['bn_id'];
    if (!file_exists($sp_bimg)) continue;
    $sp_size = @getimagesize($sp_bimg);
    if (!$sp_size || $sp_size[2] < 1 || $sp_size[2] > 16) continue; // 이미지 타입 검증
    $sp_slides[] = $sp_row;
}

if (count($sp_slides) > 0):
    // owlCarousel 자산 — jQuery 는 그누보드 head 에서 이미 로드됨. body 상단에서 직접 로드.
?>
<link rel="stylesheet" href="<?php echo G5_JS_URL; ?>/owlcarousel/owl.carousel.min.css">
<script src="<?php echo G5_JS_URL; ?>/owlcarousel/owl.carousel.min.js"></script>
<style>
/* 메인 슬라이드 — 컨테이너(--sp-container:1320px)를 뚫는 풀너비(full-bleed) */
.sp-main-slider{position:relative;width:100vw;margin-left:calc(50% - 50vw);margin-top:-28px;margin-bottom:28px;background:#eef1f4;overflow:hidden}
.sp-main-slider .owl-carousel .item{display:block;line-height:0}
.sp-main-slider .owl-carousel .item a{display:block}
.sp-main-slider .owl-carousel .item img{display:block;width:100%;height:auto;margin:0 auto}
/* 좌우 내비 */
.sp-main-slider .owl-nav{margin:0}
.sp-main-slider .owl-nav button.owl-prev,
.sp-main-slider .owl-nav button.owl-next{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.32);color:#fff;font-size:22px;line-height:46px;text-align:center;transition:background .2s}
.sp-main-slider .owl-nav button.owl-prev{left:24px}
.sp-main-slider .owl-nav button.owl-next{right:24px}
.sp-main-slider .owl-nav button.owl-prev:hover,
.sp-main-slider .owl-nav button.owl-next:hover{background:rgba(0,0,0,.6)}
.sp-main-slider .owl-nav button.owl-prev.disabled,
.sp-main-slider .owl-nav button.owl-next.disabled{opacity:0;pointer-events:none}
/* 하단 도트 */
.sp-main-slider .owl-dots{position:absolute;left:0;right:0;bottom:18px;text-align:center;line-height:0}
.sp-main-slider .owl-dots .owl-dot{display:inline-block}
.sp-main-slider .owl-dots .owl-dot span{display:block;width:10px;height:10px;margin:0 5px;border-radius:50%;background:rgba(255,255,255,.55);transition:all .2s}
.sp-main-slider .owl-dots .owl-dot.active span{width:26px;border-radius:6px;background:#fff}
@media (max-width:768px){
  .sp-main-slider{margin-top:-20px;margin-bottom:20px}
  .sp-main-slider .owl-nav button.owl-prev,
  .sp-main-slider .owl-nav button.owl-next{width:36px;height:36px;line-height:34px;font-size:18px}
  .sp-main-slider .owl-nav button.owl-prev{left:8px}
  .sp-main-slider .owl-nav button.owl-next{right:8px}
  .sp-main-slider .owl-dots{bottom:10px}
}
</style>
<div class="sp-main-slider">
    <div class="owl-carousel sp-main-owl">
        <?php foreach ($sp_slides as $sp_row):
            $sp_new_win = $sp_row['bn_new_win'] ? ' target="_blank" rel="noopener"' : '';
            $sp_alt     = get_text($sp_row['bn_alt']);
            $sp_ver     = preg_replace('/[^0-9]/', '', $sp_row['bn_time']); // 이미지 캐시버스팅
            $sp_img     = '<img src="' . G5_DATA_URL . '/banner/' . $sp_row['bn_id'] . '?' . $sp_ver . '" alt="' . $sp_alt . '">';
            $sp_url     = trim($sp_row['bn_url']);
            $sp_has_url = ($sp_url !== '' && $sp_url !== 'http://' && $sp_url !== 'https://');
        ?>
        <div class="item">
            <?php if ($sp_has_url): ?>
            <a href="<?php echo $sp_url; ?>"<?php echo $sp_new_win; ?>><?php echo $sp_img; ?></a>
            <?php else: ?>
            <?php echo $sp_img; ?>
            <?php endif; ?>
        </div>
        <?php endforeach; ?>
    </div>
</div>
<script>
jQuery(function ($) {
    $('.sp-main-owl').owlCarousel({
        items: 1,
        loop: <?php echo count($sp_slides) > 1 ? 'true' : 'false'; ?>,
        margin: 0,
        nav: true,
        dots: true,
        autoHeight: true,
        autoplay: true,
        autoplayTimeout: 5000,
        autoplayHoverPause: true,
        navText: ['❮', '❯']
    });
});
</script>
<?php endif; // count($sp_slides) > 0 ?>
