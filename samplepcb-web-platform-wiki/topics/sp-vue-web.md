---
topic: sp-vue-web
last_compiled: 2026-07-03
sources_count: 6
status: active
---

# sp-vue-web

## Purpose [coverage: high — 5 sources]

`sp-vue` — samplepcb 신규 화면 영역을 담당하는 **Vue 3 SPA** (`samplepcb-web-mono-app/apps/web`, 패키지명 `web`). 그누보드5/영카트(`sp-php`)와 **같은 도메인**에서 nginx로 합류하며, `/app` 경로에 마운트된다 (`base: '/app/'` 고정). 플랫폼 별칭 규칙상 "web"이라는 호칭은 금지(PHP의 `samplepcb-web/`와 혼동) — 문서·커밋에서는 `sp-vue`로 부른다.

**중요한 플랫폼 결정**: 사용자 노출 페이지(견적관리 등)는 `sp-php`(그누보드, `/`) 쪽에 구현하는 방향이며, sp-vue는 `/app` 영역(현재 홈 + 관리자 화면 골격)을 담당한다. 또한 현재 sp-vue의 **UI·레이아웃·스타일은 전부 프로토타입(placeholder)** — 구조·흐름 검증용이며 최종 디자인이 아니므로 자유롭게 교체 가능하다고 모노레포 AGENTS.md에 명시되어 있다.

## Architecture [coverage: high — 6 sources]

