---
topic: sp-node-api
last_compiled: 2026-07-27
sources_count: 21
status: active
---

# sp-node-api

## Purpose [coverage: high — 10 sources]

**sp-node** = Fastify 5 API 서버 (`samplepcb-web-mono-app/apps/api`, nginx `/api` 프록시, 기본 127.0.0.1:3333). 동적 PCB 주문(거버 업로드) 백엔드로 출발해 관리자 백엔드 전반 → 재능마켓 거래 완결·AI 유스케이스·레거시 마이그레이션까지 확장됐고, **2026-07-17~26에 부품 카탈로그(sp_part*+ES)·sp-engine 게이트웨이·고객 스마트 BOM 견적(sp_bom_quote*)이 추가**됐다. 최근 축은 ① 엔진 결과의 **영속 정본화**(인메모리 소실 대비) ② **제조사 카탈로그(연호 커넥터·Walsin R/C)를 SamplePCB 자체 취급 카탈로그로 적재**다. 핵심 역할:

- **거버 PCB 담기 API** (`/api/pcb-projects`): 검증 → 견적 → 파일서버 업로드 대행 → `sp_*` 저장 → `g5_shop_cart` 스냅샷 INSERT · **가격 엔진**(`src/pricing/engine.ts` 레거시 패리티 + `gerber-price-mode.ts` 공급가 ×1.1)
- **고객 스마트 BOM 견적** (`routes/bom.ts`·`bom-quotes.ts`·`admin-bom-quotes.ts`): 업로드→시트 선택→**분석 영속 박제**→라인 생성→조용한 자동 보강(공급사 검색)→검토(1s 자동저장)→**견적요청(RFQ 1차 종점)**→관리자 확정·회신 — 정본 [BOM_QUOTE](../../docs/BOM_QUOTE.md)
- **부품 카탈로그** (`admin-parts.ts`+`lib/parts-*`): sp-engine 공급사 검색 결과를 자동 인제스트(DB upsert+ES 색인), 단위·표기 다양성을 흡수하는 상세 검색, **제조사 워크북(xlsx) 오프라인 임포트** — 정본 [PARTS_SEARCH](../../docs/PARTS_SEARCH.md)
- **sp-engine 게이트웨이** (`lib/engine-client.ts`+`admin-bom.ts`): Python BOM 추출·공급사 검색 엔진(:8400, 사설망 무인증)에 HTTP async job 프록시 — 인증·소유 검증은 sp-node 담당
- **재능마켓 백엔드** (`market-*.ts`·`admin-market-*.ts`): 승인·블라인드 입찰·채택→계약·영카트 재사용 결제·검수(7일 자동확정)·정산 — 정본 [MARKET_FLOW](../../docs/MARKET_FLOW.md)
- **AI 유스케이스 실행 계층** (`routes/ai.ts`·`rnd-ai.ts`+`lib/ai/`): `sp_config`(연결)+`sp_ai_usecase`(케이스 설정)+`POST /api/ai/:useCase/run` 비동기 잡. 인터뷰 파이프라인(structurize·roc·postings)+선분석 v2+첨부 multipart 분석 — 정본 [AI_DIAGRAM](../../docs/AI_DIAGRAM.md)
- **관리자 API** (`/api/admin/*`, `requireAdmin`): 견적·회원·주문(orderlist 풀 패리티)·설정(사업자·거버가격·AI·BOM 견적)·SEO·슬라이드·마켓 심사/계약/정산·부품·BOM
- **레거시 DB 마이그레이션** (`src/scripts/migrate/`): P1~P3 verify 그린 — 정본 [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md)
- **g5 접근 카탈로그** (`src/lib/g5-db.ts`): g5_* 접근을 함수·컬럼 단위로 규율 — 현재 ①~⑳(⑳=g5_shop_banner 슬라이드)

소비 주체: 거버 뷰어(React), sp-vue(`/app` — 관리자 + **일반 회원 `/app/bom`**), sp-market 고객 SPA(`/market`), sp-rnd 실험 앱(`/rnd`), sp-php 커스텀 페이지.

## Architecture [coverage: high — 8 sources]

