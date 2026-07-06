# 위시리스트(관심상품) 숨김 — 결정 기록

sp-lite 테마에서 **위시리스트 진입점을 전부 숨기고** PCB 견적관리(`/shop/quotes`)로
일원화한 결정과, 무엇을 지우지 않고 남겼는지(복구 가능성)를 기록한다.

토글: `extend/default.config.php` 의 **`SP_USE_WISHLIST`** (기본 `false`).

## 배경 — 위시리스트는 PCB 견적 모델과 맞지 않는다

영카트 순정 위시리스트는 **카탈로그 상품(`it_id`)을 북마크**하는 기능이다.

- 저장 구조: `g5_shop_wish(mb_id, it_id, wi_time, wi_ip)` — `it_id` 만 저장 (`shop/wishupdate.php:52-56`).
- 조회 함수: `get_wishlist_datas()` 는 `it_id, it_name` 두 컬럼만 읽음 (`lib/shop.lib.php:2313-2340`).

그런데 이 사이트의 PCB "상품"은 카탈로그 상품이 아니라 **견적(`sp_order_spec`)** 이다.
화면 상품은 템플릿 4종 `it_id`(`sp-pcb-std`·`sp-mask`·`sp-pcb-adv`·`sp-pcb-flex`)를
**운반체로만 공유**하고, 실제 상품 개성(치수·층수·수량·거버)은 `it_id` 가 아니라
`ct_id`/`sp_order_spec` 에 있다 (`extend/sp_quote_cart.extend.php:29-33`).

결과적으로 위시리스트는 PCB 견적과 **구조적으로 호환되지 않는다.**

| 문제 | 근거 |
|---|---|
| 특정 견적을 찜할 수 없음 | 같은 템플릿 `it_id` 를 모든 견적이 공유 → 개별 견적 식별 불가 |
| 위시→장바구니가 껍데기 | `io_type=0, io_id='', ct_qty=1` 고정값으로 담음(거버·사양 바인딩 0) → PCB 주문 미성립 (`shop/wishlist.php:72-75`, 테마 `mypage.php` 위시 섹션) |
| 옵션 가드도 못 걸림 | 견적은 코어 옵션 테이블(`io_type='0'`)을 안 써서 차단 로직에도 안 걸림 |

반대로 **견적관리(`/shop/quotes`) + 지난 견적 보관함(`/shop/quotes/archive`)** 이
이미 위시리스트의 역할("저장 → 나중에 주문")을 **사양을 포함한 채** 수행한다.
헤더 유틸 아이콘도 이미 **견적관리 + 장바구니** 2개로 구성되어 있다(`inc/header.php:65-76`).

## 결정

위시리스트를 **"삭제"가 아니라 "숨김"** 처리한다.

- 위시 처리 코드·DB(`g5_shop_wish`)·`wishlist.php`/`wishupdate.php`/`lib` 함수는 **그대로 둔다**
  (영카트 순정 = [코어 비수정 원칙](../AGENTS.md), 나중에 일반 카탈로그가 생기면 되살리기 위함).
- 사용자에게 보이는 **진입점만** 단일 토글 `SP_USE_WISHLIST` 뒤로 숨긴다.
- 게이트 표현식은 `defined('SP_USE_WISHLIST') && SP_USE_WISHLIST` — 상수 미정의(로드 실패)
  시에도 안전하게 **숨김 쪽**으로 폴백한다.

> PCB 견적 전용 사이트라는 전제의 결정이다. 브라우징 가능한 일반 규격 상품 카탈로그
> (스텐실·부자재·샘플 등)가 생기면 아래 "다시 켜기"로 되돌리거나, PCB 템플릿 4종만
> 제외하는 부분 노출(옵션 B)을 검토한다.

## 구현

### 토글 정의
`extend/default.config.php` (그누보드 `common.php:838-850` 이 `extend/*.php` 전체를
부트스트랩에서 자동 로드 → 모든 테마·스킨에서 상수 참조 가능):

```php
if (!defined('SP_USE_WISHLIST')) define('SP_USE_WISHLIST', false);
```

### 숨긴 진입점 (전부 sp-lite 테마)

| 위치 | 파일 | 대상 |
|---|---|---|
| 계정 사이드바(SSOT) | `theme/sp-lite/shop/_account_nav.php` | 위시 `<li>` + 배지 카운트 쿼리(쿼리도 생략) |
| 퀵링크(작업용 패널) | `theme/sp-lite/inc/quicklinks.php` | 위시리스트 링크(라인 주석 처리) |
| 마이페이지 | `theme/sp-lite/shop/mypage.php` | "최근 위시리스트" 섹션 전체 |
| 상품상세 하트 (PC) | `theme/sp-lite/skin/shop/basic/item.form.skin.php` | 상단 `#btn_wish` + 하단 `.sit_btn_wish` |
| 상품상세 하트 (모바일) | `theme/sp-lite/mobile/skin/shop/basic/item.form.skin.php` | 상단 `#btn_wish` + 하단 `#sit_btn_wish` |
| 목록/메인 하트 ×4 | `theme/sp-lite/skin/shop/basic/{list.10,list.40,main.30,main.40}.skin.php` | `.btn_wish` 버튼(공유 버튼은 유지) |

### 손대지 않은 것 (의도적)

- `shop/wishlist.php`·`shop/wishupdate.php`·`shop/ajax.action.php`(`wish_update`)·
  `lib/shop.lib.php` 위시 함수·`g5_shop_wish` 테이블 — 순정 그대로. 직접 URL 접근은 여전히 동작하지만
  UI 진입점이 없어 도달 경로가 사라진다.
- `skin/shop/basic/boxwish.skin.php` — 위시 추가 직후 AJAX(`refresh_wish`)로만 렌더되므로,
  추가 버튼이 숨겨지면 자동으로 dormant.
- `shop.head.php` 의 `'wishlist.php' => 'wish'` 활성메뉴 매핑 — 직접 접근 시 사이드바 활성 상태용,
  무해하여 유지.
- 마이페이지 JS `out_cd_check()`·`fwishlist_check()` — 위시 섹션 전용이라 숨김 시 dead code이나
  무해하여 유지.

## 다시 켜기

`extend/default.config.php` 에서 `SP_USE_WISHLIST` 를 `true` 로 바꾸면 모든 진입점이 즉시 복귀한다.
CSS는 건드리지 않았으므로 `G5_CSS_VER` 갱신 불필요(스킨 PHP는 매 요청 서버 렌더).

## 향후 — 일반 카탈로그가 생기면

거버 견적 외에 찜할 규격 상품 카탈로그가 실제로 생기면 두 갈래:

- **옵션 B(부분 노출)**: `SP_USE_WISHLIST=true` 로 켜되, PCB 템플릿 4종(`sp_quote_it_ids()`)
  상품에서만 하트를 숨긴다(상세/목록 스킨에서 `it_id` 가 템플릿이면 제외). 견적은 견적관리로 계속 유도.
- 그대로 전체 노출: 일반 상품 위주면 순정 위시가 정상 동작.
