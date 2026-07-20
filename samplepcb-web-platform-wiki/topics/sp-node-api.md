---
topic: sp-node-api
last_compiled: 2026-07-20
sources_count: 18
status: active
---

# sp-node-api

## Purpose [coverage: high — 9 sources]

**sp-node** = Fastify 5 API 서버 (`samplepcb-web-mono-app/apps/api`, nginx `/api` 프록시, 기본 127.0.0.1:3333). 동적 PCB 주문(거버 업로드) 백엔드로 출발해 관리자 백엔드 전반 → 재능마켓 거래 완결·AI 유스케이스·레거시 마이그레이션까지 확장됐고, **2026-07-17~20에 부품 카탈로그(sp_part*+ES)·sp-engine 게이트웨이·고객 스마트 BOM 견적(sp_bom_quote*)이 추가**됐다. 핵심 역할:

- **거버 PCB 담기 API** (`/api/pcb-projects`): 검증 → 견적 → 파일서버 업로드 대행 → `sp_*` 저장 → `g5_shop_cart` 스냅샷 INSERT · **가격 엔진**(`src/pricing/engine.ts` 레거시 패리티 + `gerber-price-mode.ts` 공급가 ×1.1)
- **고객 스마트 BOM 견적** (`routes/bom.ts`·`bom-quotes.ts`·`admin-bom-quotes.ts`): 업로드→시트 선택→파싱·카탈로그 매칭→조용한 자동 보강(공급사 검색)→검토(1s 자동저장)→**견적요청(RFQ 1차 종점)**→관리자 확정·회신 — 정본 [BOM_QUOTE](../../docs/BOM_QUOTE.md)
- **부품 카탈로그** (`admin-parts.ts`+`lib/parts-*`): sp-engine 공급사 검색 결과를 자동 인제스트(DB upsert+ES 색인), 단위·표기 다양성을 흡수하는 상세 검색 — 정본 [PARTS_SEARCH](../../docs/PARTS_SEARCH.md)
- **sp-engine 게이트웨이** (`lib/engine-client.ts`+`admin-bom.ts`): Python BOM 추출·공급사 검색 엔진(:8400, 사설망 무인증)에 HTTP async job 프록시 — 인증·소유 검증은 sp-node 담당
- **재능마켓 백엔드** (`market-*.ts`·`admin-market-*.ts`): 승인·블라인드 입찰·채택→계약·영카트 재사용 결제·검수(7일 자동확정)·정산 — 정본 [MARKET_FLOW](../../docs/MARKET_FLOW.md)
- **AI 유스케이스 실행 계층** (`routes/ai.ts`·`rnd-ai.ts`+`lib/ai/`): `sp_config`(연결)+`sp_ai_usecase`(케이스 설정)+`POST /api/ai/:useCase/run` 비동기 잡. 인터뷰 파이프라인(structurize·roc·postings)+선분석 v2+첨부 multipart 분석 — 정본 [AI_DIAGRAM](../../docs/AI_DIAGRAM.md)
- **관리자 API** (`/api/admin/*`, `requireAdmin`): 견적·회원·주문(orderlist 풀 패리티)·설정(사업자·거버가격·AI·BOM 견적)·SEO·슬라이드·마켓 심사/계약/정산·부품·BOM
- **레거시 DB 마이그레이션** (`src/scripts/migrate/`): P1~P3 verify 그린 — 정본 [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md)
- **g5 접근 카탈로그** (`src/lib/g5-db.ts`): g5_* 접근을 함수·컬럼 단위로 규율 — 현재 ①~⑳(⑳=g5_shop_banner 슬라이드)

소비 주체: 거버 뷰어(React), sp-vue(`/app` — 관리자 + **일반 회원 `/app/bom`** 신설), sp-market 고객 SPA(`/market`), sp-rnd 실험 앱(`/rnd`, 2026-07-17 신설), sp-php 커스텀 페이지.

