---
topic: api-contract
last_compiled: 2026-07-27
sources_count: 18
status: active
---

# api-contract

## Purpose [coverage: medium — 3 sources]

`@sp/api-contract`(위치: `samplepcb-web-mono-app/packages/api-contract`)는 **Zod 스키마 + 추론 타입 + 라우트 상수**를 담은 FE/BE 공통 계약 패키지다. sp-node(Fastify API)와 클라이언트(거버 뷰어, sp-php 견적관리 페이지, sp-vue 관리자·고객 BOM 화면, sp-market 재능마켓 SPA)가 공유하는 요청/응답의 **단일 진실원본(single source of truth)** 역할을 한다. AGENTS.md 규칙상 "API 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod)에 정의하고 FE/BE 양쪽이 그걸 import" 해야 한다. 스키마뿐 아니라 **도메인 코드 사전·한글 라벨**(재능마켓 `MARKET_*`/`MARKET_*_LABELS`, NDA 문구 원문, AI 인터뷰 질문 뱅크)의 정본이며, **sp-engine(Python) pydantic 출력의 TypeScript 미러**이기도 하다.

## Architecture [coverage: high — 8 sources]

- **빌드 없는 src 직접 노출**: `package.json`의 `main`/`types`/`exports` 모두 `./src/index.ts` — 소비자가 TypeScript 소스를 직접 import 한다. 스크립트는 `typecheck`·`lint`만 존재.
- **유일한 런타임 의존성은 `zod`**. devDeps 로 `@sp/config`(공유 tsconfig/eslint) 사용 — `strict` + `exactOptionalPropertyTypes` 등 "매우 강함" 타입 강성 기준을 따른다.
- 파일 구성 (`src/index.ts`가 16줄 배럴로 전부 re-export, 순서가 곧 도메인 계층):
  - `src/schemas/common.ts` — `ApiError`, `HealthResponse` · `auth.ts` — `Me`, `JwtClaims`
  - `src/schemas/pcb-project.ts` — 거버 주문/견적 계약
  - `src/schemas/admin.ts` / `members.ts` / `orders.ts` — 관리자 견적·회원·주문
  - `src/schemas/settings.ts`(사업자 정보 + **거버 가격 모드**) · `slides.ts` · `seo.ts`
  - `src/schemas/bom.ts` — **sp-engine BOM 추출·공급사 검색 프록시 미러**(365줄, 유일하게 snake_case)
  - `src/schemas/parts.ts` — **부품 카탈로그 검색·관리**(338줄)
  - `src/schemas/bom-quote.ts` — **고객 스마트 BOM 견적 전 생명주기**(1085줄, 2위 모듈)
  - `src/schemas/market.ts` — **재능마켓 전체 플로우**(1424줄, 최대 모듈)
  - `src/schemas/ai.ts` — AI 유스케이스 실행 계층 + R&D 파일분류/개발의뢰서 · `ai-interview-questions.ts` — 질문 뱅크
  - `src/routes.ts` — `apiRoutes` 상수 **27종** (`/api/health`~`/api/admin/market/settings`)
- 데이터 흐름에서의 위치: **DB(Prisma)·sp-engine(pydantic) → API(Fastify, `fastify-type-provider-zod`) → 계약(`@sp/api-contract`) → Vue(@tanstack/vue-query)** 가 타입으로 연결.

## Talks To [coverage: high — 7 sources]

