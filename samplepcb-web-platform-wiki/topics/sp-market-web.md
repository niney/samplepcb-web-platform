---
topic: sp-market-web
last_compiled: 2026-07-13
sources_count: 8
status: active
---

# sp-market-web

## Purpose [coverage: high — 5 sources]

`sp-market` — PCB **재능마켓(회로개발·PCB설계 전문가 ↔ 의뢰인 매칭) 고객 대면 Vue 3 SPA** (`samplepcb-web-mono-app/apps/market`). 그누보드(`sp-php`)와 같은 도메인에서 nginx 로 합류하며 **`/market` 경로**에 마운트된다(`base: '/market/'` 고정). 2026-07-08 신설.

**플랫폼 결정의 명시적 예외**: "고객 대면 신규 화면은 sp-php" 원칙(루트 AGENTS.md)의 예외로, 의뢰 마법사·블라인드 견적 비교·대시보드 같은 **SPA급 인터랙션**이 필요해 별도 Vue 앱으로 구현했다. sp-vue(`/app`)는 계속 관리자 전용이며, **마켓의 관리 화면은 sp-vue `/app/admin/market/{experts,projects,settings,contracts}`** 에 있다 — sp-market 에는 관리자 가드 자체가 없다.

기능 범위(1차+2차 완료, 정본 [MARKET_FLOW](../../docs/MARKET_FLOW.md)): 전문가 등록(개인/기업)·승인 → 프로젝트 의뢰(역견적=공개 블라인드 입찰 / 지정견적=1:1) → NDA 게이트 첨부 → 블라인드 입찰·비교·채택 → 계약 → 영카트 재사용 결제 → 납품 → 검수(7일 자동확정) → 정산. 여기에 2026-07-12 **AI 인터뷰 파이프라인**(구성 명세→구성도·작업검토지시서·분야별 포스팅 카드, 정본 [AI_DIAGRAM](../../docs/AI_DIAGRAM.md))이 의뢰 위저드에 얹혔다.

## Architecture [coverage: high — 6 sources]

- **스택**: Vite + Vue 3 + TypeScript + Vue Router + Pinia + @tanstack/vue-query + Tailwind v4(`@tailwindcss/vite`) + vue-i18n(로케일 `ko`/`en`). 폰트 Pretendard variable. 모노레포 타입 강성 "매우 강함"(strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint strictTypeChecked, `no-explicit-any`=error) 동일 적용.
- **모노레포 구성원**: pnpm workspaces + Turborepo, scope `@sp`. workspace 의존 `@sp/api-contract`(Zod 계약 — 마켓 코드 사전·라벨 정본 `schemas/market.ts`)·`@sp/shared`(API 클라이언트·vue-query 훅·Pinia auth store)·`@sp/utils`·`@sp/config`.
- **부트스트랩 순서(main.ts)**: pinia → i18n → vue-query 설치 후 **마운트 전 `useAuthStore(pinia).bootstrap()`** 으로 인증 브리지 세션 복원 → **그 다음에** `app.use(router)`. vue-router 는 install 시점에 초기 네비게이션을 시작하므로 router 설치가 복원 뒤여야 한다 — 아니면 `/market/*` 딥링크가 빈 auth 상태로 첫 렌더된다(main.ts 주석).
- **라우트(router.ts)**: `createWebHistory('/market/')`, 단일 `MarketLayout` 하위 8페이지 —
  `Home`(`/`) · `Projects`(`/projects`) · `ProjectDetail`(`/projects/:id`) · `Experts`(`/experts`) · `ExpertDetail`(`/experts/:id`) · `RequestWizard`(`/request`) · `ExpertRegister`(`/expert/register`) · `Me`(`/me`). 라우트 가드 없음 — 로그인 필요 액션은 각 화면이 그누보드 로그인(`/bbs/login.php?url=<returnPath>`, `lib/auth-urls.ts`)으로 왕복시킨다.
