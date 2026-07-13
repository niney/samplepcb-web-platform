---
topic: sp-vue-web
last_compiled: 2026-07-13
sources_count: 17
status: active
---

# sp-vue-web

## Purpose [coverage: high — 6 sources]

`sp-vue` — samplepcb 신규 화면 영역의 **Vue 3 SPA** (`samplepcb-web-mono-app/apps/web`, 패키지명 `web`). 그누보드5/영카트(`sp-php`)와 **같은 도메인**에서 nginx 로 합류하며 `/app` 경로에 마운트된다(`base: '/app/'` 고정). 별칭 규칙상 "web" 호칭은 금지(PHP `samplepcb-web/` 와 혼동) — 문서·커밋에서는 `sp-vue`.

**플랫폼 결정**: 고객 대면 페이지는 `sp-php`(`/`)에, SPA급 인터랙션이 필요한 신규 소비자 서비스는 별도 앱 `sp-market`(`/market`, 2026-07-08 신설)에 두고, **sp-vue `/app` 은 관리자 콘솔 전용이다**. 2026-07-06 이후 관리자 표면이 크게 확장됐다 — 기존 견적·회원·주문·설정에 더해 **재능마켓 관리 4종(전문가/프로젝트/계약/설정), SEO 관리(sp_seo), 메인 슬라이드 관리, AI 연동 설정, 거버 가격모드**가 추가됐다. UI·레이아웃·스타일은 여전히 프로토타입(placeholder) 선언(모노레포 AGENTS.md) — 확정 디자인시스템 도입 전까지 자유롭게 교체 가능.

이 관리자 콘솔은 최고관리자(cf_admin) 전용이다 — 그누보드 3계층 관리자(`/adm`)와 병행 존속하며, 삭제·포인트·엑셀 일괄수정 등 일부 작업은 `/adm` 에 위임한다.

## Architecture [coverage: high — 7 sources]

- **스택**: Vite + Vue 3 + TypeScript + Vue Router 4 + Pinia + @tanstack/vue-query + Tailwind v4(`@tailwindcss/vite`) + vue-i18n. 폰트 Pretendard variable.
- **모노레포 구성원**: pnpm workspaces + Turborepo. workspace 의존성 `@sp/api-contract`(Zod 계약)·`@sp/shared`(API 클라이언트 `apiGet`/`apiSend`/`apiSendForm`·vue-query 훅·Pinia auth store)·`@sp/utils`·`@sp/config`.
- **src 구조**:
  - `main.ts` — pinia → i18n → vue-query → router 설치 후, **마운트 전 `useAuthStore(pinia).bootstrap()`** 로 인증 브리지 세션 복원 → `app.mount('#app')`.
  - `router.ts` — `createWebHistory('/app/')`. `/`(DefaultLayout→Home 최소 셸), `/admin`(AdminLayout, `meta.requiresAdmin`) 하위 11개 실 라우트. **placeholder 라우트는 제거됨** — "미구현 메뉴는 placeholder 로 두지 않고 제거, 기능이 생길 때 라우트·메뉴·i18n 을 함께 추가"(router.ts 주석).
  - `pages/admin/` — `AdminDashboard`·`AdminQuotes`·`AdminOrders`·`AdminMembers`·`AdminMarket{Experts,Projects,Contracts,Settings}`·`AdminSlides`·`AdminSeo`·`AdminSettings` (11 페이지).
  - `components/admin/` — 견적(`Quote*` 상세 드로어·`EstimateModal`/`EstimateSheet` A4 인쇄·**`EstimateSendControl`**(견적서 메일/알림톡 발송 드롭다운)·완전삭제 모달), 회원(`Member*`), 주문(`OrderDetailDrawer`·`OrderStatusStepper`·`OrderActionBar`·`OrderFilterBar`·`OrderStatusTabs`·`OrdersTable`·`ExcelDeliveryModal`·`OrderPrintSheet`/`OrderPrintModal`·`OrderForceStatusModal`·`OrderItemCancelModal`·`OrderDeleteModal`·`OrderActionResult`), 설정(`SettingsTabs`·`BusinessInfoForm`·**`GerberPricingForm`**·**`AiSettingsForm`**).
  - `admin/` — `menu.ts` + vue-query 훅 8종: `useAdminQuotes`·`useAdminMembers`·`useAdminOrders`·`useAdminSettings`·**`useAdminMarket`**·**`useAdminSlides`**·**`useAdminSeo`**.
  - `lib/` — `format.ts`·`useDaumPostcode.ts`(주소 검색 composable), `i18n/locales/{ko,en}.ts`(ko 실서비스, en 스텁).
