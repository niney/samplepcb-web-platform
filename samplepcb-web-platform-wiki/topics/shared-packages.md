---
topic: shared-packages
last_compiled: 2026-09-19
sources_count: 64
status: active
---

# shared-packages

## Purpose [coverage: high — 12 sources]

`samplepcb-web-mono-app`(pnpm 9.15 + Turborepo 2.9.18, Node ≥22, TypeScript 6) 의 scope `@sp` 공용 패키지 중 계약 패키지를 제외한 **4종**을 다룬다. 소스 날짜 범위는 2026-06-30(초기 커밋의 `@sp/config`) ~ 2026-09-18(BOM_QUOTE.md 최신 갱신). 2026-07-03 컴파일 때 3종(`config`·`utils`·`shared`)이던 것이 **`@sp/ui` 신설(2026-09-05)** 로 4종이 됐고, `@sp/utils` 는 단일 파일 4함수에서 **도메인 순수 함수 8모듈 + 단위 테스트 186** 으로 자랐다.

| 패키지 | 이름 | 역할 (2026-09 현재) | 소비자 |
|---|---|---|---|
| `packages/config` | `@sp/config` | tsconfig · ESLint 프리셋(코드 없음). 2026-06-30 이후 **무변경** | 전 워크스페이스(devDep) |
| `packages/utils` | `@sp/utils` | FE/BE 가 **같은 함수**를 쓰는 순수 로직 — 부품 스펙 파서·BOM 가격·품목 판정 투영·KST 날짜·VAT·검토서 diff/뷰모델 | api · web · market · develop |
| `packages/shared` | `@sp/shared` | Vue 프런트 공용 레이어 — 인증 fetch 코어(`apiGet/apiSend/…`) + Pinia auth store + vue-query 훅 | web · market · develop |
| `packages/ui` | `@sp/ui` | 세 Vue 앱이 함께 쓰는 **렌더 컴포넌트 7종** + 에러 문구·파일 미리보기 헬퍼 | web · market · develop |

`@sp/api-contract`(Zod 스키마·라우트 상수)는 [api-contract](api-contract.md) 토픽이 다루지만, 이제 `utils`·`shared`·`ui` **셋 다** 그것에 의존한다 — "utils 는 런타임 의존성 0" 이라는 옛 설명은 [as of 2026-07-03] 에만 참이다.

## Architecture [coverage: high — 14 sources]

- **빌드 없는 src 직접 노출**: `shared`·`utils`·`ui` 모두 `main`/`types`/`exports` 가 `./src/index.ts`. 소비 측(Vite·tsx)이 TS/SFC 소스를 그대로 컴파일하며, `turbo.json` 의 `typecheck`·`test` 가 `^build` 에 걸려 있지만 이 패키지들엔 `build` 스크립트 자체가 없다(스크립트는 `typecheck`·`lint`, utils 만 `test`=`vitest run`).
- **워크스페이스 구성**: [pnpm-workspace.yaml](../../samplepcb-web-mono-app/pnpm-workspace.yaml) 은 `apps/*`·`packages/*`·**`e2e`**(2026-08-10 파트너 포털 E2E 편입) 세 항목. 앱은 `web`(/app)·`market`(/market)·`develop`(/develop, 2026-09-05)·`api`. 루트 [package.json](../../samplepcb-web-mono-app/package.json) 은 `turbo 2.9.18` 핀(2026-07-01, Windows `ghostty-vt.dll` 누락 회귀 회피).
- **`@sp/config` = 설정 파일 패키지**: `typescript/{base,node,vue}.json` + `eslint/{base,node,vue}.js` 를 subpath export. `base.json` 은 `strict`+`noUncheckedIndexedAccess`+`exactOptionalPropertyTypes`+`noUnusedLocals/Parameters`+`noImplicitReturns`+`noFallthroughCasesInSwitch`+`verbatimModuleSyntax`; `vue.json` 은 DOM lib+`jsxImportSource: vue`, `node.json` 은 `types: ["node"]`. ESLint 는 `strictTypeChecked`+`stylisticTypeChecked`+`projectService`, `no-explicit-any`=error, `consistent-type-imports`=error; `vue.js` 는 SFC 를 `vue-eslint-parser`(template)+ts parser(script)로 나누고 포맷 규칙은 prettier 에 양보. AGENTS.md 가 "이미 작성됨, 수정 금지 기준" 으로 못박음.
- **`@sp/utils` src 구조**(8모듈 + 골든 JSON 1 + 테스트 11):
  - [index.ts](../../samplepcb-web-mono-app/packages/utils/src/index.ts) — 초기 4함수(`isDefined`·`formatPrice`·`slugify`·`pickRandom`) + `maskName`(2026-07-08, Intl.Segmenter grapheme 단위) + 7모듈 재export
  - [spec-units.ts](../../samplepcb-web-mono-app/packages/utils/src/spec-units.ts)(540줄) · [bom-pricing.ts](../../samplepcb-web-mono-app/packages/utils/src/bom-pricing.ts)(193) · [bom-quote-presentation.ts](../../samplepcb-web-mono-app/packages/utils/src/bom-quote-presentation.ts)(359) · [kst-date.ts](../../samplepcb-web-mono-app/packages/utils/src/kst-date.ts)(38) · [vat.ts](../../samplepcb-web-mono-app/packages/utils/src/vat.ts)(16) · [dev-review-diff.ts](../../samplepcb-web-mono-app/packages/utils/src/dev-review-diff.ts)(183) · [dev-review-view.ts](../../samplepcb-web-mono-app/packages/utils/src/dev-review-view.ts)(94)
  - 2026-09-02/04 에 **삭제**된 것: `diagram-renderer.ts`(결정적 DiagramSpec→SVG, 2026-07-15 도입)·`dev-review-diagram.ts` — 구성도가 kimi 비동기 자유 SVG 로 바뀌며 유틸에서 빠졌다.