## Architecture [coverage: high — 8 sources]

- **스택**: TypeScript / Node 22, Fastify 5 + `fastify-type-provider-zod`(Zod 단일 진실원본), `@fastify/multipart`(거버 100MB·BOM 50MB), `@fastify/jwt`, Prisma+mysql2, `exceljs`·`nodemailer`. pnpm+Turborepo `apps/api`(형제: web 5173·market 5176·**rnd 5177**).
- **타입 강성 "매우 강함"**: strict+noUncheckedIndexedAccess+exactOptionalPropertyTypes, `no-explicit-any`=error. 흐름 DB → Fastify(zod) → `@sp/api-contract` → Vue.
- **계약**: 스키마는 반드시 `@sp/api-contract`(Zod) — `PcbProjectPayload`·`JwtClaims`·관리 계약군·`market.ts`(MARKET_* 코드·라벨 정본, 3앱 공유)·`AI_USECASES`·`AI_INTERVIEW_QUESTIONS`(질문 뱅크 80문항=데이터)·parts(`PartSearchQuery`)·BOM 견적 계약.
- **디렉토리** (`src/`): `server.ts`(prefix `/api`) · `routes/`(pcb-projects·pcb-thumbs·me·health / **bom·bom-quotes** / market 5+admin-market 4 / ai·**rnd-ai** / admin-{pcb-projects,members,orders,settings,seo,slides,**parts,bom,bom-quotes**}) · `plugins/auth.ts`(JWT 검증만+`requireAdmin`) · `pricing/`(engine 불변+가격모드 후처리+골든 47) · **`es/`**(client·sp-parts-index — 매핑·부트스트랩) · `lib/`(g5-db 카탈로그 · market*·market-snapshot · **bom-quote**(전이·계산)·**bom-engine-jobs**·**engine-client** · **parts-ingest/parts-es/parts-facts/manufacturer-alias/supplier-packaging** · **exchange-rate**(수출입은행) · `ai/`(ollama·usecases·jobs·runner·provenance·archive·attachment-extractor·admin-samples) · sp-config·file-server·php-bridge·mailer·alimtalk·banner-image·legacy-db 등) · `scripts/`(sync-pricing·migrate/·seed-market-*·**parts-reindex·parts-refacts**·probe-rnd-*)
- **비동기 잡 2계열**: ① AI 잡(인메모리, run→jobId→5s 폴링, 동일 입력 1h TTL 캐시, `stream:true` 필수) ② 엔진 잡(sp-engine 인메모리 — 파싱·공급사 검색, 202→서버측 폴러 5s·최대 10분+결과 GET 백업 훅+**게으른 치유**). 둘 다 재시작 시 소실 전제로 설계(DB 스냅샷·재업로드 복구).
- **BOM 견적 생명주기**: `buildStatus`(parsing→selecting→building→ready|failed)와 `enrichStatus`(idle|searching|done|failed)가 **서버 영속 단일 진실** — build가 items와 searching을 한 커밋으로, 반영이 매칭 라인과 done을 한 저장으로 커밋(상태·데이터 원자성). searching 견적의 상세 GET이 엔진 상태를 확인해 스스로 치유.

## Talks To [coverage: high — 8 sources]

