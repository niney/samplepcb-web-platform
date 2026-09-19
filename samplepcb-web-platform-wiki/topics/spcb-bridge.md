---
topic: spcb-bridge
last_compiled: 2026-09-19
sources_count: 47
status: active
---

# spcb-bridge

## Purpose [coverage: high — 12 sources]

소스 범위 2026-07-02(`me.php`) ~ 2026-09-18(`docs/FIGMA_PAGES.md`). `samplepcb-web/spcb/`는 그누보드5/영카트(sp-php) subtree **안에 있지만 코어가 아닌** 커스텀 브리지 영역이다. "코어 비수정" 원칙(subtree pull 로 보안 패치를 계속 받기 위함) 아래 PHP 쪽에 반드시 있어야 하는 커스텀 코드를 담는 유일한 신규 폴더이며, 모든 `api/*.php` 헤더가 같은 규칙을 반복한다 — "spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다". 2026-07-13 컴파일 때 세 갈래였던 역할이 **다섯 갈래**로 늘었다:

1. **인증 브리지** (`api/me.php`, 2026-07-02) — 그누보드 세션(PHPSESSID)을 sp-node(Fastify)가 검증하는 HS256 JWT(10분)로 변환. 그누보드 = IdP.
2. **주문 알림 브리지** (`api/order-notify.php`, 2026-07-05) — sp-node 가 **역방향**으로 호출. 입금/배송 메일·SMS 를 Node 재구현이 아니라 레거시 커스텀 템플릿으로 발송하고 채널별 결과(sent/failed/skipped)만 돌려준다.
3. **고객 쓰기 브리지 (PHP → sp-node, 2026-08-07 ~ 08-16)** — `eq-decide`(EQ 승인·반려)·`eq-file`(확인 요청 첨부)·`coord-file`(메탈마스크 좌표파일)·`claim-create`(A/S 접수, 사진 multipart). 그누보드 폼 POST 를 받아 **2분짜리 회원 JWT** 로 sp-node 에 중계하고 원래 화면으로 되돌린다. sp-php 가 **처음으로 쓰기 경로에 들어간** 작업(PCB_PARTNER_TRACK P4.1)이며, 판정·저장은 전부 sp-node 다 — PHP 는 로그인·CSRF 만 본다.
4. **사용자 노출 페이지** (`pages/`) — 계정 셸 4종(견적관리 `/shop/quotes`·보관함 `/shop/quotes/archive`·**제조 확인 `/shop/eq`(08-25)**·**A/S 접수 `/shop/as`(08-25)**), 공개 서버렌더 `/reviews`(07-10), **피그마 정적 3종 `/about`·`/history`·`/location`(09-06)**, `/spec`(07-02 의 "준비 중" 한 줄 그대로).
5. **프로빙 실험실** (`previews/`, 2026-09-06) — 로그인 배경 애니메이션 정적 페이지 2벌(`login-bg-claude`·`login-bg-gpt`). 그누보드와 무관한 자족 HTML 이고, 채택안 `center-swap`(연속 회전)은 홈 히어로 banner 01 로 이식됐다(테마 `js/motion-path.js` = 09-06 스냅샷).

견적 페이지의 위상(2026-07-06 위시리스트 숨김·견적관리 일원화)은 그대로다. 2026-08-27 헤더 재편으로 헤더 유틸 아이콘도 견적관리·장바구니·마이페이지 3개가 됐다.

## Architecture [coverage: high — 16 sources]

```
samplepcb-web/spcb/
├── .htaccess              무확장 라우팅(/spcb/api/me → me.php)·Authorization 패스스루·Options -Indexes
├── api/
│   ├── me.php             인증: 세션 → JWT(10분, cartId 포함) + Me 응답
│   ├── order-notify.php   sp-node → PHP: 서비스 JWT 검증 → ordermail.inc.php 재사용 발송
│   ├── eq-decide.php      POST 전용: EQ 승인·반려 → sp-node /api/pcb-eq-reviews/:id/decide (08-10)
│   ├── eq-file.php        GET: 확인 요청 첨부를 sp-node 에서 받아 그대로 스트림 (08-07)
│   ├── coord-file.php     GET: 메탈마스크 좌표파일 — 통보 없는 열람 (08-16)
│   └── claim-create.php   POST 전용: A/S 접수 multipart(사진 ≤10장) → sp-node /api/pcb-claims (08-15)
├── lib/                   include 전용 — Require all denied + _GNUBOARD_ 가드
│   ├── jwt.php            순수 PHP HS256 인코더 + spcb_jwt_decode (Composer 없음)
│   └── secret.php(.example)  SPCB_JWT_SECRET — gitignore, apps/api/.env JWT_SECRET 과 수동 동기
├── pages/
│   ├── quotes.php · quotes-archive.php     셸 + 브라우저 JS (Figma 103:2659 행 문법, 08-27)
│   ├── eq.php · as.php                     서버사이드 브리지 렌더 — 목록만, 결정·접수 폼 없음 (08-25)
│   ├── reviews.php                         서버 렌더, sp_review 직접 SELECT (07-10)
│   ├── about.php · history.php · location.php   피그마 정적 페이지 (09-06) — css·img 는 테마에
│   └── spec.php                            '준비 중' 자리 (07-02 이후 무변경)
└── previews/login-bg-claude · login-bg-gpt   정적 실험실 (index.html·motion-path.js·assets/*.svg)
```

