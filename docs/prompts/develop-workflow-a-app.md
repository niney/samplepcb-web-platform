# 지시서 — 개발의뢰(sp-develop) 고객 앱: 진행 현황·프로젝트 문서·계약서 보기 (worker docs-A)

리포 `/Users/niney/work/workspace_other/samplepcb-web-platform` (macOS). 브랜치 `feat/develop-workflow-docs`(체크아웃됨 — **브랜치 변경·커밋 금지**).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · 정본 `docs/DEVELOP_FLOW.md`(§2 결정 11·§7.2·§8) · 이전 고객 앱 지시서 `docs/prompts/develop-phase2a-app.md`·`develop-phase1a-app.md`(규칙 동일) · **계약 정본 `samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-docs.ts`** · 서버 `apps/api/src/routes/develop-requests.ts`(`documents/:docId/decide`) · 하네스 `ops/scripts/e2e-develop.mts` §10b·§11b(실제 payload·응답 예).
프로토타입 원본(서식·용어 참고): `.tmp/develop/Work flow.html` — 시각을 따라할 필요는 없다. 고객 앱 디자인 토큰(`brand-*`·`ink-*`·`paper`·`line`·`tx-*`)과 기존 상세 화면 관례를 따른다.

## 0. 한 줄 요약
고객 상세(`/develop/requests/:id`)에 **「진행 현황·문서」 섹션**(`#documents`)을 붙인다: 달성도·7단계·공개 업무표 + 담당자가 보낸 프로젝트 문서 목록·읽기·**4택 결정**(승인형) + 문서 인쇄. 견적서 인쇄 화면에 **계약서 보기**(수락 견적 기준 서명란·동의 기록)를 더한다. 서버는 전부 있고 API 하네스로 검증됐다.

## 1. 불변식
- **파일 스코프**(다른 워커가 `apps/web` 관리자를 병렬 작업 중 — 손대지 말 것). 신규: `apps/develop/src/components/detail/Project*.vue`·`Document*.vue`, `apps/develop/src/pages/DocumentPrint.vue`(선택). 수정 허용: `apps/develop/src/pages/RequestDetail.vue`·`Me.vue`·`QuotePrint.vue` · `apps/develop/src/api/useDevelopRequests.ts` · `apps/develop/src/lib/format.ts`(`answer_document` 라벨은 이미 넣어 둠)·`error-msg.ts`(코드→문구) · `apps/develop/src/components/detail/Timeline.vue`·`QuoteCard.vue`(계약서 링크 한 줄) · `apps/develop/src/router.ts`(인쇄 라우트) · `apps/develop/src/style.css`(인쇄 규칙 필요 시). **계약·서버·DB·docs 정본·`@sp/ui` 는 건드리지 말고** 필요하면 보고서에 요청으로 적는다.
- 커밋 금지. 공유 DB — 화면 검증으로 만든 결정(문서 decide)은 되돌릴 수 없는 사실이라 **하네스 픽스처 의뢰 위에서만**(내가 cleanup 으로 지운다). **하네스 `run/cleanup` 은 돌리지 말 것**(단일 실행자 — 내가 돌려 둔 상태, §4).
- 타입 매우 강함: `pnpm --filter develop typecheck && pnpm --filter develop lint` 0. 네이티브 `confirm` 금지(인라인 패널). 날짜는 `dateShort`·`dateTimeKst`(KST). payload 는 `Record<string, unknown>` — 좁혀 읽는다.
- **라벨 정본은 계약 사전**(`DEVELOP_DOC_TYPE_LABELS`·`DEVELOP_DOC_STATUS_LABELS`·`DEVELOP_DOC_DECISION_OPTIONS[type]`·`DEVELOP_TASK_PHASE_LABELS`·`DEVELOP_TASK_STATUS_LABELS`·`DEVELOP_DOC_FIELDS[type][].label`). 화면 카피는 ko 인라인(고객 앱 관례).

## 2. 서버 계약 (prefix `/api`, 소유자만, 에러 봉투 `{result:false,error}`)
상세 `GET /develop/requests/:id`(`DevelopRequestDetail`)에 새 필드:
- `documents: DevelopDocumentView[]` — **보낸 판만**(draft 없음). documentId·type·seq·version·docNo(`DR-01`)·title·status(`sent|approved|conditional|changes_requested|discuss_requested|rejected|superseded`)·approval(승인형 여부)·content·replyDueOn·sentAt·decision·decisionNote·decidedAt·decidedName·files(MarketFileMeta[])·isCurrent(같은 종류·번호의 최신 판).
- `progress: DevelopProgressView` — progressPct·currentPhase·phases[{phase,state(done|now|todo),taskCount,progressPct}]·tasks(**고객 공개 행만**)·baseStartOn·plannedEndOn·expectedEndOn·pendingApprovals.
- `nextAction` 에 `'answer_document'` 추가(승인형 sent 문서가 있을 때, 결제·검수보다 뒤 순위). `events` 에 `document_sent`(payload documentId·docNo·type·seq·version·replyDueOn·approval)·`document_decided`(payload documentId·docNo·type·decision·decidedName).

