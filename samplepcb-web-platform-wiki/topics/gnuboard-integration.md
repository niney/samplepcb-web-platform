---
topic: gnuboard-integration
last_compiled: 2026-09-19
sources_count: 33
status: active
---

# gnuboard-integration

그누보드5/영카트 코어를 **git subtree(pull only)** 로 유지하면서, 커스텀은 코어 밖 계층(`extend/`·`spcb/`·테마·모노레포)에만 두는 통합 전략. 2026-07-04 방침 개정으로 g5 접근은 규율된 **접근 카탈로그**가 됐고, 2026-07-07 **레거시 DB 마이그레이션 완료**로 로컬 `samplepcb` DB 는 운영 실데이터 이관본이 됐다. 2026-07-13 컴파일 이후의 변화는 세 갈래 — ① `extend/` 가 **PHP→sp-node 브리지 훅 계층**(파트너·EQ·클레임·주문 진행)으로 자랐고 ② 코어 최소 수정이 7파일로 늘어 **subtree pull 가드**([check-core-patches.sh](../../ops/scripts/check-core-patches.sh), 2026-08-05)가 생겼으며 ③ 공유 DB 운영 절차(스냅샷·원복 2026-09-11, 로컬 복구 2026-09-09, 운영 재이관·`migrate:reset-data` 2026-09-16)가 문서화됐다.

## Purpose [coverage: high — 8 sources]

소스 날짜 범위: 2026-06-30(초기 커밋·`extend/.htaccess`) ~ 2026-09-18(`version.extend.php`). 문서 정본은 2026-07-02([LEGACY_SITE](../../docs/LEGACY_SITE.md)) ~ 2026-09-16([LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md)·[legacy-production-reimport](../../docs/legacy-production-reimport.md)).

- `samplepcb-web-platform` 은 **단일 git repo**. 그누보드5/영카트 PHP 코어는 `samplepcb-web/` 에 **git subtree**, 신규 Vue+Node 는 `samplepcb-web-mono-app/` 일반 서브폴더([AGENTS.md](../../AGENTS.md)·[CLAUDE.md](../../CLAUDE.md)).
- 목표: **코어를 직접 수정하지 않고** 공식 보안 패치(gnuboard5 `master`, 5.6.x 라인)를 subtree pull 로 계속 받는다. 구 `youngcart5`(2021 archived)는 사용 금지 — 영카트 기능도 gnuboard5 master 에서 온다([UPSTREAM_SYNC](../../docs/UPSTREAM_SYNC.md)).
- 현대화의 기준점은 운영 원본 `www.samplepcb.co.kr`(구조·가격 스냅샷 [LEGACY_SITE](../../docs/LEGACY_SITE.md), 레거시 소스 로컬 `D:\work\workspace_other\samplepcb_php`). 실데이터는 [레거시 DB 마이그레이션](../../docs/LEGACY_DB_MIGRATION.md)으로 전량 이관 완료(P1~P3 verify 그린), 이후 `migrate:sync` 로 운영 델타를 계속 받는다.
- **코어 비수정의 실제 성적표(2026-09-19 스캔)**: sp 심(seam) 마커가 있는 코어 파일 **7개** — `lib/common.lib.php`·`shop/orderform.php`·`shop/orderform.sub.php`·`mobile/shop/orderform.sub.php`·`shop/orderformupdate.php`·`mobile/shop/orderformupdate.php`·`shop/ordermail1.inc.php`. 전부 주문서·주문 메일·회원 조회의 한 줄~수십 줄 심이고 그 밖의 코어는 순정. 위 목록 밖에서 2026-07-13 이후 바뀐 코어 파일은 없다.
- ⚠ 커밋 이력상 **subtree pull 은 초기 커밋(2026-06-30 `d4323b882`) 이후 한 번도 실행되지 않았다**(`git log -- samplepcb-web` 에 subtree/gnuboard 커밋 0건). 가드 스크립트도 실제 pull 로는 검증된 적이 없다.
- `samplepcb-web/README.md` 는 0줄(원본 설명은 upstream 참조).

## Architecture [coverage: high — 12 sources]

**리모트 구성**

```
origin   = github.com/niney/samplepcb-web-platform   (push 대상)
gnuboard = github.com/gnuboard/gnuboard5             (subtree 소스, push URL=no_push + .githooks/pre-push 차단)
```

**커스텀 계층 규칙** — 코어(`bbs/`·`shop/`·`lib/`·`adm/`·루트 `*.php`·`config.php`)는 subtree 충돌 지점이라 손대지 않고, 커스텀은 아래 계층에만:

