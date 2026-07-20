---
topic: sp-market-web
last_compiled: 2026-07-20
sources_count: 8
status: active
---

# sp-market-web

## Purpose [coverage: high — 5 sources]

`sp-market` — PCB **재능마켓(회로개발·PCB설계 전문가 ↔ 의뢰인 매칭) 고객 대면 Vue 3 SPA** (`samplepcb-web-mono-app/apps/market`). 그누보드(`sp-php`)와 같은 도메인에서 nginx 로 합류하며 **`/market` 경로**에 마운트된다(`base: '/market/'` 고정). 2026-07-08 신설.

**플랫폼 결정의 명시적 예외**: "고객 대면 신규 화면은 sp-php" 원칙(루트 AGENTS.md)의 예외로, 의뢰 마법사·블라인드 견적 비교·대시보드 같은 **SPA급 인터랙션**이 필요해 별도 Vue 앱으로 구현했다. sp-vue(`/app`)는 계속 관리자 전용이며, **마켓의 관리 화면은 sp-vue `/app/admin/market/{experts,projects,settings,contracts}`** 에 있다 — sp-market 에는 관리자 가드 자체가 없다.

기능 범위(1차+2차 완료, 정본 [MARKET_FLOW](../../docs/MARKET_FLOW.md)): 전문가 등록(개인/기업)·승인 → 프로젝트 의뢰(역견적=공개 블라인드 입찰 / 지정견적=1:1) → NDA 게이트 첨부 → 블라인드 입찰·비교·채택 → 계약 → 영카트 재사용 결제 → 납품 → 검수(7일 자동확정) → 정산. 여기에 **AI 인터뷰 파이프라인**(선분석→인터뷰→구성 명세→결정적 구성도·ROC·포스팅 카드, 정본 [AI_DIAGRAM](../../docs/AI_DIAGRAM.md))이 의뢰 위저드에 얹혔고, **2026-07-16 위저드 v2** 로 AI-우선 4스텝 구조가 됐다.

## Architecture [coverage: high — 6 sources]

