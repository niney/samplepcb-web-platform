---
topic: smartsmt-integration
last_compiled: 2026-11-15
sources_count: 46
status: active
---

# smartsmt-integration

## Purpose [coverage: high — 7 sources]

소스 범위 2026-11-13(c45ec90b8 로그인 인계·견적서 수신) ~ 2026-11-14(9ce1fb5b1 요청서 정리). 커밋 6건이고 2026-11-09 컴파일 뒤에 처음 생긴 축이다. **SmartSMT** 는 바깥의 SMT 견적 계산 서비스로, 지금은 개발 단계다. 개발 서버는 `http://1.255.226.33:8090`(평문 HTTP)이고 운영 주소는 정해지지 않았다. 지금까지 이 플랫폼의 견적은 모두 안에서 만들었다(PCB 거버 견적, 스마트 BOM 견적). SmartSMT 는 **바깥에서 계산을 끝낸 견적서가 들어오는 첫 축**이다. sp-node 는 금액을 계산하지 않고, 받은 견적서를 그대로 보관하고 보여 주기만 한다. 정본 문서는 [SMARTSMT_INTEGRATION](../../docs/SMARTSMT_INTEGRATION.md)(335줄, §1~§8)이다. SmartSMT 에 보낼 인증 규격은 [SMARTSMT_AUTH_REQUEST.html](../../docs/SMARTSMT_AUTH_REQUEST.html)(판 0.1, 794줄)이 정본이다.

연동은 네 갈래다(정본 §1).

1. **(A) 로그인 인계** — 회원이 samplepcb 로그인으로 SmartSMT 를 쓴다(2026-11-13 사용자 확인). SmartSMT 가 세션 없는 브라우저를 sp-php `GET /spcb/sso/smartsmt` 로 보낸다. 우리는 그누보드 로그인을 확인하고 2분짜리 토큰을 주소에 붙여 SmartSMT 로 302 한다. 서버끼리 부르는 단계는 없다.
2. **(B) 견적서 수신(push)** — SmartSMT 서버가 `POST /api/smartsmt/quotes` 로 multipart 를 보낸다. 담기는 것은 envelope JSON, `quote_id`·`order_id`, 파일 3종이다. 보내는 쪽은 타임아웃 10초에 **재시도가 없다**.
3. **(C) 견적서 가져오기(pull)** — 관리자가 주문 번호를 넣으면 sp-node 가 `GET {SmartSMT}/api/pricing/envelope?orderId=` 를 부른다. 전송을 놓쳤을 때 쓰는 보완 수단이다. 파일은 오지 않고, SmartSMT 보관 기간 24시간이 지나면 가져올 수 없다.
4. **관리자 화면** `/app/admin/smt/*` — 새 모듈 `SMT`. 받은 견적·견적 상세·연동 상태 세 화면이고 리뉴얼 셸(`src/next`)에만 있다.

**P0 범위 밖**(§3): 고객 화면 노출, 영카트 주문·결제 전환, 알림 메일, 요율·제어값 되보내기(SmartSMT 에 API 가 없다), 견적서 본문 서명 확인. 사용자 결정(§7)에 따라 이 프로젝트에는 SmartSMT 고객 화면이 없고, samplepcb 화면에 SmartSMT 진입 메뉴도 걸지 않는다.

**상태**: 1차 구현은 2026-11-14 에 끝났다(§8 단계 1~5). 남은 일은 셋이다. ① 개발 서버(`new.samplepcb.co.kr`) 배포 ② 요청서와 개발용 공유 비밀을 SmartSMT 에 전달 ③ SmartSMT 의 회신(실제 견적서 견본, 로그인 수신 주소 확인)에 화면 칸 맞추기. 커밋은 `origin/main` 추적 참조 기준으로 모두 올라가 있다(원격은 조회하지 않음). 실제 SmartSMT 와 토큰으로 주고받은 적은 아직 없다. 2026-11-13 실측에서 SmartSMT 는 여전히 `X-API-Key` 방식이라 `403 BAD_KEY` 로 답했다.

## Architecture [coverage: high — 26 sources]

```
회원 브라우저 ─GET /spcb/sso/smartsmt?state=─▶ sp-php(spcb/sso/smartsmt.php)
                 그누보드 세션 확인 → 비로그인이면 bbs/login.php?url= 거쳐 복귀
                 → 302 {SPCB_SMARTSMT_LOGIN_URL}?token=<HS256 2분, aud=smartsmt-login>&state=
SmartSMT 서버 ─POST /api/smartsmt/quotes (Bearer iss=smartsmt aud=samplepcb)─▶ sp-node smartsmt-inbound
                 onRequest 토큰 검사 → multipart → 최소 검증 → 번호 대조 → 중복 확인 → 파일 대조
                 → 파일서버(버킷 smt) → DB 트랜잭션(sp_smt_order·sp_smt_quote·sp_file) → sp_smt_receive_log
관리자 /app/admin/smt/* ─▶ /api/admin/smt/* (requireAdmin)
                 pull: sp-node ─GET {SMARTSMT_BASE_URL}/api/pricing/envelope?orderId= (Bearer iss=samplepcb aud=smartsmt)─▶ SmartSMT
```

- **토큰 모듈** [lib/smartsmt-token.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-token.ts)(145줄)
  - `@fastify/jwt` 를 쓰지 않는다. 그 플러그인은 `JWT_SECRET` 으로 등록돼 있어서, `node:crypto` 의 `createHmac`·`timingSafeEqual` 로 따로 서명하고 검증한다. 두 비밀이 한 코드 길에서 섞일 여지를 없애려는 것이다.
  - 상수: 수명 `SMARTSMT_TOKEN_TTL_SECONDS=120`, 받는 쪽 시계 오차 허용 `LEEWAY=30`초, 비밀 최소 32자, 토큰 최대 4096자.
  - 검사 순서: 헤더 `alg==='HS256'`(그 밖과 `none` 거절) → 서명 → payload 형태 → `iss`·`aud`(`aud` 배열 허용) → `exp+30`.
  - 실패 사유는 4종이다: `NO_TOKEN`·`BAD_TOKEN`·`WRONG_AUDIENCE`·`EXPIRED`.
  - `smartsmtSecret()` 은 다음 경우 `null` 을 돌려준다: `SMARTSMT_SHARED_SECRET` 이 비었거나, 32자 미만이거나, **`JWT_SECRET` 과 같은 값**. 호출부는 이때 연동을 503 으로 닫는다.
- **인계 주소** [spcb/sso/smartsmt.php](../../samplepcb-web/spcb/sso/smartsmt.php)(77줄)
  - 새 폴더 `spcb/sso/` 에 있다. 라우팅은 기존 [spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) 규칙 2(무확장 → 같은 이름 `.php`)를 그대로 타서 `.htaccess` 변경이 없다.
  - `common.php` 와 [lib/jwt.php](../../samplepcb-web/spcb/lib/jwt.php) 를 include 하고 기존 `spcb_jwt_encode()` 를 다시 쓴다. 키만 SmartSMT 전용 `SPCB_SMARTSMT_SECRET` 이다.
  - 다음이면 텍스트로 **503** 을 낸다: 설정이 비었다, 32자 미만이다, `SPCB_JWT_SECRET` 과 같다, 로그인 수신 주소가 `^https?://` 가 아니다.
  - `state` 는 `^[A-Za-z0-9_-]{0,200}$` 만 받고 어기면 400 이다. 받은 값은 해석하지 않고 그대로 돌려준다.
  - 응답 헤더: `Cache-Control: no-store`·`Referrer-Policy: no-referrer`·`X-Robots-Tag: noindex`.
  - 클레임은 `iss=samplepcb`·`aud=smartsmt-login`·`sub=mb_id`·`name=mb_name`(100자로 자름)·`iat`·`exp=iat+120`. 돌려보낼 주소는 설정값뿐이고 요청 파라미터로 받지 않는다(받으면 다른 사이트가 토큰을 가져갈 수 있다). 코어는 0줄 수정이다([core-nonmodification](../concepts/core-nonmodification.md)).
