---
topic: gnuboard-integration
last_compiled: 2026-07-06
sources_count: 8
status: active
---

# gnuboard-integration

그누보드5/영카트 코어를 **git subtree(pull only)** 로 유지하면서, 커스텀은 코어 밖 계층(`extend/`·`spcb/`·테마·모노레포)에만 두는 통합 전략. 2026-07-04 방침 개정으로 g5 접근이 "원칙 금지 + 한정 예외"에서 규율된 **접근 카탈로그**로 재정의됐다(sp-php 업무 기능의 모노레포 점진 마이그레이션).

## Purpose [coverage: high — 5 sources]

- `samplepcb-web-platform` 은 **단일 git repo**. 그누보드5/영카트 PHP 코어는 `samplepcb-web/` 에 **git subtree**, 신규 Vue+Node 는 `samplepcb-web-mono-app/` 일반 서브폴더.
- 목표: **코어를 직접 수정하지 않고** 공식 보안 패치(gnuboard5 `master`)를 subtree pull 로 계속 받는다. 코어 비수정을 지키면 pull 시 거의 무충돌.
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
| extend | `samplepcb-web/extend/*.extend.php` | 그누보드 공식 훅 지점 — `shop.extend.php`(배송업체·매출전표 상수), `sp_quote_cart.extend.php`(주문서 견적 행 렌더·부분선택 보정), `sp_order_status.extend.php`(주문 상태 라벨 SSOT), `version.extend.php`(CSS/JS 캐시버스팅 `G5_CSS_VER`) |
| spcb | `samplepcb-web/spcb/` | 신규 커스텀 영역 — 인증 브리지 `api/me.php`, 알림 브리지 `api/order-notify.php`, 커스텀 페이지 `pages/*.php` |
| 테마/스킨 | `samplepcb-web/theme/sp-lite/` | 코어 스킨을 테마로 오버라이드 — cart 견적 행 분기·주문내역/주문서 반응형·마이페이지 대시보드·고객 주문상태 배지 |
| 모노레포 | `samplepcb-web-mono-app/` | 신규 기능·**이관된 관리 기능**은 Vue(`/app`)+Node Fastify(`/api`) |
| 라우팅 | `samplepcb-web/.htaccess` | 신규 파일(코어 비수정)로 짧은 URL — `/shop/quotes` → `spcb/pages/quotes.php`. 실존 파일/디렉터리 우선이라 코어 경로와 충돌 없음 |

- 네이밍: 그누보드 강제 규약(`*.extend.php`·`*.skin.php`·snake_case)은 그대로, 우리가 정하는 이름은 `kebab-case`(예: `theme/sp-lite`).
- 현재 `extend/` 파일: `shop.extend.php`·`social_login.extend.php`·`sms5.extend.php`·`debugbar.extend.php`·`default.config.php`·`version.extend.php`·`g5_54version_update.extend.php`·`smarteditor_upload_extend.php`·`sp_quote_cart.extend.php`·`sp_order_status.extend.php`.

## Talks To [coverage: medium — 4 sources]

