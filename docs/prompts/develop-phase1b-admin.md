# 지시서 — 개발의뢰(sp-develop) P1 관리자 화면 (worker B)

리포 `D:\work\workspace_other\samplepcb-web-platform` (Windows, PowerShell/Git Bash). 브랜치 `feat/develop-mvp` (체크아웃됨 — 브랜치 변경·커밋·push **금지**).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · **정본 `docs/DEVELOP_FLOW.md`**.

## 0. 한 줄 요약
sp-vue(`samplepcb-web-mono-app/apps/web`, `/app/admin`)에 **개발의뢰 관리 화면**을 만든다: 워크큐 · 전면 상세(상태 전이·AI 초안 재생성/구조 편집/공개·구성도 재생성/교체/공개·타임라인 이벤트 작성·내부 메모) · 설정 · AI 설정 탭의 develop 블록 · 사이드바 배지. 백엔드·계약·공용 UI·라우트/메뉴 등록은 이미 있다.

## 1. 불변식(위반 시 반려)
- **파일 스코프**: 신규 `apps/web/src/pages/admin/AdminDevelopRequests.vue`·`AdminDevelopRequestDetail.vue`·`AdminDevelopSettings.vue`, 신규 `apps/web/src/admin/useAdminDevelop.ts`, 신규 `apps/web/src/components/admin/develop/**`. 기존 파일 수정은 **다음 4개만**: `apps/web/src/layouts/AdminLayout.vue`(배지 `developReceived` 분기 한 곳), `apps/web/src/components/admin/AiSettingsForm.vue`(develop 블록 추가), `apps/web/src/i18n/locales/ko.ts`·`en.ts`(`admin.develop.*` 키 추가). 그 밖(`packages/*`, `apps/api`, `apps/develop`, `apps/market`, `router.ts`, `menu.ts`)은 **읽기만**. 계약이 부족하면 고치지 말고 §7 "이탈/요청"에 적는다.
- 타입 강성: `any`/`as any`/`@ts-ignore` 금지. `pnpm --filter web typecheck` · `pnpm --filter web lint` 0.
- API 는 `@sp/api-contract` zod + `@sp/shared`(`apiGet`/`apiSend`/`apiSendForm`/`apiGetBlob`). 라우트 상수 `apiRoutes.adminDevelopRequests`(`/api/admin/develop/requests`)·`adminDevelopFiles`·`adminDevelopSettings`·`adminSettings`(AI 탭).
- 관리자 라벨은 i18n 키(`t('admin.develop.…')`) — 기존 관리자 화면 관례(`AdminMarketProjects.vue` 참고). 도메인 라벨(상태·견적 상태·이벤트 타입·분야·예산)은 계약 사전(`DEVELOP_*_LABELS`·`MARKET_*_LABELS`·`marketAreaBadge`) 그대로 쓴다.
- 커밋 금지. 다른 워커(고객 앱 `apps/develop`)가 같은 트리에서 병렬 작업 중 — 그쪽 파일에 손대지 말 것.