- **src 구조**: `api/`(vue-query 훅 — `useMarketProjects`·`useMarketExperts`·`useMarketBids`·`useMarketContract`·`useMarketExpertMe`·`useMarketSettings`·`useAi`) · `components/`(`ProjectCard`·`ExpertCard`·`ExpertProfileForm`·`BidFormModal`·`NdaSignModal`·`ContractCard`·`DeliverModal`·`DiagramViewer`·`RocViewer`·`UiPagination`) · `lib/`(`auth-urls`·`error-msg`(에러 코드→메시지 단일 소스)·`download`·`market-format`) · `i18n/locales/{ko,en}.ts`.
- **핵심 화면 구성**:
  - `RequestWizard` — 의뢰 등록 마법사. STEP2 "전문 기술·도구"는 **분야 종속 동적 스텝**(`MARKET_AREA_TOOL_GROUPS`·`MARKET_AREA_SPECIALTIES` 합집합, 질문 그룹 없는 분야만이면 스텝 자체 생략=4스텝). "설명·자료" 뒤 **AI 스텝도 동적** — 인터뷰 유스케이스(structurize+diagram-spec) 활성이면 질문 폼(13문항 뱅크)→명세 요약 카드+AI 추가질문→구성도 생성(~3분, 비차단)→ROC·포스팅 카드 생성(선택), 아니면 legacy 단발 diagram UI, 셋 다 비활성이면 스텝 없음.
  - `ProjectDetail` — 소유자/전문가/공개 역할별 분기, 사이드바 최상단 `ContractCard`(거래 스텝·역할별 액션: 결제하기→영카트 orderform 직행, `DeliverModal` 납품, 검수 확정), `BidFormModal`(입찰 제출/재제출), `NdaSignModal`(전자서명), `DiagramViewer`(구성도)·`RocViewer`(작업검토지시서).
