---
topic: theme-sp-lite
last_compiled: 2026-07-13
sources_count: 24
status: active
---

# theme-sp-lite

## Purpose [coverage: high — 6 sources]

`samplepcb-web/theme/sp-lite/` 는 그누보드5/영카트의 **코어 비수정 오버라이드 지점**인 커스텀 테마다. 코어는 subtree 로 들어와 있어 손대지 않고(AGENTS.md "코어 비수정 원칙"), 화면 표현·마크업이 필요한 커스텀은 전부 이 테마 안에서 해결한다. `readme.txt` 기준 "베이직(basic) 기반 PC 전용 경량 테마" — `theme.config.php` 에서 `G5_THEME_DEVICE='pc'` 로 고정해 **모든 기기가 이 테마 하나를 쓰고 반응형은 CSS 로 처리**한다(모바일 테마 이원화 제거 — 단, mobile/skin/shop 은 코어 요구로 존재해야 함, Gotchas 참조).

역할이 두 축으로 확장됐다:
1. **거버 주문 플로우의 표현 계층** — "코어 무수정 기법 카탈로그"(docs/GERBER_ORDER_FLOW.md 4장) 기법 #8 테마 cart 스킨 분기. 견적 행에서 [선택사항수정] 팝업의 선형 곱 버그를 표현 계층에서 차단.
2. **sp-vue 관리 ↔ sp-php 소비 브릿지의 소비측** — `inc/` 브릿지 파일들(main_slider·main_reviews·seo_head)이 공유 DB(`g5_shop_banner`·`sp_review`·`sp_seo`)를 read-only 직접 조회해 SSR 로 출력한다. 관리 UI 는 sp-vue `/app/admin`.

## Architecture [coverage: high — 8 sources]

```
theme/sp-lite/
  theme.config.php        G5_THEME_DEVICE='pc' · G5_COMMUNITY_USE · 기본 스킨 매핑($theme_config)
  head.php / tail.php     커뮤니티 레이아웃 (G5_COMMUNITY_USE=false 면 shop.head 로 위임)
  head.sub.php            <head> 공통 — <title> 직전에 inc/seo_head.php include (SEO 브릿지 진입점)
  index.php               커뮤니티 홈(/) — main_slider → main_reviews 쇼케이스 → notice|qa|faq 3단 그리드
  inc/header.php          공용 헤더 — 견적관리·장바구니 유틸 아이콘(+뱃지) · 관리자 링크 super 게이팅
  inc/footer.php
  inc/quicklinks.php      미배치 링크 임시 플로팅 패널(소거식) — '게시판' 그룹·/reviews 진입점 포함
  inc/main_slider.php     홈 메인 슬라이드 브릿지 — g5_shop_banner('메인') 직접 쿼리 + owl 풀너비
  inc/main_reviews.php    홈 별점후기 쇼케이스 — sp_review(isConfirm=1) 최신 8건 카드 그리드
  inc/reviews_lib.php     후기 공용 헬퍼(sp_review_mask/name/body/stars/text) — reviews.php와 공유
  inc/seo_head.php        SEO 메타 브릿지 P1 — sp_seo 전역변수 매칭·1쿼리·폴백 병합
  css/default.css         기본 스타일
  css/default_shop.css    쇼핑몰 덧입힘 스타일 — 장바구니·견적관리·주문내역 카드 문법
  js/theme.shop.list.js
  shop/                   영카트 페이지 오버라이드
    shop.head.php / shop.tail.php / _common.php
    _account_nav.php      계정 사이드바 SSOT (마이페이지·주문내역·장바구니·견적관리 / 위시는 토글 게이트)
    cart.php              장바구니 스킨 오버라이드 (견적 행 분기 — 이 테마의 핵심 커스텀)
    orderinquiry.sub.php  주문내역 목록 (표↔카드 반응형)
    index.php · category.php · mypage.php · orderinquiryview.php · ajax.action.php · coupon.php
  skin/                   board(basic·gallery)·member·faq·latest·connect·content 스킨
    latest/home/          홈 3단 게시판 그리드 전용 최신글 스킨
    shop/basic/           PC shop 스킨 (위시 하트 SP_USE_WISHLIST 게이트)
  mobile/skin/shop/basic/ 모바일 shop 스킨 — PC 스킨 복사본 (코어 readdir Fatal 방지용, Gotchas)
  img/                    로고·버튼·회사소개 이미지
```

