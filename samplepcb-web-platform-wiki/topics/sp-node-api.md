---
topic: sp-node-api
last_compiled: 2026-07-03
sources_count: 10
status: active
---

# sp-node-api

## Purpose [coverage: high — 5 sources]

**sp-node** = Fastify 5 API 서버 (`samplepcb-web-mono-app/apps/api`, nginx `/api` 프록시, 기본 127.0.0.1:3000). 동적 PCB 주문(거버 업로드 → 사양·가격이 그때 정해지는 주문)을 영카트 **코어 무수정**으로 구현하는 백엔드다. 핵심 역할:

- **거버 PCB 담기 API** (`/api/pcb-projects`): 검증 → 견적 → 파일서버 업로드 대행 → `sp_*` 저장 → `g5_shop_cart` 스냅샷 INSERT
- **가격 엔진** (`src/pricing/engine.ts`): 레거시 PHP `pcb_price*.lib.php` 를 실측 패리티로 이식
- **g5 한정 예외 모듈** (`src/lib/g5-db.ts`): 담기에 필요한 최소한의 그누보드 DB 접근

의존 주체: 거버 뷰어(React, 별도 repo `samplepcb_gerber`)가 제출·목록·재견적·삭제를 호출하고, sp-php 커스텀 페이지(`/shop/quotes`, `/shop/quotes/archive`)와 영카트 cart.php 가 그 결과를 표시한다.

## Architecture [coverage: high — 6 sources]

- **스택**: TypeScript / Node 22, Fastify 5 + `fastify-type-provider-zod`(Zod 가 req/res 검증·직렬화의 단일 진실원본), `@fastify/multipart`(거버 zip 최대 100MB), `@fastify/cors`, `@fastify/sensible`. pnpm + Turborepo 모노레포의 `apps/api`.
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes 등, ESLint `no-explicit-any`=error. 데이터 흐름이 DB(Prisma) → Fastify(zod) → `@sp/api-contract` → Vue 로 타입 연결.
- **계약**: 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod) — `PcbProjectPayload`(spec 키 39종), `JwtClaims` 등. FE/BE 양쪽 import.
- **디렉토리** (`src/`):
  - `server.ts` — 부트스트랩, 라우트 prefix `/api`, HOST 기본 127.0.0.1(로컬 전용, nginx 뒤)
  - `routes/` — `pcb-projects.ts`(핵심), `pcb-thumbs.ts`(서명 썸네일), `me.ts`, `health.ts`
  - `plugins/auth.ts` — 그누보드 발급 JWT **검증만** (`@fastify/jwt`, 공유 시크릿)
  - `pricing/` — `engine.ts` + `pricing-data.json`(가격표 스냅샷) + `engine.test.ts` + `legacy-parity.test.ts` + `__fixtures__/legacy-pricing-goldens.json`
  - `lib/` — `g5-db.ts`(한정 예외, mysql2), `file-server.ts`(file.samplepcb.kr 업로드/삭제 대행), `prisma.ts`, `legacy-db.ts`(마이그레이션 스크립트 전용·읽기 전용), `thumb-url.ts`
  - `scripts/` — `sync-pricing-data.ts`, `capture-legacy-pricing-goldens.ts`, `seed-template-items.ts`, `extract-legacy-gerber-samples.ts`

## Talks To [coverage: high — 6 sources]

| 상대 | 방향/방식 |
|---|---|
| 거버 뷰어 (React) | multipart POST + `Authorization: Bearer JWT` 수신 |
| 그누보드 인증 브리지 `spcb/api/me.php` | 직접 통신 없음 — 브리지가 발급한 HS256 JWT(TTL 10분, `mbId`·`cartId` 클레임)를 공유 시크릿(`JWT_SECRET` = `spcb/lib/secret.php` 와 수동 동기화)으로 검증만 |
| samplepcb DB (공유) | Prisma 로 `sp_*` 소유 (`DATABASE_URL`) |
| 그누보드 DB (`G5_DATABASE_URL`) | mysql2 직결 — 한정 예외 4가지만 (아래 Key Decisions) |
| file.samplepcb.kr | 서버-to-서버 업로드(`/api/uploadFileByAnonymous`)·삭제(`GET /api/delete/:pathToken`) 대행, pathToken 클라이언트 미노출 |
| 레거시 가격 API (`samplepcb_pricing_api.php`) | 런타임 아님 — 패리티 캡처 스크립트가 실측 대조용으로만 호출 |
| nginx | `/api/` → 3000 프록시 (같은 도메인에서 PHP `/`·Vue `/app` 과 합류) |

## API Surface [coverage: medium — 3 sources]