- 모든 PHP 가 `include_once __DIR__ . '/../../common.php'` 로 그누보드를 부트스트랩 — `$member`·`$config`·테마 상수·메일/SMS 라이브러리·`sql_*` 를 빌려 쓴다. 브리지 4종은 여기에 `extend/sp_pcb_eq.extend.php` 를 더 include 한다.
- **라우팅은 Apache mod_rewrite 두 겹**(nginx 는 `/spcb` 를 catch-all `/` 로 PHP 에 넘길 뿐):
  - `spcb/.htaccess`: ① Authorization 헤더 패스스루(`E=HTTP_AUTHORIZATION`) ② 실존 파일/디렉터리 그대로 — **`previews/` 는 실존 디렉터리라 이 규칙으로 서빙된다** ③ 무확장 요청 → 같은 이름 `.php`.
  - 루트 `samplepcb-web/.htaccess`: 규칙 2 = 최상위 슬러그 `/{slug}` → `spcb/pages/{slug}.php`(`/about`·`/history`·`/location`·`/reviews`·`/quotes`·`/eq`·`/as` 별칭이 전부 이걸로) / 규칙 3 = 쇼핑 네임스페이스 명시 리라이트 `/shop/quotes`·`/shop/quotes/archive`·**`/shop/eq`·`/shop/as`(08-25 추가)**.
- **`pages/` 렌더링 패턴은 네 갈래**로 늘었다:
  - **셸 패턴**(`quotes*.php`) — PHP 는 레이아웃·로그인 유도·템플릿 썸네일만, 브라우저 JS 가 `/spcb/api/me` → Bearer 로 `/api/pcb-projects`·`/api/bom/quotes` 를 불러 한 목록으로 섞는다.
  - **서버사이드 브리지 패턴**(`eq.php`·`as.php`, 테마 `orderinquiryview.php` 의 EQ·A/S·진행 섹션) — PHP 안에서 `sp_pcb_node_call()` 이 curl 로 sp-node 를 부르고 결과를 PHP 가 그린다. 견적관리처럼 JS 로 부르지 않는 이유는 "EQ 축이 이미 서버사이드 브리지 관례를 쓰고 화면이 한 벌이면 되기 때문"(eq.php 헤더).
  - **서버 렌더 직접 SELECT**(`reviews.php`) — 로그인 불필요 공개 페이지라 그누보드 `sql_query` 로 `sp_review` 를 읽는다.
  - **피그마 정적 패턴**(`about`·`history`·`location`) — `spcb/pages/<slug>.php` + `theme/sp-lite/css/<slug>.css` + `theme/sp-lite/img/<slug>/`. 연혁·사무실·통계 같은 데이터는 PHP 파일 안 배열(`$sp_history`·`$sp_offices`·`$sp_stats`·`$sp_map_src`)이다. 피그마 오류는 고치지 않고 `docs/FIGMA_PAGES.md` 에 적는다.
- **브리지의 서버사이드 절반은 spcb/ 밖 `extend/` 에 있다**: `sp_pcb_eq.extend.php`(`SPCB_NODE_BASE=http://127.0.0.1:3333` 직결·`sp_pcb_member_token()` 2분 JWT·`sp_pcb_node_call()` 5초 curl·`sp_pcb_progress(_batch)()`·`sp_pcb_check_token()`·파일 URL 헬퍼), `sp_pcb_claim.extend.php`(A/S mine·count·라벨), `sp_bom_claim.extend.php`(부품 BOM 사전 — PCB 와 함수 분리). extend 는 `common.php` 가 전부 로드하므로 페이지는 `function_exists` 가드만 두고 부른다.
- **결과 안내는 코어 `alert()` 을 쓰지 않는다** — 코어 alert 은 `bbs/alert.php` 로 페이지를 갈아치운 뒤 네이티브 팝업을 띄운다. 대신 원래 화면으로 리다이렉트하며 `?sp_msg=&sp_tone=` 를 실어 보내고 테마 `js/sp-dialog.js` 가 모달로 띄운 뒤 `replaceState` 로 지운다.
- **계정 사이드바 SSOT**(`theme/sp-lite/shop/_account_nav.php`)가 `$sp_account_active`(quotes|eq|as)로 활성 메뉴를 받고, 배지 건수는 브리지 count 함수(`sp_pcb_eq_open_count`·`sp_pcb_claim_active_count`+`sp_bom_claim_active_count`)로 채운다.