| 계층 | 위치 | 2026-09 현재 내용 |
|---|---|---|
| extend | `samplepcb-web/extend/*.php` (common.php 부트스트랩이 전부 자동 로드 → 모든 테마·스킨·코어 페이지보다 먼저 실행) | **15파일** = 순정 계열 8(`shop`·`social_login`·`sms5`·`debugbar`·`g5_54version_update`·`smarteditor_upload`·`default.config`·`version`) + **sp 훅 6**(아래 표) + `.htaccess`(1줄 플레이스홀더) |
| spcb | `samplepcb-web/spcb/` (자체 `.htaccess` 로 무확장 URL·Authorization 헤더 패스스루) | api **6**(`me`·`order-notify`·`eq-decide`·`eq-file`·`coord-file`·`claim-create`) · pages **9**(`about`·`history`·`location`·`spec`·`reviews`·`quotes`·`quotes-archive`·`eq`·`as`) · lib(`jwt.php`·`secret.php` gitignore) — 상세 [spcb-bridge](spcb-bridge.md) |
| 테마/스킨 | `samplepcb-web/theme/sp-lite/` | 코어 스킨 오버라이드 — cart 견적 행 분기·주문서/주문내역·마이페이지(제조 확인·A/S 접수)·위시 진입점 숨김 — [theme-sp-lite](theme-sp-lite.md) |
| 모노레포 | `samplepcb-web-mono-app/` | 신규·이관 기능 + 마이그레이션·초기화·스냅샷 스크립트(`apps/api/src/scripts/migrate/`, `db:snapshot`) — [sp-node-api](sp-node-api.md) |
| 라우팅 | [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) | 코어 비수정 신규 파일. 실존 파일 우선 → 1단계 슬러그 → `/shop/quotes`·`/shop/quotes/archive` + **2026-08-25 추가** `/shop/eq`·`/shop/as` |

**sp 훅 6종**(헤더 주석 기준, 날짜 = 생성~최종 커밋):

| 파일 | 역할 |
|---|---|
| [sp_quote_cart.extend.php](../../samplepcb-web/extend/sp_quote_cart.extend.php) (07-04~09-05) | 견적 카트 보정 — 앵커 it_id **4계열**(`sp_quote_it_ids()` PCB 4종 · `sp-market-svc` · `sp-develop-svc` · `sp-bom-parts`)과 union `sp_custom_row_it_ids_in()`(주문서·주문메일의 "일반=it_id 집계 / 커스텀=ct_id 건별" 이원 렌더의 단일 IN 문자열) · `sp_print_item_options_selected`(선택행만) · `sp_cart_deselect_from_cookie`(혼합 카트 1회용 쿠키) · `sp_order_cart_count_sql`(od_cart_count seam) · `sp_quote_thumb_url`(sp-node `signedThumbUrl` PHP 미러) · 헤더 배지 `sp_cart_badge_count`/`sp_quote_badge_count` |
| [sp_order_status.extend.php](../../samplepcb-web/extend/sp_order_status.extend.php) (07-05, **08-25 전면 교정**) | 고객 상태 라벨·배지 SSOT + `sp_order_track()`(cart it_id 로 pcb/bom/generic 판정, 혼합 주문 없음) + `sp_order_customer_steps()`(od 축 + 협력·조달 파생 stage 를 한 스텝퍼로 — 결제 뒤·배송 전 구간만 진행이 배지를 덮음) + 칸 설명 사전. stage 순서표는 sp-node `pcb-customer-progress`/`bom-customer-progress` 계약 배열의 **사본** |
| [sp_partner.extend.php](../../samplepcb-web/extend/sp_partner.extend.php) (08-02) | `sp_is_approved_partner()` — 파트너 포탈 메뉴 노출 판정. sp-node `requirePartner` 와 같은 기준(`sp_partner_member` ∧ 조직 `approved`), 테이블 부재 초기 설치는 비파트너로 |
| [sp_pcb_eq.extend.php](../../samplepcb-web/extend/sp_pcb_eq.extend.php) (08-07~08-25) | EQ 고객 확인 브리지 — `sp_pcb_member_token()`(회원 JWT, **exp 2분**) + `sp_pcb_node_call()`(`SPCB_NODE_BASE`=127.0.0.1:3333 직결, 5s, 실패 null) + `sp_pcb_progress[_batch]`·EQ/좌표 파일 URL·`sp_pcb_check_token`(alert 없는 CSRF 검증) |
| [sp_pcb_claim.extend.php](../../samplepcb-web/extend/sp_pcb_claim.extend.php) (08-15) | PCB A/S 접수 브리지 — EQ 와 같은 구조, 라벨 사전은 계약 `PCB_CLAIM_*_LABELS` 동기. 파일 동반 접수는 `spcb/api/claim-create` 가 multipart 중계 |
| [sp_bom_claim.extend.php](../../samplepcb-web/extend/sp_bom_claim.extend.php) (08-25) | BOM 문제 접수 목록 — PCB 와 모양이 같지만 **함수를 나눈다**(트랙 간 어휘 격리 관례). 접수 폼은 Vue `/app/bom/:id` 한 곳 |

