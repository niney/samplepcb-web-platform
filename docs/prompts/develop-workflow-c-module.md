# 지시서 — 관리자 「개발」 모듈: 스위처·단계별 워크큐·진행현황 홈 (worker docs-B 후속)

리포 `/Users/niney/work/workspace_other/samplepcb-web-platform` (macOS). 브랜치 `feat/develop-workflow-docs`(체크아웃됨 — **브랜치 변경·커밋 금지**). 이전 지시서 `docs/prompts/develop-workflow-b-admin.md` 의 규칙·불변식이 그대로 적용된다.
사용자 결정(2026-09-09): 스위처 라벨 **「개발」**(en `DEV`), 나머지는 아래 권장안 그대로.

## 0. 한 줄 요약
개발의뢰 관리자를 통합 모듈의 메뉴 2개에서 **독립 모듈 「개발」**로 옮긴다: 헤더 스위처(통합·PCB·BOM·**개발**) + 단계별 워크큐 6개 + 설정 + 진행현황 홈. 건별 상세는 지금 페이지를 허브로 유지하고 각 큐가 해당 탭(`?tab=`)으로 딥링크한다. 서버는 목록 API 에 탭 2종·신호 필터·행별 운영 신호·모듈 배지 수를 이미 추가했고 하네스로 검증됐다.

## 1. 불변식·파일 스코프
- 수정 허용: `apps/web/src/admin/menu.ts` · `apps/web/src/admin/useAdminDevelop.ts` · `apps/web/src/layouts/AdminLayout.vue`(배지 매핑·모듈 판정만) · `apps/web/src/router.ts`(개발의뢰 블록) · `apps/web/src/pages/admin/AdminDevelop*.vue` · `apps/web/src/i18n/locales/ko.ts`·`en.ts`. 신규: `apps/web/src/pages/admin/AdminDevelop{Home,Intake,Contracts,Projects,Deliveries,Inquiries}.vue`, `apps/web/src/components/admin/develop/DevelopQueue*.vue`·`DevelopHome*.vue`.
- 계약·서버·DB·docs 정본·`apps/develop` 은 손대지 않는다(필요하면 보고). 커밋 금지. 하네스 run/cleanup 금지(픽스처는 §4). AI 실행 버튼 금지.
- typecheck/lint 0 · i18n ko/en 동형 · 네이티브 confirm 금지 · 라벨 정본은 계약 사전(`DEVELOP_ADMIN_TAB_LABELS`·`DEVELOP_ADMIN_SIGNAL_LABELS`·`DEVELOP_REQUEST_STATUS_LABELS`·`DEVELOP_TASK_PHASE_LABELS`).

## 2. 서버 계약(추가분) — `packages/api-contract/src/schemas/develop.ts`
- `DEVELOP_ADMIN_TABS` 에 `intake`(received+reviewing)·`contract`(quoted+accepted) 추가. `counts` 에도 두 키가 실린다.
- 목록 query `signal?: 'docs_awaiting' | 'inquiries_open' | 'reply_overdue'` — 탭 안에서 신호 켜진 행만(서버가 메모리에서 페이지를 자른다).
- 행마다 `ops: AdminDevelopOps` — `progressPct`·`currentPhase`·`taskCount`·`pendingApprovals`(sent 승인형 문서 수)·`nextReplyDueOn`·`replyOverdue`·`openInquiries`(마지막 담당자 답변 뒤 고객 문의·A/S 수)·`lastInquiry {at,type,excerpt}|null`.
- 응답 `data.signals {docsAwaiting, inquiriesOpen, replyOverdue}` — 검색어 무관, 활성 의뢰(completed·cancelled·declined 제외) 전체 기준. **모듈 배지의 원천**.
- 상세 응답의 `AdminDevelopRequestListItem` 부분에도 `ops` 가 있다.