- **수신 파이프라인** [routes/smartsmt-inbound.ts](../../samplepcb-web-mono-app/apps/api/src/routes/smartsmt-inbound.ts)(215줄)
  - 인증은 **`onRequest` 훅**에서 본문을 읽기 전에 끝낸다. 인증되지 않은 요청이 큰 파일을 메모리에 올리지 못하게 하려는 것이다.
  - 본문 처리는 [lib/smartsmt.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt.ts)(437줄)에 있다.
  - `collectSmartsmtParts` 는 `@fastify/multipart` 를 직접 순회한다. 이 플러그인(^10.0.0)은 `application/json` 값 파트를 **객체로 바꿔** 넘기는데, 공용 `collectMultipart`(lib/market.ts)는 문자열이 아닌 값을 버린다. 그래서 따로 만들었다. envelope 는 값 파트, 글자 파트, 파일 파트 어느 쪽으로 와도 받는다. 값 파트 한도는 8MB(`fieldSize`)로 올렸다. 모르는 파트와 중복 파트는 스트림을 끝까지 비워 버리고, 이름은 `ignored` 에 모았다가 accepted 원장의 message 에 남긴다.
  - 파일 대조 `checkSmartsmtFiles`: header.files 목록의 `bytes`·`sha256` 과 비교해 다르면 400 으로 거절한다. 결과는 파일마다 `match`/`unlisted`/`missing` 으로 적는다.
  - `summarizeSmartsmtEnvelope` 는 순수 함수로 목록용 승격 값을 뽑는다. `user_edits`·`files` 가 JSON 어디에 놓이는지는 문서에 없어서 header 안과 최상위를 둘 다 본다.
- **저장** `saveSmartsmtQuote` 은 파일서버 먼저, DB 나중 순서다.
  - 파일서버는 한 요청에 한 파일이라 순차로 올린다. 중간에 실패하면 앞서 올린 것을 `deleteFromFileServer` 로 되돌리고 견적을 반쪽으로 남기지 않는다.
  - DB 는 한 트랜잭션이다: 주문 upsert(`quoteCount` 증가) → 견적 create → `latestQuoteId` 갱신 → `sp_file` 행(`uploadedBy='SMARTSMT'`, `slot=part`).
  - 유니크 충돌(P2002)은 두 갈래로 처리한다. 그 `quote_id` 가 이미 있으면 duplicate 로 답하고 올린 파일을 되돌린다. 아니면 **새 주문의 서로 다른 견적 두 건이 주문 행에서 부딪친 것**이라 한 번 더 쓴다. 두 번째에도 부딪치면 파일을 되돌리고 오류로 끝낸다.
- **가져오기** [lib/smartsmt-pull.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-pull.ts)(156줄)
  - 부를 때 `redirect:'manual'`(3xx 를 따라가지 않아 토큰이 엉뚱한 곳으로 가지 않게)·`AbortSignal.timeout(SMARTSMT_TIMEOUT_MS)` 을 건다. 타임아웃은 1초~2분 밖의 값이면 기본 10초를 쓴다.
  - 받은 응답은 크기 8MB 확인 → JSON → 같은 `SmartsmtEnvelope` 스키마 → **물어본 주문과 `order_id` 가 같은지** 확인 → 수신과 같은 `saveSmartsmtQuote` 로 저장한다(출처 `pull`, 파일 목록 전부 `missing`, 견적서는 받은 글자 그대로).
- **흉내 송신기**
  - [lib/smartsmt-sample.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-sample.ts)(163줄)는 문서의 칸 표로 짠 **가짜** 견본이다. `user_edits`·`files` 를 header 안에 두고, `owner_mb_id` 기본값은 `hong123`, `labor_charge` 를 포함한다.
  - [scripts/smartsmt-send-sample.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/smartsmt-send-sample.ts) 와 `pnpm smartsmt:send-sample`([package.json](../../samplepcb-web-mono-app/apps/api/package.json), `node --env-file=.env --import tsx`)로 실행한다. SmartSMT 개발 서버는 로컬 개발기를 부를 수 없어서 만들었다(§4.7).
- **등록** [server.ts](../../samplepcb-web-mono-app/apps/api/src/server.ts)
  - 230~234행: `smartsmtInboundRoutes`(prefix `/api`)와 `adminSmtRoutes`(prefix `/api/admin`).
  - multipart 플러그인은 전역 `fileSize 100MB` 로 등록돼 있다(105행).
  - 이로써 라우트 파일은 69 → 71본, Prisma 모델은 89 → 92개가 됐다([sp-node-api](sp-node-api.md)).
- **관리자 웹 모듈** (sp-vue `apps/web`, [sp-vue-web](sp-vue-web.md))
  - 배선:
    - [next/smt-navigation.ts](../../samplepcb-web-mono-app/apps/web/src/next/smt-navigation.ts): 라우트 이름 3개 `admin-smt-quotes`·`admin-smt-quote`·`admin-smt-link`. `returnTo` 는 `/admin/smt/quotes` 경로만 받는다(열린 리다이렉트 방지).
    - [next/admin-menu.ts](../../samplepcb-web-mono-app/apps/web/src/next/admin-menu.ts): `NextModuleKey` 에 `smt` 를 넣고 모듈 순서를 통합·PCB·SmartBOM·**SMT**·개발로 둔다. 배지는 없다. `legacyNextRoute` 가 SMT 에는 `null` 이라 '이전 화면' 버튼이 없다.
    - [admin/menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/menu.ts): `AdminModuleKey` 에 `smt` 를 넣고 옛 셸 모듈 스위처에도 걸었다. `isSmtAdminRoute` 를 두고, 리뉴얼만 있는 이름이라 legacy 이름으로 바꾸지 않는다.
    - [router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts) 372~380행: `smt` → `smt/quotes` 리다이렉트, 상세는 `smt/quotes/:id(\\d+)`.
    - i18n [ko](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/ko.ts)·[en](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/en.ts): 'SMT'·'받은 견적'·'연동 상태'.
  - 화면 3종: `next/pages/smt/` 의 [SmtQuotesPage](../../samplepcb-web-mono-app/apps/web/src/next/pages/smt/SmtQuotesPage.vue)(268줄)·[SmtQuotePage](../../samplepcb-web-mono-app/apps/web/src/next/pages/smt/SmtQuotePage.vue)(459줄)·[SmtLinkPage](../../samplepcb-web-mono-app/apps/web/src/next/pages/smt/SmtLinkPage.vue)(208줄).
  - 조각 7종(`next/components/smt/`):
    - [smt-envelope.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-envelope.ts)(309줄): 견적서를 타입 가드로만 읽어 없거나 모양이 다른 칸은 '—' 로 둔다. 화면이 죽지 않는 것이 먼저다.
    - [smt-badges.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-badges.ts): 색만 정하고 라벨은 계약 사전에서 가져온다.
    - [smt-format.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-format.ts): `null`→'미정', KRW→원, 그 밖의 통화는 `1,234.5 USD`.
    - [useAdminSmt.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/useAdminSmt.ts): 서버 상태 훅 5개 + `findSmtQuoteRowId` + Blob 내려받기.
    - `SmtBlocksSection`·`SmtQuoteLinesSection`·`SmtFieldGrid`.