**브리지 훅 공통 규약**: 판정·저장은 전부 sp-node, PHP 는 **화면만 그린다**(sp_ 테이블에 쓰지 않음 — 권한·상태·회차 판정을 두 곳에 복제하면 반드시 어긋난다). 배지 카운트만 DB 직접 count(비치명 `sql_fetch(..., false)`). `secret.php` 미배치·sp-node 다운·테이블 부재에서도 주문내역·헤더가 죽지 않게 `''`·`null`·빈 배열 폴백. 메일 링크는 결정을 부르지 않는다(보안 스캐너 GET 프리페치 방어).

**코어 최소 수정 가드** [check-core-patches.sh](../../ops/scripts/check-core-patches.sh) — `assert_contains` **5건**: ① `lib/common.lib.php` get_member 필터 `0-9a-z_@` ② `shop/orderform.php` `$is_mobile_order = G5_IS_MOBILE;` ③ `shop/orderform.sub.php` `sp_custom_row_it_ids_in` ④⑤ `shop/orderformupdate.php`·`mobile/shop/orderformupdate.php` `sp_order_cart_count_sql`. 2026-08-05 신설(①, 커밋 5eb5d3f67) → 2026-08-17 +4(ea2916b98, 배송방법 독립 검토가 미등록 노출을 발견).

## Talks To [coverage: high — 6 sources]

- **nginx 통합 호스트** `local-web.samplepcb.co.kr`: `/api`→Node(3333) · `/app`→Vue(5173) · `/market`→5176 · `/develop`→5177 · `/`(catch-all)→PHP Apache(8888). `/spcb` 는 별도 location 없이 catch-all 로 PHP — [infrastructure](infrastructure.md).
- **인증 브리지(그누보드 = IdP)**: PHPSESSID → `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) → Vue 가 `/api` 에 Bearer → Fastify 검증만. 시크릿 `spcb/lib/secret.php` ↔ `apps/api/.env` **수동 동기화**.
- **훅 → sp-node 직결(2026-08 신설)**: extend 훅이 nginx 를 거치지 않고 `http://127.0.0.1:3333` 을 curl 로 직접 부른다. 같은 `SPCB_JWT_SECRET` 으로 PHP 가 2분짜리 회원 JWT 를 발급(클레임 shape 은 `me.php` 와 동일). 응답 실패는 화면 섹션 숨김.
- **알림 브리지(역방향)**: sp-node 상태 전이 → `POST /spcb/api/order-notify` → 커스텀 메일 템플릿·SMS 미러 재사용. 서비스 JWT(같은 시크릿). 발송 결과는 sp-node `sp_mail_log`.
- **upstream**: `git fetch gnuboard master` → subtree pull → **가드 실행**. 새 버전 확인은 sir.kr 자료실 / GitHub master.
- **레거시 운영 DB(읽기 전용)**: `migrate:sync` 가 `www.samplepcb.co.kr:3306/hyoh9150` 직결(`legacy-db.ts` 가 SELECT 외 거부)로 델타를 반복 반영. 컷오버 T-0 의 `--final` 까지 레거시가 정본.
- **운영 서버(2026-09-16 절차 기준)**: Ubuntu `/home/samplepcb/samplepcb-web-platform`, MariaDB `samplepcb`, systemd `sp-api`, nginx `sites-enabled/centrafab-main`(공개 도메인 `centrafab.co.kr`), 공용 `php8.1-fpm`. 재이관은 503 유지보수 → `sp-api` stop → 작업 → 재개.
- **백업 위치**: git 밖 형제 디렉터리 `samplepcb-db-backups`(개발 `D:/work/workspace_other/`, 운영 `/home/samplepcb/`). 로컬 DB 는 XAMPP MariaDB 10.4.32 `C:/xampp/mysql/data`(3306).

## API Surface [coverage: high — 9 sources]