- **스택**: TypeScript / Node 22, Fastify 5 + `fastify-type-provider-zod`(Zod 단일 진실원본), `@fastify/multipart`(거버 100MB·BOM 50MB), `@fastify/jwt`, Prisma+mysql2, `exceljs`·`nodemailer`. pnpm+Turborepo `apps/api`(형제: web 5173·market 5176·rnd 5177).
- **타입 강성 "매우 강함"**: strict+noUncheckedIndexedAccess+exactOptionalPropertyTypes, `no-explicit-any`=error. 흐름 DB → Fastify(zod) → `@sp/api-contract` → Vue.
- **계약**: 스키마는 반드시 `@sp/api-contract`(Zod) — `PcbProjectPayload`·`JwtClaims`·관리 계약군·`market.ts`(MARKET_* 코드·라벨 정본, 3앱 공유)·`AI_USECASES`·`AI_INTERVIEW_QUESTIONS`(질문 뱅크 80문항=데이터)·parts(`PartSearchQuery`·`PartOfferKind`)·BOM 견적 계약.
- **디렉토리** (`src/`): `server.ts`(prefix `/api`) · `routes/`(pcb-projects·pcb-thumbs·me·health / bom·bom-quotes / market 5+admin-market 4 / ai·rnd-ai / admin-{pcb-projects,members,orders,settings,seo,slides,parts,bom,bom-quotes}) · `plugins/auth.ts`(JWT 검증만+`requireAdmin`) · `pricing/`(engine 불변+가격모드 후처리+골든 47) · `es/`(client·sp-parts-index) · `lib/`(g5-db 카탈로그 · market*·market-snapshot · **bom-quote·bom-analysis·bom-supplier-operations·bom-local-catalog·bom-search-requirements·bom-procurement-policy·bom-part-data** · bom-engine-jobs·engine-client · **parts-ingest/parts-es/parts-facts/parts-offer-kind/parts-catalog-migration/{yeonho,walsin-rlc}-catalog-workbook/catalog-workbook-xlsx**/manufacturer-alias · exchange-rate · `ai/` · sp-config·file-server·php-bridge·mailer·alimtalk·banner-image·legacy-db) · `scripts/`(sync-pricing·migrate/·seed-market-* · **parts:catalog·parts:catalog-prices·parts:merge-mfr**·parts:reindex·parts:refacts)
- **비동기 잡 2계열**: ① AI 잡(인메모리, run→jobId→5s 폴링, 동일 입력 1h TTL 캐시, `stream:true` 필수) ② 엔진 잡(sp-engine 인메모리 — 파싱·공급사 검색, 202→서버측 폴러 5s·최대 10분+결과 GET 백업 훅+게으른 치유). **엔진 잡 소실 대비는 2026-07-21~23에 영속 원장으로 전환** — 분석은 append-only run, 공급사 결과 원문은 gzip 아티팩트+30초 복구 워커, 일일 검색 카운터는 DB.
- **BOM 견적 생명주기**: `buildStatus`(parsing→selecting→building→ready|failed)와 `enrichStatus`(idle|searching|done|failed)가 **서버 영속 단일 진실** — build가 items와 searching을 한 커밋으로, 반영이 매칭 라인과 done을 한 저장으로 커밋(상태·데이터 원자성). 분석·검색 실행은 append-only이고 `activeAnalysisRunId`/`activeSupplierSearchRunId` 포인터만 원자 전환한다. searching 견적의 상세 GET이 엔진 상태를 확인해 스스로 치유.

## Talks To [coverage: high — 8 sources]