## Talks To [coverage: high — 14 sources]

| 상대 | 방향 | 내용 |
|---|---|---|
| 그누보드 코어 | include | `common.php` 부트스트랩, `set_cart_id()`/`get_session('ss_cart_id')`, `mailer.lib.php`, `ordermail.inc.php`, `get_paging()`, `get_token()`·`_get_token_key/secret()`(CSRF 복제용), `goto_url()` |
| sp-node `/api` (nginx 경유) | 브라우저 | quotes 페이지 JS 가 me.php JWT 로 `/api/pcb-projects`·`/api/bom/quotes`·`…/order` 호출 |
| sp-node **내부 직결** `127.0.0.1:3333` | **PHP → Node (서버 간)** | extend 브리지가 nginx 를 거치지 않고 curl: `GET /api/pcb-eq-reviews?odId=`·`/mine?scope=`·`POST …/:id/decide`·`GET …/:id/files/:fileId`, `GET /api/pcb-claims?odId=`·`/mine`·`POST /api/pcb-claims`(multipart), `GET /api/bom/claims/mine`, `GET /api/order-progress?odId=`·`POST /api/order-progress/batch`, `GET /api/pcb-progress/coord-files/:id` |
| sp-node → PHP | **Node → PHP (서버 간)** | `php-bridge.ts` `notifyOrderEvent` 가 `SPCB_BRIDGE_URL`(기본 `http://127.0.0.1:8888`)`/spcb/api/order-notify` 에 서비스 JWT(`svc:'sp-node'`, 10초 타임아웃)로 POST. 결과는 sp-node 가 `sp_mail_log` 에 기록(`notifyOrderEventLogged`, kind `order_deposit`·`order_delivery`) |
| sp-vue · sp-market · 거버 뷰어 · e2e | 클라이언트 | `GET /spcb/api/me`(credentials: include)로 토큰 수령. e2e 하네스는 이 라우트를 **스텁**해 로그인을 대신한다(`e2e/helpers/browser.ts`) |
| 영카트 shop | 링크·리다이렉트 | [바로 주문]→`orderform.php`, 비로그인→`bbs/login.php?url=…`, 브리지 결과→`orderinquiryview.php?od_id=…&sp_msg=` |
| 테마 sp-lite | include·폼·asset | `_account_nav.php`(사이드바 SSOT)·`inc/reviews_lib.php`·`default_shop.css`·`sp-dialog.js`; `orderinquiryview.php` 의 승인·반려 폼이 `/spcb/api/eq-decide` 로, A/S 폼이 `/spcb/api/claim-create` 로 POST; `inc/seo_head.php` 가 spcb 페이지를 파일명으로 매칭; 홈 `js/home/hero.js` 가 previews 채택안을 사용 |
| `sp_*` 테이블 (Prisma 소유) | **read-only SELECT** | `sp_review`(reviews.php) · `sp_pcb_eq_review ⋈ sp_order_spec`·`sp_pcb_claim`·`sp_bom_claim`(사이드바 배지 count) · `sp_seo`(seo_head) · `sp_order_spec ⋈ sp_file`(주문서 썸네일 서명 URL, `sp_quote_cart.extend.php`) — "PHP 는 sp_* 에 쓰지 않는다"의 읽기 전용 예외들 |

CORS: me.php 는 `https://*.samplepcb.co.kr` 오리진만 반사(credentialed 라 와일드카드 불가). 서버 간 호출 두 방향(order-notify·extend curl)은 CORS 대상이 아니다.

## API Surface [coverage: high — 10 sources]

**`GET /spcb/api/me`** — 세션으로 회원 확인, 비로그인 `401 {"message":"not authenticated"}`. 성공 `{ token, member:{mbId,mbNick,level,isAdmin} }`, `Cache-Control: no-store`. 클레임 `mbId·mbNick·level·isAdmin(cf_admin 만 true)·cartId(ss_cart_id = g5_shop_cart.od_id)·iat·exp(+600초)`. `@sp/api-contract` `Me`/`JwtClaims` 와 정합.

