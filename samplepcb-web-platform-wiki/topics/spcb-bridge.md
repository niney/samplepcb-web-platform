---
topic: spcb-bridge
last_compiled: 2026-07-13
sources_count: 16
status: active
---

# spcb-bridge

## Purpose [coverage: high — 6 sources]

`samplepcb-web/spcb/`는 그누보드5/영카트(sp-php) subtree **안에 있지만 코어가 아닌** 커스텀 브리지 영역이다. "코어 비수정" 원칙(subtree pull 로 보안 패치를 계속 받기 위함) 아래에서, PHP 쪽에 반드시 있어야 하는 커스텀 코드를 담는 유일한 신규 폴더다. 역할은 세 갈래:

1. **인증 브리지** (`api/me.php`) — 그누보드 세션(PHPSESSID)을 sp-node(Fastify)가 검증 가능한 HS256 JWT 로 변환. 그누보드 = IdP.
2. **주문 알림 브리지** (`api/order-notify.php`, 2026-07-05) — sp-node 가 **역방향으로** 호출. 관리자 주문 상태 전이(입금/배송)의 메일/SMS 를 Node 재구현이 아니라 레거시 커스텀 메일 템플릿 재사용으로 발송.
3. **사용자 노출 커스텀 페이지** (`pages/`) — 견적관리(`/shop/quotes`), 지난 견적 보관함(`/shop/quotes/archive`), **고객후기 `/reviews`(신규 2026-07-10 — `sp_review` 별점후기 공개 열람)**, 정적 페이지(`/about`, `/spec`). 견적 페이지는 결제 연계(세션·orderform)가 있어 sp-vue 가 아닌 PHP 영역에 두었다.

견적 페이지의 위상도 강해졌다: **위시리스트 진입점 전부 숨김(`SP_USE_WISHLIST` 토글, 2026-07-06)** 으로 "저장 → 나중에 주문" 흐름이 견적관리(`/shop/quotes`)로 **일원화**됐다 — 영카트 위시는 `it_id` 북마크라 템플릿 공유형 PCB 견적과 구조적으로 비호환.

## Architecture [coverage: high — 9 sources]

```
samplepcb-web/spcb/
├── .htaccess              무확장 URL 라우팅 (/spcb/api/me → me.php), Authorization 패스스루, Options -Indexes
├── api/
│   ├── me.php             인증 브리지: 세션 → JWT(10분) + Me 응답
│   └── order-notify.php   주문 알림 브리지: 서비스 JWT 검증 → 커스텀 메일/SMS 발송
├── lib/                   include 전용 — 웹 접근 전면 차단
│   ├── .htaccess          Require all denied (Apache 2.4)
│   ├── jwt.php            순수 PHP HS256 인코더 + spcb_jwt_decode(검증) — Composer 없음, _GNUBOARD_ 가드
│   ├── secret.php         SPCB_JWT_SECRET (gitignore — apps/api/.env 와 수동 동기화)
│   └── secret.php.example
└── pages/                 사용자 노출 페이지
    ├── quotes.php         견적관리 /shop/quotes (셸 + JS 렌더링)
    ├── quotes-archive.php 지난 견적 보관함 /shop/quotes/archive (셸 + JS 렌더링)
    ├── reviews.php        고객후기 /reviews (신규 — 서버 렌더, sp_review 직접 SELECT)
    ├── about.php          회사소개 /about
    └── spec.php           생산규격 /spec (준비 중)
```

