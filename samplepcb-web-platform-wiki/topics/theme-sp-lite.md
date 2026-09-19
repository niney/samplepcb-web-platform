---
topic: theme-sp-lite
last_compiled: 2026-09-19
sources_count: 77
status: active
---

# theme-sp-lite

## Purpose [coverage: high — 14 sources]

`samplepcb-web/theme/sp-lite/` 는 그누보드5/영카트의 **코어 비수정 오버라이드 지점**인 커스텀 테마다(소스 범위 2026-07-04 ~ 2026-09-18). 코어는 subtree 로 들어와 손대지 않고([core-nonmodification](../concepts/core-nonmodification.md), [AGENTS.md](../../AGENTS.md)), 화면 표현·마크업이 필요한 커스텀은 전부 이 테마와 `spcb/pages/` 안에서 해결한다. `readme.txt` 기준 "베이직(basic) 기반 PC 전용 경량 테마" — `theme.config.php` 의 `G5_THEME_DEVICE='pc'` 로 **모든 기기가 이 테마 하나를 쓰고 반응형은 CSS** 로 처리한다(단, `mobile/skin/shop` 은 코어 요구로 존재해야 함 — Gotchas).

역할이 세 축이다:
1. **거버 주문 플로우의 표현 계층**(2026-07 확립) — [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) 4장 기법 #8 테마 cart 스킨 분기: 견적 행을 건별(ct_id) 카드로 풀고 수량·주문·삭제를 sp-node 경유로 돌려 코어 [선택사항수정]의 선형 곱 버그를 차단.
2. **sp-vue 관리 ↔ sp-php 소비 브릿지의 소비측**([admin-vue-consume-php](../concepts/admin-vue-consume-php.md)) — `inc/main_slider.php`(`g5_shop_banner`+`sp_config`)·`inc/seo_head.php`(`sp_seo`)가 공유 DB 를 read-only 로 직접 조회해 SSR 출력.
3. **피그마 「Samplepcb_Web」 → sp-php 페이지 구현의 착지점**(2026-08-25 ~ 09-18, [FIGMA_PAGES](../../docs/FIGMA_PAGES.md)·[MYPAGE_REDESIGN](../../docs/MYPAGE_REDESIGN.md)) — 홈·헤더·푸터·회사소개/연혁/위치·로그인·마이페이지·주문내역/상세·포인트·견적관리를 피그마 좌표 그대로 옮겼고, "고객 대면 신규 화면은 sp-php 우선" 플랫폼 결정(AGENTS.md)의 실체가 이 테마의 CSS 토큰·페이지 블록이다.

## Architecture [coverage: high — 30 sources]

```
theme/sp-lite/
  theme.config.php          G5_THEME_DEVICE='pc' · G5_COMMUNITY_USE=true · 스킨 매핑
  head.php / tail.php       커뮤니티 레이아웃(홈·게시판·spcb/pages 정적 페이지) — inc/header·footer include
  head.sub.php / tail.sub.php  <head> 공통(seo_head·default.css·sp-dialog.js) + 레이아웃 승격 2종(아래)
  index.php                 홈(/) — main_slider → glob(inc/home/*.php) 순서 include → js/home.js 모듈
  inc/header.php            공용 헤더 72px(피그마 2286:1435) — DB GNB+드롭다운·로그인/회원가입 알약·아이콘 3개
  inc/footer.php            공용 다크 푸터(2286:2238) — $default 쇼핑몰 설정 폴백 · quicklinks include
  inc/main_slider.php       히어로 5장 하이브리드(코드 템플릿 + 배너관리 이미지) · sp_config.home_slides
  inc/home/10-onestop … 42-help.php  홈 섹션 부분 파일(번호 = 피그마 순서)
  inc/seo_head.php · quicklinks.php · reviews_lib.php · main_reviews.php(현재 미사용, Gotchas)
  css/default.css           토큰(--sp-*)·헤더·GNB·푸터·플로팅 · default_shop.css 쇼핑·계정·주문·견적 블록(2,973줄)
  css/home.css · about.css · history.css · location.css   페이지 전용(피그마 1920 좌표)
  js/home.js + js/home/{hero,onestop,portfolio}.js · motion-path.js(프로빙 스냅샷)
  js/sp-dialog.js(공용 팝업) · orderform-defaults.js · order-vat-breakdown.js(주문서 보강)
  shop/shop.head.php        쇼핑 레이아웃 — SCRIPT_NAME 으로 계정 페이지 판별 → #aside 사이드바 · 제목 오버라이드
  shop/_account_nav.php     계정 사이드바 SSOT(카드형, 2243:2386) · cart.php · mypage.php · coupon.php
  shop/orderinquiry.sub.php(목록+유형 탭) · orderinquiryview.php(상세 단일 컬럼, 1,011줄)
  skin/latest/home-help/    홈 "도움이 필요하신가요?" qa·notice 스킨 · skin/member/basic/login·point 스킨
  img/{home(68)·about(27)·account(17)·history·location·header·footer}/ 페이지별 에셋
  mobile/skin/shop/basic/   PC 스킨 복사본(코어 readdir Fatal 방지)
```