**`POST /spcb/api/order-notify`** — 서비스 JWT(`svc:'sp-node'`, `spcb_jwt_decode` 검증) 필수. body `{odId, event:'입금'|'준비'|'배송'|'완료', mail, sms, dryRun}`. 입금·배송만 발송 대상(`ordermail.inc.php` include + `conv_sms_contents` 미러), 준비·완료는 `skipped`. 응답 `{mail, sms}` = sent/skipped/failed — **`mailer()` 반환을 검사하지 않아** SMTP 실패도 `sent`.

**`POST /spcb/api/eq-decide`** (eq-decide.php, 로그인+CSRF `token`) — `review_id`·`decision=approve|reject`·`note`(반려 시 2자 이상)·`od_id`. sp-node `POST /api/pcb-eq-reviews/:id/decide` 로 중계. 409(재제출·그 사이 관리자가 EQ 를 움직여 닫힘)는 **sp-node 문구를 그대로** 실어 되돌린다. GET 은 '잘못된 접근' 리다이렉트만.

**`GET /spcb/api/eq-file?review=&file=`** (eq-file.php) — sp-node 파일 라우트가 Bearer 를 요구해 `<a href>` 로 직접 못 여는 것을 대신한다. `Content-Type`·`Content-Disposition` 헤더를 sp-node 응답에서 승계(UTF-8 한글 파일명 포함), 실패는 Referer(없으면 주문내역)로 `sp_msg` 리다이렉트. 공개 여부(`sharedFileIds`)는 sp-node 판정.

**`GET /spcb/api/coord-file?file=`** (coord-file.php) — eq-file 과 같은 구조지만 **`review` 파라미터가 없다**: 요청도 결정도 통보도 없는 열람. sp-node `/api/pcb-progress/coord-files/:id` 가 종류(coord)·단계(관리자 확인 완료)·소유권을 판정하고 파일명을 `부품좌표_{프로젝트}.{ext}` 로 중립화한다.

**`POST /spcb/api/claim-create`** (claim-create.php, 로그인+CSRF, multipart) — `spec_id`·`kind`·`affected_qty`·`description`(5자 이상)·`requested_remedy`·`acknowledge=1`(자동 환불 아님 확인)·`photos[]`. 사진을 `CURLFile` 로 붙여 `POST /api/pcb-claims` 에 **1회 제출로 중계**(최대 10장, 30초). 소유권·배송 후·활성 클레임·수량 판정은 sp-node.

**페이지 URL**: `/shop/quotes`(=`/quotes`) · `/shop/quotes/archive`(=`/quotes-archive`) · `/shop/eq?scope=open|all`(=`/eq`) · `/shop/as?track=pcb|bom&scope=open|all`(=`/as`) · `/reviews?page=` · `/about` · `/history` · `/location` · `/spec` · `/spcb/previews/login-bg-{claude,gpt}/`(정적, 설정은 localStorage·`#effect=` 해시).

## Data [coverage: high — 11 sources]

spcb/ 자체는 **DB 테이블을 소유하지 않는다**. 실체(sp_quote·sp_order_spec·sp_review·sp_pcb_eq_review·sp_pcb_claim·sp_bom_claim·sp_seo·sp_mail_log)는 sp-node(Prisma) 소유이고, PHP 는 어느 것에도 쓰지 않는다.