- **스택**: Vite + Vue 3 + TypeScript + Vue Router + Pinia + @tanstack/vue-query + Tailwind v4(`@tailwindcss/vite`) + vue-i18n(로케일 `ko`/`en`). 폰트 Pretendard variable. 모노레포 타입 강성 "매우 강함"(strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint strictTypeChecked, `no-explicit-any`=error) 동일 적용.
- **모노레포 구성원**: pnpm workspaces + Turborepo, scope `@sp`. workspace 의존 `@sp/api-contract`(Zod 계약 — 마켓 코드 사전·라벨·질문 뱅크 정본 `schemas/market.ts`)·`@sp/shared`(API 클라이언트·vue-query 훅·Pinia auth store)·`@sp/utils`(결정적 구성도 렌더러 `renderDiagramSpecHtml` 포함)·`@sp/config`. 형제 앱으로 `apps/rnd`(`/rnd`, 5177 — 연구용 독립 SPA, 마켓과 무관)가 2026-07-17 추가됐다.
- **부트스트랩 순서(main.ts)**: pinia → i18n → vue-query 설치 후 **마운트 전 `useAuthStore(pinia).bootstrap()`** 으로 인증 브리지 세션 복원 → **그 다음에** `app.use(router)`. vue-router 는 install 시점에 초기 네비게이션을 시작하므로 router 설치가 복원 뒤여야 한다 — 아니면 `/market/*` 딥링크가 빈 auth 상태로 첫 렌더된다(main.ts 주석).
- **라우트(router.ts)**: `createWebHistory('/market/')`, 단일 `MarketLayout` 하위 8페이지 — `Home`(`/`) · `Projects` · `ProjectDetail`(`/projects/:id`) · `Experts` · `ExpertDetail`(`/experts/:id`) · `RequestWizard`(`/request`) · `ExpertRegister`(`/expert/register`) · `Me`(`/me`). 라우트 가드 없음 — 로그인 필요 액션은 각 화면이 그누보드 로그인(`/bbs/login.php?url=<returnPath>`, `lib/auth-urls.ts`)으로 왕복시킨다.
- **src 구조**: `api/`(vue-query 훅 — `useMarketProjects`·`useMarketExperts`·`useMarketBids`·`useMarketContract`·`useMarketExpertMe`·`useMarketSettings`·`useAi`) · `components/`(`ProjectCard`·`ExpertCard`·`ExpertProfileForm`·`BidFormModal`·`NdaSignModal`·`ContractCard`·`DeliverModal`·`DiagramViewer`·`RocViewer`·`UiPagination` + **위저드 v2 분해 `components/request/Step{Area,Describe,Interview,Review}.vue`**) · `composables/useRequestWizard{Form,Ai}.ts` · `lib/`(`auth-urls`·`error-msg`(에러 코드→메시지 단일 소스)·`diagram-srcdoc`(CSP 주입+활성 요소 제거)·`download`·`market-format`) · `i18n/locales/{ko,en}.ts`.
- **핵심 화면 구성**:
  - `RequestWizard` — **위저드 v2(2026-07-16) = AI-우선 4스텝**: ① 분야 → ② 설명·자료(제목+자연어 설명+첨부+**AI 분석 동의, 기본 on**) → ③ AI 인터뷰(동적 — structurize 활성 && 동의일 때만 존재) → ④ 검토·등록. 셸은 ~170줄로 축소. 구 "전문 기술·도구"·"예산·일정"·"견적 방식" 스텝은 **삭제** — 예산·견적 마감·견적 방식·NDA 는 검토 스텝의 컴팩트 조건 폼으로 흡수, 희망 시작/완료일 입력은 제거(스키마 optional 유지). 인터뷰 스텝 진입 시 **선분석 v2 자동 실행**("제가 이해한 내용" `understood` 카드 + 명시 근거 있는 질문만 제외·근거 접이식) → 축소된 질문 5개씩·전체 최대 15(뱅크 80문항 결정적 선택). 검토 스텝 진입 시 **구조화 자동 시작**(~30초~3분) → 요약 카드+AI 추가질문(questions_missing 재구조화) → 결정적 SVG 구성도 즉시 렌더 → ROC·분야 카드는 접이식 선택. **포함 예정 산출물이 생성 중이면 등록 차단**(생성 중인 것만 빼는 건너뛰기 버튼). 동의 해제·비활성 시 스텝은 [분야, 설명·자료, 검토·등록] 일반 등록. legacy 단발 diagram UI 는 v2 에서 제거(유스케이스·API·기존 데이터 표시는 존치).
  - `ProjectDetail` — 소유자/전문가/공개 역할별 분기, 사이드바 최상단 `ContractCard`(거래 스텝·역할별 액션: 결제하기→영카트 orderform 직행, `DeliverModal` 납품, 검수 확정), `BidFormModal`(입찰 제출/재제출), `NdaSignModal`(전자서명), `DiagramViewer`(구성도)·`RocViewer`(작업검토지시서).
- **dev 서버(vite.config.ts)**: 포트 **5176 + `strictPort: true`**(nginx 가 5176 고정 프록시 — 점유 시 조용한 포트 드리프트 대신 명시적 실패), `host: '127.0.0.1'`(Windows IPv6 502 회피), `allowedHosts: ['local-web.samplepcb.co.kr']`, dev proxy `/api`→3333·`/spcb`→8888. 실행 `pnpm --filter market dev` 또는 루트 `pnpm dev`(web+market+rnd+api 동시).

## Talks To [coverage: high — 5 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 유일한 데이터 소스. 회원 라우트 `market-{experts,projects,bids}.ts` 소비, 계약은 `@sp/api-contract` `schemas/market.ts` + `routes.ts` 공유. AI 는 `POST /api/ai/:useCase/run` → jobId → `GET /api/ai/jobs/:id` 5초 폴링(비동기 잡) + 위저드 v2 의 multipart 경로 2종: `…/preanalyze-questions`(선분석 v2 — 등록 전 첨부 동반), `…/run-with-attachments`(첨부 텍스트·래스터 추출 분석).
- **sp-php 인증 브리지** (`/spcb`, :8888) — 그누보드 IdP. `@sp/shared` `useAuthStore.bootstrap()` 이 `GET /spcb/api/me` 로 세션→HS256 JWT 교환(무수정 재사용). 비로그인 액션은 `/bbs/login.php?url=…` 왕복. **checkout 은 JWT `cartId` 클레임 필수** — FE 가 checkout 직전 bootstrap 재발급.
- **sp-php 영카트 결제** — 계약 결제는 sp-market 이 직접 처리하지 않고 checkout API 가 카트행을 주입한 뒤 **`/shop/orderform.php` 로 직행**시킨다(앵커 상품 `sp-market-svc` 스냅샷 카트행 — 거버 담기와 동형).
- **sp-vue** (`/app/admin/market/*`) — 전문가 승인·프로젝트·계약(hold/정산/운영취소)·설정(수수료율·AI 연동) 관리 화면은 sp-vue 쪽. sp-market 은 소비자 표면만.
- **nginx** ([local-web.conf](../../ops/nginx/local-web.conf), `local-web.samplepcb.co.kr:443`) — `location /market/`→127.0.0.1:5176(WS Upgrade 헤더로 HMR 지원), `/api/`→3333, `/app/`→5173, `/rnd/`→5177, catch-all `/`→8888. 운영 빌드용 static+SPA fallback 블록은 주석으로 예비(택1). 라이브 반영 2026-07-08 완료 — 라이브 nginx 는 Windows 서비스라 `-s reload` 불가, 관리자 `net stop/start nginx`.

