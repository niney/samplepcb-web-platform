---
topic: sp-node-api
last_compiled: 2026-07-06
sources_count: 14
status: active
---

# sp-node-api

## Purpose [coverage: high — 6 sources]

**sp-node** = Fastify 5 API 서버 (`samplepcb-web-mono-app/apps/api`, nginx `/api` 프록시, 기본 127.0.0.1:3333). 동적 PCB 주문(거버 업로드 → 사양·가격이 그때 정해지는 주문)을 영카트 **코어 무수정**으로 구현하는 백엔드다. 2026-07-03 시점의 "담기 API + 가격 엔진"에서, **2026-07-04~05 사이 관리자 백엔드로 크게 확장**됐다 — sp-php(그누보드/영카트) 업무 기능을 모노레포로 **점진 마이그레이션**하는 방침(2026-07-04)에 따라 견적·회원·주문·설정 관리가 이 서버로 이관됐다. 핵심 역할:

- **거버 PCB 담기 API** (`/api/pcb-projects`): 검증 → 견적 → 파일서버 업로드 대행 → `sp_*` 저장 → `g5_shop_cart` 스냅샷 INSERT
- **가격 엔진** (`src/pricing/engine.ts`): 레거시 PHP `pcb_price*.lib.php` 를 실측 패리티로 이식
- **관리자 API** (`/api/admin/*`, `requireAdmin` 가드): 견적 관리(가격 확정)·회원 관리·주문내역(orderlist.php 풀 패리티)·쇼핑몰 설정. 레거시 `/adm/shop_admin/*.php` 이식
- **g5 접근 카탈로그** (`src/lib/g5-db.ts`): 그누보드/영카트 DB 접근을 함수·컬럼 단위로 규율한 단일 모듈. 2026-07-04 방침 개정으로 "한정 예외 4종"에서 **접근 카탈로그 ⑤–⑱**로 확장

의존 주체: 거버 뷰어(React, 별도 repo `samplepcb_gerber`)가 담기·목록·재견적·삭제를 호출하고, sp-php 커스텀 페이지(`/shop/quotes`)·영카트 cart.php 가 그 결과를 표시하며, **sp-vue 관리자 화면**(`/app/admin/*`)이 관리 API를 소비한다.

## Architecture [coverage: high — 6 sources]

- **스택**: TypeScript / Node 22, Fastify 5 + `fastify-type-provider-zod`(Zod 가 req/res 검증·직렬화의 단일 진실원본), `@fastify/multipart`(거버 zip 최대 100MB), `@fastify/jwt`, `@fastify/cors`, `@fastify/sensible`. 엑셀 배송처리에 `exceljs`. pnpm + Turborepo 모노레포의 `apps/api`.
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes 등, ESLint `no-explicit-any`=error. 데이터 흐름 DB(Prisma/mysql2) → Fastify(zod) → `@sp/api-contract` → Vue.
- **계약**: 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod) — `PcbProjectPayload`(spec 키 39종), `JwtClaims`, 그리고 관리 계약군 `admin.ts`(견적)·`members.ts`(회원)·`orders.ts`(주문·알림·배송·force target)·`settings.ts`(사업자정보). FE/BE 양쪽 import.
- **디렉토리** (`src/`):
  - `server.ts` — 부트스트랩, 라우트 prefix `/api`, HOST 기본 127.0.0.1(로컬 전용, nginx 뒤)
  - `routes/` — `pcb-projects.ts`(담기 핵심)·`admin-pcb-projects.ts`(관리자 견적)·`admin-members.ts`(회원)·`admin-orders.ts`(주문내역·상태전이·삭제·엑셀·상세편집·force)·`admin-settings.ts`(사업자정보)·`pcb-thumbs.ts`·`me.ts`·`health.ts`
  - `plugins/auth.ts` — 그누보드 JWT **검증만**(`@fastify/jwt`, 공유 시크릿) + **`requireAdmin` 데코레이터**(JWT `isAdmin` 클레임, 관리 API 서버 경계)
  - `pricing/` — `engine.ts` + `pricing-data.json`(스냅샷) + `engine.test.ts` + `legacy-parity.test.ts` + `__fixtures__/legacy-pricing-goldens.json`
  - `lib/` — **`g5-db.ts`(접근 카탈로그, mysql2)** · `file-server.ts`(file.samplepcb.kr 대행) · `prisma.ts` · `legacy-db.ts`(스크립트 전용·읽기 전용) · `thumb-url.ts` · `option-summary.ts`(cart·사용자·관리자 표기 통일) · `order-edit.ts`(주문 편집 화이트리스트 매퍼) · `delivery-excel.ts`(exceljs) · `php-bridge.ts`(알림 브리지 클라이언트) · `quote-delete.ts` · `kst.ts`(KST 날짜)
  - `scripts/` — `sync-pricing-data.ts`, `capture-legacy-pricing-goldens.ts`, `seed-template-items.ts`, `extract-legacy-gerber-samples.ts`
  - 순수 로직 테스트: `g5-db.test.ts`·`order-edit.test.ts`·`shop-config.test.ts` (WHERE 빌더·`computeOrderMoney`·`orderTransitionGuard`·`matchDeliveryRows`·`resolveForceStatusStock`·`isValidCallback` 등)