**레이아웃 셸 4종**(전부 `inc/header.php`·`inc/footer.php` 공유): ① `head.php` 커뮤니티 ② `shop/shop.head.php` 쇼핑 — 로그인 회원이 계정 페이지(마이페이지·주문내역·장바구니 등)를 열면 `#container.is-account` 그리드 + `#aside` 에 `_account_nav.php` ③ `head.sub.php` 의 **인라인 계정 승격**(`SP_INLINE_ACCOUNT`) — 코어가 팝업으로 여는 포인트·쿠폰·쪽지·스크랩을 코어 무수정으로 GNB+사이드바 레이아웃에 넣는다(`memo_form.php` 만 `?inline=1` 마커) ④ **셸 페이지**(`SP_SHELL_PAGE`) — 코어가 베어 `_head.sub.php` 로 여는 로그인을 헤더·푸터 위 카드(피그마 103:3337)로. ③④는 `tail.sub.php` 가 대칭으로 닫는다. 커스텀 페이지(`/shop/quotes`·`/shop/eq`·`/shop/as`)는 `head.php` 를 쓰므로 `.account-layout` 으로 직접 감싸 사이드바를 include 한다.

**홈 조립(2026-09-18)**: `index.php` 가 `inc/main_slider.php` 뒤에 `inc/home/NN-*.php` 를 glob 순서로 include 하고, CSS 는 `css/home/` 폴더가 있으면 부분 파일을(개발 모드) 없으면 병합본 `home.css` 를 로드, JS 는 `js/home.js` 가 `js/home/{hero,onestop,portfolio}.js` 를 동적 import 해 `init()` — 모듈 하나가 404 여도 다른 섹션은 산다. 히어로는 코드 템플릿 5장(`gerber-eyes`·`order-now`·`korlinx`·`one-stop`·`rapid-proto`)이 앞, 배너관리('메인') 이미지가 뒤에 붙는 **하이브리드**. banner 01 배경은 로그인 배경 프로빙(`spcb/previews/login-bg-claude`)에서 채택한 연속 회전(center-swap)을 `js/motion-path.js` 스냅샷으로 이식했고, 02~04 는 디자이너 3720폭 리소스를 60초 왕복 팬, 05 는 정지 사진.

**정적 페이지 패턴**(2026-09-06): `spcb/pages/{about,history,location}.php` 가 `common.php` 부트스트랩 → `add_stylesheet(css/<page>.css)` → 테마 `head.php` include. 루트 `.htaccess` 가 `/about` 등을 내부 리라이트. 각 페이지의 문구·연혁·지사·지도 URL 은 PHP 배열 변수(`$sp_stats`·`$sp_history`·`$sp_offices`·`$sp_map_src`)라 디자이너 확정값이 오면 그 자리만 바꾼다.

