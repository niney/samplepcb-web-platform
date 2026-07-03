---
topic: theme-sp-lite
last_compiled: 2026-07-03
sources_count: 12
status: active
---

# theme-sp-lite

## Purpose [coverage: high — 5 sources]

`samplepcb-web/theme/sp-lite/` 는 그누보드5/영카트의 **코어 비수정 오버라이드 지점**인 커스텀 테마다. 코어는 subtree 로 들어와 있어 손대지 않고(AGENTS.md "코어 비수정 원칙"), 화면 표현·마크업이 필요한 커스텀은 전부 이 테마 안에서 해결한다. `readme.txt` 기준 "베이직(basic) 기반 PC 전용 경량 테마" — `theme.config.php` 에서 `G5_THEME_DEVICE='pc'` 로 고정해 **모든 기기가 이 테마 하나를 쓰고 반응형은 CSS 로 처리**한다(모바일 테마/스킨 불필요).

거버 주문 플로우 관점에서는 "코어 무수정 기법 카탈로그"(docs/GERBER_ORDER_FLOW.md 4장)의 **기법 #8 — 테마 cart 스킨 분기**가 이 테마의 핵심 역할이다: 견적 행에서 [선택사항수정] 팝업의 선형 곱 버그를 표현 계층에서 차단한다.

## Architecture [coverage: high — 6 sources]

```
theme/sp-lite/
  theme.config.php        G5_THEME_DEVICE='pc' · G5_COMMUNITY_USE · 기본 스킨 매핑($theme_config)
  head.php / tail.php     커뮤니티 레이아웃 (G5_COMMUNITY_USE=false 면 shop.head 로 위임)
  head.sub.php            <head> 공통
  inc/header.php          공용 헤더 — 커뮤니티·쇼핑몰 양쪽에서 include (로고·GNB·유틸 아이콘)
  inc/footer.php, inc/quicklinks.php (미배치 링크 임시 플로팅 패널 — 정식 배치되면 제거)
  css/default.css         기본 스타일 (477줄)
  css/default_shop.css    쇼핑몰 덧입힘 스타일 (831줄) — 장바구니·견적관리 카드 문법
  js/theme.shop.list.js
  shop/                   영카트 페이지 오버라이드
    shop.head.php / shop.tail.php / _common.php
    cart.php              장바구니 스킨 오버라이드 (견적 행 분기 — 이 테마의 핵심 커스텀)
    index.php · category.php · mypage.php · orderinquiryview.php · ajax.action.php
  skin/                   board(basic·gallery)·member·faq·latest·connect·content 스킨
  img/                    로고·버튼·회사소개 이미지
```

오버라이드 메커니즘: 코어 `shop/cart.php` 가 `G5_THEME_SHOP_PATH.'/cart.php'` 존재 시 include 후 return 하는 표준 훅을 이용한다(코어 `samplepcb-web/shop/cart.php:31-32`). 테마 cart 진입 시점에 `$s_cart_id`·`$cart_action_url`·`$naverpay_button_js` 가 준비되어 있고 `before_check_cart_price` 도 이미 실행된 상태다. 기능 훅(form 이름 `frmcartlist`·`ct_chk`·`mod_options`·`#mod_option_frm`·`form_check`)은 코어와 동일하게 유지해 코어 JS(`shop.js`)·`cartupdate.php` 와의 계약을 깨지 않는다.

## Talks To [coverage: high — 5 sources]

- **영카트 코어**: cart 폼은 코어 `cartupdate.php` 로 그대로 제출(buy/seldelete/alldelete). 옵션수정 팝업은 코어 `cartoption.php` POST. 배송비·옵션 표기는 코어 lib(`get_sendcost`·`print_item_options` 등) 호출.
- **spcb 브리지 / sp-node**: cart.php 하단 JS 가 `GET /spcb/api/me`(세션→JWT) → `GET /api/pcb-projects/cart-thumbs`(Bearer JWT) 로 견적 카드의 템플릿 썸네일을 **대표 거버 썸네일로 교체**한다. 실패하면 템플릿 이미지 유지(무해한 강화).
- **견적관리 페이지(`spcb/pages/quotes.php`, `/shop/quotes`)**: 견적 행의 상품 링크·"수량 변경은 견적관리에서" 링크·빈 장바구니 안내가 전부 이곳을 가리킨다. 삭제 안내는 `/shop/quotes/archive`(지난 견적 보관함).
- **헤더(inc/header.php)**: 유틸 영역에 **견적관리 아이콘**(`.sp-util__quotes`, fa-file-text-o → `/shop/quotes`)과 장바구니 아이콘(`.sp-util__cart`, `get_boxcart_datas_count()` 뱃지)을 나란히 배치. GNB 는 `get_menu_db()` DB 메뉴.

