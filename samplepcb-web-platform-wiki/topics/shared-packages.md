---
topic: shared-packages
last_compiled: 2026-07-03
sources_count: 10
status: active
---

# shared-packages

## Purpose [coverage: high — 5 sources]

`samplepcb-web-mono-app`(pnpm + Turborepo 모노레포)의 scope `@sp` 공용 패키지 중 3종을 다룬다:

| 패키지 | 이름 | 역할 |
|---|---|---|
| `packages/config` | `@sp/config` | tsconfig · ESLint 설정 공유 (모든 워크스페이스의 기준) |
| `packages/utils` | `@sp/utils` | 순수 함수 모음 (FE/BE 공용, 의존성 없음) |
| `packages/shared` | `@sp/shared` | Vue 프런트 공용 레이어 — API 클라이언트 + vue-query 훅 + Pinia auth store |

네 번째 패키지 `@sp/api-contract`(Zod 스키마·라우트 상수, FE/BE 계약의 단일 진실원본)는 별개 토픽이지만 `@sp/shared`가 직접 의존하므로 본문에 등장한다.

## Architecture [coverage: high — 6 sources]

- **빌드 없는 src 직접 노출**: `@sp/shared`와 `@sp/utils` 모두 `main`/`types`/`exports`가 `./src/index.ts`를 직접 가리킨다. dist 빌드 단계 없이 소비 측(Vite/tsx)이 TS 소스를 그대로 컴파일한다.
- **`@sp/config`는 코드가 아닌 설정 파일 패키지**: `typescript/{base,node,vue}.json` + `eslint/{base,node,vue}.js`를 subpath export로 노출 (`@sp/config/tsconfig/base.json`, `@sp/config/eslint/vue` 등). AGENTS.md에 "이미 작성됨, 수정 금지 기준"으로 명시.
- **타입 강성 "매우 강함"**: `typescript/base.json`은 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `verbatimModuleSyntax` 전부 on. ESLint는 `strictTypeChecked` + `stylisticTypeChecked`, `no-explicit-any`=error.
- **src 구조**(소형):
  - `shared/src/`: `index.ts`(배럴: `export * from './auth' | './api-client' | './queries'`), `auth.ts`, `api-client.ts`, `queries.ts`
  - `utils/src/`: `index.ts` 단일 파일
  - `config/`: src 없음 — `typescript/*.json`, `eslint/*.js`

## Talks To [coverage: high — 5 sources]

- **의존 방향**: `@sp/shared` → `@sp/api-contract`(workspace:\*) + `@tanstack/vue-query` + `zod`; peerDependencies로 `vue ^3.5`, `pinia ^3.0`. `@sp/utils`는 런타임 의존성 0 (devDep으로 `@sp/config`만). 모든 패키지가 devDep으로 `@sp/config`를 참조.
- **소비자**: `apps/web`(Vite + Vue 3)이 `@sp/shared`의 훅/스토어를 사용; `@sp/utils`는 FE/BE 공용.
- **외부 시스템**: `@sp/shared`의 auth store가 그누보드 브리지 엔드포인트 `/spcb/api/me`를 same-origin fetch로 호출(PHPSESSID → JWT 교환). `api-client`는 그 JWT를 Bearer로 `/api/*`(Fastify)에 첨부. 데이터 흐름은 AGENTS.md 정의대로 DB(Prisma) → API(Fastify+zod) → 계약(`@sp/api-contract`) → Vue(vue-query)가 타입으로 연결된다.

## API Surface [coverage: high — 5 sources]

**@sp/utils** (`src/index.ts`):
- `isDefined<T>(v): v is T` — null/undefined 타입 가드
- `formatPrice(won: number): string` — ko-KR 천 단위 + "원" 접미사
- `slugify(s: string): string` — 소문자 하이픈 슬러그
- `pickRandom<T>(arr): T | undefined` — 무작위 원소