- **sp-node (`apps/api`)**: `routes/pcb-projects.ts`·`me.ts`·`health.ts`, 관리자 라우트(`admin-*.ts`), **BOM/부품 6파일**(`bom.ts`·`bom-quotes.ts`·`admin-bom.ts`·`admin-bom-quotes.ts`·`admin-parts.ts`·`rnd-ai.ts`), 재능마켓 6파일, AI 라우트(`routes/ai.ts` + `lib/ai/` 레지스트리), `plugins/auth.ts`(`JwtClaims`)에서 import — Zod type-provider 로 요청 검증과 응답 타입에 사용.
- **sp-engine(`samplepcb-parts-engine`, Python)**: `bom.ts`가 엔진 pydantic 출력(`BomResult`·`BomSupplierResult`·`BomSupplierPlan`·`BomEngineCapabilities`)을 그대로 미러. 계약은 엔진을 호출하지 않고 **형태만 고정**한다.
- **`@sp/shared`**: `api-client.ts`(`ApiError`를 throw 가능한 Error 로 래핑, 회원/관리자 두 에러 봉투를 `ApiMemberError`로 정규화), `auth.ts`(`Me`), `queries.ts`(`apiRoutes` + 스키마).
- **sp-vue (`apps/web`)**: 관리자 `/app/admin`(견적·회원·주문·설정·슬라이드·SEO·마켓 + `AdminParts.vue`·`AdminBomQuotes.vue`)와 **회원 `/app/bom` 고객 화면**(`BomQuoteRow.vue`·`BomCandidateDrawer.vue`·`BomCompareModal.vue`·`BomPartSearchPanel.vue` 등 20+ 컴포넌트)이 최대 소비자.
- **sp-market (`apps/market`, `/market`)**: 의뢰 위저드(`MARKET_AREA_*`, `AI_INTERVIEW_QUESTIONS`), 전문가 등록, 블라인드 입찰, 계약 카드.
- **거버 뷰어(별도 repo `samplepcb_gerber`)**: `toProjectPayload.ts`가 `PcbProjectPayload` multipart `payload` 파트(JSON) 전송. **sp-php `/shop/quotes`**: `PcbProjectList*`·`PcbProjectOrder*` 소비.

## API Surface [coverage: high — 9 sources]

`src/index.ts`가 export 하는 것 (스키마마다 `z.infer` 타입 동반, `...Type` 접미):

**common / auth** — `ApiError { error, message }` · `HealthResponse` · `Me { mbId, mbNick, level, isAdmin }` · `JwtClaims = Me + { cartId?, iat, exp }`(`iat`/`exp` 필수, `cartId`는 영카트 장바구니 버킷 키로 과도기 optional — 마켓 checkout 은 필수).

**pcb-project** — `KNOWN_SPEC_KEYS`(거버 spec 키 39종) · `PcbProjectSpec`(39종 optional + `catchall`) · `PcbProjectPayload`(`flow: 'order'|'rfq'`) · `PcbProjectCreateResponse` · `PcbProjectListItem`(`quoteStatus`·`cartState`·서명 `thumbnailUrl`) · 장바구니/주문/수량수정/삭제 응답.

**admin / members / orders / settings / slides / seo** — 관리자 견적(`AdminQuote*`) · 회원(`AdminMember*`) · 주문(`AdminOrder*`, `AdminNotifyConfigResponse`) · `BusinessInfo*`+`GerberPriceMode('order'|'supply')` · `Slide*`(영카트 `g5_shop_banner` 공유) · `Seo*`(`sp_seo` 오버라이드).

**bom** (sp-engine 프록시 미러 — **유일하게 snake_case**)
- 추출 계약: `BomEvidence`·`BomFieldState`·`BomAttribute`·`BomRowShape`·`BomComponent`·`BomSheet`·`BomHeader`·`BomFailure`·`BomResult(Summary)` — 엔진 G-shape 전체.
- 공급사 검색: `BomSupplierOptions`(`max_calls` 1~3000, `cache_only`×`reset_cache` 상호배제 `superRefine`) · `BomSupplierPlan`/`Preflight`(호출 예산 사전 산정) · `BomSupplierOffer`/`SearchComponent`/`Result` · `BomJobView`(잡 폴링) · `BomEngineCapabilities`(공급사 설정·캐시 모드 진단).

**parts** (부품 카탈로그 — DB 저장 + ES 색인 검색)
- `PartOfferKind = 'supplier_offer' | 'manufacturer_catalog'` · `PartOfferView`(`derivedFrom` = samplepcb 파생 구매 조건의 원천) · `PartHit`(`specsSi` SI 정준 스펙, `hasSpecConflict`, `hasCatalogInquiryOffer`) · `PartDetail`+`PartSpecConflictGroup`.
- 검색: `PartSearchQuery`(자유 텍스트 `q` + 패싯 클릭 전용 구조화 필터) · `PartSearchResponse`+`PartSearchFacets`.
- 고객 단일 검색: `BomPartSearchQuery`/`BomPartHit`/`BomPartSearchResponse`(서버가 필요수량·환율 스냅샷으로 `PartAppliedOffer` 대표 구매 조건 첨부) · `BomPartSearchSupplementBody`/`Response`(로컬에 정확 규격이 없을 때만 **POST 로 분리한** 유료 공급사 보강).
- 관리: `PartRefreshResponse`(수동 갱신) · `PartDeleteResponse` · `PartsResetBody`(`confirm: 'RESET_WITH_QUOTES'` 리터럴) · `PartBulkDeleteFilter`/`PreviewBody`/`PreviewData`/`Body`/`Response`(필터 일치분 전체 삭제 + 견적 연결 보호).