## Talks To [coverage: high — 6 sources]

| 상대 | 방향/방식 |
|---|---|
| 거버 뷰어 (React) | multipart POST + `Authorization: Bearer JWT` 수신 |
| sp-vue 관리자 화면 | `/api/admin/*` 소비 (Bearer JWT, `requireAdmin`) |
| 그누보드 인증 브리지 `spcb/api/me.php` | 직접 통신 없음 — 브리지 발급 HS256 JWT(TTL 10분, `mbId`·`cartId`·`isAdmin` 클레임)를 공유 시크릿(`JWT_SECRET` = `spcb/lib/secret.php` 수동 동기화)으로 검증만 |
| **PHP 알림 브리지 `spcb/api/order-notify.php`** | **sp-node → sp-php (신규 역방향 호출)**: 주문 상태 전이(입금/배송) 시 `php-bridge.ts` `notifyOrderEvent` 가 서비스 JWT(`svc:'sp-node'`, 같은 시크릿 서명)로 `POST {SPCB_BRIDGE_URL}/spcb/api/order-notify` — 메일/SMS 를 Node 재구현이 아니라 **레거시 커스텀 메일 템플릿 재사용**으로 발송. 타임아웃 10s, 실패는 'failed' 로 삼켜 전이 성공 불변 |
| samplepcb DB (공유) | Prisma 로 `sp_*` 소유 (`DATABASE_URL`) |
| 그누보드/영카트 DB (`G5_DATABASE_URL`) | mysql2 직결 — **접근 카탈로그 ⑤–⑱**(아래 Data) |
| file.samplepcb.kr | 서버-to-서버 업로드(`/api/uploadFileByAnonymous`)·삭제(`GET /api/delete/:pathToken`) 대행, pathToken 클라이언트 미노출 |
| 레거시 가격 API (`samplepcb_pricing_api.php`) | 런타임 아님 — 패리티 캡처 스크립트가 실측 대조용으로만 호출 |
| nginx | `/api/` → 3333 프록시 |

## API Surface [coverage: high — 5 sources]

**담기·견적 (사용자, `pcb-projects.ts`)**

| 메서드/경로 | 역할 |
|---|---|
| `POST /api/pcb-projects` | 담기: payload Zod 검증 → JWT 검증 → 견적 재계산 → 파일 업로드 → Prisma 트랜잭션 저장 → flow=order & 가격 확정 시 cart INSERT → `spec.ctId` 연결. 응답 `quoteStatus`·`price`·`eta`·`redirectUrl` |
| `GET /api/pcb-projects` | 목록(`?status=active\|deleted`) — **lazy reconcile** 겸함(ctId 있음+cart 행 없음 → status='deleted') |
| `GET /api/pcb-projects/cart-items` | 장바구니 카드 보강(ct_id별 실수량·projectId·거버 썸네일) |
| `POST /api/pcb-projects/order` | 바로 주문: 배치 담기 + `ct_select` **행(ct_id) 단위** UPDATE → orderform 직행 |
| `PATCH /api/pcb-projects/:id` | 수량 수정 = 서버 재견적(새 quoteId — 비선형 브래킷). 담김 허용(재견적 시 rfq 강등 수량만 REQUOTE_RFQ_IN_CART 거부) |
| `DELETE /api/pcb-projects/:id` | active→소프트 삭제(보관함) / deleted→하드 삭제(실파일 선삭제 후 DB 파기, 멱등) |

**관리자 (`/api/admin/*`, `requireAdmin`)**