| 상대 | 방향/방식 |
|---|---|
| 거버 뷰어 / sp-vue / sp-market / sp-rnd | Bearer JWT 수신 — `/api/pcb-projects`·`/api/bom`·`/api/admin/*`·`/api/market*`·`/api/ai/*`·`/api/rnd/*` |
| 그누보드 인증 브리지 `spcb/api/me.php` | 직접 통신 없음 — HS256 JWT(TTL 10분, `mbId`·`cartId`·`isAdmin`) 검증만. `JWT_SECRET`=`spcb/lib/secret.php` 수동 동기화 |
| PHP 알림 브리지 `order-notify.php` | 주문 전이(입금/배송) 시 서비스 JWT(`svc:'sp-node'`) POST — 레거시 메일 템플릿 재사용, 실패는 삼킴 |
| **sp-engine (Python, `BOM_ENGINE_URL` 기본 :8400)** | BOM 추출·공급사 검색(Mouser/DigiKey/UniKeyIC) HTTP 프록시 — 엔진 무인증·사설망, 인증·소유·한도는 sp-node. 타임아웃 `BOM_ENGINE_TIMEOUT_MS`(120s) |
| **Elasticsearch (`ES_NODE_URL` 기본 :9200)** | sp-parts 색인·검색 — xpse 공유 단일 노드, `sp-` prefix만 사용. ES 다운이어도 앱은 뜸(검색 503·색인 큐 적재→기동 시 드레인) |
| **한국수출입은행 Open API** | USD→KRW 자동 환율(`KOREAEXIM_API_KEY`) — 서버 시작+매일 12:10 KST, `sp_config` 캐시, 전체 예산 15초 역탐색 |
| Ollama (`AI_BASE_URL`) | AI 실행 — 기본 로컬 :11434, 운영 ollama.com+키. 우선순위 `.env` > 관리자 저장값 > 기본. 비전 모델 `AI_ATTACHMENT_VISION_MODEL`(기본 qwen3.5:cloud) |
| SMTP / 알림톡(iwinv) | 견적 메일+마켓 메일 8종 직송(로컬은 Mailpit 25번) / `ALIMTALK_ENABLED=false` 기본 |
| samplepcb DB (공유) | Prisma로 `sp_*` 소유(`DATABASE_URL`) / g5_*는 mysql2 카탈로그 ①~⑳(`G5_DATABASE_URL`) / 레거시 운영 DB는 읽기 전용(`LEGACY_DATABASE_URL`) |
| file.samplepcb.kr | 서버-to-서버 업로드·삭제 대행, pathToken 미노출. serviceType: `gerber`·`market`·**`bom`(원본 BOM 파일)** |
| sp-php 디스크/nginx | 배너 이미지 `G5_DATA_PATH/banner/{bn_id}` 직접 기록 / `/api/`→3333 |

sp-php가 sp_*를 직접 SELECT하는 역방향(sp_review·sp_seo)도 정착 — "관리=sp-vue/sp-node, 소비=sp-php 같은 DB" 패턴.

## API Surface [coverage: high — 7 sources]

**거버 담기·견적** (`pcb-projects.ts`): `POST /api/pcb-projects`(담기 — 재계산→업로드→tx→cart INSERT) · `GET`(목록, lazy reconcile) · `GET /cart-items` · `POST /order`(배치 담기+ct_select→orderform 직행) · `PATCH /:id`(수량=서버 재견적) · `DELETE /:id`(소프트→하드).

**고객 BOM 견적** (`/api/bom`, authenticate — [BOM_QUOTE](../../docs/BOM_QUOTE.md)):

| 경로 | 역할 |
|---|---|
| `POST /quotes`(multipart) · `GET /quotes` · `GET/PATCH /quotes/:id` | 업로드→견적+엔진 잡 · 내 목록 · 상세/자동저장(PATCH는 draft 한정, items **replace-all**) |
| `POST /quotes/:id/prepare` → `/build {sheetIndexes}` | 시트 분석 영속 → 선택 시트만 라인+카탈로그 매칭(최대 2,000라인) |
| `GET /quotes/:id/items/:rowIdx/candidates` · `POST …/selection` | 박제된 후보 비교(현재 수량 가격·이력) · 고객 명시 선택(후보/오퍼 키만 받아 서버 재계산) |
| `/catalog-match` · `/request` · `/cancel` · `DELETE` | 재매칭(pinned 보존) · RFQ(재계산·동결) · 취소 · draft 하드 삭제 |
| `GET /jobs/:id[/result]` · `POST /jobs/:id/supplier-search[/preflight]` | 엔진 잡 프록시 — 소유 회원만(타인 404 은닉), 일일 한도 429, max_calls는 sp_config 클램프 |
| `GET /parts-search` · `GET /parts/:id` | 교체·추가 모달용 카탈로그 검색(admin-parts 쿼리 빌더 재사용) |