- **spcb 커스텀 엔드포인트 6**: `GET /spcb/api/me`(JWT) · `POST /spcb/api/order-notify`(sp-node 전용) · `eq-decide`·`eq-file`·`coord-file`(EQ 결정·첨부·좌표파일 중계) · `claim-create`(A/S 접수 multipart). `spcb/.htaccess` 가 무확장 URL 리라이트 + `HTTP_AUTHORIZATION` 환경변수 반영.
- **`.htaccess` 가 만드는 사용자 URL**: `/{슬러그}`(`spcb/pages/{슬러그}.php` 실존 시 — about·history·location·spec·reviews…) · `/shop/quotes` · `/shop/quotes/archive` · `/shop/eq`(제조 확인) · `/shop/as`(A/S 접수).
- **extend 가 테마에 제공하는 PHP 함수 표면**: 앵커 it_id 목록·`sp_custom_row_it_ids_in()`·주문서 옵션/수량 렌더·배지 카운트(`sp_quote_cart`) / 상태 라벨·트랙·스텝퍼(`sp_order_status`) / `sp_is_approved_partner()` / `sp_pcb_node_call()`·EQ·클레임 조회와 라벨 사전(`sp_pcb_eq`·`sp_pcb_claim`·`sp_bom_claim`) / 토글 상수 `SP_USE_WISHLIST`(`default.config`) / `G5_CSS_VER`·`G5_JS_VER`(`version`) / 배송업체 상수 `G5_DELIVERY_COMPANY`(`shop`).
- **운영 CLI 표면**(공유 DB 를 건드리는 명령 — 전부 sp-node 스크립트):

| 명령 | 역할 |
|---|---|
| `git subtree pull --prefix=samplepcb-web gnuboard master --squash` → `ops/scripts/check-core-patches.sh` | 코어 갱신 + 최소 수정 생존 검사(exit 1 = 유실) |
| `pnpm migrate:gate / :dry / :run / :verify [--light]` | 덤프 전량 이관 4단(게이트는 미분류 테이블·드리프트 시 중단) |
| `pnpm migrate:sync [-- --dry-run \| --final]` | 운영 직결 diff 증분(삭제는 리포트만, 수동·단방향) |
| `pnpm migrate:reset-data [-- --yes --confirm-database samplepcb]` | **설정·스키마 보존 업무 데이터 초기화**(기본은 미리보기, 삭제 전 전체 백업+SHA-256) |
| `pnpm --filter api db:snapshot backup \| inspect <dir> \| restore <dir> --confirm-database samplepcb` | 전체 DB 스냅샷·검증·원복(복원 직전 현재 DB 도 백업) |
| `pnpm migrate:files -- --sideload --relink` | (소급용) 거버 실파일 보충 — 파일은 2026-08-05 전면 미이관 결정 |

## Data [coverage: high — 8 sources]

