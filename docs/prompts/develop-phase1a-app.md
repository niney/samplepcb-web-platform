# 지시서 — 개발의뢰(sp-develop) P1 고객 앱 화면 (worker A)

리포 `D:\work\workspace_other\samplepcb-web-platform` (Windows, PowerShell/Git Bash). 브랜치 `feat/develop-mvp` (이미 체크아웃됨 — 브랜치 변경·커밋·push **금지**).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · **정본 `docs/DEVELOP_FLOW.md`**.

## 0. 한 줄 요약
`samplepcb-web-mono-app/apps/develop`(Vue3+Vite, base `/develop/`, 포트 5177)의 **고객 화면 전부**를 만든다: 랜딩 · 의뢰 위저드 3스텝(AI 없음) · 내 의뢰 · 의뢰 상세 · 의뢰 수정 · 견적서 인쇄용. 백엔드·계약·공용 UI·앱 셸은 이미 있다 — 당신은 페이지·컴포넌트·API 훅만 만든다.

## 1. 불변식(위반 시 반려)
- **파일 스코프**: `apps/develop/src/**` 안에서만 쓰고 고친다. 예외: `apps/develop/src/router.ts`·`layouts/DevelopLayout.vue`·`style.css`·`i18n/**` 는 **필요 최소 수정만**(라우트 추가·토큰 추가·셸 문구). 그 밖의 패키지(`packages/*`, `apps/api`, `apps/web`, `apps/market`)는 **읽기만**. 계약이 부족하면 고치지 말고 §7 보고 형식의 "이탈/요청"에 적는다.
- 타입 강성: `any`/`as any`/`@ts-ignore` 금지. `pnpm --filter develop typecheck` · `pnpm --filter develop lint` 0 이어야 한다.
- API 요청·응답은 반드시 `@sp/api-contract` 의 zod 스키마로(`apiGet(path, Schema)` / `apiSend` / `apiSendForm` — `@sp/shared`). 라우트 상수 `apiRoutes.developRequests`(`/api/develop/requests`)·`apiRoutes.developMyRequests`.
- 회원 전용: 비로그인 상태에서 의뢰하기·내 의뢰·상세는 그누보드 로그인으로 보낸다(`lib/auth-urls.ts` `loginUrl(developPath(route.fullPath))` — 마켓 `apps/market/src/pages/RequestWizard.vue` 관례).
- **고객에게 초안·작업본은 절대 없다** — 상세 응답의 `review`·`diagram` 은 이미 공개본만 온다. 화면은 그대로 그리면 된다.
- 디자인은 **마켓을 따라하지 않는다**(사용자 결정). 토큰은 `apps/develop/src/style.css` 의 것(brand 블루·ink·paper·line·tx-*·text-micro…text-display)만 쓰고, 마켓 화면을 복사해 오지 말 것. 공용 컴포넌트(`@sp/ui`)는 그대로 쓴다.
- 커밋 금지. 다른 워커(관리자 화면, `apps/web`)가 같은 트리에서 병렬로 작업 중이다 — 그 파일에 손대지 말 것.