## Talks To [coverage: high — 14 sources]

| 상대 | 방향 | 내용 |
|---|---|---|
| SmartSMT 서버 | **바깥 → sp-node** | `POST /api/smartsmt/quotes` multipart. `Authorization: Bearer` 토큰은 `iss=smartsmt`·`aud=samplepcb`·2분 수명이고 요청마다 새로 만든다. 2xx 만 성공으로 보고 본문은 읽지 않는다. 실패는 SmartSMT 화면에 `HTTP_<코드>` 로만 뜬다 — 원인은 우리 `sp_smt_receive_log` 에만 남는다 |
| SmartSMT 서버 | **sp-node → 바깥** | `GET {SMARTSMT_BASE_URL}/api/pricing/envelope?orderId=` (`iss=samplepcb`·`aud=smartsmt`). SmartSMT 의 답은 200 견적서 / 403 키 불일치 / 404 주문 없음·만료(보관 24시간) / 409 `NO_INPUTS`·`NOT_PUBLISHABLE` / 503 서버 키 미설정. 실패 본문은 `{"detail":{"reason","message"}}` 이고, 사유가 `detail.reason` 에 있다는 것은 SmartSMT 문서에 없고 11-13 에 실측으로 알았다 |
| 회원 브라우저 ↔ SmartSMT 화면 | 리다이렉트 | SmartSMT 가 세션 없는 회원을 인계 주소로 보낸다. 우리는 `SPCB_SMARTSMT_LOGIN_URL`(정한 값 `http://1.255.226.33:8090/auth/samplepcb`)로 `?token=&state=` 를 붙여 302 한다. 로그인 수신 주소는 고객 화면과 같은 출처여야 SmartSMT 세션 쿠키가 실린다 |
| 그누보드 코어 | include | `common.php`(`$member`·`$is_member` — 차단·탈퇴 회원은 코어가 이미 로그아웃시킨다)·`goto_url()`·`G5_URL`·`G5_BBS_URL`. 기존 [spcb-bridge](spcb-bridge.md) 의 `lib/jwt.php`·`secret.php` 를 다시 쓴다. spcb 의 JWT 는 원래 "한 대칭키에 네 용도"였는데, 여기에 **다섯째 JWT 용도가 별도 키로** 붙었다 |
| 파일서버 `file.samplepcb.kr` | sp-node → 외부 | [lib/file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts) 의 `uploadToFileServer`·`downloadFromFileServer`·`deleteFromFileServer` 를 쓴다. 버킷(serviceType)은 `SMARTSMT_FILE_SERVICE_TYPE`(기본 `smt`)이다. 파일서버가 `smt` 를 받는다는 것(올리기·내려받기·지우기, 해시 일치)은 11-13 에 실측으로 확인했다 |
| 그누보드 회원 표 `g5_member` | read-only | `getMembersByIds`([g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts))로 목록·상세 응답을 만들 때마다 `owner_mb_id` 가 우리 회원인지 한 번에 대조한다. 조회가 실패하면 `null`(모름)로 두고 화면은 그대로 뜬다 |
| nginx(로컬·운영) | 프록시 | 새 location 은 없다 — `/api/` → Node, `/spcb` → PHP(catch-all). `client_max_body_size 100M`([local-web.conf](../../ops/nginx/local-web.conf) 40행·운영 [new-samplepcb](../../ops/nginx-live/sites-enabled/new-samplepcb) 47행)이 multipart 전역 한도와 같다. 보낸 서버 주소는 `X-Real-IP` → [lib/client-ip.ts](../../samplepcb-web-mono-app/apps/api/src/lib/client-ip.ts) 로 읽는다(nginx 뒤라 `request.ip` 는 늘 127.0.0.1). 자세한 배치는 [infrastructure](infrastructure.md) |
| `@sp/api-contract` | 계약 | [schemas/smartsmt.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/smartsmt.ts)(367줄, `index.ts` 45행 재수출)를 sp-node 와 관리자 웹이 같이 쓴다. `apiRoutes` 표에는 등록하지 않았다(웹 훅이 `base` 경로를 직접 쓴다). 상세는 [api-contract](api-contract.md) |
| e2e 하네스 | 시험 | [admin-smt.e2e](../../samplepcb-web-mono-app/e2e/specs/admin-smt.e2e.test.ts)(8)·[smartsmt-sso.e2e](../../samplepcb-web-mono-app/e2e/specs/smartsmt-sso.e2e.test.ts)(4), 둘 다 `PORTAL_E2E=1` 옵트인([env.ts](../../samplepcb-web-mono-app/e2e/helpers/env.ts)). admin-smt 는 **실제 SmartSMT 개발 서버를 1회** 부른다. SSO 는 302 를 따라가지 않는다 — 따라가면 진짜 토큰이 SmartSMT 로 나간다. 상세는 [testing](testing.md) |

## API Surface [coverage: high — 12 sources]

**`GET /spcb/sso/smartsmt?state=`** (sp-php) — 결과는 네 가지다.
- 로그인한 회원: 302 `{LOGIN_URL}?token=…[&state=…]`. `state` 가 비었으면 붙이지 않는다.
- 비로그인: 302 `bbs/login.php?url=<인계 주소>` 로 보내고, 로그인 뒤 이 주소로 돌아온다.
- `state` 형식 위반: 400 text.
- 설정 누락·위험 값: 503 text.

**`POST /api/smartsmt/quotes`** (SmartSMT → sp-node, 인증은 Bearer SmartSMT 토큰)
- 파트: `envelope`(필수, `application/json` 값) · `quote_id`·`order_id`(선택 `text/plain`. 보내면 header 값과 같아야 한다) · `gerber_archive`·`bom`·`cpl`(선택 파일).
- 필수 칸은 6개다: `kind="smartsmt.quote"`·`envelope_version`(≤16자)·`header.quote_id`·`header.order_id`(≤100자)·`header.made_at`·`quote`. 나머지는 `passthrough`.

| HTTP | `detail.reason` / 결과 | 원장 `result` |
|---|---|---|
| 200 | `{result:true, data:{quoteId, orderId, duplicate:false}}` | accepted (읽지 않은 파트가 있으면 message 에 남김) |
| 200 | 같은 `quote_id` 를 이미 받았다 → `duplicate:true`. 덮어쓰지 않고 파일도 다시 올리지 않는다 | duplicate |
| 401 | `NO_TOKEN`·`BAD_TOKEN`·`WRONG_AUDIENCE`·`EXPIRED` | rejected (인증 실패 — 시간당 30건까지만 기록) |
| 400 | `INVALID_REQUEST`(multipart 아님·파트 못 읽음)·`INVALID_ENVELOPE`(message 에 첫 문제 칸 경로)·`ID_MISMATCH`·`FILE_MISMATCH`(크기 또는 SHA-256 다름) | rejected |
| 413 | `TOO_LARGE`(전체 100MB·envelope 8MB 초과 — 앞단 nginx 가 막으면 본문이 JSON 이 아닐 수 있다) | rejected |
| 502 | `FILE_STORE_FAILED`(파일서버 실패 — 견적 미저장, 그대로 다시 보내면 된다) | failed |
| 503 | `NOT_CONFIGURED`(비밀 미설정·너무 짧음·`JWT_SECRET` 과 같음) — 본문을 읽기 전 | failed (인증 실패와 같은 제한) |
| 500 | 예상 못 한 오류 — 본문은 전역 핸들러가 정한다 | failed |