- **DB 공유**: `sp_*`(Prisma 소유)는 그누보드 DB `samplepcb` 에 g5_* 와 **동거**(2026-07-03). 회원 식별은 JWT 클레임으로만. g5_* 는 sp-node 가 **접근 카탈로그**(`apps/api/src/lib/g5-db.ts`, [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) 5장 ⑤~⑲)로 규율 하에 읽고 쓴다 — 민감 컬럼 SELECT 배제·Prisma 비편입 불변. 2026-09-10 ⑤ 확장: `GET /api/me/contact` 가 JWT 본인 5컬럼만.
- **코어 무수정 기법 카탈로그 11건**([GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) 4장): 템플릿 상품 앵커(현재 5종, `sp-bom-parts` 포함) · cart 스냅샷 역이용 · 견적가를 `io_price` 옵션 행에 · `cartId` JWT 클레임 · 템플릿 노출 금지 · 가격 패리티 이식 · `spec_json` · 테마 cart 건별 카드 · ct_id 단위 `ct_select` · lazy reconcile · **#11 코어 최소 수정**. 개념 정리는 [core-nonmodification](../concepts/core-nonmodification.md).
- **이관 규모**: 2026-07-07 컷오버 시 회원 6,245 · 주문 15,924 · cart 20,565. 2026-08-04 **미주문 견적 69건 추가 이관**(phase 06 — `sp_order_spec.ctId=NULL`, `quoteId=uuidV5('cart:'+ct_id)` 앵커로 주문 승격 시 id 승계). 2026-09-09 실측 회원 6,387 · 주문 16,349 · 테이블 296(sp+g5). quoteId 는 결정적 UUIDv5.
- **금액 변환**: 레거시 공급가+VAT 별도 → 신규 부가세 포함가(`allocateVatIncl` 최대잔여법), 헤더는 `computeOrderMoney` 재산출 — 항등 불일치 0 이 불변식(sync 리포트에 나오면 즉시 조사).
- **배송방법 축(2026-08-17)**: 코어에 없는 개념을 `g5_shop_order.od_delivery_method varchar(20)` **신설 컬럼 + `od_delivery_company` 한글 라벨 병용**으로 — `''`=택배 간주, `quick_cod`/`pickup`/`direct`(+예약 `quick_prepaid`). 병용 덕에 /adm 주문상세·배송 메일 `{택배회사}`·고객 조회가 0줄 수정. 어휘 정본은 `api-contract` `orders.ts`([DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md)).
- **운영 재이관 보존 범위(2026-09-16, 정본 `reset-data-policy.ts`)**: 삭제 = 회원(admin 포함)·주문·카트·견적·게시글·포인트·PCB/BOM/마켓/개발/협력사 업무 행. 보존 = 테이블 구조·`_prisma_migrations`·사이트/쇼핑몰/결제/앱 설정·게시판 설정·메뉴·배너·SEO·메일 템플릿·AI 유스케이스. 부분 보존 = `g5_shop_item` 고정 결제 상품 **7개**(PCB 4·BOM·마켓·개발). DB 밖(PHP `data/`, 파일서버, 공유 ES)은 무변경.
- **스냅샷 형식**: `database.sql.gz` + `manifest.json`(DB·서버·시각·HEAD·크기·SHA-256·테이블 목록, 비밀번호 없음) + 오류 로그. 뷰·루틴·이벤트·트리거·`_prisma_migrations` 포함, 64KB INSERT 묶음.
- **코어 스키마 확폭**: 이관이 `mb_id` varchar 를 23개 테이블에서 255 로, `od_name` 1000·`po_rel_id` 255·`bizZip` 100 등 — subtree 코어의 SQL 정의와 실 DB 가 다르다.
- 위시리스트 `g5_shop_wish` 는 순정 보존(진입점만 숨김). 비밀값은 `samplepcb-web/data/dbconfig.php`·`spcb/lib/secret.php`(gitignore). 덤프는 리포 밖 `D:\work\workspace_other\samplepcb_dump\`.

## Key Decisions [coverage: high — 11 sources]

1. **2026-09-16 — `admin` 도 레거시 정본으로 이관 + 설정 보존 전체 업무 데이터 초기화(`migrate:reset-data`)** — 최초 이관이 설치 admin 을 건너뛰고 sync 도 admin 을 보호 계정으로 고정해 레거시 관리자 비밀번호가 반영되지 않던 문제 교정(a4fd659d3). `kpeter`·`MIGRATE_PROTECTED_MB_IDS` 보호는 유지. 기존 `migrate:wipe` 는 PCB 거래 일부만 지워 대체 명령이 아니라 판정 → 미리보기 기본·`--yes --confirm-database` 필수·삭제 전 전체 백업+SHA-256·미분류 테이블은 중단(82500bae6). DB DROP·`prisma migrate reset` 은 여전히 금지. 절차 [legacy-production-reimport](../../docs/legacy-production-reimport.md).
2. **2026-09-09~11 — DB 스냅샷·원복 도구 표준화 + 로컬 MySQL 복구** — 개발 `pnpm dev`·운영 `deploy.sh` 모두 미적용 migration 앞에 스냅샷 자동, 동시 실행은 MySQL advisory lock. 복원은 `--confirm-database` 일치·SHA-256 검증·복원 직전 백업 뒤 DB 재생성. 09-09 로컬 XAMPP 장애(1044 접근 거부)의 원인은 권한 삭제가 아니라 **`mysql.db`·`mysql.procs_priv` Aria 손상**(+InnoDB LSN 불일치) → `aria_chk --recover` 로 두 테이블만 복구, 강제 복구 모드 없이 전체 덤프 2.1GB 를 새 데이터 디렉터리에 재적재(296 테이블 정상, 1,613,377행 체크섬 일치), 옛 디렉터리는 `data-before-recovery-20260909-190235` 보관. 비밀번호·설정 무변경 — [db-snapshot-rollback](../../docs/db-snapshot-rollback.md)·[local-mysql-recovery-2026-09-09](../../docs/local-mysql-recovery-2026-09-09.md).
3. **2026-08-17 — 배송방법 = 신설 컬럼 + 한글 라벨 병용(B안)** — DB ENUM 기각(varchar 코드값), `od_delivery_company` 폐기 대신 병용해 코어 화면·메일 0줄 호환. 근거: 코어 스스로 `g5_shop_order` 런타임 ALTER 전례(`od_other_pay_type`). 비택배는 `od_invoice=''` 강제·`od_invoice_time` 필수. 배송 엑셀은 택배 전용 WHERE 1줄(열 추가 금지). 같은 작업의 독립 검토가 **미등록 코어 수정 4건**을 발견해 가드에 등록. P2(주문서 수집·방법별 배송비 0)·P3(수령완료 라벨)는 로드맵.
4. **2026-08-07~25 — PHP→sp-node 브리지 훅 계층 확립** — EQ 확인(08-07 D16)·A/S 접수(08-15 P5)·마이페이지 제조 확인·A/S 화면(08-25)·BOM 문제 접수(08-25 D37). 원칙 "판정·저장은 sp-node, PHP 는 화면만" + 트랙 간 어휘 격리(PCB/BOM 클레임 함수 분리) + 메일 링크 무결정. 주문 상태 사전은 08-25 실측 교정(status-matrix e2e)으로 협력 트랙 진행이 결제 뒤·배송 전 배지를 덮고, 제작 8단계가 고객 어휘·단계색으로, 반품·품절·일부 취소가 제 이름으로 — 사전은 sp-node 하나이고 PHP 는 사본.
5. **2026-08-05 — 코어 최소 수정 가드 스크립트 도입** — subtree pull 은 그누보드가 그 줄 근처를 안 건드리면 충돌 없이 **조용히 원본으로 덮어쓴다**. `get_member()` 거부가 함수 선두 가드라 extend 훅으로 추출 불가 → 코어 수정 시 `// [samplepcb]` 주석 + 가드 한 줄 등록이 규칙(UPSTREAM_SYNC §3). 같은 날 **거버·첨부·회원 이미지 파일 전면 미이관** 결정(컷오버 즉시화, 소급은 `migrate:files --sideload --relink`).
6. **2026-08-04 — 미주문 견적도 이관(phase 06)** — "쇼핑/협력사 대기 cart 행 스킵" 철회. 레거시 견적관리(`estimate.php`)의 대기 견적이 플랫폼에 없어 PCB 협력 모듈 RFQ 워크큐가 공동화되던 문제의 근본 교정. BOM(40·41)은 전용 트랙이 있어 제외. 앵커 집합은 **전 spec**(ctId IS NULL 로 좁히면 승격 직후 같은 라인이 재해석돼 라인·spec 중복+헤더 금액 2배 — 08-05 실사고).
7. **2026-08-02 — 파트너 포탈 메뉴 판정을 extend 로** — `sp_is_approved_partner()` 가 sp-node `requirePartner` 와 같은 축(멤버 존재 ∧ 조직 승인)을 PHP 에서 미러, 테이블 부재 시 SQL 오류를 화면에 내지 않고 비파트너.
8. **2026-07-07 — 코어 최소 수정 예외: `lib/common.lib.php` `get_member()` 이메일 아이디 허용** — 이관 회원 3,224명의 mb_id 가 이메일인데 코어 보안 필터가 거부 → `[^0-9a-z_@.\-]`. 배포에서 빠지면 전원 로그인 불가. 구형 41자 해시는 첫 로그인에 자동 재해시.
9. **2026-07-06~07 — 레거시 DB 전량 이관(사용자 확정 범위)** — 주문·자산 전부, 거버 상품은 주문 연결분만(EAV → 템플릿 앵커+`sp_order_spec`), 회원 확장 필드는 `sp_member_profile`, 레거시 자체 sp_*(파트너 B2B·부품 DB) 미이관. "애매하면 중단" 게이트(`manifest.ts`). 컷오버 전 증분은 `migrate:sync`(레거시 정본 단방향).
10. **2026-07-05 — 주문 알림 체크박스는 코어 목록과 의도적으로 다르게** — 코어 `orderlist.php` 는 설정 무관 노출(결함), `orderform.php` 는 설정 게이트. sp-vue 는 목록·상세 모두 서버 계산 boolean(`cf_email_use` / `cf_sms_use==='icode' && de_sms_use4/5`)으로 게이트 — 실발송 조건과 정합([order-notify-gating](../../docs/order-notify-gating.md)).
11. **2026-07 — 위시리스트 "삭제 아닌 숨김"(`SP_USE_WISHLIST` 기본 false)** — 순정 위시는 `it_id` 북마크라 견적 모델과 비호환. 코어 코드·DB 보존, sp-lite 진입점만 토글 뒤로. 상수 미정의 시 숨김 폴백([wishlist-hidden](../../docs/wishlist-hidden.md)).
12. **2026-07-04 — g5 접근 방침 개정** — "원칙 금지 + 한정 예외" → 규율된 **접근 카탈로그**(g5-db.ts 일원화·함수/컬럼 단위 기록·코어 병행 정합성·카탈로그+HANDOFF 동시 갱신).
13. **초기 방침(2026-06-30) — 코어 비수정 + subtree pull only** — 갱신은 `git subtree pull --prefix=samplepcb-web gnuboard master --squash` 뿐. `config.php` 수정 금지(`G5_DOMAIN=''`, https 는 `proxy_fix.php` auto_prepend). 훅은 `extend/`, 신규 페이지·브리지는 `spcb/`, 화면은 테마, 신규·이관 기능은 모노레포, URL 은 코어 밖 `.htaccess`. 첫 기록된 예외는 기법 #11(주문서 `ct_select` 필터 2곳, 2026-07-04).

