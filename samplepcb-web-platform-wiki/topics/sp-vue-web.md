---
topic: sp-vue-web
last_compiled: 2026-07-06
sources_count: 8
status: active
---

# sp-vue-web

## Purpose [coverage: high — 5 sources]

`sp-vue` — samplepcb 신규 화면 영역을 담당하는 **Vue 3 SPA** (`samplepcb-web-mono-app/apps/web`, 패키지명 `web`). 그누보드5/영카트(`sp-php`)와 **같은 도메인**에서 nginx 로 합류하며 `/app` 경로에 마운트된다(`base: '/app/'` 고정). 별칭 규칙상 "web" 호칭은 금지(PHP `samplepcb-web/` 와 혼동) — 문서·커밋에서는 `sp-vue`.

**중요한 플랫폼 결정**: 사용자 노출 페이지(견적관리 등)는 `sp-php`(그누보드, `/`) 쪽에 구현하고, **sp-vue `/app` 의 실질 기본 용도는 관리자(`/app/admin`)다**. 2026-07-03 시점의 "홈+관리자 골격(placeholder)"에서 **2026-07-04~05 사이 관리자 화면이 실기능으로 대거 구현**됐다 — 견적 관리·회원 관리·주문내역·쇼핑몰 설정이 레거시 `/adm/*` 에서 이관됐다. 다만 **UI·레이아웃·스타일은 여전히 프로토타입(placeholder)** 선언(모노레포 AGENTS.md) — 최종 디자인시스템 도입 전까지 자유롭게 교체 가능.

## Architecture [coverage: high — 6 sources]