관리자 `admin-bom-quotes.ts`: 목록(기본 draft 제외)·상세·`PATCH`(전이 검증+확정가 confirmed*+메모)·원본 스트리밍·후보/이력 읽기 전용. 상태 전이 `draft→requested→reviewing→answered→closed`(+canceled)는 서버 검증, requested 이후 고객 수정 409.

**부품 카탈로그** (`admin-parts.ts`): `GET /api/admin/parts/search`(ES 다중해석 쿼리 — Track A SI range ±0.1% + Track B specVariants prefix + should-only 가산점, 패싯·정렬, ES 다운 503) · `GET /:id`(DB 상세=오퍼·가격구간) · 수동 갱신 · `DELETE :id`·`POST /parts/reset`(`confirm:'RESET'`). `admin-bom.ts`: 엔진 프록시+**자동 인제스트 훅**(검색 202→폴러 / 결과 GET→백업, idempotent).

**재능마켓** (`market-*`·`admin-market-*`): 전문가 등록·의뢰 CRUD·NDA·블라인드 입찰(가드 사슬: 승인→자기 금지→targeted→system×individual 403→lazy 마감→unique)·계약 checkout·납품·검수·정산 — 상세 [MARKET_FLOW](../../docs/MARKET_FLOW.md) §5·§6.

**AI** (`ai.ts`·`rnd-ai.ts`): `POST /api/ai/:useCase/run`→jobId·`GET /api/ai/jobs/:id` 폴링. LLM 유스케이스 = `market.request-diagram`(전자 분야 폴백 단발)·`-structurize`(답변→DiagramSpec JSON)·`-roc`·`-postings` + **rnd 2종**(`rnd.file-classify`·`rnd.pcb-request-document`). spec→SVG 렌더는 LLM 아닌 `@sp/utils` 결정적 렌더러(잡 없음, 서버가 저장 전 재생성). 특수 경로: `…/preanalyze-questions`(선분석 v2 `understood`)·`…/run-with-attachments`(첨부 제한 추출 multipart).

**관리자 기타**: 견적 가격 확정·회원·주문(선형 전이·force-status·엑셀·notify-config 게이트)·설정(사업자·거버가격·AI 연동+샘플 테스트·**BOM 견적 탭** — 운송료·관리비·환율 방식·안전계수·검색 한도·[지금 갱신])·SEO·슬라이드.

## Data [coverage: high — 7 sources]

**Prisma (sp-node 소유, `sp_` 접두)** — 그누보드와 **같은 DB(samplepcb) 공유**. 상태값 String+리터럴 유니온(enum 미사용), mbId FK 금지 조인 키(VarChar 191):