**관리자 API `/api/admin/smt/*`** ([routes/admin-smt.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-smt.ts)(348줄), `preHandler requireAdmin` 하나로 전부)
- `GET /smt/orders?page&pageSize(≤100, 기본 20)&tab=all|review|undetermined&search=` — 주문 한 줄마다 `latest`(마지막 견적 요약)를 붙인다. 검색은 주문 번호·주인 아이디·주인 이름의 부분 일치다. `counts` 는 **검색어를 뺀** 탭별 주문 수이고, 목록 조회는 `envelope` 열을 읽지 않는다.
- `GET /smt/quotes/:id` — `:id` 는 `sp_smt_quote` 행 번호이고 견적 번호 `quote_id` 가 아니다. 응답은 `{order, quote(+envelopeVersion·lang·공급가·부가세·isLatest), envelope(전체 JSON, 관리자 전용), files(대조 결과 + 내려받을 수 있으면 fileId), history(같은 주문의 견적, 최신부터)}`. 저장된 JSON 을 못 읽으면 빈 객체로 두고 화면은 뜬다. `no-store`.
- `GET /smt/files/:id` — 서버를 거쳐 내려받는다(`pathToken` 을 화면에 노출하지 않는다). `refType='sp_smt_quote'` 가 아니면 404 이고 파일서버를 부르지 않는다. `application/octet-stream`, `filename*=UTF-8''`.
- `POST /smt/pull {orderId(trim, 1~100)}` — 응답 `{quoteId, orderId, duplicate}`. 실패는 `{error, message}` 이고 코드는 6종: `SMARTSMT_NOT_CONFIGURED` 503 · `SMARTSMT_UNREACHABLE` 502 · `SMARTSMT_AUTH_REJECTED` 502(401·403) · `SMARTSMT_NOT_FOUND` 404 · `SMARTSMT_NOT_READY` 409(`NO_INPUTS`·`NOT_PUBLISHABLE` 문구를 가른다) · `SMARTSMT_BAD_RESPONSE` 502(JSON 아님·견적서 아님·다른 주문·크기 초과·예상 못 한 상태). 결과는 서버 로그에 `by: mbId` 와 함께 남는다.
- `GET /smt/receive-logs?page&pageSize(기본 30)&result=` — 수신 원장, 최근 것부터.
- `GET /smt/link-status` — `secretConfigured`(값은 싣지 않는다)·`baseUrl`·`timeoutMs`·`inboundPath`·`ssoPath`·`fileServiceType`·`lastAcceptedAt`·최근 24시간 결과별 건수.

**화면** (`/app/admin/smt/*`)
- **받은 견적** `quotes`
  - 탭: 전체 / 검토 필요(`REVIEW_REQUIRED`, 강조) / 합계 미확정(최종 금액 null).
  - 검색은 주소 상태로 둔다(`next/lib/list-query`).
  - **[견적서 가져오기]** 는 공용 `promptDialog` 대화상자다. 실패하면 입력을 둔 채 서버 문장을 보인다. 새 견적이면 그 상세로 옮겨 가고, duplicate 면 알린 뒤 그 주문으로 목록을 검색한다.
- **견적 상세** `quotes/:id` 의 섹션 순서:
  1. 금액 — 최종 금액(통합 합계)·공급가·부가세·SMT 작업비·통화. 합계가 막혔으면 경고 띠, `policy_is_default` 면 '예시 요율' 띠를 붙인다.
  2. 주문 정보 — 고객·시각 / 요율 판 / 조건 / 수량.
  3. 경고.
  4. 고객 요청.
  5. 동봉 파일.
  6. 견적 이력.
  7. 요율·제어값(접힘).
  8. 원문 JSON(접힘).
  - 머리에는 '최신 견적 아님' 배지와 **[다시 가져오기]** 가 있다.
- **연동 상태** `link`
  - 설정 칸: 공유 비밀 설정 여부, SmartSMT 주소, 대기 시간, 우리 수신 주소·로그인 인계 주소(이 화면을 연 출처 기준), 파일 버킷, 마지막으로 받은 시각, 최근 24시간 배지.
  - 수신 기록 표는 결과 필터가 있고, 주문 번호를 누르면 받은 견적 검색으로 간다.

**흉내 송신** `pnpm smartsmt:send-sample [--target= --order=SIM-0001 --quote= --status=REVIEW_REQUIRED --blocked --owner= --no-files --bad-hash --bad-token]` — `--bad-hash` 는 400 `FILE_MISMATCH`, `--bad-token` 은 401 `BAD_TOKEN` 을 기대한다.

## Data [coverage: high — 9 sources]

**표 3개** — [migration 20261113230000_smartsmt_inbound](../../samplepcb-web-mono-app/apps/api/prisma/migrations/20261113230000_smartsmt_inbound/migration.sql)(81줄)는 추가 전용이다(CREATE 3 + FK 2). DDL 은 `prisma migrate diff`(스키마 대 스키마, DB 무접속)로 냈다. 모델은 [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) 2574~2644행이다.

- **`sp_smt_order`** — 주문 1건.
  - `orderId` VARCHAR(100) 유니크.
  - `ownerMbId`(60)·`ownerName`(191) — `g5_member` 와 느슨한 참조이고 FK 가 없다.
  - `latestQuoteId` 유니크, FK `SetNull`.
  - `quoteCount`·`adminMemo` TEXT(편집 화면은 아직 없다)·`firstReceivedAt`·`lastReceivedAt`.
  - 인덱스는 `lastReceivedAt`·`ownerMbId`.
- **`sp_smt_quote`** — 견적 1건.
  - `quoteId` VARCHAR(100) 유니크. `orderRefId` 는 FK `Cascade` 다(주문을 지우면 견적도 지워진다).
  - `orderId` 사본, `source`(`push`|`pull`), `envelopeVersion`(16).
  - 승격 열: `madeAt`(읽지 못하면 null)·`currency`(8)·`lang`(8)·`strategy`(16, `SAMPLE`|`MASS`)·`quoteStatus`(32)·`quantity`, 금액 4칸 `smtTotal`·`finalSupplyPrice`·`finalVat`·`finalTotal`.
  - 금액 4칸은 **DECIMAL(16,2)** 다. 통화가 USD 일 수 있어 소수 둘째 자리까지 둔다. 1e14 이상이거나 숫자가 아니면 null 로 둔다.
  - `blockedBy` JSON, `files` JSON(대조 결과 `[{part,name,bytes,sha256,check}]`), **`envelope` MEDIUMTEXT(받은 견적서 전체)**, `receivedAt`.
  - 인덱스는 `(orderRefId,id)`·`receivedAt`.
- **`sp_smt_receive_log`** — SmartSMT 가 보낸 시도 1건.
  - `result`: accepted|duplicate|rejected(4xx)|failed(5xx).
  - `reason`(32): 응답 `detail.reason` 과 같은 값, 사전 11종 `SMARTSMT_INBOUND_REASONS`.
  - `httpStatus`, `quoteId`·`orderId`, `bytes`(Content-Length), `durationMs`, `remoteAddr`(64), `message`(500).
  - 인덱스는 `createdAt`·`orderId`.
  - **가져오기(pull)는 이 원장에 남지 않는다.**
- **`sp_file`(기존 표)** — 동봉 파일. `refType='sp_smt_quote'`·`refId=quote.id`·`fileType` gerber|bom|cpl·`slot=part`.