- **스택**: Vite 8 + Vue 3.5 + TypeScript 6 + Vue Router 4 + Pinia 3 + @tanstack/vue-query 5 + Tailwind v4(`@tailwindcss/vite`) + vue-i18n 11. 폰트 Pretendard variable.
- **모노레포 구성원**: pnpm workspaces + Turborepo. workspace 의존성 `@sp/api-contract`(Zod 계약)·`@sp/shared`(API 클라이언트·vue-query 훅·Pinia auth store)·`@sp/utils`·`@sp/config`.
- **src 구조** (관리자 실기능 추가로 확장):
  - `main.ts` — pinia → i18n → vue-query → router 설치 후, **마운트 전 `useAuthStore(pinia).bootstrap()`** 로 인증 브리지 세션 복원 → `app.mount('#app')`.
  - `router.ts` — `createWebHistory('/app/')`. `/`(DefaultLayout→Home), `/admin`(AdminLayout, `meta.requiresAdmin`) 하위 **quotes·members·orders·settings 는 실 페이지**(products·stats 등 잔여는 `AdminPlaceholder`).
  - `pages/admin/` — `AdminQuotes.vue`·`AdminMembers.vue`·`AdminOrders.vue`·`AdminSettings.vue`
  - `components/admin/` — 견적(`Quote*` — 상세 드로어·견적서 A4 인쇄 `EstimateModal`/`EstimateSheet`·완전삭제 모달), 회원(`Member*` — 상세 드로어·필터·상태 탭), 주문(`Order*` — `OrderDetailDrawer`·`OrderStatusStepper`·`OrderActionBar`·`OrderFilterBar`·`OrderStatusTabs`·`OrdersTable`·`ExcelDeliveryModal`·`OrderPrintSheet`·`OrderForceStatusModal`·`OrderItemCancelModal`), 설정(`BusinessInfoForm`·`SettingsTabs`), 공용 `ui/`(UiBadge·UiPagination)
  - `admin/` — `menu.ts`·`useAdminQuotes.ts`·`useAdminMembers.ts`·`useAdminOrders.ts`·`useAdminSettings.ts`(vue-query 훅·헬퍼)
  - `lib/` — `format.ts`·`useDaumPostcode.ts`(주소 검색 범용 composable), `i18n/locales/{ko,en}.ts`(ko 실서비스, en 스텁)
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint strictTypeChecked, `no-explicit-any`=error. 빌드 `vue-tsc -b && vite build`.
- **dev 서버**: 포트 5173, `host: '127.0.0.1'`(Windows localhost IPv6 문제로 nginx 502 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`.

## Talks To [coverage: high — 5 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 데이터·관리 API. Vite dev proxy `'/api' → 127.0.0.1:3333`. 계약 `@sp/api-contract`(Zod)를 FE/BE 공유: DB(Prisma) → Fastify(zod) → 계약 → vue-query. 관리 화면은 `/api/admin/*`(Bearer JWT, `requireAdmin`)을 소비.
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드 IdP. Vite dev proxy `'/spcb' → 127.0.0.1:8888`. `GET /spcb/api/me` 가 HS256 JWT(TTL 10분) 발급 → sp-vue 가 `/api` 호출 시 Bearer. 부트스트랩 로직 `packages/shared/src/auth.ts`.
- **nginx** (`ops/nginx/local-web.conf`, `local-web.samplepcb.co.kr`) — `/app/`→5173(HMR)·`/api/`→3333·`/`→8888. `/app`·`/api` 예약 경로.

## API Surface [coverage: medium — 3 sources]

sp-vue 자체는 API 를 노출하지 않는 소비자다. 노출 표면은 **브라우저 라우트**:

| 라우트 (`/app` 하위) | 화면 | 비고 |
|---|---|---|
| `/` | Home | DefaultLayout(최소 셸) |
| `/admin` | AdminDashboard | `requiresAdmin` 가드 |
| `/admin/quotes` | 견적 관리 | 전 사용자 목록·rfq 가격 확정·거버 다운로드·견적서 A4 인쇄·완전삭제 |
| `/admin/members` | 회원 관리 | 목록·상세·차단/레벨·회사명 프로필·주소 검색 |
| `/admin/orders` | 주문내역 | 목록·필터·상세 드로어·상태 스텝퍼·엑셀 배송·상세 편집·인쇄·취소/반품·알림 |
| `/admin/settings` | 쇼핑몰 설정 | 사업자정보(결제/배송/알림 탭 뼈대) |
| `/admin/{products,stats}` | AdminPlaceholder | `meta.titleKey` i18n |

라우터 가드는 `auth.isLoggedIn`·`auth.me?.isAdmin` 검사 후 아니면 home 리다이렉트 — **UX용일 뿐, 실제 보안은 sp-node 가 JWT `isAdmin` 클레임으로 검증**(router.ts 주석).

## Data [coverage: medium — 3 sources]

- sp-vue 는 DB 에 직접 접근하지 않음. 데이터는 전부 sp-node(`/api`) 경유 — sp-node 는 공유 DB(`samplepcb`)의 `sp_*` 를 Prisma 로 소유, g5_* 는 접근 카탈로그로.
- 클라이언트 상태: Pinia(auth store는 `@sp/shared` 소유) + 서버 상태 @tanstack/vue-query. 회사명 프로필 저장 등은 관련 쿼리키(`['admin','quotes']`)를 무효화해 화면 간 연동.
- **알림 게이트는 서버가 계산·FE 는 소비만** — `useAdminNotifyConfig()` 가 `GET /api/admin/orders/notify-config` 의 boolean(mail/smsDeposit/smsShipping)을 받아 `OrderActionBar`(목록)·`OrderDetailDrawer`(상세) 체크박스 `v-if` 에 결합. 설정 꺼진 채널은 숨김(코어 목록의 무조건 노출 결함을 교정).
- 회원 정보는 JWT 클레임(`JwtClaims`)으로만 식별 — 그누보드 스키마 직접 결합 금지.

## Key Decisions [coverage: high — 5 sources]

1. **같은 도메인 경로 분기** — nginx 한 호스트에서 `/`(PHP)·`/app`(Vue)·`/api`(Node). PHPSESSID 공유가 인증 브리지 전제.
2. **사용자 노출은 sp-php, 관리자는 sp-vue** — 고객 대면 신규 화면은 그누보드 쪽, sp-vue `/app` 은 관리자 본문. 견적·회원·주문·설정 관리가 sp-vue 로 이관됨(2026-07-04~05).
3. **base `/app/` 고정** — 예약 경로, 변경 금지.
4. **계약 우선(Zod 단일 진실원본)** — 요청/응답 스키마는 `@sp/api-contract` 에 정의하고 FE/BE 가 같은 것을 import.
5. **마운트 전 인증 부트스트랩** — 첫 렌더 전 세션 복원을 끝내 라우터 가드가 정확한 auth 를 보게.
6. **판정은 서버가·FE 는 소비** — 알림 게이트·상태 전이 가능 여부·가격 등은 서버 boolean/값을 그대로 표시(클라이언트 재계산 금지).
7. **UI 는 프로토타입 선언** — 관리자 실기능은 붙었지만 확정 디자인시스템 도입 전까지 스타일은 임시. 라벨은 i18n 키(ko 실서비스, en 스텁, 스위처 UI 미구현).

## Gotchas [coverage: high — 5 sources]

- **`any`/`as any`/`@ts-ignore` 금지**(불가피하면 `@ts-expect-error` + 사유). ESLint error.
- **Windows Vite host 함정**: `host` 기본값(localhost)은 IPv6(::1)로만 열려 nginx `proxy_pass http://127.0.0.1:5173` 이 502 — 반드시 `host: '127.0.0.1'`.
- **Vite allowedHosts**: nginx 가 `Host: local-web.samplepcb.co.kr` 로 프록시하므로 명시 허용, 없으면 403.
- **turbo 가 Windows 에서 깨짐** — 검증은 `pnpm -r typecheck` / `pnpm -r lint` 우회.
- 라우터 admin 가드는 보안 경계가 아님 — 서버(sp-node) 검증이 진짜 경계.
- **관리자 화면 다수가 실브라우저 e2e 미검증 표기로 커밋됨**(typecheck·단위테스트·lint 통과 기준). 인쇄·픽셀 마감은 사용자 육안 필요(사례: 인쇄 드로어 겹침).
- 통합 라우팅은 `local-web` 하나뿐 — `local.samplepcb.co.kr` 등은 `/` 전체 Vue.
- 간접 주의: 공유 DB 라 모노레포에서 `prisma migrate reset` 절대 금지(g5_* 드랍) — API 쪽 건드릴 때 해당.

## Sources [coverage: high — 8 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 프로젝트 호칭·nginx·인증 브리지
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·UI 프로토타입 선언·패키지
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) — 관리자 화면 구현 서사·관련 파일 색인
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) — FE 알림 게이트 소비(`useAdminNotifyConfig`)
- [apps/web/package.json](../../samplepcb-web-mono-app/apps/web/package.json)
- [apps/web/vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts)
- [apps/web/src/router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts)
- [apps/web/src/main.ts](../../samplepcb-web-mono-app/apps/web/src/main.ts)
