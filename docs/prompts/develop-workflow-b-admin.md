# 지시서 — 개발의뢰(sp-develop) 프로젝트 문서·업무표 관리자 화면 (worker docs-B)

리포 `/Users/niney/work/workspace_other/samplepcb-web-platform` (macOS). 브랜치 `feat/develop-workflow-docs`(체크아웃됨 — **브랜치 변경·커밋 금지**).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · 정본 `docs/DEVELOP_FLOW.md`(§7.3·§8·§11) · 이전 관리자 지시서 `docs/prompts/develop-phase2b-admin.md`·`develop-phase1b-admin.md`(규칙 동일) · **계약 정본 `samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-docs.ts`** · 서버 `apps/api/src/routes/admin-develop-docs.ts` · 하네스 `ops/scripts/e2e-develop.mts` §10b·§11b(실제 payload·응답 예).
프로토타입 원본(서식·용어·레이아웃 참고): `.tmp/develop/Work flow.html` — 시각(navy)을 따라할 필요는 없다. 관리자 화면 관례(Tailwind·gray/blue 배지·인라인 확인 패널)를 따른다.

## 0. 한 줄 요약
관리자 상세(`/app/admin/develop/requests/:id`)에 여섯 번째 탭 **「프로젝트 문서」**를 붙인다: 00 현황 띠(달성도·7단계·확인 대기) + 업무표(WBS 편집·간트) + 문서 8종(생성 → 필드 스펙 폼 → 첨부 → 메일 초안(결정적/AI) → 발송 → 새 판 → 결정 결과). AI 설정 탭에 `develop.doc-mail` 카드 1장. 서버 라우트는 전부 있고 API 하네스로 검증됐다.