**주문 1 : 견적 N, 최신 = 마지막에 받은 것.** SmartSMT 가 같은 주문을 다시 보내면 `order_id` 는 같고 `quote_id`·`header.made_at` 은 다르다(§2). 최신 견적은 `made_at` 이 아니라 **받은 순서**로 정한다. 저장할 때마다 `latestQuoteId` 를 새 견적으로 옮긴다. SmartSMT 의 최신 판정 기준(`made_at` 인지)과 취소·철회 통보 여부는 **미확인**이다(§6-4, 코드 주석 두 곳). 주인 칸은 값이 온 견적만 덮어쓴다(null 이 오면 이전 값 유지). `ownerMbId` 출처는 견적서 `user_edits.owner_mb_id` 이고, 요청서에서 그 값을 "로그인 토큰의 `sub` 를 글자 그대로" 쓰라고 SmartSMT 에 요청했다.

**견적서 원문 보관과 금액 읽기** (§2·§4.3)
- 뼈대는 `kind="smartsmt.quote"`·`envelope_version="3"` 이다.
- 칸 구성:
  - `header`: 번호·시각·통화·요율 판·`controls` 30칸·`quantities` 7칸·고객 요청.
  - `quote`: `quote_status`·금액 사슬·`lines` 17칸·`integrated`.
  - `signature`: `HMAC-SHA256` 또는 null. **우리는 지금 쓰지 않는다**.
- 견적서는 **받은 글자 그대로** 보관한다. 객체로 파싱돼 왔으면 `JSON.stringify` 로 되돌리고, 가져오기는 응답 글자를 그대로 둔다. `rates` 는 칸 수가 고정이 아니고 "모르는 키도 보관(되보낼 때 필요)"이라는 요구가 있는데, 통째 보관으로 충족된다.
- **최종 금액 = `quote.integrated.totals.total`**. `quote.total` 은 SMT 작업비만이다(PCB·부품·배송 제외). **`null` = 미정, `0` = 0원**이고 저장·API·화면 어디서도 섞지 않는다. 화면은 null 을 '미정'으로 쓰고 SMT 작업비를 이름 붙여 보조로 보인다.
- 블록 사유 사전 `SMARTSMT_BLOCK_REASONS` 는 코드 10개다. 사유가 null 이면 정상이라 "합계에 드는가"가 정해진다: `no` 4개·`amount_only` 3개(`QTY_UNVERIFIED` 등 — 금액은 있어도 합계에 안 든다)·`na` 3개.

**라벨 사전**(계약 한 곳, 화면은 색만 정한다)
- 견적 상태 2·전략 2·출처 2·주문 시나리오 2·조립 면 2·리플로 2·조달 3.
- `basis` 15·줄 상태 4(빈 글자 = 확정)·블록 사유 10·파일 파트 3·대조 결과 3·수신 결과 4.
- 사전에 없는 코드는 `smartsmtLabel()` 이 **코드 그대로** 돌려준다. 블록의 `request_status`·`valuation`·`completeness` 는 값 목록을 받지 못해 코드 그대로 보인다.

**관리자 전용 값** — `labor_charge`(SmartSMT 쪽에서도 전달 전용, 고객용 사본에서 빠진다)와 `user_edits`(담당자 메모·`owner_mb_id`)는 envelope 원문에 그대로 들어 있다. 상세 응답의 `envelope` 는 관리자 전용이라고 계약·라우트 주석에 박아 두었다. 고객 화면을 붙일 때는 이 응답을 재사용하지 말고 고객용 응답을 따로 만들어야 한다([audience-split-dto](../concepts/audience-split-dto.md)).

**설정·비밀**(DB·화면에 두지 않는다)
- sp-node [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) 74~86행: `SMARTSMT_SHARED_SECRET`(비우면 수신 503)·`SMARTSMT_FILE_SERVICE_TYPE`(기본 smt)·`SMARTSMT_BASE_URL`(비우면 가져오기 503, 끝의 `/` 제거, http(s) 만)·`SMARTSMT_TIMEOUT_MS`(기본 10000).
- sp-php [secret.php.example](../../samplepcb-web/spcb/lib/secret.php.example) 9~15행: `SPCB_SMARTSMT_SECRET`(`.env` 의 공유 비밀과 같은 값)·`SPCB_SMARTSMT_LOGIN_URL`(환경별 1개).
- 개발용 비밀은 2026-11-13 에 64자로 발급해 로컬 `.env` 에 넣었다(`JWT_SECRET` 과 다른 값). 견본 토큰은 리포 밖 `.tmp/smt-tools/make-example-token.cjs` 로 만들고 `check-auth-doc.cjs` 로 요청서 속 값을 다시 검증한다. 단위 테스트는 요청서 7.3 의 검증 견본을 그대로 돌린다.

## Key Decisions [coverage: high — 6 sources]

- **2026-11-14 — 요청서 회신 항목을 셋으로 줄이고, "견적서 보내는 법"을 넣고, samplepcb 할 일은 '모두 마쳤습니다'로 표시**(2be5383b9·9ce1fb5b1)
  - 회신 항목: 보내 줄 것은 실제 견적서 견본 하나(정상·검토 필요·합계 막힘 2~3건 + 파일). 다르면 알려 줄 것은 로그인 수신 주소와 회원 정보 항목.
  - 뺀 것과 이유: 구현 가능 여부(어려우면 알려 올 내용이다), 운영 환경(오픈 전에 다시 묻는다), 담당자 로그인(권한은 SmartSMT 가 직접 관리한다고 요청서 4.4 에 적었다).
  - 5.1 에는 보낼 주소·인증 헤더·파트 표·규칙·curl 예시를 넣었다. curl 은 로컬 서버에 실제로 돌려 duplicate false → true 를 확인했다.
  - '마친 상태' 표시는 **SmartSMT 가 문서를 받는 시점 기준**이다. 커밋 본문에 "받을 때는 끝나 있다"고 적었다(Gotchas).
- **2026-11-14 — 로그인 수신 주소는 우리가 정해서 알린다** — `http://1.255.226.33:8090/auth/samplepcb`. 이 값은 `secret.php` 에 들어 있다. SmartSMT 고객 화면이 API 서버(8090)와 다른 출처에 있으면 바꿔야 한다. 수신 주소가 고객 화면과 같은 출처여야 세션 쿠키가 실리기 때문이다.
- **2026-11-14 — 관리자 화면 규칙**(df22d1989, 칸 구성은 가짜 견본 기준이라 실제 견본이 오면 맞춘다)
  - ① 목록 한 줄 = 주문 1건. 금액·상태는 마지막에 받은 견적에서 읽는다([workqueue-case-spine](../concepts/workqueue-case-spine.md) 문법: 탭 건수·URL 상태·`returnTo` 복귀).
  - ② 최종 금액이 미정이면 "미정"이라 쓰고 SMT 작업비를 이름 붙여 보조로 보인다. 최종 금액으로 읽히지 않게 하려는 것이다.
  - ③ `owner_mb_id` 가 우리 회원이 아니면 '회원 아님' 표지를 단다. 아이디가 없거나 조회가 실패하면 표지를 달지 않는다(모름 ≠ 아님).
  - ④ 칸 이름은 SmartSMT 「견적서 전송 양식」의 "뜻" 칸을 따르고, 사전에 없는 코드는 그대로 보인다.
  - ⑤ 요율·원문은 접어 둔다(원문에 관리자 전용 값이 있다).
  - ⑥ **리뉴얼 셸에만 짓는다**. 옛 화면이 없으니 '이전 화면' 버튼도 없고, 옛 셸 스위처는 리뉴얼 경로로 건다. 2026-10-10 컷오버 뒤 처음 생긴 모듈이다([parallel-build-cutover](../concepts/parallel-build-cutover.md)).
  - 가져오기 입력은 공용 대화상자로 받는다([no-native-dialogs](../concepts/no-native-dialogs.md)).