## API Surface [coverage: medium — 3 sources]

테마라 API 는 없지만 외부에서 의존하는 계약면:

- **코어 훅 계약**: `G5_THEME_SHOP_PATH/cart.php` 존재 → 코어가 include 후 return. 폼 필드명(`ct_chk[]`·`it_id[]`·`act`·`records`)과 `form_check(act)` 시그니처는 코어 호환 필수.
- **sp-node 호출**: `GET /api/pcb-projects/cart-thumbs` — 응답 `data.thumbs` 가 `{ it_id: 썸네일URL }` 맵. cart 는 `GROUP BY it_id` 집계 카드라 sp-node 가 it_id 별 "첫 담김 견적"의 썸네일을 내려준다.
- **DOM 마킹**: 견적 카드 썸네일 앵커에 `data-itid` 속성 — 하단 JS 의 교체 대상 셀렉터(`.sp-cart-thumb[data-itid]`).
- **CSS 계층**: `default_shop.css` 는 `default.css` 위에 덧입혀지며, `/shop/quotes` 페이지도 이 파일의 `.sp-cart-*` 카드 문법(카드 목록·주문요약·상태배지·영구삭제 모달)을 공유한다.

## Data [coverage: medium — 3 sources]

- 테마 자체는 상태를 소유하지 않는다 — cart.php 는 코어와 동일한 쿼리로 `g5_shop_cart`(`od_id = ss_cart_id`) 를 읽어 표시만 한다. 합계식도 코어 표준: `SUM(IF(io_type=1, io_price*ct_qty, (ct_price+io_price)*ct_qty))`.
- **견적 행 식별 데이터**: `$sp_quote_it_ids = array('sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex')` — 템플릿 상품 4종의 it_id 하드코딩 목록(cart.php:16).
- 견적 행의 데이터 특성: `ct_qty=1` 고정, 견적가는 `io_price` (옵션가) 에 **총액**으로 실림(기법 #3), 실수량은 사양 요약(`ct_option`)에만 존재. 그래서 카드 수치는 "견적 N건" 으로 표기한다.

## Key Decisions [coverage: high — 5 sources]

- **표현은 테마, 데이터는 sp-node**: cart 의 조회·계산은 코어와 동일하게 두고 표현 분기만 테마에서 한다. 코어 cart.php 는 "한 줄도 안 고쳤다"(GERBER_ORDER_FLOW 3장 ④).
- **견적 행 분기 (기법 #8)**: 견적 행(`is_quote`)은 ① [선택사항수정] 버튼 숨김 → "수량 변경은 견적관리에서" 링크 대체, ② 수량 표기 "견적 N건", ③ 상품 링크를 상품상세 대신 `/shop/quotes` 로, ④ "삭제 시 지난 견적 보관함으로 이동" 안내 표기.
- **PC 단일 테마 + 반응형 CSS**: `G5_THEME_DEVICE='pc'` 로 모바일 테마 이원화를 제거. 헤더는 <1024px 햄버거 토글.
- **툴바 UX 통일**: cart 툴바 [선택삭제]/[비우기] + 전체선택 카운터(`#sp_sel_cnt`) — 견적관리 페이지가 이 문법을 그대로 따라간다(커밋 6682d834a).
- **빈 장바구니에도 경로 제공**: 견적 행을 지워 비워진 직후가 보관함을 찾는 순간이라, 빈 상태 화면에 견적관리·보관함 링크를 넣었다(보관함 링크는 `.sp-link-archive` 로 톤 낮춤).
- **quicklinks.php 는 임시 인벤토리**: 디자인 재작성 중 미배치 링크를 플로팅 패널에 모아두고, 정식 배치 시 배열에서 제거하는 소거식 운영.

## Gotchas [coverage: high — 5 sources]

- **[선택사항수정] 선형 곱 버그는 테마 분기로 "차단"했을 뿐, 코어 팝업 경로는 여전히 위험하다.** 코어 cartoption 팝업은 수량을 옵션표 `io_price × 수량` 으로 재계산하는데, 견적 행은 io_price 가 **총액**이라 총액×수량의 잘못된 선형 계산(+스냅샷 리셋)이 된다. 테마는 버튼을 숨겨 진입만 막은 것 — URL 직접 호출 등으로 팝업에 도달하면 버그는 그대로 재현된다. 수량 변경의 정식 경로는 견적관리의 서버 재견적(PATCH, 비선형 브래킷)뿐이다.
- **템플릿 4종 it_id 목록은 수동 동기화다.** cart.php 의 `$sp_quote_it_ids` 는 sp-node `lib/g5-db.ts` 의 `TEMPLATE_ITEMS`(standard→`sp-pcb-std`, metalmask→`sp-mask`, advance→`sp-pcb-adv`, flexible→`sp-pcb-flex`) 와 값이 같아야 한다 — 자동 공유 메커니즘이 없어 템플릿 상품 추가 시 **양쪽을 함께** 고쳐야 한다(cart.php:13 주석에 명시).
- **견적 행 삭제는 즉시 반영이 아니다.** 코어 cartupdate 는 cart 행만 지우고, sp-node 는 목록 조회 시점의 lazy reconcile 로 status='deleted' 전환 — 그래서 카드에 "삭제 시 지난 견적 보관함으로 이동" 안내를 미리 표기한다.
- **썸네일 교체는 it_id 단위 근사치**: cart 가 `GROUP BY it_id` 집계라 같은 템플릿의 견적이 여러 건이어도 카드 하나·썸네일 하나(첫 담김 견적 기준)다.
- 기능 훅(form/필드/함수명)은 코어 JS·cartupdate 와의 계약이므로 테마 리팩터링 시 이름을 바꾸면 안 된다.
- `shop.head.php` 의 owl carousel 로드는 쇼핑몰 메인 스킨 잔재 — shop 스킨 재작성 때 Swiper 교체 예정(주석 명시).

## Sources [coverage: high — 12 sources]

- [theme/sp-lite/shop/cart.php](../../samplepcb-web/theme/sp-lite/shop/cart.php) — 장바구니 스킨 오버라이드 전문 (견적 행 분기·썸네일 교체 JS)
- [theme/sp-lite/inc/header.php](../../samplepcb-web/theme/sp-lite/inc/header.php) — 공용 헤더 (견적관리·장바구니 아이콘)
- [theme/sp-lite/theme.config.php](../../samplepcb-web/theme/sp-lite/theme.config.php) — G5_THEME_DEVICE='pc'·스킨 매핑
- [theme/sp-lite/head.php](../../samplepcb-web/theme/sp-lite/head.php) — 커뮤니티 레이아웃 진입
- [theme/sp-lite/shop/shop.head.php](../../samplepcb-web/theme/sp-lite/shop/shop.head.php) — 쇼핑몰 레이아웃 진입
- [theme/sp-lite/css/default_shop.css](../../samplepcb-web/theme/sp-lite/css/default_shop.css) — 장바구니·견적관리 공용 카드 문법
- [theme/sp-lite/inc/quicklinks.php](../../samplepcb-web/theme/sp-lite/inc/quicklinks.php) — 미배치 링크 임시 패널
- [theme/sp-lite/readme.txt](../../samplepcb-web/theme/sp-lite/readme.txt) — 테마 메타
- [shop/cart.php (코어)](../../samplepcb-web/shop/cart.php) — G5_THEME_SHOP_PATH 오버라이드 훅
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 기법 #8 테마 스킨 분기·파일 색인
- [AGENTS.md](../../AGENTS.md) — 코어 비수정 원칙·테마 네이밍 규약
- [apps/api/src/lib/g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — TEMPLATE_ITEMS (it_id 수동 동기화 대상)