| 메서드/경로 | 역할 |
|---|---|
| `GET /api/admin/pcb-projects` · `/:id` | 견적 목록(전 사용자·탭·검색·기간·페이지네이션)·상세(사양·파일·회원·스냅샷) |
| `PATCH /api/admin/pcb-projects/:id/price` | 가격 확정 rfq→quoted(`finalPrice`/`pricedBy`/`pricedAt`; 담김·주문됨 409) |
| `PATCH /api/admin/pcb-projects/:id/company-name` | 수신처 회사명(스냅샷 삭제/프로필 upsert; status·cart 가드 없음) |
| `DELETE /api/admin/pcb-projects` (배치) | 견적 완전삭제(프리뷰 danger + 미입금 주문까지 파기, `quote-delete.ts`) |
| `GET /api/admin/pcb-files/:fileId` | 관리자 원본 다운로드(Bearer, pathToken 미노출) |
| `GET/PATCH /api/admin/members …` | 회원 목록·상세·차단/레벨·정보/메모 편집(`admin-members.ts`) |
| `GET /api/admin/orders` · `/:odId` | 주문내역 목록(탭·검색·기간·정렬·counts)·상세(orderlist.php 이식) |
| `PATCH /api/admin/orders/status` | 선형 상태 전이(준비→가격확인→…→생산완료→배송→완료). 메일/SMS 는 알림 브리지 |
| `PATCH /api/admin/orders/:odId/force-status` | 임의 상태 변경(A/S 포함, target+delivery?, HAS_POINT 409) |
| `PATCH /api/admin/orders/:odId/items/status` | 카트행 단위 취소/반품/품절(무통장 409) |
| `PATCH /api/admin/orders/:odId/info·/memo·/receipt` | 주문 상세 편집·메모·입금 조정(무통장 409) |
| `GET /api/admin/orders/:odId/print` | 주문서 인쇄(상세+발신처) |
| `GET/POST /api/admin/orders/delivery-excel` | 엑셀 배송일괄처리(다운로드=준비·미수0 xlsx / 업로드=A·I·J열 파싱, 파트명 `file`) |
| `GET /api/admin/orders/notify-config` | 알림 체크박스 노출 게이트 boolean(mail/smsDeposit/smsShipping) |
| `GET/PATCH /api/admin/settings/business-info` | 쇼핑몰 사업자정보 11필드(g5_shop_default de_admin_*) |
| `DELETE /api/admin/orders` (배치) | 미입금 주문 완전삭제(od_status='주문'만, `deleteUnpaidOrder`) |

가격 엔진 커버리지: standard(면적식+옵션표+마진브래킷+소형고정가) / metalMask(국내가표) / advance·flexible류·mass·가격 0 → **rfq**.

## Data [coverage: high — 6 sources]

**Prisma (sp-node 소유)** — `sp_` 접두, **그누보드와 같은 DB(`samplepcb`) 공유**(2026-07-03 통합, DB 공유 ≠ 스키마 결합):

- **`sp_quote`** — 견적 스냅샷(단일 진실원본). `specHash`(sha256), `autoPrice`(null=rfq), `priceVersion`(일괄 무효화), `expiresAt`(+72h)
- **`sp_order_spec`** — 주문 실체(=PCB 프로젝트). `mbId`·`quoteId`·`ctId`(cart 파생 조회 키)·`specJson`·`status`·`quoteStatus`·`finalPrice`(관리자 확정가)·**`companyName`**(수신처 회사명 스냅샷 — 견적서 문서층, 2026-07-04)
- **`sp_file`** — 폴리모픽 파일 연결(`ref_type`='sp_order_spec'), `pathToken` 만
- **`sp_member_profile`** (신규 2026-07-04) — 회원별 견적 기본값(회사명 프로필층). 표시값 = `스냅샷 ?? (회원)프로필`. 그누보드 여분필드(mb_1/mb_2) 대신 sp측 명시 필드

**g5 접근 카탈로그** (`lib/g5-db.ts`, 2026-07-04 방침: "금지+예외" → 규율된 접근 카탈로그) — 함수·컬럼 단위로 명시, 민감 컬럼(비밀번호·인증·od_pwd/od_cash) SELECT 자체 배제, Prisma 비편입 불변:

- **① 담기 4종** — `g5_shop_cart` INSERT · `g5_shop_item_option` 옵션 행 INSERT+보상 DELETE · 파생 SELECT · `ct_select` UPDATE
- **⑤** `g5_member` read-only(견적 신청자 표시)
- **⑥** `g5_shop_cart` 견적 행 UPDATE/DELETE(재견적 io_price/ct_option 동기화)
- **⑦** `g5_shop_default` 견적서 발신처 SELECT
- **⑧** `g5_member`·`g5_config` read-only(회원 관리 목록/상세, cf_admin 가드)
- **⑨** `g5_member` UPDATE(⑨-a 차단/레벨 · ⑨-b 정보/메모; 코어 정합성 이식·화이트리스트)
- **⑩** `g5_shop_order` read-only(견적 완전삭제 프리뷰 `getOrderInfoByCtId`)
- **⑪** `g5_shop_order` DELETE(미입금 주문 완전삭제 `deleteUnpaidOrder`)
- **⑫** `g5_shop_order`/`g5_shop_cart` read(주문내역 목록/상세 `searchOrders`·counts, 민감 컬럼 배제, 파라미터 바인딩)
- **⑬** 상태 전이 UPDATE(무통장 입금→준비→배송→완료; ct_status·재고·미수금 재계산; `setOrdersReceipt/Preparing/Delivery/Complete`)
- **⑭** 주문 상세 편집(`updateOrderInfo`/`updateOrderShopMemo`/`updateOrderReceipt` — 무통장 3필드+미수금 재계산)
- **⑮** 카트행 취소/반품/품절(`setOrderItemsStatus` — ct 단위 재고 복원·미수금 재계산, 무통장 한정)
- **⑯** 임의 상태 변경(`setOrderForceStatus` — 취소류 포함 역방향, 스톡 앵커만 미러)
- **⑰** PCB 제작 8단계(가격확인~A/S) — od_status 재사용(신규 컬럼·Prisma 마이그레이션 없음), **`ACTIVE_ORDER_STATUSES` 상수 SSOT**(정상합계/부분취소/counts IN절 통합), 선형 전이 편입(`setOrdersStage`/`TRANSITION_REQUIRED_STATUS`)
- **⑱** 쇼핑몰 사업자정보(`getBusinessInfo`/`updateBusinessInfo` — de_admin_* 11컬럼만, 코어 ~150컬럼 일괄 미훼손)

**환경변수**(`.env.example`): `PORT`/`HOST`, `JWT_SECRET`, `DATABASE_URL`(Prisma), `G5_DATABASE_URL`(접근 카탈로그), `LEGACY_DATABASE_URL`(스크립트 전용), **`SPCB_BRIDGE_URL`**(알림 브리지 대상, 기본 `http://127.0.0.1:8888`), `WEB_BASE_URL`, `FILE_SERVER_URL`/`FILE_SERVICE_TYPE`.

## Key Decisions [coverage: high — 6 sources]