## 2. 이미 있는 것
| 위치 | 내용 |
|---|---|
| `packages/api-contract/src/schemas/develop.ts` | **계약 정본** — `AdminDevelopRequestListQuery`(page·pageSize·tab·q) / `AdminDevelopRequestListResponse`(items·total·counts) / `AdminDevelopRequestDetailResponse`(`AdminDevelopRequestDetail`: owner·contact·ai 요약·files·**review 3층**(`draft`·`draftRunning`·`draftError`·`stale`·`working`·`editedAt`·`publicReview`·`publishedAt`·`publishedStale`)·**diagram**(`meta`·`html`·`source`·`published`·`publishedStale`)·quotes·events(전부, `visibleToCustomer` 포함)·internalMemo·aiSupplement·reviewDays) / `AdminDevelopRequestPatchBody`(assigneeMbId·internalMemo·aiSupplement·reviewDays) / `AdminDevelopStatusBody`(to: reviewing·in_progress·completed·cancelled·declined, reason) / `AdminDevelopReviewPutBody`({review}) / `AdminDevelopAiRunResponse` / `AdminDevelopEventPayload`(type note·comment·review_request·deliverable·tax_invoice, title·body·visibleToCustomer·final·locked·payload) / `AdminDevelopSettings`·`AdminDevelopSettingsUpdate`·`AdminDevelopSettingsResponse` / `DEVELOP_ADMIN_TABS`·`DEVELOP_ADMIN_TAB_LABELS`·`DEVELOP_REQUEST_STATUS_LABELS`·`DEVELOP_EVENT_TYPE_LABELS`·`DEVELOP_QUOTE_*_LABELS`·`DEVELOP_MILESTONE_*_LABELS` |
| `packages/api-contract/src/schemas/market-dev-review.ts` | 검토서 JSON `MarketDevReview`(summary·requirements[]·areas[]{area,summary,spec[],observations[]}·openQuestions[]{question,why,area,resolution?}·checks[]·meta·**adminComment?**) — 구조 편집기의 스키마 |
| `packages/api-contract/src/schemas/ai.ts` | AI 설정 `AiSettingsResponse.data.developReview`·`developDiagram`(enabled·model·think·extraInstructions·promptVersion·updatedAt) / `AiSettingsUpdate.developReview`·`developDiagram` |
| `packages/ui/src`(`@sp/ui`) | `DevReviewView`(review, title?, diagram?: {meta, html}) · `DevDiagramSection`(diagram: {meta, html}, uploaded?, canRegenerate?, regenerating?, emits regenerate) · `AreaIcon` · `FilePreviewModal` · `UiPagination` · `apiErrorMessage`. `apps/web/src/style.css` 에 이 패키지용 토큰과 `@source` 는 이미 넣었다 |
| `apps/web/src/router.ts` · `admin/menu.ts` · i18n `admin.menu.developRequests/developSettings` | 라우트 3개(`admin-develop-requests`·`admin-develop-request`(:id)·`admin-develop-settings`)와 메뉴(배지 키 `developReceived`) 등록 완료 — 페이지 파일만 없다 |
| `apps/api/src/routes/admin-develop-requests.ts` · `admin-develop-settings.ts` · `admin-settings.ts` | 서버 라우트 실체(요청 형식·에러 코드·multipart 파트명 `payload` + 파일 파트 임의 이름). 모르면 여기서 확인(추측 금지) |
| `apps/web/src/pages/admin/AdminMarketProjects.vue` · `admin/useAdminMarket.ts` · `components/admin/AiSettingsForm.vue` · `layouts/AdminLayout.vue` | 관리자 화면·훅·AI 설정 탭·배지 해석의 관례 |