- **2026-11-13 — 가져오기는 보완 수단이고 수신 원장과 섞지 않는다**
  - 출처는 `pull`, 파일은 전부 `missing` 이다.
  - 이미 가진 `quote_id` 면 저장하지 않고 duplicate 로 답한다.
  - 물어본 주문과 다른 주문의 견적서는 저장하지 않는다.
  - 3xx 는 따라가지 않는다.
  - 원장(`sp_smt_receive_log`)은 "SmartSMT 가 보낸 시도"만 담는다. 가져오기 결과는 화면 응답과 서버 로그에 남는다.
- **2026-11-13 — 인증: SmartSMT 원문(`X-API-Key`)을 따르지 않고, 전용 공유 비밀 + HS256 2분 JWT**(사용자 결정, §4.2 결정 경과 표)
  - 쓰임 셋을 `aud` 로 가른다. 회원 로그인 인계는 `samplepcb→smartsmt-login`(주소의 `token`), 우리 → SmartSMT 호출은 `samplepcb→smartsmt`, SmartSMT → 우리 호출은 `smartsmt→samplepcb`(둘 다 Bearer). 받는 쪽은 자기 자리의 `aud` 만 받는다.
  - 기각·불채택한 안과 이유:
    - ES256 키 쌍 + 본문 해시: 지금 단계에 너무 복잡하다(사용자 판단).
    - `X-API-Key` 고정 키 + 1회용 코드 교환: SmartSMT 가 HTTP 라 키가 그대로 드러난다. 로그인에 SmartSMT → 우리 서버 호출이 필요해 로컬 개발기로 시험할 수 없다.
    - **`JWT_SECRET` 공유**: 더 단순해지지도 않는다(설정 한 줄 차이). 그 값을 가진 쪽은 로그인 없이 관리자 토큰을 만들 수 있다 — `plugins/auth.ts` 는 서명만 믿는다. 주문 알림 서비스 JWT·썸네일 서명도 같은 값이다.
  - 채택안의 장점: 비밀이 전송되지 않는다, 로그인에 서버 간 호출이 없다, 양쪽 구현이 몇 줄이다.
  - **`JWT_SECRET` 과 같은 값을 넣으면 sp-node·sp-php 둘 다 거부**하도록 코드로 강제했다.
  - 감수하는 것: 비밀이 새면 교체 전까지 가짜 견적을 넣을 수 있다(P0 는 관리자 화면까지라 피해가 한정된다). 로그인 토큰이 주소에 실린다(HTTP 단계라 세션 쿠키도 어차피 보인다). 시계가 2분 넘게 어긋나면 실패한다.
  - 나중으로 미룬 것(구조 변경 없이 붙일 수 있다): HTTPS 전환(**실고객 오픈 전 필수**, 그때 비밀 교체), 로그인 토큰 1회용, nginx 에서 보낸 서버 IP 제한, 견적서 본문 서명(주문·결제로 잇기 전).
- **2026-11-13 — 받는 스키마는 느슨하게, 거절은 인증·형식·번호·해시뿐**
  - 이유: 보내는 쪽에 재시도가 없으니 "모르는 값이라 거절"은 곧 데이터 유실이다.
  - 그래서 코드 값(`basis`·`lines.status`·블록 `reason` …)을 `z.enum` 으로 막지 않고, 필수 6칸 밖은 `passthrough` 한다.
  - 수신은 성공·실패 모두 원장에 남긴다. 같은 `quote_id` 는 덮어쓰지 않고 2xx 로 답해 다시 보내는 것을 언제나 안전하게 만든다.
  - 실패 본문은 SmartSMT 서버와 같은 모양 `{"detail":{"reason","message"}}` 으로 맞춘다.
- **2026-11-13 — 구현하며 정한 것**
  - 인증 실패 기록은 시간당 30건까지만 남긴다(바깥에서 얼마든지 만들 수 있는 요청이라서다).
  - 새 주문의 동시 견적이 주문 행에서 유니크 충돌을 내면 한 번 더 쓴다(중복으로 답하면 견적을 잃는다).
  - 보낸 주소는 `X-Real-IP` 에서 읽는다.
  - 파일 저장이 실패하면 견적을 반쪽으로 남기지 않고 502 로 답한다.
- **2026-11-13 — 10초 타임아웃 상향은 미리 요청하지 않는다**(사용자 결정) — P0 는 동기 저장으로 가고 걸린 시간을 원장 `durationMs` 에 남긴다. 실제로 문제가 보이면 그때 고른다: SmartSMT 쪽 상향 또는 "로컬 임시 보관 → 2xx → 뒤에서 파일서버로 옮김".
- **2026-11-13 — 범위와 노출**(사용자 결정)
  - 관리자 메뉴는 새 모듈 `SMT`, P0 는 §3 그대로.
  - SmartSMT 고객 화면은 이 프로젝트에 없고, samplepcb 에 진입 메뉴도 걸지 않는다.
  - 넘기는 회원 정보는 아이디·이름 둘이다(이메일·관리자 여부는 넘기지 않는다).
  - 회원 정보 제공 고지·동의 절차는 지금 두지 않고 나중에 고려한다.
  - 관리자용 응답과 고객용 응답은 처음부터 나눈다.
- **2026-11-13 — 개발 단계 배포는 오픈 전 서버에 개발용 비밀 그대로**(사용자 결정)
  - 대상: `new.samplepcb.co.kr`·`centrafab.co.kr`(같은 서버, 아직 오픈 전)에 그대로 올려 SmartSMT 개발 서버와 맞춰 본다.
  - 할 일: `migrate deploy` + 서버 `.env`(`SMARTSMT_SHARED_SECRET`·`SMARTSMT_BASE_URL=http://1.255.226.33:8090`)와 `secret.php`(`SPCB_SMARTSMT_SECRET`·`SPCB_SMARTSMT_LOGIN_URL`)에 로컬과 같은 값을 넣는다.
  - **실제 오픈 전에는 운영 체크 2~5를 다시 한다**(Gotchas 마지막 항목).

## Gotchas [coverage: high — 20 sources]

- **공유 비밀은 두 곳에 손으로 맞춘다** — `apps/api/.env` `SMARTSMT_SHARED_SECRET` ↔ `spcb/lib/secret.php` `SPCB_SMARTSMT_SECRET`([manual-sync-drift](../concepts/manual-sync-drift.md)).
  - 어긋났을 때 우리 쪽에는 증상이 없다. 인계 토큰은 우리가 서명만 하고 SmartSMT 가 검증하므로, SmartSMT 로그인이 실패할 뿐이다.
  - 연동 상태 화면의 '공유 비밀 설정됨'은 **sp-node 쪽만** 본다. sp-php 인계 설정은 API 가 볼 수 없다.
  - 인계 쪽 설정을 확인하려면 `/spcb/sso/smartsmt` 를 직접 열어 503 문구가 나오는지 본다.
  - 두 쪽의 거부 판정은 각자 따로 구현돼 있다. Node 는 `trim()` 후 비교하고 PHP 는 그대로 비교한다.