## 1. 불변식
- **파일 스코프**(다른 워커가 `apps/develop` 고객 앱을 병렬 작업 중 — 손대지 말 것). 신규: `apps/web/src/components/admin/develop/DevelopDocs*.vue`·`DevelopDoc*.vue`·`DevelopTask*.vue`·`DevelopProjectStatus.vue`(+ 순수 모듈 `develop-doc-edit.ts` 선택). 수정 허용: `apps/web/src/admin/useAdminDevelop.ts` · `apps/web/src/pages/admin/AdminDevelopRequestDetail.vue`(탭 추가) · `apps/web/src/components/admin/AiSettingsForm.vue`(카드 1장) · `apps/web/src/i18n/locales/ko.ts`·`en.ts`(`admin.develop.docs.*`·`admin.settings.ai.developDocMail.*` 키) · `apps/web/src/components/admin/develop/DevelopTimeline.vue`(문서 이벤트 2종의 표시만). **계약·서버·DB·docs 정본은 건드리지 말고** 필요하면 보고서에 요청으로 적는다.
- 커밋 금지. 공유 DB — 화면 검증으로 만든 데이터(문서·업무표)는 검증 뒤 화면에서 지우거나 보고서에 남긴다(하네스 픽스처 의뢰 위에 만들면 내가 cleanup 으로 지운다). **하네스 `e2e-develop.mts run/cleanup 은 돌리지 말 것**(공유 DB 픽스처는 단일 실행자 — 내가 돌려 둔 상태다, §4).
- AI 실행 버튼(검토서 초안·구성도)은 누르지 말 것. `develop.doc-mail` 은 유스케이스가 꺼져 있어 409 `USECASE_DISABLED` 폴백 경로만 확인한다(켜지 말 것).
- 타입 매우 강함: `pnpm --filter web typecheck && pnpm --filter web lint` 0. i18n ko/en 동형(키 누락 검사 관례 — 이전 지시서). 네이티브 `confirm`·`alert` 금지(인라인 확인 패널). `structuredClone` 은 reactive proxy 에서 던진다 — JSON 복사.
- **라벨 정본은 계약 사전**: `DEVELOP_DOC_TYPE_LABELS`·`DEVELOP_DOC_STATUS_LABELS`·`DEVELOP_DOC_DECISION_OPTIONS[type]`·`DEVELOP_TASK_PHASE_LABELS`·`DEVELOP_TASK_STATUS_LABELS`·`DEVELOP_DOC_FIELDS[type][].label`. i18n 키는 화면 고유 문구(버튼·안내·빈 상태)만.

## 2. 서버 계약 (prefix `/api/admin`, requireAdmin, 에러 봉투 `ApiError{error,message}`)
상세 `GET /develop/requests/:id` 응답(`AdminDevelopRequestDetail`)에 두 필드가 새로 실린다:
- `documents: AdminDevelopDocumentView[]` — draft·이전 판 포함. 필드: documentId·type·seq·version·docNo(`DR-01`)·title·status·approval·content·replyDueOn·sentAt·decision·decisionNote·decidedAt·decidedName·files(MarketFileMeta[])·isCurrent·internalNote·mailSubject·mailBody·createdBy·sentBy.
- `progress: DevelopProgressView` — progressPct·currentPhase·phases[{phase,state(done|now|todo),taskCount,progressPct}]·tasks(전 행, taskId·seq 포함)·baseStartOn·plannedEndOn·expectedEndOn(최신 발송 `plan` 문서에서)·pendingApprovals(sent 승인형 수).

| 행동 | 라우트 | body | 응답 | 오류 |
|---|---|---|---|---|
| 문서 초안 생성 | `POST /develop/requests/:id/documents` | `AdminDevelopDocumentCreateBody {type, content?, internalNote?}` | `AdminDevelopDocumentResponse` | 409 `INVALID_TRANSITION`(accepted 이전) · 409 `DOC_TYPE_NOT_ALLOWED`(delivery_confirm 은 delivered/completed 만) · 400 `CONTENT_INVALID` |
| 초안 수정 | `PATCH /develop/documents/:docId` | `AdminDevelopDocumentPatchBody {content?, internalNote?, replyDueOn?}` | 문서 뷰 | 409 `DOC_NOT_DRAFT` · 400 `CONTENT_INVALID` |
| 초안 삭제 | `DELETE /develop/documents/:docId` | | `{result:true}` | 409 `DOC_NOT_DRAFT` |
| 새 판 | `POST /develop/documents/:docId/revise` | | 문서 뷰(version+1 draft, 본문 복사) | 409 `DOC_IS_DRAFT`·`DOC_DRAFT_EXISTS` |
| 발송 | `POST /develop/documents/:docId/send` | `AdminDevelopDocumentSendBody {replyDueOn?, mailSubject, mailBody, sendMail=true}` | 문서 뷰(sent) | 400 `EMPTY_DOCUMENT` · 409 `DOC_NOT_DRAFT`·`INVALID_TRANSITION` |
| 첨부 추가 | `POST /develop/documents/:docId/files` multipart(파일 파트 임의 이름) | | 문서 뷰 | 409 `DOC_NOT_DRAFT` · 400 `NO_FILES` |
| 첨부 삭제 | `DELETE /develop/documents/:docId/files/:fileId` | | 문서 뷰 | |
| AI 메일 초안 | `POST /develop/documents/:docId/ai-mail` | `AdminDevelopDocMailBody {instructions?}` | `{jobId, cached}` | 409 `USECASE_DISABLED` |
| 업무표 교체 | `PUT /develop/requests/:id/tasks` | `AdminDevelopTasksPutBody {tasks: DevelopTaskInput[]}` | `{tasks, progress}` | 400(완료일<시작일 등) |

AI 잡 폴링: `GET /api/ai/jobs/:jobId`(`AiJobResponse`, `apiRoutes.ai`) — `status` running/done/error, `stage` 'docmail', done 이면 `docMail {subject, body}`. 잡 소유자는 관리자 본인(같은 세션 토큰). 첨부 다운로드·미리보기는 기존 `apiRoutes.adminDevelopFiles`(문서 첨부도 같은 번호 체계).
계약 순수 함수(화면이 그대로 쓴다): `emptyDevelopDocContent(type)` · `developDocContentIssues(type, content)`(저장·발송 전 검사 — 400 을 먼저 막는다) · `developDocContentRows(type, content)`(읽기 표·메일 미리보기) · `buildDevelopDocMailDraft({...})`(메일 제목·본문 결정적 초안) · `developProgressSummary(tasks, contractDone)`(저장 전 달성도 미리보기) · `DEVELOP_DEFAULT_TASKS` · `DEVELOP_DOC_ALLOWED_STATUSES` · `isDevelopDocApproval`.

## 3. 확정 설계
- **탭** `documents`(URL `?tab=documents`, 기존 TABS 배열에 추가 — `v-show` 전부 마운트 관례). 배지: `pendingApprovals>0` → amber "확인 대기 n" · draft 수 → gray "작성 중 n" · 편집 중 amber "수정 중"(자식이 `dirty` 올림).
- **프로젝트 현황**(`DevelopProjectStatus.vue`, 탭 상단): 달성도 %·프로그레스바 · 현재 단계(`DEVELOP_TASK_PHASE_LABELS[currentPhase]`, 없으면 '—') · 예상 완료일(`expectedEndOn ?? '미정'`, 옆에 계획 완료일) · 7단계 phase-line(프로토타입 `.phase-line`: done=채움, now=강조, todo=회색) · 고객 확인 대기 목록(sent 승인형 문서: docNo·종류·발송일·회신 요청일, 클릭 시 해당 문서 카드로 스크롤) · 최근 결정 3건.
- **업무표**(`DevelopTaskTable.vue`): 행 = 순서·업무명·단계(select 7)·상태(select 6)·시작일·완료일·가중치(% 입력 ↔ `weightBp = round(pct*100)`)·진행률(%)·선행업무·비고(`note`)·고객 공개(체크, 기본 off)·삭제. 버튼: 업무 추가 · 기본 업무 불러오기(`DEVELOP_DEFAULT_TASKS`; 기존 행이 있으면 인라인 확인 "지금 표를 대체합니다") · 검토서 일정에서 시드(`detail.review.working?.schedule?.phases` → 이름=단계명, phase 'design' 기본, 가중 균등, 없으면 버튼 숨김) · 저장(PUT 전체). 가중치 합 표시(100% 아니면 경고만, 막지 않음). 저장 응답의 `progress` 로 현황 갱신(무효화). 행 key 는 로컬 인덱스(PUT 이 통째 교체라 taskId 가 바뀐다).
- **간트**(`DevelopTaskGantt.vue`): **실제 날짜** 기준 — 전체 범위 = min(startOn)~max(endOn), 주 단위 격자, 막대 위치/폭은 날짜 비례, 상태 색(done=green·in_progress=blue·delayed=red·나머지 회색), 날짜 없는 행은 "일정 미정" 텍스트(프로토타입의 순서 기반 가짜 위치 금지). 범위가 없으면 안내 한 줄.
- **문서 목록**(`DevelopDocsPanel.vue`): 「새 문서」 select(8종 `DEVELOP_DOC_TYPES`, 상태가 `DEVELOP_DOC_ALLOWED_STATUSES` 밖이면 select 비활성+안내 "견적 수락 뒤에 만듭니다", delivery_confirm 은 delivered/completed 만 표시) → 생성 즉시 편집기 열림. 카드(최신 판 우선, 이전 판 접힘 "이전 판 n"): docNo·종류·v·상태 배지(`DEVELOP_DOC_STATUS_LABELS`, sent=blue·approved=emerald·conditional=emerald·changes_requested=amber·discuss_requested=amber·rejected=red·draft=gray·superseded=gray)·발송일·회신 요청일·결정(라벨+이름+일시+의견)·첨부 수·`isCurrent`.
- **편집기**(`DevelopDocEditor.vue`, draft 전용): `DEVELOP_DOC_FIELDS[type]` 스펙으로 렌더 — `meta:true` 필드는 상단 한 줄(프로토타입 `.doc-meta`, 4열), 나머지 2열 격자(`grid two`), `table` 은 전폭. kind 별: text→input · date→date · datetime→datetime-local · select→select(빈 옵션 '선택') · textarea→textarea(placeholder 스펙) · checklist→체크박스 격자(`.check-grid`) · table→행 추가/삭제, 컬럼 kind(text/date/select) · 값 형태는 계약 그대로(select ''·checklist 코드 배열·table `Record<colKey,string>` 행 — 빈 행도 저장 가능). 회신 요청일(date) · 내부 메모(textarea) · 첨부(파일 input → 즉시 업로드, 목록·삭제). 버튼: 저장(PATCH) · 초안 삭제(인라인 확인) · 발송 패널 열기. 저장/발송 전 `developDocContentIssues` 로 검사해 이슈를 필드 옆 빨간 문구로.
- **발송 패널**(`DevelopDocSendPanel.vue`): 왼쪽 문서 미리보기(`developDocContentRows` 표) · 오른쪽 메일 제목·본문(textarea, 초기값 `buildDevelopDocMailDraft({type, docNo, requestTitle: detail.title, customerName: detail.contact.name, customerCompany: detail.contact.company, replyDueOn, content})`, 회신 요청일이 바뀌면 "초안 다시 만들기" 버튼으로만 갱신 — 편집 중인 글을 덮지 않는다) · 「AI 로 다듬기」(ai-mail 잡 → 2초 폴링 → done 이면 제목/본문 교체 인라인 확인 "지금 글을 AI 초안으로 바꿉니다"; 409 `USECASE_DISABLED` 는 안내 문구 "AI 메일 초안이 꺼져 있습니다 — 관리자 > AI 설정", error 잡은 "다듬기에 실패해 기본 초안을 유지합니다") · 메일 발송 체크(`sendMail` 기본 on, 수신 `detail.contact.email` 표시) · 「발송」 → 인라인 확인(docNo·수신 메일·회신 요청일 요약) → POST send → 카드 sent.
- **읽기 뷰**(`DevelopDocView.vue`, sent 이후): 라벨/값 표(table kind 는 표로), 첨부(미리보기 `FilePreviewModal`·다운로드 `downloadAdminDevelopFile`), 결정 결과 블록(라벨·이름·일시·의견), 메일 확인본(접힘: mailSubject·mailBody). 버튼: 「새 판 만들기」(revise; 409 `DOC_DRAFT_EXISTS` → "이미 새 판을 쓰는 중") · 인쇄(`window.print`, 프로토타입 `@media print` 처럼 카드만 — 상세 페이지의 다른 요소는 `print:hidden`).
- **타임라인**(`DevelopTimeline.vue`): `document_sent`·`document_decided` 는 라벨 사전으로 이미 뜬다 — `payload.docNo` 를 제목 옆 칩으로, 클릭하면 `?tab=documents` + 해당 카드 앵커(선택).
- **AI 설정**(`AiSettingsForm.vue`): `develop.doc-mail` 카드 — `developFollowup` 카드 복제(사용·모델·thinking·추가 지침), 응답/PATCH 키 `developDocMail`, i18n `admin.settings.ai.developDocMail.*`.
- **훅**(`useAdminDevelop.ts`): `useAdminDevelopDocumentCreate/Patch/Delete/Send/Revise/FileAdd/FileDelete/AiMail`, `useAdminDevelopTasksPut`, AI 잡 폴링(`apps/web` 에 기존 AI 잡 폴링 훅이 있으면 재사용, 없으면 `apiGet(\`${apiRoutes.ai}/jobs/${jobId}\`, AiJobResponse)` 2초 `refetchInterval`). 성공 시 `['admin','develop']` 무효화.
- 관리자 상세 input·textarea·select 는 본문보다 한 단계 작은 글자(기존 관례). 견적 편집기(`DevelopQuoteEditor.vue`)의 폼 관례(문자열 폼 → 저장 직전 계약 모양)를 미러링.