- **JWT 는 한 대칭키에 네 용도**: ① 회원 JWT 10분(me.php, cartId 포함) ② 서비스 JWT(sp-node 가 서명, PHP 가 검증) ③ **브리지 회원 JWT 2분**(`sp_pcb_member_token()` — 요청 1회용, cartId 없음) ④ 주문서 썸네일 서명 URL(`sp_quote_cart.extend.php`, `HMAC("thumb:{id}:{exp}")` 15분). `lib/secret.php` ↔ `apps/api/.env` `JWT_SECRET` 수동 동기(gitignore, `.example` 만 추적).
- **판정과 세기의 분리**: 목록·결정·접수·진행은 전부 sp-node API 응답을 그리고, **사이드바 배지 건수만 DB 직접 count** 한다(`sp_pcb_eq_review.status='requested'` ⋈ `sp_order_spec.mbId`, `sp_pcb_claim`/`sp_bom_claim` `status in ('open','reviewing')`). 이유: 사이드바는 마이페이지·장바구니·포인트·쪽지 등 **모든 계정 페이지**에서 렌더돼 API 를 태우면 그 전부에 HTTP 왕복이 붙는다. 상태 문자열이 유효한 대기인 근거는 sp-node 쪽 전이(`closeOpenEqReviews`)에 있다.
- **고객 진행 표시는 od 무접촉**: `sp_pcb_progress()`/`sp_pcb_progress_batch()`(50건 청크)가 트랙 공용 `/api/order-progress` 를 소비하고, 배지 우선순위 SSOT 는 PHP `sp_order_status_customer($status,$progress)`(`sp_order_status.extend.php`) — 결제 뒤·배송 전 구간(입금~생산완료)에서만 진행이 od 배지를 덮는다.
- **라벨 사전 PHP 미러 3종(수동 동기)**: `sp_pcb_eq_status_label` ↔ 계약 `PCB_EQ_REVIEW_STATUS_LABELS`, `sp_pcb_claim_status_label/kinds/remedies/resolution_label` ↔ `PCB_CLAIM_*_LABELS`, `sp_order_status_customer` ↔ `mergedOrderCustomerLabel`.
- reviews.php: `sp_review` `isConfirm=1` 최신순 10건/페이지, `legacyJson.is_name` 추출, 본문 태그 전제거→이스케이프→`nl2br`, 실명 가운데 마스킹.
- 정적 페이지 인라인 데이터: `history.php` `$sp_history`(2023-05 까지)·`$sp_stats`(**피그마 자리표시 수치 — 운영 전 교체 필수**), `location.php` `$sp_offices`(본사 A-1303·공사 A-1407)·`$sp_map_src`(구글 임베드, 키 불필요).
- SEO: `seo_head.php` 가 spcb 페이지를 `scope=page, refKey=<파일명>.php`(예 `about.php`)로 `sp_seo` 에서 read-only 조회 — 관리는 sp-vue `/app/admin/seo`.
- 견적 카드 썸네일 `category→it_id` 매핑은 여전히 sp-node `g5-db.ts` `TEMPLATE_ITEMS` 와 수동 동기(quotes·quotes-archive 두 곳).
- 알림 발송 조건은 `g5_config`(`cf_email_use`·`cf_sms_use==='icode'`)·`g5_shop_default`(`de_sms_use4/5`)·`g5_shop_order`(수납액·운송장)를 코어 함수로 읽어 판정.

## Key Decisions [coverage: high — 13 sources]