**주문서만 코어 원본**이다(cart·quotes·orderinquiry 는 테마가 덮었지만 `shop/orderform.sub.php` 는 영카트 마크업): 테마는 `#sod_frm` 스코프 CSS 로 장바구니 시각 문법을 재현하고, `js/orderform-defaults.js`(배송지·결제수단·계좌 기본 선택을 코어 핸들러의 프로그램적 click 으로)·`js/order-vat-breakdown.js`(견적 행 부가세 분해, `extend/sp_quote_cart.extend.php` 의 `sp_quote_it_ids()` + `sp-bom-parts`)를 `shop.head.php` 가 주문서에서만 싣는다. 코어 최소 수정 2곳(기법 #11)은 `ops/scripts/check-core-patches.sh` 가 감시.

## Talks To [coverage: high — 16 sources]

- **영카트 코어 훅**: `G5_THEME_SHOP_PATH/{cart,coupon}.php` include-after-return, `orderinquiry.sub.php` 테마 위임, 코어 `head.sub.php` → 테마 위임. 주문내역 유형 탭은 코어 `get_paging` 이 sub include **뒤에** 실행되는 순서를 이용해 `$total_count/$total_page/$qstr` 를 덮어쓴다(코어 무수정). 홈 게시판은 코어 `latest('theme/home-help', …)`.
- **공유 DB 직접 조회(read-only)**: `g5_shop_banner`('메인')·`sp_config`(`home_slides`, Node 소유 표를 `sql_fetch(…, false)` 로 읽기만)·`sp_seo`·`g5_menu`(GNB)·`g5_point`(소멸 예정 30일)·`sp_order_spec`+`sp_bom_quote`(마이페이지 요약 밴드 합산)·`$default` 쇼핑몰 설정(푸터 회사정보 폴백). `sp_review` 는 `spcb/pages/reviews.php` 만 읽는다(홈 쇼케이스는 09-06 홈 재편으로 제거).
- **sp-node**: `cart.php` 하단 JS 가 `/spcb/api/me` JWT 로 `PATCH·DELETE /api/pcb-projects/:id`·`POST /order`·`GET /cart-thumbs`. 제조 확인·A/S·주문 상세 진행 카드는 서버사이드 브리지(`extend/sp_pcb_eq·sp_pcb_claim·sp_bom_claim.extend.php` → sp-node `*/mine`) — 견적관리(`quotes.php`)만 브라우저 JS 가 두 API(`/api/pcb-projects`·`/api/bom/quotes`)를 한 리스트로 섞는다. 상세는 [spcb-bridge](spcb-bridge.md)·[sp-node-api](sp-node-api.md).
- **extend/**: `version.extend.php`(`G5_CSS_VER`/`G5_JS_VER`), `default.config.php`(`SP_USE_WISHLIST`, 기본 false), `sp_quote_cart.extend.php`(견적 it_id SSOT·혼합 카트 `sp_cart_deselect` 쿠키 보정), `sp_partner.extend.php`(`sp_is_approved_partner` → 헤더 '파트너 포탈' 링크, `sp_quote_badge_count`/`sp_cart_badge_count`).
- **관리측(sp-vue)**: 슬라이드 `/app/admin/slides`(영카트 배너관리와 같은 테이블), SEO `/app/admin/seo`. 히어로 템플릿 on/off 의 관리 UI 는 **없음**(`sp_config.home_slides` 를 직접 넣어야 함 — 미착수 2단계).
- **피그마·검증 도구**: 파일 `Samplepcb_Web`(oviaZUKfcQml2IvwPVICpU) 노드 id 가 각 PHP/CSS 헤더 주석에 박혀 있다. 화면 대조는 `node ops/scripts/shot.mjs <url> <out.png> [--selector|--full|--scroll|--mobile]`(playwright-core + 시스템 Edge, 콘솔·4xx 목록 출력). 로그인 배경 실험실 2곳(`spcb/previews/login-bg-claude`·`login-bg-gpt`)은 그누보드 무관 정적 페이지.
- **e2e**: `customer-eq-menu`·`customer-as-menu`·`orderinquiry-tabs`·`journey-pcb-as-mypage` 스펙이 사이드바 클래스 훅(`nav_group·nav_glabel·lbl·nav_badge·aria-current`)과 탭·총건을 읽는다([testing](testing.md)).

## API Surface [coverage: high — 12 sources]

테마라 HTTP API 는 없지만 외부·후속 작업이 의존하는 계약면:

- **홈 확장 계약**: 섹션 = `inc/home/NN-*.php`(번호가 순서, 각 파일은 `$sp_hi` = `img/home` 을 전제) · 스타일 = `css/home.css` 하나 또는 `css/home/*.css` 부분 파일(있으면 우선) · 스크립트 = `js/home/<이름>.js` 가 `export function init()` 을 내보내고 `js/home.js` 의 모듈 목록에 이름을 추가, `?ver` 는 진입 모듈이 그대로 넘긴다.
- **히어로 설정**: `sp_config` key `home_slides` = `{"templates":["gerber-eyes","order-now","korlinx","one-stop","rapid-proto"]}` — 배열 순서·포함 여부가 노출·순서, 행이 없으면 5장 전부. 이미지 슬라이드는 `g5_shop_banner`(`bn_position='메인'`, 기간·device 필터, 실파일 존재 검사).
- **링크 슬롯 관례**: 링크는 사용자 결정으로 전부 비어 있다 — `sp_hero_link()`·`sp_help_more()`·`$sp_help_more` 배열에 URL 을 넣으면 `<a>`, 비면 `<span>`. 자리표시 수치는 `$sp_home_stats`(홈)·`$sp_stats`(연혁).
- **계정 셸**: `$sp_account_active` 키 `home|orders|cart|wish|quotes|eq|as|point|coupon|memo|scrap`; 쇼핑 페이지는 `shop.head.php` 가 자동, 커스텀 페이지는 `.account-layout` 래퍼 + include. `.nav_badge` 안은 **숫자만**(단위는 `.nav_unit`) — e2e 가 `Number(textContent)` 로 파싱. 주문내역 탭 파라미터 `?track=pcb|bom`(판별키 = 카트행 it_id).
- **CSS 계층·토큰**: 전역 `--sp-*`(`default.css`, **불변** — 사용자 결정) 위에 계정 셸 스코프 `--acc-*`(`#container.is-account, .account-layout`, 피그마 색값), 견적관리 신규 규칙은 `.sp-quotes--fig` 스코프(보관함은 옛 카드 문법 B), 주문 상태 배지 `status_01~06` 전역. 링크 CSS/JS 는 `?ver=G5_CSS_VER`/`G5_JS_VER`(현재 26091804 / 26091801).
- **공용 팝업**: `spDialog.alert(msg, {title,tone,okText})`·`spDialog.confirm(...)` → Promise, 의존성 없음, `textContent` 만(XSS 안전); 서버가 `?sp_msg=` 로 실어 보낸 문구도 로드 직후 모달. 코어 `alert()` 은 `bbs/alert.php` 로 페이지를 통째로 이동시키므로 새 화면은 이것을 쓴다.
- **코어 훅 계약(불변)**: cart 폼 필드(`ct_chk[]`·`it_id[]`·`act`)·`form_check(act)`·`#mod_option_frm` 이름은 코어 JS·`cartupdate.php` 와의 계약. `GET /api/pcb-projects/cart-thumbs` 응답 `data.thumbs = { it_id: URL }`, 교체 대상 `.sp-cart-thumb[data-itid]`.

## Data [coverage: high — 7 sources]

- 테마는 상태를 소유하지 않는다 — cart 는 코어와 같은 `g5_shop_cart` 쿼리를 건별로 다시 풀어 표시, 마이페이지 요약 밴드는 `g5_shop_order`+`sp_order_spec`+`sp_bom_quote` 를 **마이페이지 전용으로 독립 집계**(사이드바 배지와 별개 조회). 견적 대기 = PCB rfq + BOM requested|reviewing, 확정 = PCB quoted·미담김 + BOM answered·확정가·미주문.
- **견적 템플릿 it_id 4종**(`sp-pcb-std`·`sp-mask`·`sp-pcb-adv`·`sp-pcb-flex`)이 cart 분기·주문내역 PCB 탭·부가세 분해의 판별키. 정의는 `extend/sp_quote_cart.extend.php` 의 `sp_quote_it_ids()` 로 모였지만 sp-node `g5-db.ts` `TEMPLATE_ITEMS` 와는 여전히 **수동 동기화**([manual-sync-drift](../concepts/manual-sync-drift.md)). 부품 BOM 은 `sp-bom-parts`.
- **자리표시·권리 미확정 데이터**(운영 배포 전 교체 목록, [FIGMA_PAGES](../../docs/FIGMA_PAGES.md)): 홈 통계 3칸·연혁 통계 4칸 수치, Our Network 로고 20종·회사소개 로고 13종 사용 허락, Unsplash+ 워터마크 프리뷰 사진(프로세스 띠·연혁 배너는 대체됨), Flaticon 계열 아이콘 출처 표기, 3 EYES 애니메이션 GIF 0.9MB·4.7MB(영상 변환 권장), 히어로 05 배경 = 1024 스크린샷 확대(영상 자리).
- **에셋 출처**: `img/{home,about,history,location}/` 은 피그마 export 를 헤드리스 Edge 캔버스(node)로 가공한 것(이 PC 엔 python·ImageMagick·ffmpeg 없음) — 투명이 필요한 것은 design-context 원본을 crop 값대로, 벡터·래스터 혼합 링(`about/ring-2x.png`)은 2배 PNG 로 구웠다. 고치려면 피그마 노드를 다시 export 해야 한다.
- 푸터 회사정보는 쇼핑몰 설정 `$default`(`de_admin_company_*`) 가 있으면 그 값, 없으면 피그마 문구 폴백(팩스만 고정) — 관리는 영카트 `/adm` 쇼핑몰설정.
- 위시리스트 데이터(`g5_shop_wish`)·코어 코드는 보존, 진입점만 숨김([wishlist-hidden](../../docs/wishlist-hidden.md)).

## Key Decisions [coverage: high — 20 sources]

- **2026-09-18 — 홈 재구현 「웹 메인」2286:1275**(커밋 a37b0b850·51cac5cc8): 옛 홈(2122:5280) 노드가 피그마에서 삭제되고 전면 교체라 옛 섹션·`skin/latest/home-fig` 제거. 섹션 부분 파일 + CSS 병합 + JS 동적 import 구조 확립, 헤더 94→72px·드롭다운 GNB(회사소개 서브메뉴 = DB 하위메뉴로 종결), 데스크톱은 피그마 좌표 그대로(실측 ±2px), 1023px 이하는 피그마에 없어 우리 정의(390px 넘침 0).
- **2026-09-15 — 계정 사이드바 카드형 통일(2243:2386)**: 포인트 전용 `.is-point` 덮어쓰기 제거, 전 계정 페이지 공용. 피그마의 불균일한 메뉴 간격은 **사용자 요청으로 통일**(행 36px·간격 4px) — "피그마 그대로" 원칙의 명시적 예외.
- **2026-09-11 — 포인트 페이지 피그마(2254:9041) + 소멸 예정 금액**(코어 원장 읽기만) · 계정 메뉴 정리(정보수정·로그아웃 알약).
- **2026-09-09 — 헤더 서브메뉴 바 되돌림**: 09-06 에 피그마 top_submenu(2122:9205)로 세운 회사소개 서브메뉴 바를 3일 만에 revert 하고 드롭다운 GNB 로 복귀(845f69b4a).
- **2026-09-06 — 피그마 동일 구현 + 이상 징후는 기록만(사용자 결정)**: 회사소개 `/about`(2122:6136)·연혁 `/history`(6658)·위치 `/location`(7157) 3종을 `spcb/pages` + 테마 css/img 로 구현하되, 피그마가 미완성이거나 틀린 곳(배너 부제 미완성 문장·Customer 카드 숫자 충돌·같은 특허증 7장 복제·Unsplash+ 워터마크·타사 스크린샷 통계)은 **고치지 않고 [FIGMA_PAGES](../../docs/FIGMA_PAGES.md) 에 적어 한 번에 손본다**. 링크(버튼·탭·로고)는 전부 비움. 지도는 네이버 스크린샷 대신 구글 임베드(키 불필요), Contact Us 폼은 접수 백엔드 결정 대기([CONTACT_INQUIRY](../../docs/CONTACT_INQUIRY.md)).
- **2026-09-06 — 홈 1차(2122:5280) + 공용 다크 푸터 + 히어로 하이브리드**: 템플릿 슬라이드 = 코드, 배너관리 이미지는 뒤에 붙임, on/off 는 `sp_config.home_slides`. 로그인 배경 프로빙(09-05~06, Claude·GPT 실험실 2곳 — CSS 프리셋·JS 생성 선·원본 윤곽 변형)에서 **연속 회전(center-swap)** 채택 → 홈 banner 01 로 이식. 프로빙 폴더는 검토 뒤 삭제 예정(미결).
- **2026-08-27 — 공용 헤더 피그마 2077:15 재편**: 로고 합성 PNG, 아이콘 3개(견적관리·장바구니·마이페이지), 로그인 상태는 피그마에 없어 '로그아웃' + 파트너 포탈·관리자 텍스트 링크(사용자 결정, 09-18 헤더에도 유지). 같은 날 견적관리 103:2659 행 문법(`.sp-quotes--fig`, 보관함은 옛 모양 B, 수량 재견적은 뺌).
- **2026-08-25~26 — 마이페이지·주문내역·상세주문내역 피그마 재편(103:2361·4215·4561)**: 시안에 없는 기능 블록(입금 안내·진행 카드·EQ·A/S·운송장·취소)은 **빼지 않고 자리만 정함**, 옛 2열 폐기. 계정 셸 스코프 토큰 `--acc-*` 신설(전역 불변). 주문내역 유형 탭(전체/PCB/부품, 레거시 일반 상품은 전체에만, 설계·SMT 탭은 데이터 축 없어 미구현). 회원탈퇴는 사이드바에서 빼 quicklinks 보관. 로그인 카드(103:3337) + 셸 페이지 승격. 같은 주에 제조 확인(`/shop/eq`)·A/S 접수(`/shop/as`) 사이드바 메뉴 신설 — 목록은 목록만, 결정 폼은 주문 상세로 보낸다.
- **2026-08-17 — 배송방법 P1 은 PHP 0줄**([DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md)): `od_delivery_company` 한글 라벨 병용 덕에 고객 주문조회가 무수정 호환. P2 주문서 수집(`orderform.sub.php` 방법 선택 + 배송비 0)은 미착수.
- **2026-08-07~10 — 주문서 마찰 제거는 코어 무수정 JS 로**: `sp-dialog.js` 공용 팝업(코어 alert 의 페이지 이동 대체), `order-vat-breakdown.js`(견적 금액 부가세 포함 결제 기준 통일), `orderform-defaults.js`(기본값 자동 선택).
- **2026-08-02 — 승인 파트너에게 헤더 '파트너 포탈' 링크**(`sp_is_approved_partner`).
- **2026-07-29~30 — 견적관리 BOM 탭·통합 목록(D17)** — 테마는 CSS 만 기여.
- (2026-07-04~10, 이전 컴파일 유지) 주문 3형제 전 기기 pc 통일·계정 사이드바 SSOT·위시 "삭제 아닌 숨김"(`SP_USE_WISHLIST`)·홈 슬라이드 브릿지·`/reviews` + `reviews_lib`·SEO head 브릿지 옵션 B(전역변수 매칭, [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md))·게시판 `review` 명칭 "고객후기"([review-naming](../../docs/review-naming.md)). "표현은 테마, 데이터는 sp-node" 원칙과 quicklinks 소거식 인벤토리도 그대로.

## Gotchas [coverage: high — 15 sources]

- **CSS·JS 캐시버스팅은 두 상수 다 올려야 한다** — `extend/version.extend.php` 의 `G5_CSS_VER`(26091804)·`G5_JS_VER`(26091801). 안 올리면 옛 파일이 캐시돼 "적용 안 됨". `js/home.js` 는 자기 `?ver` 를 섹션 모듈·`motion-path.js` 에 넘기므로 홈 JS 도 이 상수 하나로 갱신된다. 스킨 인라인 `<style>` 은 무관.
- **`latest()` 는 1시간 캐시**(`data/cache/latest-*-home-help-*.php`) — 홈 도움말 스킨을 고치면 캐시 파일을 지워야 보인다.
- **`$sp_hi` 리셋 함정**: `inc/main_slider.php` 가 `$sp_hi` 를 `img/home/hero` 로 바꿔 쓰므로 `index.php` 가 부분 파일마다 `img/home` 으로 되돌린다 — 새 섹션 파일을 다른 곳에서 include 하면 이미지가 404.
- **`css/home/` 폴더가 있으면 병합본 `home.css` 는 무시된다**(부분 파일 모드). 작업 뒤 병합·삭제를 잊으면 두 벌이 갈린다.
- **헤더 메뉴 문구는 `g5_menu`** — 피그마의 개발·PCB·전자 부품·PCBA·회사소개▾·블로그는 예시. 드롭다운은 하위메뉴가 있는 1차 항목에만. 09-09 revert 된 서브메뉴 바(2122:9205)를 다시 따라가지 말 것.
- **`sp_config` 는 Node(Prisma) 소유 표** — PHP 는 `sql_fetch(…, false)` 로 읽기만, 행이 없으면 조용히 기본값. 히어로 템플릿 on/off 관리 UI 가 없어 운영에선 SQL 로 넣어야 한다.
- **화면 대조 `shot.mjs --full` 은 `loading="lazy"` 이미지가 빈 상자** — 뷰포트 + `--scroll` 로 다시 볼 것. Figma MCP 는 `download_assets` PNG 가 흰 배경으로 구워지고 SVG 에 배경 rect·필터가 섞이며 export 가 블렌드 모드를 버린다 — 투명은 design-context 원본을 crop 값대로 자르거나 `exportAsync`.
- **운영 배포 전 체크리스트가 문서에만 있다**: 자리표시 수치(`$sp_home_stats`·`$sp_stats`), 로고 사용 허락, 워터마크·스크린샷 파생 이미지 라이선스, 4.7MB GIF, 연혁 2024~2026 항목 부재, 위치 페이지 "공사" 오타 여부·전화 표기 불일치·Contact Us 미구현. 코드는 피그마 그대로라 이 목록을 읽지 않으면 그대로 나간다.
- **옛 홈 잔재**: `inc/main_reviews.php` 와 `skin/latest/home/` 은 09-06 이후 어느 페이지도 include 하지 않는다(`reviews_lib.php` 는 `/reviews` 가 계속 사용). 삭제 여부 미결.
- **주문서(`orderform`)만 코어 원본** — 테마 CSS 는 `#sod_frm` 스코프로 누수를 막고 JS 는 코어 핸들러를 프로그램적 click 으로 태운다. 코어 최소 수정 2곳(기법 #11)과 pc 폼 통일은 `check-core-patches.sh` 등록 — subtree pull 뒤 같은 취지로 재적용.
- **`.nav_badge` 안에 단위를 넣으면 e2e 가 깨진다**(`Number()` 파싱). 사이드바 클래스 훅·`aria-current` 유지.
- **인라인 계정 승격은 로그인·PC 한정**(`!G5_IS_MOBILE` 이지만 sp-lite 는 항상 false 라 실질 로그인 조건). `memo_form.php` 는 코어 `get_sideview` 팝업과 이중 역할이라 `?inline=1` 없이는 팝업 그대로.
- **[선택사항수정] 선형 곱 버그는 차단일 뿐** — URL 직접 호출로 코어 `cartoption.php` 팝업에 가면 재현. 수량 변경 정식 경로는 sp-node 재견적(PATCH). 견적 행 삭제는 sp-node lazy reconcile 로 보관함에 수거([lazy-derived-state](../concepts/lazy-derived-state.md)).
- **`mobile/skin/shop` 은 잔재가 아니다** — 코어 관리자(쇼핑몰설정)가 `readdir` 하므로 없으면 PHP8 Fatal. 프런트는 타지 않는다.
- **seo_head 는 전 페이지 경유 코드** — `sql_query($sql, false)` 방어 유지, description·OG 를 `cf_add_meta` 에 넣으면 이중출력. 위시는 `SP_USE_WISHLIST=true` 한 줄로 전체 복귀(직접 URL 은 여전히 동작). 주문 알림 체크박스 게이트는 sp-vue 영역이지만 코어 orderlist 무조건 노출을 결함으로 판단한 인접 결정([order-notify-gating](../../docs/order-notify-gating.md)).

## Sources [coverage: high — 77 sources]

- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — 피그마 → sp-php 페이지 구현 대장(홈·헤더·푸터·about·history·location, 미결·공통 함정) 2026-09-18
- [docs/MYPAGE_REDESIGN.md](../../docs/MYPAGE_REDESIGN.md) — 마이페이지·사이드바·주문내역 탭 재설계 2026-08-25 / 09-15
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 기법 #8 테마 cart 스킨·#11 주문서 최소 수정·파일 색인
- [docs/DELIVERY_METHOD.md](../../docs/DELIVERY_METHOD.md) — 배송방법 P1(PHP 0줄)·P2 orderform 로드맵 2026-08-17
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) — seo_head 브릿지 옵션 B [as of 2026-07]
- [docs/wishlist-hidden.md](../../docs/wishlist-hidden.md) — 위시 숨김 결정(08-27 헤더 아이콘 3개 반영)
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 주문 알림 게이트(인접) [as of 2026-07]
- [docs/review-naming.md](../../docs/review-naming.md) — 후기 명칭·/reviews [as of 2026-07]
- [docs/CONTACT_INQUIRY.md](../../docs/CONTACT_INQUIRY.md) — Contact Us 접수 백엔드 결정 대기 2026-09-06
- [spcb/previews/login-bg-claude/README.md](../../samplepcb-web/spcb/previews/login-bg-claude/README.md) · [login-bg-gpt/README.md](../../samplepcb-web/spcb/previews/login-bg-gpt/README.md) — 로그인 배경 애니메이션 프로빙 2실험실 2026-09-06
- [AGENTS.md](../../AGENTS.md) · [CLAUDE.md](../../CLAUDE.md) — 코어 비수정 원칙·별칭·sp-php 우선 결정
- [theme/sp-lite/index.php](../../samplepcb-web/theme/sp-lite/index.php) — 홈 조립(부분 파일 glob·CSS 모드·JS 모듈)
- [head.sub.php](../../samplepcb-web/theme/sp-lite/head.sub.php) · [tail.sub.php](../../samplepcb-web/theme/sp-lite/tail.sub.php) · [head.php](../../samplepcb-web/theme/sp-lite/head.php) · [theme.config.php](../../samplepcb-web/theme/sp-lite/theme.config.php) · [readme.txt](../../samplepcb-web/theme/sp-lite/readme.txt) — 셸·승격 2종·기기 고정
- [inc/header.php](../../samplepcb-web/theme/sp-lite/inc/header.php) · [inc/footer.php](../../samplepcb-web/theme/sp-lite/inc/footer.php) — 공용 헤더 72px·다크 푸터
- [inc/main_slider.php](../../samplepcb-web/theme/sp-lite/inc/main_slider.php) — 히어로 하이브리드·sp_config.home_slides
- [inc/home/10-onestop.php](../../samplepcb-web/theme/sp-lite/inc/home/10-onestop.php) · [20-eyes.php](../../samplepcb-web/theme/sp-lite/inc/home/20-eyes.php) · [30-idea.php](../../samplepcb-web/theme/sp-lite/inc/home/30-idea.php) · [40-stats.php](../../samplepcb-web/theme/sp-lite/inc/home/40-stats.php) · [41-network.php](../../samplepcb-web/theme/sp-lite/inc/home/41-network.php) · [42-help.php](../../samplepcb-web/theme/sp-lite/inc/home/42-help.php) — 홈 섹션 부분 파일
- [inc/seo_head.php](../../samplepcb-web/theme/sp-lite/inc/seo_head.php) · [inc/quicklinks.php](../../samplepcb-web/theme/sp-lite/inc/quicklinks.php) · [inc/reviews_lib.php](../../samplepcb-web/theme/sp-lite/inc/reviews_lib.php) · [inc/main_reviews.php](../../samplepcb-web/theme/sp-lite/inc/main_reviews.php)(미사용) — 브릿지·인벤토리·잔재
- [css/default.css](../../samplepcb-web/theme/sp-lite/css/default.css) · [css/default_shop.css](../../samplepcb-web/theme/sp-lite/css/default_shop.css) — 토큰·헤더·푸터 / 쇼핑·계정·주문·견적 블록
- [css/home.css](../../samplepcb-web/theme/sp-lite/css/home.css) · [css/about.css](../../samplepcb-web/theme/sp-lite/css/about.css) · [css/history.css](../../samplepcb-web/theme/sp-lite/css/history.css) · [css/location.css](../../samplepcb-web/theme/sp-lite/css/location.css) — 페이지 전용(피그마 좌표)
- [js/home.js](../../samplepcb-web/theme/sp-lite/js/home.js) · [js/home/hero.js](../../samplepcb-web/theme/sp-lite/js/home/hero.js) · [onestop.js](../../samplepcb-web/theme/sp-lite/js/home/onestop.js) · [portfolio.js](../../samplepcb-web/theme/sp-lite/js/home/portfolio.js) · [js/motion-path.js](../../samplepcb-web/theme/sp-lite/js/motion-path.js) — 홈 모듈·배경 변형 스냅샷
- [js/sp-dialog.js](../../samplepcb-web/theme/sp-lite/js/sp-dialog.js) · [js/orderform-defaults.js](../../samplepcb-web/theme/sp-lite/js/orderform-defaults.js) · [js/order-vat-breakdown.js](../../samplepcb-web/theme/sp-lite/js/order-vat-breakdown.js) — 공용 팝업·주문서 보강
- [shop/shop.head.php](../../samplepcb-web/theme/sp-lite/shop/shop.head.php) · [shop/_account_nav.php](../../samplepcb-web/theme/sp-lite/shop/_account_nav.php) · [shop/mypage.php](../../samplepcb-web/theme/sp-lite/shop/mypage.php) · [shop/coupon.php](../../samplepcb-web/theme/sp-lite/shop/coupon.php) — 쇼핑 셸·계정 사이드바 SSOT·요약 밴드
- [shop/cart.php](../../samplepcb-web/theme/sp-lite/shop/cart.php) · [shop/orderinquiry.sub.php](../../samplepcb-web/theme/sp-lite/shop/orderinquiry.sub.php) · [shop/orderinquiryview.php](../../samplepcb-web/theme/sp-lite/shop/orderinquiryview.php) — 장바구니 건별 카드·주문내역 탭·상세 단일 컬럼
- [skin/latest/home-help/latest.skin.php](../../samplepcb-web/theme/sp-lite/skin/latest/home-help/latest.skin.php) · [skin/latest/home/latest.skin.php](../../samplepcb-web/theme/sp-lite/skin/latest/home/latest.skin.php)(미사용) — 홈 게시판 스킨
- [skin/member/basic/login.skin.php](../../samplepcb-web/theme/sp-lite/skin/member/basic/login.skin.php) · [point.skin.php](../../samplepcb-web/theme/sp-lite/skin/member/basic/point.skin.php) · [style.css](../../samplepcb-web/theme/sp-lite/skin/member/basic/style.css) — 로그인 카드·포인트 페이지
- [mobile/skin/shop/basic/](../../samplepcb-web/theme/sp-lite/mobile/skin/shop/basic) — 코어 readdir Fatal 방지 복사본
- [extend/version.extend.php](../../samplepcb-web/extend/version.extend.php) · [extend/default.config.php](../../samplepcb-web/extend/default.config.php) · [extend/sp_quote_cart.extend.php](../../samplepcb-web/extend/sp_quote_cart.extend.php) · [extend/sp_partner.extend.php](../../samplepcb-web/extend/sp_partner.extend.php) — 캐시버스팅·위시 토글·견적 it_id·파트너 헬퍼
- [spcb/pages/about.php](../../samplepcb-web/spcb/pages/about.php) · [history.php](../../samplepcb-web/spcb/pages/history.php) · [location.php](../../samplepcb-web/spcb/pages/location.php) — 정적 페이지 3종(테마 head.php 사용)
- [spcb/pages/quotes.php](../../samplepcb-web/spcb/pages/quotes.php) · [eq.php](../../samplepcb-web/spcb/pages/eq.php) · [as.php](../../samplepcb-web/spcb/pages/as.php) — 계정 셸을 쓰는 커스텀 페이지
- [shop/cart.php (코어)](../../samplepcb-web/shop/cart.php) · [.htaccess](../../samplepcb-web/.htaccess) — 오버라이드 훅·리라이트
- [ops/scripts/shot.mjs](../../ops/scripts/shot.mjs) · [ops/scripts/check-core-patches.sh](../../ops/scripts/check-core-patches.sh) — 화면 대조·코어 수정 감시
- [apps/api/src/lib/g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — TEMPLATE_ITEMS(수동 동기화 대상)
- [e2e/specs/orderinquiry-tabs](../../samplepcb-web-mono-app/e2e/specs/orderinquiry-tabs.e2e.test.ts) · [customer-eq-menu](../../samplepcb-web-mono-app/e2e/specs/customer-eq-menu.e2e.test.ts) · [customer-as-menu](../../samplepcb-web-mono-app/e2e/specs/customer-as-menu.e2e.test.ts) — 사이드바·탭 계약을 읽는 스펙