## API Surface [coverage: medium — 4 sources]

sp-market 자체는 API 를 노출하지 않는 소비자. 노출 표면은 브라우저 라우트:

| 라우트 (`/market` 하위) | 화면 | 비고 |
|---|---|---|
| `/` | Home | 마켓 랜딩 |
| `/projects` | Projects | 공개 목록(블라인드 — bidCount 만) |
| `/projects/:id` | ProjectDetail | 역할별 분기: 소유자=입찰 전체·채택, 전문가=my-bid·입찰·NDA, 계약 당사자=ContractCard·납품·검수. 구성도·ROC·포스팅 카드 표시 |
| `/experts` | Experts | 승인 전문가 목록(분야·세부분야·툴 필터) |
| `/experts/:id` | ExpertDetail | 프로필(displayName 비마스킹 — 공개 동의) |
| `/request` | RequestWizard | 의뢰 등록(위저드 v2 — AI-우선 4스텝) |
| `/expert/register` | ExpertRegister | 전문가 등록/pending·rejected 수정 재제출 |
| `/me` | Me | 내 의뢰·입찰·계약 대시보드 |

소비하는 서버 표면: 회원 `/api/market/*`(experts·projects·bids·contract·NDA·첨부 프록시) + `/api/ai/*`(run·jobs 폴링·preanalyze-questions·run-with-attachments). 에러 봉투는 `{result:false,error:'CODE'}` — `@sp/shared` 가 정규화(`ApiMemberError`)하고 코드→메시지 맵은 `apps/market/src/lib/error-msg.ts` 단일 소스.

## Data [coverage: medium — 4 sources]

- DB 직접 접근 없음 — 전부 sp-node 경유(`sp_market_*` 6테이블: expert·project·bid·nda_sign·settings·contract + 첨부는 `sp_file` 폴리모픽). 클라이언트 상태 Pinia(auth 는 `@sp/shared` 소유) + 서버 상태 vue-query.
- **코드 사전·한글 라벨 정본은 `packages/api-contract/src/schemas/market.ts`**(`MARKET_*`·`MARKET_*_LABELS`) — sp-market·sp-vue·sp-node 메일 빌더 3곳 공유, DB 에는 코드만 저장. 질문 뱅크 `AI_INTERVIEW_QUESTIONS`(정책 77+SW 보완 3=80문항)도 계약 데이터 — `selectAiInterviewQuestions` 가 FE 노출·서버 미응답 계산의 단일 판정 함수(한 번 5개·전체 최대 15).
- **위저드 v2 의 입력 축소**: 신규 의뢰의 `categories`·`cadTools` 는 항상 빈 배열(=무관)로 저장 — 특정 툴 요구는 설명·고정 제약 답변에 자연어로 담긴다. `categories` 물리 컬럼은 `specialties`(Prisma `@map`). 코드 사전·기존 데이터 표시·전문가 프로필 축은 유지.
- **판정은 서버, FE 는 선반영만**: lazy 입찰 마감·계약 lazy paid 승격·자동확정 전부 서버 계산. 전체서비스 입찰 제한(`requestType=system` × `expertType=individual` → 403 `FULL_SERVICE_COMPANY_ONLY`)도 서버 가드가 경계, FE 는 `useExpertMe` 로 선반영(버튼 숨김+안내). **블라인드·마스킹은 응답 형태로 강제** — 타인 입찰 엔드포인트 자체가 없고, 의뢰인 표시명은 서버 `maskName`, NDA 미서명자에겐 첨부 개수만.
- AI 산출물: **`diagramSpec`(구성 명세 JSON)이 피벗** — `@sp/utils` 결정적 렌더러가 FE 즉시 변환하고 서버가 저장 전 같은 함수로 `diagramHtml` 재생성(CSP+활성 요소 제거 후 저장). `rocMd`·`postings` 는 명세 없이는 서버가 저장 거부(create/PATCH 공통). `interviewAnswers` 는 **신규 등록에서 공개 동의(`interviewAnswersSharedAt`)한 건만** 소유자·관리자·견적 가능/채택 전문가에게 노출(소급 공개 없음).
- **provenance·신선도**: 등록 시 서버가 AI jobId 의 소유자·유스케이스·입력/출력 해시를 재검증해 `aiGenerationMeta` 저장 — 라벨은 "검증된 AI 생성본"/"명세 기반 시스템 렌더"/"고객 수정본"/"출처 미확인". 신선도 서명 2계층: 제목·설명·유형·분야·답변·질문 코드·첨부 메타 변경=전 산출물, 예산·마감·방식만 변경=ROC·카드만 오래됨 표시·제출 제외. 채택 트랜잭션은 의뢰 조건·AI 산출물·공개 동의 답변·채택 견적을 `sp_market_contract.requestSnapshot` 에 박제.

