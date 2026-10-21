---
topic: theme-sp-lite
last_compiled: 2026-10-12
sources_count: 89
status: active
---

# theme-sp-lite

## Purpose [coverage: high — 16 sources]

`samplepcb-web/theme/sp-lite/` 는 그누보드5/영카트의 **코어 비수정 오버라이드 지점**인 커스텀 테마다(소스 범위 2026-07-04 ~ 2026-10-11). 코어는 subtree 로 들어와 손대지 않고([core-nonmodification](../concepts/core-nonmodification.md), [AGENTS.md](../../AGENTS.md)), 화면 표현·마크업이 필요한 커스텀은 전부 이 테마와 `spcb/pages/` 안에서 해결한다. `readme.txt` 기준 "베이직(basic) 기반 PC 전용 경량 테마" — `theme.config.php` 의 `G5_THEME_DEVICE='pc'` 로 **모든 기기가 이 테마 하나를 쓰고 반응형은 CSS** 로 처리한다(단, `mobile/skin/shop` 은 코어 요구로 존재해야 함 — Gotchas).

역할이 세 축이다:
1. **거버 주문 플로우의 표현 계층**(2026-07 확립) — [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) 4장 기법 #8 테마 cart 스킨 분기: 견적 행을 건별(ct_id) 카드로 풀고 수량·주문·삭제를 sp-node 경유로 돌려 코어 [선택사항수정]의 선형 곱 버그를 차단.
2. **sp-vue 관리 ↔ sp-php 소비 브릿지의 소비측**([admin-vue-consume-php](../concepts/admin-vue-consume-php.md)) — `inc/main_slider.php`(`g5_shop_banner`+`sp_config`)·`inc/seo_head.php`(`sp_seo`)가 공유 DB 를 read-only 로 직접 조회해 SSR 출력.
3. **피그마 「Samplepcb_Web」 → sp-php 페이지 구현의 착지점**(2026-08-25 ~ 10-04, [FIGMA_PAGES](../../docs/FIGMA_PAGES.md)·[MYPAGE_REDESIGN](../../docs/MYPAGE_REDESIGN.md)) — 홈·헤더·푸터·회사소개/연혁/위치·로그인·마이페이지·주문내역/상세·포인트·쿠폰·견적관리를 피그마 좌표 그대로 옮겼고, "고객 대면 신규 화면은 sp-php 우선" 플랫폼 결정(AGENTS.md)의 실체가 이 테마의 CSS 토큰·페이지 블록이다. 09-21 이후는 새 페이지가 아니라 **시안 갱신 추종**(헤더·회사소개·연혁·One-Stop 재편)과 움직임(히어로 영상·저사양 강등·카운트업·스크롤 진입 등장)이 중심이다.

2026-09-30 ~ 10-11 에는 **결제 뒤 고객이 답해야 하는 화면**이 주문 상세의 부분 파일로 붙었다 — 부품 확인(D43, [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) §6.39)과 제조 확인 문항형 회차(D20, [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md)). 판정·저장은 전부 sp-node 이고 테마는 그리기만 한다(트랙 쪽 서술은 [partner-tracks](partner-tracks.md)).

## Architecture [coverage: high — 36 sources]

```
theme/sp-lite/
  theme.config.php          G5_THEME_DEVICE='pc' · G5_COMMUNITY_USE=true · 스킨 매핑
  head.php / tail.php       커뮤니티 레이아웃(홈·게시판·spcb/pages 정적 페이지) — inc/header·footer include
  head.sub.php / tail.sub.php  <head> 공통(seo_head·default.css·sp-dialog.js) + 레이아웃 승격 2종(아래)
  index.php                 홈(/) — main_slider → glob(inc/home/*.php) 순서 include → js/home.js 모듈
  inc/header.php            공용 헤더 72px(피그마 2331:30387) — DB GNB(표시명 매핑·회사소개 하위 3항목)+드롭다운·로그인/회원가입 알약·아이콘 3개
  inc/footer.php            공용 다크 푸터(2286:2238) — $default 쇼핑몰 설정 폴백 · quicklinks include
  inc/main_slider.php       히어로 5장 하이브리드(코드 템플릿 + 배너관리 이미지) · sp_config.home_slides
  inc/home/10-onestop … 42-help.php  홈 섹션 부분 파일(번호 = 피그마 순서)
  inc/seo_head.php · quicklinks.php · reviews_lib.php · main_reviews.php(현재 미사용, Gotchas)
  css/default.css           토큰(--sp-*)·헤더·GNB·푸터·플로팅 · default_shop.css 쇼핑·계정·주문·견적 블록(3,171줄)
  css/home.css · about.css · history.css · location.css   페이지 전용(피그마 1920 좌표)
  js/home.js + js/home/{hero,onestop,portfolio,stats,reveal}.js · motion-path.js(프로빙 스냅샷)
  js/history.js(연혁 가로 탐색) · sp-dialog.js(공용 팝업) · orderform-defaults.js · order-vat-breakdown.js(주문서 보강)
  shop/shop.head.php        쇼핑 레이아웃 — SCRIPT_NAME 으로 계정 페이지 판별 → #aside 사이드바 · 제목 오버라이드
  shop/_account_nav.php     계정 사이드바 SSOT(카드형, 2243:2386) · cart.php · mypage.php · coupon.php(2334:30444)
  shop/orderinquiry.sub.php(목록+유형 탭) · orderinquiryview.php(상세 단일 컬럼, 1,036줄)
  shop/_pcb_eq_items_round.php(제조 확인 문항형 회차 카드) · _bom_confirm_section.php(부품 확인 섹션) — 주문 상세가 include
  skin/latest/home-help/    홈 "도움이 필요하신가요?" qa·notice 스킨 · skin/member/basic/login·point 스킨
  img/{home(79)·about(36)·account(20)·history·location·header·footer}/ 페이지별 에셋 · video/home/hero/(배너 05 영상)
  mobile/skin/shop/basic/   PC 스킨 복사본(코어 readdir Fatal 방지)
```