## 3. 확정 설계
### 3.1 모듈(`menu.ts`)
- `AdminModuleKey` 에 `'develop'`. `adminModules` 에 `{ key:'develop', labelKey:'admin.modules.develop', homeTo:{name:'admin-develop-home'}, menu: developMenu }` — 순서는 통합·PCB·BOM·**개발**.
- `resolveAdminModuleKey`: 라우트 이름이 `admin-develop` 로 시작하면 `'develop'`(기존 라우트 `admin-develop-requests`·`admin-develop-request`·`admin-develop-settings` 도 자동으로 모듈 소속이 된다).
- 통합(core) 메뉴에서 개발의뢰 2줄 **제거**(모듈로 이동). AI 설정은 통합에 그대로.
- `developMenu`(순서 고정):

| labelKey | 라우트 | 대상 | 배지 |
|---|---|---|---|
| `admin.menu.developHome` 진행현황 | `admin-develop-home` | 활성 전체 조감 | `developReplyOverdue` = signals.replyOverdue |
| `admin.menu.developIntake` 접수·검토 | `admin-develop-intake` | tab `intake` | `developReceived` = counts.received |
| `admin.menu.developContracts` 견적·계약 | `admin-develop-contracts` | tab `contract` | `developAccepted` = counts.accepted(결제 대기) |
| `admin.menu.developProjects` 진행 프로젝트 | `admin-develop-projects` | tab `in_progress` | `developDocsAwaiting` = signals.docsAwaiting |
| `admin.menu.developDeliveries` 납품·검수 | `admin-develop-deliveries` | tab `delivered` | `developDelivered` = counts.delivered |
| `admin.menu.developInquiries` 문의·A/S | `admin-develop-inquiries` | tab `all` + signal `inquiries_open` | `developInquiries` = signals.inquiriesOpen |
| `admin.menu.developRequests` 전체 의뢰 | `admin-develop-requests`(기존) | 전 탭 | — |
| `admin.menu.developSettings` 설정 | `admin-develop-settings`(기존) | | — |

- `AdminMenuItem.badge` 유니온에 위 6 키 추가. `activeRouteNames`: 상세(`admin-develop-request`)는 **전체 의뢰** 메뉴가 활성(간단히) — 또는 상세 진입 직전 큐를 기억하는 건 하지 않는다.
- `AdminLayout.vue`: `useDevelopReceivedCount` 를 **`useDevelopModuleSignals`**(하나의 목록 호출 `?page=1&pageSize=1&tab=all`, 60초 refetch, `select` 로 `{counts, signals}`)로 바꾸고 `badgeValue` 매핑을 6 키로 확장. 모듈 스위처의 `moduleTo` 는 pcb 특례만 있으니 develop 은 `homeTo` 그대로.

### 3.2 워크큐 페이지(공용 표 + 얇은 래퍼)
- 공용 `components/admin/develop/DevelopQueueTable.vue`: props `{ tabs: readonly DevelopAdminTabType[], defaultTab, signal?: DevelopAdminSignalType, columns: readonly DevelopQueueColumn[] }`. 기존 `AdminDevelopRequests.vue` 의 표·검색·페이지네이션을 여기로 옮기고, `AdminDevelopRequests.vue`(전체 의뢰)는 `tabs=DEVELOP_ADMIN_TABS 에서 intake·contract 를 뺀 것` 으로 이 컴포넌트를 쓴다(기존 화면과 같게).
- 열 프리셋(`DevelopQueueColumn` = `'title'|'status'|'owner'|'contact'|'ai'|'quote'|'assignee'|'createdAt'|'progress'|'docs'|'inquiry'|'nextAction'`):
  - 접수·검토: title·status·owner·contact·ai·assignee·createdAt. 행 클릭 → 상세 `?tab=review`.
  - 견적·계약: title·status·quote(최신 견적 v·종류·상태·금액)·assignee·createdAt. 행 클릭 → `?tab=quotes`.
  - 진행 프로젝트: title·progress(달성도 바 + 현재 단계 + 업무 n)·docs(회신 대기 n · 회신 요청일, `replyOverdue` 면 빨강)·inquiry(미답변 n)·assignee. 행 클릭 → `?tab=documents`. 탭 바 대신 상단 토글 「회신 대기만」(signal `docs_awaiting`)·「기한 초과만」(`reply_overdue`).
  - 납품·검수: title·status·docs·quote(잔금 마일스톤 상태는 latestQuote 로는 모름 — 열 없음)·createdAt. 행 클릭 → `?tab=timeline`.
  - 문의·A/S: title·status·inquiry(미답변 n + `lastInquiry.excerpt`·시각·type 배지 A/S)·assignee. 정렬은 서버 순(id desc). 행 클릭 → `?tab=timeline`. 신호가 0 이면 빈 상태 "미답변 문의가 없습니다".
