---
topic: spcb-bridge
last_compiled: 2026-07-03
sources_count: 12
status: active
---

# spcb-bridge

## Purpose [coverage: high — 5 sources]

`samplepcb-web/spcb/`는 그누보드5/영카트(sp-php) subtree **안에 있지만 코어가 아닌** 커스텀 브리지 영역이다. "코어 비수정" 원칙(subtree pull 로 보안 패치를 계속 받기 위함) 아래에서, PHP 쪽에 반드시 있어야 하는 커스텀 코드를 담는 유일한 신규 폴더다. 역할은 두 갈래:

1. **인증 브리지** (`api/me.php`) — 그누보드 세션(PHPSESSID)을 sp-node(Fastify)가 검증 가능한 HS256 JWT 로 변환. 그누보드 = IdP.
2. **사용자 노출 커스텀 페이지** (`pages/`) — 견적관리(`/shop/quotes`), 지난 견적 보관함(`/shop/quotes/archive`), 정적 페이지(`/about`, `/spec`). 결제 연계(세션·orderform)가 있어 sp-vue 가 아닌 PHP 영역에 두었다.

## Architecture [coverage: high — 7 sources]

```
samplepcb-web/spcb/
├── .htaccess              무확장 URL 라우팅 (/spcb/api/me → me.php), Options -Indexes
├── api/
│   └── me.php             인증 브리지: 세션 → JWT(10분) + Me 응답
├── lib/                   include 전용 — 웹 접근 전면 차단
│   ├── .htaccess          Require all denied (Apache 2.4)
│   ├── .gitignore         secret.php 제외
│   ├── jwt.php            순수 PHP HS256 인코더 (Composer 없음, _GNUBOARD_ 가드)
│   ├── secret.php         SPCB_JWT_SECRET (gitignore — apps/api/.env 와 수동 동기화)
│   └── secret.php.example
└── pages/                 사용자 노출 페이지 (셸 + JS 렌더링 패턴)
    ├── quotes.php         견적관리 /shop/quotes
    ├── quotes-archive.php 지난 견적 보관함 /shop/quotes/archive
    ├── about.php          회사소개 /about (레거시 company_v2 마이그레이션)
    └── spec.php           생산규격 /spec (준비 중)
```

- 모든 파일이 `include_once __DIR__ . '/../../common.php'` 로 그누보드를 부트스트랩 — `$member`, `$is_member`, `$config`, 테마 상수를 얻는다. 코어 파일을 고치지 않고 코어 기능을 빌려 쓰는 구조.
- **라우팅은 Apache mod_rewrite 두 겹** (nginx 는 `/spcb` 를 catch-all `/` 로 PHP 에 넘길 뿐):
  - `spcb/.htaccess`: 확장자 없는 요청을 같은 이름 `.php` 로 내부 리라이트 (`/spcb/api/me` → `me.php`).
  - 루트 `samplepcb-web/.htaccess`: ① 실존 파일/디렉터리는 그대로, ② 최상위 슬러그 `/{slug}` → `spcb/pages/{slug}.php` (파일이 실제로 있을 때만 — 코어 경로와 충돌 없음), ③ `/shop/quotes`·`/shop/quotes/archive` 를 명시 리라이트. 새 정적 페이지는 `pages/{슬러그}.php` 를 만들면 `/{슬러그}` 로 바로 열린다.
- `pages/quotes*.php` 는 **셸 패턴**: PHP 는 테마 레이아웃 + 로그인 유도 + 템플릿 상품 썸네일(`get_it_image`)만 담당하고, 데이터는 브라우저 JS 가 같은 도메인의 sp-node API(`/api/pcb-projects`)를 호출해 렌더링한다.

## Talks To [coverage: high — 6 sources]

| 상대 | 방향 | 내용 |
|---|---|---|
| 그누보드 코어 | include | `common.php` 부트스트랩 (세션·회원·테마), `set_cart_id()`/`get_session('ss_cart_id')` |
| sp-node (Fastify `/api`) | 간접 | me.php 가 발급한 JWT 를 브라우저가 `Authorization: Bearer` 로 전달; pages/ 의 JS 가 `/api/pcb-projects` CRUD 호출 |
| sp-vue · 거버 뷰어 (React, 별도 repo) | 클라이언트 | `GET /spcb/api/me` (credentials: include) 로 토큰 수령 |
| 영카트 shop | 링크·리다이렉트 | [바로 주문] → `orderform.php`, 빈 화면 안내 → `cart.php`, 비로그인 → `bbs/login.php?url=…` |
| 테마 sp-lite | asset | `default_shop.css` 직접 링크 — cart.php 와 동일한 카드 문법(`.sp-cart-item`·`.sp-cart-summary`) 재사용 |

