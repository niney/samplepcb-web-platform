---
topic: sp-market-web
last_compiled: 2026-09-19
sources_count: 35
status: active
---

# sp-market-web

## Purpose [coverage: high — 9 sources]

`sp-market` — PCB **재능마켓(회로·PCB·펌웨어·앱·서버 전문가 ↔ 의뢰인 매칭) 고객 대면 Vue 3 SPA** (`samplepcb-web-mono-app/apps/market`). 그누보드(`sp-php`)와 같은 도메인에서 nginx 로 합류하며 **`/market` 경로**(dev 5176, 운영 `apps/market/dist` 정적)에 마운트된다. 2026-07-08 신설. 소스 날짜 범위는 2026-07-08(1차·2차·nginx 반영) ~ 2026-09-11(개발의뢰 정본 승격)이며 코드 마지막 변경은 2026-09-08(레지스트리 팩토리 분리)이다. 2026-07-20 마지막 컴파일 이후 `apps/market` 커밋 20건·파일 변경 139회.

**최근 합의(2026-08-28 ~ 09-05) vs 이전 패턴(2026-07)**: 7월의 "4 AI 산출물(명세 JSON·구성도 HTML·작업검토지시서·분야별 카드)+80문항 인터뷰+선분석+provenance" 체계는 **2026-08-28 "AI 사전 검토서 1건" 체계로 전면 대체**됐고(정본 [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md), [AI_DIAGRAM](../../docs/AI_DIAGRAM.md) 은 경위 기록), 9월 첫 주에 v2 간소화(09-02) → **v3 분야 레지스트리 5종·3스텝 위저드·정밀 구성도 비동기(09-04)** → v4 구성도 단일화·v5 공통 조건 6 필수(09-04) → **의뢰 수정·버전(09-05)** → **렌더 컴포넌트 `@sp/ui` 추출(09-05)** 로 이어졌다. 같은 날 형제 앱 **sp-develop(개발의뢰, `/develop`, 5177)** 이 신설됐는데 마켓의 **위저드·흐름을 이관한 것이 아니라** 별도 앱·별도 테이블로 세우고 `@sp/ui`·계약 레지스트리·서버 AI 러너만 공유한다(정본 [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §0·§2, 토픽 [sp-develop-web](sp-develop-web.md)).

**플랫폼 결정의 명시적 예외**(유지): "고객 대면 신규 화면은 sp-php" 원칙(루트 [AGENTS](../../AGENTS.md))의 예외로 SPA급 인터랙션이 필요해 별도 Vue 앱. sp-vue(`/app`)는 관리자 전용이며 **마켓 관리 화면은 `/app/admin/market/{experts,projects,settings,contracts}` + `/app/admin/settings` "AI 연동" 탭** — sp-market 에는 관리자 가드 자체가 없다.

기능 범위(1차+2차 완료 2026-07-08, 정본 [MARKET_FLOW](../../docs/MARKET_FLOW.md)): 전문가 등록·승인 → 의뢰(역견적 공개 블라인드 / 지정견적 1:1) → NDA 게이트 첨부 → 블라인드 입찰·채택 → 계약 → 영카트 재사용 결제 → 납품 → 검수(7일 자동확정) → 정산. 여기에 **AI 사전 검토서(deepseek, 동기 30초~3분) + 정밀 시스템 구성도(kimi-k3 thinking high, 비동기 5~10분)** 가 얹히고, 등록 뒤 **의뢰 수정·이력·입찰자 경고**(§11)와 **첨부 미리보기**(§5.1)가 추가됐다.

## Architecture [coverage: high — 12 sources]

- **스택**: Vite 8 + Vue 3.5 + TypeScript 6 + Vue Router 4 + Pinia 3 + @tanstack/vue-query 5 + Tailwind v4 + vue-i18n 11(로케일 `ko`/`en` 골격 65줄 — 화면 카피는 ko 인라인). 폰트 Pretendard variable. 모노레포 타입 강성 "매우 강함"(strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, ESLint 10 strictTypeChecked, `no-explicit-any`=error).
- **workspace 의존**: `@sp/api-contract`(Zod 계약 — `schemas/market.ts`·**`market-areas.ts` 분야 레지스트리**·`market-dev-review.ts`·`market-dev-diagram.ts`·`file-preview.ts`·`area-registry.ts` 팩토리) · `@sp/shared`(API 클라이언트·auth store) · **`@sp/ui`(2026-09-05 신설, 마켓에서 추출)** · `@sp/utils` · `@sp/config`. 형제 앱은 `apps/web`(관리자)·`apps/develop`(개발의뢰)·`apps/api`. `apps/rnd` 는 2026-08-28 폐지([samplepcb-web-mono-app/AGENTS](../../samplepcb-web-mono-app/AGENTS.md)).
- **부트스트랩 순서(main.ts, 2026-07-08 이후 불변)**: pinia → i18n → vue-query 설치 후 **마운트 전 `useAuthStore(pinia).bootstrap()`** 으로 인증 브리지 세션 복원 → **그 다음에** `app.use(router)`. vue-router 는 install 시점에 초기 네비게이션을 시작하므로 router 설치가 복원 뒤여야 한다.
- **라우트([router.ts](../../samplepcb-web-mono-app/apps/market/src/router.ts))**: `createWebHistory('/market/')`, 단일 `MarketLayout` 하위 9페이지(`projects/:id/edit` 가 2026-09-05 추가) + **DEV 전용 `dev/review-states`**(`import.meta.env.DEV` 블록 — 운영 번들에서 통째로 빠진다). 라우트 가드 없음 — 로그인 필요 액션은 각 화면이 `/bbs/login.php?url=…` 왕복. `scrollBehavior` 가 해시 앵커를 smooth 로 처리(상세 섹션 내비 근거).
- **src 구조(46파일, 6,359줄)**: `api/`(`useMarketProjects` 10훅 — 목록·상세·생성·수정·**재생성 `useRegenerateDevReview`·정밀 구성도 `useRequestDevDiagram`·이력 `useProjectRevisions`·첨부 추가/삭제**; `useMarketBids`·`useMarketContract`·`useMarketExperts`·`useMarketExpertMe`·`useMarketSettings`; `useAi` 3종(status·run·job); `useMyDevDiagrams` 10초 폴링) · `components/`(`AreaToolsPicker`·`BidFormModal`·`ContractCard`·`DeliverModal`·**`DevDiagramTray`**·`ExpertCard`·`ExpertProfileForm`·`NdaSignModal`·`ProjectCard`·**`SaveResultModal`** + `request/{StepDescribe,StepDetails,StepReview,WizardAside}`) · `composables/{useRequestWizardForm(332줄), useDevReviewJob(193줄)}` · `layouts/MarketLayout`(`DevDiagramTray` 상시 마운트, 1440px) · `lib/{auth-urls,download,error-msg,market-format}` · `pages/`(9 + `dev/ReviewStates`) · `style.css`(`@source "../../../packages/ui/src"` + `brand-*`=카퍼 별칭 + **타입 스케일 6단계 토큰** + `--color-area-*` 5종).
- **2026-07-20 이후 사라진 것**: `StepArea`·`StepInterview`·`useRequestWizardAi.ts`(712줄)·`lib/diagram-srcdoc.ts`·`RocViewer`·`DiagramViewer`·`StepQuestions`·`DevReviewItemList`. **`@sp/ui` 로 옮겨간 것(09-05)**: `DevReviewView`·`DevDiagramSection`·`AreaIcon`·`FileDropZone`·`FilePreviewModal`·`QuestionField`·`UiPagination` + `lib/file-preview.ts`·공통 에러 폴백 `apiErrorMessage`. 마켓은 import 경로만 바뀌었다([packages/ui/src/index.ts](../../samplepcb-web-mono-app/packages/ui/src/index.ts)).
- **핵심 화면**:
  - **`RequestWizard`(v5, 2026-09-04)** = 항상 3스텝 `[describe, details, review]`: ① 의뢰 내용(분야 카드 5 + "잘 모르겠어요 — 전부 맡길게요" 3×2 격자 · 제목 · 설명 · 참고 자료 드롭존(**AI 분석 대상** 배지) · AI 동의) ② 몇 가지만 더(**프로젝트 공통 조건 6 필수 n/6** · 공통 질문 3 · 선택 분야마다 카드[맞춤 질문 2~3 · 희망 툴(전문가 추천 기본, 접힘) · 슬롯 첨부]) ③ 검토·등록(진입 시 검토서 자동 생성 — 분석 카드에 서버 `stage` 2단·90초 안심 문구·구성도 병렬 상태·탈출구 "검토서 없이 바로 등록" · 견적 마감). 레이아웃 1280px = 폼 + 320px sticky `WizardAside`(스텝별 안내·조건 진행·최종 요약) + 하단 고정 액션 바. 셸 229줄은 인디케이터·네비·제출만, 잡은 `useDevReviewJob` 이 셸 소유.
  - **`ProjectDetail`(942줄)** — 1440px = 헤더 → **sticky 섹션 내비(top-16)** → 카드(의뢰 내용·AI 사전 검토서·시스템 구성도·첨부·받은 견적·수정 이력) + 360px 사이드(소유자/전문가 액션·`ContractCard`). `DevReviewView`·`DevDiagramSection`·`FilePreviewModal` 은 `@sp/ui`. 수정 배지 `수정됨 vN`, 입찰자 경고 `myBidOutdated`, `devReviewStale` 배너 + 재생성 버튼, `?reviewJob=` 이어받기 폴링.
  - **`ProjectEdit`(510줄, 2026-09-05 신규)** — **위저드를 재사용하지 않는다**(위저드는 AI 잡 오케스트레이션까지 소유) — `QuestionField`·`AreaIcon`·`FileDropZone` 만 빌린다. 저장 = 편집의 끝(`SaveResultModal`, 두 버튼 모두 상세로).
  - **`DevDiagramTray`** — 우하단 플로팅, 진행 중일 때만 10초 폴링, 닫음·관전 기록은 localStorage.
- **dev 서버([vite.config.ts](../../samplepcb-web-mono-app/apps/market/vite.config.ts))**: 포트 `SP_MARKET_PORT ?? 5176` + `strictPort`, `host: '127.0.0.1'`, `allowedHosts: ['local-web.samplepcb.co.kr']`, proxy `/api`→`SP_API_TARGET ?? 3333`·`/spcb`→8888. 워크트리 병렬 확인 통로가 env 두 개로 열렸다.

## Talks To [coverage: high — 8 sources]

- **sp-node** (`/api`, Fastify 5, :3333) — 유일한 데이터 소스. 회원 라우트 `market-{experts,projects,bids}.ts` 소비. AI 는 **`POST /api/ai/market.dev-review/run`**(multipart `payload` + `attachment[]` — 1스텝 참고 자료만) → `{ jobId, diagramJobId, diagramSkipReason, diagramCached }` → `GET /api/ai/jobs/:id` 5초 폴링(`stage: attachments|review`) · `GET /api/ai/market.dev-review/status`(5분 캐시, 검토서 노출 게이트). 등록 뒤: `GET /api/market/my/dev-diagrams`(트레이) · `POST /market/projects/:id/dev-review`(재생성, 소유자·접수 중) · `POST …/:id/dev-diagram`(구성도 재생성) · `PATCH :id` + `GET :id/revisions` + 첨부 POST/DELETE(각각 revNo 반환) · `GET …/files/:fileId/preview`(xlsx·docx·zip 구조화).
- **sp-php 인증 브리지** (`/spcb`, :8888) — `useAuthStore.bootstrap()` 이 `GET /spcb/api/me` 로 세션→HS256 JWT 교환. **checkout 은 JWT `cartId` 클레임 필수** — FE 가 직전 bootstrap 재발급.
- **sp-php 영카트 결제** — 앵커 상품 `sp-market-svc` 스냅샷 카트행 주입 후 `/shop/orderform.php` 직행(2026-07-08 불변).
- **sp-vue** (`/app/admin/market/*` + `/app/admin/settings` AI 연동 탭) — 전문가 승인·프로젝트(정밀 구성도 강제 재생성)·계약·설정(검토서 모델·첨부 판독 모델·추가 지침·샘플 테스트·정밀 구성도 thinking 단계). 마켓은 소비자 표면만([sp-vue-web](sp-vue-web.md)).
- **sp-develop** (`/develop`, 5177) — 앱·테이블(`sp_develop_*`)·앵커 상품(`sp-develop-svc`)·AI 유스케이스 행(`develop.*`) 전부 **별개**. 공유는 세 층뿐: ① `@sp/ui` 렌더 컴포넌트(`DevReviewView` 에 `registry` prop) ② 계약 레지스트리 팩토리 `area-registry.ts` 위의 `MARKET_REGISTRY`/`DEVELOP_REGISTRY`(마켓 export·시그니처 불변) ③ 서버 AI 러너의 write-back 타깃 어댑터(`{kind:'market'}|{kind:'develop'}`). 마켓 위저드 컴포넌트는 develop 이 **복사·재사용하지 않고** 자기 `components/request/*` 를 따로 가진다(디자인도 마켓과 무관하게 새로). develop 은 "당사 직접 수행 과도적 사이트"로, 나중에 마켓 house 전문가로 합류할 여지만 열어 둔다.
- **nginx** ([local-web.conf](../../ops/nginx/local-web.conf)) — `upstream vite_market 5176 keepalive 32` + `map $http_upgrade $connection_upgrade`(**2026-08-16 실측 필수** — 없으면 Vite 모듈 요청 수만 건이 TIME_WAIT 을 쌓아 Windows 임시 포트 고갈 → 502 → 빈 화면), `/develop/`→5177 추가, `/rnd` 폐지. 운영([DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md), centrafab.co.kr, Cloudflare Flexible → nginx :80): `location ^~ /market/` alias `apps/market/dist` + SPA fallback, `location = /market` 301.

## API Surface [coverage: medium — 4 sources]

sp-market 자체는 API 를 노출하지 않는 소비자. 노출 표면은 브라우저 라우트:

| 라우트 (`/market` 하위) | 화면 | 비고 |
|---|---|---|
| `/` | Home | 랜딩 — 분야 진입 카드는 레지스트리 파생, 장식 수치 없음 |
| `/projects` | Projects | 공개 목록(블라인드 — bidCount 만), 분야 배지·"AI 사전 검토서" 칩, 분야 필터 5종 |
| `/projects/:id` | ProjectDetail | 역할별 분기 + 검토서·정밀 구성도·첨부 미리보기·수정 이력·입찰자 경고 |
| `/projects/:id/edit` | ProjectEdit | **2026-09-05** 소유자 수정(접수 중만) — 저장 후 상세로 |
| `/experts` · `/experts/:id` | Experts · ExpertDetail | 승인 전문가 목록(분야·툴 필터)·프로필 |
| `/request` | RequestWizard | 의뢰 등록 v5 3스텝 |
| `/expert/register` | ExpertRegister | 등록/재제출 — `AreaToolsPicker`(분야 5 + 분야별 툴) |
| `/me` | Me | 내 의뢰·입찰(`projectRevisedAfterBid` 배지)·계약 대시보드 |
| `/dev/review-states` | dev/ReviewStates | **DEV 전용** — 진짜 `StepReview` 를 가짜 잡으로 6상태×구성도 7종 미리보기 |

에러 봉투 `{result:false,error:'CODE'}` — 코드→메시지 맵은 [error-msg.ts](../../samplepcb-web-mono-app/apps/market/src/lib/error-msg.ts) 마켓 사전(`ANSWERS_REQUIRED`·`REVIEW_STALE`·`REVIEW_JOB_INVALID`·`USECASE_DISABLED`·`ATTACHMENT_FIELD_INVALID`·`DEV_DIAGRAM_RUNNING`·`NOT_EDITABLE` …) + 401/404 공통 폴백은 `@sp/ui apiErrorMessage`.

## Data [coverage: high — 6 sources]

- DB 직접 접근 없음 — 전부 sp-node 경유(`sp_market_*` **7테이블**: expert·project·bid·nda_sign·settings·contract + **`sp_market_project_revision`(09-05)**, 첨부는 `sp_file` 폴리모픽 + `area`·`slot` 컬럼). AI 잡은 **`sp_ai_job`(DB, 2026-08-28 — 인메모리 잡 폐기)**.
- **v3 저장 구조(2026-09-04, 마이그레이션 `20260904090000_market_v3_areas_registry` 가 옛 컬럼 삭제)**: `sp_market_project.serviceAreas`(string[]) · `tools`(`{version:1, byArea}`) · `answers`(옛 `interviewAnswers` 개명) · `devReview`(**v4** — `diagram` 없음, `stats` 확정 N·상의 M, `checks` R9, `observations`) · `devDiagram`(메타)·`devDiagramHtml`(살균 HTML). 삭제: `specialties`·`cadTools`·`diagramSpec`·`rocMd`·`interviewAnswersSharedAt`·`postings`·`aiGenerationMeta`. `requestType` 은 서버 파생(2개 이상=`system`), 표기는 `marketAreaBadge`.
- **분야 레지스트리가 정본**(`market-areas.ts`): `MARKET_AREAS` 5종(질문·툴·슬롯·프롬프트 조각) · `MARKET_COMMON_CONDITIONS` 3(`timeline`·`target_stage`·`deliverable_scope`, required) · `MARKET_COMMON_QUESTIONS` 3 · 분야 맞춤 14 · 풀 개발 캡 2(`MARKET_FULL_AREA_QUESTION_CAP`). 2026-09-08 팩토리 `createAreaRegistry` 로 분리됐으나 마켓 프롬프트·스키마는 바이트 동일. 저장은 `z.enum` 이 아니라 **문자열 + 레지스트리 검증**(빠진 분야는 라벨 "(종료)"). 예산 구간 `under500·r500_2000·r2000_5000·over5000·undecided`(09-04 상향).
- **판정은 서버, FE 는 선반영만**: 검토서 신선도는 로컬 서명(제목·분야·설명·답변·**1스텝 참고 자료**만 — 희망 툴·2스텝 슬롯 첨부는 원천이 아니다) vs 서버 `inputHash`(`devReviewAttachmentHashes` 를 실행·등록 라우트가 공유) → 400 `REVIEW_STALE`. 필수 조건은 `marketRequiredMissing` 한 함수를 2스텝 "다음"과 등록 라우트가 같이 쓴다. 미리보기 가능 판정 `fileViewKind` 도 계약 함수 하나. 수정 이력 diff 는 서버가 스냅샷 사슬에서 만들어 내려주고 화면은 계산하지 않는다. `myBidOutdated`·`devReviewStale`·`payable` 류는 전부 서버 파생.
- **클라이언트는 산출물 본문을 보내지 않는다** — 등록 payload 는 `devReviewJobId`(·`devDiagramJobId`)만, 서버가 자기 저장분을 소유자·완료·유스케이스·해시까지 대조해 박제. 해시 대조·"고객 수정본" provenance 라벨 체계는 08-28 통째로 사라졌다. 채택 트랜잭션 `requestSnapshot` 에는 `devReview` 가 들어간다.
- v1 검토서 저장분은 `safeParse` 실패 → null(검토서 없음)로 취급하나 `hasDevReview` 는 컬럼 존재 기준이라 목록 배지가 남을 수 있다. 설정 `sp_market_settings.feeRateBp` 10% 단일 공제(계약 생성 시 스냅샷)는 불변.

## Key Decisions [coverage: high — 10 sources]

1. **2026-09-11 — sp-develop 정본 승격·프로토타입 G 제거**([develop-prototypes](../../docs/develop-prototypes.md)): 마켓 코드·데이터 무영향. 마켓과의 분리(별도 앱·테이블) 유지.
2. **2026-09-08 — 분야 레지스트리 팩토리 분리**(`area-registry.ts` → `MARKET_REGISTRY`/`DEVELOP_REGISTRY`): 마켓 export 이름·시그니처 불변, 프롬프트·JSON 스키마 바이트 동일(dev-review 26·market-areas 14 tests). `DevReviewView` 에 `registry` prop, `--color-area-mech` 토큰이 마켓 style.css 에도 추가.
3. **2026-09-05 — 렌더 컴포넌트를 `@sp/ui` 로 추출(복사 아님)**: 관리자·개발의뢰가 고객과 같은 렌더러로 검토서를 미리보기·편집해야 해서. 규칙 = i18n 미사용·**시맨틱 토큰만**(`copper-*`→`brand-*`, 마켓은 별칭으로 시각 무변경)·API 경로 하드코딩 금지(`filesPath` prop). 마켓 typecheck·lint 0, e2e-market 148/0.
4. **2026-09-05 — sp-develop 을 별도 앱·별도 테이블로**(`sp_market_project` channel 컬럼 기각 — 공개 목록 쿼리에서 필터 하나 빠지면 비공개 의뢰가 마켓에 샌다). 위저드에서 AI 를 전부 뺀 관리자 주도 구조라 **마켓 위저드 오케스트레이션은 이식 대상이 아니었다**. 서버 러너만 타깃 어댑터로 일반화(마켓 동작 불변).
5. **2026-09-05 — 의뢰 수정·버전(§11)**: `2026-09: 입찰 1건이라도 있으면 잠금 + 검토서 붙으면 원천 수정 불가(DEV_REVIEW_ATTACHED) → 접수 중(bidding ∧ 마감 전)이면 입찰 유무 무관 수정 가능`. 수정 = append-only revision(수정 직전 스냅샷), 중대(분야·설명·답변·마감·첨부)/사소 구분, 중대 + 24시간 미만이면 마감 48시간 자동 연장, 검토서는 지우지 않고 `devReviewStale` 배지. **검토서 갱신은 자동이 아니라 선택**(구성도 5~10분·연속 수정 잡 폭주 방지). **저장 = 편집의 끝**(`SaveResultModal`, Esc·바깥 클릭은 닫기만).
6. **2026-09-04 밤 — AI 분석 대상 = 1스텝 참고 자료뿐(§13.10)**: 2스텝 분야 슬롯 자료는 저장·전문가 열람만, 외부 LLM 미전송. 신선도 서명·입력 해시·구성도 재생성 소스가 같은 집합.
7. **2026-09-04 밤 — 의뢰하기·상세 재설계(§13.9)**: 타입 스케일 6단계 토큰(12/13/14/15/18/28) · 의뢰하기 1280 + sticky 사이드 + 하단 액션 바 · 상세 1440 + sticky 섹션 내비 · 답변 표는 "의뢰 내용" 한 곳만(검토서 브리프 섹션 삭제) · 첨부 **드롭존 누적 + 파일별 ✕ + 페이지 드롭 가드** · 분석 카드·청사진 액자·`dev/review-states`.
8. **2026-09-04 저녁 — v5 공통 조건 6 을 2스텝 필수로 + 분야 맞춤 질문 14**: 답변형 3 은 `answers`, 예산·방식·NDA 는 컬럼. 등록 게이트 `ANSWERS_REQUIRED`. 풀 개발이면 분야당 앞 2문항. "설명에서 확인한 항목은 다시 안 묻기"(선분석 재도입)는 **안 한다**.
9. **2026-09-04 — v4 구성도 단일화(§13.7)**: `2026-09: 검토서 안 3열 카드 구성도 + kimi 정밀 SVG 두 개 → kimi 정밀 SVG 하나("시스템 구성도")`. 구성도 잡은 **3단계 진입 시 검토서와 병렬 시작**, 같은 입력 해시면 진행 중 잡도 재사용, `DevDiagramTray` 플로팅 알림(SSE·헤더 배지 안 함), 연결 안 된 잡은 재시작 시 `ABANDONED`.
10. **2026-09-04 — v3 재설계(§13)**: `2026-09: 분야 3종(회로·PCB·펌웨어) → 5종(+앱·서버)` · `위저드 2스텝(09-02) → 3스텝` · **레지스트리 하나에서 전부 파생** · 문자열+검증 저장 · **정밀 구성도 = 등록 뒤 서버 큐(동시 1)** + 게이트(첨부 ≥800자 ∨ 설명 ≥500자 ∨ 설계 단계∧첨부).
11. **2026-09-03 — 검토서 섹션 정리**: 작업 항목·개발 단계 제거(정적 안내가 AI 판단처럼 읽힘) · 기술개발 검토 결과 보강(분야별 준비 상태·답변↔자료 정합 R9·검토 관찰) · 구성도 제목 띠·범례·페이지 비율 옵션 · R8 자료 간 불일치 규칙. 프롬프트 `dev-review.v2.1`.
12. **2026-09-02 — v2 간소화**: 의뢰자는 이 분야를 모른다는 전제 — 2스텝·4문항·**확정만**(확인 필요 상태 축 폐지, 근거 없으면 삭제)·상의 항목 ≤6·판정어·등급·금액·주수 없음. 이 원칙은 v3 이후에도 유지.
13. **2026-08-28 — "AI 사전 검토서" 1건 체계로 전면 재구성**: `2026-08: 4산출물 + 80문항 인터뷰 + 선분석 + provenance → 검토서 1건, 클라이언트는 jobId 만`. 파이프라인 2단(비전 첨부 판독 `qwen3.5:397b` → 주모델 `deepseek-v4-pro:0813` think off, 프로빙으로 확정) · 프롬프트는 코드 정본(관리자는 토글·모델·추가 지침만) · 인메모리 잡 → `sp_ai_job` · **회사 전용 입찰 제한(`FULL_SERVICE_COMPANY_ONLY`) 폐지**·`requestType` UI 제거 · 너비 1152→1440 · sp-rnd 삭제. 마켓 화면 구현 지시서 [dev-review-phase4a-market](../../docs/prompts/dev-review-phase4a-market.md)(Opus 워커, `apps/market/` 스코프).
14. **(대체됨) 2026-07-16 위저드 v2 AI-우선 4스텝·선분석 v2·첨부 분석 / 07-15 결정적 렌더러·provenance / 07-12 sandbox iframe + ROC 라인 파서·전체서비스 입찰 제한 / 07-08 영카트 재사용·별도 앱·strictPort·액션 단위 로그인 왕복** — 07-08 결정(결제·별도 앱·포트·로그인)은 유지, 나머지는 08-28 이후 체계로 교체됐다(경위는 [AI_DIAGRAM](../../docs/AI_DIAGRAM.md)).

## Gotchas [coverage: high — 9 sources]

- **main.ts 설치 순서 함정**: `app.use(router)` 를 auth `bootstrap()` **뒤에** — 어기면 딥링크가 비로그인 상태로 첫 렌더.
- **strictPort·host·allowedHosts**: 5176 점유 시 실패가 정상 신호, `host: '127.0.0.1'` 필수(IPv6 만 열리면 nginx 502), `allowedHosts` 누락 시 403. 워크트리 두 번째 인스턴스는 `SP_MARKET_PORT`/`SP_API_TARGET` 로 옮긴다. **통합 라우팅은 `local-web` 호스트 하나뿐**.
- **nginx keepalive 는 선택이 아니다**(2026-08-16): `Connection "upgrade"` 고정값이 일반 요청까지 새 연결로 만들어 e2e 연속 주행 시 임시 포트 고갈 → 502 → "버튼이 안 보인다"로 죽는다 — 원인은 화면이 아니라 프록시. 라이브 nginx 는 Windows 서비스라 `-s reload` 불가, 관리자 `net stop/start nginx`.
- **AI 잡은 DB(`sp_ai_job`)** — 옛 "인메모리·재시작 소실" 문구는 08-28 폐기. 남은 구멍: 3단계에서만 시작한 구성도 잡은 소스가 메모리에만 있어 재시작 시 `ABANDONED`(위저드 "다시 만들기"가 새 잡) · 재생성 중 서버가 죽으면 running 잔존(다시 누르면 됨) · 위저드 라우트 이탈 시 잡 추적이 끊겨 재진입 시 재실행(서버 1시간 캐시가 LLM 재호출은 막음).
- **검토서 카드가 안 보이면 게이트 확인**: `GET /ai/market.dev-review/status` 비활성(운영은 `/app/admin/settings` AI 연동 탭) 또는 1스텝 AI 동의 해제. 스텝은 항상 3개 — 검토서 블록만 빠진다.
- **신선도 원천에 툴·슬롯 첨부가 없다** — 바꿔도 "오래됨"이 안 된다(의도). 로컬 서명과 서버 해시 규칙이 어긋나면 **정상 등록이 `REVIEW_STALE` 로 튕긴다** — e2e 하네스가 출하 코드의 `devReviewInputHash` 를 그대로 import 하는 이유.
- **`ANSWERS_REQUIRED`**: 조건 3(완료 시점·목표 단계·인도 범위) 미응답 등록은 400. 풀 개발(5분야)에서 분야 3번째 문항 답변은 `UNKNOWN_QUESTION` 400.
- **수정 화면 함정(§11.3·§11.5)**: 마감은 `deadlineTouched` 때만 보낸다(안 그러면 저장만 눌러도 23:59 로 밀려 "중대한 수정"이 공짜로 발생) · 첨부 업로드와 PATCH 는 판을 따로 남기므로 화면이 마지막 판 번호 + 둘 중 하나라도 중대로 합쳐 한 번만 알린다 · 고르기만 하고 안 올린 첨부는 저장이 대신 올리고, 실패하면 저장을 멈춘다 · 재생성을 고르면 `?reviewJob=<uuid>` 로 상세가 이어받아야 진행 띠가 뜬다(실측으로 발견).
- **드롭존**: 기본 `input` 은 `sr-only`(`display:none` 금지 — Playwright `setInputFiles` 가 못 잡는다). 페이지 `window` 드롭 가드가 없으면 빗나간 드롭 하나로 작성분이 통째로 사라진다. 첨부는 누적(옛 `pickAttachments` 는 배열 교체라 두 번째 선택이 첫 파일을 지웠다).
- **`@sp/ui` 소비 조건**: 앱 CSS 에 `@source "../../../packages/ui/src"` 없으면 클래스가 생성되지 않는다(Tailwind v4 는 node_modules 심링크 미스캔) · `brand-*`·`ink-*`·`paper`·`line`·`tx-*`·`--color-area-*` 토큰을 앱 `@theme` 이 정의해야 한다.
- **첨부 미리보기 보안 3제약**(§5.1): `blob:` URL 은 origin 을 상속 → SVG 는 `<img>` 로만, html 은 소스 텍스트로, PDF 는 `<embed>`(iframe+sandbox 는 Chrome 내장 뷰어가 거부 — 실측). 파일서버가 `octet-stream` 이면 Blob type 이 비어 뷰어가 안 뜬다 → 확장자 보정.
- **로컬 통합 도메인 PHPSESSID 충돌**: `/spcb/api/me` 401 이면 `.samplepcb.co.kr` 쿠키부터 삭제.
- **E2E 회귀**: [e2e-market.mts](../../ops/scripts/e2e-market.mts)(API 하네스, run → cleanup) — 헤더 주석은 134항목, 정본 §11 실측은 **148/0**(수정 8 + 재생성 가드 2, 09-05). 하네스가 시작 시 `market.dev-diagram` 유스케이스를 `enabled=0` 으로 내리고 끝날 때 원복한다(활성이면 등록마다 10분 kimi). LLM 실호출은 하네스에 없음 — 실브라우저 워크 `e2e/tools/dev-review-v2-walk.ts`·프로빙 `e2e/specs/dev-diagram-probe.e2e.test.ts`.
- **운영 런북 드리프트**: [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md) 의 nginx 전문·pnpm 필터에 `/rnd` 가 남아 있고 `/develop` 은 없다(08-28 폐지·09-05 신설 미반영).
- UI/UX 는 프로토타입 선언 지속(모노레포 AGENTS) — 단 타입 강성(`any` 금지)은 불변. 첫 `dev/review-states` 는 DEV 전용이라 운영 URL 에 없다.

## Sources [coverage: high — 35 sources]

- [AGENTS.md (root)](../../AGENTS.md) — 호칭 표(sp-market·sp-develop)·"고객 대면=sp-php" 예외·nginx 예약 경로
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·`@sp/ui` 규칙·apps 4종·dev 포트
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 단일 설명원본(§3 v3 데이터·§5.1 미리보기·§11 수정·버전·재생성 선택·저장=끝)
- [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) — AI 사전 검토서 정본(§0 08-28 결정·§12 v2·§13 v3~v5·§13.9~13.12 화면·§13.13 think max)
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — 대체됨 배너(08-28)·7월 4산출물·인터뷰 경위
- [docs/prompts/dev-review-phase4a-market.md](../../docs/prompts/dev-review-phase4a-market.md) — 08-28 마켓 화면 Opus 지시서(스코프·불변식)
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §0 마켓과의 관계·§2 결정 1·2·19·§7.1 `@sp/ui`·§7.2.1 레지스트리 분리
- [docs/develop-prototypes.md](../../docs/develop-prototypes.md) — 09-10/11 G 제거·C 승격(마켓 무영향)
- [docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) — 운영 `/market` 정적 블록·검증 명령(`/rnd` 잔존)
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) — keepalive map 실측·upstream 3종·`/rnd` 폐지 메모
- [ops/scripts/e2e-market.mts](../../ops/scripts/e2e-market.mts) — 하네스 헤더(134항목·유스케이스 억제·출하 해시 함수 import)
- [apps/market/package.json](../../samplepcb-web-mono-app/apps/market/package.json) — 의존(`@sp/ui`)·버전
- [apps/market/vite.config.ts](../../samplepcb-web-mono-app/apps/market/vite.config.ts) — `SP_MARKET_PORT`/`SP_API_TARGET`·strictPort·host
- [apps/market/src/main.ts](../../samplepcb-web-mono-app/apps/market/src/main.ts) — 부트스트랩 순서
- [apps/market/src/router.ts](../../samplepcb-web-mono-app/apps/market/src/router.ts) — 9라우트 + DEV 전용·scrollBehavior
- [apps/market/src/style.css](../../samplepcb-web-mono-app/apps/market/src/style.css) — `@source`·brand 별칭·타입 스케일·area 색
- [apps/market/src/layouts/MarketLayout.vue](../../samplepcb-web-mono-app/apps/market/src/layouts/MarketLayout.vue) — 1440px·트레이 상시 마운트
- [apps/market/src/pages/RequestWizard.vue](../../samplepcb-web-mono-app/apps/market/src/pages/RequestWizard.vue) — 3스텝 셸·레이아웃
- [apps/market/src/pages/ProjectDetail.vue](../../samplepcb-web-mono-app/apps/market/src/pages/ProjectDetail.vue) — 상세 레이아웃·이력·stale·`@sp/ui` 소비
- [apps/market/src/pages/ProjectEdit.vue](../../samplepcb-web-mono-app/apps/market/src/pages/ProjectEdit.vue) — 수정 화면(위저드 비재사용)
- [apps/market/src/pages/dev/ReviewStates.vue](../../samplepcb-web-mono-app/apps/market/src/pages/dev/ReviewStates.vue) — DEV 상태 미리보기
- [apps/market/src/components/request/StepDescribe.vue](../../samplepcb-web-mono-app/apps/market/src/components/request/StepDescribe.vue) — 1스텝
- [apps/market/src/components/request/StepDetails.vue](../../samplepcb-web-mono-app/apps/market/src/components/request/StepDetails.vue) — 2스텝(조건 6·분야 카드)
- [apps/market/src/components/request/StepReview.vue](../../samplepcb-web-mono-app/apps/market/src/components/request/StepReview.vue) — 3스텝 분석 카드·탈출구
- [apps/market/src/components/request/WizardAside.vue](../../samplepcb-web-mono-app/apps/market/src/components/request/WizardAside.vue) — sticky 사이드
- [apps/market/src/components/DevDiagramTray.vue](../../samplepcb-web-mono-app/apps/market/src/components/DevDiagramTray.vue) — 플로팅 트레이 규칙
- [apps/market/src/components/SaveResultModal.vue](../../samplepcb-web-mono-app/apps/market/src/components/SaveResultModal.vue) — 저장 결과 모달
- [apps/market/src/components/AreaToolsPicker.vue](../../samplepcb-web-mono-app/apps/market/src/components/AreaToolsPicker.vue) — 전문가 분야·툴
- [apps/market/src/composables/useRequestWizardForm.ts](../../samplepcb-web-mono-app/apps/market/src/composables/useRequestWizardForm.ts) — 스텝 3 고정·게이트
- [apps/market/src/composables/useDevReviewJob.ts](../../samplepcb-web-mono-app/apps/market/src/composables/useDevReviewJob.ts) — 잡 오케스트레이션·로컬 서명 원천
- [apps/market/src/api/useAi.ts](../../samplepcb-web-mono-app/apps/market/src/api/useAi.ts) — status·run·job 3훅
- [apps/market/src/api/useMyDevDiagrams.ts](../../samplepcb-web-mono-app/apps/market/src/api/useMyDevDiagrams.ts) — 10초 조건부 폴링
- [apps/market/src/api/useMarketProjects.ts](../../samplepcb-web-mono-app/apps/market/src/api/useMarketProjects.ts) — 10훅(재생성·구성도·이력·첨부)
- [apps/market/src/lib/error-msg.ts](../../samplepcb-web-mono-app/apps/market/src/lib/error-msg.ts) — 마켓 에러 코드 사전
- [packages/ui/src/index.ts](../../samplepcb-web-mono-app/packages/ui/src/index.ts) — `@sp/ui` 규칙·export 목록
