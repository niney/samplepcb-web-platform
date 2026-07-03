---
topic: api-contract
last_compiled: 2026-07-03
sources_count: 9
status: active
---

# api-contract

## Purpose [coverage: medium — 3 sources]

`@sp/api-contract`(위치: `samplepcb-web-mono-app/packages/api-contract`)는 **Zod 스키마 + 추론 타입 + 라우트 상수**를 담은 FE/BE 공통 계약 패키지다. sp-node(Fastify API)와 클라이언트(거버 뷰어, sp-php 견적관리 페이지, sp-vue)가 공유하는 요청/응답의 **단일 진실원본(single source of truth)** 역할을 한다. AGENTS.md 규칙상 "API 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod)에 정의하고 FE/BE 양쪽이 그걸 import" 해야 한다.

## Architecture [coverage: high — 6 sources]

- **빌드 없는 src 직접 노출**: `package.json`의 `main`/`types`/`exports` 모두 `./src/index.ts` — 소비자가 TypeScript 소스를 직접 import 한다. 스크립트는 `typecheck`·`lint`만 존재.
- **유일한 런타임 의존성은 `zod`**(`^3.24.1`). devDeps 로 `@sp/config`(공유 tsconfig/eslint) 사용 — `strict` + `exactOptionalPropertyTypes` 등 "매우 강함" 타입 강성 기준을 따른다.
- 파일 구성:
  - `src/schemas/common.ts` — `ApiError`, `HealthResponse`
  - `src/schemas/auth.ts` — `Me`, `JwtClaims`
  - `src/schemas/pcb-project.ts` — 거버 주문/견적 계약 (핵심)
  - `src/routes.ts` — `apiRoutes` 상수 (`/api/health`, `/api/me`, `/api/pcb-projects`)
  - `src/index.ts` — 전부 re-export
- 데이터 흐름에서의 위치: **DB(Prisma) → API(Fastify, `fastify-type-provider-zod`) → 계약(`@sp/api-contract`) → Vue(@tanstack/vue-query)** 가 타입으로 연결.

## Talks To [coverage: medium — 4 sources]

- **sp-node (`apps/api`)**: `routes/pcb-projects.ts`(주문·견적 계약 다수), `routes/me.ts`(`Me`), `routes/health.ts`(`HealthResponse`), `plugins/auth.ts`(`JwtClaims`)에서 import — Zod type-provider 로 요청 검증과 응답 타입에 사용.
- **`@sp/shared`**: `api-client.ts`(`ApiError`를 throw 가능한 Error 로 래핑), `auth.ts`(`Me`), `queries.ts`(`apiRoutes` + 스키마) — Vue 앱은 이 패키지를 통해 간접 소비.
- **거버 뷰어(별도 repo `samplepcb_gerber`)**: 제출부 `apps/view/src/ResultPanel/submit.tsx` + 어댑터 `toProjectPayload.ts`가 `PcbProjectPayload` 형태의 multipart `payload` 파트(JSON)를 전송.
- **sp-php 견적관리 페이지(`/shop/quotes`)**: 목록·주문·수량수정·삭제 응답(`PcbProjectList*`, `PcbProjectOrder*` 등)의 소비자.

## API Surface [coverage: high — 5 sources]

`src/index.ts`가 export 하는 것 (스키마마다 `z.infer` 타입 동반, `...Type` 접미):

**common** — `ApiError { error, message }` · `HealthResponse { ok: true, service }`

**auth** — `Me { mbId, mbNick, level, isAdmin }` (그누보드 JWT 클레임/회원 식별, DB 직접결합 없음) · `JwtClaims = Me + { cartId?, iat, exp }` — `iat`/`exp` 필수(만료 없는 토큰은 검증 단계에서 거부), `cartId`는 영카트 장바구니 버킷 키(`ss_cart_id` = `g5_shop_cart.od_id`)로 과도기 토큰 호환을 위해 optional.

**pcb-project**
- `KNOWN_SPEC_KEYS` — 거버 뷰어가 보내는 spec 키 39종(camelCase 정규화 후) 상수 배열
- `PcbProjectSpec` — 39종 키(optional) + `catchall(SpecValue)`; 값은 `string | number`
- `PcbProjectPayload` — multipart `payload` 파트 계약: `{ flow: 'order'|'rfq', projectName, category, orderCategory: 'sample'|'mass', qty, message, spec }`
- `PcbProjectCreateResponse` — `{ projectId, quoteId, quoteStatus: 'priced'|'rfq', price(null=rfq), eta, cartAdded, redirectUrl, unknownSpecKeys? }`
- `PcbProjectListItem` / `PcbProjectListResponse` — 견적관리 목록: `quoteStatus: 'priced'|'rfq'|'quoted'`, `optionSummary`(cart `ct_option` 통일 표기), `thumbnailUrl`(서명 프록시, 만료 있음), `cartState: 'none'|'cart'|'ordered'`(저장 안 하는 파생 상태) 등
- `PcbProjectCartAddResponse` — [주문하기]: `{ ctId, redirectUrl }`
- `PcbProjectOrderRequest` `{ ids: number[] (min 1) }` / `PcbProjectOrderResponse` — [바로 주문]: `{ orderedCtIds, redirectUrl(/shop/orderform.php), failed?[] }`
- `PcbProjectQtyPatch` `{ qty }` / `PcbProjectQtyPatchResponse` — 수량 수정 = 서버 재견적(새 `quoteId` 발급)
- `PcbProjectDeleteResponse` — 소프트 삭제(`status: 'deleted'`)