- **`@sp/shared` src**: `index.ts` 배럴 + [api-client.ts](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts)(인증 fetch 코어) + [auth.ts](../../samplepcb-web-mono-app/packages/shared/src/auth.ts)(Pinia `auth`) + [queries.ts](../../samplepcb-web-mono-app/packages/shared/src/queries.ts)(`useHealth`·`useMe`). 2026-07-03 이후 변경은 `api-client.ts` 한 파일(4커밋)뿐.
- **`@sp/ui` src**: [index.ts](../../samplepcb-web-mono-app/packages/ui/src/index.ts) 가 `components/*.vue` 7종을 default-export 재수출 + `lib/error-msg.ts`·`lib/file-preview.ts` + `types.ts`(`QuestionState`). `env.d.ts` 의 `*.vue` shim 으로 `vue-tsc --noEmit` 통과. 헤더 주석이 패키지 규칙 셋을 명문화 — **i18n 미사용**(도메인 라벨은 계약 상수, 화면 카피는 ko 인라인) · **Tailwind 시맨틱 토큰만**(`brand-*`·`ink-*`·`paper`·`line`·`line-2`·`tx-1/2/3`·`text-micro…text-h1`·`--color-area-*`, 값은 소비 앱 `style.css` `@theme` 이 정함) · **API 경로 비하드코딩**(`filesPath` prop).
- **소비 매트릭스**(각 앱 package.json 실측): `api` → contract+utils · `web`/`market`/`develop` → contract+shared+utils+ui. `e2e` 워크스페이스는 `@sp/*` 무의존. 파일 단위로 `@sp/utils` import 88곳, `@sp/shared` 150여 곳(web 이 `ApiRequestError` 73·`apiGet` 40·`apiSend` 35), `@sp/ui` 44곳(web 18·market 12·develop 14).

## Talks To [coverage: high — 10 sources]