- **스택**: Vite 8 + Vue 3.5 + TypeScript 6 + Vue Router 4 + Pinia 3 + @tanstack/vue-query 5 + Tailwind v4(`@tailwindcss/vite`) + vue-i18n 11. 폰트는 Pretendard variable.
- **모노레포 구성원**: pnpm workspaces + Turborepo. workspace 의존성 `@sp/api-contract`(Zod 계약), `@sp/shared`(API 클라이언트·vue-query 훅·Pinia auth store), `@sp/utils`, `@sp/config`(tsconfig/eslint 공유).
- **src 구조** (소규모, 13개 파일):
  - `main.ts` — pinia → i18n → vue-query → router 순 설치 후, **마운트 전에 `useAuthStore(pinia).bootstrap()`으로 그누보드 인증 브리지 세션을 복원**하고 나서 `app.mount('#app')`.
  - `router.ts` — `createWebHistory('/app/')`. 라우트: `/`(DefaultLayout → Home), `/admin`(AdminLayout, `meta.requiresAdmin`) 하위에 quotes/orders/products/stats/settings — 대시보드 외에는 전부 `AdminPlaceholder.vue`.
  - `layouts/` DefaultLayout·AdminLayout, `pages/Home.vue`, `pages/admin/`, `admin/menu.ts`, `i18n/locales/{ko,en}.ts`(ko 실서비스, en 스텁 — 스위처 UI 미구현).
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax 등, ESLint strictTypeChecked, `no-explicit-any`=error. 빌드는 `vue-tsc -b && vite build`.
- **dev 서버**: 포트 5173, `host: '127.0.0.1'`(Windows에서 localhost가 IPv6로만 열려 nginx 502 나는 문제 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`.

## Talks To [coverage: high — 5 sources]

- **sp-node** (`/api`, Fastify 5, :3000) — 데이터 API. Vite dev proxy `'/api' → http://127.0.0.1:3000`. 계약은 `@sp/api-contract`(Zod)를 FE/BE가 공유해 타입으로 연결: DB(Prisma) → Fastify(zod type-provider) → 계약 → vue-query.
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드가 IdP. Vite dev proxy `'/spcb' → http://127.0.0.1:8888`. `GET /spcb/api/me`가 PHP 세션 기반으로 HS256 JWT(TTL 10분)를 발급 → sp-vue가 `/api` 호출 시 Bearer로 전달, Fastify는 검증만. 부트스트랩 로직은 `packages/shared/src/auth.ts`.
- **nginx** (`ops/nginx/local-web.conf`, 통합 호스트 `local-web.samplepcb.co.kr`) — `/app/` → 5173(Vite dev+HMR), `/api/` → 3000, `/` → 8888(PHP). `/app`·`/api`는 그누보드 예약 경로로 base/prefix 고정.

## API Surface [coverage: medium — 3 sources]

sp-vue 자체는 API를 노출하지 않는 소비자다. 노출 표면은 **브라우저 라우트**:

| 라우트 (`/app` 하위) | 화면 | 비고 |
|---|---|---|
| `/` | Home | DefaultLayout |
| `/admin` | AdminDashboard | `requiresAdmin` 가드 |
| `/admin/{quotes,orders,products,stats,settings}` | AdminPlaceholder | `meta.titleKey`로 i18n 제목 |

라우터 가드는 `auth.isLoggedIn`·`auth.me?.isAdmin` 검사 후 아니면 home으로 리다이렉트 — **UX용일 뿐, 실제 보안은 sp-node가 JWT의 `isAdmin` 클레임으로 검증**한다(router.ts 주석에 명시).

## Data [coverage: medium — 3 sources]

- sp-vue는 DB에 직접 접근하지 않음. 데이터는 전부 sp-node(`/api`) 경유 — sp-node는 그누보드 공유 DB(`samplepcb`)의 `sp_*` 테이블만 Prisma로 소유.
- 클라이언트 상태: Pinia(auth store는 `@sp/shared` 소유) + 서버 상태는 @tanstack/vue-query.
- 회원 정보는 JWT 클레임(`JwtClaims`, `@sp/api-contract`)으로만 식별 — 그누보드 스키마 직접 결합 금지.

## Key Decisions [coverage: high — 5 sources]

1. **같은 도메인 경로 분기** — 별도 도메인 대신 nginx 한 호스트에서 `/`(PHP)·`/app`(Vue)·`/api`(Node) 분기. PHPSESSID 공유가 인증 브리지의 전제.
2. **사용자 노출 페이지는 sp-php 우선** — 견적관리 등 고객 대면 신규 화면은 그누보드 쪽에 두고, sp-vue는 `/app` 영역(관리자·신규 앱 화면) 담당 (root AGENTS.md의 프로젝트 구분 및 최근 커밋 흐름과 일치).
3. **base `/app/` 고정** — 그누보드 예약 경로, 변경 금지.
4. **계약 우선(Zod 단일 진실원본)** — API 요청/응답 스키마는 반드시 `@sp/api-contract`에 정의하고 FE/BE가 같은 것을 import.
5. **마운트 전 인증 부트스트랩** — 첫 렌더 전에 세션 복원을 끝내 라우터 가드가 정확한 auth 상태를 보게 함.
6. **UI는 프로토타입 선언** — 확정 디자인시스템 도입 전까지 현 스타일은 임시.

## Gotchas [coverage: high — 5 sources]

- **`any`/`as any`/`@ts-ignore` 금지** (불가피하면 `@ts-expect-error` + 사유). ESLint에서 error.
- **Windows Vite host 함정**: `host` 기본값(localhost)은 IPv6(::1)로만 열려 nginx `proxy_pass http://127.0.0.1:5173`이 502 — 반드시 `host: '127.0.0.1'` 유지 (vite.config.ts 주석).
- **Vite allowedHosts**: nginx가 `Host: local-web.samplepcb.co.kr`로 프록시하므로 명시 허용 필요, 없으면 403.
- **turbo가 Windows에서 깨짐** — 검증은 `pnpm -r typecheck` / `pnpm -r lint`로 우회 (root AGENTS.md).
- 라우터 admin 가드는 보안 경계가 아님 — 서버(sp-node) 검증이 진짜 경계.
- 라이브 nginx에는 `local.samplepcb.co.kr` 등 `/` 전체가 Vue인 프리뷰 호스트도 있으나, **통합 라우팅은 `local-web` 하나뿐**.
- 간접 주의: 공유 DB이므로 모노레포에서 `prisma migrate reset` 절대 금지(g5_* 전체 드랍) — sp-vue 작업 중 API 쪽을 건드릴 때도 해당.

## Sources [coverage: high — 6 sources]

- [AGENTS.md (root)](../../AGENTS.md)
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md)
- [apps/web/package.json](../../samplepcb-web-mono-app/apps/web/package.json)
- [apps/web/vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts)
- [apps/web/src/router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts)
- [apps/web/src/main.ts](../../samplepcb-web-mono-app/apps/web/src/main.ts)
