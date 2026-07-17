# AGENTS.md — samplepcb-web-mono-app

samplepcb 신규 프런트/API **모노레포**(pnpm + Turborepo). 상위 우산 `samplepcb-web-platform`의 한 구성요소. 그누보드(`samplepcb-web`)와 **같은 도메인**에서 nginx로 합류한다(`/app` Vue 관리자, `/market` Vue 재능마켓, `/api` Node).

## 스택

| 영역 | 선택 |
|---|---|
| 모노레포 | pnpm workspaces + Turborepo |
| 언어/런타임 | TypeScript / Node 22 LTS |
| web | Vite + **Vue 3** (Vue Router · Pinia · @tanstack/vue-query · Tailwind v4) |
| api | **Fastify 5** + `fastify-type-provider-zod` |
| DB | 그누보드 공유 DB(`samplepcb`)의 `sp_` 테이블 + **Prisma** (⚠ `migrate reset` 금지 — g5_* 드랍됨) |
| 검증/계약 | **Zod** (FE/BE 단일 진실원본 = `@sp/api-contract`) |

## UI/디자인 상태 — 프로토타입

- **sp-vue(web)의 실질 기본 용도는 관리자 화면(`/app/admin`)이다** — 고객 대면 페이지는 sp-php 담당(플랫폼 결정, 상위 AGENTS.md "프로젝트 호칭"). `/app` 루트 홈은 최소 셸. 첫 실기능은 관리자 견적 관리(`/app/admin/quotes`).
- **sp-market(market)은 고객 대면 재능마켓 SPA(`/market`)다**(2026-07-08 신설) — "고객 대면 = sp-php" 결정의 예외로, SPA급 인터랙션(의뢰 마법사·블라인드 견적 비교·대시보드)이 필요해 별도 Vue 앱으로 구현한다. 마켓 관리 화면은 sp-vue `/app/admin/market`.
- **현재 sp-vue(web)의 UI·레이아웃·스타일(헤더·관리자 사이드바·색상·컴포넌트)은 전부 프로토타입(placeholder)이다.** 구조·흐름 검증용 임시 디자인일 뿐 최종 디자인이 아님 — 자유롭게 교체/재작성해도 된다.
- 라벨은 i18n 키(`@sp` `i18n/locales`)로 두어 다국어에 대비(현재 `ko` 실서비스, `en` 스텁). 다국어 스위처 UI는 미구현(준비만).
- 확정 디자인/디자인시스템 도입 시 이 문구를 갱신할 것.

## 타입 강성 — "매우 강함" (반드시 유지)

- tsconfig: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `verbatimModuleSyntax`. (`@sp/config/tsconfig/*`)
- ESLint: `strictTypeChecked` + `stylisticTypeChecked` + `projectService`(타입 인지). `no-explicit-any`=error. (`@sp/config/eslint/*`)
- 데이터 흐름: **DB(Prisma) → API(Fastify, zod type-provider) → 계약(`@sp/api-contract` Zod) → Vue(@tanstack/vue-query)** 가 타입으로 연결. `any` 금지.

## 패키지 (scope `@sp`)

```
packages/
├── config/        @sp/config        ← tsconfig/eslint 공유(이미 작성됨, 수정 금지 기준)
├── api-contract/  @sp/api-contract  ← Zod 스키마 + 추론 타입 + 라우트 상수 (FE/BE 공통, src 직접 노출)
├── utils/         @sp/utils         ← 순수 함수(FE/BE 공용)
└── shared/        @sp/shared        ← API 클라이언트 + vue-query 훅 + Pinia auth store
apps/
├── web/           Vite + Vue 3      ← base:'/app/' (관리자)
├── market/        Vite + Vue 3      ← base:'/market/' (재능마켓 고객 SPA)
├── rnd/           Vite + Vue 3      ← base:'/rnd/' (연구·실험용 독립 SPA)
└── api/           Fastify 5         ← prefix '/api'
```

## 그누보드 연동 (인증 브리지)

전체 흐름·시크릿 위치는 **상위 [`../AGENTS.md`](../AGENTS.md) "인증 브리지"가 단일 설명원본**. 모노레포에서 지킬 것만 요약:

- Fastify는 그누보드가 발급한 JWT를 **검증만** 한다(`@fastify/jwt`, `apps/api/.env`의 `JWT_SECRET`은 그누보드 쪽 시크릿과 동일 값).
- 회원 식별은 JWT 클레임(`@sp/api-contract`의 `JwtClaims` — `iat`/`exp` 필수). `sp_*` 는 Prisma 소유. `g5_*` 접근은 `apps/api/src/lib/g5-db.ts` 의 **접근 카탈로그**로 일원화 — sp-php 업무 기능의 모노레포 점진 마이그레이션 방침(2026-07-04)에 따라 필요한 만큼 확장하되, 카탈로그·HANDOFF·FLOW 5장을 동시 갱신(상세 규율은 g5-db.ts 헤더).

## 규칙

- 새 코드 100% 타입 안전. `any`/`as any`/`// @ts-ignore` 금지(불가피하면 `@ts-expect-error` + 사유).
- API 요청/응답 스키마는 **반드시 `@sp/api-contract`(Zod)** 에 정의하고 FE/BE 양쪽이 그걸 import.
- `/app`·`/market`·`/api`는 그누보드 예약 경로. base/prefix 고정.
- 신규 DB 테이블은 `sp_` 접두, Prisma 가 소유. `g5_*` 는 Prisma 스키마에 넣지 않고 `lib/g5-db.ts`(mysql2) 접근 카탈로그로만 읽고 쓴다.

## 개발

```bash
pnpm install
pnpm dev          # turbo: web(5173) + market(5176) + rnd(5177) + api(3333) 동시
pnpm typecheck    # turbo typecheck (모든 워크스페이스)
pnpm lint
```
nginx(`../ops/nginx/local-web.conf`)가 `/app`→5173, `/market`→5176, `/rnd`→5177, `/api`→3333 프록시.