## Key Decisions [coverage: high — 6 sources]

1. **2026-07-16 — 위저드 v2 = AI-우선 4스텝**: 분야→설명·자료→AI 인터뷰→검토·등록. technical(전문 기술·도구)/schedule(예산·일정)/method(견적 방식) 스텝 삭제 — 조건은 검토 스텝 컴팩트 폼으로 흡수, 희망 시작/완료일 입력 제거. legacy 단발 구성도 UI 제거(유스케이스·기존 데이터 존치). AI 게이트는 "structurize 활성 && 설명 스텝 AI 분석 동의(기본 on)".
2. **2026-07-16 — 선분석 v2 + 첨부 분석 경로**: 선분석은 보수적 명시 근거만으로 질문 제외 + `understood` 요약 카드 반환(구형 캐시 잡 호환 optional 계약), 제거된 자리를 저순위 질문으로 재충전하지 않음. 첨부는 별도 고지(동의 통합) 후 제한 추출(파일 10개·50MB·텍스트 8만자 등 상한, 비전 모델 `qwen3.5:cloud`)로만 AI 에 전송.
3. **2026-07-15 — 구성도는 결정적 렌더러**: `DiagramSpec→HTML/SVG` LLM 호출을 `@sp/utils` 결정적 렌더러로 교체, 서버가 저장 직전 재생성(클라이언트 HTML 불신뢰). provenance(`aiGenerationMeta`)·신선도 서명·명세 없는 파생 문서 저장 거부·고정 보안 정책(고객 입력=자료) 주입.
4. **2026-07-12 — LLM 산출물 렌더 격리**: 구성도 HTML 은 반드시 **sandbox iframe(srcdoc)**(`DiagramViewer` + `diagram-srcdoc.ts` CSP `default-src 'none'`), ROC 마크다운은 **라인 파서 렌더·v-html 금지**(`RocViewer`).
5. **2026-07-12 — 전체서비스 입찰 제한 완화형**: 시스템 통합 의뢰는 목록·상세 공개 유지, **입찰만** company·house 로 제한(403 FULL_SERVICE_COMPANY_ONLY).
6. **2026-07-08 — 결제는 영카트 재사용**: 자체 PG 연동 없이 앵커 상품 `sp-market-svc` 카트행 주입 후 `/shop/orderform.php` 직행. paid 승격은 cron 없는 lazy write-back(라인 검증).
7. **2026-07-08 — "고객 대면=sp-php" 예외로 별도 앱 신설**: SPA급 인터랙션 필요 → sp-market(`/market`, 5176). sp-vue 는 관리자 전용 유지, 마켓 관리 화면은 `/app/admin/market`.
8. **2026-07-08 — strictPort 5176 + 로그인은 액션 단위 왕복**: nginx 고정 프록시라 포트 드리프트를 실패로 드러내고(5173=sp-vue, 5177=sp-rnd), 라우트 가드 없이 필요 시 각 화면이 `/bbs/login.php?url=…` 로 보낸다.
9. **(1차 한정) 문구 정책 예외**: 도메인 라벨은 계약 `MARKET_*_LABELS` 정본, 화면 고유 카피는 ko 인라인 — 모노레포 "라벨 i18n" 원칙의 1차 한정 예외(en 도입 시 i18n 이관). i18n 골격(`locales/{ko,en}.ts`)은 준비돼 있음.