- **설정 페이지 탭 구조**: `AdminSettings.vue` 내부 탭 3종 — `businessInfo`(사업자정보 11필드) · `gerberPricing`(거버 가격모드) · `aiIntegration`(AI 연동). 탭 추가 = `SettingsTabs` TABS 배열 + 패널 스위치 한 줄(OrderStatusTabs 패턴).
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint strictTypeChecked, `no-explicit-any`=error.
- **dev 서버**: 포트 5173, `host: '127.0.0.1'`(Windows localhost IPv6 문제로 nginx 502 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`.

## Talks To [coverage: high — 5 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 데이터·관리 API. Vite dev proxy `'/api' → 127.0.0.1:3333`. 계약 `@sp/api-contract`(Zod)를 FE/BE 공유: DB(Prisma) → Fastify(zod) → 계약 → vue-query. 관리 화면은 `/api/admin/*`(Bearer JWT, `requireAdmin`)을 소비. 견적서 발송(메일=nodemailer, 알림톡=iwinv)·주문 알림(PHP 브리지 경유)도 sp-node 가 수행하고 sp-vue 는 트리거·결과 표시만.
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드 IdP. `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) 발급 → sp-vue 가 `/api` 호출 시 Bearer. 부트스트랩 로직 `packages/shared/src/auth.ts`.
- **sp-market** (`/market`, :5176) — 직접 통신은 없지만 마켓의 관리 표면(`/app/admin/market/*`)을 sp-vue 가 담당하는 짝 관계. 도메인 라벨 사전(`MARKET_*_LABELS`)을 계약에서 공유.
- **sp-php 소비 화면과의 "관리=sp-vue / 소비=sp-php" 짝**: 메인 슬라이드(`AdminSlides` ↔ `theme/sp-lite/inc/main_slider.php`, g5_shop_banner '메인' 공유)와 SEO(`AdminSeo` ↔ 테마 `head.sub.php` SSR 출력, sp_seo 공유) — sp-vue 는 데이터 CRUD 만, 렌더는 PHP.
- **nginx** (`ops/nginx/local-web.conf`, `local-web.samplepcb.co.kr`) — `/app/`→5173(HMR)·`/api/`→3333·`/market/`→5176·`/`→8888. `/app`·`/api`·`/market` 예약 경로.

## API Surface [coverage: high — 7 sources]

sp-vue 자체는 API 를 노출하지 않는 소비자다. 노출 표면은 **브라우저 라우트** (`/app` 하위):

| 라우트 | 화면 | 비고 |
|---|---|---|
| `/` | Home | DefaultLayout(최소 셸) |
| `/admin` | AdminDashboard | `requiresAdmin` 가드 |
| `/admin/quotes` | 견적 관리 | 전 사용자 목록·rfq 가격 확정·거버 다운로드·견적서 A4 인쇄·**견적서 발송(`EstimateSendControl` — 수신 이메일 확인 드롭다운, 채널별 sent/failed/skipped 결과, rfq 는 버튼 게이트+서버 409)**·회사명 2층 저장·완전삭제 |
| `/admin/orders` | 주문내역 | 목록·탭16(표준5+제작8 등)·상세 드로어·상태 스텝퍼(`ORDER_PIPELINE` 선형 전이)·엑셀 배송·상세 편집·입금 조정·인쇄·카트행 취소/반품/품절·임의 상태 변경·알림 체크박스 |
| `/admin/members` | 회원 관리 | 목록·상세 드로어·차단/레벨·회사명 프로필·주소 검색(Daum) |
| `/admin/market/experts` | 마켓 전문가 심사 | 승인/반려/정지, 증빙(sp_file) 열람 |
| `/admin/market/projects` | 마켓 프로젝트 모니터 | 의뢰·입찰 관리 표면 |
| `/admin/market/contracts` | 마켓 계약·정산 | 탭 counts·드로어(od 파생 결제상태 상시·정산계좌·hold/unhold·settle·운영취소), 조회가 lazy paid 승격·7일 자동확정 스윕을 겸함 |
| `/admin/market/settings` | 마켓 설정 | 수수료율(feeRateBp) 싱글턴 |
| `/admin/slides` | 메인 슬라이드 관리 | `useAdminSlides` — g5_shop_banner '메인' CRUD(생성/수정=multipart `apiSendForm`, 삭제/reorder=JSON), 홈 `/` owl 슬라이더가 소비 |
| `/admin/seo` | SEO 관리 | `useAdminSeo` — sp_seo (scope, refKey) upsert(PUT)/DELETE, 소비는 sp-php 테마 head.sub.php SSR |
| `/admin/settings` | 쇼핑몰·시스템 설정 | 탭 3종: 사업자정보 / **거버 가격**(`GerberPricingForm` — order/supply 라디오, `GET/PATCH /api/admin/settings/gerber-pricing`) / **AI 연동**(`AiSettingsForm` — Ollama 주소·API 키(마스킹)·연결 테스트(모델 목록 datalist)·유스케이스별 enabled/model/promptTemplate) |

라우터 가드는 `auth.isLoggedIn`·`auth.me?.isAdmin` 검사 후 아니면 home 리다이렉트 — **UX용일 뿐, 실제 보안은 sp-node 가 JWT `isAdmin` 클레임으로 검증**(router.ts 주석).

## Data [coverage: high — 5 sources]

- sp-vue 는 DB 에 직접 접근하지 않음. 데이터는 전부 sp-node(`/api`) 경유 — sp-node 는 공유 DB(`samplepcb`)의 `sp_*` 를 Prisma 로 소유, `g5_*` 는 `lib/g5-db.ts` 접근 카탈로그로.
- 관리 화면이 다루는 주요 저장소(간접): 견적 `sp_quote`/`sp_order_spec`/`sp_file`, 마켓 `sp_market_*` 6테이블(계약 스냅샷 feeRateBp/fee/payout 포함), SEO `sp_seo`, 설정 `sp_config`(gerber_price_mode·ai_base_url·ai_api_key)+`sp_ai_usecase`, 슬라이드 `g5_shop_banner`, 주문/회원 `g5_shop_order`·`g5_member` 등(카탈로그 경유).
- 클라이언트 상태: Pinia(auth store는 `@sp/shared` 소유) + 서버 상태 @tanstack/vue-query. 각 훅이 도메인 쿼리키(`['admin','seo']`·`['admin','slides']` 등)를 변경 후 무효화 — 회사명 프로필 저장은 `['admin','quotes']` 교차 무효화로 화면 간 연동.
- **판정은 서버·FE 는 소비만**: 알림 게이트는 `useAdminNotifyConfig()` 가 `GET /api/admin/orders/notify-config` 의 boolean(mail/smsDeposit/smsShipping)을 받아 `OrderActionBar`(목록)·`OrderDetailDrawer`(상세) 체크박스 `v-if` 에 결합 — 설정 꺼진 채널은 숨김(코어 목록의 무조건 노출 결함을 교정). 마켓 계약의 paid 승격·자동확정도 서버 lazy 판정 결과를 표시할 뿐.
- AI 연동 설정: `.env`(AI_BASE_URL/AI_API_KEY) > 관리자 화면 저장값 > 기본값 우선순위 — env 가 잡혀 있으면 해당 입력이 잠기고 ".env 값 우선" 안내 표시. API 키 원문은 어떤 응답에도 없음(마스킹만, 입력=교체·비움=유지·체크=삭제).
- 회원 정보는 JWT 클레임(`JwtClaims`)으로만 식별 — 그누보드 스키마 직접 결합 금지.
- 배송처리는 현재 수동(드로어 3필드 입력 + 엑셀 왕복) — 택배사 API 자동화(굿스플로/딜리버리트래커)는 조사 완료·미결정 보류.

## Key Decisions [coverage: high — 8 sources]

1. **2026-07-12 — AI 설정은 범용 유스케이스 계층으로**: AdminSettings "AI 연동" 탭이 연결(sp_config)과 유스케이스(sp_ai_usecase — enabled/model/promptTemplate)를 분리 관리. 새 유스케이스 추가 시 설정 행·화면은 자동(lazy 생성·목록 렌더) — FE 화면 추가 불요. 프롬프트 정본은 DB(관리자 소유), 코드 기본값은 신규 행 생성 시에만.
2. **2026-07-10 — SEO "관리=sp-vue / 소비=sp-php"**: 크롤러·OG 스크래퍼는 초기 HTML `<head>` 를 보므로 meta 출력은 반드시 sp-php SSR — SPA 인 sp-vue 는 관리 UI 전용(`AdminSeo`). 슬라이드 이관과 같은 분리 패턴, 저장만 신규 `sp_seo`(Prisma).
3. **2026-07-08 — 마켓 관리 표면은 sp-vue**: 소비자 마켓은 별도 앱 sp-market(`/market`)이지만 관리 화면은 `/app/admin/market/*` 4종 + `useAdminMarket` — sp-vue 는 계속 관리자 전용이라는 원칙 유지. 계약 드로어는 od 파생 결제상태를 상시 표시해 단방향 래칫(paid 유지)과의 괴리를 가시화.
4. **2026-07-05 — 거버 가격모드는 관리자 전역 스위치**: 거버 산출가를 주문가/공급가로 해석하는 설정을 `sp_config` + AdminSettings 탭으로 — 견적 엔진은 불변, 밖에서 후처리(`applyGerberPriceMode`). 기존 견적 비소급.
5. **2026-07-05 — PCB 제작 8단계·선형 전이 스텝퍼**: 제작 7단계를 정방향 선형 체인에 편입('다음 단계 처리' 순차), A/S 는 force-status 전용. 드로어에 `OrderStatusStepper`(`ORDER_PIPELINE`), 탭·배지·i18n 은 `ACTIVE_ORDER_STATUSES` SSOT 에서 파생.
6. **2026-07-04~05 — 사용자 노출은 sp-php, 관리자는 sp-vue**: 견적·회원·주문·설정 관리가 레거시 `/adm/*` 에서 이관. placeholder 라우트는 이후 제거 — 기능 없는 메뉴는 두지 않는다.
7. **(플랫폼 초기) 같은 도메인 경로 분기 + base `/app/` 고정** — nginx 한 호스트에서 `/`(PHP)·`/app`(Vue)·`/market`(Vue)·`/api`(Node). PHPSESSID 공유가 인증 브리지 전제. 예약 경로라 base 변경 금지.
8. **(플랫폼 초기) 계약 우선(Zod 단일 진실원본)·마운트 전 인증 부트스트랩·판정은 서버가·UI 는 프로토타입 선언** — 요청/응답 스키마는 `@sp/api-contract`, 첫 렌더 전 세션 복원, 게이트·상태 전이·가격은 서버 값 소비, 스타일은 확정 디자인시스템 전까지 임시(라벨은 i18n 키, ko 실서비스·en 스텁).

## Gotchas [coverage: high — 6 sources]

- **`any`/`as any`/`@ts-ignore` 금지**(불가피하면 `@ts-expect-error` + 사유). ESLint error.
- **Windows Vite host 함정**: `host` 기본값(localhost)은 IPv6(::1)로만 열려 nginx `proxy_pass http://127.0.0.1:5173` 이 502 — 반드시 `host: '127.0.0.1'`. `allowedHosts` 에 `local-web.samplepcb.co.kr` 명시 없으면 403.
- **turbo 가 Windows 에서 깨짐** — 검증은 `pnpm -r typecheck` / `pnpm -r lint` 우회.
- 라우터 admin 가드는 보안 경계가 아님 — 서버(sp-node) `requireAdmin` 이 진짜 경계. UI 숨김도 보안 아님(마켓 접근 제어는 서버 강제).
- **AI 연동 env 우선**: `.env` 의 AI_BASE_URL/AI_API_KEY 가 있으면 관리자 화면 입력이 잠긴다 — "화면에서 저장했는데 안 바뀜"은 env 우선 때문. env 변경은 API 재시작 후 반영. 위저드 인터뷰 UI 는 structurize·diagram-spec **둘 다** 관리자 탭에서 활성해야 나타남.
- **알림 체크박스는 서버 게이트**: 코어 주문 목록(orderlist.php)은 설정 무관 무조건 노출(결함)이지만 sp-vue 는 의도적 패리티 이탈 — 설정 꺼진 채널은 목록·상세 모두 숨김. "체크박스가 안 보임"은 `cf_email_use`/`cf_sms_use==='icode'`+`de_sms_use4/5` 설정 문제.
- **드로어 내 드롭다운 방향**: `EstimateSendControl` 은 좁은 우측 드로어에서 `align='right'`(좌측 전개)로 화면 밖 넘침을 방지 — 재사용 시 컨텍스트별 지정 필요.
- 관리자 화면 다수가 실브라우저 e2e 미검증 표기로 커밋됨(typecheck·테스트·lint 통과 기준) — 인쇄·픽셀 마감은 육안 필요. 단 마켓 계약 플로우는 2026-07-08 실브라우저 전 구간 검증 완료.
- 통합 라우팅은 `local-web` 하나뿐 — `local.samplepcb.co.kr` 등은 `/` 전체가 Vue.
- 간접 주의: 공유 DB 라 모노레포에서 `prisma migrate reset` 절대 금지(g5_* 드랍) — API 쪽 건드릴 때 해당.

## Sources [coverage: high — 17 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 호칭·nginx 라우팅·인증 브리지·sp-market 예외
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·UI 프로토타입 선언·패키지
- [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) — AdminSeo·"관리=sp-vue/소비=sp-php" 설계
- [docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) — GerberPricingForm·sp_config·정규화 지점
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 마켓 관리 화면 4종·계약 드로어·접근 제어
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — AiSettingsForm·유스케이스 계층·env 우선순위·인터뷰 게이트
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 관리자 화면 이관 서사·g5 접근 카탈로그·주문 상태 체계
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — 알림 체크박스 서버 게이트(`useAdminNotifyConfig`)
- [docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 배송처리 현행 수동 방식·자동화 보류
- [apps/web/src/router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts) — 라우트 11종·placeholder 제거·가드 주석
- [apps/web/src/main.ts](../../samplepcb-web-mono-app/apps/web/src/main.ts)
- [apps/web/package.json](../../samplepcb-web-mono-app/apps/web/package.json)
- [apps/web/vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts)
- [apps/web/src/components/admin/SettingsTabs.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/SettingsTabs.vue) — 설정 탭 3종·확장 패턴
- [apps/web/src/admin/useAdminSeo.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminSeo.ts)
- [apps/web/src/admin/useAdminSlides.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminSlides.ts)
- [apps/web/src/components/admin/EstimateSendControl.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/EstimateSendControl.vue) — 견적서 발송 컨트롤·align 방향