## 2. 이미 있는 것(읽고 쓰기)
| 위치 | 내용 |
|---|---|
| `packages/api-contract/src/schemas/develop.ts` | **계약 정본** — 상태 사전·라벨(`DEVELOP_REQUEST_STATUS_LABELS`·`DEVELOP_PROGRESS_STEPS`), `DevelopRequestCreatePayload`(multipart payload 파트), `DevelopRequestUpdateBody`, `DevelopRequestListResponse`, `DevelopRequestDetailResponse`(+`DevelopRequestDetail`: files·review(공개본)·diagram(공개본 `{html, publishedAt, source, meta}`)·quotes·events·viewer), `DevelopFilesResponse`, `DevelopRequestCreateResponse`, `DevelopRequestStatusResponse`, `DevelopContact`, 견적 뷰 `DevelopQuoteView`·`DevelopMilestoneView`·`DevelopEventView`, `isDevelopEditable`·`isDevelopCustomerCancellable` |
| `packages/api-contract/src/schemas/market-areas.ts` | 분야 레지스트리 정본 — `MARKET_AREAS`(5종, label·short·hint·questions·tools·attachmentSlots), `MARKET_COMMON_CONDITIONS`(예산 제외 조건 3: timeline·target_stage·deliverable_scope, required), `MARKET_COMMON_QUESTIONS`(3), `marketQuestionsFor(areas)`, `marketRequiredMissing(answers, areas)`, `marketAnswerIssues`, `MarketTools`/`normalizeMarketTools`/`marketToolRows`, `marketAttachmentField(area, slot)`, `MARKET_ATTACHMENT_FIELD`('attachment'), `marketAreaBadge` |
| `packages/api-contract/src/schemas/market.ts` | `MARKET_BUDGET_RANGES`/`_LABELS`(예산 구간) |
| `packages/ui/src` (`@sp/ui`) | `AreaIcon`(code, size) · `FileDropZone`(files/label/hint/variant, emits add/remove) · `QuestionField`(question/state/noteMissing, emits toggle/note) · `FilePreviewModal`(open/filesPath/file, emits close/download) · `DevReviewView`(review, title?, diagram?: {meta, html}) · `DevDiagramSection`(diagram, uploaded?) · `UiPagination` · `canPreview` · `apiErrorMessage` · `QuestionState` 타입 |
| `apps/develop/src/{main.ts, router.ts, style.css, layouts/DevelopLayout.vue, lib/auth-urls.ts, lib/error-msg.ts, i18n/**}` | 앱 셸(내가 작성). 라우터가 가리키는 페이지 파일은 **당신이 만든다** |
| `apps/market/src/composables/useRequestWizardForm.ts` · `components/request/*.vue` · `pages/RequestWizard.vue` | 위저드 **로직 참고**(분야 선택·답변 상태·슬롯 첨부·필수 조건 게이트·multipart 조립). AI 잡 오케스트레이션(`useDevReviewJob`)은 **가져오지 않는다** |
| `apps/api/src/routes/develop-requests.ts` | 서버 라우트 — 요청 형식·에러 코드의 실체. 모르면 여기서 확인(추측 금지) |