- **`sp_quote`**(specHash·autoPrice null=rfq·priceVersion·+72h) / **`sp_order_spec`**(주문 실체, ctId 파생 조인·specJson·finalPrice) / **`sp_file`**(폴리모픽 — refType에 `sp_bom_quote` 추가) / **`sp_member_profile`**(mb_1~15 승격+legacyJson) / **`sp_order_biz_info`** / **`sp_review`**(uuidV5 재귀속·legacyIsId 멱등)
- **`sp_bom_quote`** — mbId·status·contentHash·engineJobId·buildStatus·setQty/spareQty·**예상 스냅샷**(itemsTotal/shipping/management/finalTotal/usdKrwRateUsed/`exchangeRateSnapshot`)·enrichStatus/enrichedAt·adminMemo(비노출)/answerNote·confirmed*
- **`sp_bom_quote_item`** — rowIdx·included·bomQty·**orderQty(박제 수량=단일 진실: max(BOM×(세트+예비), MOQ)→주문배수 올림)**·matchStatus·matchEvidence(엔진 판정 스냅샷)·recommended/selectedCandidateKey·selectionSource·partId(느슨한 참조)·**selectedOffer Json(오퍼 스냅샷 박제·pinned)**·lineTotalKrw·sourceRow/Sheet
- **`sp_bom_quote_candidate`** — 엔진 후보를 제조사+MPN 부품으로 묶은 견적 문맥 스냅샷(technicalRank·selectionMode·safety·payload) — 엔진 잡 소멸 후에도 고객·관리자가 동일 후보 비교 / **`sp_bom_quote_selection_event`** — 명시 선택만 누적(replace-all과 분리된 감사 이력) / **`sp_bom_quote_sheet`** — 시트 분석·selected 스냅샷
- **`sp_part`**(upsert 키 mpnNorm+manufacturerNorm·specsJson/specsSi·**specConflicts**·imageUrl·indexedAt) / **`sp_part_offer`**(supplier는 행 값 — 공급사 추가=스키마 무변경, rawJson 감사) / **`sp_part_price_break`**(replace-all) / **`sp_part_index_queue`**(색인 실패 재시도)
- **`sp_market_*` 6종** — expert·project(AI 산출물 5필드+`aiGenerationMeta` provenance+`interviewAnswersSharedAt`)·bid·nda_sign·settings·contract(projectId unique·fee/payout 스냅샷·contractKey=io_id·**requestSnapshot**(채택 시점 의뢰·AI 산출물·견적 박제))
- **`sp_seo`**(scope+refKey unique) / **`sp_config`**(KV — gerber_price_mode·ai_*·**bom_quote 설정·bom_quote_exchange_rate_usd 캐시**) / **`sp_ai_usecase`**(enabled·model·promptTemplate, lazy 생성)

**g5 접근 카탈로그**(`lib/g5-db.ts`) — 함수·컬럼 단위 명시, 민감 컬럼 SELECT 배제, Prisma 비편입: ① 담기 4종 · ⑤⑧ member/config read · ⑥⑦⑨~⑯ 견적·회원·주문 관리 · ⑰ PCB 제작 8단계(od_status 재사용·선형 전이) · ⑱ 사업자정보 · ⑲ 마켓 계약 결제(io_id=contractKey·paid 라인 검증) · **⑳ g5_shop_banner 메인 슬라이드**.

**환경변수**([.env.example](../../samplepcb-web-mono-app/apps/api/.env.example)): 기존(PORT/HOST·JWT_SECRET·DATABASE_URL·G5_DATABASE_URL·LEGACY_DATABASE_URL·G5_DATA_PATH·SPCB_BRIDGE_URL·SMTP_*·ALIMTALK_*·WEB_BASE_URL·FILE_SERVER_URL/FILE_SERVICE_TYPE·AI_BASE_URL/AI_API_KEY) + **신규: `AI_ATTACHMENT_VISION_MODEL`·`ES_NODE_URL`·`BOM_ENGINE_URL`/`BOM_ENGINE_TIMEOUT_MS`·`KOREAEXIM_API_KEY`**(응답/DB 미저장).

## Key Decisions [coverage: high — 10 sources]

