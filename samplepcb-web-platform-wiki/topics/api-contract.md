---
topic: api-contract
last_compiled: 2026-07-13
sources_count: 14
status: active
---

# api-contract

## Purpose [coverage: medium — 3 sources]

`@sp/api-contract`(위치: `samplepcb-web-mono-app/packages/api-contract`)는 **Zod 스키마 + 추론 타입 + 라우트 상수**를 담은 FE/BE 공통 계약 패키지다. sp-node(Fastify API)와 클라이언트(거버 뷰어, sp-php 견적관리 페이지, sp-vue 관리자, sp-market 재능마켓 SPA)가 공유하는 요청/응답의 **단일 진실원본(single source of truth)** 역할을 한다. AGENTS.md 규칙상 "API 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod)에 정의하고 FE/BE 양쪽이 그걸 import" 해야 한다. 스키마뿐 아니라 **도메인 코드 사전·한글 라벨**(재능마켓 `MARKET_*`/`MARKET_*_LABELS`, NDA 문구 원문, AI 인터뷰 질문 뱅크)의 정본이기도 하다.

## Architecture [coverage: high — 7 sources]

- **빌드 없는 src 직접 노출**: `package.json`의 `main`/`types`/`exports` 모두 `./src/index.ts` — 소비자가 TypeScript 소스를 직접 import 한다. 스크립트는 `typecheck`·`lint`만 존재.
- **유일한 런타임 의존성은 `zod`**. devDeps 로 `@sp/config`(공유 tsconfig/eslint) 사용 — `strict` + `exactOptionalPropertyTypes` 등 "매우 강함" 타입 강성 기준을 따른다.
- 파일 구성 (`src/index.ts`가 전부 re-export):
  - `src/schemas/common.ts` — `ApiError`, `HealthResponse`
  - `src/schemas/auth.ts` — `Me`, `JwtClaims`
  - `src/schemas/pcb-project.ts` — 거버 주문/견적 계약
  - `src/schemas/admin.ts` — 관리자 견적 관리 (`AdminQuote*`)
  - `src/schemas/members.ts` / `orders.ts` — 관리자 회원·주문 관리 (`AdminMember*` / `AdminOrder*`)
  - `src/schemas/settings.ts` — 사업자 정보 + **거버 가격 모드** (`GerberPriceMode` 등)
  - `src/schemas/slides.ts` — 메인 슬라이드 관리 (`Slide*`)
  - `src/schemas/seo.ts` — SEO 관리 (`Seo*`)
  - `src/schemas/market.ts` — **재능마켓 전체 플로우**(최대 모듈: 코드 사전·라벨·전문가·프로젝트·입찰·NDA·계약·정산·관리자 표면)
  - `src/schemas/ai.ts` — **AI 유스케이스 실행 계층**(유스케이스 키·잡·설정·DiagramSpec·인터뷰 질문 뱅크)
  - `src/routes.ts` — `apiRoutes` 상수 24종 (`/api/health`~`/api/admin/market/settings`)
- 데이터 흐름에서의 위치: **DB(Prisma) → API(Fastify, `fastify-type-provider-zod`) → 계약(`@sp/api-contract`) → Vue(@tanstack/vue-query)** 가 타입으로 연결.

## Talks To [coverage: high — 6 sources]