- **패키지 간 의존 방향**(단방향): `config` ← 전부(devDep) · `api-contract` ← `utils`·`shared`·`ui` · `shared` ← `ui` · `utils` ← `ui`. `ui` 의 peerDep 은 `vue ^3.5` 뿐이지만 `@sp/shared` 를 거쳐 **Pinia 활성 컨텍스트**를 전제한다(`FilePreviewModal` → `apiGet/apiGetBlob` → `useAuthStore`).
- **`api` 는 `@sp/shared` 를 모른다** — `routes/bom-quotes.ts` 의 언급은 주석 한 줄(`toApiErrorPayload` 가 두 에러 형태를 정규화한다는 설명)뿐. Vue 레이어가 서버로 새지 않는 경계.
- **외부 시스템**: `auth.ts` 의 `bootstrap()` 이 그누보드 브리지 `/spcb/api/me` 를 same-origin fetch(PHPSESSID → HS256 JWT, TTL 10분 — 루트 AGENTS.md "인증 브리지" 가 단일 설명원본). `api-client.ts` 는 그 JWT 를 Bearer 로 `/api/*`(Fastify)에 첨부하고 **401 이면 `bootstrap()` 1회 재발급 후 재시도**. 상세는 [spcb-bridge](spcb-bridge.md)·[sp-node-api](sp-node-api.md).
- **Tailwind v4 와의 계약**: 세 앱의 `style.css` 첫 줄이 `@source "../../../packages/ui/src"` — workspace 심링크(`node_modules/@sp/ui`)는 자동 스캔에서 빠지므로 명시해야 클래스가 생성된다. 마켓은 카퍼 팔레트 위에 `--color-brand-*` **별칭**(시각 무변경)을 얹었고, develop 은 토큰 이름을 지키며 값만 "일렉트릭 블루" 로 새로 정했다([DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §2 결정 19).
- **FE/BE 동시 소비의 실제 지점**: `spec-units` 는 [sp-node-api](sp-node-api.md) 의 ES 색인(`es/sp-parts-index.ts`)·검색 라우트(`admin-parts.ts`)·카탈로그 인제스트 21파일과 [sp-vue-web](sp-vue-web.md) 의 `AdminParts.vue`·`BomPartSearchPanel.vue` 가 같이 쓴다. `bom-pricing` 은 서버 `bom-quote.ts`·`bom-rfq.ts`·`bom-procurement-policy.ts` 와 화면 `BomQuoteRow`·`BomRfqCompareModal`·`RfqReplyForm` 등 27파일. `bom-quote-presentation` 은 서버 `bom-upload-verifier.ts`·`bom-admin-review.ts` 와 관리자·고객 `BomQuoteRow`/`BomCandidateDrawer`. `dev-review-*` 는 [sp-market-web](sp-market-web.md)·[sp-develop-web](sp-develop-web.md)·관리자 `DevelopReviewDiff`/`DevReviewSummary` 와 `@sp/ui` 자신의 `DevReviewView`.

## API Surface [coverage: high — 20 sources]

**@sp/utils**
- `spec-units.ts`: `parseSpecToken(raw): SpecInterpretation[]`(kind×SI×confidence 다중 해석) · `parseQuery(q): ParsedQuery` · `variantsFor(kind, si)`(관행 표기 2n2·472·104…) · `normalizePackageCode`/`packageVariants` · `siRange(si, ±0.1%)` · `roundSig` · `SPEC_SI_FIELD`(ES 필드명 매핑) · `normalizeMpn`/`normalizeManufacturer`(api 에서 13곳).
- `bom-pricing.ts`: `neededQty`·`stampOrderQty`(MOQ·주문배수 올림)·`effectiveRfqReplyQty`(2026-08-27 §6.38)·`isSevereOrderSurplus`·`pickBreak`·`toKrw`·`applyQtyToOffer`·`pickDefaultOffer`(카탈로그 직접 선택 전용 — 엔진 추천과 분리)·`computeTotals` + 상수 `BOM_SAMPLEPCB_SUPPLIER`·`BOM_AUTOMATIC_SURPLUS_*`.
- `bom-quote-presentation.ts`: 품목 한 행을 관리자 대표 상태로 투영 — `bomQuoteItemMatchGroup`(matched/review/unmatched/nostock/excluded) · `bomQuoteAdminAttention`(kind 6종 × reason 16종, `reviewRequired`) · `summarizeBomQuoteItems` · `summarizeBomQuoteCandidateOfferIssues` · `isBomQuote*` 판정 6종.
- `kst-date.ts`: `kstDateOnly`·`fmtKstDate(iso, '—')`·`kstDateInput`·`kstToday` — 서버 `apps/api/src/lib/kst.ts` 의 클라이언트 짝(41파일 소비).
- `vat.ts`: `splitVatIncluded(total) → {supply, vat, total}`(영카트와 같은 역산, vat=잔액이라 합이 항상 일치).
- `dev-review-diff.ts`: `diffDevReview(a, b, reg)`(항목 단위 구조 비교, `DEV_REVIEW_DIFF_SECTION_LABELS` 한국어 하드코딩) · `diffWords`(공백 토큰 LCS). `dev-review-view.ts`: `buildDevReviewBriefRows`/`AreaCards`/`View(review, reg = MARKET_REGISTRY)` · `devReviewAreaBadge`.
- 루트: `isDefined`·`formatPrice`·`slugify`·`pickRandom`·`maskName`(서버가 적용, 원명은 응답에 싣지 않는 이중 방어).

**@sp/shared**
- `ApiRequestError extends Error`(`status`, `payload: ApiErrorType | null`) · `apiGet(path, schema)` · `apiSend(method, path, body, schema)`(body `undefined` 면 Content-Type 도 생략) · `apiSendForm(method, path, FormData, schema)` · `apiGetBlob(path)` · `apiSendBlob(method, path, body)`. 스키마 제네릭은 `ZodType<T, ZodTypeDef, unknown>` — `.catch()/.default()/.transform()` 섞인 응답도 호출부가 **출력** 타입을 받는다(2026-08-29).
- `useAuthStore`(`token`·`me`·`isLoggedIn`·`bootstrap()`) · `useHealth()` · `useMe()`.

**@sp/ui**
- 컴포넌트: `AreaIcon`(분야 코드 6종 선 아이콘, 색은 `--color-area-<code>`) · `UiPagination`(sp-vue 것의 미러) · `QuestionField`(칩+메모, `kind:'text'` 는 textarea) · `FileDropZone`(panel/slot, sr-only input — `display:none` 금지) · `FilePreviewModal`(`filesPath` prop, blob origin 상속 때문에 SVG 는 `<img>`·PDF iframe 은 `allow-same-origin` 없음·v-html 부재) · `DevReviewView`(`registry`·`diagram`·`versionLabel` prop) · `DevDiagramSection`(살균 HTML 을 `sandbox=""` iframe 으로만).
- 헬퍼: `apiErrorMessage(err, fallback, codeMessages)`(코드 사전은 **앱이 주입**, 401/404 폴백만 공통) · `errorMessage` · `canPreview`·`fetchPreviewBlob`·`fetchPreviewData`·`decodeTextBlob` + 계약 재수출(`fileViewKind`·`parseDelimited`…) · 타입 `QuestionState`·`PreviewTarget`.

**@sp/config**: `./tsconfig/{base,node,vue}.json` · `./eslint/{base,node,vue}` [as of 2026-06].

## Data [coverage: medium — 4 sources]

이 패키지들은 DB 를 소유하지 않는다. 데이터라 부를 것은 셋이다.
- **골든 벡터 JSON** — [spec-units.cases.json](../../samplepcb-web-mono-app/packages/utils/src/spec-units.cases.json)(`parse` 46 · `variants` 11 · `packages` 10 · `packageVariants` 3 = 70행). 파일 자신의 `$comment` 가 "이 표가 곧 요구사항 명세" 라 선언하고, [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) 도 같은 문장으로 인용한다. `expect` 는 부분 일치(초과 해석 허용 = 다중 해석 설계), `si` 는 상대오차 1e-6.
- **Zod 검증 경계** — `auth.ts` 의 `MeEndpointResponse{token, member: Me}` 와 `api-client.ts` 의 `ApiError`·`ApiMemberError`(관리자형 `{error,message}` 와 회원 봉투형 `{result:false,error}` 를 하나의 `ApiErrorType` 으로 정규화).
- **CSS 토큰 이름 계약** — `@sp/ui` 가 읽는 변수 이름 목록(위 Architecture)이 사실상 인터페이스다. web `style.css` 는 `--color-brand-50…700`·`ink-950/900/800`·`paper`·`line`·`line-2`·`tx-1/2/3`·`--color-area-{circuit,pcb,firmware,mech,app,server}` 를 `@theme`/`@theme static` 으로 정의한다.

## Key Decisions [coverage: high — 15 sources]

- **2026-09-10/11** — G 프로토타입 제거로 `@sp/ui` 에서 `DevelopWorkflowPanel`·`WorkDocumentView`·`WorkPlanView` 가 빠졌다([develop-prototypes](../../docs/develop-prototypes.md)). 그날 `@sp/utils` 183 → 지금 186(테스트 실측, 11파일).
- **2026-09-08** — 레지스트리 매개변수화: `DevReviewView` 에 `registry` prop, utils 뷰 빌더는 `reg = MARKET_REGISTRY` 기본에 develop 은 `DEVELOP_REGISTRY` 를 넘긴다. `QuestionField` 가 서술형(`kind:'text'`) 문항을 그리고 `AreaIcon` 에 `mech` 가 생겼다([DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §7.2.1).
- **2026-09-05** — **`@sp/ui` 신설 = 복사가 아니라 추출**([DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §2 결정 1·§7.1): 관리자가 검토서를 편집하려면 고객과 같은 렌더러로 미리보기가 필요한데 복사하면 3앱이 갈린다. 마켓에서 i18n 미사용·`@sp/*` 의존만 확인된 7컴포넌트를 옮기고 `copper-*` → `brand-*` 로 바꿨다. 같은 커밋에 `apiErrorMessage` 의 "코드 사전 주입" 설계와 utils `dev-review-diff`(글자 diff 가 아닌 구조 비교, §6.2).
- **2026-09-02/04** — 결정적 구성도 렌더러(`renderDiagramSpecHtml`)를 utils 에서 제거. [AI_DIAGRAM](../../docs/AI_DIAGRAM.md) 은 아직 그 함수를 서술한다 [stale, as of 2026-07-15].
- **2026-08-29** — `api-client.ts` 스키마 제네릭을 `<출력, Def, 입력=unknown>` 으로 완화. 입력=출력 강제 시 추론이 입력 형태로 무너져 소비처마다 parse 를 한 번 더 하는 우회가 생겼다(검토서 화면 실측).
- **2026-08-27** — 협력사 회신 실효 수량을 `effectiveRfqReplyQty` 하나로(폼 금액·RFQ 합계·비교 모달 동일 함수, [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) §6.38).
- **2026-08-04~21** — `bom-quote-presentation`: 엔진 판정을 바꾸지 않고 관리자 처리용 대표 상태로만 투영(kind/reason) — [judgment-single-owner](../concepts/judgment-single-owner.md) 의 "표시 계층은 재판정 금지" 를 지키면서 화면·검증기가 같은 투영을 공유.
- **2026-08-06/07** — `kst-date`(납기가 저장마다 하루씩 앞당겨지던 실측 결함, [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) §7-8) · `vat.splitVatIncluded`(관리자 상세 부가세 표시).
- **2026-07-19** — `bom-pricing`: 레거시 `priceService/useEstimate` 규칙을 검증 가능하게 재구현, "서버·FE 동일 함수"([BOM_QUOTE](../../docs/BOM_QUOTE.md) 가격·수량 규칙 절, 골든 14 → 현재 17). 합계 진실은 그래도 서버 재계산([server-single-truth](../concepts/server-single-truth.md)).
- **2026-07-18** — `spec-units`: **단위 지능은 ES 애널라이저가 아니라 TS 코드에**(색인·검색이 같은 파서, xpse 의 커스텀 토크나이저 방식 기각 — 유닛테스트 가능·양쪽 불일치 원천 차단). `utils` 가 이때 `@sp/api-contract` 의존과 vitest 를 얻었다.
- **2026-07-08** — `apiSend` 가 body `undefined` 면 Content-Type 을 싣지 않는다(Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`) · `apiSendForm` 신설 · `maskName` 은 서버 적용([MARKET_FLOW](../../docs/MARKET_FLOW.md)).
- **2026-07-03** — `apiGetBlob`(`<a href>` 는 Authorization 을 못 실으므로 fetch→Blob) · 2026-07-30 `apiSendBlob`(인보이스 엑셀).
- [as of 2026-06-30] 계약 스키마는 `@sp/api-contract` 에만 · `ApiRequestError` 래핑(`only-throw-error`) · JWT 는 그누보드 발급/Node 검증만 · `vue`/`pinia` 는 peerDependencies.

## Gotchas [coverage: high — 11 sources]

- **`@sp/api-contract` 엔 테스트 러너가 없다** — package.json 에 `test` 스크립트도 vitest 도 없어 계약의 순수 로직 테스트(`market-areas` 14 · `develop-areas` 11 · `develop-docs` 9 · `develop-docs-g-port` 5 · `develop-quote` 8 = 47)가 **`packages/utils/src/*.test.ts` 에 산다**. 계약 테스트를 찾을 땐 utils 를 봐야 한다.
- `packages/utils/.turbo/turbo-test.log` 는 **stale**(6파일·138, 삭제된 `dev-review-diagram.test` 포함). 실측은 `packages/utils` 에서 `npx vitest run`(11파일·186, 2026-09-19).
- **Tailwind `@source` 누락 = 무색 컴포넌트**. 새 Vue 앱이 `@sp/ui` 를 쓰려면 `style.css` 에 `@source "../../../packages/ui/src"` 와 토큰 이름 전부가 있어야 한다. 이름을 바꾸면 에러 없이 스타일만 사라진다(develop `style.css` 헤더 경고).
- `@sp/ui`·`@sp/utils` 는 **i18n 이 없다** — `DEV_REVIEW_DIFF_SECTION_LABELS` 등 한국어 하드코딩. 파트너 포털 3개국어([partner-i18n](../../docs/partner-i18n.md))는 `apps/web/src/partner/i18n.ts` 가 `PartnerLayout` 범위에서만 주입하고 공용 컴포넌트는 원문을 돌려준다. 포털 `PartnerPageHeader` 는 `apps/web/components/partner/` 소속이지 `@sp/ui` 가 아니다([PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) §3.1).
- **UiPagination 이 둘** — sp-vue 원본 `apps/web/src/components/ui/UiPagination.vue` 와 `@sp/ui` 미러. web 은 개발의뢰 큐(`DevelopQueueTable.vue`)에서만 `@sp/ui` 것을 쓴다. web 의 `components/ui/`(Badge·ComboInput·ConfirmHost·PromptModal)는 여전히 앱 로컬 키트.
- `apiGet/apiSend` 는 Pinia 활성 컨텍스트 전제(`useAuthStore()`) — Vue 앱 밖·setup 이전 호출 불가. 401 재시도 뒤에도 401 이면 그누보드 세션 종료이므로 그대로 throw(호출측이 재로그인 안내). 로컬에서 `/spcb/api/me` 401 이 계속되면 도메인와이드 PHPSESSID 충돌부터 의심.
- **날짜에 `iso.slice(0, 10)` 금지** — KST 자정 앵커 값은 UTC 로 전날 15:00 이라 하루 앞당겨 보이고, 프리필 왕복마다 실제 납기가 밀린다. `fmtKstDate`/`kstDateInput`/`kstToday` 로 통일.
- `FileDropZone` 의 숨은 input 은 `sr-only`(Playwright `setInputFiles` 가 잡는다) — `display:none` 으로 바꾸면 E2E 가 깨진다. `FilePreviewModal` 은 `canPreview` 가 프런트에서도 크기 상한을 본다(image·pdf·text 는 서버를 안 거쳐 서버 상한이 안 걸림).
- `@sp/config` 는 수정 금지 기준. `any`/`as any`/`@ts-ignore` 금지, `noUncheckedIndexedAccess` 라 `pickRandom` 의 `undefined` 반환 등이 타입에 드러난다. 전 패키지 `0.0.0`+`private` — npm 배포 대상 아님.

## Sources [coverage: high — 64 sources]

문서
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) · [AGENTS.md](../../AGENTS.md) · [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) · [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) · [docs/partner-i18n.md](../../docs/partner-i18n.md) · [docs/PARTNER_PORTAL.md](../../docs/PARTNER_PORTAL.md) · [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) · [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) · [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) · [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) · [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) · [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) · [docs/develop-prototypes.md](../../docs/develop-prototypes.md)

워크스페이스
- [pnpm-workspace.yaml](../../samplepcb-web-mono-app/pnpm-workspace.yaml) · [turbo.json](../../samplepcb-web-mono-app/turbo.json) · [package.json](../../samplepcb-web-mono-app/package.json) · [packages/api-contract/package.json](../../samplepcb-web-mono-app/packages/api-contract/package.json)

packages/config
- [package.json](../../samplepcb-web-mono-app/packages/config/package.json) · [typescript/base.json](../../samplepcb-web-mono-app/packages/config/typescript/base.json) · [typescript/node.json](../../samplepcb-web-mono-app/packages/config/typescript/node.json) · [typescript/vue.json](../../samplepcb-web-mono-app/packages/config/typescript/vue.json) · [eslint/base.js](../../samplepcb-web-mono-app/packages/config/eslint/base.js) · [eslint/node.js](../../samplepcb-web-mono-app/packages/config/eslint/node.js) · [eslint/vue.js](../../samplepcb-web-mono-app/packages/config/eslint/vue.js)

packages/shared
- [package.json](../../samplepcb-web-mono-app/packages/shared/package.json) · [src/index.ts](../../samplepcb-web-mono-app/packages/shared/src/index.ts) · [src/api-client.ts](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts) · [src/auth.ts](../../samplepcb-web-mono-app/packages/shared/src/auth.ts) · [src/queries.ts](../../samplepcb-web-mono-app/packages/shared/src/queries.ts)

packages/utils
- [package.json](../../samplepcb-web-mono-app/packages/utils/package.json) · [src/index.ts](../../samplepcb-web-mono-app/packages/utils/src/index.ts) · [src/spec-units.ts](../../samplepcb-web-mono-app/packages/utils/src/spec-units.ts) · [src/spec-units.cases.json](../../samplepcb-web-mono-app/packages/utils/src/spec-units.cases.json) · [src/spec-units.test.ts](../../samplepcb-web-mono-app/packages/utils/src/spec-units.test.ts) · [src/bom-pricing.ts](../../samplepcb-web-mono-app/packages/utils/src/bom-pricing.ts) · [src/bom-pricing.test.ts](../../samplepcb-web-mono-app/packages/utils/src/bom-pricing.test.ts) · [src/bom-quote-presentation.ts](../../samplepcb-web-mono-app/packages/utils/src/bom-quote-presentation.ts) · [src/kst-date.ts](../../samplepcb-web-mono-app/packages/utils/src/kst-date.ts) · [src/vat.ts](../../samplepcb-web-mono-app/packages/utils/src/vat.ts) · [src/dev-review-diff.ts](../../samplepcb-web-mono-app/packages/utils/src/dev-review-diff.ts) · [src/dev-review-view.ts](../../samplepcb-web-mono-app/packages/utils/src/dev-review-view.ts) · [src/market-areas.test.ts](../../samplepcb-web-mono-app/packages/utils/src/market-areas.test.ts) · [src/develop-areas.test.ts](../../samplepcb-web-mono-app/packages/utils/src/develop-areas.test.ts) · [src/develop-docs.test.ts](../../samplepcb-web-mono-app/packages/utils/src/develop-docs.test.ts) · [src/develop-docs-g-port.test.ts](../../samplepcb-web-mono-app/packages/utils/src/develop-docs-g-port.test.ts) · [src/develop-quote.test.ts](../../samplepcb-web-mono-app/packages/utils/src/develop-quote.test.ts)

packages/ui
- [package.json](../../samplepcb-web-mono-app/packages/ui/package.json) · [env.d.ts](../../samplepcb-web-mono-app/packages/ui/env.d.ts) · [tsconfig.json](../../samplepcb-web-mono-app/packages/ui/tsconfig.json) · [src/index.ts](../../samplepcb-web-mono-app/packages/ui/src/index.ts) · [src/types.ts](../../samplepcb-web-mono-app/packages/ui/src/types.ts) · [src/lib/error-msg.ts](../../samplepcb-web-mono-app/packages/ui/src/lib/error-msg.ts) · [src/lib/file-preview.ts](../../samplepcb-web-mono-app/packages/ui/src/lib/file-preview.ts) · [components/AreaIcon.vue](../../samplepcb-web-mono-app/packages/ui/src/components/AreaIcon.vue) · [components/UiPagination.vue](../../samplepcb-web-mono-app/packages/ui/src/components/UiPagination.vue) · [components/QuestionField.vue](../../samplepcb-web-mono-app/packages/ui/src/components/QuestionField.vue) · [components/FileDropZone.vue](../../samplepcb-web-mono-app/packages/ui/src/components/FileDropZone.vue) · [components/FilePreviewModal.vue](../../samplepcb-web-mono-app/packages/ui/src/components/FilePreviewModal.vue) · [components/DevReviewView.vue](../../samplepcb-web-mono-app/packages/ui/src/components/DevReviewView.vue) · [components/DevDiagramSection.vue](../../samplepcb-web-mono-app/packages/ui/src/components/DevDiagramSection.vue)

소비 측(계약 확인용)
- [apps/web/src/style.css](../../samplepcb-web-mono-app/apps/web/src/style.css) · [apps/market/src/style.css](../../samplepcb-web-mono-app/apps/market/src/style.css) · [apps/develop/src/style.css](../../samplepcb-web-mono-app/apps/develop/src/style.css) · [apps/market/src/lib/error-msg.ts](../../samplepcb-web-mono-app/apps/market/src/lib/error-msg.ts)