## Gotchas [coverage: high — 9 sources]

- **subtree pull 절차**: 작업 트리 깨끗이 → `git fetch gnuboard master && git subtree pull --prefix=samplepcb-web gnuboard master --squash` → **즉시 `ops/scripts/check-core-patches.sh`**. 충돌은 내가 만진 코어 파일에서만, 실패 시 `git reset --hard ORIG_HEAD`. 이력상 실 pull 0회라 첫 pull 때 가드·충돌 처리를 처음 겪게 된다.
- **코어 수정 7파일 vs 가드 5건 — 2파일 미등록(2026-09-19 스캔)**: `mobile/shop/orderform.sub.php`(건별 렌더 union·선택행 옵션 나열)와 `shop/ordermail1.inc.php`(주문 메일의 같은 union, 커밋 4b4ec853d 2026-08-11)에 `sp_custom_row_it_ids_in` 심이 있는데 가드에 없다. pull 한 번이면 모바일 주문서·주문 메일이 조용히 순정으로 돌아간다 → `assert_contains` 2건 추가 권장.
- **gnuboard 리모트 push 절대 금지** — `no_push` URL + `.githooks/pre-push`(URL 에 gnuboard5·youngcart5·no_push 포함 시 차단) + `core.hooksPath` 셋업. 새 클론은 UPSTREAM_SYNC §5 1회 셋업.
- **`prisma migrate reset`/`migrate dev` 절대 금지** — sp_* 가 g5 동거라 reset 은 g5_* 전체 드랍. 추가 전용 migration.sql + `migrate deploy` 만. 재이관도 DB DROP 없이 `reset-data` 로. TRUNCATE 는 트랜잭션 원복이 안 되므로 실패 시 자동 백업으로 복원.
- **스키마는 sync 가 나르지 않는다** — `od_delivery_method` DDL 은 운영 DB 에 **수동 실행**, 미적용 상태에서 새 코드 배포 시 `Unknown column` 으로 목록·상세 SELECT 실패 → DDL 먼저, 배포 나중. 실행 전 `SET SESSION sql_mode=''` 필요(기존 zero-date 기본값이 strict 재검증에 걸림 — 환경별 sql_mode 차이).
- **PHP 사전 ↔ sp-node 계약 미러(수동 동기화 지점)**: 앵커 it_id 목록(`sp_quote_it_ids`↔`TEMPLATE_ITEMS`, `sp-market-svc`↔`MARKET_ANCHOR_IT_ID`, `sp-develop-svc`↔`DEVELOP_ANCHOR_IT_ID`, `sp-bom-parts`) · 스텝퍼 stage 순서표(`sp_order_slowest_progress` rank ↔ 계약 배열) · 클레임/EQ 라벨 사전(`PCB_CLAIM_*_LABELS`·`BOM_CLAIM_*_LABELS`) · 배송방법 라벨 — 한쪽만 바꾸면 화면·메일이 어긋난다. `sp_order_customer_steps()` 의 칸 라벨과 설명 사전 키는 **같은 문자열**이어야 한다. 개념 [manual-sync-drift](../concepts/manual-sync-drift.md).
- **훅의 raw SQL 은 Prisma 실물 컬럼명**(`mbId`·`ctId`·`partnerId`, `@map` 없음) — 컬럼명 추측 금지. `sp_*` 부재 환경(sp-node 미배치)에서 헤더 배지가 사이트를 죽이지 않게 비치명 조회를 유지할 것.
- **훅→sp-node 직결의 실패 모드**: sp-node 다운이면 각 호출이 5초 타임아웃 뒤 null → 섹션만 사라지고 페이지는 느려진다. `secret.php` 미배치면 토큰 `''` → 호출 자체를 건너뜀. 회원 JWT 는 2분 1회용.
- **마이그레이션이 g5 코어 스키마를 확폭했다**(mb_id 255 등) — subtree SQL 정의와 실 DB 가 다르다는 전제로 작업. **비회원 주문 95건**은 구형 od_pwd 해시 폴백이 없어 관리자 대리조회.
- **재이관 env 함정**: `.env`·`.env.migration` 의 DB URL 4개가 같은 호스트·포트·DB 여야 하고 `localhost`/`127.0.0.1` 표기를 섞으면 안 된다(PHP `dbconfig.php` Host 와는 별개). `MIGRATE_PROTECTED_MB_IDS` 에 `admin` 이 있으면 제거. 대형 BOM 행 복원은 `max_allowed_packet`(로컬 기본 1MB) 사전 검사에서 중단될 수 있다(`SET GLOBAL max_allowed_packet=268435456`).
- **로컬 MySQL 복구 교훈(09-09)**: 실행 중인 서버 파일에 `aria_chk` 를 쓰지 말 것. 최초 손상 때 중단된 `mysql-system-before.sql` 은 불완전 덤프라 복구용 아님(성공본은 `all-databases.sql`). 덤프엔 회원·인증 정보가 있어 Git·외부 공유 금지.
- ~~`sp_order_status.extend.php:22` `'A\S'` 오타~~ — 08-25 전면 교정판에서 `'A/S'` 로 해소됨(LEGACY_DB_MIGRATION §8 의 "수정 권장" 항목은 stale).
- **CSS/JS 고친 뒤 `version.extend.php` `G5_CSS_VER`(현재 `26091804`)·`G5_JS_VER` 미상향 시 캐시**로 "적용 안 됨". 스킨 PHP 만 고친 경우는 불필요.
- `.htaccess` 전제 vhost `AllowOverride All` + `mod_rewrite`. 슬러그는 소문자·숫자·하이픈 1단계, `spcb/pages/{슬러그}.php` 실존 시에만. `extend/.htaccess` 는 1줄 플레이스홀더. `spcb/.htaccess` 의 Authorization 패스스루가 없으면 `order-notify.php` 가 서비스 JWT 를 못 읽는다.
- 레거시 `estimate_*` 페이지는 코어가 아닌 레거시 커스텀 — subtree 에 없다. 코어 `orderlist.php` 의 무조건 알림 체크박스 노출은 결함으로 판정해 따르지 않는다.