- **2026-09-06 — 피그마 정적 페이지는 "그대로 옮기고 오류는 기록만"** — `/about`·`/history`·`/location` 을 `spcb/pages/<slug>.php`+테마 css/img 패턴으로. 피그마의 미완성 문장·카드 불일치·로고 허락·Unsplash 워터마크는 고치지 않고 `docs/FIGMA_PAGES.md` 대장에 적는다. 지도는 네이버 스크린샷 대신 구글 임베드(키 불필요). **Contact Us 폼은 제외** — 접수 백엔드(A 게시판 / B PHP 단독 / C sp-node `sp_contact_inquiry`+`/api/contact`+관리자 문의함, **추천 C**)가 `docs/CONTACT_INQUIRY.md` 에 사용자 결정 대기로 남아 있다(09-19 현재 미결).
- **2026-09-06 — 프로빙은 spcb/previews/ 의 자족 정적 페이지로** — 로그인 배경 애니메이션 실험실 2벌(Claude·GPT). 그누보드·인증·DB 무관. 채택안 `center-swap`(연속 회전)만 테마 `js/motion-path.js` 스냅샷으로 이식해 홈 히어로 banner 01 이 쓴다. README 는 "검토 끝나면 폴더째 삭제"라 했으나 09-19 현재 남아 있다.
- **2026-08-27 — 견적관리·보관함을 Figma 103:2659 행 문법으로** — `.sp-quotes--fig` 스코프, 우측 '주문 예상 금액' 패널, VAT 포함 툴팁. **수량 재견적 입력 제거**(수량이 다르면 새 견적). 보관함은 옛 카드(B)에서 같은 행 문법 전폭(`.sp-quotes--archive`, A)으로 정정.
- **2026-08-25 — 마이페이지 진입점 2종은 "목록은 목록만"** — `/shop/eq`(제조 확인)·`/shop/as`(A/S 접수)는 결정·접수 폼을 **복제하지 않고** 주문 상세 앵커(`#eq-{id}`·`#sp_as_wrap`·`#as-{id}`, 메일이 쓰는 바로 그 링크)로 보낸다. 폼이 두 곳이면 첨부·기한·확인 모달·수량 검증이 갈린다. A/S 는 PCB/부품 BOM **탭 분리·'전체' 탭 없음**(같은 `resolved` 가 트랙마다 다른 말), 부품 탭은 부품 축이 있는 회원에게만. 화면에 'EQ' 를 쓰지 않는다(스텐실 고객에겐 없는 단어 — "제조 확인").
- **2026-08-25 — 고객 진행 표시는 od 무접촉으로 PHP 가 sp 파생을 병합** — `/api/order-progress` 를 PHP 브리지가 소비하고 배지·줄·카드·스텝퍼가 같은 축을 쓴다. od 는 안 바꾼다(D6).
- **2026-08-16 — 좌표파일은 통보 없는 열람** — 확인 요청(D16)과 **다른 축**이라 `coord-file.php` 에 `review` 파라미터가 없다. 관리자 확인 뒤·최신 1건·이름 중립화 세 제약은 sp-node 가 건다.
- **2026-08-15 — A/S 접수는 사진까지 PHP 가 multipart 로 중계** — `claim-create.php` 가 `CURLFile` 로 1회 제출(≤10장, 30초). 배송 후·활성 1건·수량 게이트는 sp-node. EQ 브리지와 동형이되 사전은 트랙별로 나눈다(`sp_bom_claim.extend.php` 신설).
- **2026-08-07 — sp-php 를 처음으로 쓰기 경로에 넣되, 네 가지 규칙으로** — ① **링크는 GET 으로 열기만, 결정은 화면 안 POST**(메일 보안 게이트웨이가 링크를 자동 GET 하므로 GET 으로 상태가 바뀌면 고객이 열어보기도 전에 승인된다 — eq-decide·claim-create 모두 GET 무동작) ② **PHP 는 sp_* 에 쓰지 않는다**(권한·상태·회차 판정을 두 곳에 복제하면 어긋난다 — sp-node 단일 판정) ③ 세션 → 2분 JWT → `127.0.0.1:3333` 직결 curl(빠르고 외부 노출 없음) ④ 코어 `alert()`·`check_token()` 폐기 — `?sp_msg`+`sp-dialog.js` 모달, `sp_pcb_check_token()` 복제.
- **2026-07-10 — 별점후기 노출은 sp_review 직접 조회 브릿지** — 표준 `itemuselist.php` 는 `g5_shop_item_use` 0건·INNER JOIN 으로 구조적 표시 불가. 코어·`.htaccess` 무변경으로 `reviews.php` 신설.
- **2026-07-06 — 위시리스트 숨김·견적관리 일원화 / 계정 사이드바 SSOT 공유** — `SP_USE_WISHLIST`(기본 false) 뒤로 진입점만 숨김, `_account_nav.php` include.
- **2026-07-05 — 알림은 Node 가 아니라 PHP 브리지 재사용 + 서비스 JWT** — `order-notify.php` 가 `ordermail.inc.php` 를 그대로 쓰고, 실패는 sp-node 가 삼켜 전이 성공을 흔들지 않는다. 회원 JWT 와 같은 시크릿으로 `svc:'sp-node'` 서명.
- **2026-07-03 / 07-02 — 견적관리는 sp-php(`spcb/pages/`)·한 건은 한 화면에만·코어 비수정의 PHP 측 수용처가 spcb/** — 라우팅은 `.htaccess` 리라이트로만, JWT 는 TTL 10분·저장 금지(세션=진실원본), `jwt.php` 는 Composer 없는 순수 PHP.

## Gotchas [coverage: high — 12 sources]

- **`get_token()` 은 hidden 태그가 아니라 값만 반환** — `<?php echo get_token(); ?>` 를 그냥 찍으면 토큰이 화면에 노출되고 폼에 `name="token"` 이 없어 **제출이 전부 막힌다**(08-07 실측). `<input type="hidden" name="token" value="…">` 로 감쌀 것.
- **`sp_pcb_check_token()` 은 코어 `check_token()` 의 복제** — 코어는 실패 시 자체 alert 로 끝나 감쌀 수 없어 검증만 복제했다. `lib/common.lib.php` 가 바뀌면 같이 맞춰야 한다.
- **sp-node 직결 주소는 상수** — `SPCB_NODE_BASE` 가 `127.0.0.1:3333` 으로 `define` 가드돼 있다(env 아님). 반대 방향 order-notify 는 env `SPCB_BRIDGE_URL`(기본 8888). 포트가 바뀌면 두 곳이 따로 논다.
- **브리지 실패는 조용히 섹션을 감춘다** — `sp_pcb_node_call()` 은 5초 타임아웃·실패 시 `null` 이고 페이지는 섹션을 숨긴 채 계속 뜬다(주문내역이 죽으면 안 된다). EQ·A/S·진행 섹션이 비어 보이면 sp-node 다운·시크릿 불일치를 먼저 의심할 것. 파일·클레임 브리지는 30초.
- **`secret.php` 미배치 시 동작이 갈린다** — extend 브리지와 썸네일 URL 은 `is_file` 확인 후 로드해 빈 문자열로 폴백하지만, `me.php`·`order-notify.php` 는 `include_once` 직행이라 Fatal.
- **배지 count 의 상태 문자열은 sp-node 사전과 수동 동기** — `'requested'`·`'open'`·`'reviewing'` 을 PHP 가 직접 SELECT 한다. sp-node 가 상태값을 바꾸면 배지만 조용히 0 이 된다.
- **라벨 사전 PHP 미러 3종**(Data 절)도 같은 함정 — 계약 라벨을 바꾸면 PHP 쪽 switch 를 따로 고쳐야 한다.
- **previews/ 는 운영에 그대로 노출된다** — 실존 디렉터리라 `.htaccess` 규칙 1 로 서빙되고 인증이 없다. 채택은 끝났으니 삭제 후보. README 가 참조하는 형제 `login-background/` 는 리포에 없다(다른 세션 실험실, 미커밋).
- **정적 페이지의 자리표시 값** — `history.php` `$sp_stats` 수치·연혁 2023-05 까지·로고 사용 허락·Unsplash 워터마크 사진은 운영 배포 전 교체 항목(`docs/FIGMA_PAGES.md`).
- **SEO 매칭 키는 슬러그가 아니라 파일명** — `/about` 의 `sp_seo` refKey 는 `about.php`.
- **알림이 안 나가면 확인 순서**: ① `SPCB_BRIDGE_URL`/JWT 시크릿 정합(불일치=401) ② `access.log` 에 `POST /spcb/api/order-notify` ③ 로컬은 `127.0.0.1:25` Mailpit ④ 발송 조건(입금/배송·수납액/운송장·`cf_email_use`). **브리지는 `sent` 라도 실제 발송 실패 가능**(`mailer()` 반환 미검사 — `apache/logs/error.log`).
- **Authorization 패스스루 없으면 서비스 JWT 유실** — `.htaccess` 의 `E=HTTP_AUTHORIZATION` 규칙 필수. 무확장/슬러그 라우팅은 **Apache(mod_php) 전제**(`AllowOverride All`+mod_rewrite).
- me.php 의 CORS 는 **https 오리진만** — http dev 오리진 미반사. `lib/` 는 `Require all denied`+`_GNUBOARD_` 가드 이중 차단.
- 썸네일 `category→it_id` 매핑은 sp-node `TEMPLATE_ITEMS` 와 수동 동기(quotes·quotes-archive 두 곳). **reviews.php 는 shop.head 밖**이라 페이징 스타일을 인라인 `<style>` 로 정의. 숨긴 위시리스트는 직접 URL 로는 여전히 동작.

## Sources [coverage: high — 47 sources]

- [samplepcb-web/spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — 무확장 라우팅·Authorization 패스스루
- [samplepcb-web/spcb/lib/.htaccess](../../samplepcb-web/spcb/lib/.htaccess) · [lib/.gitignore](../../samplepcb-web/spcb/lib/.gitignore) · [lib/secret.php.example](../../samplepcb-web/spcb/lib/secret.php.example) — lib 차단·시크릿 템플릿
- [samplepcb-web/spcb/lib/jwt.php](../../samplepcb-web/spcb/lib/jwt.php) — HS256 인코더 + spcb_jwt_decode
- [samplepcb-web/spcb/api/me.php](../../samplepcb-web/spcb/api/me.php) — 인증 브리지
- [samplepcb-web/spcb/api/order-notify.php](../../samplepcb-web/spcb/api/order-notify.php) — 주문 알림 브리지
- [samplepcb-web/spcb/api/eq-decide.php](../../samplepcb-web/spcb/api/eq-decide.php) — EQ 승인·반려 브리지(POST 전용)
- [samplepcb-web/spcb/api/eq-file.php](../../samplepcb-web/spcb/api/eq-file.php) — 확인 요청 첨부 다운로드 브리지
- [samplepcb-web/spcb/api/coord-file.php](../../samplepcb-web/spcb/api/coord-file.php) — 좌표파일 다운로드 브리지
- [samplepcb-web/spcb/api/claim-create.php](../../samplepcb-web/spcb/api/claim-create.php) — A/S 접수 multipart 중계
- [samplepcb-web/spcb/pages/quotes.php](../../samplepcb-web/spcb/pages/quotes.php) · [quotes-archive.php](../../samplepcb-web/spcb/pages/quotes-archive.php) — 견적관리·보관함(셸 패턴)
- [samplepcb-web/spcb/pages/eq.php](../../samplepcb-web/spcb/pages/eq.php) · [as.php](../../samplepcb-web/spcb/pages/as.php) — 제조 확인·A/S 접수 목록(서버사이드 브리지)
- [samplepcb-web/spcb/pages/reviews.php](../../samplepcb-web/spcb/pages/reviews.php) — 고객후기(sp_review 직접 SELECT)
- [samplepcb-web/spcb/pages/about.php](../../samplepcb-web/spcb/pages/about.php) · [history.php](../../samplepcb-web/spcb/pages/history.php) · [location.php](../../samplepcb-web/spcb/pages/location.php) · [spec.php](../../samplepcb-web/spcb/pages/spec.php) — 정적 페이지
- [samplepcb-web/spcb/previews/login-bg-claude/README.md](../../samplepcb-web/spcb/previews/login-bg-claude/README.md) · [login-bg-gpt/README.md](../../samplepcb-web/spcb/previews/login-bg-gpt/README.md) — 로그인 배경 프로빙 실험실
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 루트 슬러그·/shop/{quotes,eq,as} 라우팅
- [samplepcb-web/extend/sp_pcb_eq.extend.php](../../samplepcb-web/extend/sp_pcb_eq.extend.php) — 브리지 공통(직결 주소·2분 JWT·node_call·진행·CSRF 복제)
- [samplepcb-web/extend/sp_pcb_claim.extend.php](../../samplepcb-web/extend/sp_pcb_claim.extend.php) · [sp_bom_claim.extend.php](../../samplepcb-web/extend/sp_bom_claim.extend.php) — A/S 목록·배지·라벨(트랙별)
- [samplepcb-web/extend/sp_order_status.extend.php](../../samplepcb-web/extend/sp_order_status.extend.php) — 고객 상태 라벨 SSOT(진행 병합)
- [samplepcb-web/extend/sp_quote_cart.extend.php](../../samplepcb-web/extend/sp_quote_cart.extend.php) — 썸네일 서명 URL(같은 시크릿)
- [theme/sp-lite/shop/_account_nav.php](../../samplepcb-web/theme/sp-lite/shop/_account_nav.php) · [shop/orderinquiryview.php](../../samplepcb-web/theme/sp-lite/shop/orderinquiryview.php) — 사이드바 SSOT·브리지 폼 호출부
- [theme/sp-lite/inc/seo_head.php](../../samplepcb-web/theme/sp-lite/inc/seo_head.php) — sp_seo basename 매칭
- [theme/sp-lite/js/motion-path.js](../../samplepcb-web/theme/sp-lite/js/motion-path.js) · [js/home/hero.js](../../samplepcb-web/theme/sp-lite/js/home/hero.js) — previews 채택안 이식처
- [apps/api/src/lib/php-bridge.ts](../../samplepcb-web-mono-app/apps/api/src/lib/php-bridge.ts) · [packages/shared/src/auth.ts](../../samplepcb-web-mono-app/packages/shared/src/auth.ts) — Node 측 브리지 클라이언트·me 소비
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 인증·알림 브리지 계약·파일 색인
- [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — D16·P4.1·P4.1-b·P4.13~16·P5·P5-b·메탈마스크 절
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) — D17 견적관리 통합·§6.29 D37·§6.36 고객 진행
- [docs/MAIL_LOG.md](../../docs/MAIL_LOG.md) — PHP 브리지 결과만 기록
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) · [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — 발송 조건·Mailpit
- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — 피그마 페이지 대장·미결
- [docs/CONTACT_INQUIRY.md](../../docs/CONTACT_INQUIRY.md) — 문의 접수 A/B/C(결정 대기)
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) — sp_seo·spcb 페이지 basename 매칭
- [docs/review-naming.md](../../docs/review-naming.md) · [docs/wishlist-hidden.md](../../docs/wishlist-hidden.md) — /reviews 배경·위시 숨김
- [AGENTS.md](../../AGENTS.md) — 인증 브리지 단일 설명원본
- 관련 토픽: [theme-sp-lite](theme-sp-lite.md) · [sp-node-api](sp-node-api.md) · [gnuboard-integration](gnuboard-integration.md) · 개념 [core-nonmodification](../concepts/core-nonmodification.md) · [judgment-single-owner](../concepts/judgment-single-owner.md) · [manual-sync-drift](../concepts/manual-sync-drift.md) · [lazy-derived-state](../concepts/lazy-derived-state.md)