**레이아웃 셸 4종**(전부 `inc/header.php`·`inc/footer.php` 공유): ① `head.php` 커뮤니티 ② `shop/shop.head.php` 쇼핑 — 로그인 회원이 계정 페이지(마이페이지·주문내역·장바구니 등)를 열면 `#container.is-account` 그리드 + `#aside` 에 `_account_nav.php` ③ `head.sub.php` 의 **인라인 계정 승격**(`SP_INLINE_ACCOUNT`) — 코어가 팝업으로 여는 포인트·쿠폰·쪽지·스크랩을 코어 무수정으로 GNB+사이드바 레이아웃에 넣는다(`memo_form.php` 만 `?inline=1` 마커) ④ **셸 페이지**(`SP_SHELL_PAGE`) — 코어가 베어 `_head.sub.php` 로 여는 로그인을 헤더·푸터 위 카드(피그마 103:3337)로. ③④는 `tail.sub.php` 가 대칭으로 닫는다. ③ 중 포인트·쿠폰은 `is-point`/`is-coupon` 클래스와 아이콘 제목(`sp-title-lg`)을 받는다(쿠폰은 09-21). 커스텀 페이지(`/shop/quotes`·`/shop/eq`·`/shop/parts-confirm`·`/shop/as`)는 `head.php` 를 쓰므로 `.account-layout` 으로 직접 감싸 사이드바를 include 한다.

**홈 조립(2026-09-18, 모듈 2개 추가 09-21·10-02)**: `index.php` 가 `inc/main_slider.php` 뒤에 `inc/home/NN-*.php` 를 glob 순서로 include 하고, CSS 는 `css/home/` 폴더가 있으면 부분 파일을(개발 모드) 없으면 병합본 `home.css` 를 로드, JS 는 `js/home.js` 가 `js/home/{hero,onestop,portfolio,stats,reveal}.js` 를 동적 import 해 `init()` — 모듈 하나가 404 여도 다른 섹션은 산다. 히어로는 코드 템플릿 5장(`gerber-eyes`·`order-now`·`korlinx`·`one-stop`·`rapid-proto`)이 앞, 배너관리('메인') 이미지가 뒤에 붙는 **하이브리드**. banner 01 배경은 로그인 배경 프로빙(`spcb/previews/login-bg-claude`)에서 채택한 연속 회전(center-swap)을 `js/motion-path.js` 스냅샷으로 이식했고(24fps), 02~04 는 디자이너 3720폭 리소스(WebP)를 60초 ±600px 왕복 팬, 05 는 광명공장 영상(`<video data-src>` — 활성 시점에만 `src` 를 붙이고 실패·reduced-motion 은 사진 폴백). 저사양 기기는 `hero.js` 가 `.sp-hero.is-lite` 로 강등해 회전·팬·backdrop-filter·영상을 전부 정지 배경으로 바꾼다.

섹션 동작의 **원본은 PHP 출력**이다: One-Stop 은 `10-onestop.php` 의 서비스 정의(`$sp_os_tabs`·`$sp_os_pcbs`·`$sp_os_variants`)를 `onestop.js` 가 8개 상태(PCB 4종 + 서비스 4종)로 전환하고, `stats.js` 는 `40-stats.php` 가 찍은 최종 문자열(쉼표·`+`·`%`)을 읽어 카운트업하며, `reveal.js` 는 히어로·숫자 섹션을 뺀 나머지에 스크롤 진입 페이드업을 건다 — 뒤의 둘은 JS·IntersectionObserver 가 없거나 동작 줄이기면 처음부터 최종 화면이다.

**정적 페이지 패턴**(2026-09-06, 09-21 재편): `spcb/pages/{about,history,location}.php` 가 `common.php` 부트스트랩 → `add_stylesheet(css/<page>.css)` → 테마 `head.php` include(연혁은 `add_javascript(js/history.js)`, 회사소개는 Why 제목용 Google Fonts Questrial 추가). 루트 `.htaccess` 가 `/about` 등을 내부 리라이트. 각 페이지의 문구·연혁·인증·지사·지도 URL 은 PHP 배열 변수(`$sp_about_problems`·`$sp_about_services`·`$sp_about_benefits` / `$sp_history_groups`·`$sp_certs` / `$sp_offices`·`$sp_map_src`)라 확정값이 오면 그 자리만 바꾼다. 연혁은 자동재생 없는 **수동 가로 탐색** — `history.js` 가 실제 `scrollLeft` 와 range 이동 막대를 동기화하고 마우스 드래그·Home/End·터치를 받는다.

