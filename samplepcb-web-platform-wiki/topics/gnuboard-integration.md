---
topic: gnuboard-integration
last_compiled: 2026-07-13
sources_count: 9
status: active
---

# gnuboard-integration

그누보드5/영카트 코어를 **git subtree(pull only)** 로 유지하면서, 커스텀은 코어 밖 계층(`extend/`·`spcb/`·테마·모노레포)에만 두는 통합 전략. 2026-07-04 방침 개정으로 g5 접근은 규율된 **접근 카탈로그**로 재정의됐고, 2026-07-07 **레거시 DB 마이그레이션 완료**(운영 풀 덤프 이관)로 로컬 `samplepcb` DB는 운영 실데이터 이관본이 됐다 — 이 과정에서 코어 최소 수정 예외가 1곳(`lib/common.lib.php`) 추가됐다.

## Purpose [coverage: high — 5 sources]

- `samplepcb-web-platform` 은 **단일 git repo**. 그누보드5/영카트 PHP 코어는 `samplepcb-web/` 에 **git subtree**, 신규 Vue+Node 는 `samplepcb-web-mono-app/` 일반 서브폴더.
- 목표: **코어를 직접 수정하지 않고** 공식 보안 패치(gnuboard5 `master`, 5.6.x 보안 라인)를 subtree pull 로 계속 받는다. 코어 비수정을 지키면 pull 시 거의 무충돌.
- 구 `youngcart5` repo(2021 archived)는 사용 금지 — 영카트 기능도 gnuboard5 master 라인에서 온다.
- 현대화의 기준점은 운영 중인 프로덕션 원본(`www.samplepcb.co.kr`, 그누보드5/영카트 — 구조·메뉴·가격 스냅샷은 [LEGACY_SITE.md](../../docs/LEGACY_SITE.md)). 그 실데이터는 [레거시 DB 마이그레이션](../../docs/LEGACY_DB_MIGRATION.md)으로 신규 플랫폼 DB에 전량 이관 완료(P1~P3 verify 그린).
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
| extend | `samplepcb-web/extend/*.extend.php` | 그누보드 공식 훅 지점(common.php 부트스트랩이 `extend/*.php` 자동 로드) — `shop.extend.php`(배송업체·매출전표 상수), `sp_quote_cart.extend.php`(주문서 견적 행 렌더·부분선택 보정·템플릿 4종 `sp_quote_it_ids()`), `sp_order_status.extend.php`(주문 상태 라벨 SSOT), `version.extend.php`(CSS/JS 캐시버스팅 `G5_CSS_VER`), `default.config.php`(사이트 토글 상수 — `SP_USE_WISHLIST`) |
| spcb | `samplepcb-web/spcb/` | 신규 커스텀 영역 — 인증 브리지 `api/me.php`, 알림 브리지 `api/order-notify.php`, 커스텀 페이지 `pages/*.php` |
| 테마/스킨 | `samplepcb-web/theme/sp-lite/` | 코어 스킨을 테마로 오버라이드 — cart 견적 행 분기·주문내역/주문서 반응형·마이페이지 대시보드·고객 주문상태 배지·위시리스트 진입점 숨김 |
| 모노레포 | `samplepcb-web-mono-app/` | 신규 기능·**이관된 관리 기능**·마이그레이션 스크립트(`apps/api/src/scripts/migrate/`)는 Vue(`/app`)+Node Fastify(`/api`) |
| 라우팅 | `samplepcb-web/.htaccess` | 신규 파일(코어 비수정)로 짧은 URL — `/shop/quotes` → `spcb/pages/quotes.php`. 실존 파일/디렉터리 우선이라 코어 경로와 충돌 없음 |

- 네이밍: 그누보드 강제 규약(`*.extend.php`·`*.skin.php`·snake_case)은 그대로, 우리가 정하는 이름은 `kebab-case`(예: `theme/sp-lite`).
- 현재 `extend/` 파일(11): `shop.extend.php`·`social_login.extend.php`·`sms5.extend.php`·`debugbar.extend.php`·`default.config.php`·`version.extend.php`·`g5_54version_update.extend.php`·`smarteditor_upload_extend.php`·`sp_quote_cart.extend.php`·`sp_order_status.extend.php`·`.htaccess`(1줄 플레이스홀더 — 실질 규칙 없음).

