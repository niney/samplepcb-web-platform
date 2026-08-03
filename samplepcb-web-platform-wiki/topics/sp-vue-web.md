---
topic: sp-vue-web
last_compiled: 2026-07-27
sources_count: 36
status: active
---

# sp-vue-web

## Purpose [coverage: high — 6 sources]

`sp-vue` — samplepcb 신규 화면 영역의 **Vue 3 SPA** (`samplepcb-web-mono-app/apps/web`, 패키지명 `web`). 그누보드5/영카트(`sp-php`)와 **같은 도메인**에서 nginx 로 합류하며 `/app` 경로에 마운트된다(`base: '/app/'` 고정). 별칭 규칙상 "web" 호칭은 금지(PHP `samplepcb-web/` 와 혼동) — 문서·커밋에서는 `sp-vue`.

**역할 전제 변경(2026-07-19)**: 기존 "sp-vue `/app` = 관리자 콘솔 전용" 전제가 고객 스마트 BOM 견적(`/app/bom`, **회원 전용**) 도입으로 공식 변경됐다 — sp-vue 는 이제 **관리자 콘솔 + 일반(회원) 화면을 함께 담는다**(router.ts 주석이 선언 정본). 고객 단순 화면은 여전히 sp-php(`/`), 재능마켓 소비자 SPA 는 별도 앱 `sp-market`(`/market`)이며, SPA 급 인터랙션 화면만 `/app` 또는 `/market` 에 둔다. 형제 앱 `apps/rnd`(`/rnd`:5177, 연구·실험용 독립 SPA, 2026-07-17)는 sp-vue 와 별개다.

관리자 콘솔(`/app/admin`)은 최고관리자(cf_admin) 전용 — 그누보드 3계층 관리자(`/adm`)와 병행 존속. 2026-07 들어 관리자 표면이 견적·회원·주문·설정 + 마켓 4종·SEO·슬라이드·AI 연동에 더해 **공급사 검색(BOM 잡)·BOM 견적 검토·부품 카탈로그**로 확장됐다. 다만 07-20 이후 앱의 무게중심은 고객 BOM 영역(`/app/bom` 4화면)으로 옮겨갔다 — 코드 증가분 대부분이 워크벤치·후보 비교·단일 검색이다. UI·스타일은 여전히 프로토타입 선언이나, 고객 BOM 셸은 Figma "Smart BOM_Web 2.0" 픽셀 이식으로 예외적 확정 디자인.

## Architecture [coverage: high — 11 sources]

- **스택**: Vite + Vue 3 + TypeScript + Vue Router 4 + Pinia + @tanstack/vue-query + Tailwind v4(`@tailwindcss/vite`) + vue-i18n. 폰트 Pretendard variable.
- **모노레포 구성원**: pnpm workspaces + Turborepo. workspace 의존성 `@sp/api-contract`(Zod 계약)·`@sp/shared`(API 클라이언트·vue-query 훅·Pinia auth store)·`@sp/utils`(bom-pricing·spec-units 등 FE/BE 공용 순수 함수)·`@sp/config`.
- **src 구조**:
  - `main.ts` — pinia → i18n → vue-query 설치, **마운트 전 `useAuthStore(pinia).bootstrap()`** 후 router 설치(순서 필수 — 딥링크가 빈 auth 가드에 튕김).
  - `router.ts` — `createWebHistory('/app/')`. 레이아웃 3종: `DefaultLayout`(홈 셸)·`AdminLayout`(`meta.requiresAdmin`)·**`BomLayout`**(고객 BOM 전용 셸, `meta.requiresMember`). `/bom` 하위는 **정적 세그먼트(`search`·`history`)를 `:id` 보다 먼저** 선언해 견적 id 로 오매칭되지 않게 한다.
  - `pages/admin/` 15종 — 기존 11종 + `AdminBom`(공급사 검색 잡 목록)·`AdminBomJob`(잡 상세)·`AdminBomQuotes`(BOM 견적 검토)·`AdminParts`(부품 카탈로그).
  - `pages/bom/` 4종 — `BomHome`(업로드)·`BomHistory`(내 견적 전체 목록·검색·선택 삭제)·`BomSearch`(단일 부품 검색)·`BomQuote`(견적 워크벤치, 2,185줄로 최대 화면).
  - `components/bom/` 11종 — `BomQuoteRow`(행 단위 렌더 격리)·**`BomCandidateDrawer`**(후보 비교 패널, 2,849줄로 앱 최대 컴포넌트)·`BomCompareModal`·`BomPartSearchModal/Panel/Notice`·`BomPartOfferOptions`·`BomPriceBreaks`·`BomSearchRow`·`BomOfferModal`·`BomQuoteOfferModal`.
  - `bom/` 헬퍼 5종 — `useBom`(vue-query 훅)·`extraction-display.ts`(엔진 payload→화면 필드 라벨·근거·확신도 매핑)·`supplier-meta.ts`(공급사 배지)·`format.ts`(fmtAge 등)·`usePanels.ts`.
  - `admin/` — `menu.ts` + vue-query 훅 11종(`useAdminQuotes/Members/Orders/Settings/Market/Slides/Seo` + `useAdminBom`·`useAdminBomQuotes`·`useAdminParts`).
