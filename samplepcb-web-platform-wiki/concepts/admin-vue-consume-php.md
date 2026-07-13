---
concept: 관리=sp-vue / 소비=sp-php (공유 DB 브릿지)
last_compiled: 2026-07-13
topics_connected: [sp-vue-web, sp-node-api, theme-sp-lite, spcb-bridge]
status: active
---

# 관리=sp-vue / 소비=sp-php (공유 DB 브릿지)

## Pattern
콘텐츠·설정의 **관리(쓰기) UI는 sp-vue(/app/admin)+sp-node API**에, **사용자 노출(읽기)은 sp-php(테마 include 또는 spcb 브릿지 페이지)의 read-only 직접 `sql_query`**에 두고, 둘을 같은 DB 테이블(g5_* 또는 sp_*)로만 잇는 패턴. 코어·.htaccess 무수정 + 테마 include 1지점 + 조회 실패 시 `die` 금지(조용한 폴백) 조합이 반복 요소다. PHP→Node HTTP 호출이 없으므로 런타임 결합이 없고, 대신 테이블 스키마가 두 세계의 계약이 된다.

## Instances
- **2026-07-10~12** in [sp-vue-web](../topics/sp-vue-web.md) / [theme-sp-lite](../topics/theme-sp-lite.md): **SEO 관리** — sp_seo를 AdminSeo에서 upsert/DELETE, 테마 `inc/seo_head.php`(head.sub.php 전역변수 매칭, $it 자동유도 기본·레코드는 오버라이드)가 소비. 정본 docs/SEO_MANAGEMENT.md 옵션 B
- **2026-07-09~10** in [sp-node-api](../topics/sp-node-api.md) / [theme-sp-lite](../topics/theme-sp-lite.md) / [spcb-bridge](../topics/spcb-bridge.md): **별점 후기** — sp_review를 sp-node가 관리, 홈 `inc/main_reviews.php`+`/reviews`(spcb/pages/reviews.php)가 isConfirm=1 게이트·마스킹으로 read-only 소비
- **2026-07-09** in [sp-vue-web](../topics/sp-vue-web.md) / [theme-sp-lite](../topics/theme-sp-lite.md): **메인 슬라이드** — g5_shop_banner('메인')를 AdminSlides(multipart CRUD+정렬)가 관리, 테마 `inc/main_slider.php`가 직접 쿼리+owl 렌더. 영카트 배너관리와 같은 테이블 공유(패턴 원형)

## What This Means
"PHP 화면에 새 관리형 콘텐츠를 띄워야 한다"는 요구가 오면 기본 답이 정해져 있다: 관리 화면은 sp-vue에, 노출은 테마 include 한 지점에 read-only SELECT로. PHP에서 관리 화면을 만들거나(코어 수정 유혹), Node를 HTTP로 호출하는(런타임 결합) 선택지는 이 코드베이스에서 세 번 연속 기각됐다. 대가는 스키마 드리프트 위험 — 테이블 구조를 바꾸면 소비측 PHP 쿼리를 수동으로 따라 고쳐야 하며, 이는 [[manual-sync-drift]]의 새 동기화 지점이다. 소비측은 절대 die 하지 않게 방어해 관리측 장애가 사용자 페이지를 죽이지 않게 한다.

## Sources
- [sp-vue-web](../topics/sp-vue-web.md)
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