**routes** — `apiRoutes = { health, me, pcbProjects }`

## Data [coverage: medium — 3 sources]

- **spec 값은 파싱하지 않는다**: 단위 혼재·"4type Merge" 같은 자유 텍스트가 많아 `string | number` 유니언으로 원본 그대로 수신. 가격 해석은 sp-node `pricing/engine.ts` 몫.
- spec 키 39종의 근거: 레거시 EAV(it_N 슬롯) 매핑표 + 레거시 슬롯이 없던 클라이언트 실전송 키 5종(`layersRigid`, `mat`, `surfaceFinishWeights`, `wvoltage` 등).
- 응답은 `{ result: true, data: {...} }` 봉투 패턴으로 통일. `price = finalPrice(관리자 확정) ?? autoPrice ?? null`, `createdAt`은 ISO 문자열, `eta`는 `'YYYY.MM.DD'` 또는 `''`.
- 실제 저장은 sp-node 쪽 Prisma(`sp_quote`/`sp_order_spec`/`sp_file`) — 계약 패키지 자체는 DB 를 모른다.

## Key Decisions [coverage: high — 5 sources]

- **spec 키 39종 계약 + catchall = "발견 지향" 검증**: 알려진 키는 열거하되 미지 키도 수신 허용(`catchall`), 서버가 `unknownSpecKeys`로 보고 — 계약 위반을 "차단"이 아니라 "발견"하기 위함. 본 구현 전환 시 strict 여부 재결정 예정.
- **`differentDesign` 통일(2026-07-03)**: 파일 개수 키는 `differentDesign`이 정본, 레거시 DB EAV(it_25 subj)의 `diffDesign`은 별칭으로만 취급. 거버 어댑터(`toProjectPayload.ts`)의 `differentDesign→diffDesign` 역행 매핑 제거.
- **`category` / `orderCategory` 네이밍 재정의**: `category` = 제품군(구 `state.menu`), `orderCategory` = 샘플/양산(구 `state.category`) — 레거시와 스왑되어 있어 주의 주석 명시.
- **[바로 주문]은 sp-node 가 수행**: 코어 `cartupdate act=buy`는 `it_id` 단위 선택이라 공유 템플릿 상품에서 부정확 → 행 단위 `ct_select` 선택을 계약(`PcbProjectOrderRequest`)으로 정의.
- **가격은 항상 서버 계산**: 수량 수정도 클라이언트가 가격을 보내지 않고 서버 재견적(`PcbProjectQtyPatchResponse`가 새 `quoteId` 반환). 관리자 확정(`quoted`)·담김 상태는 거부.
- **JWT는 검증만**: 그누보드가 발급, Fastify(`@fastify/jwt`)는 `JwtClaims`로 검증만 — Node 는 그누보드 스키마와 직접 결합하지 않는다.

## Gotchas [coverage: medium — 4 sources]

- **`differentDesign` 누락 시 실사고**: 이 키가 spec 에서 빠지면 가격이 "0원 → rfq(견적 대기)"로 빠진다 — 실제 발생했던 사고(`docs/pricing-engine-parity.md` 증상 노트 참조).
- **`category`/`orderCategory` 스왑 함정**: 레거시 상태명(`menu`/`category`)과 뒤바뀐 매핑이므로 어댑터 작성 시 혼동 주의.
- `thumbnailUrl`은 서명 프록시 URL 로 **만료가 있다** — 없으면 템플릿 이미지 폴백.
- `cartState`는 저장하지 않는 파생 상태(`ct_id → g5_shop_cart` 조인 결과) — 스키마에 있다고 DB 컬럼으로 오해하지 말 것.
- `JwtClaims.cartId`가 optional 인 것은 과도기 토큰 호환 때문 — cart 가 필요한 라우트는 자체적으로 존재를 검증해야 한다.
- 빌드 산출물이 없는 src 직접 노출 패키지이므로 소비자 tsconfig 가 `@sp/config` 기준과 호환되어야 한다.

## Sources [coverage: high — 9 sources]

- [package.json](../../samplepcb-web-mono-app/packages/api-contract/package.json)
- [src/index.ts](../../samplepcb-web-mono-app/packages/api-contract/src/index.ts)
- [src/routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts)
- [src/schemas/common.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/common.ts)
- [src/schemas/auth.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/auth.ts)
- [src/schemas/pcb-project.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-project.ts)
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md)
- [docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [@sp/shared 소비처: api-client.ts 외](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts)