- **sp-node (`apps/api`)**: `routes/pcb-projects.ts`, `routes/me.ts`, `routes/health.ts`, 관리자 라우트(`admin-*.ts` — settings·slides·seo 포함), 재능마켓 라우트 6파일(`market-{experts,projects,bids}.ts` + `admin-market-*.ts`), AI 라우트(`routes/ai.ts` + `lib/ai/` 레지스트리), `plugins/auth.ts`(`JwtClaims`)에서 import — Zod type-provider 로 요청 검증과 응답 타입에 사용. 마켓 메일 빌더도 `MARKET_*_LABELS`를 소비.
- **`@sp/shared`**: `api-client.ts`(`ApiError`를 throw 가능한 Error 로 래핑, 회원/관리자 두 에러 봉투를 `ApiMemberError`로 정규화), `auth.ts`(`Me`), `queries.ts`(`apiRoutes` + 스키마) — Vue 앱은 이 패키지를 통해 간접 소비.
- **sp-vue (`apps/web`, `/app/admin`)**: 견적·회원·주문·설정(거버 가격·AI 연동)·슬라이드·SEO·마켓 관리 화면(`AdminMarket{Experts,Projects,Contracts,Settings}.vue`)의 소비자.
- **sp-market (`apps/market`, `/market`)**: 재능마켓 고객 SPA — 의뢰 위저드(STEP2 동적 스텝의 `MARKET_AREA_TOOL_GROUPS`/`MARKET_AREA_SPECIALTIES`, AI 인터뷰 UI의 `AI_INTERVIEW_QUESTIONS`), 전문가 등록, 블라인드 입찰, 계약 카드 등 전면 소비.
- **거버 뷰어(별도 repo `samplepcb_gerber`)**: 제출부 `apps/view/src/ResultPanel/submit.tsx` + 어댑터 `toProjectPayload.ts`가 `PcbProjectPayload` 형태의 multipart `payload` 파트(JSON)를 전송.
- **sp-php 견적관리 페이지(`/shop/quotes`)**: 목록·주문·수량수정·삭제 응답(`PcbProjectList*`, `PcbProjectOrder*` 등)의 소비자.

## API Surface [coverage: high — 8 sources]

`src/index.ts`가 export 하는 것 (스키마마다 `z.infer` 타입 동반, `...Type` 접미):

**common** — `ApiError { error, message }` · `HealthResponse { ok: true, service }`

**auth** — `Me { mbId, mbNick, level, isAdmin }` (그누보드 JWT 클레임/회원 식별, DB 직접결합 없음) · `JwtClaims = Me + { cartId?, iat, exp }` — `iat`/`exp` 필수(만료 없는 토큰은 검증 단계에서 거부), `cartId`는 영카트 장바구니 버킷 키(`ss_cart_id` = `g5_shop_cart.od_id`)로 과도기 토큰 호환을 위해 optional. 마켓 checkout 은 `cartId` 클레임 필수(FE 가 직전 bootstrap 재발급).

**pcb-project**
- `KNOWN_SPEC_KEYS` — 거버 뷰어가 보내는 spec 키 39종(camelCase 정규화 후) 상수 배열
- `PcbProjectSpec` — 39종 키(optional) + `catchall(SpecValue)`; 값은 `string | number`
- `PcbProjectPayload` — multipart `payload` 파트 계약: `{ flow: 'order'|'rfq', projectName, category, orderCategory: 'sample'|'mass', qty, message, spec }`
- `PcbProjectCreateResponse` — `{ projectId, quoteId, quoteStatus: 'priced'|'rfq', price(null=rfq), eta, cartAdded, redirectUrl, unknownSpecKeys? }`
- `PcbProjectListItem` / `PcbProjectListResponse` — 견적관리 목록: `quoteStatus: 'priced'|'rfq'|'quoted'`, `optionSummary`, `thumbnailUrl`(서명 프록시, 만료 있음), `cartState: 'none'|'cart'|'ordered'`(저장 안 하는 파생 상태) 등
- `PcbProjectCartAddResponse` / `PcbProjectOrderRequest`·`Response`(행 단위 `ct_select` 바로 주문) / `PcbProjectQtyPatch`·`Response`(수량 수정 = 서버 재견적) / `PcbProjectDeleteResponse`(소프트 삭제)

**admin / members / orders** — 관리자 견적(`AdminQuote*` 목록·상세·카운트) · 회원(`AdminMember*` — 차단·레벨·프로필·메모) · 주문(`AdminOrder*` — 탭·상태 전이·품목 상태·알림 발송 설정 `AdminNotifyConfigResponse`).