- 모든 파일이 `include_once __DIR__ . '/../../common.php'` 로 그누보드를 부트스트랩 — `$member`·`$config`·테마 상수·메일/SMS 라이브러리·`sql_*` 함수를 얻는다. 코어를 고치지 않고 코어 기능을 빌려 쓰는 구조.
- **라우팅은 Apache mod_rewrite 두 겹** (nginx 는 `/spcb` 를 catch-all `/` 로 PHP 에 넘길 뿐):
  - `spcb/.htaccess`: ① **Authorization 헤더 패스스루**(일부 Apache/mod_php 가 Bearer 를 CGI 로 안 넘겨, `order-notify.php` 의 서비스 JWT 검증이 `HTTP_AUTHORIZATION` 을 읽게 `E=` 반영) ② 실존 파일/디렉터리 그대로 ③ 확장자 없는 요청을 같은 이름 `.php` 로 내부 리라이트(`/spcb/api/me` → `me.php`).
  - 루트 `samplepcb-web/.htaccess`: 실존 파일 우선 + 최상위 슬러그 `/{slug}` → `spcb/pages/{slug}.php` + `/shop/quotes`·`/shop/quotes/archive` 명시 리라이트. **`/reviews` 는 규칙 2(슬러그 자동 매칭)로 커버 — `.htaccess` 무변경으로 신설**됐다.
- `pages/` 렌더링 패턴은 **두 갈래**:
  - `quotes*.php` = **셸 패턴** — PHP 는 레이아웃·로그인 유도·템플릿 상품 썸네일만, 데이터는 브라우저 JS 가 같은 도메인 sp-node API(`/api/pcb-projects`)를 호출해 렌더링.
  - `reviews.php` = **서버 렌더 브릿지** — 로그인 불필요 읽기 전용 공개 페이지라 그누보드 `sql_query` 로 `sp_review` 를 직접 조회해 PHP 가 그린다(메인 슬라이드 `inc/main_slider.php` 와 동형). 페이징은 코어 `get_paging()` 재사용.
- **계정 사이드바 공유(2026-07-06)**: `quotes.php`·`quotes-archive.php` 가 테마 SSOT `theme/sp-lite/shop/_account_nav.php` 를 include(`$sp_account_active='quotes'`) — 마이페이지·주문내역·장바구니·견적관리 공통 내비. `reviews.php` 는 테마 공용 헬퍼 `theme/sp-lite/inc/reviews_lib.php`(`sp_review_mask/name/body/stars`)를 include — 홈 별점후기 쇼케이스(`inc/main_reviews.php`)와 공유.

## Talks To [coverage: high — 8 sources]

| 상대 | 방향 | 내용 |
|---|---|---|
| 그누보드 코어 | include | `common.php` 부트스트랩(세션·회원·테마·메일/SMS·sql_*), `set_cart_id()`/`get_session('ss_cart_id')`, `mailer.lib.php`, `ordermail.inc.php`, `get_paging()` |
| sp-node (Fastify `/api`) | **양방향** | ① me.php 발급 JWT 를 브라우저가 `Bearer` 로 전달; quotes 페이지 JS 가 `/api/pcb-projects` 호출 ② **sp-node → order-notify.php**: 상태 전이 시 서비스 JWT(`svc:'sp-node'`)로 알림 위임 |
| sp-vue · sp-market · 거버 뷰어 | 클라이언트 | `GET /spcb/api/me` (credentials: include) 로 토큰 수령 |
| 영카트 shop | 링크·리다이렉트 | [바로 주문]→`orderform.php`, 빈 화면→`cart.php`, 비로그인→`bbs/login.php?url=…` |
| 테마 sp-lite | include·asset | `_account_nav.php`(계정 사이드바 SSOT)·`inc/reviews_lib.php`(후기 헬퍼) include, `default_shop.css` 직접 링크(cart 카드 문법 재사용) |
| `sp_review` (Prisma 소유 테이블) | **read-only SELECT** | reviews.php 가 그누보드 `sql_query` 로 직접 조회(isConfirm=1 만) — "PHP 는 sp_* 미접근" 원칙의 읽기 전용 예외 |

CORS: me.php 는 `https://*.samplepcb.co.kr` 오리진만 반사 허용(credentialed 라 와일드카드 불가) — dev 교차 서브도메인용. order-notify.php 는 브라우저가 아닌 서버 호출이라 CORS 대상 아님. reviews.php 는 일반 페이지라 무관.

