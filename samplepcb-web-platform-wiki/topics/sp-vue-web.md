---
topic: sp-vue-web
last_compiled: 2026-07-20
sources_count: 20
status: active
---

# sp-vue-web

## Purpose [coverage: high — 6 sources]

`sp-vue` — samplepcb 신규 화면 영역의 **Vue 3 SPA** (`samplepcb-web-mono-app/apps/web`, 패키지명 `web`). 그누보드5/영카트(`sp-php`)와 **같은 도메인**에서 nginx 로 합류하며 `/app` 경로에 마운트된다(`base: '/app/'` 고정). 별칭 규칙상 "web" 호칭은 금지(PHP `samplepcb-web/` 와 혼동) — 문서·커밋에서는 `sp-vue`.

**역할 전제 변경(2026-07-19)**: 기존 "sp-vue `/app` = 관리자 콘솔 전용" 전제가 고객 스마트 BOM 견적(`/app/bom`, **회원 전용**) 도입으로 공식 변경됐다 — sp-vue 는 이제 **관리자 콘솔 + 일반(회원) 화면을 함께 담는다**(router.ts 주석이 선언 정본). 고객 단순 화면은 여전히 sp-php(`/`), 재능마켓 소비자 SPA 는 별도 앱 `sp-market`(`/market`)이며, SPA 급 인터랙션 화면만 `/app` 또는 `/market` 에 둔다. 형제 앱 `apps/rnd`(`/rnd`:5177, 연구·실험용 독립 SPA, 2026-07-17)는 sp-vue 와 별개다.

관리자 콘솔(`/app/admin`)은 최고관리자(cf_admin) 전용 — 그누보드 3계층 관리자(`/adm`)와 병행 존속. 2026-07 들어 관리자 표면이 견적·회원·주문·설정 + 마켓 4종·SEO·슬라이드·AI 연동에 더해 **공급사 검색(BOM 잡)·BOM 견적 검토·부품 카탈로그**로 확장됐다. UI·스타일은 여전히 프로토타입 선언이나, 고객 BOM 셸은 Figma "Smart BOM_Web 2.0" 픽셀 이식으로 예외적 확정 디자인.

## Architecture [coverage: high — 9 sources]

- **스택**: Vite + Vue 3 + TypeScript + Vue Router 4 + Pinia + @tanstack/vue-query + Tailwind v4(`@tailwindcss/vite`) + vue-i18n. 폰트 Pretendard variable.
- **모노레포 구성원**: pnpm workspaces + Turborepo. workspace 의존성 `@sp/api-contract`(Zod 계약)·`@sp/shared`(API 클라이언트·vue-query 훅·Pinia auth store)·`@sp/utils`(bom-pricing·spec-units 등 FE/BE 공용 순수 함수)·`@sp/config`.
- **src 구조**:
  - `main.ts` — pinia → i18n → vue-query 설치, **마운트 전 `useAuthStore(pinia).bootstrap()`** 후 router 설치(순서 필수 — 딥링크가 빈 auth 가드에 튕김).
  - `router.ts` — `createWebHistory('/app/')`. 레이아웃 3종: `DefaultLayout`(홈 셸)·`AdminLayout`(`meta.requiresAdmin`)·**`BomLayout`**(고객 BOM 전용 셸, `meta.requiresMember`). meta 에 `wide`(넓은 본문) 추가.
  - `pages/admin/` 15종 — 기존 11종 + `AdminBom`(공급사 검색 잡 목록)·`AdminBomJob`(잡 상세)·`AdminBomQuotes`(BOM 견적 검토)·`AdminParts`(부품 카탈로그).
  - `pages/bom/` — `BomHome`(업로드+내 견적 이력)·`BomQuote`(견적 워크벤치).
  - `components/bom/` 7종 — **`BomQuoteRow`**(행 단위 렌더 격리)·`BomCandidateDrawer`(후보 비교 패널)·`BomCompareModal`(Excel↔공급사 대조)·`BomPartSearchModal/Panel`·`BomOfferModal`·`BomQuoteOfferModal`.
  - `admin/` — `menu.ts` + vue-query 훅 11종(`useAdminQuotes/Members/Orders/Settings/Market/Slides/Seo` + **`useAdminBom`·`useAdminBomQuotes`·`useAdminParts`**).