## 4. 검증
1. `pnpm --filter web typecheck && pnpm --filter web lint` → 0. i18n 키 누락 0.
2. 브라우저: `pnpm --filter web dev`(5173) 로 `/app/admin/develop/requests/<픽스처 id>?tab=documents`. **픽스처는 이미 있다**: 내가 하네스를 돌려 둔 `[e2e]` 의뢰(completed, 문서 DR-01 v1 superseded/v2 conditional·PR-01 sent·CR-01 approved·DC-01 v1 changes_requested/v2 approved·**PA-01 sent(고객 확인 대기 — 고객 워커가 결정할 수 있으니 관리자는 결정하지 말 것)**, 업무표 3행, change 견적 초안) — 관리자 워크큐에서 `[e2e]` 로 검색. sp-node 는 3333 에서 떠 있다(죽어 있으면 `pnpm --filter api dev`). 관리자 로그인은 이전 지시서 §4 의 e2e 스텁 관례. 확인 항목: 현황 띠 · 업무표 편집(행 추가·가중치·저장·간트 갱신) · 새 문서(progress_report) 생성→편집→첨부→발송 패널(AI 다듬기 409 안내)→발송(sendMail **off**)→카드 sent · 새 판 · 읽기 뷰·인쇄 미리보기. 콘솔 오류 0, i18n 원문 키 노출 0.
3. 스크린샷 3장(현황+업무표·문서 편집기·발송 패널)을 `.tmp/develop/shots/admin-*.png` 에 저장(Playwright/e2e 도구 관례 또는 브라우저 도구).

