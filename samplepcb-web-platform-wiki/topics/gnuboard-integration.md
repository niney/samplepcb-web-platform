---
topic: gnuboard-integration
last_compiled: 2026-07-03
sources_count: 7
status: active
---

# gnuboard-integration

그누보드5/영카트 코어를 **git subtree(pull only)** 로 유지하면서, 커스텀은 코어 밖 계층(`extend/`·`spcb/`·테마·모노레포)에만 두는 통합 전략.

## Purpose [coverage: high — 5 sources]

- `samplepcb-web-platform` 은 **단일 git repo**. 그누보드5/영카트 PHP 코어는 `samplepcb-web/` 에 **git subtree** 로 들어와 있고, 신규 Vue+Node 는 `samplepcb-web-mono-app/` 일반 서브폴더다.
- 목표: **코어를 직접 수정하지 않고** 공식 보안 패치(gnuboard5 `master`, 5.6.x 보안 라인)를 subtree pull 로 계속 받는다. 코어 비수정 원칙을 지키면 pull 시 거의 무충돌.
- 구 `youngcart5` repo(2021 archived)는 사용 금지 — 영카트 기능도 gnuboard5 master 라인에서 온다.
- `samplepcb-web/README.md` 는 사실상 비어 있음(1줄) — 원본 설명은 upstream repo 참조.

## Architecture [coverage: high — 5 sources]

**리모트 구성**

```
origin   = github.com/niney/samplepcb-web-platform   (push 대상)
gnuboard = github.com/gnuboard/gnuboard5             (subtree 소스, push 차단)
```

**커스텀 계층 규칙** — 코어(`bbs/`·`shop/`·`lib/`·`adm/`·루트 `*.php`)는 subtree 충돌 지점이므로 손대지 않고, 커스텀은 아래 계층에만:

| 계층 | 위치 | 용도 |
|---|---|---|
| extend | `samplepcb-web/extend/*.extend.php` | 그누보드 공식 훅 지점 (예: `shop.extend.php` — 배송업체 목록·매출전표 URL 등 상수 재정의) |
| spcb | `samplepcb-web/spcb/` | 신규 커스텀 영역 — 인증 브리지 `api/me.php`, 커스텀 페이지 `pages/*.php` |
| 테마/스킨 | `samplepcb-web/theme/sp-lite/` | 코어 스킨을 테마로 오버라이드 (예: `shop/cart.php` 견적 행 분기) |
| 모노레포 | `samplepcb-web-mono-app/` | 신규 기능은 Vue(`/app`)+Node Fastify(`/api`) |
| 라우팅 | `samplepcb-web/.htaccess` | 신규 파일(코어 비수정)로 짧은 URL — `/spec` → `spcb/pages/spec.php`, `/shop/quotes` → `spcb/pages/quotes.php`. 실존 파일/디렉터리 우선 서빙이라 코어 경로와 충돌 없음 |

- 네이밍: 그누보드가 강제하는 규약(`*.extend.php`·`*.skin.php`·snake_case)은 그대로, 우리가 정하는 이름은 `kebab-case`(예: `theme/sp-lite`).
- 현재 `extend/` 파일: `shop.extend.php`, `social_login.extend.php`, `sms5.extend.php`, `debugbar.extend.php`, `default.config.php`, `version.extend.php`, `g5_54version_update.extend.php`, `smarteditor_upload_extend.php`.

## Talks To [coverage: medium — 4 sources]

- **nginx 통합 호스트** `local-web.samplepcb.co.kr`: `/api`→Node(3333) · `/app`→Vue(5173) · `/`(catch-all)→PHP Apache(8888). `/app`·`/api` 는 그누보드 예약 경로가 아니라 안전. `/spcb` 는 별도 location 없이 catch-all 로 PHP 가 처리. 레퍼런스: `ops/nginx/local-web.conf` (실구동은 repo 밖 `D:\nginx\conf\nginx.conf`).
- **인증 브리지 (그누보드 = IdP)**: 같은 도메인 PHPSESSID → `GET /spcb/api/me` 가 `$member` 기반 HS256 JWT(TTL 10분) 발급 → Vue 가 `/api` 에 Bearer 전달 → Fastify 는 공유 시크릿으로 JWT 만 검증. 시크릿은 `spcb/lib/secret.php`(gitignore) ↔ `apps/api/.env` `JWT_SECRET` 수동 동기화.
- **upstream**: `git fetch gnuboard master` → subtree pull. 새 버전 확인은 sir.kr 자료실 / GitHub master.

## API Surface [coverage: medium — 3 sources]

- 그누보드 측이 외부(sp-node/sp-vue)에 제공하는 표면은 사실상 `GET /spcb/api/me`(JWT 발급, cart 연동용 `cartId` 클레임 포함) 하나.
- `.htaccess` 리라이트가 만드는 사용자 URL: `/{슬러그}` (spcb/pages 에 동명 .php 존재 시), `/shop/quotes`, `/shop/quotes/archive` — 파일은 코어 `shop/` 이 아닌 `spcb/pages/` 에 둔다.
- extend 훅: `shop.extend.php` 는 `G5_USE_SHOP` 일 때 `G5_DELIVERY_COMPANY`·매출전표 URL 상수를 정의하고 shop 라이브러리를 include — 코어가 자동 로드하는 공식 확장 지점.

## Data [coverage: high — 5 sources]