**settings** — `BusinessInfo*`(사업자 정보) · `GerberPriceMode('order'|'supply')`, `GerberPricingResponse`/`Update` — 거버 산출가를 주문가(포함)로 볼지 공급가(×1.1 정규화)로 볼지의 전역 스위치, `sp_config` 저장.

**slides** — `Slide`, `SlideListResponse`, `SlideUpsert`, `SlideReorder`, `SlideOkResponse` — 메인 슬라이드 관리(`/app/admin/slides`, 영카트 `g5_shop_banner` 공유).

**seo** — `SeoScope`(global/page/item/board), `SeoRecord`, `SeoListResponse`, `SeoUpsert`, `SeoOkResponse` — `sp_seo` 페이지별 SEO 오버라이드(관리=sp-vue, 소비=sp-php 테마 head.sub.php 직접 SELECT).

**market** (재능마켓 — 최대 모듈)
- **코드 사전·라벨 정본**: `MARKET_CATEGORIES`(세부분야 18종)·`MARKET_SERVICE_AREAS`·`MARKET_REQUEST_TYPES`(system/individual)·`MARKET_TOOL_CODES`(ECAD·MCAD·디자인 flat 통합, **빈 배열=툴 무관**, 구 `'any'`는 레거시 호환 잔존)·예산/경력/지역/이동거리 구간 + 전부 `MARKET_*_LABELS` 한글 라벨 — sp-market·sp-vue·sp-node 메일 빌더 3곳 공유, DB에는 코드만 저장. `MARKET_AREA_TOOL_GROUPS`/`MARKET_AREA_SPECIALTIES`(위저드 STEP2 동적 구성)·`MARKET_NDA_TEXT`/`MARKET_NDA_VERSION`(NDA 문구 원문)도 계약 상수.
- **전문가**: `MarketExpertRegisterPayload`/`UpdatePayload`(individual|company|house), `MarketExpertMe`, `MarketExpertPublic`(마스킹·연락처 부재), 목록/상세 응답.
- **프로젝트·입찰**: `MarketProjectCreatePayload`(open|targeted, `serviceAreas`·`categories`·`cadTools`·NDA·`diagramHtml`/`diagramSpec`/`rocMd`/`postings`), 목록/상세/내 의뢰/지정 의뢰 응답, `MarketNdaSignBody`, `MarketBidSubmitBody`, `MarketMyBid`, `MarketProjectBidsResponse`(소유자 전용), `MarketAwardResponse` — 블라인드 원칙(타인 입찰 스키마 자체가 없음).
- **계약·결제(2차)**: `MarketContract`(status pending→paid→delivered→completed→settled, feeRateBp/fee/payout 스냅샷, contractKey=영카트 io_id), `MarketCheckoutResponse`, `MarketPostingCard(s)`(Phase 3 분야별 AI 카드).
- **관리자 표면**: `AdminMarketExpert*`(승인/반려) · `AdminMarketProject*` · `AdminMarketContract*`(정산 settle·hold·운영취소 바디 포함) · `MarketSettings`(feeRateBp).

**ai** (범용 AI 유스케이스 계층)
- `AI_USECASES` — 유스케이스 키 레지스트리(`market.request-diagram` 단발 폴백 · `market.request-structurize` · `market.request-diagram-spec` · `market.request-roc` · `market.request-postings`). 새 유스케이스 추가 = 이 상수 + sp-node 레지스트리 def.
- `DiagramSpec` — 인터뷰 파이프라인의 피벗 JSON. **enum 이탈은 `.catch`로 안전값 흡수**(LLM 산출 특성 — 실패 대신 복구), `DIAGRAM_BLOCK_TYPES` 상수.
- `AI_INTERVIEW_QUESTIONS` — 코어 13문항 질문 뱅크(선택형 8+단문 5, `hideIf` 조건부) — 인터뷰 흐름은 결정적 데이터, LLM 은 구조화·추가질문·렌더만.
- run 바디 4종(`AiDiagramRunBody`/`AiStructurizeRunBody`/`AiDiagramSpecRunBody`/`AiRocRunBody`/`AiPostingsRunBody`) · `AiRunResponse`(jobId 즉시 반환) · `AiJobResponse`(5초 폴링) · `AiSettingsResponse`/`Update`(연결·유스케이스 설정, API 키는 마스킹만) · `AiModelsResponse`(연결 테스트).