오버라이드 메커니즘: 코어 `shop/cart.php` 가 `G5_THEME_SHOP_PATH.'/cart.php'` 존재 시 include 후 return 하는 표준 훅을 이용한다(코어 `samplepcb-web/shop/cart.php:31-32`). 테마 cart 진입 시점에 `$s_cart_id`·`$cart_action_url`·`$naverpay_button_js` 가 준비되어 있고 `before_check_cart_price` 도 이미 실행된 상태다. 기능 훅(form 이름 `frmcartlist`·`ct_chk`·`mod_options`·`#mod_option_frm`·`form_check`)은 코어와 동일하게 유지해 코어 JS(`shop.js`)·`cartupdate.php` 와의 계약을 깨지 않는다.

**inc/ 브릿지 패턴** (슬라이더에서 확립 → 후기·SEO 로 재사용): 코어·`.htaccess` 무수정, 테마 include 지점 1곳 + `sql_query` 직접 조회(read-only). `spcb/pages/reviews.php`(공개 `/reviews`)도 동형 브릿지로, 테마의 `inc/reviews_lib.php` 헬퍼를 공유한다.

**SEO 브릿지(inc/seo_head.php)** 는 URL 파싱이 아니라 **"스크립트 basename + 페이지 전역변수" 매칭**(SEO_MANAGEMENT.md 옵션 B): PHP include 스코프 상속으로 `$it`/`$bo_table` 이 해석된 값으로 보이는 것을 이용해 `item.php`+`$it['it_id']`→scope=item, `$bo_table`→board, 기타 basename→page, 그 외→global 로 판별한다. 엔티티+global 을 **1쿼리** 로 조회(`sql_query($sql, false)` — 실패해도 페이지 유지)하고, 폴백 순서는 엔티티 오버라이드 → 전역 기본 → 자동 유도($it) → 코어 `$g5_head_title`.

## Talks To [coverage: high — 7 sources]