- **2026-07-19~20 — BOM 견적은 스냅샷 박제+서버 재계산+RFQ 모델**: 합계는 항상 서버가 스냅샷에서 재계산(클라 금액 불신), 확정가는 관리자 confirmed*가 정본. xpse(sp_bom_document, 별도 DB) 브릿지 안 함 — sp-node 신규 소유. "공급사 검색" 개념은 고객 비노출(조용한 자동 보강 — 비용 게이트+enrichStatus 상태기계+게으른 치유). 하이브리드 자동 선정(`engine-hybrid-physical-v3`): 기술 순위(verified_exact→variant→spec_compatible)가 기본, 전부 검증+10%·500원 이상 절감일 때만 가격 후보. 환율은 RFQ 시점 동결(`exchangeRateSnapshot`). sp-vue에 일반 회원 라우트 그룹 신설("sp-vue=관리자 전용" 전제 공식 변경).
- **2026-07-18~19 — 카탈로그는 DB=진실원본·ES=파생물, 단위 지능은 TS 코드에**: 색인·검색이 같은 파서(`@sp/utils spec-units.ts`, 골든 74케이스=명세)를 쓰고 ES 애널라이저는 기본만. 스펙 검색 2트랙(SI double range ±0.1% + 관행 표기 specVariants prefix), 모호성은 should 가산점만(배타 필터 오승격 방지). **부품 정본=f(전체 오퍼)**(`resolvePartFacts` — 0.5% 게이트+실충돌은 다수결→공급사 신뢰순위→최신, specConflicts 기록)+자체 `samplepcb` 파생 오퍼(원천 1개 통째 복사, BOM 후보에서 제외=순환 방지). 인제스트는 idempotent(폴러+백업 훅 중복 안전).
- **2026-07-16~17 — 위저드 v2 = AI-우선 4스텝, 잡·엔진은 인메모리 전제**: 분야→설명·자료(AI 동의 기본 on)→AI 인터뷰(선분석 v2 `understood`·5개씩 최대 15문항)→검토·등록. 질문 뱅크 80문항은 계약 데이터. 모든 프롬프트 앞에 고정 보안 정책(고객 입력=자료), provenance는 서버가 jobId 재검증 후 해시 저장 — 불일치 시 "고객 수정본". apps/rnd(5177) 신설로 rnd.* 유스케이스 분리.
- **2026-07-15 — spec JSON이 피벗, 렌더는 결정적**: DiagramSpec→SVG를 LLM 호출에서 `@sp/utils` 결정적 렌더러로 교체(서버가 저장 직전 재생성 — 클라 HTML 불신). LLM 산출은 실패 대신 복구(zod `.catch`+normalize), 파손 spec 400.
- **2026-07-12~13 — AI는 범용 유스케이스 계층**: 라우트 공통(`/api/ai/:useCase/run`)+정책은 레지스트리 케이스별. 전체서비스 입찰 제한은 입찰만 403.
- **2026-07-08~10 — 마켓 결제=영카트 재사용(앵커 상품+io_id=contractKey), paid 승격=cron 없는 lazy write-back**(라인 검증·단방향 래칫)·7일 자동확정도 조회 시점 스윕 / SEO는 sp_seo 신설+sp-php 테마 직접 SELECT / 별점후기는 uuidV5 프로젝트 재귀속.
- **2026-07-05~07 — 거버 가격모드는 엔진 "밖" 후처리**(engine.ts 골든 고정 불변)·제작 8단계는 od_status 재사용 / 레거시 마이그레이션은 게이트+멱등(manifest 처분표·uuidV5 수렴·증분 diff sync).
- **2026-07-02~04 — 코어 비수정+스냅샷 모델+접근 카탈로그**: 주문 실체는 sp_order_spec, cart엔 스냅샷 행만(ct_price=0+io_price 기법). 가격은 서버 재계산만이 진실(실측 패리티 47케이스). g5_* 접근은 g5-db.ts 카탈로그로 규율. 알림은 PHP 브리지 재사용.

## Gotchas [coverage: high — 9 sources]