## API Surface [coverage: high — 6 sources]

**`GET /spcb/api/me`** (me.php — 인증 엔드포인트)
- 세션으로 회원 확인. 비로그인 → `401 {"message":"not authenticated"}`.
- 성공 → `{ token, member: { mbId, mbNick, level, isAdmin } }`. `Cache-Control: no-store`.
- JWT 클레임: `mbId`·`mbNick`·`level`·`isAdmin`(현재 최고관리자 `cf_admin` 만 true)·`cartId`·`iat`·`exp`(발급+600초 = **10분**). sp-node `@sp/api-contract` `Me`/`JwtClaims` 와 필드·타입 정합.
- **`cartId` 클레임** = 영카트 세션 `ss_cart_id`(없으면 `set_cart_id()` 생성) = `g5_shop_cart.od_id`. sp-node 담기 API 가 이 값으로 INSERT 해야 cart.php 에 보인다.

**`POST /spcb/api/order-notify`** (order-notify.php — 알림 브리지)
- sp-node `php-bridge.ts` `notifyOrderEvent` 가 호출. **서비스 JWT**(`svc:'sp-node'`, HS256, 같은 시크릿) 를 Bearer 로 전달 → `spcb_jwt_decode` 로 검증.
- 이벤트(`입금`/`배송`)별로 **레거시 커스텀 메일 템플릿**(`adm/shop_admin/ordermail.inc.php`) include + `mailer()` 발송, SMS 는 `conv_sms_contents` 미러. `dryRun` 프리뷰 지원.
- 응답 `{mail, sms}` = `sent`/`skipped`/`failed`. **`mailer()` 반환값을 검사하지 않아** 실제 SMTP 실패는 `apache/logs/error.log` 로만 확인(브리지는 `sent` 응답). 발송 조건 미충족(준비/완료 이벤트, 수납액/운송장 없음, `cf_email_use=0`)이면 `skipped`.

**페이지 URL** (라우팅 표면)
- `/shop/quotes`·`/quotes` → quotes.php · `/shop/quotes/archive`·`/quotes-archive` → quotes-archive.php · **`/reviews` → reviews.php(신규, `?page=` 페이지네이션)** · `/about`·`/spec` → 정적

## Data [coverage: high — 5 sources]

spcb/ 자체는 **DB 테이블을 소유하지 않는다**. 데이터 실체(sp_quote·sp_order_spec·sp_review 등)는 sp-node(Prisma) 소유. 다만 접근 방식이 페이지별로 다르다:

- quotes 계열: 세션·JWT 로 식별자만 흘리고 데이터는 sp-node API 경유(직접 쿼리 없음).
- **reviews.php: `sp_review` 를 그누보드 `sql_query` 로 read-only 직접 SELECT** — `isConfirm=1` 노출 게이트, 최신순, 10건/페이지, `legacyJson` 에서 `is_name`(작성자 실명) JSON 추출. 본문은 태그 전제거→`html_entity_decode`→재이스케이프→`nl2br`(XSS 차단), 작성자 실명 가운데 마스킹(관리자 답변 본문도 동일 규칙), `mbId`(이메일 PII) 미노출.
- 시크릿: `lib/secret.php` 의 `SPCB_JWT_SECRET` ↔ `apps/api/.env` 의 `JWT_SECRET` — **같은 값 수동 동기화**(gitignore, `.example` 만 추적). **회원 JWT·서비스 JWT 양쪽이 같은 대칭키**를 쓴다.
- 알림 발송 시 그누보드 `g5_config`(`cf_email_use`·`cf_sms_use`)·`g5_shop_default`(`de_sms_use4/5`)·`g5_shop_order`(수납액·운송장)를 코어 함수 경유로 읽어 조건 판정.
- 견적 카드 썸네일: 템플릿 상품 매핑(`standard→sp-pcb-std` 등) — sp-node `g5-db.ts` `TEMPLATE_ITEMS` 와 **수동 동기화**(양쪽 중복 정의 결합점).