- **영카트 코어**: cart 폼은 코어 `cartupdate.php` 로 그대로 제출(buy/seldelete/alldelete). 옵션수정 팝업은 코어 `cartoption.php` POST. 배송비·옵션 표기는 코어 lib(`get_sendcost`·`print_item_options` 등) 호출. 홈 3단 그리드는 코어 `latest()` 재사용.
- **공유 DB 직접 조회 (read-only)**: `inc/main_slider.php`→`g5_shop_banner`('메인' 위치), `inc/main_reviews.php`→`sp_review`(isConfirm=1), `inc/seo_head.php`→`sp_seo`. 셋 다 관리측은 sp-vue(`/app/admin/slides`·`/app/admin/seo`, 별점후기 관리는 후속)이며 테마는 소비만 한다.
- **extend/**: `extend/default.config.php` 의 `SP_USE_WISHLIST` 상수(그누보드 `common.php` extend 자동로드) — 테마 스킨 6곳이 이 토글로 위시 진입점을 게이트.
- **spcb 브리지 / sp-node**: cart.php 하단 JS 가 `GET /spcb/api/me`(세션→JWT) → `GET /api/pcb-projects/cart-thumbs`(Bearer JWT) 로 견적 카드의 템플릿 썸네일을 **대표 거버 썸네일로 교체**한다. 실패하면 템플릿 이미지 유지(무해한 강화).
- **견적관리 페이지(`spcb/pages/quotes.php`, `/shop/quotes`)**: 견적 행의 상품 링크·"수량 변경은 견적관리에서" 링크·빈 장바구니 안내가 전부 이곳을 가리킨다. 삭제 안내는 `/shop/quotes/archive`. 위시리스트 숨김으로 "저장→나중에 주문" 역할도 이곳으로 일원화.
- **`/reviews` 공개 페이지(`spcb/pages/reviews.php`)**: 테마 `inc/reviews_lib.php` 헬퍼(마스킹·새니타이즈·별점)를 공유. 진입점은 홈 쇼케이스 MORE + quicklinks.
- **헤더(inc/header.php)**: 견적관리 아이콘(`.sp-util__quotes` → `/shop/quotes`, 뱃지)·장바구니 아이콘(`.sp-util__cart`, `get_boxcart_datas_count()` 뱃지). GNB 는 `get_menu_db()` DB 메뉴. 관리자 링크는 super(cf_admin)만 노출 — "관리자"→`/app/admin`, "시스템 관리자"→`/adm`.

## API Surface [coverage: medium — 4 sources]

테마라 API 는 없지만 외부에서 의존하는 계약면:

- **코어 훅 계약**: `G5_THEME_SHOP_PATH/cart.php` 존재 → 코어가 include 후 return. 폼 필드명(`ct_chk[]`·`it_id[]`·`act`·`records`)과 `form_check(act)` 시그니처는 코어 호환 필수.
- **sp-node 호출**: `GET /api/pcb-projects/cart-thumbs` — 응답 `data.thumbs` 가 `{ it_id: 썸네일URL }` 맵.
- **DOM 마킹**: 견적 카드 썸네일 앵커에 `data-itid` 속성 — 하단 JS 의 교체 대상 셀렉터(`.sp-cart-thumb[data-itid]`).
- **CSS 계층**: `default_shop.css` 는 `default.css` 위에 덧입혀지며, `/shop/quotes`·주문내역(`#sod_v`/`#sod_fin` 스코프·상태배지 `status_01~06`)도 이 파일의 `.sp-cart-*` 카드 문법을 공유한다. 링크 CSS 는 `?ver=G5_CSS_VER` 캐시버스팅(Gotchas).
- **토글 계약**: 위시 게이트 표현식은 `defined('SP_USE_WISHLIST') && SP_USE_WISHLIST` — 상수 미정의(로드 실패) 시 **숨김 쪽으로 안전 폴백**.

## Data [coverage: medium — 4 sources]

- 테마 자체는 상태를 소유하지 않는다 — cart.php 는 코어와 동일한 쿼리로 `g5_shop_cart`(`od_id = ss_cart_id`) 를 읽어 표시만 한다. 합계식도 코어 표준: `SUM(IF(io_type=1, io_price*ct_qty, (ct_price+io_price)*ct_qty))`.
- **견적 행 식별 데이터**: `$sp_quote_it_ids = array('sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex')` — 템플릿 상품 4종의 it_id 하드코딩 목록(cart.php). 견적 행은 `ct_qty=1` 고정, 견적가는 `io_price`(옵션가)에 **총액**으로 실림, 실수량은 `ct_option` 사양 요약에만 존재 → 카드 수치는 "견적 N건" 표기.
- **브릿지 소비 데이터**: `g5_shop_banner`(슬라이드, 이미지는 `data/banner/{bn_id}`), `sp_review`(별점후기 — `g5_shop_item_use` 이관본, 노출 게이트 `isConfirm=1`), `sp_seo`(scope+refKey unique, Prisma 소유).
- 위시리스트 데이터(`g5_shop_wish`)는 **그대로 보존** — 진입점만 숨김이라 테이블·코어 코드 무변경.

## Key Decisions [coverage: high — 8 sources]

- **2026-07-10 — SEO head 브릿지 = 옵션 B (테마 head.sub.php 1파일 + 전역변수 매칭)** ([SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md), 독립 검토 회수). URL 파싱 기각 — 상품 URL 이 rewrite 로 `it_seo_title` 만 갖고 들어와 `$_GET['it_id']` 가 깨지므로 item.php 가 정규화한 `$it['it_id']` 를 쓴다. 코어 훅 `html_process_add_meta` 는 `<title>` 텍스트를 못 바꿔 예비로만. `cf_add_meta` 는 소유권/검증 태그 전용으로 못박음(이중출력 방지). `sp_seo` 는 유일 소스가 아님 — 상품은 `$it` 자동 유도가 기본, 레코드는 오버라이드.
- **2026-07-10 — 홈 메인 정리: 슬라이더 → 별점후기 쇼케이스 → notice|qa|faq 3단 그리드** (라이브 리뉴얼 디자인의 sp-php 이관). "사용후기" 축은 **별점후기(`sp_review`) 쇼케이스로 확정**(레거시 `review` 게시판 아님). 신규 홈 전용 최신글 스킨 `skin/latest/home/`. CSS 는 index.php 인라인이라 캐시버스팅 불필요.
- **2026-07-10 — 게시판 `review` 명칭 "사용후기"→"고객후기"** ([review-naming.md](../../docs/review-naming.md)) — `g5_board.bo_subject` DB 데이터 1건 수정, 테마에 `bo_table=review` 하드코딩 0건이라 코드 무변경. 별점후기(`sp_review`)와의 명칭 충돌 해소. **운영 DB 수동 반영 필요**(코드 배포로 안 넘어감).
- **2026-07-10 — `/reviews` 공개 페이지 + 공용 헬퍼 추출** — `sp_review` 직접 조회 신규 페이지(표준 itemuselist 는 구조적 표시 불가), 마스킹·XSS 새니타이즈 헬퍼를 `inc/reviews_lib.php` 로 분리해 페이지·홈 쇼케이스가 공유.
- **2026-07-09 — 홈 메인 슬라이드 브릿지(inc/main_slider.php)** — 홈이 커뮤니티 레이아웃(G5_COMMUNITY_USE=true)이라 shop 의 `display_banner()` 가 없어, `g5_shop_banner`('메인') 직접 쿼리 브릿지 신설. 관리는 sp-vue `/app/admin/slides`(영카트 배너관리와 동일 테이블 공유).
- **2026-07-06 — 위시리스트 "삭제 아닌 숨김"(SP_USE_WISHLIST, 기본 false)** ([wishlist-hidden.md](../../docs/wishlist-hidden.md)) — 위시는 카탈로그 `it_id` 북마크라 견적(사양은 `ct_id`/`sp_order_spec`) 모델과 구조적으로 비호환(위시→장바구니가 거버·사양 바인딩 0 인 껍데기). 진입점 6곳(계정 사이드바 SSOT·quicklinks·마이페이지·상세 하트 PC/모바일·목록 하트 ×4)만 게이트, 코어 코드·DB 는 보존(일반 카탈로그 생기면 복귀 or 템플릿 4종만 제외하는 부분 노출 옵션 B).
- **2026-07-06 — 계정 사이드바 SSOT(`shop/_account_nav.php`) + 헤더 뱃지 정합** — 마이페이지·주문내역·장바구니·견적관리 사이드바 공유, 견적관리 뱃지 신설. 쇼핑몰 컨테이너 폭 1200→1320.
- **2026-07-04~05 — 주문 3형제(orderform·orderinquiry·orderinquiryview) 전 기기 pc 파일 통일 + 장바구니 시각문법 재현** — `G5_IS_MOBILE`(sp-lite 에선 항상 false) 기준, 반응형은 `default_shop.css` 스코프 CSS·상태배지 시스템.
- **표현은 테마, 데이터는 sp-node** (2026-07 초 확립): cart 의 조회·계산은 코어와 동일하게 두고 표현 분기만 테마에서 한다(기법 #8 — [선택사항수정] 숨김·"견적 N건"·상품 링크→`/shop/quotes`·보관함 안내). 코어 cart.php 는 "한 줄도 안 고쳤다".
- **quicklinks.php 는 임시 인벤토리(소거식)** — 미배치 링크를 플로팅 패널에 모아두고 정식 배치 시 배열에서 제거. 현재 '게시판' 그룹(고객후기·자료실 등)과 `/reviews` 링크 포함.

## Gotchas [coverage: high — 8 sources]

- **[선택사항수정] 선형 곱 버그는 테마 분기로 "차단"했을 뿐, 코어 팝업 경로는 여전히 위험하다.** 견적 행은 io_price 가 총액이라 코어 cartoption 팝업의 `io_price × 수량` 재계산이 잘못된 선형 곱(+스냅샷 리셋)이 된다. URL 직접 호출로 팝업에 도달하면 버그 재현. 수량 변경의 정식 경로는 견적관리의 서버 재견적(PATCH)뿐.
- **`mobile/skin/shop` 은 지워도 되는 잔재가 아니다.** sp-lite 가 PC 전용이어도 코어 관리자(쇼핑몰설정 결제설정 등)가 테마의 mobile shop 스킨 디렉토리를 `readdir` 하는데, 폴더가 없으면 PHP8 Fatal 로 설정 화면이 안 뜬다 — PC 스킨 복사로 해소(커밋 dd25c3871). 프런트는 `G5_THEME_DEVICE='pc'`→`G5_IS_MOBILE=false` 라 이 스킨을 타지 않는다(SEO 모바일 head 걱정도 같은 이유로 불필요).
- **CSS 캐시버스팅**: 링크 CSS 는 `?ver=G5_CSS_VER` 고정 — CSS 수정 후 `extend/version.extend.php` 의 `G5_CSS_VER` 를 안 올리면 옛 파일이 캐시돼 "적용 안 됨"으로 보인다. 스킨 PHP·인라인 `<style>` 은 무관.
- **seo_head 는 전 페이지 경유 코드다** — `sql_query($sql, false)` 로 die 를 막았지만, 수정 시에도 이 방어(조회 실패 ≠ 페이지 사망)를 유지해야 한다. description·OG 를 `cf_add_meta` 에 넣으면 이중출력 — 반드시 sp_seo 경로로만.
- **템플릿 4종 it_id 목록은 수동 동기화다.** cart.php 의 `$sp_quote_it_ids` 는 sp-node `lib/g5-db.ts` 의 `TEMPLATE_ITEMS` 와 값이 같아야 한다 — 자동 공유 메커니즘 없음, 템플릿 상품 추가 시 양쪽을 함께 수정.
- **위시리스트는 직접 URL 로는 여전히 동작한다** — `wishlist.php`/`wishupdate.php`/lib 함수는 순정 보존, UI 진입점만 사라진 상태. `SP_USE_WISHLIST=true` 한 줄로 전체 복귀(스킨은 서버 렌더라 G5_CSS_VER 갱신 불필요).
- **/reviews 답변 마스킹 한계**: 관리자 답변 본문의 실명 마스킹은 작성자 본인 이름만 커버 — 답변이 제3자 이름을 부르면 미커버. 신규 작성/관리 기능 도입 시 정책 재점검.
- **견적 행 삭제는 즉시 반영이 아니다.** 코어 cartupdate 는 cart 행만 지우고, sp-node 가 목록 조회 시점 lazy reconcile 로 status='deleted' 전환 — 카드에 "삭제 시 지난 견적 보관함으로 이동" 안내를 미리 표기하는 이유.
- **썸네일 교체는 it_id 단위 근사치**: cart 가 `GROUP BY it_id` 집계라 같은 템플릿 견적 여러 건이어도 카드 하나·썸네일 하나(첫 담김 견적 기준).
- 기능 훅(form/필드/함수명)은 코어 JS·cartupdate 와의 계약 — 테마 리팩터링 시 이름 변경 금지. `shop.head.php` 의 owl carousel 로드는 shop 스킨 잔재(Swiper 교체 예정 주석).
- (인접) 주문 알림 체크박스 게이트는 sp-vue 영역이지만 코어 패리티 이탈 결정이 문서화돼 있다 — 코어 주문 **목록**(orderlist)의 무조건 노출은 결함으로 판단, sp-vue 는 목록·상세 모두 설정 게이트([order-notify-gating.md](../../docs/order-notify-gating.md)).