- 각 페이지 제목·설명 한 줄(i18n `admin.develop.queue.*`).

### 3.3 진행현황 홈(`AdminDevelopHome.vue`, 모듈 홈)
- 데이터: `useAdminDevelopList` 로 `tab=all&pageSize=100` 한 번 → 클라이언트에서 활성 상태만(received~delivered) 남긴다. 상단 요약 칩: 접수 n·견적·계약 n·진행 n·납품 n(counts) · 회신 대기 n·기한 초과 n·미답변 n(signals).
- 본문: 활성 의뢰 카드 격자(또는 표) — 제목·상태 배지·담당 · 달성도 바 + 현재 단계 · 7단계 미니 점(`DEVELOP_TASK_PHASES`, `currentPhase` 앞은 done) · 확인 대기 n(`nextReplyDueOn`, 초과면 빨강 "기한 초과") · 미답변 문의 n + `lastInquiry.excerpt` · 버튼 3개(검토서/견적/문서·타임라인 딥링크). 정렬: replyOverdue → pendingApprovals → openInquiries → 최신.
- 프로토타입 00 현황의 횡단판이다 — 건 하나의 00 은 상세 「프로젝트 문서」 탭 상단 띠가 이미 맡는다.

### 3.4 라우트(`router.ts`, 개발의뢰 블록)
`develop`(home) · `develop/intake` · `develop/contracts` · `develop/projects` · `develop/deliveries` · `develop/inquiries` — 이름 `admin-develop-*`. 기존 3개 유지. 모듈 홈 `homeTo` 는 `admin-develop-home`.

## 4. 검증
1. `pnpm --filter web typecheck && pnpm --filter web lint` 0 · i18n 누락 0.
2. 브라우저(`pnpm --filter web dev` 5173, 관리자 스텁 로그인 관례): 스위처에 「개발」 · 홈에서 활성 의뢰 조감 · 각 큐 페이지 렌더·행 클릭 딥링크 탭 확인 · 통합 메뉴에서 개발의뢰 줄 사라짐 · 새로고침해도 스위처가 개발 모듈에 머무름(라우트 접두 판정). **픽스처는 이미 있다**: 의뢰 #35·#36·#37(received)·#38(completed, 문서·업무표·미답변 문의 0)·#39(cancelled)·#40(declined). in_progress 건이 없어 진행 프로젝트 큐는 빈 상태로 확인하고, 홈은 received 3건으로 확인한다. sp-node 는 3333 에서 떠 있다(죽어 있으면 `pnpm --filter api dev`). 데이터를 새로 만들지 말 것.
3. 스크린샷 3장(스위처+홈 · 접수·검토 큐 · 문의·A/S 빈 상태)을 `.tmp/develop/shots/admin-module-*.png`.

## 5. 함정
- `counts` 키가 늘었다(`intake`·`contract`) — 전체 의뢰 페이지 탭 바에서는 두 키를 숨긴다(합산 탭이라 중복).
- 신호 필터 요청은 서버가 메모리 페이지를 자르므로 `total` 은 필터 뒤 수다.
- `ops.currentPhase` 가 null 이면 '—'. `lastInquiry.excerpt` 는 80자 서버 절단.
- 상세 `AdminDevelopRequestDetail.vue` 는 건드리지 않는다(딥링크 `?tab=` 만 쓴다).

## 6. 보고
변경 파일 / 이탈 / 계약·서버 요청 / 검증 결과(명령·수치·픽스처 id·브라우저 확인 여부) / 스크린샷 경로 / 남긴 이슈.