CORS: me.php 는 `https://*.samplepcb.co.kr` 오리진만 반사 허용(credentialed 라 와일드카드 불가, 접미사 위조 방지 정규식) — dev 의 `local-gerber` 교차 서브도메인용.

## API Surface [coverage: high — 5 sources]

**`GET /spcb/api/me`** (me.php — 유일한 API 엔드포인트)
- 세션으로 회원 확인. 비로그인 → `401 {"message":"not authenticated"}` (sp-vue 는 익명 유지).
- 성공 → `{ token, member: { mbId, mbNick, level, isAdmin } }`. `Cache-Control: no-store`.
- JWT 클레임: `mbId`·`mbNick`·`level`·`isAdmin`(현재 최고관리자 `cf_admin` 만 true)·`cartId`·`iat`·`exp`(발급+600초 = **10분**). sp-node `@sp/api-contract` 의 `Me`/`JwtClaims` 스키마와 필드·타입을 정확히 맞춘다.
- **`cartId` 클레임** = 영카트 세션 `ss_cart_id`(없으면 표준 `set_cart_id()` 로 생성) = `g5_shop_cart.od_id`. sp-node 담기 API 가 이 값으로 INSERT 해야 cart.php 에 보인다 — "누구인가"와 "어느 장바구니 버킷인가"를 함께 배달하는 서명된 택배.

**페이지 URL** (API 아님, 라우팅 표면)
- `/shop/quotes` (정식) · `/quotes` (별칭) → quotes.php — 목록·수량 인라인 재견적(PATCH)·[바로 주문](POST /order)·[선택삭제]/[비우기](DELETE 소프트 삭제)
- `/shop/quotes/archive` (정식) · `/quotes-archive` (별칭) → quotes-archive.php — 삭제분 목록·[영구 삭제](DELETE 하드, 레이어 팝업 확인, 파일서버 실패 시 재클릭=재시도)
- `/about`, `/spec` → 정적 페이지

## Data [coverage: medium — 4 sources]

spcb/ 자체는 **DB 테이블을 소유하지 않는다**. 데이터의 실체(sp_quote·sp_order_spec·sp_file)는 sp-node(Prisma) 소유이고, spcb 는 세션·JWT 를 통해 식별자만 흘린다.

- 시크릿: `lib/secret.php` 의 `SPCB_JWT_SECRET` ↔ `apps/api/.env` 의 `JWT_SECRET` — **같은 값 수동 동기화** (gitignore, `.example` 만 추적).
- 견적 카드 썸네일: 템플릿 상품 4종 매핑(`standard→sp-pcb-std`, `metalmask→sp-mask`, `advance→sp-pcb-adv`, `flexible→sp-pcb-flex`) — sp-node `g5-db.ts` 의 `TEMPLATE_ITEMS` 와 동일하게 유지할 것 (양쪽에 중복 정의된 결합점).
- 세션 = 진실원본, JWT = 단기 캐시. sp-node 는 JWT 클레임으로만 회원을 식별(그누보드 스키마 직접 결합 없음).

## Key Decisions [coverage: high — 5 sources]