| 상대 | 방향/방식 |
|---|---|
| 거버 뷰어 / sp-vue / sp-market / sp-rnd | Bearer JWT 수신 — `/api/pcb-projects`·`/api/bom`·`/api/admin/*`·`/api/market*`·`/api/ai/*`·`/api/rnd/*` |
| 그누보드 인증 브리지 `spcb/api/me.php` | 직접 통신 없음 — HS256 JWT(TTL 10분, `mbId`·`cartId`·`isAdmin`) 검증만. `JWT_SECRET`=`spcb/lib/secret.php` 수동 동기화 |
| PHP 알림 브리지 `order-notify.php` | 주문 전이(입금/배송) 시 서비스 JWT(`svc:'sp-node'`) POST — 레거시 메일 템플릿 재사용, 실패는 삼킴 |
| **sp-engine (Python, `BOM_ENGINE_URL` 기본 :8400)** | BOM 추출·공급사 검색(Mouser/DigiKey/UniKeyIC) HTTP 프록시 + 무호출 계산 API(`catalog-evaluate-batch`·`procurement/reevaluate-batch`·`/parts/search`·`/capabilities`). 엔진 무인증·사설망, 인증·소유·한도는 sp-node. 타임아웃 `BOM_ENGINE_TIMEOUT_MS`(120s) |
| **Elasticsearch (`ES_NODE_URL` 기본 :9200)** | sp-parts 색인·검색 — xpse 공유 단일 노드, `sp-` prefix만 사용. ES 다운이어도 앱은 뜸(검색 503·색인 큐 적재→기동 시·1분마다 드레인) |
| **제조사 카탈로그 워크북(오프라인 xlsx)** | `parts:catalog`가 실행 시 SHA-256·원본별 불변식을 검증해 ingest envelope로 결정적 변환 — 연호 커넥터 1,606 · Walsin R/C 2,628 |
| **한국수출입은행 Open API** | USD→KRW 자동 환율(`KOREAEXIM_API_KEY`) — 서버 시작+매일 12:10 KST, `sp_config` 캐시, 전체 예산 15초 역탐색 |
| Ollama (`AI_BASE_URL`) | AI 실행 — 기본 로컬 :11434, 운영 ollama.com+키. 우선순위 `.env` > 관리자 저장값 > 기본. 비전 모델 `AI_ATTACHMENT_VISION_MODEL`(기본 qwen3.5:cloud) |
| SMTP / 알림톡(iwinv) | 견적 메일+마켓 메일 8종 직송(로컬은 Mailpit 25번) / `ALIMTALK_ENABLED=false` 기본 |
| samplepcb DB (공유) | Prisma로 `sp_*` 소유(`DATABASE_URL`) / g5_*는 mysql2 카탈로그 ①~⑳(`G5_DATABASE_URL`) / 레거시 운영 DB는 읽기 전용(`LEGACY_DATABASE_URL`) |
| file.samplepcb.kr | 서버-to-서버 업로드·삭제 대행, pathToken 미노출. serviceType: `gerber`·`market`·`bom`(원본 BOM 파일) |
| sp-php 디스크/nginx | 배너 이미지 `G5_DATA_PATH/banner/{bn_id}` 직접 기록 / `/api/`→3333 |

sp-php가 sp_*를 직접 SELECT하는 역방향(sp_review·sp_seo)도 정착 — "관리=sp-vue/sp-node, 소비=sp-php 같은 DB" 패턴. sp-vue→sp-engine 직접 연결은 금지(계약·인증 경계는 항상 sp-node) — [AGENTS.md](../../AGENTS.md) "BOM 역할 경계".

## API Surface [coverage: high — 7 sources]

**거버 담기·견적** (`pcb-projects.ts`): `POST /api/pcb-projects`(담기 — 재계산→업로드→tx→cart INSERT) · `GET`(목록, lazy reconcile) · `GET /cart-items` · `POST /order`(배치 담기+ct_select→orderform 직행) · `PATCH /:id`(수량=서버 재견적) · `DELETE /:id`(소프트→하드).

**고객 BOM 견적** (`/api/bom`, authenticate — [BOM_QUOTE](../../docs/BOM_QUOTE.md)):

| 경로 | 역할 |
|---|---|
| `POST /quotes`(multipart) · `GET /quotes` · `GET/PATCH /quotes/:id` · `POST /quotes/delete` | 업로드→견적+엔진 잡 · 내 목록 · 상세/자동저장(PATCH는 draft 한정, `{id,included,orderQty,catalogSelection?}` 수정 명령) · 선택 최대 200 또는 전체 삭제 |
| `POST /quotes/:id/prepare` → `/build {sheetIndexes}` · `PUT /quotes/:id/sheets` | 전체 시트 분석 영속 박제 → 선택 시트만 라인+필요수량(최대 2,000라인) · 계산 완료 draft의 시트 제외/복원 |
| `GET /quotes/:id/items/:itemId/candidates` · `POST …/selection` · `PUT …/search-requirements` · `PUT /quotes/:id/passive-defaults` | 박제 후보 비교(+검색 trace) · 고객 명시 선택(키만 받아 서버 재계산) · 행별 검색 최소조건 보완 · 수동소자 누락 조건 일괄 승인 |
| `POST /quotes/:id/part-data/prepare` · `GET /quotes/:id/supplier-search` · `GET /quotes/:id/comparison` | 후보 화면용 부품 정보 준비(실패 자동 복구) · 활성 검색 실행 상태 · 페이지형 BOM 비교(5행/페이지, 서버 필터) |
| `/request` · `/cancel` · `DELETE` | RFQ(재계산·환율 동결) · 취소 · draft 하드 삭제 |
| `GET /jobs/:id[/result]` · `POST /jobs/:id/supplier-search[/preflight]` | 엔진 잡 프록시 — 소유 회원만(타인 404 은닉), 일일 한도 429 `SEARCH_DAILY_LIMIT`, max_calls는 sp_config와 엔진 안전 상한(3,000) 중 작은 값 클램프 |
| `GET /parts-search` · `GET /parts/:id` · `POST /parts-search/supplement` | 카탈로그 검색·상세 · 정확 MPN이 아닐 때 엔진 캐시/API 후보를 `inlineOffers`로 즉시 표시(카탈로그 반영은 백그라운드) |