**routes** — `apiRoutes` 24종: `health`·`me`·`pcbProjects` + 관리자 7종(`adminPcbProjects`·`adminPcbFiles`·`adminMembers`·`adminOrders`·`adminSettings`·`adminSlides`·`adminSeo`) + 마켓 회원 6종(`marketExperts`·`marketProjects`·`marketMy*`·`marketSettings`) + `ai` + 마켓 관리자 5종(`adminMarket*`).

## Data [coverage: medium — 4 sources]

- **spec 값은 파싱하지 않는다**: 단위 혼재·자유 텍스트가 많아 `string | number` 유니언으로 원본 그대로 수신. 가격 해석은 sp-node `pricing/engine.ts` 몫(거버 가격 모드 `supply`의 ×1.1 정규화도 엔진 밖 후처리).
- 응답은 회원 라우트 `{ result: true, data: {...} }` 봉투 패턴. `price = finalPrice ?? autoPrice ?? null`, `createdAt`은 ISO 문자열.
- 마켓 도메인은 **DB에 코드만 저장(Json 배열)**하고 라벨은 계약 상수에서 해석 — 라벨 변경이 데이터 마이그레이션을 요구하지 않는다. `bidDeadlineAt` 마감은 lazy 판정(저장 전이 없음)이라 `biddingClosed`는 응답 파생값.
- AI 산출물 저장 필드(`diagramHtml`·`diagramSpec`·`rocMd`·`postings`)는 `sp_market_project` MEDIUMTEXT/JSON — `interviewAnswers`는 **응답 미노출 저장 전용**(계약 응답 스키마에 없음). 파손 spec 은 저장 전 재검증으로 400 `INVALID_DIAGRAM_SPEC`.
- 실제 저장은 sp-node 쪽 Prisma(`sp_quote`/`sp_market_*`/`sp_seo`/`sp_config` 등) — 계약 패키지 자체는 DB 를 모른다.

## Key Decisions [coverage: high — 8 sources]

- **AI 인터뷰 파이프라인의 결정적 부분은 계약이 소유(2026-07-12)**: 질문 뱅크(`AI_INTERVIEW_QUESTIONS`)·유스케이스 키(`AI_USECASES`)·`DiagramSpec` 스키마를 코드(계약)에 두고, LLM 산출 검증은 **거부 대신 `.catch` 흡수 + 정규화 복구**를 원칙으로 — 프로빙 실측(glm·deepseek 의 enum 슬립) 근거.
- **전체서비스 입찰 제한을 계약 코드로 표현(2026-07-12)**: `requestType=system` × `expertType=individual` → 403 `FULL_SERVICE_COMPANY_ONLY` — 목록·상세는 공개, 입찰만 제한. FE 는 같은 계약 코드로 선반영.
- **SEO 는 오버라이드 전용 스키마(2026-07-10)**: `SeoRecord`에 `jsonLd` 컬럼 없음($it 자동 유도가 기본), `canonical`은 수동 오버라이드 전용(호스트 무관 설계라 절대 URL 저장 금지). 소비측(sp-php)은 API 가 아닌 DB 직접 SELECT — 계약은 관리 UI 경로만 커버.
- **마켓 코드 사전·한글 라벨 정본 = market.ts(2026-07-08~)**: `MARKET_*`/`MARKET_*_LABELS`를 sp-market·sp-vue·sp-node 메일 3곳이 공유. 툴은 **빈 배열=무관**(구 `'any'` 코드는 레거시 호환 enum 잔존). 계약 `MarketContract`는 feeRateBp/fee/payout 을 **채택 시점 스냅샷**으로 담아 설정 변경과 절연.
- **거버 가격 모드는 계약 enum 2값(2026-07-05)**: `GerberPriceMode = 'order'|'supply'`, 미설정 기본 `order`(현행 보존) — 세율 변경이 아니라 "거버 값 해석" 스위치임을 계약 이름으로 못박음.
- **spec 키 39종 계약 + catchall = "발견 지향" 검증**: 알려진 키는 열거하되 미지 키도 수신 허용, 서버가 `unknownSpecKeys`로 보고 — 계약 위반을 "차단"이 아니라 "발견"하기 위함.
- **`differentDesign` 통일(2026-07-03)**: 파일 개수 키는 `differentDesign`이 정본, 레거시 EAV 의 `diffDesign`은 별칭. / **`category`/`orderCategory` 네이밍 재정의**: `category`=제품군, `orderCategory`=샘플/양산 — 레거시와 스왑되어 주의 주석 명시.
- **가격은 항상 서버 계산 · JWT 는 검증만**: 수량 수정도 서버 재견적(새 `quoteId`), 그누보드 발급 JWT 를 Fastify 는 `JwtClaims`로 검증만 — Node 는 그누보드 스키마와 직접 결합하지 않는다.