- **DB 공유**: `sp_*` 테이블(Prisma 소유)은 그누보드 DB(`samplepcb`)에 g5_* 와 **동거**(2026-07-03 통합 — 백업 정합성·조인). 회원 식별은 JWT 클레임으로만 — 스키마 결합은 회피.
- **데이터 소유권**: `sp_quote`/`sp_order_spec`/`sp_file` = sp-node 소유(PHP 는 접근 금지). `g5_shop_cart`·`g5_shop_item_option`·`g5_shop_item` = 영카트 코어 소유(sp-node 는 한정 예외로만 접근, `apps/api/src/lib/g5-db.ts` 에 명시).
- cart↔spec 관계는 **저장하지 않고** 조회 시점 조인으로 파생 — 동기화 로직이 없어 불일치가 불가능.
- 비밀값은 `samplepcb-web/data/dbconfig.php`(gitignore).

## Key Decisions [coverage: high — 6 sources]

1. **코어 비수정 + subtree pull only** — 보안 패치를 계속 받는 것이 최우선. 갱신은 오직 `git subtree pull --prefix=samplepcb-web gnuboard master --squash`. 코어를 고치면 그 파일이 pull 충돌 지점이 된다(부득이 수정 시 `// [samplepcb]` 주석).
2. **`config.php` 수정 금지** — `G5_DOMAIN=''` 유지. https 는 `proxy_fix.php`(php.ini `auto_prepend_file`) 로 해결, 운영 도메인이 달라도 `g5_path()` 가 `HTTP_HOST` 를 쓰므로 자동.
3. **커스텀 계층 규칙** — 훅은 `extend/`, 신규 페이지·인증은 `spcb/`, 화면 오버라이드는 테마(`theme/sp-lite`), 신규 기능은 모노레포. URL 은 코어 밖 `.htaccess` 리라이트로 확보.
4. **g5 테이블 한정 예외 4종** (코어 무수정 기법 카탈로그, `docs/GERBER_ORDER_FLOW.md` 4장): 그 외 g5_* 쓰기는 금지.
   - ① `g5_shop_cart` **직접 INSERT** — cart 스냅샷 모델을 역이용, `cartupdate.php` 우회로 행마다 다른 `it_name`·사양요약·가격 주입.
   - ② `g5_shop_item_option` **옵션 행 INSERT(+보상 DELETE)** — 견적가를 `io_price` 에 실어(`io_id=quoteId`) 코어의 가격 재검증(`before_check_cart_price`)을 정당하게 통과.
   - ③ **파생 SELECT** — cart 행 존재 여부로 삭제를 지연 감지(lazy reconcile), 훅·트리거 없이 흡수.
   - ④ `ct_select`/`ct_select_time` **행(ct_id) 단위 UPDATE** — 코어 "주문하기"의 it_id 단위 선택이 템플릿 공유 견적을 함께 선택하는 문제 우회.
5. **테마 스킨 분기로 코어 UI 버그 차단** — cart [선택사항수정] 팝업의 선형 곱 오류는 코어 수정 대신 `theme/sp-lite/shop/cart.php` 에서 견적 행만 버튼 숨김.

## Gotchas [coverage: high — 5 sources]

- **subtree pull 절차**: repo 루트에서 `git fetch gnuboard master && git subtree pull --prefix=samplepcb-web gnuboard master --squash`. **작업 트리가 깨끗해야** 한다. `--squash` 로 upstream 전체 이력을 끌어오지 않음. 충돌은 내가 코어를 만진 파일에서만 발생 — 수동 병합 후 `git add && git commit`, 실패 시 `git reset --hard ORIG_HEAD`.
- **gnuboard 리모트 push 절대 금지** — `no_push` push URL + pre-push 훅(`git config core.hooksPath .githooks`) 3중 차단. 새 클론에서는 리모트 추가·no_push·hooksPath 1회 셋업 필요.
- **`prisma migrate reset` 절대 금지** — sp_* 가 그누보드 DB(`samplepcb`)에 동거하므로 reset 은 **g5_* 전체를 드랍**한다.
- `samplepcb-web..gnuboard/master` 직접 log 비교는 subtree 라 제한적 — 보통 그냥 pull 해보고 충돌로 판단.
- `.htaccess` 리라이트 전제: vhost `AllowOverride All` + `mod_rewrite`. 슬러그 규칙은 소문자·숫자·하이픈 1단계만, `spcb/pages/{슬러그}.php` 실존 시에만 동작.
- 레거시 `estimate_*` 페이지는 코어가 아닌 레거시 커스텀 — subtree 에 없다(찾으려 하지 말 것).

## Sources [coverage: high — 7 sources]

- [CLAUDE.md](../../CLAUDE.md) — 요약 지침(단일 repo·subtree·코어 비수정)
- [AGENTS.md](../../AGENTS.md) — 구조·리모트·코어 비수정 원칙·네이밍·nginx 라우팅·인증 브리지
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — subtree pull 절차·절대 규칙·충돌/롤백·1회 셋업
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 4장 코어 무수정 기법 카탈로그, 5장 데이터 소유권
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 커스텀 라우팅 규칙(코어 비수정 신규 파일)
- [samplepcb-web/extend/shop.extend.php](../../samplepcb-web/extend/shop.extend.php) — extend 훅 사례
- [samplepcb-web/README.md](../../samplepcb-web/README.md) — 그누보드 원본(내용 사실상 없음)