관리자 `admin-bom-quotes.ts`: 목록(기본 draft 제외)·상세·`PATCH`(전이 검증+확정가 confirmed*+메모)·원본 스트리밍·후보/이력·comparison 읽기 전용. 상태 전이 `draft→requested→reviewing→answered→closed`(+canceled)는 서버 검증, requested 이후 고객 수정 409.

**부품 카탈로그** (`admin-parts.ts`): `GET /api/admin/parts/search`(ES 다중해석 쿼리 — Track A SI range ±0.1% + Track B specVariants prefix + should-only 가산점, 패싯·정렬, ES 다운 503) · `GET /:id`(DB 상세=오퍼·가격구간) · 수동 갱신 · `DELETE /:id`(견적 연결 시 409 `PART_IN_USE`) · `POST /parts/bulk-delete[/preview]`(필터 일치 전건 — 미리보기 hash+`DELETE N` 확인, 연결 부품만 보호) · `POST /parts/reset`(`confirm:'RESET_WITH_QUOTES'` — 관련 BOM 견적을 상태 무관 강제 삭제 후 전체 초기화). `admin-bom.ts`: 엔진 프록시+자동 인제스트 훅(검색 202→폴러 / 결과 GET→백업, idempotent).

**BOM 부품 유형별 자체 카탈로그 우선 조회** (`bom-local-catalog.ts`·`bom-quotes.ts`): sp-engine preflight가 내려준 정규 질의로 sp-node가 자체 카탈로그 후보만 조회하고(R/C=스펙 또는 exact MPN, connector=exact MPN — **공급사명이 아니라 엔진의 부품 유형 판정 기준**), 후보를 다시 `catalog-evaluate-batch`에 보내 `automatic_selected`인 행만 먼저 반영한다. Node는 값 완화나 호환성 판단을 중복하지 않으며, 미해결 component ID만 외부 공급사 검색으로 넘긴다. 이 단계는 외부 trace로 위장하지 않고 실행 `preflight` JSON에 `localCatalogTrace`로 따로 남고 후보 비교에는 항상 첫 단계·`API 0회`로 표시된다. 워크북 적재는 `parts:catalog -- --dry-run|--apply|--replace [--source yeonho|walsin-rlc]`, Walsin 가격은 초기화 전 1회 전수 조회한 스냅샷(`parts:catalog-prices -- --prepare [--resume]`)을 `--price-snapshot`으로 함께 적용한다. 제조사 사실 오퍼는 기술 사실·원본 추적용이라 공급사 패싯과 구매 오퍼 상세에서 숨기고, SamplePCB 문의 오퍼만 판매 채널로 노출한다(자체 재고는 계속 null).

**재능마켓** (`market-*`·`admin-market-*`): 전문가 등록·의뢰 CRUD·NDA·블라인드 입찰(가드 사슬: 승인→자기 금지→targeted→system×individual 403→lazy 마감→unique)·계약 checkout·납품·검수·정산 — 상세 [MARKET_FLOW](../../docs/MARKET_FLOW.md) §5·§6.

**AI** (`ai.ts`·`rnd-ai.ts`): `POST /api/ai/:useCase/run`→jobId·`GET /api/ai/jobs/:id` 폴링. LLM 유스케이스 = `market.request-diagram`·`-structurize`·`-roc`·`-postings` + rnd 2종(`rnd.file-classify`·`rnd.pcb-request-document`). spec→SVG 렌더는 LLM 아닌 `@sp/utils` 결정적 렌더러. 특수 경로: `…/preanalyze-questions`(선분석 v2 `understood`)·`…/run-with-attachments`.

**관리자 기타**: 견적 가격 확정·회원·주문(선형 전이·force-status·엑셀·notify-config 게이트)·설정(사업자·거버가격·AI 연동+샘플 테스트·**BOM 견적 탭** — 운송료·관리비·환율 방식·안전계수·검색 한도(엔진 `/capabilities` 상한과 min 표시)·최근 10개 실행 지표·[지금 갱신])·SEO·슬라이드.

## Data [coverage: high — 8 sources]

**Prisma (sp-node 소유, `sp_` 접두)** — 그누보드와 **같은 DB(samplepcb) 공유**. 상태값 String+리터럴 유니온(enum 미사용), mbId FK 금지 조인 키:

- **`sp_quote`**(specHash·autoPrice null=rfq·priceVersion·+72h) / **`sp_order_spec`**(주문 실체, ctId 파생 조인·specJson·finalPrice) / **`sp_file`**(폴리모픽 — refType에 `sp_bom_quote` 포함) / **`sp_member_profile`**(mb_1~15 승격+legacyJson) / **`sp_order_biz_info`** / **`sp_review`**(uuidV5 재귀속·legacyIsId 멱등)
- **`sp_bom_quote`** — mbId·status·contentHash·engineJobId·**activeAnalysisRunId/activeSupplierSearchRunId(unique 포인터)**·buildStatus·setQty/spareQty·**예상 스냅샷**(itemsTotal/shipping/management/finalTotal/usdKrwRateUsed/`exchangeRateSnapshot`/uncostedCount)·enrichStatus/enrichedAt·adminMemo(비노출)/answerNote·confirmed*
- **분석 정본 3종(append-only)** — `sp_bom_analysis_run`(engine·schemaVersion·parserVersion·summary/headers/failures) / `…_sheet`(시트별 payload·status) / `…_component`(엔진 `ComponentRecord` 원본 payload 박제+정렬·조인용 안정 열만 승격 — 엔진 신규 필드가 표시 계층보다 먼저 보존됨)
- **검색 실행 원장 4종** — `sp_bom_supplier_search_run`(analysisRun+옵션·preflight·`resultSummary` 실호출/캐시/시간·catalogIngestRunId) / **`sp_bom_supplier_result_artifact`**(완료 원문 gzip `LongBlob`+checksum·attempts/nextAttemptAt/leaseUntil — 인메모리 잡 소실 후 DB·ES·partId 재개) / **`sp_bom_supplier_search_trace`**(실행×componentId 1행 — 실제 검색어·fallback provenance, 500자 제한) / **`sp_bom_supplier_daily_usage`**(mbId+KST dayKey unique — 인메모리 카운터 대체, 조건부 원자 증가)
- **`sp_bom_quote_item`** — rowIdx(표시 순서)·analysisComponentId(추출 정본 연결)·included·bomQty·**orderQty(박제 수량=단일 진실: max(BOM×(세트+예비), MOQ)→주문배수 올림)**·matchStatus·matchEvidence(엔진 판정 스냅샷)·**searchRequirements(행별 사용자 보완 조건)**·recommended/selectedCandidateKey·selectionSource·partId(느슨한 참조)·**selectedOffer Json(오퍼 스냅샷 박제·pinned)**·lineTotalKrw·sourceRow/Sheet
- **`sp_bom_quote_candidate`** — quoteItemId(안정 키)+candidateKey unique, 엔진 후보의 견적 문맥 스냅샷(technicalRank·selectionMode·safety·autoEligible·payload), 행당 10개 방어 상한 / **`sp_bom_quote_selection_event`** — 명시 선택만 누적 / **`sp_bom_quote_sheet`** — 시트 selected 스냅샷
- **`sp_part`**(upsert 키 mpnNorm+manufacturerNorm·specsJson/specsSi·specConflicts·imageUrl·indexedAt·**factsFingerprint/indexFingerprint**) / **`sp_part_offer`**(supplier는 행 값·rawJson 감사·**contentFingerprint**, `offer_kind`=`supplier_offer|manufacturer_catalog`는 rawJson 파생 — `parts-offer-kind.ts`) / **`sp_part_price_break`**(replace-all) / **`sp_part_index_queue`**(색인 실패 재시도) / **`sp_part_ingest_run`**(fingerprint unique+policyVersion·leaseUntil — 인제스트 중복 수렴 원장)
- **`sp_market_*` 6종** — expert·project(AI 산출물 5필드+provenance)·bid·nda_sign·settings·contract(projectId unique·contractKey=io_id·requestSnapshot)
- **`sp_seo`**(scope+refKey unique) / **`sp_config`**(KV — gerber_price_mode·ai_*·bom_quote 설정·bom_quote_exchange_rate_usd 캐시) / **`sp_ai_usecase`**(enabled·model·promptTemplate, lazy 생성)

**g5 접근 카탈로그**(`lib/g5-db.ts`) — 함수·컬럼 단위 명시, 민감 컬럼 SELECT 배제, Prisma 비편입: ① 담기 4종 · ⑤⑧ member/config read · ⑥⑦⑨~⑯ 견적·회원·주문 관리 · ⑰ PCB 제작 8단계(od_status 재사용) · ⑱ 사업자정보 · ⑲ 마켓 계약 결제 · ⑳ g5_shop_banner 메인 슬라이드.