## Gotchas [coverage: high — 6 sources]

- **에러 봉투가 이원화**: 회원 라우트 `{result:false, error:'CODE'}`(pcb-projects 관례) vs 관리자 라우트 `ApiError{error,message}` 선언형 — FE 는 `@sp/shared`가 정규화하지만, 새 라우트 작성 시 어느 관례를 따르는지 먼저 정할 것. 코드→메시지 맵은 앱별(`apps/market/src/lib/error-msg.ts` 등).
- **`differentDesign` 누락 시 실사고**: spec 에서 빠지면 가격이 "0원 → rfq"로 빠진다(실발생). **`category`/`orderCategory` 스왑 함정**도 어댑터 작성 시 주의.
- **마켓 `cadTools` 빈 배열의 의미 반전**: 빈 배열 = "특정 툴 요구 없음"(전체 허용)이지 "아무 툴도 안 됨"이 아니다. 구 `['any']` 데이터는 마이그레이션 백필 + 읽기 정규화로 `[]` 취급.
- **`DiagramSpec`은 통상적 Zod 와 다르게 동작**: `.catch` 흡수라 "파싱 성공 = 입력이 스키마 그대로"가 아니다. 저장 경로는 `parseDiagramSpecString` 재검증 필수(이관 specJson `_legacy` 교훈 — 저장 전 형태 통제).
- **LLM 산출 필드는 렌더 방식이 계약의 일부**: `diagramHtml`은 sandbox iframe(srcdoc) 전용, `rocMd`는 라인 파서 렌더(v-html 금지) — 스키마 타입만 보고 DOM 직결하면 XSS.
- `thumbnailUrl`(서명 프록시)은 만료가 있고, `cartState`·`biddingClosed`는 저장 안 하는 파생 상태 — DB 컬럼으로 오해하지 말 것. `JwtClaims.cartId` optional 은 과도기 호환 — cart 필요 라우트(마켓 checkout 포함)는 자체 검증. 빌드 산출물 없는 src 직접 노출 패키지라 소비자 tsconfig 가 `@sp/config` 기준과 호환되어야 한다.

## Sources [coverage: high — 14 sources]

- [package.json](../../samplepcb-web-mono-app/packages/api-contract/package.json)
- [src/index.ts](../../samplepcb-web-mono-app/packages/api-contract/src/index.ts)
- [src/routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts)
- [src/schemas/common.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/common.ts) · [auth.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/auth.ts) · [pcb-project.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-project.ts)
- [src/schemas/market.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market.ts) · [ai.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/ai.ts)
- [src/schemas/seo.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/seo.ts) · [slides.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/slides.ts) · [settings.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/settings.ts)
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md)
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md)
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md)
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md)
- [docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md)
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [@sp/shared 소비처: api-client.ts 외](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts)