**주문서만 코어 원본**이다(cart·quotes·orderinquiry 는 테마가 덮었지만 `shop/orderform.sub.php` 는 영카트 마크업): 테마는 `#sod_frm` 스코프 CSS 로 장바구니 시각 문법을 재현하고, `js/orderform-defaults.js`(배송지·결제수단·계좌 기본 선택을 코어 핸들러의 프로그램적 click 으로)·`js/order-vat-breakdown.js`(견적 행 부가세 분해, `extend/sp_quote_cart.extend.php` 의 `sp_quote_it_ids()` + `sp-bom-parts`)를 `shop.head.php` 가 주문서에서만 싣는다. 코어 최소 수정 2곳(기법 #11)은 `ops/scripts/check-core-patches.sh` 가 감시.

## Talks To [coverage: high — 23 sources]

- **영카트 코어 훅**: `G5_THEME_SHOP_PATH/{cart,coupon}.php` include-after-return, `orderinquiry.sub.php` 테마 위임, 코어 `head.sub.php` → 테마 위임. 주문내역 유형 탭은 코어 `get_paging` 이 sub include **뒤에** 실행되는 순서를 이용해 `$total_count/$total_page/$qstr` 를 덮어쓴다(코어 무수정). 홈 게시판은 코어 `latest('theme/home-help', …)`.
- **공유 DB 직접 조회(read-only)**: `g5_shop_banner`('메인')·`sp_config`(`home_slides`, Node 소유 표를 `sql_fetch(…, false)` 로 읽기만)·`sp_seo`·`g5_menu`(GNB)·`g5_point`(소멸 예정 30일)·`g5_shop_coupon`(쿠폰 요약·목록 — 코어와 같은 유효기간·미사용 판정을 `coupon.php` 가 다시 조회)·`sp_order_spec`+`sp_bom_quote`(마이페이지 요약 밴드 합산)·`$default` 쇼핑몰 설정(푸터 회사정보 폴백). `sp_review` 는 `spcb/pages/reviews.php` 만 읽는다(홈 쇼케이스는 09-06 홈 재편으로 제거).
- **sp-node**: `cart.php` 하단 JS 가 `/spcb/api/me` JWT 로 `PATCH·DELETE /api/pcb-projects/:id`·`POST /order`·`GET /cart-thumbs`. 제조 확인·A/S·주문 상세 진행 카드는 서버사이드 브리지(`extend/sp_pcb_eq·sp_pcb_claim·sp_bom_claim.extend.php` → sp-node `*/mine`) — 견적관리(`quotes.php`)만 브라우저 JS 가 두 API(`/api/pcb-projects`·`/api/bom/quotes`)를 한 리스트로 섞는다. 09-30 이후 **부품 확인**이 같은 브리지 문법으로 붙었다: 목록·섹션은 `extend/sp_bom_confirm.extend.php` → sp-node `/api/bom/confirms*`, 회신은 POST+CSRF 브리지(`spcb/api/bom-confirm-answer.php`, 제조 확인 문항형은 `spcb/api/eq-answer.php`), 추가결제만 브라우저 JS(`/spcb/api/me` 토큰 → `POST /api/bom/confirms/settlements/:id/checkout` → 주문서). 상세는 [spcb-bridge](spcb-bridge.md)·[sp-node-api](sp-node-api.md).
- **extend/**: `version.extend.php`(`G5_CSS_VER`/`G5_JS_VER`), `default.config.php`(`SP_USE_WISHLIST`, 기본 false), `sp_quote_cart.extend.php`(견적 it_id SSOT·혼합 카트 `sp_cart_deselect` 쿠키 보정·`sp_bom_extra_it_ids()` → 장바구니 '부품 추가결제' 배지), `sp_partner.extend.php`(`sp_is_approved_partner` → 헤더 '파트너 포탈' 링크, `sp_quote_badge_count`/`sp_cart_badge_count`), `sp_bom_confirm.extend.php`(`sp_bom_confirm_open_count`·`sp_bom_confirm_has_track` → 사이드바·마이페이지 밴드의 '부품 확인').
- **관리측(sp-vue)**: 슬라이드 `/app/admin/slides`(영카트 배너관리와 같은 테이블), SEO `/app/admin/seo`. 히어로 템플릿 on/off 의 관리 UI 는 **없음**(`sp_config.home_slides` 를 직접 넣어야 함 — 미착수 2단계).
- **피그마·검증 도구**: 파일 `Samplepcb_Web`(oviaZUKfcQml2IvwPVICpU) 노드 id 가 각 PHP/CSS 헤더 주석에 박혀 있다. 화면 대조는 `node ops/scripts/shot.mjs <url> <out.png> [--selector|--full|--scroll|--mobile]`(playwright-core + 시스템 Edge, 콘솔·4xx 목록 출력), 히어로 성능·강등 회귀는 `node ops/scripts/hero-perf.mjs perf|verify`(헤드리스 Chrome/Edge + CDP CPU 스로틀 — 배너별 rAF 프레임 간격 / 라이트·감시 강등·리사이즈 점프·이음새 5종 점검). 로그인 배경 실험실 2곳(`spcb/previews/login-bg-claude`·`login-bg-gpt`)은 그누보드 무관 정적 페이지. 움직임의 참고 원본은 외부 사이트 공개 번들이다 — megazone.com 메인(framer-motion `whileInView`)·회사소개 숫자 영역(CountUp), 포트폴리오 마퀴는 korlinx 사이트.
- **e2e**: `customer-eq-menu`·`customer-as-menu`·`orderinquiry-tabs`·`journey-pcb-as-mypage` 스펙이 사이드바 클래스 훅(`nav_group·nav_glabel·lbl·nav_badge·aria-current`)과 탭·총건을 읽는다. 결정 화면은 `journey-bom-confirm`(`#bomc-{id}`·`.sp_bomc_pay`·`#sp_bomc_origin`)·`journey-eq-items-customer`(`#eq-{id}`·`.sp_eqi_card`·`.sp_eqi_submit`·`#sp_eqi_figdlg`)가 테마 마크업을 그대로 읽는다([testing](testing.md)).

## API Surface [coverage: high — 17 sources]

테마라 HTTP API 는 없지만 외부·후속 작업이 의존하는 계약면:

- **홈 확장 계약**: 섹션 = `inc/home/NN-*.php`(번호가 순서, 각 파일은 `$sp_hi` = `img/home` 을 전제) · 스타일 = `css/home.css` 하나 또는 `css/home/*.css` 부분 파일(있으면 우선) · 스크립트 = `js/home/<이름>.js` 가 `export function init()` 을 내보내고 `js/home.js` 의 모듈 목록(현재 `hero·onestop·portfolio·stats·reveal`)에 이름을 추가, `?ver` 는 진입 모듈이 그대로 넘긴다. 새 섹션에 진입 등장을 주려면 `reveal.js` 의 `TARGETS` 에 선택자를 더한다(탭 패널·마퀴는 컨테이너 단위로만).
- **히어로 설정**: `sp_config` key `home_slides` = `{"templates":["gerber-eyes","order-now","korlinx","one-stop","rapid-proto"]}` — 배열 순서·포함 여부가 노출·순서, 행이 없으면 5장 전부. 이미지 슬라이드는 `g5_shop_banner`(`bn_position='메인'`, 기간·device 필터, 실파일 존재 검사). 저사양 강등은 설정이 아니라 런타임 판정이다 — 기기 신호(`deviceMemory ≤4`·코어 ≤2·`saveData`) 또는 회전 중 1.5초 창의 프레임 실측으로 `.sp-hero.is-lite`, 한 번 강등되면 `sessionStorage` 로 같은 탭 다음 페이지도 처음부터 라이트.
- **헤더 메뉴 계약(09-21)**: 링크·노출 순서는 `g5_menu`, **표시명은 테마가 덮는다** — `$sp_header_labels`(DB `me_name` → 「개발/PCB/전자 부품/PCBA」)·`$sp_company_labels`(회사소개 하위는 About US·History·Location 3항목만 통과). 현재 페이지 하위 항목은 `aria-current="page"`, 1차 항목은 `data-menu` 키.
- **결정 화면 딥링크**: `orderinquiryview.php?od_id=…#eq-{회차 id}`·`#bomc-{요청 id}` — 메일·마이페이지 목록(`/shop/eq`·`/shop/parts-confirm`)이 모두 이 앵커로 온다. 목록은 목록만, 선택·회신 폼은 주문 상세 한 곳.
- **링크 슬롯 관례**: 링크는 사용자 결정으로 전부 비어 있다 — `sp_hero_link()`·`sp_help_more()`·`$sp_help_more` 배열에 URL 을 넣으면 `<a>`, 비면 `<span>`. 자리표시 수치는 `$sp_home_stats`(홈) — 연혁의 `$sp_stats` 는 09-21 개편으로 블록째 삭제됐다.
- **계정 셸**: `$sp_account_active` 키 `home|orders|cart|wish|quotes|eq|bomc|as|point|coupon|memo|scrap`; 쇼핑 페이지는 `shop.head.php` 가 자동, 커스텀 페이지는 `.account-layout` 래퍼 + include. '부품 확인'(`bomc`) 메뉴는 조건부 — 대기 건이 있거나 부품 BOM 축 회원일 때만 선다. 쿠폰 페이지는 자기가 센 `$sp_coupon_count` 를 사이드바에 넘겨 요약·목록·배지 수량을 한 조회로 맞춘다. `.nav_badge` 안은 **숫자만**(단위는 `.nav_unit`) — e2e 가 `Number(textContent)` 로 파싱. 주문내역 탭 파라미터 `?track=pcb|bom`(판별키 = 카트행 it_id).
- **CSS 계층·토큰**: 전역 `--sp-*`(`default.css`, **불변** — 사용자 결정) 위에 계정 셸 스코프 `--acc-*`(`#container.is-account, .account-layout`, 피그마 색값), 견적관리 신규 규칙은 `.sp-quotes--fig` 스코프(보관함은 옛 카드 문법 B), 주문 상태 배지 `status_01~06` 전역. 링크 CSS/JS 는 `?ver=G5_CSS_VER`/`G5_JS_VER`(현재 26101102 / 26100208).
- **공용 팝업**: `spDialog.alert(msg, {title,tone,okText})`·`spDialog.confirm(...)` → Promise, 의존성 없음, `textContent` 만(XSS 안전); 서버가 `?sp_msg=` 로 실어 보낸 문구도 로드 직후 모달. 코어 `alert()` 은 `bbs/alert.php` 로 페이지를 통째로 이동시키므로 새 화면은 이것을 쓴다.
- **코어 훅 계약(불변)**: cart 폼 필드(`ct_chk[]`·`it_id[]`·`act`)·`form_check(act)`·`#mod_option_frm` 이름은 코어 JS·`cartupdate.php` 와의 계약. `GET /api/pcb-projects/cart-thumbs` 응답 `data.thumbs = { it_id: URL }`, 교체 대상 `.sp-cart-thumb[data-itid]`.

## Data [coverage: high — 11 sources]

- 테마는 상태를 소유하지 않는다 — cart 는 코어와 같은 `g5_shop_cart` 쿼리를 건별로 다시 풀어 표시, 마이페이지 요약 밴드는 `g5_shop_order`+`sp_order_spec`+`sp_bom_quote` 를 **마이페이지 전용으로 독립 집계**(사이드바 배지와 별개 조회). 견적 대기 = PCB rfq + BOM requested|reviewing, 확정 = PCB quoted·미담김 + BOM answered·확정가·미주문. 쿠폰(09-21)도 같은 방식 — 사용 가능 = 회원 또는 '전체회원' 대상·유효기간 내·미사용(`is_used_coupon`), 소멸 예정 = 그중 오늘~+30일(양 끝 포함) 만료, 사용 기한은 `cp_end` 당일 23:59 까지로 표기(코어가 날짜 단위로 판정). 발급 정책·할인 로직·DB 는 무변경.
- **견적 템플릿 it_id 4종**(`sp-pcb-std`·`sp-mask`·`sp-pcb-adv`·`sp-pcb-flex`)이 cart 분기·주문내역 PCB 탭·부가세 분해의 판별키. 정의는 `extend/sp_quote_cart.extend.php` 의 `sp_quote_it_ids()` 로 모였지만 sp-node `g5-db.ts` `TEMPLATE_ITEMS` 와는 여전히 **수동 동기화**([manual-sync-drift](../concepts/manual-sync-drift.md)). 부품 BOM 은 `sp-bom-parts`, 부품 추가결제 앵커는 `sp-bom-extra`(09-30 — 장바구니 배지·주문서 부가세 분해 대상에 추가).
- **자리표시·권리 미확정 데이터**(운영 배포 전 교체 목록, [FIGMA_PAGES](../../docs/FIGMA_PAGES.md)): 홈 통계 3칸 수치(연혁 통계 4칸은 09-21 개편으로 블록째 삭제), Our Network 로고 20종 사용 허락(회사소개 고객 로고는 Customer 섹션 제거로 빠지고 유통사 5종 합성 이미지만 남음), 회사소개 배너 = **iStock 워터마크가 든 시안 이미지**(알린 뒤 사용자 확정으로 유지), Unsplash+ 워터마크 프리뷰 사진(프로세스 띠), Flaticon 계열 아이콘 출처 표기, One-Stop 안내 가격·생산기간(시안 문구 하드코딩, 견적 계산과 무관)·Turnkey 이미지 빈 자리, 3 EYES GIF 2장(Gerber 0.9MB · Parts 는 10-02 새 원본 136프레임 0.48MB 로 교체 — 옛 4.7MB 해소).
- **연혁·인증 데이터(09-21)**: `$sp_history_groups` = 2026~2022 는 새 시안 내역, 2021~2019 는 옛 내역을 가로 목록 뒤에 보존(사용자 확정) — "2024~2026 부재"는 해소. `$sp_certs` = 시안 원본 10종(특허 3·상표·벤처 2025·경기도유망중소기업·뿌리기업·기업부설연구소·공장등록·여성기업), 마스크 밖 중복 특허증 2장은 제외.
- **에셋 출처**: `img/{home,about,history,location}/` 은 피그마 export 를 헤드리스 Edge 캔버스(node)로 가공한 것(이 PC 엔 python·ImageMagick 없음) — 투명이 필요한 것은 design-context 원본을 crop 값대로, 벡터·래스터 혼합 링(`about/ring-2x.png`)은 2배 PNG 로 구웠다. 고치려면 피그마 노드를 다시 export 해야 한다. 09-21 추가분: 히어로 팬 배경 3장은 PNG→WebP q0.9(265~819KB → 28~46KB, 원본 PNG 는 git 이력 51cac5cc8), 배너 05 영상은 사용자 제공 원본의 3~20초를 FFmpeg 포터블(`.tmp/ffmpeg/`)로 편집한 17초·1280×720·무음 2.6MB(원본은 `.tmp` 보존, 배포 경로엔 편집본만), 배너 01·03·One-Stop 사진은 흰 배경이 구워진 export 대신 **투명 원본**으로 교체.
- 푸터 회사정보는 쇼핑몰 설정 `$default`(`de_admin_company_*`) 가 있으면 그 값, 없으면 피그마 문구 폴백(팩스만 고정) — 관리는 영카트 `/adm` 쇼핑몰설정.
- 위시리스트 데이터(`g5_shop_wish`)·코어 코드는 보존, 진입점만 숨김([wishlist-hidden](../../docs/wishlist-hidden.md)).

## Key Decisions [coverage: high — 28 sources]

- **2026-10-11 — 제조 확인 문항형 회차(D20)의 고객 화면은 주문 상세 부분 파일**(5ae802e7e·540e046b3): `orderinquiryview.php` 가 `format=items` 회차마다 `_pcb_eq_items_round.php` 를 include 하고 문구형(D16) 폼과 섞지 않는다. 형식은 부품 확인(D43) 섹션을 따름(항목 카드·선택지 라디오·확대 `<dialog>`·회신 폼). 화면의 검사(전 항목·의견 필수·동의)는 **안내용**이고 판정은 서버, 알림·확인은 `spDialog`([no-native-dialogs](../concepts/no-native-dialogs.md)). 고객 어휘에 'EQ'·협력사명·공장 원문·그림 파일명을 쓰지 않는다.
- **2026-10-02~04 — 홈 스크롤 진입 페이드업 + 시안 재대조**(8eea76735·0c97980a5·c6946496c): megazone.com 메인의 `whileInView` 패턴을 공개 번들로 확인해 `js/home/reveal.js` 로 옮김(아래 20px·투명 → 0.3초, 1회, 묶음 0.1초 간격) — 숨김 클래스는 JS 가 **첫 화면 아래 요소에만** 걸고 등장 뒤 걷는다. 같은 주에 One-Stop 문구 굵기·색, Parts Eyes 화면 GIF, Our Network 로고 20종 크기를 시안에 다시 맞춤. `3 EYES ↔ Your Idea 간격: 09-22 제거(0px, ea53474ec) → 10-02 복원(데스크톱 141px·1023 이하 80px)`, `회사소개 드롭다운: 8px 위치 보정 → 상위 메뉴 항목 중심 정렬·글자 왼쪽 정렬`.
- **2026-09-30 — 부품 확인(D43) 고객 경로 = 목록은 목록만, 결정은 주문 상세 한 곳**(b9fc5edb7, 유형 확장 D44 는 10-01 8f95e2888): `/shop/parts-confirm` 목록(`spcb/pages/parts-confirm.php`) + 주문 상세 `_bom_confirm_section.php`(`#bomc-{id}`) — 제조 확인 `/shop/eq` 와 같은 결정이라 선택지·근거 팝업·추가결제 버튼이 두 곳에서 갈리지 않는다. 사이드바·마이페이지 밴드의 '부품 확인'은 부품 축 회원에게만(PCB 만 쓰는 회원에게 빈 메뉴를 세우지 않음), 장바구니는 추가결제 행을 계약 행처럼(옵션 수정 없음·'부품 추가결제' 배지).
- **2026-09-21 — 히어로 배경 저사양 대응은 실측으로 원인을 둘로 가른 뒤**(a510320be): 제보 "wide 로 조정하면 배경 끊김" → ① 끊김 주범은 배너 01 SVG 윤곽 회전(매 프레임 404KB `d` 문자열, cpu×4 에서 메인스레드 68%) ② "wide" 는 별개 결함(`--sp-pan` 이 `100vw` 라 리사이즈 순간 146px 점프). 조치 = `.is-lite` 라이트 모드(기기 신호 + 실측 감시)·회전 경량화(샘플 4→8px·30→24fps)·`팬 진폭: 100vw 계산 → 상수 600px`·팬 배경 WebP. 배너 04 backdrop-filter 는 디자인이라 라이트에서만 해제. 회귀 점검은 `hero-perf.mjs verify`.
- **2026-09-21 — 홈 섹션 시안 갱신**(0ea7402c4·47b0c17da·fb7f5e352·7231be7c8·976eb5f14·df1c39c78·4ad7734e0): `배너 05: 정지 사진 → 광명공장 영상(사진은 폴백)`, 배너 02~04 는 전폭 바탕색을 리소스 양끝 색으로 연장해 3720px 초과 화면의 단절 제거, `One-Stop: FR-4 패널만(나머지 탭은 활성 표시만) → PCB 4종 + 서비스 4종 전부 사진·사양·가격·납기 전환`(Parts Sourcing 카드의 복사된 제목 "PCB Assembly" 는 사용자 확정으로 교정, Turnkey 이미지는 비움), 숫자 카운트업(`stats.js`, megazone 회사소개 참고), `Our Network: 호버 정지 → 계속 흐름`, 포트폴리오 6카드 개별 좌표(`data-project` + CSS 변수).
- **2026-09-21 — 헤더 정밀 반영(2331:30387, b7484ec1d)**: 옛 top 노드 2286:1435 는 피그마에서 삭제. `메뉴 문구: g5_menu 그대로(피그마 문구는 예시) → 테마가 표시명 매핑`(링크·순서는 DB 유지), `회사소개 하위: DB 하위메뉴 전부 → About US·History·Location 3항목만`(시안에 없는 Customer·Certification 진입점을 상단에서 제외, 페이지 섹션·DB 원본은 유지 — 사용자 요청). `로고: 합성 logo-header.png → 피그마 원본 img/header/logo.png(177×30)`. 드롭다운은 호버·포커스·Esc·바깥 클릭·모바일 첫 탭을 JS 로.
- **2026-09-21 — 회사소개·연혁을 새 시안으로 개편**(f6a43a983·9c3604bfe): 회사소개는 Customer 섹션이 시안에서 빠져 제거(09-06 에 기록만 해 둔 숫자 충돌·미완성 부제가 함께 소멸), 연혁은 `세로 타임라인 + 자리표시 통계 → 가로 수동 탐색 + 인증 자료 10종`. `이상 징후는 기록만 → 이번엔 사용자 확정으로 교정`(연혁 소개 문장·브레드크럼 「회사소개」→「회사연혁」), 반대로 iStock 워터마크 배너와 시안 푸터의 전화·통신판매업번호는 **알린 뒤 사용자 확정대로** 전자는 시안 유지·후자는 쇼핑몰 설정값 유지.
- **2026-09-21 — 마이페이지 쿠폰 피그마(2334:30444, 6930ab842)**: 시안의 복사 흔적(「포인트 현황」·포인트 메뉴 활성)은 교정, 날짜 열을 빼고 내역/사용 기한 2열, 시안의 「무료배송」 별도 표기는 넣지 않음 — 전부 사용자 승인 조정. 포인트 요약 스타일 공유.
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

## Gotchas [coverage: high — 20 sources]

- **CSS·JS 캐시버스팅은 두 상수 다 올려야 한다** — `extend/version.extend.php` 의 `G5_CSS_VER`(26101102)·`G5_JS_VER`(26100208). 안 올리면 옛 파일이 캐시돼 "적용 안 됨". `js/home.js` 는 자기 `?ver` 를 섹션 모듈·`motion-path.js` 에 넘기므로 홈 JS 도 이 상수 하나로 갱신된다. 스킨 인라인 `<style>` 은 무관. **같은 이름으로 바꿔 끼운 이미지**는 URL 에 `?ver=G5_CSS_VER` 를 직접 붙여야 한다(09-21 이후 `gerber-monitor.png`·`parts-screen.gif`·네트워크 로고) — 영상은 파일명을 바꿔 구분했다. 다른 트랙의 CSS 수정(10-11 제조 확인)도 같은 상수를 올리므로 FIGMA_PAGES 에 적힌 버전은 그 시점 값일 뿐이다.
- **팬 진폭 `--sp-pan` 을 뷰포트 단위로 계산하지 말 것** — `100vw` 기반이면 창 폭이 바뀌는 순간 키프레임 값이 바뀌어 배경이 점프한다(1920→3400 실측 146px). 상수 600px 이 성립하는 근거는 3720 리소스 양끝 색 = 슬라이드 전폭 바탕색이라는 것 — 배경 리소스를 바꾸면 `.sp-s2~4` 바탕색도 같이 맞춰야 이음새가 안 보인다(`hero-perf.mjs verify` ⑤).
- **라이트 강등 감시는 시간 창이어야 한다** — 배너 01 이 6초만 머물러 "프레임 60개 세기"는 판정 전에 슬라이드가 넘어갔다(1.5초 창으로 교정). 실측 감시는 메인스레드만 본다 — 팬·backdrop 의 GPU 부담은 못 잡아 기기 신호·reduced-motion 몫. `deviceMemory` 는 2의 거듭제곱 내림이라 6GB 기기도 4 로 잡혀 라이트가 된다.
- **`reveal.js` 는 transform 을 쓰는 요소에 직접 걸면 안 된다** — 탭 패널(`onestop.js` 의 hidden 토글)·마퀴 트랙(transform 애니메이션)은 컨테이너 단위로만. 히어로·숫자 섹션은 제외 대상(자체 등장). 숨김 클래스를 CSS 기본값으로 옮기면 JS 없는 환경에서 본문이 사라진다.
- **`latest()` 는 1시간 캐시**(`data/cache/latest-*-home-help-*.php`) — 홈 도움말 스킨을 고치면 캐시 파일을 지워야 보인다.
- **`$sp_hi` 리셋 함정**: `inc/main_slider.php` 가 `$sp_hi` 를 `img/home/hero` 로 바꿔 쓰므로 `index.php` 가 부분 파일마다 `img/home` 으로 되돌린다 — 새 섹션 파일을 다른 곳에서 include 하면 이미지가 404.
- **`css/home/` 폴더가 있으면 병합본 `home.css` 는 무시된다**(부분 파일 모드). 작업 뒤 병합·삭제를 잊으면 두 벌이 갈린다.
- **헤더 메뉴는 `g5_menu` + 테마 매핑의 두 겹이다(09-21 부터)** — 링크·순서는 DB 지만 표시명은 `inc/header.php` 의 `$sp_header_labels` 가 `me_name` **문자열 일치**로 덮는다. `/adm` 메뉴설정에서 「PCB 주문」 같은 원래 이름을 바꾸면 매핑이 조용히 빗나가 DB 이름이 그대로 나오고, 회사소개 하위는 화이트리스트(`about us`·`history`·`location`, 소문자 비교)라 **관리자에서 하위메뉴를 추가해도 헤더에 안 나온다**. 드롭다운은 하위메뉴가 남은 1차 항목에만. 09-09 revert 된 서브메뉴 바(2122:9205)를 다시 따라가지 말 것. 헤더 로고는 `img/header/logo.png`, 푸터는 여전히 `img/logo-header.png` — 로고 교체 때 두 파일.
- **`sp_config` 는 Node(Prisma) 소유 표** — PHP 는 `sql_fetch(…, false)` 로 읽기만, 행이 없으면 조용히 기본값. 히어로 템플릿 on/off 관리 UI 가 없어 운영에선 SQL 로 넣어야 한다.
- **화면 대조 `shot.mjs --full` 은 `loading="lazy"` 이미지가 빈 상자** — 뷰포트 + `--scroll` 로 다시 볼 것. Figma MCP 는 `download_assets` PNG 가 흰 배경으로 구워지고 SVG 에 배경 rect·필터가 섞이며 export 가 블렌드 모드를 버린다 — 투명은 design-context 원본을 crop 값대로 자르거나 `exportAsync`.
- **운영 배포 전 체크리스트가 문서에만 있다**: 자리표시 수치(`$sp_home_stats` — 카운트업이 이 문자열을 그대로 센다), 로고 사용 허락, 워터마크·스크린샷 파생 이미지 라이선스(09-21 부터 회사소개 배너의 iStock 워터마크 포함), One-Stop 안내 가격·납기와 빈 Turnkey 이미지, 위치 페이지 "공사" 오타 여부·전화 표기 불일치·Contact Us 미구현. 코드는 피그마 그대로라 이 목록을 읽지 않으면 그대로 나간다. (09-21 개편으로 빠진 항목: 연혁 `$sp_stats` 자리표시·연혁 2024~2026 부재·4.7MB GIF.)
- **연혁 배너는 이중 크롭 함정** — 새 건물 사진 export 가 이미 상위 프레임에 잘린 1920×982 라 프레임 y72~398 구간만 보이면 된다. 피그마 레이어의 x−36/y−509 를 다시 적용하면 두 번 잘린다.
- **결정 화면 부분 파일의 클라이언트 검사는 안내용** — `_pcb_eq_items_round.php`·`_bom_confirm_section.php` 의 "전 항목 선택·의견 필수·동의" 검사를 믿고 서버 판정을 줄이면 안 된다. `<dialog>` 문법이 두 파일에서 다르다: 제조 확인의 그림 확대는 **폼 밖** 하나를 돌려 쓰고(폼 안이면 제출 대상이 섞인다), 부품 확인의 분석근거 팝업은 폼 안이라 `method="dialog"` 를 못 써 JS 로 닫는다. 작성 중(draft) 회차는 sp-node 가 빼고 보내지만 테마도 한 번 더 거른다. 사이드바 '부품 확인'은 조건부 메뉴라 e2e·화면 대조에서 "메뉴가 없다"가 결함이 아닐 수 있다.
- **옛 홈 잔재**: `inc/main_reviews.php` 와 `skin/latest/home/` 은 09-06 이후 어느 페이지도 include 하지 않는다(`reviews_lib.php` 는 `/reviews` 가 계속 사용). 삭제 여부 미결. 09-21 개편도 잔재를 남겼다 — `img/about/` 의 옛 Customer 로고 8종·`ico-tri.svg`·`banner.jpg`, `img/history/` 의 옛 인증서 6장(`cert*.png`)·`fiber.jpg` 는 어느 PHP·CSS 도 참조하지 않는다(FIGMA_PAGES 는 `banner.jpg` 를 "연혁도 쓰므로 보존"이라 적었지만 연혁이 같은 날 `banner-buildings.png` 로 바뀌었다).
- **주문서(`orderform`)만 코어 원본** — 테마 CSS 는 `#sod_frm` 스코프로 누수를 막고 JS 는 코어 핸들러를 프로그램적 click 으로 태운다. 코어 최소 수정 2곳(기법 #11)과 pc 폼 통일은 `check-core-patches.sh` 등록 — subtree pull 뒤 같은 취지로 재적용.
- **`.nav_badge` 안에 단위를 넣으면 e2e 가 깨진다**(`Number()` 파싱). 사이드바 클래스 훅·`aria-current` 유지.
- **인라인 계정 승격은 로그인·PC 한정**(`!G5_IS_MOBILE` 이지만 sp-lite 는 항상 false 라 실질 로그인 조건). `memo_form.php` 는 코어 `get_sideview` 팝업과 이중 역할이라 `?inline=1` 없이는 팝업 그대로.
- **[선택사항수정] 선형 곱 버그는 차단일 뿐** — URL 직접 호출로 코어 `cartoption.php` 팝업에 가면 재현. 수량 변경 정식 경로는 sp-node 재견적(PATCH). 견적 행 삭제는 sp-node lazy reconcile 로 보관함에 수거([lazy-derived-state](../concepts/lazy-derived-state.md)).
- **`mobile/skin/shop` 은 잔재가 아니다** — 코어 관리자(쇼핑몰설정)가 `readdir` 하므로 없으면 PHP8 Fatal. 프런트는 타지 않는다.
- **seo_head 는 전 페이지 경유 코드** — `sql_query($sql, false)` 방어 유지, description·OG 를 `cf_add_meta` 에 넣으면 이중출력. 위시는 `SP_USE_WISHLIST=true` 한 줄로 전체 복귀(직접 URL 은 여전히 동작). 주문 알림 체크박스 게이트는 sp-vue 영역이지만 코어 orderlist 무조건 노출을 결함으로 판단한 인접 결정([order-notify-gating](../../docs/order-notify-gating.md)).

## Sources [coverage: high — 89 sources]

- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — 피그마 → sp-php 페이지 구현 대장(홈·헤더·푸터·about·history·location·쿠폰, 히어로 저사양 대응 실측, 미결·공통 함정) 2026-09-18 / 09-21 / 10-04
- [docs/MYPAGE_REDESIGN.md](../../docs/MYPAGE_REDESIGN.md) — 마이페이지·사이드바·주문내역 탭 재설계 2026-08-25 / 09-15
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) §6.39 · [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) D20 — 부품 확인(D43)·제조 확인 문항형의 고객 화면 파일 색인(정본은 트랙 문서, 여기선 테마 접점만) 2026-09-30 / 10-11
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
- [js/home.js](../../samplepcb-web/theme/sp-lite/js/home.js) · [js/home/hero.js](../../samplepcb-web/theme/sp-lite/js/home/hero.js) · [onestop.js](../../samplepcb-web/theme/sp-lite/js/home/onestop.js) · [portfolio.js](../../samplepcb-web/theme/sp-lite/js/home/portfolio.js) · [stats.js](../../samplepcb-web/theme/sp-lite/js/home/stats.js) · [reveal.js](../../samplepcb-web/theme/sp-lite/js/home/reveal.js) · [js/motion-path.js](../../samplepcb-web/theme/sp-lite/js/motion-path.js) — 홈 모듈(슬라이더·라이트 강등·탭·마퀴·카운트업·진입 등장)·배경 변형 스냅샷
- [js/history.js](../../samplepcb-web/theme/sp-lite/js/history.js) — 연혁 가로 스크롤 ↔ 이동 막대 동기화
- [js/sp-dialog.js](../../samplepcb-web/theme/sp-lite/js/sp-dialog.js) · [js/orderform-defaults.js](../../samplepcb-web/theme/sp-lite/js/orderform-defaults.js) · [js/order-vat-breakdown.js](../../samplepcb-web/theme/sp-lite/js/order-vat-breakdown.js) — 공용 팝업·주문서 보강
- [shop/shop.head.php](../../samplepcb-web/theme/sp-lite/shop/shop.head.php) · [shop/_account_nav.php](../../samplepcb-web/theme/sp-lite/shop/_account_nav.php) · [shop/mypage.php](../../samplepcb-web/theme/sp-lite/shop/mypage.php) · [shop/coupon.php](../../samplepcb-web/theme/sp-lite/shop/coupon.php) — 쇼핑 셸·계정 사이드바 SSOT·요약 밴드
- [shop/cart.php](../../samplepcb-web/theme/sp-lite/shop/cart.php) · [shop/orderinquiry.sub.php](../../samplepcb-web/theme/sp-lite/shop/orderinquiry.sub.php) · [shop/orderinquiryview.php](../../samplepcb-web/theme/sp-lite/shop/orderinquiryview.php) — 장바구니 건별 카드·주문내역 탭·상세 단일 컬럼
- [shop/_pcb_eq_items_round.php](../../samplepcb-web/theme/sp-lite/shop/_pcb_eq_items_round.php) · [shop/_bom_confirm_section.php](../../samplepcb-web/theme/sp-lite/shop/_bom_confirm_section.php) — 주문 상세 결정 화면 부분 파일(제조 확인 문항형 회차·부품 확인)
- [skin/latest/home-help/latest.skin.php](../../samplepcb-web/theme/sp-lite/skin/latest/home-help/latest.skin.php) · [skin/latest/home/latest.skin.php](../../samplepcb-web/theme/sp-lite/skin/latest/home/latest.skin.php)(미사용) — 홈 게시판 스킨
- [skin/member/basic/login.skin.php](../../samplepcb-web/theme/sp-lite/skin/member/basic/login.skin.php) · [point.skin.php](../../samplepcb-web/theme/sp-lite/skin/member/basic/point.skin.php) · [style.css](../../samplepcb-web/theme/sp-lite/skin/member/basic/style.css) — 로그인 카드·포인트 페이지
- [mobile/skin/shop/basic/](../../samplepcb-web/theme/sp-lite/mobile/skin/shop/basic) — 코어 readdir Fatal 방지 복사본
- [extend/version.extend.php](../../samplepcb-web/extend/version.extend.php) · [extend/default.config.php](../../samplepcb-web/extend/default.config.php) · [extend/sp_quote_cart.extend.php](../../samplepcb-web/extend/sp_quote_cart.extend.php) · [extend/sp_partner.extend.php](../../samplepcb-web/extend/sp_partner.extend.php) · [extend/sp_bom_confirm.extend.php](../../samplepcb-web/extend/sp_bom_confirm.extend.php) — 캐시버스팅·위시 토글·견적 it_id·파트너 헬퍼·부품 확인 브리지
- [spcb/pages/about.php](../../samplepcb-web/spcb/pages/about.php) · [history.php](../../samplepcb-web/spcb/pages/history.php) · [location.php](../../samplepcb-web/spcb/pages/location.php) — 정적 페이지 3종(테마 head.php 사용)
- [spcb/pages/quotes.php](../../samplepcb-web/spcb/pages/quotes.php) · [eq.php](../../samplepcb-web/spcb/pages/eq.php) · [as.php](../../samplepcb-web/spcb/pages/as.php) · [parts-confirm.php](../../samplepcb-web/spcb/pages/parts-confirm.php) — 계정 셸을 쓰는 커스텀 페이지
- [shop/cart.php (코어)](../../samplepcb-web/shop/cart.php) · [.htaccess](../../samplepcb-web/.htaccess) — 오버라이드 훅·리라이트
- [ops/scripts/shot.mjs](../../ops/scripts/shot.mjs) · [ops/scripts/hero-perf.mjs](../../ops/scripts/hero-perf.mjs) · [ops/scripts/check-core-patches.sh](../../ops/scripts/check-core-patches.sh) — 화면 대조·히어로 성능/강등 회귀·코어 수정 감시
- [apps/api/src/lib/g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — TEMPLATE_ITEMS(수동 동기화 대상)
- [e2e/specs/orderinquiry-tabs](../../samplepcb-web-mono-app/e2e/specs/orderinquiry-tabs.e2e.test.ts) · [customer-eq-menu](../../samplepcb-web-mono-app/e2e/specs/customer-eq-menu.e2e.test.ts) · [customer-as-menu](../../samplepcb-web-mono-app/e2e/specs/customer-as-menu.e2e.test.ts) · [journey-bom-confirm](../../samplepcb-web-mono-app/e2e/specs/journey-bom-confirm.e2e.test.ts) · [journey-eq-items-customer](../../samplepcb-web-mono-app/e2e/specs/journey-eq-items-customer.e2e.test.ts) — 사이드바·탭·결정 화면 마크업을 읽는 스펙