## Talks To [coverage: medium — 3 sources]

- **nginx 통합 호스트** `local-web.samplepcb.co.kr`: `/api`→Node(3333) · `/app`→Vue(5173) · `/market`→Vue(5176) · `/`(catch-all)→PHP Apache(8888). `/app`·`/api`·`/market` 는 그누보드 예약 경로, `/spcb` 는 catch-all 로 PHP.
- **인증 브리지 (그누보드 = IdP)**: PHPSESSID → `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) 발급 → Vue 가 `/api` 에 Bearer → Fastify 검증만. 시크릿은 `spcb/lib/secret.php` ↔ `apps/api/.env` 수동 동기화.
- **알림 브리지 (역방향)**: sp-node 상태 전이 → `POST /spcb/api/order-notify` → 레거시 커스텀 메일 템플릿·`mailer.lib.php` 재사용. 서비스 JWT(같은 시크릿).
- **upstream**: `git fetch gnuboard master` → subtree pull. 새 버전 확인은 sir.kr 자료실 / GitHub master.
- **레거시 운영 DB (읽기 전용, 컷오버 전)**: `migrate:sync` 가 운영 `www.samplepcb.co.kr:3306` 직결(SELECT 외 거부)로 델타를 반복 반영 — 컷오버 T-0 의 `--final` 까지 레거시가 정본.

## API Surface [coverage: medium — 3 sources]

- 그누보드 측이 외부(sp-node/sp-vue)에 제공하는 표면: `GET /spcb/api/me`(JWT 발급) + `POST /spcb/api/order-notify`(sp-node 전용 알림 위임) 두 커스텀 엔드포인트.
- `.htaccess` 리라이트가 만드는 사용자 URL: `/{슬러그}`(spcb/pages 동명 .php 존재 시), `/shop/quotes`, `/shop/quotes/archive` — 견적관리가 위시리스트 역할("저장 → 나중에 주문")을 사양 포함으로 대체.
- extend 훅: `shop.extend.php`(배송업체·매출전표 상수), `sp_quote_cart.extend.php`(orderform 견적 렌더·`sp_print_item_options_selected`·`sp_quote_it_ids()`), `sp_order_status.extend.php`(상태 라벨 공용 헬퍼 — 목록↔상세 SSOT), `default.config.php`(`SP_USE_WISHLIST` 등 토글 상수 — 모든 테마·스킨에서 참조 가능) 등 코어 자동 로드 확장 지점.

## Data [coverage: high — 5 sources]

- **DB 공유**: `sp_*` 테이블(Prisma 소유)은 그누보드 DB(`samplepcb`)에 g5_* 와 **동거**(2026-07-03 통합 — 백업 정합성·조인). 회원 식별은 JWT 클레임으로만 — 스키마 결합 회피.
- **데이터 소유권 / 접근 카탈로그**: `sp_quote`/`sp_order_spec`/`sp_file`/`sp_member_profile`/`sp_review`/`sp_order_biz_info` = sp-node 소유(PHP 접근 금지). g5_* 는 코어 소유이되, sp-node 가 **접근 카탈로그**(`apps/api/src/lib/g5-db.ts`)로 규율 하에 읽고 쓴다 — 민감 컬럼(비밀번호·인증·od_pwd/od_cash) SELECT 배제, Prisma 비편입 불변. 상세는 [sp-node-api](sp-node-api.md) Data.
- **레거시 이관 완료 규모**(운영 풀 덤프 20260702 → 로컬 실 DB 컷오버): 회원 6,245 · 주문 15,924 · cart 라인 20,565(spec/quote 20,443) · 세금계산서 11,085 · 별점후기 61(→`sp_review`) · 게시판 9종 · 포인트 39,889행. 레거시 "제출마다 g5_shop_item 생성" EAV 모델 → 템플릿 상품 4종 앵커 + `sp_order_spec`/`sp_quote`/`sp_file` 로 변환. quoteId 는 결정적 **UUIDv5(`od_id:ct_id`)**.
- **금액 변환**: 레거시 라인은 공급가+VAT 별도항(커스텀 산식) → 신규는 **부가세 포함가**로 그룹별 최대잔여법 배분 변환, 헤더는 `computeOrderMoney` 재산출(금액 항등 0건 불일치 실증).
- cart↔spec 관계는 **저장하지 않고** 조회 시점 조인으로 파생 — 동기화 로직이 없어 불일치 불가능. PCB 제작 8단계 상태는 신규 컬럼 없이 `od_status`/`ct_status` 재사용.
- 위시리스트 `g5_shop_wish` 는 순정 그대로 보존(진입점만 숨김) — PCB "상품 개성"은 `it_id` 가 아니라 `ct_id`/`sp_order_spec` 에 있어 구조적으로 비호환.
- 비밀값은 `samplepcb-web/data/dbconfig.php`(gitignore). 이관 덤프는 리포 밖 `D:\work\workspace_other\samplepcb_dump\`.

## Key Decisions [coverage: high — 6 sources]

1. **2026-07-07 — 코어 최소 수정 예외 추가: `lib/common.lib.php` `get_member()` 이메일 아이디 허용** — 이관 회원 3,224명의 mb_id 가 이메일 형식인데 코어 보안 필터가 영숫자·`_` 외 문자를 거부해 로그인 자체가 불가 → 허용 문자에 `@ . -` 3종만 추가(`[^0-9a-z_@.\-]`). subtree pull 충돌 시 같은 취지로 재적용. 구형 41자 해시는 코어가 첫 로그인에 자동 재해시.
2. **2026-07-06~07 — 레거시 DB 전량 이관(사용자 확정 범위)** — 주문·자산 전부(order+cart+주소록+포인트+쿠폰+1:1), 거버 상품은 **주문 연결분만** 변환(고아 견적 51.6% 스킵), 회원 확장 필드는 `sp_member_profile` 승격, 레거시 자체 sp_*(파트너 B2B·부품 DB)는 미이관. "애매하면 중단" 게이트(`manifest.ts`)로 코드화. 컷오버 전 증분은 `migrate:sync`(레거시 정본 단방향) — 상세 [LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md).
3. **2026-07 — 위시리스트 "삭제 아닌 숨김"(`SP_USE_WISHLIST`, 기본 false)** — 순정 위시는 카탈로그 `it_id` 북마크라 견적 모델과 비호환(위시→장바구니가 사양 바인딩 0 껍데기). 코어 위시 코드·DB는 보존하고 sp-lite 테마 진입점만 토글 뒤로 — 코어 비수정 원칙의 응용. 게이트 표현식은 상수 미정의 시 숨김 폴백. 상세 [wishlist-hidden.md](../../docs/wishlist-hidden.md).
4. **2026-07-04 — g5 접근 방침 개정** — "원칙 금지 + 한정 예외"에서 규율된 **접근 카탈로그**로 재정의. sp-php 업무 기능을 모노레포로 점진 마이그레이션하며, 확장 시 ① g5-db.ts 일원화 ② 함수·컬럼 단위 기록 ③ 코어 병행 동작 정합성 ④ 카탈로그([GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) 5장)+HANDOFF 동시 갱신.
5. **초기 방침 — 코어 비수정 + subtree pull only** — 보안 패치 수신이 최우선. 갱신은 오직 `git subtree pull --prefix=samplepcb-web gnuboard master --squash`. `config.php` 수정 금지(`G5_DOMAIN=''` 유지, https 는 `proxy_fix.php` auto_prepend). 커스텀 계층 규칙: 훅은 `extend/`, 신규 페이지·인증·알림은 `spcb/`, 화면 오버라이드는 테마, 신규·이관 기능은 모노레포, URL 은 코어 밖 `.htaccess`.
6. **초기 방침 — 코어 최소 수정 2곳 = 무수정 원칙의 첫 기록된 예외(기법 #11)** — 주문서(`shop/orderform.sub.php`)의 품목 합산 SUM 에 `ct_select='1'` 추가 + 옵션 나열을 extend `sp_print_item_options_selected()` 로 교체. ct_id 단위 선택과 코어의 "선택 단위=it_id" 불변식 충돌을 피할 수 없어 스톡 불변 확인 후 최소 수정. subtree pull 충돌 시 재적용. (테마 스킨 분기로 코어 UI 버그를 차단하는 기법 — cart [선택사항수정] 곱 오류는 테마 cart.php 버튼 숨김 — 도 같은 계열.)

## Gotchas [coverage: high — 5 sources]

- **subtree pull 절차**: `git fetch gnuboard master && git subtree pull --prefix=samplepcb-web gnuboard master --squash`. **작업 트리가 깨끗해야** 한다. 충돌은 내가 코어를 만진 파일에서만 — 수동 병합 후 commit, 실패 시 `git reset --hard ORIG_HEAD`.
- **코어 수정 예외는 이제 3곳** — `shop/orderform.sub.php` 2곳(기법 #11) + **`lib/common.lib.php` `get_member()` 필터(이메일 아이디 허용, 2026-07-07)**. subtree pull 충돌 시 셋 다 같은 취지로 재적용. 특히 common.lib.php 수정이 배포에서 빠지면 **이메일 아이디 회원 3,224명 전원 로그인 불가**.
- **gnuboard 리모트 push 절대 금지** — `no_push` push URL + pre-push 훅 3중 차단. 새 클론에서 리모트·no_push·hooksPath 1회 셋업.
- **`prisma migrate reset`/`migrate dev` 절대 금지** — sp_* 가 그누보드 DB 동거라 reset 은 **g5_* 전체 드랍**. 추가 전용 migration.sql + `migrate deploy` 만.
- **마이그레이션이 g5 코어 스키마를 확폭했다** — 타깃의 `mb_id` varchar 를 23개 테이블에서 255로, `od_name` 1000·`po_rel_id` 255 등(레거시 이메일 아이디·실데이터 절단 방어). subtree 코어의 SQL 정의와 실 DB 가 다르다는 점을 전제로 작업할 것.
- **비회원 주문 95건은 조회 단절** — 신규 코어의 od_pwd 조회에 구형 해시 폴백이 없음 → 관리자 대리조회로 안내.
- `extend/sp_order_status.extend.php:22` `'A\S'` 오타 — A/S 가 고객 목록에서 '주문취소'로 표기되는 기존 버그, 이관 데이터로 대량 노출(수정 권장 후속).
- **CSS/JS 고친 뒤 `version.extend.php` 의 `G5_CSS_VER` 미상향 시 캐시**로 "적용 안 됨" — sp-php 는 `?ver=G5_CSS_VER` 고정 링크. 단 스킨 PHP 만 고친 경우(위시 숨김 등)는 서버 렌더라 갱신 불필요.
- `.htaccess` 리라이트 전제: vhost `AllowOverride All` + `mod_rewrite`. 슬러그 규칙은 소문자·숫자·하이픈 1단계, `spcb/pages/{슬러그}.php` 실존 시에만. `extend/.htaccess` 는 1줄 플레이스홀더(규칙 없음).
- 레거시 `estimate_*` 페이지는 코어가 아닌 레거시 커스텀 — subtree 에 없다(찾으려 하지 말 것). 레거시 사이트 구조는 [LEGACY_SITE.md](../../docs/LEGACY_SITE.md) 스냅샷 참조.
- 남은 개방 항목: **거버 실파일** — 운영 `/gerber_files/` 미러 rsync → `migrate:files --sideload --relink`(사이드로드가 정석 — API 업로드는 날짜 폴더 구조가 깨짐).

## Sources [coverage: high — 9 sources]

- [AGENTS.md](../../AGENTS.md) — 구조·리모트·코어 비수정·네이밍·nginx 통합·인증 브리지·접근 카탈로그 방침
- [CLAUDE.md](../../CLAUDE.md) — 요약 지침(단일 repo·subtree·코어 비수정)
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — subtree pull 절차·절대 규칙·충돌/롤백·1회 셋업
- [docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md) — 프로덕션 원본 사이트(www.samplepcb.co.kr) 구조·URL·가격 스냅샷
- [docs/LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md) — 레거시 DB 전량 이관(P1~P3)·증분 sync·컷오버 런북·코어 수정 예외(common.lib.php)
- [docs/wishlist-hidden.md](../../docs/wishlist-hidden.md) — SP_USE_WISHLIST 숨김 토글 결정 기록
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 커스텀 라우팅(코어 비수정 신규 파일)
- [samplepcb-web/extend/.htaccess](../../samplepcb-web/extend/.htaccess) — 1줄 플레이스홀더
- [samplepcb-web/README.md](../../samplepcb-web/README.md) — 그누보드 원본(내용 사실상 없음)