| 행동 | 라우트 | body | 응답 | 오류 |
|---|---|---|---|---|
| 문서 결정 | `POST /develop/requests/:id/documents/:docId/decide` | `DevelopDocumentDecideBody {decision, note?, name}` | **상세 전체**(`DevelopRequestDetailResponse`) | 409 `NOT_APPROVAL_DOC`(공유형) · 409 `DOC_NOT_OPEN`(sent 아님) · 400 `DECISION_INVALID`(그 종류에 없는 선택지) · 404 |
| 문서 첨부 다운로드·미리보기 | 기존 `GET …/files/:fileId(/preview)` | | | 보낸 판의 첨부만 |

부수효과(서버): 납품확인서(`delivery_confirm`) 승인 → `completed`(검수 확정과 같음) · 보완 후 승인(`changes_requested`) → `in_progress`(재작업) · 변경요청서 승인 → 관리자에게 추가 견적 초안이 깔린다(고객 화면엔 아직 안 보임).
계약 순수 함수: `developDocContentRows(type, content)`(읽기 표) · `DEVELOP_DOC_DECISION_OPTIONS[type]`(라디오 문안·순서) · `developDocDecisionLabel(type, decision)` · `isDevelopDocApproval(type)` · `DEVELOP_DOC_FIELDS[type]`(table 컬럼 라벨).

## 3. 확정 설계
- **섹션 내비**에 '진행 현황·문서' 추가(견적서 다음, 진행·문의 앞). `Me.vue` 의 `answer_document` 앵커 `#documents` 는 넣어 둠 — "지금 할 일" 칩이 이 섹션으로 온다.
- **진행 현황 카드**(`ProjectProgress.vue`): 달성도 %·바 · 7단계 phase-line(`DEVELOP_TASK_PHASES` 순, done/now/todo — 프로토타입 「고객 공유 진행단계」) · 현재 단계 · 예상 완료일(`expectedEndOn ?? '미정'`) · 공개 업무표(`progress.tasks`: 업무명·단계·상태 배지·기간(startOn~endOn, 없으면 '—')·진행률 바). tasks 가 비면 한 줄 "담당자가 일정을 공유하면 여기에 표시됩니다". 상태가 착수 전(received~accepted)이면 섹션 자체를 "착수 뒤 진행 현황이 표시됩니다" 한 줄로.
- **확인 대기 배너**: `pendingApprovals>0` → "담당자가 확인을 요청한 문서 n건" + 첫 문서로 스크롤 버튼.
- **문서 목록**(`DocumentList.vue`): 최신 판(`isCurrent`)만 카드로, 이전 판(superseded)은 카드 안 "이전 판 보기" 접힘. 카드: docNo·종류(`DEVELOP_DOC_TYPE_LABELS`)·v·발송일·회신 요청일·상태/결정 배지(sent+승인형 → brand "확인 요청", 결정됨 → 결정 라벨, 공유형 sent → "공유됨")·첨부 수. 카드 클릭 → 펼침(같은 자리 아코디언, 한 번에 여러 개 가능).
- **문서 읽기**(`DocumentView.vue`): 라벨/값 표(`developDocContentRows`; table kind 는 `DEVELOP_DOC_FIELDS` 컬럼 라벨로 실제 표), 첨부(`AttachmentList` 재사용 또는 동형 — 다운로드·미리보기는 기존 `download`·`openPreview` 경로 `developFilesPath(requestId)/{fileId}`), 인쇄 버튼.
- **결정 패널**(`DocumentDecision.vue`, 승인형 ∧ status `sent` 에서만): `DEVELOP_DOC_DECISION_OPTIONS[type]` 라디오(문안 그대로, 순서 그대로) · 의견 textarea(선택, 2000자) · 이름 input(기본값 `detail.contact.name`) · "문서 내용을 확인했으며 위 결정을 담당자에게 전달합니다" 체크 — 체크+이름 있어야 버튼 활성(견적 수락 패턴, 결정 = 동의 기록) · 버튼 1개 「회신 보내기」 → `useDecideDocument` → 응답 상세로 캐시 교체(`setDetail` 관례). 납품확인서면 힌트 한 줄: 승인=개발 완료·잔금 결제 열림 / 보완 후 승인=재작업. 결정 뒤엔 결정 라벨·이름·일시·의견 블록. 에러 코드→문구는 `error-msg.ts` 사전에 추가(`NOT_APPROVAL_DOC`·`DOC_NOT_OPEN`·`DECISION_INVALID`).
- **인쇄**: 견적서 인쇄와 같은 bare 라우트 `requests/:id/documents/:docId/print`(`DocumentPrint.vue`, `meta.bare`) — A4 한 장: 머리(샘플피씨비·문서번호·종류·프로젝트·발송일·회신 요청일) · 본문 표 · 결정 결과 · 서명/확인 칸(결정된 이름·일시). 데이터는 상세 응답에서 docId 로 고른다(견적서 인쇄와 같은 캐시 공유).
- **타임라인**: `document_sent`·`document_decided` 이벤트 제목 옆 `payload.docNo` 칩 → 클릭 시 `#documents` 로 스크롤(선택). 기존 `review_request` 응답 패널은 그대로 둔다(옛 이벤트 호환).
- **계약서 보기**(결정 1 — 계약서는 수락 견적서의 인쇄 뷰): `QuotePrint.vue` 에 `?mode=contract` — 수락된 견적(`status==='accepted'`)에서만 의미. 헤더 문구 "개발 용역 계약서 (견적서 Q…-v{n} 기준)" · 본문은 견적서 그대로(항목·결제 조건·산출물·별도 실비·표준 조건·검수·하자) · 아래에 **동의 기록 블록**(수락일시 `acceptedAt`·수락자 `acceptedName`·"표준 조건에 동의하여 수락함" — IP 는 비노출) · **발주서**(`poFile` 있으면 파일명) · **서명란 3칸**(프로토타입 01: 고객사 회사명·대표/담당자·서명일 / 샘플피씨비 담당자·대표자·서명일 / 체결 상태 □ 전자서명 □ 날인본 □ 착수금 확인 — 오프라인 표기). 상세의 수락 견적 카드(`QuoteCard.vue`)에 「계약서 보기·인쇄」 링크 한 줄(수락 상태에서만). 견적 인쇄(기본 모드)는 바뀌지 않는다.
- 훅(`useDevelopRequests.ts`): `useDecideDocument(requestId)` — POST decide, 응답으로 `setDetail`.