**bom-quote** (고객 스마트 BOM 견적 — 업로드→파싱→매칭→검토→RFQ)
- 상태·근거 enum: `BomQuoteStatus`(draft→requested→reviewing→answered→closed/canceled) · `BomQuoteBuildStatus`(parsing→selecting→building→ready/failed) · `BomQuoteSelectionSource`(none/auto/customer/catalog/admin/legacy) · `BomQuoteDecisionReason`(17종 근거 코드) · `BomQuoteRecommendationType` · `BomQuoteProcurementUnavailabilityReason`(구매 불가 10종).
- 검색 과정 영속화: `BomQuoteSearchTrace(Summary|Attempt)`(`'supplier-search-trace-v1'`, 캐시/라이브 출처·폴백·소진 사유) · `BomQuoteLocalCatalogTrace`(`'local-catalog-trace-v2'`, `catalogType: 'samplepcb_rc'|'connector'`, `apiCalls: z.literal(0)`) · `BomQuoteSupplierSearchLimitReason`.
- 판정·후보: `BomQuoteMatchEvidence`(엔진 판정 스냅샷) · `BomQuoteSearchRequirementGuidance`(`'bom-search-requirement-policy-v1'`, 부품 유형 9종) · `BomQuoteSearchRequirements(Body)`(`componentType` discriminated union) · `BomQuotePassiveDefaultsBody` · `BomQuoteCandidate`(제조사+MPN 통합 단위, `safety`/`selectionEligibility`/`selectionRecommendation`) · `BomQuoteCandidateOffer` · `BomQuoteComparison*`(영속 스냅샷 기반 전체 비교) · `BomQuoteExtractionSource`(엔진 ComponentRecord 원본).
- 견적 본체: `BomQuoteItemInput`/`Item`(`orderQty`·`selectedOffer` 박제, `catalogInquiry`) · `BomQuoteSelectedOffer`(`priceBreaks` 사다리 포함) · `BomQuoteCatalogSelection`/`ItemEdit` · `BomQuoteSummary`/`Detail`(`enrichStatus`·`partDataStatus`·`supplierSearchLimitSummary`·`exchangeRateSnapshot`).
- 요청/응답·관리자: `BomQuotePatchBody`(디바운스 자동저장) · `BomQuoteBuildBody`/`SheetSelectionBody` · `BomQuoteCandidateSelectionBody` · `BomQuoteRequestBody` · `BomQuoteDeleteManyBody`(scope discriminated union) · `AdminBomQuote*`.
- 설정: `BomQuoteConfig`(운송료·관리비 기본값, `usdKrwRateMode`/`RateType`/`SafetyMarginPercent`/`MaxAgeDays`, `supplierSearchMaxCalls` ≤3000, `memberDailySearchLimit`, `freshnessHours`) · `BomQuoteExchangeRateStatus` · `BomSupplierSearchOperations`(엔진 진단·오늘 사용량·최근 실행 이력).

**market / ai** — `MARKET_*`/`MARKET_*_LABELS` 코드 사전, 전문가·프로젝트·입찰·NDA·계약(`MarketContract` feeRateBp 스냅샷)·관리자 표면 + `MarketAiInterviewAnswer`/`MarketAiProvenance`(AI 산출물 provenance). `AI_USECASES` 6종 — `market.request-{diagram,structurize,roc,postings}` + **`rnd.file-classify`·`rnd.pcb-request-document`**(첨부 manifest 분류 `RndFileCategory` 11종 → PCB 개발의뢰서 생성). `DiagramSpec`(`.catch` 흡수) · `AiRunResponse`/`AiJobResponse`(비동기 잡 폴링) · `AiSettings*`.