- **`JWT_SECRET` 과 같은 값이면 두 주소 모두 503 으로 닫힌다**(의도된 동작). 운영에 같은 값을 넣는 실수가 가장 위험해서(§5-4) 코드로 막았다. 503 이 보이면 먼저 이 조건을 의심할 것. 조용히 열려 있는 것보다 시끄럽게 닫히는 쪽을 골랐다 — [silent-degradation](../concepts/silent-degradation.md) 의 반대편 처방이다.
- **기존 서버의 `secret.php` 에는 새 상수가 없다** — `.example` 만 바뀌었다. 인계 주소는 `defined()` 로 확인하므로 상수를 넣기 전까지 503 이다. `secret.php` 파일 자체가 없으면 `jwt.php` 의 `require_once` 에서 Fatal 이 난다(me.php 와 같다).
- **공용 `collectMultipart` 를 쓰면 견적서가 사라진다** — 플러그인이 `application/json` 값 파트를 객체로 넘기고 공용 함수는 문자열이 아닌 값을 버린다. 그래서 SmartSMT 수신은 `collectSmartsmtParts` 만 쓴다. 값 파트 기본 한도 1MB 는 8MB 로 올렸다. 전체 한도는 서버 전역 `fileSize 100MB` 와 nginx `100M` 이 같이 정한다.
- **10초 타임아웃과 순차 파일 업로드가 부딪칠 수 있다**(§5-3).
  - 저장은 끝났는데 보내는 쪽이 실패로 보면, 담당자가 다시 보낸다. 같은 `quote_id` 면 duplicate 라 무해하다. 새 `quote_id` 로 다시 계산해 보내면 견적이 한 벌 더 생긴다.
  - 원인은 원장의 `durationMs` 로만 찾는다.
  - 파일은 **전송으로만 온다**. 가져오기로 견적서를 되살려도 파일은 `missing` 이다.
- **"최신"은 받은 순서다** — 실패했던 옛 견적을 SmartSMT 가 나중에 다시 보내면 그 옛 견적이 최신이 된다. `made_at` 비교는 하지 않는다. SmartSMT 의 최신 판정 기준이 확인되면(§6-4) `saveSmartsmtQuote` 의 `latestQuoteId` 갱신 한 줄을 고칠 자리다.
- **중복 확인이 파일 대조보다 먼저다** — 이미 받은 `quote_id` 를 다른 파일과 함께 다시 보내도 200 duplicate 로 끝나고 파일은 검사하지 않는다(의도: "파일을 다시 올리지 않는다").
- **인증 실패 원장 제한은 메모리 카운터다** — 모듈 전역 고정 창(첫 실패부터 1시간, 30건)이라 프로세스를 재시작하면 초기화된다. `NOT_CONFIGURED`(503)도 같은 한도에 묶여, 미설정 상태에서 SmartSMT 가 계속 보내면 31번째부터는 기록이 남지 않는다.
- **가져오기는 응답 전체를 읽은 뒤 크기를 본다** — `res.text()` 다음에 8MB 를 확인하므로 큰 응답은 이미 메모리에 올라온 뒤다. 상대가 정해진 서버 하나라 지금은 위험이 낮다.
- **'마지막으로 받은 시각'에는 가져오기도 들어간다** — `lastAcceptedAt` 은 `sp_smt_quote.receivedAt` 최댓값이다. 반면 '최근 24시간 수신' 건수는 원장 기준이라 가져오기를 세지 않는다. 두 숫자의 모수가 다르다.
- **라우트 이름 접두가 겹친다** — `admin-smt-*` 와 `admin-smartbom*` 는 `admin-sm` 까지 같다. 모듈 판정에서 **SMT 를 SmartBOM 보다 먼저** 보고, `isSmtAdminRoute` 는 `admin-smt` 또는 `admin-smt-` 접두만 받는다. 두 메뉴 파일 주석에 이 순서를 지키라고 적어 두었다.
- **주인 대조의 한계**(§5-7) — 견적의 주인은 `owner_mb_id` 로만 이어진다. 로그인 인계가 붙기 전에 만들어진 SmartSMT 주문에는 우리 아이디가 아닌 값이 있을 수 있어 '회원 아님'이 뜬다. 연결은 하지 않고 글자로만 보인다. 이 값의 위치(`header.user_edits` 인지 최상위인지)도 문서에 없어 두 자리를 다 읽는다.
- **흉내 송신·e2e 는 실제 자원을 쓴다**
  - `smartsmt:send-sample` 은 파일 3개를 **실제 파일서버**에 올리고 `sp_smt_*` 에 행을 만든다. 자동 정리는 없다. 스크립트 머리 주석이 안내하는 `--cleanup-hint` 옵션은 실제로 없다.
  - `admin-smt.e2e` 는 `SIM-E2E-<꼬리>-` 로 시작하는 주문만 골라, 파일서버 → `sp_file` → `sp_smt_order`(견적은 cascade) → 원장 순으로 자기가 만든 것만 지운다.
  - 같은 스펙의 가져오기 단언은 **실제 SmartSMT 개발 서버를 1회** 부른다. 지금은 `SMARTSMT_AUTH_REJECTED` 가 오고, SmartSMT 가 토큰 방식으로 바뀌면 404 가 온다. 둘 다 실패 문장이라 통과한다.
  - SSO e2e 는 302 를 절대 따라가지 않는다.
- **평문 HTTP 구간**(§5-1) — SmartSMT 세션 쿠키, 고객이 올린 거버·BOM, 주소에 실린 로그인 토큰이 다 보인다. 요청서 9장은 "개발 기간에는 시험 계정·시험 파일만" 쓰라고 한다. **실고객 오픈 조건은 SmartSMT 의 HTTPS 전환**이다.
- **요청서의 '모두 마쳤습니다'는 앞당긴 표시다** — 2026-11-14 커밋은 SmartSMT 가 받을 때를 기준으로 samplepcb 할 일 셋(공유 비밀 전달·개발 서버 배포·로그인 수신 주소 등록)을 '완료'로 그렸다. 그런데 정본 머리말과 §7 '남은 것'은 배포와 전달을 아직 할 일로 둔다. **배포와 비밀 전달을 끝내기 전에 요청서를 보내면 문서가 사실과 다르다.**
- **정본 문서가 코드보다 뒤처진 곳**(코드 기준으로 읽을 것)
  - §8 제목 "(2026-11-13, 미커밋)" — 실제로는 c45ec90b8·df22d1989 로 커밋됐다.
  - §4.6 표의 연동 상태 '시험 호출' — 구현되지 않았다. 화면에는 설정 여부와 수신 기록만 있다.
  - §7 '남은 것'의 "SmartSMT 가 견적서를 보낼 우리 개발 서버 주소" — §8 과 요청서 2장에서 이미 `https://new.samplepcb.co.kr/api/smartsmt/quotes` 로 정해졌다.
  - §4.3 "`basis` 16종·블록 `reason` 11종" — 계약 사전은 `basis` 15개, 블록 사유 코드 10개(+정상 null)다. 사전에 없는 코드는 코드 그대로 보이므로 표시 결함은 아니다.
  - §4.1 "파일서버 serviceType 은 새로 정한다" — `smt` 로 정해졌다.
  - [ADMIN_NEXT_UI](../../docs/ADMIN_NEXT_UI.md) 에는 SMT 모듈 절이 없고, [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md) 런북에는 SmartSMT 반영 단계가 없다. 운영 체크리스트는 정본 §8 에만 있다.
- **운영 반영 체크**(§8 "운영에 올릴 때"):
  1. `prisma migrate deploy`(표 3개 — 공유 DB 라 reset 금지).
  2. **운영용 공유 비밀을 새로** 만들어 `.env` `SMARTSMT_SHARED_SECRET` 과 `secret.php` `SPCB_SMARTSMT_SECRET` 에 같은 값으로 넣는다. 개발용 값을 쓰지 않고, `JWT_SECRET` 과 같으면 503 이다.
  3. `SPCB_SMARTSMT_LOGIN_URL` 에 SmartSMT 운영 로그인 수신 주소를 넣는다.
  4. `SMARTSMT_BASE_URL` 에 SmartSMT 운영 주소를 넣는다.
  5. SmartSMT HTTPS 전환을 확인한다.

  개발 단계(오픈 전 `new.samplepcb.co.kr`)는 1번 + 로컬과 같은 개발용 값으로 시작한다. 확인 순서: 연동 상태 화면(비밀 설정·주소) → `pnpm smartsmt:send-sample --target=<서버>` → `/spcb/sso/smartsmt` 503 여부.