## 3. 확정 설계
### 3.1 `AdminDevelopRequests.vue` 워크큐
- 탭(`DEVELOP_ADMIN_TABS`, counts 배지) · 검색(제목·mbId·연락처·회사) · 표: 제목(분야 배지) · 상태 · 의뢰인(이름·이메일) · 연락처(이름·회사·전화) · AI(검토서 상태 `ai.review` 칩 + `stale` 경고 + 구성도 상태 + 공개 여부) · 최신 견적(v·상태·합계) · 담당자 · 접수일. 행 클릭 → 상세 라우트(`admin-develop-request`). `UiPagination`. 관리자 워크큐 기본 탭은 `all`.
### 3.2 `AdminDevelopRequestDetail.vue` 전면 상세 (+ `components/admin/develop/*`)
드로어가 아니라 **페이지**. 상단 헤더 + 좌 본문 / 우 사이드(≥xl) 2열.
- **헤더**: 제목·상태 배지·분야 배지·접수일·의뢰인·담당자 select(assigneeMbId — 관리자 계정 하나면 자기 mbId 하나만; `PATCH`) · **전이 버튼**(상태별 노출: received→`검토 시작`(reviewing) · accepted/delivered→`착수`(in_progress) · delivered→`검수 확정(대행)`(completed) · 종결 전→`진행 불가`(declined, 사유 필수)·`취소`(cancelled, 사유 필수)) — 사유 입력은 인라인 패널(네이티브 dialog 금지). `POST …/:id/status`.
- **의뢰 내용**: 설명 · 조건(예산·답변 표 — `marketQuestionsFor(serviceAreas)` 로 문항 라벨 매핑, `marketAnswerText`) · 희망 툴 · 연락처(전화 `tel:` 링크) · 비밀유지 희망 · **첨부**(참고 자료·슬롯 라벨, 다운로드 `GET ${apiRoutes.adminDevelopFiles}/:fileId` → `apiGetBlob`) · AI 동의 여부.
- **AI 패널(검토서)**: 상태 줄(초안 running → 5초 폴링(`refetchInterval` 조건부) · error 표시 · `stale` 경고 "원천이 바뀐 뒤 만든 초안이 아닙니다") · 버튼 `초안 다시 만들기`(`POST …/ai/review`, 미동의면 비활성+사유) · **보충 메모**(textarea, `PATCH aiSupplement`, 안내: "여기 적은 내용은 AI 근거 자료로 함께 들어갑니다. 고객에게 보이지 않습니다") · **작업본 편집기**(구조 편집 — 요약 · 핵심 요구사항 행 추가/삭제/수정 · 분야별 카드(한 줄 요약·명세 행(item/text) 추가/삭제/수정·관찰 행) · 상의 항목 행(question/why + **확인 결과 resolution**) · **담당자 의견 adminComment**(textarea) — `evidence` 는 표시만(편집 불필요) · `checks` 는 표시만) → `저장`(`PUT …/review`, 전체 JSON) · `초안 가져오기`(reset, 작업본을 초안으로 덮음 — 인라인 확인) · **미리보기 탭**(`DevReviewView :review="working"`) · **공개**(publish, 작업본 → 공개본; `publishedStale` 이면 "공개 뒤 수정됨 — 다시 공개" 배지) · `공개 취소`. 초안이 없고 작업본도 없으면 빈 상태(재생성 유도).
- **구성도 패널**: `DevDiagramSection :diagram="{meta, html}" :uploaded="source==='upload'" :can-regenerate="aiConsent" @regenerate` (`POST …/ai/diagram`) · 교체 업로드(svg·png·jpg·webp·html, `POST …/diagram/upload` multipart 파트 `file`) · `공개`/`공개 취소`(`publishedStale` 배지).
- **타임라인**: 이벤트 전부(비공개는 회색 "내부" 표시) 시간순 · 첨부 다운로드 · **작성 폼**: 종류(note·comment·review_request·deliverable·tax_invoice) · 제목(선택) · 본문 · 고객 공개 토글(note 만 의미) · deliverable 이면 `final`(납품 = 상태 delivered 전이) · `locked`(잔금 후 공개) 체크 · tax_invoice 면 payload(issuedAt·supplyAmount·vatAmount·memo) 입력 · 파일 첨부(다중) → `POST …/events` multipart(`payload` JSON 파트 + 파일 파트).
- **사이드**: 내부 메모(textarea, `PATCH internalMemo`) · 검수 기간(`reviewDays`, PATCH) · 견적서 목록(있으면 v·상태·합계 — 작성 버튼은 **P2**라 그리지 않는다, "견적서 작성은 다음 단계에서 열립니다" 한 줄) · 타임스탬프(접수·착수·납품·완료).
### 3.3 `AdminDevelopSettings.vue`
- `GET/PATCH adminDevelopSettings`: 표준 조건(textarea) · 별도 실비(textarea) · 하자보수 일수 · 검수 기간 · 유효기간 · VAT 표기 · 기본 마일스톤(행 편집: 명칭·비율%·시점, 합 100% 검증) · 관리자 수신 메일(줄바꿈 목록) · AI 자동 초안 2토글. 저장 성공 토스트.
### 3.4 `AiSettingsForm.vue` develop 블록
- 기존 devReview/devDiagram 카드 아래 **"개발의뢰 검토서"·"개발의뢰 구성도"** 카드(사용·모델 datalist·thinking select·추가 지침) — 응답 `developReview`·`developDiagram`, 저장 `AiSettingsUpdate.developReview/developDiagram`. 기존 카드 로직 미러.
### 3.5 배지 `developReceived`
- `useAdminDevelop.ts` 에 `useDevelopReceivedCount(enabled)`: 목록 API(`tab=received&pageSize=1`) 의 `counts.received`. `AdminLayout.vue` 의 `badgeValue` 체인에 분기 하나 추가(기존 훅 호출 관례 미러, 60초 refetch 등 기존 값 따름).
### 3.6 `useAdminDevelop.ts`
- 훅: 목록·상세(폴링 옵션)·patch·status·aiRun(kind)·reviewPut·reviewAction(publish/unpublish/reset)·diagramAction(publish/unpublish)·diagramUpload·eventCreate·settings get/patch·receivedCount. 성공 시 `['admin','develop', …]` invalidate.