**routes** — `apiRoutes` 27종: 기존 24종에 **`adminBom`·`adminParts`·`bom`·`adminBomQuotes`·`rndAi`** 추가(`marketMy*` 세분화 포함).

## Data [coverage: medium — 4 sources]

- **거버 spec 값은 파싱하지 않는다**: `string | number` 유니언으로 원본 수신, 가격 해석은 sp-node `pricing/engine.ts` 몫.
- **BOM 견적의 단일 진실은 저장된 `orderQty`·`selectedOffer` 스냅샷**(레거시 '박제' 원칙) — 합계는 **항상 서버가 재계산**하고 클라 금액은 불신한다. `exchangeRateSnapshot`은 draft 동안 갱신되고 RFQ 요청 후 동결.
- **카탈로그(사실 데이터) ↔ 매칭 근거(문맥)를 분리**: `parts.ts`는 부품·구매 조건 사실, `bom-quote.ts`의 `matchEvidence`/`candidates`는 그 견적 시점 판정 스냅샷. 후보·트레이스는 엔진 인메모리 잡이 아니라 DB 영속본에서 읽는다.
- 응답은 회원 라우트 `{ result: true, data: {...} }` 봉투 패턴. 마켓 도메인은 **DB에 코드만 저장(Json 배열)**, 라벨은 계약 상수에서 해석.
- 실제 저장은 sp-node 쪽 Prisma(`sp_quote`/`sp_part*`/`sp_bom_quote*`/`sp_market_*`/`sp_config`) — 계약 패키지 자체는 DB 를 모른다.

## Key Decisions [coverage: high — 9 sources]

- **자체 카탈로그 우선 조회를 계약 트레이스로 승격(2026-07-26)**: 외부 공급사 호출 전에 부품 유형별 자체 카탈로그(`samplepcb_rc`·`connector`)를 먼저 조회하고, 그 한 단계를 `BomQuoteLocalCatalogTrace`(v2)로 견적에 영속한다. `apiCalls: z.literal(0)`을 **타입으로 못박아** "무료 단계"임을 계약이 보증한다.
- **`offerKind`로 자체 구매 조건과 실공급사 구매 조건을 구분(2026-07-26)**: `manufacturer_catalog` = 가격·실재고 확인 전 문의용 카탈로그 정보, `supplier_offer` = 구매 가능. `PartOfferView.derivedFrom`이 samplepcb 파생 구매 조건의 원천을 남기고, `PartHit.suppliers`에는 제조사 카탈로그 원천을 넣지 않는다(`hasCatalogInquiryOffer`로 별도 표시). 견적 라인은 `catalogInquiry`로 승계.
- **파괴적 삭제는 계약이 오호출을 막는다(2026-07-25)**: 카탈로그 초기화는 `confirm: z.literal('RESET_WITH_QUOTES')` 전용 리터럴(연결 견적까지 강제 삭제하므로), 필터 삭제는 **무필터 전체 삭제를 `refine`으로 거부**하고 견적 연결 부품은 409 보호 + preview 로 대상 선고지.
- **기술 판정·구매 후보 결정은 sp-engine 단일 소유(2026-07-2x)**: `searchRequirementGuidance`(policyVersion 고정)와 `selectionRecommendation`/`selectionApplicationState`를 엔진이 확정하고 **Node·FE 는 재판정하지 않고 표시만** 한다. 판정 로직 이중화를 계약 주석으로 금지.
- **검색 과정을 실행별로 영속·계층 노출(2026-07-1x~)**: 목록·라인에는 `searchTraceSummary`(compact)만, 전체 `attempts`는 후보 API 지연 조회. 호출 상한 소진은 `limitReasons`(`job_call_limit`/`supplier_quota`)로 사용자에게 정확히 고지.
- **AI 인터뷰 파이프라인의 결정적 부분은 계약이 소유(2026-07-12, 07-16 보강)**: 질문 뱅크·선분석·유스케이스 키·`DiagramSpec`을 코드에 둔다. LLM 산출 검증은 **거부 대신 `.catch` 흡수 + 정규화 복구** 원칙(프로빙 실측 근거). `market.request-diagram-spec`은 폐기되고 structurize 로 통합.
- **전체서비스 입찰 제한을 계약 코드로 표현(2026-07-12)** · **SEO 는 오버라이드 전용 스키마(2026-07-10)** · **마켓 코드 사전·한글 라벨 정본 = market.ts(2026-07-08~)**, 툴 **빈 배열=무관**.
- **거버 가격 모드는 계약 enum 2값(2026-07-05)** · **spec 키 39종 + catchall = "발견 지향" 검증**(미지 키는 `unknownSpecKeys`로 보고) · **`differentDesign` 통일 / `category`·`orderCategory` 재정의(2026-07-03)**.
- **가격은 항상 서버 계산 · JWT 는 검증만**: 거버 수량 수정도 서버 재견적, BOM 견적 합계도 서버 재계산. 그누보드 발급 JWT 를 Fastify 는 `JwtClaims`로 검증만 한다.