- **설정 페이지 탭 4종**: `businessInfo` · `gerberPricing` · `aiIntegration` · **`bomQuote`**(운송료·관리비·환율 방식·안전계수·검색 한도·신선 임계 + [지금 갱신]). 2026-07-21 이후 이 탭은 **공급사 검색 운영 패널**을 겸한다 — 엔진 연결 배지·엔진 안전 상한 vs 관리자 설정 한도(작은 값이 실적용)·오늘 검색 사용량·캐시 모드/건수·최근 10개 실행의 예상→실제 호출·구간별 소요(엔진/반영/카탈로그 DB·ES). 탭 추가 = `SettingsTabs` TABS 배열 + 패널 스위치 한 줄.
- **공용 조각 추출 원칙**: 같은 시각 언어를 쓰는 화면은 컴포넌트를 공유한다 — `BomPriceBreaks`(가격구간 4행+적용 강조)와 `supplier-meta`를 `BomQuoteRow`·`BomSearchRow`가, `BomPartOfferOptions`(browse=열람 / select=부품 변경)를 단일 검색과 후보 패널이 공유. 시각 일관성을 규약이 아닌 구조로 보장한다.
- **렌더 성능 구조(2026-07-20)**: 수백 행 워크벤치에서 ① `BomQuoteRow` 가 item 참조를 그대로 받고 변경은 emit — 참조 안 바뀐 행은 patch 스킵 ② `watch(detail)` 이 vue-query structural sharing 참조를 추적해 안 바뀐 행의 로컬 클론 재사용 ③ 자동저장 `usePatchBomQuote` 는 `['bom']` 무효화 대신 PATCH 응답을 `setQueryData` 로 캐시 직접 반영(저장마다 GET 리페치 제거). 수량 편집 12~16ms→0.6~3ms 실측. 2,000행 상한의 최초 마운트 가상 스크롤은 비병목 판단으로 보류.
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint strictTypeChecked, `no-explicit-any`=error.
- **dev 서버**: 포트 5173, `host: '127.0.0.1'`(Windows IPv6 문제로 nginx 502 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`, proxy `/api`→3333·`/spcb`→8888.

## Talks To [coverage: high — 7 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 유일한 데이터 통로. 관리 화면은 `/api/admin/*`(Bearer JWT, `requireAdmin`), 고객 BOM 은 `/api/bom`(회원 `authenticate`). 계약은 `@sp/api-contract`(Zod) FE/BE 공유.
- **sp-engine** (:8400, Python) — 직접 통신 없음. BOM 파싱·공급사 검색(Mouser/DigiKey/UniKeyIC)·후보/조달 판정은 sp-node 잡 프록시 경유, sp-vue 는 3초 폴링·진행 표시만. 엔진의 검색 trace·`/capabilities` 안전 상한·조달 사유 코드도 **sp-node 가 투영한 필드를 그대로 렌더**할 뿐 sp-vue 가 재해석하지 않는다.
- **Elasticsearch** (sp-parts) — 직접 통신 없음. `/app/admin/parts` 가 `GET /api/admin/parts/search`(ES 다중해석 쿼리) 를 소비, ES 다운 시 503 SEARCH_UNAVAILABLE 표시. 고객 `/bom/search` 도 같은 쿼리 빌더를 sp-node 경유로 재사용.
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드 IdP. `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) 발급. `requiresMember` 가드는 비로그인 시 **그누보드 로그인 왕복**(`loginUrl` — 로그인 후 원래 경로 복귀).
- **sp-market** (`/market`, :5176) — 마켓 관리 표면(`/app/admin/market/*`)을 sp-vue 가 담당하는 짝 관계. 라벨 사전(`MARKET_*_LABELS`) 계약 공유.
- **"관리=sp-vue / 소비=sp-php" 짝**: 슬라이드(`AdminSlides` ↔ `theme/sp-lite/inc/main_slider.php`, g5_shop_banner '메인')·SEO(`AdminSeo` ↔ 테마 `head.sub.php` SSR, sp_seo) — sp-vue 는 CRUD 만, 렌더는 PHP.
- **nginx** (`ops/nginx/local-web.conf`) — `/app/`→5173·`/api/`→3333·`/market/`→5176·`/rnd/`→5177·`/`→8888. 4개 경로 모두 그누보드 예약.

## API Surface [coverage: high — 8 sources]

sp-vue 자체는 API 를 노출하지 않는 소비자다. 노출 표면은 **브라우저 라우트**(`/app` 하위):

| 라우트 | 화면 | 비고 |
|---|---|---|
| `/` | Home | DefaultLayout(최소 셸) |
| `/bom` | 고객 BOM 업로드 | **회원 전용**. Parts Eyes 셸(BomLayout) — 드래그&드롭 즉시 분석 이동, 사이드바 Recent file |
| **`/bom/search`** | 단일 부품 검색 | 카탈로그 열람 전용(`?q=`). 정확 MPN 은 DB/ES 즉답, 아니면 `parts-search/supplement` 자동 호출로 공급사 후보 인라인 표시 |
| **`/bom/history`** | 내 견적 전체 목록 | 파일·견적명 검색·상태 필터·페이지·개별/선택/전체 삭제(본인 draft 만) |
| `/bom/:id` | 견적 워크벤치 | 시트 다중 선택→build→수량·포함 편집(1s 자동저장)→[후보 비교] 패널·BOM 비교 모달→견적요청. "확인 중" 자동 보강 UI, 전체/시트별/직접추가 탭, AI 분석결과 2열 카드(필터 겸용), 검색 한도 경고 배너 |
| `/admin` | AdminDashboard | `requiresAdmin` 가드 |
| `/admin/quotes` | 견적 관리 | 목록·rfq 확정·거버 다운로드·A4 인쇄·견적서 발송(`EstimateSendControl`)·완전삭제 |
| `/admin/orders` | 주문내역 | 탭16·상세 드로어·`ORDER_PIPELINE` 스텝퍼·엑셀 배송·인쇄·취소/반품·알림 체크박스 |
| `/admin/members` | 회원 관리 | 목록·드로어·차단/레벨·회사명 프로필·Daum 주소 |
| `/admin/market/*` | 마켓 관리 4종 | experts(심사)·projects(모니터)·contracts(계약·정산 — lazy paid 승격·7일 자동확정 겸함)·settings(feeRateBp) |
| `/admin/slides` | 메인 슬라이드 | g5_shop_banner '메인' CRUD(multipart), 홈 owl 슬라이더가 소비 |
| `/admin/seo` | SEO 관리 | sp_seo upsert/DELETE, 소비는 sp-php SSR |
| `/admin/bom`, `/admin/bom/:id` | 공급사 검색 잡 | 엔진 잡 목록·상세(202→폴링), 자동 인제스트 확인 |
| `/admin/bom-quotes` | BOM 견적 검토 | 목록(기본 draft 제외)·상태 전이·확정가·회신 메모·원본 다운로드(서버 스트리밍)·라인 [후보·근거] 읽기 전용 |
| **`/admin/parts`** | 부품 카탈로그 | ES 검색(2트랙 SI+specVariants)+패싯+구매 조건 확장·부품 이미지·specConflicts 배지·단건 삭제(연결 시 409 `PART_IN_USE`)·**[필터 결과 전체 삭제]**(서버 미리보기 hash·`DELETE N` 확인·견적 연결분 보호)·[카탈로그 초기화](연결 BOM 견적 강제 삭제 경고) |
| `/admin/settings` | 설정 | 탭 4종: 사업자정보 / 거버 가격 / AI 연동(연결·유스케이스·샘플 테스트) / **BOM 견적 비용 정책 + 공급사 검색 운영** |

라우터 가드는 UX용 — **실제 보안은 sp-node 의 JWT 검증**(`requireAdmin`·`authenticate`). BOM 잡은 소유 회원만(타인 404 은닉), 일일 검색 한도 429.

## Data [coverage: high — 7 sources]

- sp-vue 는 DB 직접 접근 없음 — 전부 sp-node 경유(`sp_*`=Prisma 소유, `g5_*`=접근 카탈로그).
- 간접 저장소: BOM 견적 `sp_bom_quote`+`_item`+`_candidate`+`_selection_event`+`_sheet` + 분석 정본 `sp_bom_analysis_run/sheet/component` + 검색 실행·trace — **스냅샷 박제 원칙**(엔진 인메모리 잡 소멸에도 후보·근거 재현 가능). 부품 카탈로그 `sp_part*`(DB=진실원본, ES=파생물). 기존: 견적 `sp_quote`, 마켓 `sp_market_*`, SEO `sp_seo`, 설정 `sp_config`(+`bom_quote` 정책·환율 캐시)+`sp_ai_usecase`, 슬라이드·주문·회원 g5_*.
- **판정·계산은 서버, FE 는 소비만**: 합계는 서버 재계산(클라 금액 불신), 구매 조건 자동 선정·후보 순위·자동 보강 필요 판단 모두 서버. 생명주기 `enrichStatus`(idle|searching|done|failed)와 `buildStatus`(parsing→selecting→building→ready|failed)는 **서버 영속 단일 진실** — FE 는 라벨·배너·폴링만.
- **판정 필드 그대로 렌더 원칙(2026-07-21~26 강화)**: `procurementUnavailabilityReason`(out_of_stock / insufficient_stock / stock_unverified / catalog_inquiry)·`catalogInquiry`·`manualSelectable`·`requirement_assessments`·`localCatalogTrace`·`searchTrace`·`searchRequirements` 는 모두 sp-node 가 투영한 값이며 sp-vue 는 라벨·배지·정렬만 붙인다. 재고·필수조건을 다시 조합해 사유를 추론하지 않는다.
- 가격·수량 규칙은 `@sp/utils` bom-pricing 을 서버·FE 가 **같은 함수**로 공유(골든 14) — 구간가·`orderQty=max(BOM×(세트+예비),MOQ)` 배수 올림·pinned 재계산.
- 클라 상태: Pinia(auth 는 `@sp/shared`) + vue-query 도메인 쿼리키. BOM 상세는 PATCH 응답 `setQueryData` 직접 반영(예외적 무효화 생략 패턴). 카탈로그 초기화 mutation 은 `['admin','parts']` 외에 `['admin','bom-quotes']`·`['bom','quotes']` 까지 무효화한다(견적이 함께 지워지므로).
- AI 연동: `.env` > 관리자 저장값 > 기본값. API 키 원문은 응답에 없음(마스킹만).
- 알려진 한계(1차 허용): 카탈로그 직접 검색의 selectedOffer 는 클라 제출값(RFQ 모델이라 관리자 확정가가 정본) — 결제 연계 시 서버 선택 API 로 통합 필요. 배송처리는 수동(택배사 API 보류).

## Key Decisions [coverage: high — 12 sources]

1. **2026-07-26 — 자체 카탈로그 우선 조회를 "검색 과정" 첫 단계로 표시**: R/C(SamplePCB 스펙)·connector(exact MPN) 로컬 조회를 외부 공급사 trace 로 위장하지 않고 `localCatalogTrace` 전용 카드로 항상 1번에 놓고 **`로컬 ES · API 0회`** 를 명시. 구형 실행은 `localCatalogTrace=null` 로 읽기 호환.
2. **2026-07-26 — 제조사 카탈로그 부품 = "문의 견적"(금액 없는 선정)**: 가격·재고가 없는 `offer_kind='manufacturer_catalog'` 후보를 미매칭이 아니라 **`선정됨 · 재고/가격 문의` / `문의 견적`** 으로 표시하고 선정 집계에 포함하되 합계에는 금액을 넣지 않는다. 행·후보 카드·구매 조건 목록·부품 변경 패널·구매 조건 모달 5곳이 같은 어휘를 쓴다.
3. **2026-07-26 — 카탈로그 파괴 작업 2종을 다른 안전 등급으로 분리**: [필터 결과 전체 삭제]는 서버 미리보기(전건 ID·구매 조건·카탈로그 원본 SHA·견적 참조) + hash + `DELETE N` 타이핑 확인이고 **견적 연결 부품은 보호**(보호 건수를 결과에 보고). [카탈로그 초기화]는 반대로 `RESET_WITH_QUOTES` 확인 후 **연결 BOM 견적을 상태와 무관하게 강제 삭제**한다 — partId 뿐 아니라 selectedOffer·matchStatus 흔적만 남은 라인까지 대상.
4. **2026-07-24 — 행별 검색조건 보완을 후보 패널에서**: 원본 추출값을 고치지 않고 `searchRequirements` 를 별도 저장하는 폼을 부품 유형 9종(resistor·capacitor·inductor·crystal·diode·transistor·led·switch·connector)별로 동적 구성. 저장 시 해당 행만 재검색하며 `검색 제외` 행은 폼 자체를 잠근다.
5. **2026-07-22 — 정확 MPN 우선 선정은 하되 불일치를 숨기지 않는다**: 정규화 MPN 이 정확 일치하면 필수조건 불일치가 있어도 자동 선정하고 금액에 반영하되, 행 배지와 후보 근거에 `품번 일치 우선 선정 · 추가 정보 불일치` 와 항목별 기대값/실제값 툴팁을 병기.
6. **2026-07-21 — "공급사 원응답"과 "최종 후보"를 표기로 분리**: 검색 과정의 건수는 가공 전 API/캐시 응답(`공급사 원응답 N건`)이고 후보 목록은 `기술 검증·중복 제거 후 최종 후보 N개`라는 안내를 i18n `bomSearchTrace` 사전으로 고정. 두 숫자가 달라 보이는 것을 결함으로 오인하던 문제 교정.
7. **2026-07-20 — 행 단위 렌더 격리**: `BomQuoteRow` 분리 + 참조 안정 동기화 + PATCH `setQueryData` 로 수량 편집 12~16ms→0.6~3ms. DOM 변형이 편집 행 1개에 국한됨을 MutationObserver 실측.
8. **2026-07-20 — [후보 비교] 우측 패널로 통합**: 기존 [변경]+[상세]+가격구간 확장을 단일 패널로 — 원본 BOM·자동 추천 이유·기술/가격 순위·차액·공급사 구매 조건 명시 선택·검색 과정을 한 흐름에. 관리자는 같은 스냅샷을 읽기 전용으로 추적(고객/관리자 판정 일치 실증).
9. **2026-07-20/23 — 단일 검색은 하이브리드**: `/bom/search` 는 카탈로그 즉답 + 비적중 시 공급사 보충 검색 자동 호출. 인제스트 완료를 기다리지 않고 `inlineOffers` 로 먼저 보여주되, 견적 부품 변경 문맥만 `waitForCatalog=true`(영속 partId 필요).
10. **2026-07-19 — sp-vue 일반(회원) 라우트 그룹 신설**: "/app=관리자 전용" 전제 공식 변경(router.ts 주석 정본). `/app/bom` 회원 전용, `requiresMember`=그누보드 로그인 왕복. 코드리뷰 #6 이 별도 소비자 앱 분리 선택지를 기록했으나 현 구조로 진행(lazy loading 은 후속).
11. **2026-07-19 — 조용한 자동 보강**: 고객에게 "공급사 검색" 개념 비노출 — build 직후 서버가 판단·실행, FE 는 `enrichStatus` 기반 "확인 중" 라벨·배너만. searching 동안 FE·PATCH 잠금, 빨간 미매칭은 done/failed 후 최종 판정에만.
12. **2026-07-19 — Parts Eyes 셸 Figma 이식**: "Smart BOM_Web 2.0" 픽셀 충실 이식, 다크 배경은 사용자 결정으로 라이트 치환. 프로토타입 선언의 첫 예외(확정 디자인).
13. **2026-07-18 — 부품 카탈로그 관리 화면**: `/app/admin/parts` — 단위 지능은 ES 애널라이저가 아닌 TS 코드(`spec-units.ts`), 검색 2트랙(SI range ±0.1% + specVariants prefix), 해석은 should 가산점만.
14. **2026-07-04~12 — 관리 표면 sp-vue 이관 + 분리 패턴 확립**: 레거시 `/adm/*` 에서 견적·회원·주문·설정 이관, 거버 가격모드 전역 스위치·`ORDER_PIPELINE` SSOT, 마켓 관리 4종(소비는 sp-market), SEO·슬라이드는 "관리=sp-vue / 소비=sp-php SSR", AI 는 연결(sp_config)/유스케이스(sp_ai_usecase) 분리로 새 유스케이스 시 FE 자동. placeholder 라우트는 두지 않는다.
15. **(플랫폼 초기) 같은 도메인 경로 분기 + 계약 우선 + 마운트 전 부트스트랩 + 판정은 서버**: nginx 한 호스트 `/`·`/app`·`/market`·`/rnd`·`/api`, base 변경 금지. Zod 단일 진실원본, 첫 렌더 전 세션 복원, UI 는 프로토타입 선언(ko 실서비스·en 스텁).

## Gotchas [coverage: high — 9 sources]

- **역할 서술 문서 불일치**: 루트 AGENTS.md 표는 여전히 "sp-vue (관리자)", 모노 AGENTS.md 는 "실질 기본 용도는 관리자 화면" — 2026-07-19 이후 정본은 router.ts 주석+BOM_QUOTE.md 의 "일반(회원) 라우트 그룹 신설". 문서 간 표현이 아직 완전 동기화되지 않았다.
- **라우트 lazy loading 여전히 미적용**: `router.ts` 가 20+ 페이지를 전부 정적 import — 고객 `/bom` 방문자도 관리자 화면 코드를 함께 내려받는다. 07-19 측정치 776KB 는 이후 web 소스가 6,500줄 이상 늘었으므로 재측정 필요(코드리뷰 P1, 후속 과제).
- **엔진 판정을 FE 가 재구성하지 말 것**: 재고 사유·필수조건·선택 자격은 서버 필드를 그대로 표시한다. 특히 "금액 없음"이 곧 미선정이 아니다 — `catalogInquiry` 행은 선정 상태이면서 `lineTotalKrw=null` 이다(합계엔 불포함, 집계엔 포함).
- **검색 과정 건수 오독**: 공급사 원응답 건수 ≠ 최종 후보 수. 후보가 줄어 보인다는 신고는 대개 기술 검증·중복 제거 결과이며, 화면은 두 숫자를 다른 문구로 구분해 표시한다.
- **BOM 워크벤치 상태 판정 함정**: `items.length===0` 은 분석 중 신호가 아님(`buildStatus` 로 판정). done 뒤 카탈로그 재매칭 호출 금지(엔진 검토/충돌 판정을 덮어씀). searching 중엔 PATCH 도 잠가 replace-all 경합 방지.
- **[카탈로그 초기화]는 견적까지 지운다**: 개발 중 카탈로그를 비우면 그 카탈로그를 참조하던 BOM 견적이 상태와 무관하게 함께 삭제된다(테스트 데이터 유실 주의). 부분 정리는 [필터 결과 전체 삭제] 쪽이 견적 연결분을 보호한다.
- **`any`/`as any`/`@ts-ignore` 금지**(불가피하면 `@ts-expect-error` + 사유). ESLint error.
- **Windows Vite host 함정**: `host: '127.0.0.1'` 필수(기본 localhost 는 IPv6 만 → nginx 502), `allowedHosts` 누락 시 403. turbo 는 Windows 에서 깨짐 — `pnpm -r typecheck`/`lint` 우회.
- 라우터 가드는 보안 경계가 아님 — sp-node `requireAdmin`/`authenticate` 가 진짜 경계. BOM 잡 소유 검증·일일 한도도 서버.
- **AI 연동 env 우선**: `.env` 의 AI_BASE_URL/AI_API_KEY 가 있으면 화면 입력 잠김("저장했는데 안 바뀜"의 원인). 인터뷰 UI 는 structurize 활성+동의 게이트.
- **알림 체크박스는 서버 게이트**: 설정 꺼진 채널은 목록·상세 모두 숨김(코어 orderlist 무조건 노출 결함의 의도적 패리티 이탈). "안 보임"은 `cf_email_use`/`cf_sms_use` 설정 문제.
- 드로어 내 드롭다운은 컨텍스트별 방향 지정 필요(`EstimateSendControl` `align='right'`). 간접 주의: 공유 DB — 모노레포에서 `prisma migrate reset` 절대 금지(g5_* 드랍).

## Sources [coverage: high — 36 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 호칭·nginx 라우팅(+`/rnd`)·인증 브리지
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·apps/rnd 신설·"실질 기본 용도" 표현
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — 고객 스마트 BOM 정본: 회원 라우트 그룹·자동 보강·후보 패널·검색 과정 provenance·문의 견적·렌더 최적화·Parts Eyes 셸·단일 검색
- [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) — 부품 카탈로그·AdminParts·유형별 로컬 우선 조회·삭제/초기화 정책·부품 정본/자체 구매 조건·이미지
- [docs/bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md) — P1/P2 보완 항목·776KB 번들·앱 위치 정책 선택지
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) — AdminSeo·관리/소비 분리
- [docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) — GerberPricingForm·sp_config
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 마켓 관리 4종·계약 드로어
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — AI 연동 탭·유스케이스 계층·샘플 테스트·env 우선
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 관리자 이관 서사·주문 상태 체계
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 알림 체크박스 서버 게이트
- [docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 배송 수동 방식·자동화 보류
- [docs/DB_TUNING.md](../../docs/DB_TUNING.md) — 견적 대량 삭제의 DB 레버(BomHistory 삭제 경로 배경)
- [apps/web/src/router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts) — 전제 변경 주석·requiresMember·BomLayout·정적 세그먼트 우선·라우트 전체
- [apps/web/src/main.ts](../../samplepcb-web-mono-app/apps/web/src/main.ts) — 부트스트랩 순서
- [apps/web/package.json](../../samplepcb-web-mono-app/apps/web/package.json) · [vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts) — host·allowedHosts·proxy
- [apps/web/src/layouts/BomLayout.vue](../../samplepcb-web-mono-app/apps/web/src/layouts/BomLayout.vue) — Parts Eyes 셸·사이드바 메뉴(단일 검색·Recent file·모두 보기)·패널 접기
- [apps/web/src/pages/bom/BomQuote.vue](../../samplepcb-web-mono-app/apps/web/src/pages/bom/BomQuote.vue) — 워크벤치·AI 분석결과 2열 카드 필터·진행 배너·검색 한도 경고
- [apps/web/src/pages/bom/BomSearch.vue](../../samplepcb-web-mono-app/apps/web/src/pages/bom/BomSearch.vue) · [BomHistory.vue](../../samplepcb-web-mono-app/apps/web/src/pages/bom/BomHistory.vue) — 단일 검색·견적 이력
- [apps/web/src/components/bom/BomCandidateDrawer.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomCandidateDrawer.vue) — 후보 비교 패널·검색 과정·로컬 카탈로그 카드·검색조건 보완 폼·문의 견적 어휘
- [apps/web/src/components/bom/BomQuoteRow.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomQuoteRow.vue) — 행 격리·재고/문의 배지·과다 주문수량·호출 상한 미검색
- [apps/web/src/components/bom/BomPartOfferOptions.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPartOfferOptions.vue) · [BomPartSearchPanel.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPartSearchPanel.vue) — 부품 변경·구매 조건 비교(browse/select)
- [apps/web/src/components/bom/BomQuoteOfferModal.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomQuoteOfferModal.vue) · [BomPriceBreaks.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPriceBreaks.vue) — 구매 조건 선택·가격구간 공용 조각
- [apps/web/src/components/bom/BomPartSearchNotice.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPartSearchNotice.vue) — 공급사 보충 검색 자동 호출
- [apps/web/src/bom/extraction-display.ts](../../samplepcb-web-mono-app/apps/web/src/bom/extraction-display.ts) — 추출 필드 라벨·근거·확신도 매핑
- [apps/web/src/i18n/locales/ko.ts](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/ko.ts) · [en.ts](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/en.ts) — `bomSearchTrace` 사전(전략·출처·결과·fallback 사유)
- [apps/web/src/admin/useAdminParts.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminParts.ts) — 검색·상세·갱신·단건/필터/초기화 삭제 훅과 캐시 무효화 범위
- [apps/web/src/pages/admin/AdminParts.vue](../../samplepcb-web-mono-app/apps/web/src/pages/admin/AdminParts.vue) — 검색 콘솔·2단계 인라인 확인·삭제 미리보기(카탈로그 원본 SHA)·문의 견적 표기
- [apps/web/src/components/admin/BomQuoteSettingsForm.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/BomQuoteSettingsForm.vue) · [SettingsTabs.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/SettingsTabs.vue) — 비용 정책·공급사 검색 운영 패널·탭 4종
- [apps/web/src/components/admin/EstimateSendControl.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/EstimateSendControl.vue) — 발송 컨트롤·align 방향