- **코어 비수정 원칙의 PHP 측 수용처가 spcb/** — `bbs/`·`shop/`·`lib/` 등 subtree 를 건드리지 않고, 커스텀 PHP 는 전부 이 폴더(+테마·extend)에. 라우팅도 코어 파일 수정 없이 `.htaccess` 리라이트로만 해결.
- **사용자 노출 견적 페이지는 sp-php(spcb/pages/)** — sp-vue 안을 폐기. 결제 연계(세션·orderform 직행)가 있는 PHP 영역이 자연스럽고, 레거시 `estimate_*` 는 EAV 전제라 이식 가치가 없었다 (GERBER_ORDER_FLOW.md 6장).
- **JWT TTL 10분 · 매 액션 전 재발급 · 저장 금지** — 갱신은 me 재호출(제출 직전 발급 패턴). 세션이 진실원본이므로 토큰을 오래 들고 있을 이유가 없다.
- **독립 모델 — 한 건은 한 화면에만**: 견적관리(순수 견적, ctId 없음) / 장바구니·주문내역(담긴 이후) / 보관함(status='deleted'). 겹쳐 보이면 상태 동기화 문제가 UI 로 번지므로 소속을 배타적으로 갈랐다. quotes.php 의 cartState 분기는 하위호환 백스톱으로만 잔존.
- **cart 삭제는 훅 없이 지연 반영(lazy reconcile)** — 코어 cartupdate 에 훅을 달지 않고, sp-node 목록 조회 시점에 "ctId 있음 + cart 행 없음"을 감지해 보관함으로 수거.
- **정식 URL 은 `/shop/quotes`** — cart.php 와 같은 쇼핑 네임스페이스에 두되, 파일은 코어 subtree(`shop/`)가 아닌 `spcb/pages/` 에 (`/quotes` 는 슬러그 규칙 별칭).
- **jwt.php 는 Composer 없는 순수 PHP** — sp-node `@fastify/jwt`(HS256)와 호환, 의존성 최소화.

## Gotchas [coverage: medium — 4 sources]

- `lib/` 는 include 전용 — `lib/.htaccess`(`Require all denied`) + `_GNUBOARD_` 가드 이중 차단. 새 lib 파일도 이 패턴을 따를 것.
- 무확장/슬러그 라우팅은 **Apache(XAMPP mod_php) 전제** — vhost `AllowOverride All` + mod_rewrite 활성 필요. nginx 레이어와 무관하며, nginx 는 `/spcb` 전용 location 없이 catch-all `/` 로 넘긴다. `/app`·`/api` 는 nginx 앞단에서 이미 분기된 예약 경로.
- 루트 `.htaccess` 슬러그 규칙은 `spcb/pages/{슬러그}.php` 가 실존할 때만 발동 — 코어 경로(bbs·shop·adm)와 충돌하지 않지만, 코어 최상위 경로와 같은 이름의 페이지를 만들면 안 된다(실존 파일/디렉터리 우선 규칙이 지켜주긴 함).
- me.php 의 CORS 는 **https 오리진만** 허용 — http dev 오리진은 반사되지 않는다.
- `secret.php` 는 gitignore — 새 환경 셋업 시 `secret.php.example` 복사 후 `apps/api/.env` `JWT_SECRET` 과 같은 값으로 맞춰야 인증이 통한다.
- quotes 페이지의 썸네일 category→it_id 매핑이 sp-node `TEMPLATE_ITEMS` 와 **수동 동기화** — 템플릿 상품을 바꾸면 quotes.php·quotes-archive.php 두 곳 모두 수정.
- cart.php 견적 행의 [선택사항수정] 버그(선형 곱 오류)는 spcb 가 아닌 **테마 스킨**(`theme/sp-lite/shop/cart.php`) 분기로 차단 — 견적 UI 를 만질 땐 spcb/pages 와 테마 스킨 양쪽을 함께 볼 것.

## Sources [coverage: high — 12 sources]

- [samplepcb-web/spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — 무확장 URL 라우팅
- [samplepcb-web/spcb/api/me.php](../../samplepcb-web/spcb/api/me.php) — 인증 브리지 본체
- [samplepcb-web/spcb/lib/jwt.php](../../samplepcb-web/spcb/lib/jwt.php) — HS256 인코더
- [samplepcb-web/spcb/lib/.htaccess](../../samplepcb-web/spcb/lib/.htaccess) — lib 웹 접근 차단
- [samplepcb-web/spcb/lib/secret.php.example](../../samplepcb-web/spcb/lib/secret.php.example) — 시크릿 템플릿
- [samplepcb-web/spcb/pages/quotes.php](../../samplepcb-web/spcb/pages/quotes.php) — 견적관리
- [samplepcb-web/spcb/pages/quotes-archive.php](../../samplepcb-web/spcb/pages/quotes-archive.php) — 지난 견적 보관함
- [samplepcb-web/spcb/pages/about.php](../../samplepcb-web/spcb/pages/about.php) — 회사소개
- [samplepcb-web/spcb/pages/spec.php](../../samplepcb-web/spcb/pages/spec.php) — 생산규격
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 루트 슬러그·/shop/quotes 라우팅
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 거버 주문 플로우·결정 근거
- [AGENTS.md](../../AGENTS.md) — 인증 브리지 단일 설명원본·플랫폼 구조