**환경변수**([.env.example](../../samplepcb-web-mono-app/apps/api/.env.example)): PORT/HOST·JWT_SECRET·DATABASE_URL·G5_DATABASE_URL·LEGACY_DATABASE_URL·G5_DATA_PATH·SPCB_BRIDGE_URL·SMTP_*·ALIMTALK_*·WEB_BASE_URL·FILE_SERVER_URL/FILE_SERVICE_TYPE·AI_BASE_URL/AI_API_KEY/AI_ATTACHMENT_VISION_MODEL·`ES_NODE_URL`·**`PART_INGEST_DB_CONCURRENCY`(1~8, 기본 production 2·그 외 4)**·`BOM_ENGINE_URL`/`BOM_ENGINE_TIMEOUT_MS`·`KOREAEXIM_API_KEY`(응답/DB 미저장).

## Key Decisions [coverage: high — 12 sources]

- **2026-07-26 — 자체(SamplePCB) 카탈로그는 부품 유형 기준 선조회 + "문의 견적"으로 분리**: 제조사 워크북은 `offer_kind='manufacturer_catalog'`+`catalogOnly=true`로 실구매 오퍼와 분리하고, 부품마다 제조사 사실 오퍼(기술 정본·원본 추적)와 `samplepcb` 판매 오퍼(유일한 노출 채널)를 함께 저장한다. 가격·재고가 없으므로 가상 구매 오퍼를 만들지 않고 `catalog_selected`+`catalog_inquiry`로 **부품 identity만 선정**(합계 미반영). 선조회 기준은 공급사명이 아니라 엔진의 part_type이라 새 커넥터 원장이 와도 같은 경로를 탄다. Walsin 가격은 런타임 갱신이 아니라 초기화 전 1회 전수 조회한 Git 전달 스냅샷.
- **2026-07-24 — 대량 삭제는 트랜잭션이 아니라 가드 문장 청크**: 후보 스냅샷이 견적당 수천 행(실측 `sp_bom_quote_candidate` 97,985행/1.73GB)이라 5초 인터랙티브 트랜잭션이 P2028로 전멸했다. 20건 청크의 `deleteMany({id,mbId,status})` autocommit으로 전환 — status 가드가 WHERE에 있어 draft→requested 경쟁에 안전하고 중단돼도 진행분이 남는다. 인프라 레버(buffer pool 16M→1G)는 별도 [DB_TUNING](../../docs/DB_TUNING.md), 후보 payload 다이어트는 미착수.
- **2026-07-21~23 — 인메모리 소실은 "영속 원장"으로 구조 해소**: 인제스트 중복은 파일 해시가 아닌 **실제 공급사 product/offer+정책 버전 fingerprint**(`sp_part_ingest_run`)로 재시작·다중 인스턴스에서도 한 번으로 수렴, 공급사 결과 원문은 gzip 아티팩트로 먼저 보존하고 30초 워커가 무인 복구, 일일 검색 한도는 DB 원장으로 이동. 증분 파생물도 fingerprint 기반(정본이 바뀐 부품만 facts·ES 재계산).
- **2026-07-20~21 — 기술·조달 판단의 단일 소유권은 sp-engine**: 후보 관계·선택 자격·기술 순위·사전 선정과 구매 적합/자동추천은 모두 엔진이 결정하고, sp-node는 정책 버전·identity/evidence/offer key·수량·금액 불변식만 검증해 저장한다(재정렬·자체 추론 금지, 계약 누락은 fail-closed). 무호출 재평가는 50컴포넌트 청크+서킷브레이커, 실패 행은 예외 대신 **stale 축퇴**(선택 보존·orderQty만 재도장)라 PATCH는 엔진이 죽어도 항상 200. 이 경계는 [AGENTS.md](../../AGENTS.md) "BOM 역할 경계"로 승격됐다.
- **2026-07-20 — 엔진 분석은 append-only 영속 정본**: 파싱 결과 전체를 `prepare`가 run/sheet/component로 박제하고 build는 원본 잡을 다시 읽지 않는다. 관계 키는 영속 ID(componentId·quoteItemId)이고 `rowIdx`는 표시 순서일 뿐 — BOM 비교도 잡 생존과 분리된 quoteId 기반 DB 읽기.
- **2026-07-19~20 — BOM 견적은 스냅샷 박제+서버 재계산+RFQ 모델**: 합계는 항상 서버가 스냅샷에서 재계산(클라 금액 불신), 확정가는 관리자 confirmed*가 정본. xpse(sp_bom_document, 별도 DB) 브릿지 안 함. "공급사 검색" 개념은 고객 비노출(조용한 자동 보강 — enrichStatus 상태기계+게으른 치유). 환율은 RFQ 시점 동결. sp-vue에 일반 회원 라우트 그룹 신설("sp-vue=관리자 전용" 전제 공식 변경).
- **2026-07-18~19 — 카탈로그는 DB=진실원본·ES=파생물, 단위 지능은 TS 코드에**: 색인·검색이 같은 파서(`@sp/utils spec-units.ts`, 골든 74케이스=명세)를 쓰고 ES 애널라이저는 기본만. 스펙 검색 2트랙(SI double range ±0.1% + 관행 표기 specVariants prefix), 모호성은 should 가산점만. **부품 정본=f(전체 실공급사 오퍼)**(`resolvePartFacts` — 0.5% 게이트+실충돌은 다수결→공급사 신뢰순위→최신)+자체 `samplepcb` 파생 오퍼(BOM 후보에서 제외=순환 방지).
- **2026-07-16~17 — 위저드 v2 = AI-우선 4스텝, 잡·엔진은 인메모리 전제**: 질문 뱅크 80문항은 계약 데이터, 모든 프롬프트 앞에 고정 보안 정책, provenance는 서버가 jobId 재검증 후 해시 저장. apps/rnd(5177) 신설로 rnd.* 유스케이스 분리.
- **2026-07-15 — spec JSON이 피벗, 렌더는 결정적**: DiagramSpec→SVG를 `@sp/utils` 결정적 렌더러로(서버가 저장 직전 재생성). LLM 산출은 실패 대신 복구(zod `.catch`+normalize).
- **2026-07-08~13 — AI는 범용 유스케이스 계층 / 마켓 결제=영카트 재사용**(앵커 상품+io_id=contractKey), paid 승격은 cron 없는 lazy write-back·7일 자동확정도 조회 시점 스윕 / SEO는 sp_seo 신설+sp-php 테마 직접 SELECT.
- **2026-07-02~07 — 코어 비수정+스냅샷 모델+접근 카탈로그**: 주문 실체는 sp_order_spec, cart엔 스냅샷 행만(ct_price=0+io_price 기법). 가격은 서버 재계산만이 진실(실측 패리티 47케이스). 거버 가격모드는 엔진 "밖" 후처리, 제작 8단계는 od_status 재사용. 레거시 마이그레이션은 게이트+멱등.