- **설정 페이지 탭 4종**: `businessInfo` · `gerberPricing` · `aiIntegration` · **`bomQuote`**(운송료·관리비·환율 방식·안전계수·검색 한도·신선 임계 + [지금 갱신]). 탭 추가 = `SettingsTabs` TABS 배열 + 패널 스위치 한 줄.
- **렌더 성능 구조(2026-07-20)**: 수백 행 워크벤치에서 ① `BomQuoteRow` 가 item 참조를 그대로 받고 변경은 emit — 참조 안 바뀐 행은 patch 스킵 ② `watch(detail)` 이 vue-query structural sharing 참조를 추적해 안 바뀐 행의 로컬 클론 재사용 ③ 자동저장 `usePatchBomQuote` 는 `['bom']` 무효화 대신 PATCH 응답을 `setQueryData` 로 캐시 직접 반영(저장마다 GET 리페치 제거). 수량 편집 12~16ms→0.6~3ms 실측. 2,000행 상한의 최초 마운트 가상 스크롤은 비병목 판단으로 보류.
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint strictTypeChecked, `no-explicit-any`=error.
- **dev 서버**: 포트 5173, `host: '127.0.0.1'`(Windows IPv6 문제로 nginx 502 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`, proxy `/api`→3333·`/spcb`→8888.

## Talks To [coverage: high — 7 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 유일한 데이터 통로. 관리 화면은 `/api/admin/*`(Bearer JWT, `requireAdmin`), 고객 BOM 은 **`/api/bom`(회원 `authenticate` — 첫 비관리자 API 소비면)**. 계약은 `@sp/api-contract`(Zod) FE/BE 공유.
- **sp-engine** (:8400, Python) — 직접 통신 없음. BOM 파싱·공급사 검색(Mouser/DigiKey/UniKeyIC)은 sp-node 잡 프록시(`/api/bom/jobs/:id`, `/api/admin/bom/*`) 경유, sp-vue 는 3초 폴링·진행 표시만.
- **Elasticsearch** (sp-parts) — 직접 통신 없음. `/app/admin/parts` 가 `GET /api/admin/parts/search`(ES 다중해석 쿼리) 를 소비, ES 다운 시 503 SEARCH_UNAVAILABLE 표시.
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드 IdP. `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) 발급. `requiresMember` 가드는 비로그인 시 **그누보드 로그인 왕복**(`loginUrl` — 로그인 후 원래 경로 복귀).
- **sp-market** (`/market`, :5176) — 마켓 관리 표면(`/app/admin/market/*`)을 sp-vue 가 담당하는 짝 관계. 라벨 사전(`MARKET_*_LABELS`) 계약 공유.
- **"관리=sp-vue / 소비=sp-php" 짝**: 슬라이드(`AdminSlides` ↔ `theme/sp-lite/inc/main_slider.php`, g5_shop_banner '메인')·SEO(`AdminSeo` ↔ 테마 `head.sub.php` SSR, sp_seo) — sp-vue 는 CRUD 만, 렌더는 PHP.
- **nginx** (`ops/nginx/local-web.conf`) — `/app/`→5173·`/api/`→3333·`/market/`→5176·**`/rnd/`→5177**·`/`→8888. 4개 경로 모두 그누보드 예약.

## API Surface [coverage: high — 8 sources]

sp-vue 자체는 API 를 노출하지 않는 소비자다. 노출 표면은 **브라우저 라우트**(`/app` 하위):

| 라우트 | 화면 | 비고 |
|---|---|---|
| `/` | Home | DefaultLayout(최소 셸) |
| **`/bom`** | 고객 BOM 업로드 | **회원 전용**. Parts Eyes 셸(BomLayout) — 드래그&드롭 업로드 즉시 분석 이동, Recent file=내 견적 4건 |
| **`/bom/:id`** | 견적 워크벤치 | 시트 다중 선택→build→수량·포함 편집(1s 자동저장)→[후보 비교] 패널·BOM 비교 모달→견적요청. "확인 중" 자동 보강 UI, 세트/예비 스테퍼, 예상 견적(VAT 별도) |
| `/admin` | AdminDashboard | `requiresAdmin` 가드 |
| `/admin/quotes` | 견적 관리 | 목록·rfq 확정·거버 다운로드·A4 인쇄·견적서 발송(`EstimateSendControl`)·완전삭제 |
| `/admin/orders` | 주문내역 | 탭16·상세 드로어·`ORDER_PIPELINE` 스텝퍼·엑셀 배송·인쇄·취소/반품·알림 체크박스 |
| `/admin/members` | 회원 관리 | 목록·드로어·차단/레벨·회사명 프로필·Daum 주소 |
| `/admin/market/*` | 마켓 관리 4종 | experts(심사)·projects(모니터)·contracts(계약·정산 — lazy paid 승격·7일 자동확정 겸함)·settings(feeRateBp) |
| `/admin/slides` | 메인 슬라이드 | g5_shop_banner '메인' CRUD(multipart), 홈 owl 슬라이더가 소비 |
| `/admin/seo` | SEO 관리 | sp_seo upsert/DELETE, 소비는 sp-php SSR |
| **`/admin/bom`, `/admin/bom/:id`** | 공급사 검색 잡 | 엔진 잡 목록·상세(202→폴링), 자동 인제스트 확인 |
| **`/admin/bom-quotes`** | BOM 견적 검토 | 목록(기본 draft 제외)·상태 전이·확정가·회신 메모·원본 다운로드(서버 스트리밍)·라인 [후보·근거] 읽기 전용 |
| **`/admin/parts`** | 부품 카탈로그 | ES 검색(2트랙 SI+specVariants)+패싯+오퍼 확장·부품 이미지·specConflicts 배지·단건 삭제·[카탈로그 초기화] |
| `/admin/settings` | 설정 | 탭 4종: 사업자정보 / 거버 가격 / AI 연동(연결·유스케이스·샘플 테스트) / **BOM 견적 비용 정책** |

라우터 가드는 UX용 — **실제 보안은 sp-node 의 JWT 검증**(`requireAdmin`·`authenticate`). BOM 잡은 소유 회원만(타인 404 은닉), 일일 검색 한도 429.

## Data [coverage: high — 7 sources]

- sp-vue 는 DB 직접 접근 없음 — 전부 sp-node 경유(`sp_*`=Prisma 소유, `g5_*`=접근 카탈로그).
- 간접 저장소: BOM 견적 `sp_bom_quote`+`_item`+`_candidate`+`_selection_event`+`_sheet`(5테이블) — **스냅샷 박제 원칙**(selectedOffer·orderQty·matchEvidence·후보를 견적 문맥으로 동결, 엔진 인메모리 잡 소멸에도 재현 가능). 부품 카탈로그 `sp_part*`(DB=진실원본, ES=파생물). 기존: 견적 `sp_quote`, 마켓 `sp_market_*`, SEO `sp_seo`, 설정 `sp_config`(+`bom_quote` 정책·환율 캐시)+`sp_ai_usecase`, 슬라이드·주문·회원 g5_*.
- **판정·계산은 서버, FE 는 소비만**: 합계는 서버 재계산(클라 금액 불신), 오퍼 자동 선정(`pickDefaultOffer`)·하이브리드 추천(engine-hybrid-physical-v3)·자동 보강 필요 판단 모두 서버. 자동 보강 생명주기 `enrichStatus`(idle|searching|done|failed)와 `buildStatus`(parsing→selecting→building→ready|failed)는 **서버 영속 단일 진실** — FE 는 라벨·배너·폴링만. 알림 게이트(`useAdminNotifyConfig`)·마켓 paid 승격도 동일 원칙.
- 가격·수량 규칙은 `@sp/utils` bom-pricing 을 서버·FE 가 **같은 함수**로 공유(골든 14) — 구간가·`orderQty=max(BOM×(세트+예비),MOQ)` 배수 올림·pinned 재계산.
- 클라 상태: Pinia(auth 는 `@sp/shared`) + vue-query 도메인 쿼리키. BOM 상세는 PATCH 응답 `setQueryData` 직접 반영(예외적 무효화 생략 패턴).
- AI 연동: `.env` > 관리자 저장값 > 기본값. API 키 원문은 응답에 없음(마스킹만).
- 알려진 한계(1차 허용): 카탈로그 직접 검색의 selectedOffer 는 클라 제출값(RFQ 모델이라 관리자 확정가가 정본) — 결제 연계 시 서버 선택 API 로 통합 필요. 배송처리는 수동(택배사 API 보류).

## Key Decisions [coverage: high — 10 sources]

1. **2026-07-20 — 행 단위 렌더 격리**: `BomQuoteRow` 분리 + 참조 안정 동기화 + PATCH `setQueryData` 로 수량 편집 12~16ms→0.6~3ms. DOM 변형이 편집 행 1개에 국한됨을 MutationObserver 실측.
2. **2026-07-20 — [후보 비교] 우측 패널로 통합**: 기존 [변경]+[상세]+가격구간 확장을 단일 패널로 — 자동 추천 이유·기술/가격 순위·차액·공급사 오퍼 명시 선택. 관리자는 같은 후보 스냅샷을 읽기 전용으로 추적(고객/관리자 판정 일치 실증).
3. **2026-07-19 — sp-vue 일반(회원) 라우트 그룹 신설**: "/app=관리자 전용" 전제 공식 변경(router.ts 주석 정본). `/app/bom` 회원 전용, `requiresMember`=그누보드 로그인 왕복. 코드리뷰 #6 이 별도 소비자 앱 분리 선택지를 기록했으나 현 구조로 진행(lazy loading 은 후속).
4. **2026-07-19 — 조용한 자동 보강**: 고객에게 "공급사 검색" 개념 비노출 — build 직후 서버가 판단·실행, FE 는 `enrichStatus` 기반 "확인 중" 라벨·배너만. searching 동안 FE·PATCH 잠금, 빨간 미매칭은 done/failed 후 최종 판정에만.
5. **2026-07-19 — Parts Eyes 셸 Figma 이식**: "Smart BOM_Web 2.0" 픽셀 충실 이식, 다크 배경은 사용자 결정으로 라이트 치환. 프로토타입 선언의 첫 예외(확정 디자인).
6. **2026-07-18 — 부품 카탈로그 관리 화면**: `/app/admin/parts` — 단위 지능은 ES 애널라이저가 아닌 TS 코드(`spec-units.ts`), 검색 2트랙(SI range ±0.1% + specVariants prefix), 해석은 should 가산점만.
7. **2026-07-12 — AI 설정은 범용 유스케이스 계층**: 연결(sp_config)과 유스케이스(sp_ai_usecase) 분리, 새 유스케이스 추가 시 FE 화면 자동(lazy 행·목록 렌더). 저장 전 비식별 샘플 테스트 실행 추가.
8. **2026-07-10 — SEO "관리=sp-vue / 소비=sp-php"**: meta 는 sp-php SSR 필수(크롤러), sp-vue 는 관리 UI 전용. 슬라이드 이관과 같은 분리 패턴.
9. **2026-07-08 — 마켓 관리 표면은 sp-vue**: 소비자는 sp-market, 관리는 `/app/admin/market/*` 4종.
10. **2026-07-05 — 거버 가격모드 전역 스위치 + PCB 제작 8단계 선형 스텝퍼**: sp_config 설정으로 견적 엔진 밖 후처리 / `ORDER_PIPELINE` SSOT 파생.
11. **2026-07-04~05 — 관리자 화면 sp-vue 이관**: 레거시 `/adm/*` 에서 견적·회원·주문·설정 이관. placeholder 라우트는 두지 않는다(기능 생길 때 라우트·메뉴·i18n 동시 추가).
12. **(플랫폼 초기) 같은 도메인 경로 분기 + 계약 우선 + 마운트 전 부트스트랩 + 판정은 서버**: nginx 한 호스트 `/`·`/app`·`/market`·`/rnd`·`/api`, base 변경 금지. Zod 단일 진실원본, 첫 렌더 전 세션 복원, UI 는 프로토타입 선언(ko 실서비스·en 스텁).

## Gotchas [coverage: high — 8 sources]

- **역할 서술 문서 불일치**: 루트 AGENTS.md 표는 여전히 "sp-vue (관리자)", 모노 AGENTS.md 는 "실질 기본 용도는 관리자 화면" — 2026-07-19 이후 정본은 router.ts 주석+BOM_QUOTE.md 의 "일반(회원) 라우트 그룹 신설". 문서 간 표현이 아직 완전 동기화되지 않았다.
- **단일 번들 776KB**: 라우트 lazy loading 미적용 — 고객 `/bom` 방문자도 관리자 화면 코드를 함께 내려받는다(코드리뷰 P1 기록, 후속 과제).
- **BOM 워크벤치 상태 판정 함정**: `items.length===0` 은 분석 중 신호가 아님(`buildStatus` 로 판정). done 뒤 카탈로그 재매칭 호출 금지(엔진 검토/충돌 판정을 덮어씀). searching 중엔 PATCH 도 잠가 replace-all 경합 방지.
- **`any`/`as any`/`@ts-ignore` 금지**(불가피하면 `@ts-expect-error` + 사유). ESLint error.
- **Windows Vite host 함정**: `host: '127.0.0.1'` 필수(기본 localhost 는 IPv6 만 → nginx 502), `allowedHosts` 누락 시 403. turbo 는 Windows 에서 깨짐 — `pnpm -r typecheck`/`lint` 우회.
- 라우터 가드는 보안 경계가 아님 — sp-node `requireAdmin`/`authenticate` 가 진짜 경계. BOM 잡 소유 검증·일일 한도도 서버.
- **AI 연동 env 우선**: `.env` 의 AI_BASE_URL/AI_API_KEY 가 있으면 화면 입력 잠김("저장했는데 안 바뀜"의 원인). 인터뷰 UI 는 structurize 활성+동의 게이트.
- **알림 체크박스는 서버 게이트**: 설정 꺼진 채널은 목록·상세 모두 숨김(코어 orderlist 무조건 노출 결함의 의도적 패리티 이탈). "안 보임"은 `cf_email_use`/`cf_sms_use` 설정 문제.
- 드로어 내 드롭다운은 컨텍스트별 방향 지정 필요(`EstimateSendControl` `align='right'`).
- 간접 주의: 공유 DB — 모노레포에서 `prisma migrate reset` 절대 금지(g5_* 드랍). BOM 견적 `mbId` 60자 vs 플랫폼 191자 불일치(코드리뷰 P1 — ALTER 후속).

## Sources [coverage: high — 20 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 호칭·nginx 라우팅(+`/rnd`)·인증 브리지
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·apps/rnd 신설·"실질 기본 용도" 표현
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — 고객 스마트 BOM 정본: 회원 라우트 그룹·자동 보강·후보 패널·렌더 최적화·Parts Eyes 셸
- [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) — 부품 카탈로그·AdminParts·부품 정본/자체 오퍼·이미지
- [docs/bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md) — P1/P2 보완 항목·776KB 번들·앱 위치 정책 선택지
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) — AdminSeo·관리/소비 분리
- [docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) — GerberPricingForm·sp_config
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 마켓 관리 4종·계약 드로어
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — AI 연동 탭·유스케이스 계층·샘플 테스트·env 우선
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 관리자 이관 서사·주문 상태 체계
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 알림 체크박스 서버 게이트
- [docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 배송 수동 방식·자동화 보류
- [apps/web/src/router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts) — 전제 변경 주석·requiresMember·BomLayout·라우트 전체
- [apps/web/src/main.ts](../../samplepcb-web-mono-app/apps/web/src/main.ts) — 부트스트랩 순서
- [apps/web/package.json](../../samplepcb-web-mono-app/apps/web/package.json)
- [apps/web/vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts) — host·allowedHosts·proxy
- [apps/web/src/components/admin/SettingsTabs.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/SettingsTabs.vue) — 설정 탭 4종(bomQuote 추가)
- [apps/web/src/admin/useAdminSeo.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminSeo.ts)
- [apps/web/src/admin/useAdminSlides.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminSlides.ts)
- [apps/web/src/components/admin/EstimateSendControl.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/EstimateSendControl.vue) — 발송 컨트롤·align 방향