- **nginx 통합 호스트** `local-web.samplepcb.co.kr`: `/api`→Node(3333) · `/app`→Vue(5173) · `/`(catch-all)→PHP Apache(8888). `/app`·`/api` 는 예약 경로, `/spcb` 는 catch-all 로 PHP.
- **인증 브리지 (그누보드 = IdP)**: PHPSESSID → `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) 발급 → Vue 가 `/api` 에 Bearer → Fastify 검증만.
- **알림 브리지 (역방향, 신규)**: sp-node 상태 전이 → `POST /spcb/api/order-notify` → 레거시 커스텀 메일 템플릿(`ordermail.inc.php`)·`mailer.lib.php` 재사용. 서비스 JWT(같은 시크릿).
- **upstream**: `git fetch gnuboard master` → subtree pull. 새 버전 확인은 sir.kr 자료실 / GitHub master.

## API Surface [coverage: medium — 3 sources]

- 그누보드 측이 외부(sp-node/sp-vue)에 제공하는 표면: `GET /spcb/api/me`(JWT 발급) + `POST /spcb/api/order-notify`(sp-node 전용 알림 위임) 두 커스텀 엔드포인트.
- `.htaccess` 리라이트가 만드는 사용자 URL: `/{슬러그}`(spcb/pages 동명 .php 존재 시), `/shop/quotes`, `/shop/quotes/archive`.
- extend 훅: `shop.extend.php`(배송업체·매출전표 상수), `sp_quote_cart.extend.php`(orderform 견적 렌더·`sp_print_item_options_selected`), `sp_order_status.extend.php`(상태 라벨 공용 헬퍼 — 목록↔상세 SSOT) 등 코어 자동 로드 확장 지점.

## Data [coverage: high — 5 sources]

- **DB 공유**: `sp_*` 테이블(Prisma 소유)은 그누보드 DB(`samplepcb`)에 g5_* 와 **동거**(2026-07-03 통합 — 백업 정합성·조인). 회원 식별은 JWT 클레임으로만 — 스키마 결합 회피.
- **데이터 소유권 / 접근 카탈로그**: `sp_quote`/`sp_order_spec`/`sp_file`/`sp_member_profile` = sp-node 소유(PHP 접근 금지). g5_* 는 영카트/그누보드 코어 소유이되, sp-node 가 **접근 카탈로그 ⑤–⑱**(`apps/api/src/lib/g5-db.ts`)로 규율 하에 읽고 쓴다 — 민감 컬럼(비밀번호·인증·od_pwd/od_cash) SELECT 자체 배제, Prisma 비편입 불변. 상세 목록은 [sp-node-api](sp-node-api.md) Data.
- cart↔spec 관계는 **저장하지 않고** 조회 시점 조인으로 파생 — 동기화 로직이 없어 불일치 불가능.
- **PCB 제작 8단계 상태는 신규 컬럼 없이 `od_status`/`ct_status` 재사용** — 공유 DB reset 제약 때문에 Prisma 마이그레이션을 피했다.
- 비밀값은 `samplepcb-web/data/dbconfig.php`(gitignore).

## Key Decisions [coverage: high — 6 sources]

1. **코어 비수정 + subtree pull only** — 보안 패치 수신이 최우선. 갱신은 오직 `git subtree pull --prefix=samplepcb-web gnuboard master --squash`.
2. **`config.php` 수정 금지** — `G5_DOMAIN=''` 유지. https 는 `proxy_fix.php`(php.ini `auto_prepend_file`). `G5_SMTP=127.0.0.1:25` 도 코어값(SMTP 발송 모드 — 로컬은 Mailpit 필요).
3. **커스텀 계층 규칙** — 훅은 `extend/`, 신규 페이지·인증·알림은 `spcb/`, 화면 오버라이드는 테마, 신규·이관 기능은 모노레포. URL 은 코어 밖 `.htaccess`.
4. **g5 접근 방침 개정 (2026-07-04)** — "원칙 금지 + 한정 예외 4종"에서 규율된 **접근 카탈로그**로 재정의. sp-php 업무 기능을 최적화·커스텀 목적으로 모노레포 점진 마이그레이션하며, 필요하면 카탈로그를 확장하되 ① g5-db.ts 일원화 ② 함수·컬럼 단위 기록 ③ 코어 병행 동작 정합성 ④ 카탈로그(GERBER 5장)+HANDOFF 동시 갱신. 현재 ⑤–⑱까지 누적(견적·회원·주문·설정 관리).
5. **테마 스킨 분기로 코어 UI 버그 차단** — cart [선택사항수정] 선형 곱 오류는 코어 수정 대신 `theme/sp-lite/shop/cart.php` 견적 행 버튼 숨김(기법 #8).
6. **코어 최소 수정 2곳 = 무수정 원칙의 기록된 예외 (기법 #11)** — 주문서(`shop/orderform.sub.php`)의 품목 합산 SUM 에 `ct_select='1'` 추가 + 옵션 나열을 extend `sp_print_item_options_selected()` 로 교체. ct_id 단위 선택과 코어의 "선택 단위=it_id" 불변식 충돌을 피할 수 없어, 스톡 불변(전량 선택 시 no-op)을 확인하고 최소 수정. subtree pull 충돌 시 같은 취지로 재적용.

## Gotchas [coverage: high — 5 sources]

- **subtree pull 절차**: `git fetch gnuboard master && git subtree pull --prefix=samplepcb-web gnuboard master --squash`. **작업 트리가 깨끗해야** 한다. 충돌은 내가 코어를 만진 파일에서만(기법 #11 2곳) — 수동 병합 후 commit, 실패 시 `git reset --hard ORIG_HEAD`.
- **gnuboard 리모트 push 절대 금지** — `no_push` push URL + pre-push 훅 3중 차단. 새 클론에서 리모트·no_push·hooksPath 1회 셋업.
- **`prisma migrate reset` 절대 금지** — sp_* 가 그누보드 DB 동거라 reset 은 **g5_* 전체 드랍**. `migrate dev` 도 금지(drift 로 전체 reset 요구) — 추가 전용 migration.sql + `migrate deploy`.
- **CSS/JS 고친 뒤 `version.extend.php` 의 `G5_CSS_VER` 미상향 시 캐시**로 "적용 안 됨" — sp-php 는 `?ver=G5_CSS_VER` 고정 링크.
- `.htaccess` 리라이트 전제: vhost `AllowOverride All` + `mod_rewrite`. 슬러그 규칙은 소문자·숫자·하이픈 1단계, `spcb/pages/{슬러그}.php` 실존 시에만.
- 레거시 `estimate_*` 페이지는 코어가 아닌 레거시 커스텀 — subtree 에 없다(찾으려 하지 말 것).
- **제작 8단계 배지는 테마 오버라이드로 코어 무수정** — 고객 주문조회(`orderinquiry.sub.php`) 배지 switch 에 제작단계 case 추가(default '주문취소' 오작동 방어), `status_03` 재사용·CSS 무변경.

## Sources [coverage: high — 8 sources]

- [CLAUDE.md](../../CLAUDE.md) — 요약 지침(단일 repo·subtree·코어 비수정)
- [AGENTS.md](../../AGENTS.md) — 구조·리모트·코어 비수정·네이밍·nginx·인증 브리지·접근 카탈로그 방침
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — subtree pull 절차·절대 규칙·충돌/롤백·1회 셋업
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 4장 코어 무수정 기법 카탈로그(#11 코어 최소 수정 포함), 5장 접근 카탈로그
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) — 커스텀 라우팅(코어 비수정 신규 파일)
- [samplepcb-web/extend/shop.extend.php](../../samplepcb-web/extend/shop.extend.php) — extend 훅 사례
- [samplepcb-web/spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — Authorization 패스스루·무확장 라우팅
- [samplepcb-web/README.md](../../samplepcb-web/README.md) — 그누보드 원본(내용 사실상 없음)