## Sources [coverage: high — 33 sources]

- [AGENTS.md](../../AGENTS.md) · [CLAUDE.md](../../CLAUDE.md) — 구조·리모트·코어 비수정·nginx 통합·인증 브리지·접근 카탈로그·prisma reset 금지
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — subtree pull 절차·가드 필수·절대 규칙·충돌/롤백·1회 셋업 (2026-08-05)
- [ops/scripts/check-core-patches.sh](../../ops/scripts/check-core-patches.sh) — 코어 최소 수정 가드 5건 (2026-08-17) · [.githooks/pre-push](../../.githooks/pre-push) — gnuboard push 차단
- [docs/LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md) — 전량 이관·phase 06·sync 쿡북·컷오버 런북·§8 코어 수정 예외 (2026-09-16)
- [docs/legacy-production-reimport.md](../../docs/legacy-production-reimport.md) — 운영 초기화·재이관 절차·보존 범위 (2026-09-16) · [docs/db-snapshot-rollback.md](../../docs/db-snapshot-rollback.md) — 스냅샷·원복 (2026-09-11) · [docs/local-mysql-recovery-2026-09-09.md](../../docs/local-mysql-recovery-2026-09-09.md) — Aria 손상 복구
- [docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md) — 운영 원본 구조 스냅샷 (2026-07-02) · [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 기법 카탈로그 4장·접근 카탈로그 5장 (2026-09-10)
- [docs/DELIVERY_METHOD.md](../../docs/DELIVERY_METHOD.md) — 배송방법 컬럼·병용·운영 DDL 수동 (2026-08-17) · [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 알림 게이트 패리티 이탈 · [docs/wishlist-hidden.md](../../docs/wishlist-hidden.md) — SP_USE_WISHLIST
- [samplepcb-web/.htaccess](../../samplepcb-web/.htaccess) · [samplepcb-web/extend/.htaccess](../../samplepcb-web/extend/.htaccess) · [samplepcb-web/spcb/.htaccess](../../samplepcb-web/spcb/.htaccess) — 라우팅·무확장 URL·Authorization 패스스루
- extend 훅: [sp_quote_cart](../../samplepcb-web/extend/sp_quote_cart.extend.php) · [sp_order_status](../../samplepcb-web/extend/sp_order_status.extend.php) · [sp_partner](../../samplepcb-web/extend/sp_partner.extend.php) · [sp_pcb_eq](../../samplepcb-web/extend/sp_pcb_eq.extend.php) · [sp_pcb_claim](../../samplepcb-web/extend/sp_pcb_claim.extend.php) · [sp_bom_claim](../../samplepcb-web/extend/sp_bom_claim.extend.php) · [default.config.php](../../samplepcb-web/extend/default.config.php) · [version.extend.php](../../samplepcb-web/extend/version.extend.php) · [shop.extend.php](../../samplepcb-web/extend/shop.extend.php)
- 코어 최소 수정 파일(마커 스캔): [lib/common.lib.php](../../samplepcb-web/lib/common.lib.php) · [shop/orderform.php](../../samplepcb-web/shop/orderform.php) · [shop/orderform.sub.php](../../samplepcb-web/shop/orderform.sub.php) · [mobile/shop/orderform.sub.php](../../samplepcb-web/mobile/shop/orderform.sub.php) · [shop/orderformupdate.php](../../samplepcb-web/shop/orderformupdate.php) · [mobile/shop/orderformupdate.php](../../samplepcb-web/mobile/shop/orderformupdate.php) · [shop/ordermail1.inc.php](../../samplepcb-web/shop/ordermail1.inc.php)
- git 커밋(보조): 5eb5d3f67(가드 신설 08-05) · ea2916b98(가드 +4 08-17) · a4fd659d3(admin 이관 09-16) · 82500bae6(reset-data 09-16) · d4323b882(초기 커밋 06-30)