**@sp/shared** (배럴 export):
- `auth.ts`: `useAuthStore` (Pinia store `'auth'`) — state `{ token, me }`, getter `isLoggedIn`, action `bootstrap()` (그누보드 `/spcb/api/me` 호출, 실패 시 익명 유지)
- `api-client.ts`: `apiGet<T>(path, schema: ZodType<T>): Promise<T>` — 응답을 `schema.parse`로 검증, auth 토큰 있으면 Bearer 첨부; `ApiRequestError extends Error` (status + `ApiErrorType | null` payload)
- `queries.ts`: `useHealth()` (GET `/api/health` → `HealthResponse`), `useMe()` (GET `/api/me` → `Me`) — vue-query `useQuery` 래퍼

**@sp/config** (subpath exports): `./tsconfig/{base,node,vue}.json`, `./eslint/{base,node,vue}`

## Data [coverage: medium — 3 sources]

이 패키지들은 DB를 직접 소유하지 않는다. `@sp/shared`가 다루는 데이터는:
- 그누보드 브리지 응답 `{ token: JWT 문자열, member: Me }` — `auth.ts` 내부 Zod 스키마 `MeEndpointResponse`로 검증
- API 응답 전체 — `@sp/api-contract`의 Zod 스키마(`Me`, `HealthResponse`, `ApiError`)로 런타임 검증 후 반환

## Key Decisions [coverage: medium — 4 sources]

- **계약 스키마는 `@sp/api-contract`에만 정의** — FE/BE 양쪽이 import (AGENTS.md 규칙). `@sp/shared`는 소비만 한다.
- **throw 가능한 에러 래핑**: 계약의 `ApiError`는 Zod 스키마라 직접 throw 불가(ESLint `only-throw-error`) → `ApiRequestError extends Error`로 감싼다 (`api-client.ts` 주석에 명시).
- **JWT는 그누보드가 발급, Node는 검증만** — auth store `bootstrap()`은 실패 시 조용히 익명 유지(비로그인·네트워크·검증 실패 모두 동일 처리).
- **vue/pinia는 peerDependencies** — `@sp/shared`가 앱과 같은 Vue/Pinia 인스턴스를 쓰도록 강제.

## Gotchas [coverage: medium — 3 sources]

- `@sp/config`는 "수정 금지 기준"(AGENTS.md) — 타입 강성 설정을 완화하는 변경 금지. 새 코드 100% 타입 안전, `any`/`as any`/`@ts-ignore` 금지.
- `apiGet`의 `useAuthStore()` 호출은 Pinia가 활성화된 컨텍스트(setup/앱 초기화 이후)를 전제 — Vue 앱 밖에서 부르면 실패한다. GET 전용이며 POST 등 mutation 헬퍼는 아직 없다.
- `pickRandom`(utils)은 빈 배열에서 `undefined` 반환 — `noUncheckedIndexedAccess` 덕에 타입에 이미 반영됨.
- 버전은 전부 `0.0.0` + `private: true` — npm 배포 대상이 아닌 workspace 전용.

## Sources [coverage: high — 10 sources]

- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md)
- [packages/config/package.json](../../samplepcb-web-mono-app/packages/config/package.json)
- [packages/config/typescript/base.json](../../samplepcb-web-mono-app/packages/config/typescript/base.json)
- [packages/shared/package.json](../../samplepcb-web-mono-app/packages/shared/package.json)
- [packages/shared/src/index.ts](../../samplepcb-web-mono-app/packages/shared/src/index.ts)
- [packages/shared/src/auth.ts](../../samplepcb-web-mono-app/packages/shared/src/auth.ts)
- [packages/shared/src/api-client.ts](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts)
- [packages/shared/src/queries.ts](../../samplepcb-web-mono-app/packages/shared/src/queries.ts)
- [packages/utils/package.json](../../samplepcb-web-mono-app/packages/utils/package.json)
- [packages/utils/src/index.ts](../../samplepcb-web-mono-app/packages/utils/src/index.ts)