## Sources [coverage: high — 24 sources]

- [theme/sp-lite/shop/cart.php](../../samplepcb-web/theme/sp-lite/shop/cart.php) — 장바구니 스킨 오버라이드 전문 (견적 행 분기·썸네일 교체 JS)
- [theme/sp-lite/inc/header.php](../../samplepcb-web/theme/sp-lite/inc/header.php) — 공용 헤더 (견적관리·장바구니 아이콘·관리자 링크 게이팅)
- [theme/sp-lite/inc/seo_head.php](../../samplepcb-web/theme/sp-lite/inc/seo_head.php) — SEO 메타 브릿지 P1 (sp_seo 전역변수 매칭)
- [theme/sp-lite/inc/main_slider.php](../../samplepcb-web/theme/sp-lite/inc/main_slider.php) — 홈 메인 슬라이드 브릿지 (g5_shop_banner)
- [theme/sp-lite/inc/main_reviews.php](../../samplepcb-web/theme/sp-lite/inc/main_reviews.php) — 홈 별점후기 쇼케이스 (sp_review)
- [theme/sp-lite/inc/reviews_lib.php](../../samplepcb-web/theme/sp-lite/inc/reviews_lib.php) — 후기 공용 헬퍼 (마스킹·새니타이즈·별점)
- [theme/sp-lite/inc/quicklinks.php](../../samplepcb-web/theme/sp-lite/inc/quicklinks.php) — 미배치 링크 임시 패널 (소거식)
- [theme/sp-lite/index.php](../../samplepcb-web/theme/sp-lite/index.php) — 커뮤니티 홈 (슬라이더·쇼케이스·3단 그리드)
- [theme/sp-lite/head.sub.php](../../samplepcb-web/theme/sp-lite/head.sub.php) — <head> 공통 (seo_head include 지점)
- [theme/sp-lite/theme.config.php](../../samplepcb-web/theme/sp-lite/theme.config.php) — G5_THEME_DEVICE='pc'·스킨 매핑
- [theme/sp-lite/shop/_account_nav.php](../../samplepcb-web/theme/sp-lite/shop/_account_nav.php) — 계정 사이드바 SSOT
- [theme/sp-lite/shop/shop.head.php](../../samplepcb-web/theme/sp-lite/shop/shop.head.php) — 쇼핑몰 레이아웃 진입
- [theme/sp-lite/mobile/skin/shop/basic/](../../samplepcb-web/theme/sp-lite/mobile/skin/shop/basic) — 모바일 shop 스킨 (코어 readdir Fatal 방지)
- [theme/sp-lite/css/default_shop.css](../../samplepcb-web/theme/sp-lite/css/default_shop.css) — 장바구니·견적관리·주문내역 공용 카드 문법
- [theme/sp-lite/readme.txt](../../samplepcb-web/theme/sp-lite/readme.txt) — 테마 메타
- [extend/default.config.php](../../samplepcb-web/extend/default.config.php) — SP_USE_WISHLIST 토글 정의
- [shop/cart.php (코어)](../../samplepcb-web/shop/cart.php) — G5_THEME_SHOP_PATH 오버라이드 훅
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 기법 #8 테마 스킨 분기·파일 색인
- [docs/wishlist-hidden.md](../../docs/wishlist-hidden.md) — 위시리스트 숨김 결정 기록
- [docs/review-naming.md](../../docs/review-naming.md) — 후기 명칭 정리·/reviews·홈 쇼케이스
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) — SEO 관리 설계 정본 (옵션 B)
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 주문 알림 게이트 (인접 결정)
- [AGENTS.md](../../AGENTS.md) — 코어 비수정 원칙·테마 네이밍 규약
- [apps/api/src/lib/g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — TEMPLATE_ITEMS (it_id 수동 동기화 대상)