## 4. 검증
1. `pnpm --filter develop typecheck && pnpm --filter develop lint` → 0.
2. 브라우저: `pnpm --filter develop dev`(5177) → `/develop/requests/<픽스처 id>`. **픽스처는 이미 있다**: 내가 하네스를 돌려 둔 `[e2e]` 의뢰(completed) — 문서 **PA-01 sent(승인형, 결정 가능)**·DR-01 v1 superseded(changes_requested)·DR-01 v2 conditional·PR-01 sent(공유형)·CR-01 approved·DC-01 v1 changes_requested·DC-01 v2 approved, 공개 업무 2행(달성도 50%), 수락 견적 v2(계약서 보기 대상). id 는 `ops/scripts/e2e-develop.mts` 가 남긴 `$TMPDIR/sp-develop-e2e-ids.json` 의 `requestIds[0]`. sp-node 는 3333 에서 떠 있다(죽어 있으면 `pnpm --filter api dev`). PHP(8888)도 떠 있어 실제 그누보드 로그인이 되며, 픽스처 소유자 계정은 하네스가 고른 회원(`ids` 파일엔 없음 — 관리자 워크큐나 DB `sp_develop_request.mbId` 로 확인) — 로그인이 어려우면 이전 지시서 §4 의 e2e 스텁 관례(`PORTAL_E2E=1`). 확인: 현황 카드·업무표·문서 목록·PA-01 결정 패널(**결정은 한 번만 — `conditional` 로**)·이전 판 접힘·문서 인쇄 미리보기·계약서 보기(`?mode=contract`)·`[e2e]` 목록의 "문서 확인·회신" 칩 앵커. 콘솔 오류 0.
3. 스크린샷 3장(현황+문서 목록·결정 패널·계약서 인쇄)을 `.tmp/develop/shots/customer-*.png` 에.

## 5. 함정
- `documents` 는 draft 가 없다 — "작성 중" 상태를 그릴 필요 없음. `superseded` 는 이전 판.
- `DecisionPanel.vue` 는 2택 전용 — 재사용하지 말고 라디오형 새 컴포넌트.
- 결정 응답은 상세 전체(상태가 completed/in_progress 로 바뀔 수 있다) — 캐시 교체 뒤 스텝퍼·nextAction 이 같이 바뀐다.
- `payload` 좁혀 읽기(`typeof v === 'number'`).
- 인쇄 라우트는 `meta.bare`(헤더·푸터 없음) — 견적서 인쇄 라우트 정의를 미러링.
- `.vue` 발 타입 ESLint 오탐 — 추론 타입 + `as const`.

## 6. 문서·보고
`docs/DEVELOP_FLOW.md` §13 은 내가 쓴다 — 워커는 손대지 말고 **화면 결정·이탈을 보고서에** 적어라. 최종 보고 = 변경 파일 / 이탈 / 계약·서버 요청 / 검증 결과(명령·수치·픽스처 id) / 스크린샷 경로 / 남긴 이슈.