## 5. 함정
- 계약 zod 가 막는 것: content 키는 스펙에 있는 것만(`UNKNOWN_FIELD` 400), select/checklist 코드, table 컬럼 키, date `YYYY-MM-DD`, datetime `YYYY-MM-DDTHH:mm`. `developDocContentIssues` 를 먼저 돌려라.
- 빈 문서 발송은 400 `EMPTY_DOCUMENT`(문자열 하나라도 있어야) — 발송 버튼을 미리 막아라.
- `delivery_confirm` 은 `emptyDevelopDocContent` 가 납품물 4행을 미리 깐다.
- 업무표 PUT 은 통째 교체 — 미저장 편집이 있는데 탭을 옮겨도 사라지지 않게(`v-show` 마운트), 저장 안 하고 상세가 무효화되면 로컬 편집본 유지 여부를 명시(편집 중엔 서버 값으로 덮지 않는다).
- `.vue` 발 타입 ESLint 오탐 — 추론 타입 + `as const`.
- 관리자 상세는 AI 잡이 도는 동안 5초 폴링(`useAdminDevelopDetail`) — 편집 중 초안이 덮이지 않게 로컬 상태로 든다(검토서 편집기 관례).

## 6. 문서·보고
`docs/DEVELOP_FLOW.md` §13 은 내가 쓴다 — 워커는 손대지 말고 **화면 결정·이탈을 보고서에** 적어라. 최종 보고 = 변경 파일 / 이탈 / 계약·서버 요청 / 검증 결과(명령·수치·픽스처 id) / 스크린샷 경로 / 남긴 이슈.