## Gotchas [coverage: high — 6 sources]

- **main.ts 설치 순서 함정**: `app.use(router)` 를 auth `bootstrap()` **뒤에** — 어기면 딥링크가 비로그인 상태로 첫 렌더(내 의뢰·입찰 화면 오동작).
- **strictPort**: 5176 점유 시 dev 서버가 실패하는 게 정상 신호. **Windows Vite host 함정**: `host: '127.0.0.1'` 필수(기본 localhost 는 IPv6 만 → nginx 502) + `allowedHosts` 에 `local-web.samplepcb.co.kr` 없으면 403. **통합 라우팅은 `local-web` 호스트 하나뿐** — local·local-www 등은 `/` 전체가 Vue 라 PHP 인증 브리지·결제 왕복이 안 된다.
- **AI 잡은 인메모리** — 서버 재시작 시 소실, 클라이언트 재시도가 대응. 생성 수 분(glm-5.2 ~3분)이라 5초 폴링. 동일 회원·모델·프롬프트·입력 해시 성공 잡은 1시간 TTL 재사용(사용자 간 미공유).
- **검토 스텝 등록 차단**: 포함 예정 AI 산출물이 생성 중이면 등록 불가 — 버그가 아니라 설계(사유 안내 + "생성 중인 것만 빼고 바로 등록" 건너뛰기, 완료된 명세·구성도는 유지).
- **AI 스텝이 안 보이면 게이트 확인**: structurize 비활성(운영은 `/app/admin/settings` "AI 연동" 탭에서 활성화 필요)이거나 설명 스텝의 AI 분석 동의 해제 — 둘 다 스텝 배열이 3개로 준다.
- **위저드 v2 입력 변경 시 산출물 자동 실효**: 제목·설명·분야·답변·첨부가 바뀌면 선분석·명세·구성도·ROC·카드가 오래된 상태로 표시·제출 제외 — 재생성 필요. `aiQuestionCodes` 는 등록 시 재검증 전용, DB 미저장.
- **checkout 은 JWT cartId 클레임 필수** — 오래된 토큰이면 실패, FE 가 checkout 직전 bootstrap 재발급하는 이유.
- **에러 메시지는 error-msg.ts 단일 소스** — 서버 에러 코드(ALREADY_BID→PATCH 유도, ORDER_PENDING, ANCHOR_ITEM_MISSING 503, USECASE_NOT_APPLICABLE 409 등) 추가 시 여기도 갱신.
- **UI/UX 는 프로토타입 선언 지속**(모노레포 AGENTS.md) — 자유 교체 가능, 단 타입 강성(`any` 금지)은 불변.
- E2E 회귀는 `ops/scripts/e2e-market.mts`(1차 36+2차 56=총 92항목, api 가동 필요) — LLM 실호출은 E2E 에 없음(Ollama 의존), 실생성 검증은 관리자 AI 설정의 샘플 테스트로.

## Sources [coverage: high — 8 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 프로젝트 호칭·sp-market 신설 예외·nginx 통합 라우팅·인증 브리지
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·패키지·sp-market 위치 결정·apps/rnd 추가
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 재능마켓 단일 설명원본(범위·상태 머신·접근 제어·2차 결제·위저드 v2·운영)
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — AI 유스케이스 계층·인터뷰 파이프라인·선분석 v2·첨부 분석·provenance
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) — `/market`→5176 프록시·운영 static 블록
- [apps/market/src/router.ts](../../samplepcb-web-mono-app/apps/market/src/router.ts) — 라우트 8종·가드 없음 설계
- [apps/market/src/main.ts](../../samplepcb-web-mono-app/apps/market/src/main.ts) — 부트스트랩 순서
- [apps/market/vite.config.ts](../../samplepcb-web-mono-app/apps/market/vite.config.ts) — 5176 strictPort·host·proxy
