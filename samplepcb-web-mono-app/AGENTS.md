# AGENTS.md — samplepcb-web-mono-app

samplepcb 신규 프런트/API **모노레포**(pnpm + Turborepo). 상위 우산 `samplepcb-web-platform`의 한 구성요소. 그누보드(`samplepcb-web`)와 **같은 도메인**에서 nginx로 합류한다(`/app` Vue, `/api` Node).

## 스택

| 영역 | 선택 |
|---|---|
| 모노레포 | pnpm workspaces + Turborepo |
| 언어/런타임 | TypeScript / Node 22 LTS |
| web | Vite + **Vue 3** (Vue Router · Pinia · @tanstack/vue-query · Tailwind v4) |
| api | **Fastify 5** + `fastify-type-provider-zod` |
| DB | MariaDB(별도 DB `samplepcb_app`) + **Prisma**, 테이블 접두 **`sp_`** |
| 검증/계약 | **Zod** (FE/BE 단일 진실원본 = `@sp/api-contract`) |

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
├── web/           Vite + Vue 3      ← base:'/app/'
└── api/           Fastify 5         ← prefix '/api'
```

## 그누보드 연동 (인증 브리지)

- 같은 도메인이라 PHPSESSID 공유. Node는 PHP 세션 직접 못 읽음 →
- 그누보드 `/spcb/api/me.php`가 `$member` 기반 **서명 JWT**(공유 시크릿, `extend/`) 발급 → Vue가 `/api` 호출 시 `Bearer` → **Fastify는 JWT만 검증**(`@fastify/jwt`).
- Node는 자기 DB(`sp_*`)만 소유. 회원 식별은 JWT 클레임(`mb_id`/`mb_nick`/`level`). 그누보드 스키마 직접 결합 금지.

## 규칙

- 새 코드 100% 타입 안전. `any`/`as any`/`// @ts-ignore` 금지(불가피하면 `@ts-expect-error` + 사유).
- API 요청/응답 스키마는 **반드시 `@sp/api-contract`(Zod)** 에 정의하고 FE/BE 양쪽이 그걸 import.
- `/app`·`/api`는 그누보드 예약 경로. base/prefix 고정.
- DB 테이블은 `sp_` 접두, Prisma가 소유(그누보드 `g5_*`는 건드리지 않음).

## 개발

```bash
pnpm install
pnpm dev          # turbo: web(5173) + api(3000) 동시
pnpm typecheck    # turbo typecheck (모든 워크스페이스)
pnpm lint
```
nginx(`../ops/nginx/local-web.conf`)가 `/app`→5173, `/api`→3000 프록시.