## Gotchas [coverage: high — 10 sources]

- ⚠ **`prisma migrate reset`=그누보드 DB 전멸**, `migrate dev`도 금지(g5_* drift→전체 reset 요구). 변경은 추가 전용 migration.sql 수기+`migrate deploy`.
- ⚠ **아직 인메모리인 것**: AI 잡·**최초 파일 파싱 잡과 잡 소유 맵** — `prepare` 전에 재시작하면 "재업로드 안내"가 필요하다(prepare 이후 분석·검색은 DB에서 복구). 일일 검색 카운터는 2026-07-23에 DB로 이관됐다. AI 호출은 `stream:true` 필수(비스트림=undici ~300s 타임아웃), LLM HTML은 sandbox iframe(srcdoc), rocMd는 라인 파서(v-html 금지).
- ⚠ **BOM 경합·순서**: searching 동안 FE·PATCH 모두 잠가야 한다(자동저장이 보강 결과를 덮는 사고). done 뒤 `catalog-match` 재호출 금지 — 엔진의 검토/충돌 판정을 카탈로그 매칭이 덮어쓴다. 대형 후보 저장은 **20건 단위 배치**(443건 단일 createMany가 MariaDB 패킷 한도로 연결 절단 실측). 오퍼 키는 v2(`ok2:`) — v1은 `P1.00K`/`P10.0K`를 같은 키로 축약하는 결함이 있어 구두점을 보존한다.
- ⚠ **카탈로그 삭제 3경로의 계약이 다르다**: 단건=견적 연결 시 409, 필터 전건=연결 부품만 보호, 전체 초기화=`RESET_WITH_QUOTES` 리터럴로 **관련 BOM 견적까지 상태 무관 강제 삭제**. 어떤 경로도 견적 partId를 임의 해제하지 않는다. samplepcb 파생 오퍼·집계는 실공급사만(이중 계산 방지), 제조사 카탈로그 원천은 offerCount·패싯에서 제외. imageUrl은 기존 적재분 백필 불가. 통합 테스트는 `PARTS_IT=1` 옵트인.
- ⚠ **제조사 별칭 추가는 소급되지 않는다** — `manufacturer-alias.ts`는 이후 인제스트만 정규 키로 모으므로 기존 행은 같은 품번이 둘로 보인다. 정리는 `parts:merge-mfr`(**되돌릴 수 없음** — 백업+dry-run 필수, manifest로 중간 실패 재개). DB 전반은 여전히 갈라져 있다(`Vishay` 28갈래·`Murata` 5갈래). 워크북 적재의 `--price-snapshot`+`--rollback` 조합은 금지(외부 오퍼를 제거하는 계약이 아님) — 되돌리려면 카탈로그 초기화나 DB 백업 복원.
- ⚠ **환율**: 수출입은행 result 코드(2=형식·3=인증·4=일일 한도)를 "고시 없음"으로 오진 금지, 실패 시 캐시 삭제 금지, 역탐색은 15초 예산. RFQ 후엔 동결이라 갱신이 기존 견적 금액을 바꾸지 않는 게 정상.
- ⚠ **이관 specJson `_legacy` 메타**(내부 id·PII) — spec 직렬화 라우트는 strip 필수(500 전례). / **mb_id ≤20자 가정 금지**(이메일 아이디 29자). / 만료 견적 정리 배치는 `priceVersion='legacy-migration'` 제외 필수.
- **마켓 paid 판정은 od 헤더가 아니라 라인**('부분취소'는 행 단위) — ct_status∈PAID ∧ io_id==contractKey ∧ io_price==amount. 계약 취소 시 카트행·옵션행 정리 필수. E2E od_id는 2^53 미만 대역(mysql2 정밀도).
- **`differentDesign` 부재→조용한 rfq 강등** / 가격표 스냅샷 드리프트는 `pricing:sync`→버전 bump→`pricing:capture`→test 절차 필수.
- **정합 3중**: 회원·서비스 JWT 모두 `JWT_SECRET` HS256(불일치=브리지 401) · 로컬 메일=Mailpit 25번 · AI 연결은 `.env`가 관리자 저장값보다 우선. 파일 삭제 API는 무인증 GET(pathToken 유출 주의). BOM 견적 접수 관리자 알림은 미구현(후속).