- ⚠ **`prisma migrate reset`=그누보드 DB 전멸**, `migrate dev`도 금지(g5_* drift→전체 reset 요구). 변경은 추가 전용 migration.sql 수기+`migrate deploy`.
- ⚠ **인메모리 3형제**: AI 잡·엔진 잡(engineJobId)·BOM 일일 검색 카운터 모두 단일 인스턴스 인메모리 — 재시작 시 소실(파싱 중 견적은 "재업로드 안내", 빌드 완료분은 DB라 무관). AI 호출은 `stream:true` 필수(비스트림=undici ~300s 타임아웃), LLM HTML은 sandbox iframe(srcdoc)+CSP만, rocMd는 라인 파서(v-html 금지).
- ⚠ **BOM replace-all 경합**: searching 동안 FE·PATCH 모두 잠가야 함(자동저장이 보강 결과를 덮는 사고 방지). done 뒤 `catalog-match` 재호출 금지 — 엔진의 검토/충돌 판정을 카탈로그 매칭이 덮어씀. 대형 후보 저장은 **20건 단위 배치**(443건 단일 createMany가 MariaDB 패킷 한도로 연결 절단 실측).
- ⚠ **카탈로그 리셋·삭제 시 견적 라인은 partId만 해제** — selectedOffer 스냅샷·합계는 보존(박제 원칙). samplepcb 파생 오퍼·집계는 실공급사만(이중 계산 방지). imageUrl은 기존 적재분 백필 불가(도입 전 rawJson에 없음). 통합 테스트는 `PARTS_IT=1` 옵트인(CI 자동 skip).
- ⚠ **환율**: 수출입은행 result 코드(2=형식·3=인증·4=일일 한도)를 "고시 없음"으로 오진 금지, 실패 시 캐시 삭제 금지, 역탐색은 15초 예산. RFQ 후엔 동결이라 갱신이 기존 견적 금액을 바꾸지 않는 게 정상.
- ⚠ **이관 specJson `_legacy` 메타**(내부 id·PII) — spec 직렬화 라우트는 strip 필수(500 전례). / **mb_id ≤20자 가정 금지**(이메일 아이디 29자, sp측 VarChar 191). / 만료 견적 정리 배치는 `priceVersion='legacy-migration'` 제외 필수.
- **마켓 paid 판정은 od 헤더가 아니라 라인**('부분취소'는 행 단위) — ct_status∈PAID ∧ io_id==contractKey ∧ io_price==amount. 계약 취소 시 카트행·옵션행 정리 필수. E2E od_id는 2^53 미만 대역(mysql2 정밀도). E2E 92항목에 LLM 실호출 없음(실생성 검증은 관리자 샘플 테스트).
- **`differentDesign` 부재→조용한 rfq 강등** / 가격표 스냅샷 드리프트는 `pricing:sync`→버전 bump→`pricing:capture`→test 절차 필수.
- **정합 3중**: 회원·서비스 JWT 모두 `JWT_SECRET` HS256(불일치=브리지 401) · 로컬 메일=Mailpit 25번 · AI 연결은 `.env`가 관리자 저장값보다 우선(env 있으면 화면 입력 잠김). 파일 삭제 API는 무인증 GET(pathToken 유출 주의). BOM 견적 접수 관리자 알림은 미구현(후속).

## Sources [coverage: high — 18 files]

- [AGENTS.md (루트)](../../AGENTS.md) — 호칭(sp-rnd 추가)·nginx 라우팅·인증 브리지 단일 설명원본
- [AGENTS.md (모노레포)](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·apps/rnd(5177)·접근 카탈로그 규율
- [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 환경변수 전체(ES·엔진·환율·비전 모델 신규)
- [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — sp_* 전 모델(+bom_quote 5종·part 4종)
- [BOM_QUOTE](../../docs/BOM_QUOTE.md) — 고객 스마트 BOM 견적 정본(스냅샷 박제·자동 보강·하이브리드 선정·검증 기록)
- [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) — 부품 카탈로그 정본(2트랙·ES 매핑·parts-facts·운영 절차)
- [MARKET_FLOW](../../docs/MARKET_FLOW.md) — 재능마켓 매칭→계약·결제·검수·정산 단일 설명원본(위저드 v2 반영)
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