| 메서드/경로 | 역할 |
|---|---|
| `POST /api/pcb-projects` | 담기: payload Zod 검증 → JWT 검증 → 견적 재계산 → 파일 업로드 → Prisma 트랜잭션 저장(sp_quote/sp_order_spec/sp_file) → flow=order & 가격 확정 시 cart INSERT → `spec.ctId` 연결. 응답에 `quoteStatus`(priced/rfq)·`price`·`eta`·`redirectUrl` |
| `GET /api/pcb-projects` | 목록 (`?status=active\|deleted`) — **lazy reconcile** 겸함: "ctId 있음 + cart 행 없음" 감지 시 status='deleted' 전환 |
| `POST /api/pcb-projects/order` | 바로 주문: 배치 담기 + `ct_select` **행(ct_id) 단위** UPDATE → orderform 직행 |
| `PATCH /api/pcb-projects/:id` | 수량 수정 = 서버 재견적(새 quoteId 발급 — 비선형 브래킷 때문) |
| `DELETE /api/pcb-projects/:id` | active→소프트 삭제(보관함) / deleted→하드 삭제(실파일 선삭제 후 DB 파기, 멱등 재시도) |
| `GET /api/health`, `/api/me`, pcb-thumbs | 헬스체크 · JWT 확인 · 서명 썸네일 URL |

가격 엔진 커버리지: standard(면적식+옵션표+마진브래킷+소형고정가) / metalMask(국내가표) / advance·flexible류·mass·가격 0 → **rfq**(자동견적 불가).

## Data [coverage: high — 5 sources]

Prisma 스키마 (`prisma/schema.prisma`) — `sp_` 접두, **그누보드와 같은 DB(`samplepcb`) 공유** (2026-07-03 통합, DB 공유 ≠ 스키마 결합):

- **`sp_quote`** (SpQuote) — 견적 스냅샷 = 담기 시 가격 재검증의 단일 진실원본. `id`=quoteId(uuid), `specJson`·`specHash`(변조 대조 sha256), `autoPrice`(null=rfq), `priceVersion`(일괄 무효화), `expiresAt`(+72h)
- **`sp_order_spec`** (SpOrderSpec) — 주문의 실체(=PCB 프로젝트). `mbId`, `quoteId`, `ctId`(cart 파생 조회 키 — 관계는 저장 안 함), `specJson`(EAV 슬롯 제한 없음), `status`(active|deleted|archived), `quoteStatus`(priced|rfq|quoted), `finalPrice`(관리자 확정가)
- **`sp_file`** (SpFile) — 폴리모픽 파일 연결(`ref_type`='sp_order_spec'). 실파일은 파일서버, 여기엔 `pathToken` 만

g5 측: `g5_shop_cart`(INSERT+파생 SELECT+ct_select UPDATE), `g5_shop_item_option`(견적 옵션 행 INSERT+보상 DELETE), `g5_shop_item`(템플릿 4종 SELECT만 — `sp-pcb-std`/`sp-mask`/`sp-pcb-adv`/`sp-pcb-flex`).

환경변수(`.env.example`): `PORT`/`HOST`, `JWT_SECRET`, `DATABASE_URL`(Prisma), `G5_DATABASE_URL`(한정 예외), `LEGACY_DATABASE_URL`(스크립트 전용), `WEB_BASE_URL`, `FILE_SERVER_URL`/`FILE_SERVICE_TYPE`.

## Key Decisions [coverage: high — 5 sources]

- **코어 비수정 + 스냅샷 모델**: 영카트 cart/order 는 담는 시점 값을 복사하고 상품을 다시 보지 않는다(`cartupdate.php:291`) — 이를 역이용해 임의 가격 행을 직접 INSERT. 상품은 카테고리 앵커(템플릿 4종)로만 존재, 주문 실체는 `sp_order_spec` 소유.
- **io_price 기법**: 코어 `before_check_cart_price` 가 `ct_price`≠상품가면 덮어쓰므로, `ct_price=0` + 견적마다 `g5_shop_item_option` 에 옵션 행 실등록(`io_id=quoteId`, `io_price=견적가`)으로 코어 재검증을 **정당하게** 통과. (미등록 io_id 스킵 초기안은 PHP 8 null 경고로 폐기)
- **cartId 클레임**: 외부 서버가 알 수 없는 PHP 세션 `ss_cart_id` 를 JWT 로 배달 — cart.php 무수정으로 행이 보이는 순환을 닫는다.
- **가격은 서버 재계산만이 진실**: 클라이언트가 보내는 가격은 표시용, 위변조 원천 차단. quoteId 는 서명 토큰이 아닌 **DB 저장**(rfq 기록·감사·일괄 무효화 필요).
- **라이브 실측 패리티**: 가격 정합은 코드 리뷰가 아니라 라이브 레거시 API 실캡처 47케이스 재생 대조(`legacy-parity.test.ts`, 판매가·제작일·무게·eta 전항목)로 보증.
- **lazy reconcile**: cart 삭제 신호를 훅·트리거(=코어 수정) 없이 목록 조회가 겸한다. cart↔spec 관계를 저장하지 않고 조회 시점 조인으로 파생 — 동기화 로직 자체가 없어 불일치 불가능.
- **한 건은 한 화면에만**: 견적관리(순수 견적) / 장바구니·주문내역(담긴 이후) / 보관함(삭제분) 배타 소속 — 상태 동기화 문제가 UI 로 번지는 것을 차단.
- **spec 키 `differentDesign` 통일** (2026-07-03): 레거시의 이중 명명(`differentDesign`/`diffDesign`) 중 가격 계산 계열로 통일. `diffDesign` 은 구주문 마이그레이션 경계 별칭으로만 존재, 서버는 구키를 흡수하지 않음(통일성 우선).
- **prisma migrate reset 절대 금지**: 공유 DB 라 실행 시 g5_* 전체 드랍. migrate dev/deploy 만.