## Sources [coverage: high — 21 files]

- [AGENTS.md (루트)](../../AGENTS.md) — 호칭(sp-engine 추가)·**BOM 역할 경계**·nginx 라우팅·인증 브리지 단일 설명원본
- [AGENTS.md (모노레포)](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·접근 카탈로그 규율
- [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 환경변수 전체(ES·엔진·환율·인제스트 동시성)
- [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — sp_* 전 모델(+bom_quote 4종·분석 3종·검색 원장 4종·part 5종)
- [BOM_QUOTE](../../docs/BOM_QUOTE.md) — 고객 스마트 BOM 견적 정본(영속 분석·조달 판단 투영·자동 보강·검증 기록)
- [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) — 부품 카탈로그 정본(2트랙·유형별 로컬 우선 조회·인제스트 수렴·운영 절차)
- [walsin/README](../../samplepcb-web-mono-app/apps/api/catalog-migrations/walsin/README.md) — Walsin R/C 2,628 적재·가격 사전 스냅샷·제조사 키 병합
- [yeonho-connectors/README](../../samplepcb-web-mono-app/apps/api/catalog-migrations/yeonho-connectors-2026-07-17/README.md) — 연호 커넥터 Rev2 1,606 교체(`--replace`) 계약
- [DB_TUNING](../../docs/DB_TUNING.md) — InnoDB buffer pool 실측·운영 배포 체크리스트
- [MARKET_FLOW](../../docs/MARKET_FLOW.md) — 재능마켓 매칭→계약·결제·검수·정산 단일 설명원본
- [AI_DIAGRAM](../../docs/AI_DIAGRAM.md) — AI 유스케이스 계층·인터뷰 파이프라인·선분석·첨부 분석·provenance
- [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) — 가격모드(order/supply)·sp_config
- [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md) — 마이그레이션 게이트·증분 sync·컷오버 런북
- [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md) — sp_seo 설계 정본
- [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) — 담기 프로세스·코어 무수정 기법·g5 카탈로그
- [pricing-engine-parity](../../docs/pricing-engine-parity.md) — 가격표 동기화·differentDesign
- [samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md) — 레거시 가격 API 실측
- [DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 택배 연동 조사(미결정)
- [order-notify-gating](../../docs/order-notify-gating.md) — 알림 체크박스 게이트
- [review-naming](../../docs/review-naming.md) — sp_review 노출·명칭
- [LOCAL_MAIL_TESTING](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·발송 조건·트러블슈팅