- **dev 서버(vite.config.ts)**: 포트 **5176 + `strictPort: true`**(nginx 가 5176 고정 프록시 — 점유 시 조용한 포트 드리프트 대신 명시적 실패), `host: '127.0.0.1'`(Windows IPv6 502 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`, dev proxy `/api`→3333·`/spcb`→8888. 실행 `pnpm --filter market dev` 또는 루트 `pnpm dev`(web+market+api 동시).

## Talks To [coverage: high — 5 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 유일한 데이터 소스. 회원 라우트 `market-{experts,projects,bids}.ts` 소비, 계약은 `@sp/api-contract` `schemas/market.ts` + `routes.ts` 공유. AI 스텝은 `POST /api/ai/:useCase/run` → jobId → `GET /api/ai/jobs/:id` 5초 폴링(비동기 잡).
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드 IdP. `@sp/shared` `useAuthStore.bootstrap()` 이 `GET /spcb/api/me` 로 세션→HS256 JWT 교환(무수정 재사용). 비로그인 액션은 `/bbs/login.php?url=…` 왕복. **checkout 은 JWT `cartId` 클레임 필수** — FE 가 checkout 직전 bootstrap 재발급.
- **sp-php 영카트 결제** — 계약 결제는 sp-market 이 직접 처리하지 않고 checkout API 가 카트행을 주입한 뒤 **`/shop/orderform.php` 로 직행**시킨다(앵커 상품 `sp-market-svc` 스냅샷 카트행 — 거버 담기와 동형).
- **sp-vue** (`/app/admin/market/*`) — 전문가 승인·프로젝트·계약(hold/정산/운영취소)·설정(수수료율) 관리 화면은 sp-vue 쪽. sp-market 은 소비자 표면만.
- **nginx** ([local-web.conf](../../ops/nginx/local-web.conf), `local-web.samplepcb.co.kr:443`) — `location /market/`→127.0.0.1:5176(WS Upgrade 헤더로 HMR 지원), `/api/`→3333, `/app/`→5173, catch-all `/`→8888. 운영 빌드용 static+SPA fallback 블록은 주석으로 예비(택1). 라이브 반영 2026-07-08 완료 — 라이브 nginx 는 Windows 서비스라 `-s reload` 불가, 관리자 `net stop/start nginx`.

## API Surface [coverage: medium — 4 sources]

sp-market 자체는 API 를 노출하지 않는 소비자. 노출 표면은 브라우저 라우트:

| 라우트 (`/market` 하위) | 화면 | 비고 |
|---|---|---|
| `/` | Home | 마켓 랜딩 |
| `/projects` | Projects | 공개 목록(블라인드 — bidCount 만) |
| `/projects/:id` | ProjectDetail | 역할별 분기: 소유자=입찰 전체·채택, 전문가=my-bid·입찰·NDA, 계약 당사자=ContractCard·납품·검수. 구성도·ROC·포스팅 카드 표시 |
| `/experts` | Experts | 승인 전문가 목록(분야·세부분야·툴 필터) |
| `/experts/:id` | ExpertDetail | 프로필(displayName 비마스킹 — 공개 동의) |
| `/request` | RequestWizard | 의뢰 등록(동적 스텝 + AI 인터뷰 파이프라인) |
| `/expert/register` | ExpertRegister | 전문가 등록/pending·rejected 수정 재제출 |
| `/me` | Me | 내 의뢰·입찰·계약 대시보드 |

소비하는 서버 표면: 회원 `/api/market/*`(experts·projects·bids·contract·NDA·첨부 프록시) + `/api/ai/*`. 에러 봉투는 `{result:false,error:'CODE'}` — `@sp/shared` 가 정규화(`ApiMemberError`)하고 코드→메시지 맵은 `apps/market/src/lib/error-msg.ts` 단일 소스.

## Data [coverage: medium — 4 sources]

- DB 직접 접근 없음 — 전부 sp-node 경유(`sp_market_*` 6테이블: expert·project·bid·nda_sign·settings·contract + 첨부는 `sp_file` 폴리모픽). 클라이언트 상태 Pinia(auth 는 `@sp/shared` 소유) + 서버 상태 vue-query.
- **코드 사전·한글 라벨 정본은 `packages/api-contract/src/schemas/market.ts`**(`MARKET_*`·`MARKET_*_LABELS`) — sp-market·sp-vue·sp-node 메일 빌더 3곳 공유, DB 에는 코드만 저장. 질문 뱅크도 계약 데이터(`AI_INTERVIEW_QUESTIONS`, 13문항·`hideIf` 조건부 노출).
- **판정은 서버, FE 는 선반영만**: lazy 입찰 마감(`biddingClosed`)·계약 lazy paid 승격·자동확정 전부 서버 계산. 전체서비스 입찰 제한(`requestType=system` × `expertType=individual` → 403 `FULL_SERVICE_COMPANY_ONLY`)도 서버 가드가 경계이고 FE 는 `useExpertMe` 로 같은 규칙을 선반영(버튼 숨김+안내)할 뿐.
- **블라인드·마스킹은 응답 형태로 강제** — 타인 입찰을 주는 엔드포인트 자체가 없고, 의뢰인 표시명은 서버가 `maskName` 적용, NDA 미서명자에겐 첨부 개수만. FE 숨김은 보안 아님.
- AI 산출물은 프로젝트 필드로 저장·표시: `diagramHtml`(구성도)·`diagramSpec`(구성 명세 JSON — 파생의 원천)·`rocMd`(지시서)·`postings`(분야별 카드). `interviewAnswers` 는 저장 전용 — **응답에 미노출**.

## Key Decisions [coverage: high — 6 sources]

1. **2026-07-12 — AI 스텝은 관리자 활성 게이트 동적 스텝**: structurize+diagram-spec 둘 다 활성이면 인터뷰 UI, legacy diagram 만 활성이면 단발 UI, 전부 비활성이면 스텝 자체가 없음. 기존 유스케이스 의미를 바꾸지 않고(프롬프트는 DB=관리자 소유) 유스케이스를 추가하는 쪽을 택했다.
2. **2026-07-12 — LLM 산출물 렌더 격리**: 구성도 HTML 은 반드시 **sandbox iframe(srcdoc)**(`DiagramViewer`), ROC 마크다운은 **라인 파서 렌더·v-html 금지**(`RocViewer`). 외부(AI) 전송은 제목·분야·설명 텍스트뿐 — 첨부 파일은 절대 안 보냄(NDA 원칙).
3. **2026-07-12 — 전체서비스 입찰 제한 완화형**: 시스템 통합 의뢰는 목록·상세 공개 유지, **입찰만** company·house 로 제한(403 FULL_SERVICE_COMPANY_ONLY).
4. **2026-07-08 — 결제는 영카트 재사용**: 자체 PG 연동 없이 앵커 상품 `sp-market-svc` 카트행 주입 후 `/shop/orderform.php` 직행. paid 승격은 cron 없는 lazy write-back(라인 검증).
5. **2026-07-08 — "고객 대면=sp-php" 예외로 별도 앱 신설**: SPA급 인터랙션 필요 → sp-market(`/market`, 5176). sp-vue 는 관리자 전용 유지, 마켓 관리 화면은 `/app/admin/market`.
6. **2026-07-08 — strictPort 5176**: nginx 고정 프록시라 포트 드리프트를 실패로 드러낸다(5173=sp-vue, 5174·5175=worktree 병렬 dev 대역 다음 번호).
7. **2026-07-08 — 로그인은 라우트 가드가 아니라 액션 단위 왕복**: 관리자 가드 없는 공개 SPA — 필요 시 각 화면이 `/bbs/login.php?url=…` 로 보낸다.
8. **(1차 한정) 문구 정책 예외**: 도메인 라벨은 계약 `MARKET_*_LABELS` 정본, 화면 고유 카피는 ko 인라인 — 모노레포 "라벨 i18n" 원칙의 1차 한정 예외(en 도입 시 i18n 이관). i18n 골격(`locales/{ko,en}.ts`)은 준비돼 있음.

## Gotchas [coverage: high — 6 sources]

- **main.ts 설치 순서 함정**: `app.use(router)` 를 auth `bootstrap()` **뒤에** — 어기면 딥링크가 비로그인 상태로 첫 렌더(내 의뢰·입찰 화면 오동작).
- **strictPort**: 5176 점유 시 dev 서버가 실패하는 게 정상 신호 — 다른 포트로 밀리면 nginx 라우팅이 소리 없이 끊긴다.
- **Windows Vite host 함정**: `host: '127.0.0.1'` 필수(기본 localhost 는 IPv6 만 → nginx 502) + `allowedHosts` 에 `local-web.samplepcb.co.kr` 없으면 403.
- **통합 라우팅은 `local-web` 호스트 하나뿐** — local·local-www 등은 `/` 전체가 Vue 라 PHP 인증 브리지·결제 왕복이 안 된다.
- **AI 잡은 인메모리** — 서버 재시작 시 소실, 클라이언트 재시도가 대응. 생성이 수 분(glm-5.2 ~3분)이라 5초 폴링, 위저드는 비차단 진행(미완료 제출=구성도 없이 등록).
- **위저드 AI 스텝은 관리자 활성 필요** — 로컬은 diagram 계열 활성이지만 운영은 `/app/admin/settings` "AI 연동" 탭에서 켜야 나타난다. 안 보이면 버그가 아니라 게이트.
- **checkout 은 JWT cartId 클레임 필수** — 오래된 토큰이면 실패, FE 가 checkout 직전 bootstrap 재발급하는 이유.
- **에러 메시지는 error-msg.ts 단일 소스** — 서버 에러 코드(ALREADY_BID→PATCH 유도, ORDER_PENDING, ANCHOR_ITEM_MISSING 503 등) 추가 시 여기도 갱신.
- **UI/UX 는 프로토타입 선언 지속**(모노레포 AGENTS.md) — 자유 교체 가능, 단 타입 강성(`any` 금지)은 불변.
- E2E 회귀는 `ops/scripts/e2e-market.mts`(97항목, api 가동 필요) — LLM 실호출은 E2E 에 없음(Ollama 의존), 실생성 검증은 수동/스크립트.

## Sources [coverage: high — 8 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 프로젝트 호칭·sp-market 신설 예외·nginx 통합 라우팅·인증 브리지
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·패키지·sp-market 위치 결정
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 재능마켓 단일 설명원본(범위·상태 머신·접근 제어·2차 결제·운영)
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — AI 유스케이스 계층·인터뷰 파이프라인 Phase 1~3
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) — `/market`→5176 프록시·운영 static 블록
- [apps/market/src/router.ts](../../samplepcb-web-mono-app/apps/market/src/router.ts) — 라우트 8종·가드 없음 설계
- [apps/market/src/main.ts](../../samplepcb-web-mono-app/apps/market/src/main.ts) — 부트스트랩 순서
- [apps/market/vite.config.ts](../../samplepcb-web-mono-app/apps/market/vite.config.ts) — 5176 strictPort·host·proxy