- **코어 비수정 + 스냅샷 모델**: 영카트 cart/order 는 담는 시점 값을 복사하고 상품을 다시 보지 않는다 — 임의 가격 행을 직접 INSERT. 주문 실체는 `sp_order_spec` 소유.
- **io_price 기법**: `ct_price=0` + 견적마다 `g5_shop_item_option` 옵션 행 실등록(`io_id=quoteId`, `io_price=견적가`)으로 코어 재검증(`before_check_cart_price`)을 정당 통과.
- **가격은 서버 재계산만이 진실** — 클라이언트가 보내는 가격은 표시용. quoteId 는 DB 저장(rfq 기록·감사·일괄 무효화).
- **라이브 실측 패리티** — 라이브 레거시 API 실캡처 47케이스 재생 대조(`legacy-parity.test.ts`)로 판매가·제작일·무게·eta 전항목 보증.
- **관리 기능은 모노레포로 점진 마이그레이션** (2026-07-04 방침, GERBER 5장·HANDOFF #11): sp-php 업무 기능을 최적화·커스텀 목적으로 sp-node 로 이관. g5_* 접근은 "금지 예외"가 아니라 **접근 카탈로그** — ① g5-db.ts 일원화 ② 함수·컬럼 단위 기록 ③ 코어 부수효과 정합성 확인 ④ 카탈로그+HANDOFF 동시 갱신.
- **알림은 Node 재구현이 아니라 PHP 브리지 재사용** — 입금/배송 메일·SMS 는 `notifyOrderEvent` → `order-notify.php` → 레거시 `ordermail.inc.php`. 발송 실패는 삼켜 전이 성공을 흔들지 않는다(부수효과 분리).
- **알림 게이트는 서버 계산·FE 소비** — 체크박스 노출을 `getNotifyConfig`(cf_email_use·`cf_sms_use==='icode'`+de_sms_use4/5)로 서버가 boolean 판정. 코어 목록(무조건 노출=결함)과 의도적으로 다르게, 실발송과 정합(`docs/order-notify-gating.md`).
- **제작 8단계는 od_status 재사용·선형 전이** — 신규 컬럼·Prisma 마이그레이션 없이 공유 DB reset 제약 회피. '다음 단계 처리' 선형 체인에 제작 7단계 편입, 배송 실무(운송장·재고차감·배송알림)는 '생산완료→배송' 진입에서만, A/S 는 force-status 전용.
- **prisma migrate reset/dev 금지** — 공유 DB drift 로 g5_* 전멸/전체 reset 요구. 스키마 변경은 추가 전용 migration.sql 수기 + `migrate deploy`.

## Gotchas [coverage: high — 6 sources]

- ⚠ **`prisma migrate reset` = 그누보드 DB 전멸**, **`migrate dev` 도 금지**(g5_* 60개 drift → 항상 전체 reset 요구). 스키마 변경은 additive migration.sql + `migrate deploy` + `generate`.
- ⚠ **`differentDesign` 부재 → 조용한 rfq 강등**: 키 누락 시 "0원 → 견적 대기"로 빠진다(2026-07-03 실사고).
- ⚠ **가격표 스냅샷 드리프트**: 알고리즘이 같아도 스냅샷이 낡으면 가격이 통째로 어긋난다. 절차: `pnpm pricing:sync` → `PRICE_VERSION` bump → `pnpm pricing:capture` → `pnpm test`. 패리티 첫 케이스 "sha 불일치" = 절차 누락 신호.
- ⚠ **파일 삭제 API 무인증 GET**: `GET /api/delete/:pathToken` — pathToken 유출 시 임의 파일 삭제. 내부망 제한/서버 간 인증 후속 과제(2026-07 결정: 기능 먼저).
- **알림 브리지 시크릿 3중 정합**: 회원 JWT·서비스 JWT 모두 `JWT_SECRET`(=`spcb/lib/secret.php` `SPCB_JWT_SECRET`) HS256 대칭키. 불일치 시 `order-notify` 401. `SPCB_BRIDGE_URL` 오설정 시 브리지 호출 자체가 없음.
- **로컬 메일 발송은 Mailpit 필요**: config.php 가 `G5_SMTP=127.0.0.1:25` SMTP 모드라 XAMPP mailtodisk 는 안 통함 — Mailpit 을 25번에 띄워야 함(`docs/LOCAL_MAIL_TESTING.md`). 발송 조건: `cf_email_use=1`+입금/배송 이벤트+수납액/운송장 존재. 준비·완료는 알림 없음.
- **관리자 목록 GET 은 lazy reconcile 안 함** — 읽기가 타 사용자 데이터를 변경하지 않도록. 유령 건은 가격 확정 시점 409 정리.
- **주문 상태 전이 부수효과 갭**: send_cost·쿠폰은 상태 전이 불변으로 저장값 재사용(get_sendcost/쿠폰테이블 포트 미이식). 포인트 복원 no-op(PCB ct_point=0, ct_point>0 은 HAS_POINT skip/409).
- **e2e 사각**: 8단계 상태·카트행 취소 등 다수 기능이 typecheck·단위테스트·lint 통과 기준으로 커밋됨(실브라우저 end-to-end 미검증 표기). 실사용 검증은 별도.
- **g5 접근 확장은 카탈로그 갱신 선행** — g5-db.ts 밖 g5_* 접근·화이트리스트 밖 컬럼 쓰기 금지.

## Sources [coverage: high — 14 files]

- [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 담기·관리 접근 카탈로그 ⑤–⑱·데이터 소유권·관련 파일 색인
- [pricing-engine-parity.md](../../docs/pricing-engine-parity.md) — 가격표 동기화·differentDesign·레거시 실동작
- [order-notify-gating.md](../../docs/order-notify-gating.md) — 알림 체크박스 노출 게이트 정책·`getNotifyConfig`
- [LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·발송 조건·브리지 경로
- [DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 배송 전이 코드 접점(`setOrdersDelivery`·`delivery-excel.ts`)
- [AGENTS.md (모노레포)](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·접근 카탈로그 규율
- [AGENTS.md (루트)](../../AGENTS.md) — 인증 브리지 단일 설명원본·nginx 라우팅
- [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — sp_quote/sp_order_spec/sp_file/sp_member_profile
- [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 환경변수·SPCB_BRIDGE_URL
- [server.ts](../../samplepcb-web-mono-app/apps/api/src/server.ts) — 부트스트랩·라우트 구성
- [pcb-projects.ts](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-projects.ts) — 담기 라우트
- [admin-orders.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-orders.ts) — 주문내역·상태전이·엑셀·상세편집·force
- [g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — 접근 카탈로그·상태 전이·counts
- [php-bridge.ts](../../samplepcb-web-mono-app/apps/api/src/lib/php-bridge.ts) — 알림 브리지 클라이언트 `notifyOrderEvent`
