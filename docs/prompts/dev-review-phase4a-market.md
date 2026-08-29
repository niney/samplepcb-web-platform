# 지시서 — AI 사전 검토서 Phase 4A: sp-market 화면 (`apps/market`)

> 정본 `docs/AI_DEV_REVIEW.md` §1·§2·§4·§5 를 고객 화면으로 구현한다. Phase 3(계약·서버)은 끝나 있다 —
> 계약(`@sp/api-contract`)·유틸(`@sp/utils`)·API 는 **있는 그대로 소비**하고 수정하지 않는다(필요하면 이탈 보고).
> 규율: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md`. 파일 범위는 **`apps/market/` 만**(다른 워커가 `apps/web` 를 동시에 고친다).

## 0. 불변식
- 타입 강성(strict·noUncheckedIndexedAccess·exactOptionalPropertyTypes·verbatimModuleSyntax·no-explicit-any). `pnpm --filter market typecheck && pnpm --filter market lint` green.
- 계약·유틸·api·web 수정 금지. 커밋 금지. worktree 금지(현재 트리).
- LLM 산출을 `v-html` 로 DOM 에 직결하지 않는다. 구성도는 `renderDiagramSpecHtml(review.diagram)`(결정적 SVG, `@sp/utils`)을 기존 `DiagramViewer`(sandbox iframe srcdoc)로만 렌더. `lib/diagram-srcdoc.ts` 의 CSP 살균은 결정적 SVG 엔 불필요 — 파일 삭제하고 `DiagramViewer` 는 srcdoc 에 그대로 넣되 `sandbox=""` 유지.
- 문구는 기존 관례대로 ko 인라인(`i18n/locales` 에 이미 있는 키 체계가 있으면 그것을 따른다).

## 1. 계약 소비 지점(이름은 Phase 3 결과가 정본 — `packages/api-contract/src/schemas/market-dev-review.ts`·`ai.ts`·`market.ts`·`packages/utils/src/dev-review-view.ts` 를 읽고 맞출 것)
- `DEV_REVIEW_QUESTIONS`·`DEV_REVIEW_QUESTION_MAP`·`DevReviewAnswers`·`DEV_REVIEW_UNKNOWN_CHOICE`·`devReviewAnswerText`
- `MarketDevReview`·`DEV_REVIEW_DISCLAIMER`·`MARKET_ACTIVE_SERVICE_AREAS`·`MARKET_SERVICE_AREA_LABELS`
- `buildDevReviewView`·`devReviewAreaBadge`(@sp/utils)·`renderDiagramSpecHtml`
- API: `GET /api/ai/market.dev-review/status` · `POST /api/ai/market.dev-review/run`(multipart `payload`+`attachment[]`) · `GET /api/ai/jobs/:id`(`{status, stage, review, error, elapsedSecs}`) · 등록 `POST /api/market/projects`(payload 에 `answers`·`devReviewJobId?`, `requestType` 없음) · PATCH `devReview:null` · 에러 코드 `REVIEW_STALE`·`REVIEW_JOB_INVALID`·`DEV_REVIEW_ATTACHED`·`USECASE_DISABLED`.

## 2. 의뢰 위저드 3스텝 (`pages/RequestWizard.vue` + `components/request/`)
- 스텝 배열: `[describe, questions, review]`; AI 비활성(status false) 또는 동의 해제 시 `[describe, review]`.
- **Step 1 `StepDescribe.vue`**: 상단에 "필요한 개발 분야" 칩 3개(`MARKET_ACTIVE_SERVICE_AREAS`, 1개 이상, 복수) → 제목 → 설명 → 첨부 → "AI 사전 검토 동의"(기본 on, 문구: 설명·답변·첨부를 AI 분석에 보내 검토서를 만든다는 고지). 의뢰 유형 카드·자동 전환 안내·`typeNotice` 전부 삭제. `?cat=` 프리셋은 활성 3종만 허용(그 외는 circuit).
- **Step 2 `StepQuestions.vue`**: `DEV_REVIEW_QUESTIONS` 9문항을 한 화면에. 단일 선택은 라디오형 칩, 복수는 토글 칩, `unknown` 선택지는 시각적으로 구분(회색 "잘 모르겠어요 — 전문가와 상의"). `notePlaceholder` 가 있는 문항은 메모 입력, `noteRequiredFor` 해당 선택 시 필수. 미응답 문항은 등록 시 보내지 않는다(answers 배열에서 제외). 전 문항 선택 사항. 진입 시 AI 호출 없음.
- **Step 3 `StepReview.vue`**: 진입 시 검토서 생성 자동 시작(동의 on ∧ 활성). 진행 표시 2단(`stage==='attachments'` → "첨부 확인 중…", `'review'` → "검토서 작성 중… (30초~3분)"), 경과 초 표시. 완료 시 `DevReviewView` 미리보기 + "이 검토서를 의뢰에 포함" 체크(기본 on). 실패 시 오류 + "다시 만들기". 그 아래 조건 폼(예산·마감·방식·NDA — 기존 그대로) + 등록 버튼.
  - **신선도**: 제목·분야·설명·답변·첨부(name+size+lastModified)로 로컬 서명을 만들어 검토서 생성 시점과 비교. 바뀌면 검토서를 "오래됨" 상태로 표시하고 포함 체크를 끄며 "검토서 다시 만들기" 버튼 노출(재생성 1회 호출, 루프 없음).
  - 포함 예정 검토서가 생성 중이면 등록 차단 + 사유 + "검토서 없이 바로 등록" 탈출구(기존 패턴).
  - 등록 payload: `answers`(응답한 것만), 포함 시 `devReviewJobId`. 서버 `REVIEW_STALE` 응답이면 안내 후 재생성 유도.
- `composables/useRequestWizardForm.ts` 재작성(필드: serviceAreas·title·description·aiConsent·answers·ndaRequired·budgetRange·deadlineMode·deadlineDate·method·targetExpertId). `useRequestWizardAi.ts` 는 **삭제**하고 `composables/useDevReviewJob.ts`(run multipart → jobId → 5초 폴링 → review; 취소·재생성; 로컬 서명) 로 대체. `api/useAi.ts` 는 status·run·job 3개만.
- 삭제: `StepArea.vue`·`StepInterview.vue`·`useRequestWizardAi.ts`·`lib/diagram-srcdoc.ts`·`RocViewer.vue`.

## 3. `components/dev-review/DevReviewView.vue` (+필요 시 하위 컴포넌트)
`buildDevReviewView(review)` 로 파생값을 얻어 정본 §1 표 순서대로 렌더:
1. 헤더: 분야 배지(`areaBadge`) · "확정 N · 확인 필요 M" 배지 · 고정 고지문 `DEV_REVIEW_DISCLAIMER` · 생성 모델·시각(`meta`, 작게).
2. 의뢰 브리프: `briefRows` 표(`unknown` 행은 회색 + "확인 필요" 배지) + `summary` + 핵심 요구 `requirements`(확정=본문, 확인 필요=회색+배지+질문).
3. 시스템 구성도: `DiagramViewer`(클릭 확대는 기존 동작 유지). 컨테이너 폭 전체 사용.
4. 분야별 검토 포인트: 분야마다 카드 — 구현 방식·범위(`scope`) / 주의 리스크(`risks`, 근거 인용 접이식) / 확인 필요(`scope`·`spec` 의 needs_confirmation 요약).
5. 개발명세서: 분야 탭 또는 세로 나열 — `spec` 표(항목 | 내용 | 상태). 확정 행은 본문, 확인 필요 행은 회색+배지+질문(+why). 근거는 행 펼침 "출처: …". 확정 0건이면 표 대신 한 줄 **"상담 후 작성"**.
6. 결과물 목록: `deliverables`(requested 는 강조).
7. 개발 단계 순서: `phases`(기간 없음 — "기간은 전문가 견적에서 제시됩니다" 한 줄).
8. 전문가와 확정할 항목: `openQuestions`(질문 + why, 분야 태그).
판정어·등급·금액·주수는 어디에도 쓰지 않는다. 확정/확인 필요 배지 어휘는 이 두 단어만.

## 4. 상세·목록·기타
- `pages/ProjectDetail.vue`: 옛 AI 섹션(구성도/지시서/카드/인터뷰 답변/provenance 라벨) 제거 → `detail.devReview` 가 있으면 `DevReviewView` 한 섹션. 소유자에게 "검토서 제거"(PATCH `devReview:null`, confirmDialog 관례) 제공. 제목·설명 수정 UI 가 있으면 `DEV_REVIEW_ATTACHED` 안내("검토서를 제거하고 수정" 옵션).
- `components/ProjectCard.vue`·`pages/Projects.vue`·`pages/Home.vue`: `requestType` 배지·필터 제거 → `devReviewAreaBadge(item.serviceAreas)` 배지, `hasDevReview` 면 "AI 사전 검토서" 칩. 분야 필터는 활성 3종.
- `pages/ExpertRegister.vue`·`components/ExpertProfileForm.vue`·`pages/Experts.vue`·`ExpertDetail.vue`: 분야 선택·필터는 `MARKET_ACTIVE_SERVICE_AREAS`, 표시는 응답값 그대로 라벨.
- `lib/error-msg.ts`: `REVIEW_STALE`("의뢰 내용이 바뀌어 검토서를 다시 만들어야 합니다")·`REVIEW_JOB_INVALID`·`DEV_REVIEW_ATTACHED`·`USECASE_DISABLED` 추가, `FULL_SERVICE_COMPANY_ONLY` 제거.
- **너비**: `layouts/MarketLayout.vue` 의 `max-w-6xl` 4곳·`Projects.vue`·`ProjectDetail.vue` → `max-w-[1440px] px-6`; `RequestWizard.vue` `max-w-3xl` → `max-w-6xl`. 목록 카드 그리드는 1440 에서 4열이 자연스러우면 4열.
- `BidFormModal.vue` 등에 전체서비스 제한 문구·`useExpertMe` 선반영 규칙이 있으면 제거.

## 5. 검증
1. `pnpm --filter market typecheck && pnpm --filter market lint && pnpm --filter market build`.
2. dev 서버(5176)에서 실브라우저 흐름 1회(관리자 화면에서 검토서 생성이 켜져 있어야 함 — 꺼져 있으면 `sp_ai_usecase` 의 `market.dev-review` 행을 SQL 로 `enabled=1` 하고 보고): 위저드 3스텝 → 첨부 1개(`apps/api/src/scripts/fixtures/dev-review/02-requirements.pdf`) → 검토서 생성 → 등록 → 상세에서 검토서 확인 → 검토서 제거. 가능하면 `e2e/`(playwright-core) 로 각 스텝·상세 스크린샷을 `.tmp/dev-review-ui/` 에 저장(감사용). 생성한 프로젝트는 끝나면 삭제(소유자 삭제 API 또는 SQL)하고 보고.
3. 만든 스크린샷 경로·남긴 데이터·이탈 사항을 보고.

## 6. 함정
- 로컬 통합 도메인 `https://local-web.samplepcb.co.kr`(nginx) 에서 PHPSESSID 쿠키 충돌로 `/spcb/api/me` 401 이 나면 해당 도메인 쿠키 삭제(메모리 함정).
- multipart run 은 `payload` 파트에 JSON 문자열, 파일은 `attachment` 필드명.
- 첨부가 있으면 서버가 비전 단계를 먼저 돌린다(수십 초) — 진행 표시가 stage 를 보여야 한다.