## 3. 확정 설계(화면)
### 3.1 `pages/Home.vue` 랜딩
- 히어로(서비스 한 줄: "아이디어를 회로·PCB·펌웨어·앱·서버까지, 샘플피씨비가 직접 개발합니다" + CTA `의뢰하기` + 보조 링크 `진행 방식`) · **개발 분야 5** 카드(`#areas`, 레지스트리 label·hint, `AreaIcon`) · **진행 방식**(`#how`, 7단계: 접수 → 상담·검토(AI 사전 검토서·구성도 제공) → 견적서 → 수락·착수금 → 개발(중간 확인) → 납품·검수 → 잔금·산출물 인도·A/S) · "왜 직접 개발인가"(원스톱 양산 연계·소유권 이관·하자보수) · FAQ 4~6 · 하단 CTA. 로그인 여부 무관 공개 페이지.
### 3.2 `pages/RequestWizard.vue` 위저드 3스텝 (+ `components/request/*`, `composables/useRequestForm.ts`)
- ① **의뢰 내용**: 분야 카드(5 + "잘 모르겠어요 — 전부 맡길게요"=5종), 제목, 설명(≥10자), 참고 자료 `FileDropZone`(variant panel, "AI 분석 대상" 배지), **AI 분석 동의 체크**(기본 on, 문구: "참고 자료와 설명을 AI 사전 검토에 사용합니다. 담당자가 검토한 뒤 결과를 공개합니다").
- ② **조건·질문**: 프로젝트 조건 = 예산(`MARKET_BUDGET_RANGES` select) + 조건 3(`MARKET_COMMON_CONDITIONS`, 필수, `QuestionField`) + **비밀유지 계약 희망** 체크(`ndaWanted`) → 공통 질문 3 → 선택 분야마다 카드[맞춤 질문(`marketQuestionsFor`가 주는 그 분야 문항) · 희망 툴(`<details>` 접힘, 기본 "전문가 추천"=빈 선택) · 추가자료 슬롯(`FileDropZone` variant slot, 파트명 `marketAttachmentField(area, slot)`)]. "다음"은 `marketRequiredMissing` 이 빈 배열일 때만.
- ③ **연락처·확인**: 연락처 폼(이름·회사(선택)·전화·이메일·통화 가능 시간(선택) — 회원 정보(`useAuthStore().me`: mbName? 없으면 빈 값 — `@sp/shared` auth store 의 me 필드를 확인해 쓸 수 있는 것만 프리필) + 요약(분야·제목·조건·답변 수·첨부 수) + **등록**. 등록 = `FormData`: `payload`(JSON, `DevelopRequestCreatePayload` 모양) + `attachment` 파일들 + `attachment:<area>:<slot>` 파일들 → `apiSendForm('POST', apiRoutes.developRequests, form, DevelopRequestCreateResponse)`.
- 완료 화면(같은 페이지 상태): "접수되었습니다 — 담당자가 검토 후 영업일 2~3일 안에 연락드립니다" + AI 동의했으면 "AI 사전 검토서는 담당자 검토 후 공개됩니다" + 버튼 `의뢰 보기`(상세)·`내 의뢰`.
- 위저드 전역 드롭 가드(window dragover/drop preventDefault — 마켓 결정 48-2), 첨부 누적·중복 제거(name+size+lastModified), 파일별 ✕.
- 사이드(≥lg): 진행 3칸 + 현재 입력 요약. 하단 고정 액션 바(이전·다음/등록·첨부 n·답변 n).
### 3.3 `pages/Me.vue` 내 의뢰
- `GET /api/develop/my/requests?page=&pageSize=` → 카드/행: 제목·분야 배지·상태 배지(`DEVELOP_REQUEST_STATUS_LABELS`)·`nextAction` 이 있으면 강조 칩("견적 확인" · "결제하기" · "검수하기" · "확인 요청 답변") · 등록일. 빈 상태 CTA. `UiPagination`.
### 3.4 `pages/RequestDetail.vue` 상세 (+ `components/detail/*`)
- 헤더: 제목 · 상태 배지 · 진행 스텝퍼(`DEVELOP_PROGRESS_STEPS` 7칸, 종결(cancelled/declined)은 배지) · 소유자 액션(`viewer.canEdit` → 수정, `viewer.canCancel` → 취소(사유 선택, confirm 은 **네이티브 confirm 금지** — 인라인 확인 UI)).
- 섹션 내비(sticky): 의뢰 내용 · AI 사전 검토서 · 시스템 구성도 · 견적서 · 진행·문의 · 첨부.
- **의뢰 내용**: 설명 · 조건 타일(예산·조건 3 답) · 답변 표 · 희망 툴 행 · 연락처 · 비밀유지 희망.
- **AI 사전 검토서**: `review` 있으면 `<DevReviewView :review :title :diagram="diagramView">`(diagram = `{ meta: diagram.meta ?? 합성 done 메타, html: diagram.html }` — `source==='upload'` 면 `DevDiagramSection` 의 `uploaded` 를 켜야 하는데 DevReviewView 는 그 prop 을 안 넘기니 **검토서와 구성도를 분리 렌더**해도 된다: `DevReviewView` 는 `diagram` 미전달(그러면 내부 섹션이 "아직 만들지 않았습니다"를 그리므로 그건 피할 것) → 권장: `DevReviewView` 에 `diagram` 을 넘기고 `uploaded` 케이스는 DevReviewView 대신 자체 헤더 + `DevDiagramSection :uploaded="true"` 로 그린다. 두 경우 모두 화면 결과가 자연스러워야 한다). 없으면 상태별 안내: 접수/검토 중 → "담당자가 검토 중입니다. 검토서는 검토 후 공개됩니다"(aiConsent false 면 "AI 분석 미동의 — 담당자 검토로 진행합니다").
- **견적서**: `quotes` 각각 카드 — 버전·종류·상태·항목표(이름/금액)·공급가/VAT/합계·결제 조건(마일스톤 표: 명칭·비율·금액·시점·상태)·기간·산출물·별도 실비·표준 조건(접힘)·유효기간·[인쇄용 보기](`quote-print` 라우트, 새 탭). **수락·거절 버튼은 P2 라우트가 아직 없다 — 자리만 잡고 disabled + "곧 열립니다" 문구 금지 대신 버튼 자체를 안 그린다.** 견적이 없으면 상태별 안내.
- **진행·문의 타임라인**: `events`(visibleToCustomer 만 옴) 시간순 — 타입별 아이콘·라벨(`DEVELOP_EVENT_TYPE_LABELS`)·본문·첨부(파일 메타 `locked` 면 🔒 "잔금 결제 후 내려받기" 비활성). 문의 작성은 P2(라우트 없음) — 작성 UI 안 그린다.
- **첨부**: 참고 자료·슬롯 라벨(`marketSlotLabel`) — 다운로드(`apiGetBlob` → `lib/download.ts` 저장, 마켓 `apps/market/src/lib/download.ts` 참고해 새로 작성) · 미리보기 `FilePreviewModal :files-path="`${apiRoutes.developRequests}/${id}/files`"` (`canPreview`).
### 3.5 `pages/RequestEdit.vue` 수정
- `viewer.canEdit` 아닐 때 진입하면 안내 + 상세로. 폼: 제목·분야·설명·조건·답변·툴·연락처·비밀유지(위저드 컴포넌트 재사용, AI 없음) → `PATCH /api/develop/requests/:id`(`DevelopRequestUpdateBody`, 바뀐 필드만) · 첨부 추가 `POST …/files`(multipart) · 삭제 `DELETE …/files/:fileId`. 저장 후 상세로.
### 3.6 `pages/QuotePrint.vue` 인쇄용
- 상세 응답에서 `qid` 견적을 찾아 A4 한 장 견적서: 회사(샘플피씨비 — 상수 문구; 회사 정보 API 는 P2)·수신(연락처 이름·회사)·견적번호 `Q{requestId}-v{version}`·발행일(sentAt)·유효기간·항목표·공급가/VAT/합계·결제 조건·기간·산출물·별도 실비·표준 조건·비고. `@media print` 에서 셸 숨김(레이아웃 `meta.bare` 라 헤더는 이미 없음), 상단 "인쇄" 버튼(`window.print()`, `print-hidden`).
### 3.7 `api/useDevelopRequests.ts`
- vue-query 훅: `useMyDevelopRequests(filters)`, `useDevelopRequest(id)`, `useCreateDevelopRequest()`, `useUpdateDevelopRequest()`, `useAddDevelopFiles()`, `useDeleteDevelopFile()`, `useCancelDevelopRequest()`. 성공 시 관련 쿼리 invalidate. 마켓 `apps/market/src/api/useMarketProjects.ts` 관례.

## 4. 검증 절차
1. `pnpm --filter develop typecheck && pnpm --filter develop lint` → 0.
2. dev 서버: `pnpm --filter develop dev`(5177) — 이미 떠 있으면 재사용. API 3333 은 떠 있다(`node --watch`). `/spcb`(그누보드 8888) 는 vite 프록시로 우회되지만 `/bbs/login.php` 는 프록시가 없어 직결(127.0.0.1:5177)에서는 **로그인 왕복이 안 된다** → 브라우저 확인은 (a) `samplepcb-web-mono-app/e2e/helpers/browser`(playwright-core, `/spcb/api/me` 스텁 로그인 — `e2e/tools/dev-review-v2-walk.ts` 참고)로 위저드 완주 1회 + 내 의뢰·상세 진입을 스크립트로 확인하거나, (b) 스텁이 어려우면 비로그인 화면(랜딩·로그인 유도)만 브라우저로 확인하고 나머지는 typecheck 로. **어느 쪽을 했는지 보고에 명시.** pageErrors 0.
3. 등록 스크립트를 돌렸다면 만든 의뢰는 그대로 두어도 된다(감사자가 본다) — 단 제목에 `[e2e]` 접두.

## 5. 알려진 함정
- `.vue` 발 타입은 ESLint 프로그램에서 error type 이 될 수 있다 — 변수 주석/`satisfies` 에 물리면 `no-unsafe-*` 오탐. 추론 타입 + `as const` 로 우회(리포 메모리 실측).
- `FileDropZone` 의 `<input>` 은 `sr-only`(display:none 금지 — Playwright `setInputFiles`).
- `QuestionState` 는 `@sp/ui` 에서 import(마켓 composable 은 re-export 뿐).
- `DevReviewView` 는 `review.meta.generatedAt` 등을 읽는다 — 공개본 스키마 그대로 넘기면 된다.
- 예산 라벨은 `MARKET_BUDGET_RANGE_LABELS`, 분야 라벨은 `marketAreaLabel`/`marketAreaBadge`, 상태 라벨은 `DEVELOP_REQUEST_STATUS_LABELS`. 화면에 한글 라벨을 새로 적지 말 것(사전이 정본).
- 네이티브 `alert/confirm/prompt` 금지(브라우저 자동화가 멈춘다) — 인라인 확인 UI.

## 6. 문서
- 만든 컴포넌트·페이지 구조를 `docs/DEVELOP_FLOW.md` §7.2 표 아래에 **한 단락**으로 추가(파일명 열거, 결정 3~5줄). 다른 절은 건드리지 않는다.

## 7. 보고 형식(최종 메시지)
1) 변경·신규 파일 목록 2) 지시서 이탈(있으면 왜) 3) 계약·서버에 대한 요청(부족했던 것) 4) 검증 결과(typecheck/lint 출력 요약, 브라우저 확인 방식과 결과, 만든 e2e 의뢰 id) 5) 남긴 이슈·TODO.
