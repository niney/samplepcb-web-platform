---
topic: spcb-bridge
last_compiled: 2026-07-06
sources_count: 13
status: active
---

# spcb-bridge

## Purpose [coverage: high — 5 sources]

`samplepcb-web/spcb/`는 그누보드5/영카트(sp-php) subtree **안에 있지만 코어가 아닌** 커스텀 브리지 영역이다. "코어 비수정" 원칙(subtree pull 로 보안 패치를 계속 받기 위함) 아래에서, PHP 쪽에 반드시 있어야 하는 커스텀 코드를 담는 유일한 신규 폴더다. 역할은 세 갈래로 늘었다:

1. **인증 브리지** (`api/me.php`) — 그누보드 세션(PHPSESSID)을 sp-node(Fastify)가 검증 가능한 HS256 JWT 로 변환. 그누보드 = IdP.
2. **주문 알림 브리지** (`api/order-notify.php`, 신규 2026-07-05) — sp-node 가 **역방향으로** 호출. 관리자 주문 상태 전이(입금/배송)의 메일/SMS 를 Node 재구현이 아니라 레거시 커스텀 메일 템플릿 재사용으로 발송.
3. **사용자 노출 커스텀 페이지** (`pages/`) — 견적관리(`/shop/quotes`), 지난 견적 보관함(`/shop/quotes/archive`), 정적 페이지(`/about`, `/spec`). 결제 연계(세션·orderform)가 있어 sp-vue 가 아닌 PHP 영역에 두었다.

## Architecture [coverage: high — 7 sources]

```
samplepcb-web/spcb/
├── .htaccess              무확장 URL 라우팅 (/spcb/api/me → me.php), Authorization 패스스루, Options -Indexes
├── api/
│   ├── me.php             인증 브리지: 세션 → JWT(10분) + Me 응답
│   └── order-notify.php   주문 알림 브리지(신규): 서비스 JWT 검증 → 커스텀 메일/SMS 발송
├── lib/                   include 전용 — 웹 접근 전면 차단
│   ├── .htaccess          Require all denied (Apache 2.4)
│   ├── jwt.php            순수 PHP HS256 인코더 + spcb_jwt_decode(검증) — Composer 없음, _GNUBOARD_ 가드
│   ├── secret.php         SPCB_JWT_SECRET (gitignore — apps/api/.env 와 수동 동기화)
│   └── secret.php.example
└── pages/                 사용자 노출 페이지 (셸 + JS 렌더링 패턴)
    ├── quotes.php         견적관리 /shop/quotes
    ├── quotes-archive.php 지난 견적 보관함 /shop/quotes/archive
    ├── about.php          회사소개 /about
    └── spec.php           생산규격 /spec (준비 중)
```

- 모든 파일이 `include_once __DIR__ . '/../../common.php'` 로 그누보드를 부트스트랩 — `$member`·`$config`·테마 상수·메일/SMS 라이브러리를 얻는다. 코어를 고치지 않고 코어 기능을 빌려 쓰는 구조.
- **라우팅은 Apache mod_rewrite 두 겹** (nginx 는 `/spcb` 를 catch-all `/` 로 PHP 에 넘길 뿐):
  - `spcb/.htaccess`: ① **Authorization 헤더 패스스루**(신규 — 일부 Apache/mod_php 가 Bearer 를 CGI 로 안 넘겨, `order-notify.php` 의 서비스 JWT 검증이 `HTTP_AUTHORIZATION` 을 읽게 `E=` 반영) ② 실존 파일/디렉터리 그대로 ③ 확장자 없는 요청을 같은 이름 `.php` 로 내부 리라이트(`/spcb/api/me` → `me.php`).
  - 루트 `samplepcb-web/.htaccess`: 실존 파일 우선 + 최상위 슬러그 `/{slug}` → `spcb/pages/{slug}.php` + `/shop/quotes`·`/shop/quotes/archive` 명시 리라이트.
- `pages/quotes*.php` 는 **셸 패턴**: PHP 는 레이아웃·로그인 유도·템플릿 상품 썸네일만 담당, 데이터는 브라우저 JS 가 같은 도메인 sp-node API(`/api/pcb-projects`)를 호출해 렌더링한다.

## Talks To [coverage: high — 6 sources]