## 4. 검증 절차
1. `pnpm --filter web typecheck && pnpm --filter web lint` → 0.
2. 브라우저: sp-vue dev(5173) 가 떠 있다(`http://127.0.0.1:5173/app/admin/develop/requests` 또는 nginx `https://local-web.samplepcb.co.kr/app/admin/develop/requests`). 관리자 로그인이 필요하다 — 로컬 브라우저 세션이 없으면 `samplepcb-web-mono-app/e2e/helpers/browser` 의 `/spcb/api/me` 스텁(isAdmin true) 관례로 playwright-core 로 진입해 워크큐·상세·설정 렌더 + 콘솔 오류 0 확인. 데이터가 없으면 API 로 시드하지 말고(고객 라우트는 회원 JWT 가 필요) 빈 상태 렌더를 확인하고 보고. 다른 워커가 `[e2e]` 의뢰를 만들어 두었으면 그것으로 상세를 확인.
3. **AI 실행 버튼은 실제 LLM 을 돌린다(수 분·비용)** — 검증에서 누르지 말 것. 상태 표시 로직은 타입·코드 리뷰로.

## 5. 알려진 함정
- `.vue` 발 타입은 ESLint 프로그램에서 error type — 변수 주석/`satisfies` 에 물리면 `no-unsafe-*` 오탐 → 추론 타입 + `as const`.
- `@sp/shared apiGet` 스키마 제네릭은 `ZodType<T, ZodTypeDef, unknown>` — `.catch()` 가 든 스키마도 그대로 넘긴다.
- 상세 응답의 `review.working` 을 편집기 로컬 상태로 **깊은 복사**해 들고, 저장 뒤 서버 응답으로 되돌린다(뷰어와 편집기가 같은 객체를 참조하면 미리보기가 저장 전 값으로 튄다).
- `MarketDevReview` 의 `openQuestions` 는 최대 6, `requirements` 최대 5, 분야 `spec` 최대 6 — 편집기가 초과 추가를 막아야 `PUT` 400 이 안 난다(스키마 `max` 확인).
- 네이티브 `alert/confirm/prompt` 금지.

## 6. 문서
- `docs/DEVELOP_FLOW.md` §7.3 표 아래에 만든 파일·결정 **한 단락** 추가. 다른 절은 건드리지 않는다.

## 7. 보고 형식(최종 메시지)
1) 변경·신규 파일 목록 2) 지시서 이탈(있으면 왜) 3) 계약·서버 요청 4) 검증 결과(typecheck/lint, 브라우저 방식·결과) 5) 남긴 이슈·TODO.