## Gotchas [coverage: high — 5 sources]

- ⚠ **`prisma migrate reset` = 그누보드 DB 전멸**. schema.prisma·.env.example 양쪽에 경고 명시.
- ⚠ **`differentDesign` 부재 → 조용한 rfq 강등**: 클라이언트가 이 키를 안 보내면(오탈자·구키 `diffDesign` 포함) 엔진이 "파일 개수 부재 → 0원 → rfq" 처리 — 화면에 '견적 대기'가 뜨고 주문이 견적관리로 빠진다. 2026-07-03 실사고 있었음.
- ⚠ **가격표 스냅샷 드리프트**: 라이브 가격표는 관리자가 수시 조정 — 알고리즘이 같아도 스냅샷이 낡으면 가격이 통째로 어긋난다(2026-07 사례: 61,000 vs 66,000원). 표 변경 시 절차 필수: `pnpm pricing:sync` → `PRICE_VERSION` bump → `pnpm pricing:capture` → `pnpm test`. 패리티 테스트 첫 케이스 "스냅샷 sha ≠ fixture sha" 실패 = 절차 누락 신호.
- ⚠ **파일 삭제 API 보안 미처리**: 파일서버 삭제가 인증 없는 `GET /api/delete/:pathToken` — pathToken 유출 시 임의 파일 삭제 가능. 내부망 제한/서버 간 인증 후속 과제(2026-07 결정: 기능 먼저).
- **cart 담기 실패해도 프로젝트는 유효**: 파일 업로드 실패는 즉시 중단(파일 없는 프로젝트 방지), cart INSERT 실패는 "견적 보관" 상태로 남아 오염 없음.
- **eta 는 직관과 다른 레거시 실동작**: 주말/공휴일 카운트는 레거시에서 주석 처리됨 — 실제는 `now + (제작일+3) 달력일`, 종료일 토요일 +2 / 일요일 +1.
- **g5 접근 범위 확장 금지**: `g5-db.ts` 의 4가지 한정 예외(cart INSERT · 옵션 행 INSERT · 파생 SELECT · ct_select UPDATE) 외 g5_* 접근은 HANDOFF 결정 갱신이 선행돼야 한다.
- 템플릿 상품은 일반 목록/상세 노출 금지 — `cartupdate.php` 의 같은 it_id 재담기 시 기존 행 전부 삭제 동작을 차단하기 위함.
- JWT 는 10분 캐시(세션이 진실원본) — 저장하지 말고 제출 직전 me 재호출로 발급.

## Sources [coverage: high — 10 files]

- [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 담기 프로세스·코어 무수정 기법 카탈로그·데이터 소유권
- [pricing-engine-parity.md](../../docs/pricing-engine-parity.md) — 가격표 동기화 절차·differentDesign 결정·레거시 실동작
- [AGENTS.md (모노레포)](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·패키지 구조
- [AGENTS.md (루트)](../../AGENTS.md) — 별칭·nginx 라우팅·인증 브리지 단일 설명원본
- [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — sp_quote/sp_order_spec/sp_file
- [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 환경변수 계약
- [server.ts](../../samplepcb-web-mono-app/apps/api/src/server.ts) — 부트스트랩·플러그인 구성
- [pcb-projects.ts](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-projects.ts) — 담기 라우트 헤더 주석
- [g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) — 한정 예외 범위·템플릿 상품 매핑
- [file-server.ts](../../samplepcb-web-mono-app/apps/api/src/lib/file-server.ts) — 파일서버 업로드 대행