| 상대 | 방향 | 내용 |
|---|---|---|
| 그누보드 코어 | include | `common.php` 부트스트랩(세션·회원·테마·메일/SMS), `set_cart_id()`/`get_session('ss_cart_id')`, `mailer.lib.php`, `ordermail.inc.php` |
| sp-node (Fastify `/api`) | **양방향** | ① me.php 발급 JWT 를 브라우저가 `Bearer` 로 전달; pages/ JS 가 `/api/pcb-projects` 호출 ② **sp-node → order-notify.php**: 상태 전이 시 서비스 JWT(`svc:'sp-node'`)로 알림 위임 |
| sp-vue · 거버 뷰어 (React) | 클라이언트 | `GET /spcb/api/me` (credentials: include) 로 토큰 수령 |
| 영카트 shop | 링크·리다이렉트 | [바로 주문]→`orderform.php`, 빈 화면→`cart.php`, 비로그인→`bbs/login.php?url=…` |
| 테마 sp-lite | asset | `default_shop.css` 직접 링크 — cart.php 카드 문법 재사용 |

CORS: me.php 는 `https://*.samplepcb.co.kr` 오리진만 반사 허용(credentialed 라 와일드카드 불가) — dev 교차 서브도메인용. order-notify.php 는 브라우저가 아닌 서버 호출이라 CORS 대상 아님.

## API Surface [coverage: high — 6 sources]

**`GET /spcb/api/me`** (me.php — 인증 엔드포인트)
- 세션으로 회원 확인. 비로그인 → `401 {"message":"not authenticated"}`.
- 성공 → `{ token, member: { mbId, mbNick, level, isAdmin } }`. `Cache-Control: no-store`.
- JWT 클레임: `mbId`·`mbNick`·`level`·`isAdmin`(현재 최고관리자 `cf_admin` 만 true)·`cartId`·`iat`·`exp`(발급+600초 = **10분**). sp-node `@sp/api-contract` `Me`/`JwtClaims` 와 필드·타입 정합.
- **`cartId` 클레임** = 영카트 세션 `ss_cart_id`(없으면 `set_cart_id()` 생성) = `g5_shop_cart.od_id`. sp-node 담기 API 가 이 값으로 INSERT 해야 cart.php 에 보인다.

**`POST /spcb/api/order-notify`** (order-notify.php — 알림 브리지, 신규 2026-07-05)
- sp-node `php-bridge.ts` `notifyOrderEvent` 가 호출. **서비스 JWT**(`svc:'sp-node'`, HS256, 같은 시크릿) 를 Bearer 로 전달 → `spcb_jwt_decode` 로 검증.
- 이벤트(`입금`/`배송`)별로 **레거시 커스텀 메일 템플릿**(`adm/shop_admin/ordermail.inc.php`) include + `mailer()` 발송, SMS 는 `conv_sms_contents` 미러. `dryRun` 프리뷰 지원.
- 응답 `{mail, sms}` = `sent`/`skipped`/`failed`. **`mailer()` 반환값을 검사하지 않아** 실제 SMTP 실패는 `apache/logs/error.log` 로만 확인(브리지는 `sent` 응답). 발송 조건 미충족(준비/완료 이벤트, 수납액/운송장 없음, `cf_email_use=0`)이면 `skipped`.

**페이지 URL** (라우팅 표면)
- `/shop/quotes`·`/quotes` → quotes.php · `/shop/quotes/archive`·`/quotes-archive` → quotes-archive.php · `/about`·`/spec` → 정적

## Data [coverage: medium — 4 sources]

spcb/ 자체는 **DB 테이블을 소유하지 않는다**. 데이터 실체(sp_quote·sp_order_spec 등)는 sp-node(Prisma) 소유, spcb 는 세션·JWT 로 식별자만 흘린다.

- 시크릿: `lib/secret.php` 의 `SPCB_JWT_SECRET` ↔ `apps/api/.env` 의 `JWT_SECRET` — **같은 값 수동 동기화**(gitignore, `.example` 만 추적). **회원 JWT·서비스 JWT 양쪽이 같은 대칭키**를 쓴다.
- 알림 발송 시 그누보드 `g5_config`(`cf_email_use`·`cf_sms_use`)·`g5_shop_default`(`de_sms_use4/5`)·`g5_shop_order`(수납액·운송장)를 코어 함수 경유로 읽어 조건 판정.
- 견적 카드 썸네일: 템플릿 상품 4종 매핑(`standard→sp-pcb-std` 등) — sp-node `g5-db.ts` `TEMPLATE_ITEMS` 와 **수동 동기화**(양쪽 중복 정의 결합점).

## Key Decisions [coverage: high — 6 sources]