## Sources [coverage: high — 46 sources]

- [docs/SMARTSMT_INTEGRATION.md](../../docs/SMARTSMT_INTEGRATION.md) — 정본: §1 한눈에 · §2 SmartSMT 원문(전송·가져가기·견적서 뼈대·금액 읽는 법·관리자 전용 값) · §3 범위 · §4 설계(저장·인증 결정 경과·계약·수신·관리자 라우트·화면·시험) · §5 검토 의견 7 · §6 물어볼 것 8 · §7 사용자 결정 · §8 구현 현황·실측·가져오기·화면 결정·운영 체크·개발 단계 배포 (2026-11-13~14)
- [docs/SMARTSMT_AUTH_REQUEST.html](../../docs/SMARTSMT_AUTH_REQUEST.html) — SmartSMT 에 보낼 인증 연동 요청서 판 0.1: 이름과 주소(개발 `https://new.samplepcb.co.kr`)·토큰 규칙·오류 응답 3.4·로그인 인계 4장·서버 간 호출 5장(5.1 보내는 법 curl·5.2 응답 표)·공유 비밀 6장·Python/검증 견본 7장·기존 문서에서 바뀌는 점 8장·지금은 하지 않는 것 9장·할 일과 회신 10장
- [samplepcb-web/spcb/sso/smartsmt.php](../../samplepcb-web/spcb/sso/smartsmt.php) — 로그인 인계 주소(sp-php)
- [samplepcb-web/spcb/lib/secret.php.example](../../samplepcb-web/spcb/lib/secret.php.example) · [lib/jwt.php](../../samplepcb-web/spcb/lib/jwt.php) · [spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — 설정 상수 2개 추가·`spcb_jwt_encode` 재사용·무확장 라우팅(변경 없음)
- [apps/api/src/lib/smartsmt-token.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-token.ts) · [smartsmt-token.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-token.test.ts) — 전용 비밀 HS256 서명·검사(14 — 요청서 7.3 견본 포함)
- [apps/api/src/lib/smartsmt.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt.ts) · [smartsmt.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt.test.ts) — 목록값 뽑기·파일 대조·multipart 읽기·저장·수신 원장(10)
- [apps/api/src/lib/smartsmt-pull.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-pull.ts) · [smartsmt-pull.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-pull.test.ts) — 견적서 가져오기(정본 기준 18 — `it.each` 전개 포함)
- [apps/api/src/lib/smartsmt-sample.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-sample.ts) · [scripts/smartsmt-send-sample.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/smartsmt-send-sample.ts) · [package.json](../../samplepcb-web-mono-app/apps/api/package.json) — 가짜 견본·흉내 송신기·`smartsmt:send-sample`
- [apps/api/src/routes/smartsmt-inbound.ts](../../samplepcb-web-mono-app/apps/api/src/routes/smartsmt-inbound.ts) · [smartsmt-inbound.test.ts](../../samplepcb-web-mono-app/apps/api/src/routes/smartsmt-inbound.test.ts) — 수신 라우트(정본 기준 25 — inject 하네스: 인증 우선·저장·거절)
- [apps/api/src/routes/admin-smt.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-smt.ts) · [admin-smt.test.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-smt.test.ts) — 관리자 API 6종(정본 기준 25)
- [apps/api/src/server.ts](../../samplepcb-web-mono-app/apps/api/src/server.ts) · [apps/api/.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 등록부(230~234행)·multipart 전역 한도·`SMARTSMT_*` 4종
- [apps/api/prisma/schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) · [migrations/20261113230000_smartsmt_inbound](../../samplepcb-web-mono-app/apps/api/prisma/migrations/20261113230000_smartsmt_inbound/migration.sql) — `SpSmtOrder`·`SpSmtQuote`·`SpSmtReceiveLog`(추가형)
- [apps/api/src/lib/client-ip.ts](../../samplepcb-web-mono-app/apps/api/src/lib/client-ip.ts) · [lib/file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts) · [lib/g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — 보낸 주소·파일서버 클라이언트·회원 대조(재사용)
- [packages/api-contract/src/schemas/smartsmt.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/smartsmt.ts) · [index.ts](../../samplepcb-web-mono-app/packages/api-contract/src/index.ts) — 느슨한 envelope·사유·가져오기 오류·관리자 응답·라벨 사전
- [apps/web/src/next/smt-navigation.ts](../../samplepcb-web-mono-app/apps/web/src/next/smt-navigation.ts) · [next/admin-menu.ts](../../samplepcb-web-mono-app/apps/web/src/next/admin-menu.ts) · [admin/menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/menu.ts) · [router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts) · [i18n ko](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/ko.ts) · [en](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/en.ts) — 모듈 `smt` 배선
- [next/pages/smt/SmtQuotesPage.vue](../../samplepcb-web-mono-app/apps/web/src/next/pages/smt/SmtQuotesPage.vue) · [SmtQuotePage.vue](../../samplepcb-web-mono-app/apps/web/src/next/pages/smt/SmtQuotePage.vue) · [SmtLinkPage.vue](../../samplepcb-web-mono-app/apps/web/src/next/pages/smt/SmtLinkPage.vue) — 받은 견적·견적 상세·연동 상태
- [next/components/smt/smt-envelope.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-envelope.ts) · [smt-badges.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-badges.ts) · [smt-format.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-format.ts) · [useAdminSmt.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/useAdminSmt.ts) · [SmtBlocksSection.vue](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/SmtBlocksSection.vue) — 타입 가드 판독·배지 색·금액 포맷·서버 상태 훅·블록 사유 표
- [e2e/specs/admin-smt.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/admin-smt.e2e.test.ts) · [smartsmt-sso.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/smartsmt-sso.e2e.test.ts) · [e2e/helpers/env.ts](../../samplepcb-web-mono-app/e2e/helpers/env.ts) — 관리자 화면 8·로그인 인계 4(실로그인)·`PORTAL_E2E` 옵트인
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) · [ops/nginx-live/sites-enabled/new-samplepcb](../../ops/nginx-live/sites-enabled/new-samplepcb) — `/api` 프록시·`client_max_body_size 100M`·`X-Real-IP`(변경 없음)
- [docs/ADMIN_NEXT_UI.md](../../docs/ADMIN_NEXT_UI.md) · [docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) — 화면 규약 정본·운영 런북(둘 다 SMT 언급 없음 — 공백 근거)
- 관련 토픽: [sp-node-api](sp-node-api.md) · [sp-vue-web](sp-vue-web.md) · [api-contract](api-contract.md) · [spcb-bridge](spcb-bridge.md) · [testing](testing.md) · [infrastructure](infrastructure.md) · 개념 [core-nonmodification](../concepts/core-nonmodification.md) · [audience-split-dto](../concepts/audience-split-dto.md) · [silent-degradation](../concepts/silent-degradation.md) · [manual-sync-drift](../concepts/manual-sync-drift.md) · [workqueue-case-spine](../concepts/workqueue-case-spine.md) · [parallel-build-cutover](../concepts/parallel-build-cutover.md) · [no-native-dialogs](../concepts/no-native-dialogs.md)