## Gotchas [coverage: high — 7 sources]

- **`bom.ts`만 snake_case + `.passthrough()`**: 엔진 pydantic 미러라 나머지 camelCase 계약과 규약이 다르다. `bom.ts`(엔진 원본) → `bom-quote.ts`(견적 도메인)로 넘어갈 때 이름이 바뀌므로 두 파일의 유사 필드를 같은 것으로 취급하지 말 것.
- **신규 근거 필드는 대부분 `.nullable().optional()`**: `localCatalogTrace`·`searchTrace`·`searchRequirementGuidance`·`procurementUnavailabilityReason`·`technicalPreselectionCandidateKey` 등은 **구버전 견적·구 엔진 결과에 없다**. 존재를 전제한 렌더는 이관·과거 견적에서 깨진다.
- **에러 봉투가 이원화**: 회원 라우트 `{result:false, error:'CODE'}` vs 관리자 라우트 `ApiError{error,message}` — FE 는 `@sp/shared`가 정규화하지만 새 라우트는 관례를 먼저 정할 것.
- **호출 상한이 두 곳에 정의**: `BomQuoteConfig.supplierSearchMaxCalls`(≤3000)와 `BomSupplierOptions.max_calls`(≤3000, 엔진 스키마) — 한쪽만 올리면 조용히 잘린다.
- **`differentDesign` 누락 시 실사고**(가격 0원 → rfq) · **`category`/`orderCategory` 스왑 함정** · **마켓 `cadTools` 빈 배열의 의미 반전**(전체 허용).
- **`DiagramSpec`은 통상적 Zod 와 다르게 동작**: `.catch` 흡수라 "파싱 성공 = 입력이 스키마 그대로"가 아니다. 저장 경로는 `parseDiagramSpecString` 재검증 필수.
- **LLM 산출·외부 링크 필드는 렌더 방식이 계약의 일부**: `diagramHtml`은 sandbox iframe 전용, `rocMd`는 라인 파서 렌더(v-html 금지), `imageUrl`/`datasheetUrl`은 공급사 직링크(표시 전용).
- `thumbnailUrl`(서명 프록시)은 만료가 있고 `cartState`·`biddingClosed`·`lineTotalKrw`·`partImageUrl`은 저장 안 하는 파생·서버 채움 값 — PATCH 로 왕복시키지 말 것. 빌드 산출물 없는 src 직접 노출 패키지라 소비자 tsconfig 가 `@sp/config` 기준과 호환되어야 한다.

## Sources [coverage: high — 18 sources]

- [package.json](../../samplepcb-web-mono-app/packages/api-contract/package.json)
- [src/index.ts](../../samplepcb-web-mono-app/packages/api-contract/src/index.ts)
- [src/routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts)
- [src/schemas/common.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/common.ts) · [auth.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/auth.ts) · [pcb-project.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-project.ts)
- [src/schemas/bom-quote.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-quote.ts)
- [src/schemas/parts.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/parts.ts)
- [src/schemas/bom.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom.ts)
- [src/schemas/market.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market.ts) · [ai.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/ai.ts) · [ai-interview-questions.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/ai-interview-questions.ts)
- [src/schemas/admin.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/admin.ts) · [members.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/members.ts) · [orders.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/orders.ts)
- [src/schemas/seo.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/seo.ts) · [slides.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/slides.ts) · [settings.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/settings.ts)
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md)
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md)
- [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md)
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md)
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md)
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md)
- [docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) · [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [@sp/shared 소비처: api-client.ts 외](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts)