- **코어 비수정 원칙의 PHP 측 수용처가 spcb/** — 커스텀 PHP 는 전부 이 폴더(+테마·extend)에. 라우팅도 `.htaccess` 리라이트로만.
- **알림은 Node 가 아니라 PHP 브리지 재사용** — sp-node 가 메일/SMS 를 재구현하지 않고 `order-notify.php` 로 위임해 레거시 `ordermail.inc.php`·`mailer.lib.php` 를 그대로 쓴다. 발송 실패는 전이 성공을 흔들지 않게 sp-node 가 삼킨다(부수효과 분리).
- **서비스 JWT 로 브리지 인증** — 사용자 세션 없이 서버끼리 호출하므로 `svc:'sp-node'` 클레임 JWT 를 회원 JWT 와 **같은 시크릿**으로 서명·검증. `.htaccess` Authorization 패스스루가 전제.
- **사용자 노출 견적 페이지는 sp-php(spcb/pages/)** — 결제 연계가 있는 PHP 영역이 자연스럽고, 레거시 `estimate_*` 는 EAV 전제라 이식 가치 없음(GERBER 6장).
- **JWT TTL 10분·매 액션 전 재발급·저장 금지** — 세션이 진실원본.
- **독립 모델 — 한 건은 한 화면에만** — 견적관리/장바구니·주문내역/보관함 배타 소속. cart 삭제는 lazy reconcile 로 수거.
- **jwt.php 는 Composer 없는 순수 PHP** — 인코더 + `spcb_jwt_decode` 검증, sp-node `@fastify/jwt`(HS256) 호환.

## Gotchas [coverage: high — 5 sources]

- **알림이 안 나가면 확인 순서**: ① `SPCB_BRIDGE_URL`/JWT 시크릿 정합(불일치=401·브리지 호출 자체 없음) ② `access.log` 에 `POST /spcb/api/order-notify` 기록 여부 ③ 로컬은 `127.0.0.1:25` Mailpit 기동(config.php 가 SMTP 모드) ④ 발송 조건(입금/배송 이벤트·수납액/운송장·cf_email_use) — 상세 `docs/LOCAL_MAIL_TESTING.md`·`docs/order-notify-gating.md`.
- **브리지는 `sent` 라도 실제 발송 실패 가능** — `order-notify.php` 는 `mailer()` 반환을 검사 안 함. 실패는 `apache/logs/error.log` 로만.
- **Authorization 패스스루 없으면 서비스 JWT 유실** — 일부 mod_php 조합이 Bearer 를 CGI 로 안 넘긴다. `.htaccess` 의 `E=HTTP_AUTHORIZATION` 규칙 필수.
- `lib/` 는 include 전용 — `Require all denied` + `_GNUBOARD_` 가드 이중 차단.
- 무확장/슬러그 라우팅은 **Apache(mod_php) 전제** — vhost `AllowOverride All` + mod_rewrite. nginx 와 무관(`/spcb` 는 catch-all).
- me.php 의 CORS 는 **https 오리진만** — http dev 오리진 미반사.
- `secret.php` 는 gitignore — 새 환경은 `.example` 복사 후 `apps/api/.env` `JWT_SECRET` 과 같은 값. 알림·인증 둘 다 이 한 값에 걸린다.
- 썸네일 category→it_id 매핑이 sp-node `TEMPLATE_ITEMS` 와 수동 동기화 — 템플릿 변경 시 quotes.php·quotes-archive.php 두 곳 수정.

## Sources [coverage: high — 13 sources]

- [samplepcb-web/spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — 무확장 라우팅·Authorization 패스스루
- [samplepcb-web/spcb/api/me.php](../../samplepcb-web/spcb/api/me.php) — 인증 브리지 본체
- [samplepcb-web/spcb/api/order-notify.php](../../samplepcb-web/spcb/api/order-notify.php) — 주문 알림 브리지(신규)
- [samplepcb-web/spcb/lib/jwt.php](../../samplepcb-web/spcb/lib/jwt.php) — HS256 인코더 + spcb_jwt_decode
- [samplepcb-web/spcb/lib/.htaccess](../../samplepcb-web/spcb/lib/.htaccess) — lib 웹 접근 차단
- [samplepcb-web/spcb/lib/secret.php.example](../../samplepcb-web/spcb/lib/secret.php.example) — 시크릿 템플릿
- [samplepcb-web/spcb/pages/quotes.php](../../samplepcb-web/spcb/pages/quotes.php) — 견적관리
- [samplepcb-web/spcb/pages/quotes-archive.php](../../samplepcb-web/spcb/pages/quotes-archive.php) — 지난 견적 보관함
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 루트 슬러그·/shop/quotes 라우팅
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 인증·알림 브리지 계약·관련 파일 색인
- [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — 발송 경로·Mailpit·트러블슈팅
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 발송 조건·게이트 정책
- [AGENTS.md](../../AGENTS.md) — 인증 브리지 단일 설명원본