## Key Decisions [coverage: high — 8 sources]

- **2026-07-10 — 별점후기 노출은 표준 itemuselist 가 아니라 sp_review 직접 조회 브릿지** — `/shop/itemuselist.php` 는 ① `g5_shop_item_use` 0건(데이터가 `sp_review` 로 변환 이관) ② 후기 `it_id`(레거시 50종) ∩ 타깃 상품(템플릿 5종)=0 INNER JOIN 으로 구조적 표시 불가. 코어·`.htaccess` 무변경으로 `spcb/pages/reviews.php` 신설(읽기 전용 1단계 — 노출토글·신규 작성은 후속).
- **2026-07-06 — 위시리스트 숨김·견적관리 일원화** — 영카트 위시는 `it_id` 북마크라 견적(같은 템플릿 공유)을 식별 못 하고 위시→장바구니가 껍데기(`io_id=''`). `SP_USE_WISHLIST`(기본 false, `extend/default.config.php`) 뒤로 진입점만 숨기고 코드·DB 는 보존 — `/shop/quotes`+보관함이 "저장 → 나중에 주문"을 사양 포함으로 대체.
- **2026-07-06 — 계정 사이드바 SSOT 공유** — quotes·quotes-archive 가 테마 `_account_nav.php` 를 include, 마이페이지·주문내역·장바구니·견적관리 내비를 한 곳에서 관리.
- **2026-07-05 — 알림은 Node 가 아니라 PHP 브리지 재사용** — sp-node 가 메일/SMS 를 재구현하지 않고 `order-notify.php` 로 위임해 레거시 `ordermail.inc.php`·`mailer.lib.php` 를 그대로 쓴다. 발송 실패는 전이 성공을 흔들지 않게 sp-node 가 삼킨다(부수효과 분리).
- **2026-07-05 — 서비스 JWT 로 브리지 인증** — 사용자 세션 없이 서버끼리 호출하므로 `svc:'sp-node'` 클레임 JWT 를 회원 JWT 와 **같은 시크릿**으로 서명·검증. `.htaccess` Authorization 패스스루가 전제.
- **2026-07-03 — 사용자 노출 견적 페이지는 sp-php(spcb/pages/)** — 결제 연계가 있는 PHP 영역이 자연스럽고, 레거시 `estimate_*` 는 EAV 전제라 이식 가치 없음(GERBER 6장).
- **2026-07-03 — 독립 모델: 한 건은 한 화면에만** — 견적관리/장바구니·주문내역/보관함 배타 소속. cart 삭제는 lazy reconcile 로 수거.
- **2026-07-02 — 코어 비수정 원칙의 PHP 측 수용처가 spcb/** — 커스텀 PHP 는 전부 이 폴더(+테마·extend)에. 라우팅도 `.htaccess` 리라이트로만. JWT 는 TTL 10분·매 액션 전 재발급·저장 금지(세션=진실원본), `jwt.php` 는 Composer 없는 순수 PHP(sp-node `@fastify/jwt` HS256 호환).

## Gotchas [coverage: high — 7 sources]

- **알림이 안 나가면 확인 순서**: ① `SPCB_BRIDGE_URL`/JWT 시크릿 정합(불일치=401·브리지 호출 자체 없음) ② `access.log` 에 `POST /spcb/api/order-notify` 기록 여부 ③ 로컬은 `127.0.0.1:25` Mailpit 기동(config.php 가 SMTP 모드) ④ 발송 조건(입금/배송 이벤트·수납액/운송장·cf_email_use) — 상세 `docs/LOCAL_MAIL_TESTING.md`·`docs/order-notify-gating.md`.
- **브리지는 `sent` 라도 실제 발송 실패 가능** — `order-notify.php` 는 `mailer()` 반환을 검사 안 함. 실패는 `apache/logs/error.log` 로만.
- **Authorization 패스스루 없으면 서비스 JWT 유실** — 일부 mod_php 조합이 Bearer 를 CGI 로 안 넘긴다. `.htaccess` 의 `E=HTTP_AUTHORIZATION` 규칙 필수.
- `lib/` 는 include 전용 — `Require all denied` + `_GNUBOARD_` 가드 이중 차단.
- 무확장/슬러그 라우팅은 **Apache(mod_php) 전제** — vhost `AllowOverride All` + mod_rewrite. nginx 와 무관(`/spcb` 는 catch-all).
- me.php 의 CORS 는 **https 오리진만** — http dev 오리진 미반사.
- `secret.php` 는 gitignore — 새 환경은 `.example` 복사 후 `apps/api/.env` `JWT_SECRET` 과 같은 값. 알림·인증 둘 다 이 한 값에 걸린다.
- 썸네일 category→it_id 매핑이 sp-node `TEMPLATE_ITEMS` 와 수동 동기화 — 템플릿 변경 시 quotes.php·quotes-archive.php 두 곳 수정.
- **reviews.php 는 shop.head 밖** — `default_shop.css` 가 로드되지 않아 페이징(`pg_*`) 스타일을 페이지 인라인 `<style>` 로 직접 정의. 인라인이라 `G5_CSS_VER` 캐시버스팅 무관.
- **답변 실명 마스킹의 한계** — 관리자 답변에서 작성자 본인 이름만 마스킹(제3자 이름 호명은 미커버). 신규 작성/관리 기능 도입 시 정책 재점검 필요.
- 숨긴 위시리스트는 **직접 URL 로는 여전히 동작**(`shop/wishlist.php` 순정 보존) — UI 도달 경로만 제거된 상태. 되살리려면 `SP_USE_WISHLIST=true` 한 줄.

## Sources [coverage: high — 16 sources]

- [samplepcb-web/spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — 무확장 라우팅·Authorization 패스스루
- [samplepcb-web/spcb/api/me.php](../../samplepcb-web/spcb/api/me.php) — 인증 브리지 본체
- [samplepcb-web/spcb/api/order-notify.php](../../samplepcb-web/spcb/api/order-notify.php) — 주문 알림 브리지
- [samplepcb-web/spcb/lib/jwt.php](../../samplepcb-web/spcb/lib/jwt.php) — HS256 인코더 + spcb_jwt_decode
- [samplepcb-web/spcb/lib/.htaccess](../../samplepcb-web/spcb/lib/.htaccess) — lib 웹 접근 차단
- [samplepcb-web/spcb/lib/secret.php.example](../../samplepcb-web/spcb/lib/secret.php.example) — 시크릿 템플릿
- [samplepcb-web/spcb/pages/quotes.php](../../samplepcb-web/spcb/pages/quotes.php) — 견적관리(계정 사이드바 include)
- [samplepcb-web/spcb/pages/quotes-archive.php](../../samplepcb-web/spcb/pages/quotes-archive.php) — 지난 견적 보관함
- [samplepcb-web/spcb/pages/reviews.php](../../samplepcb-web/spcb/pages/reviews.php) — 고객후기 /reviews (신규)
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 루트 슬러그·/shop/quotes 라우팅
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 인증·알림 브리지 계약·관련 파일 색인
- [docs/review-naming.md](../../docs/review-naming.md) — 후기 명칭 정리·/reviews 신설 배경·안전 처리
- [docs/wishlist-hidden.md](../../docs/wishlist-hidden.md) — 위시리스트 숨김·견적관리 일원화 결정
- [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — 발송 경로·Mailpit·트러블슈팅
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 발송 조건·게이트 정책
- [AGENTS.md](../../AGENTS.md) — 인증 브리지 단일 설명원본
