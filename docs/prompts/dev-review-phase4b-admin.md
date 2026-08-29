# 지시서 — AI 사전 검토서 Phase 4B: sp-vue 관리자 화면 (`apps/web`)

> 정본 `docs/AI_DEV_REVIEW.md` §6 을 관리자 화면으로 구현한다. Phase 3(계약·서버)은 끝나 있다 — 계약·유틸·API 는
> **있는 그대로 소비**하고 수정하지 않는다(필요하면 이탈 보고). 규율: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md`.
> 파일 범위는 **`apps/web/` 만**(다른 워커가 `apps/market` 를 동시에 고친다).

## 0. 불변식
- 타입 강성·`pnpm --filter web typecheck && pnpm --filter web lint` green. 계약·유틸·api·market 수정 금지. 커밋 금지. worktree 금지.
- i18n: `apps/web` 은 `vue-i18n` 키 체계(`i18n/locales/ko.ts`·`en.ts`) — 새 문구는 ko/en 둘 다 키로 추가(동형 유지).
- LLM 산출 `v-html` 금지. 구성도는 `renderDiagramSpecHtml` → sandbox iframe srcdoc.

## 1. 계약 소비 지점(이름은 Phase 3 결과가 정본 — `packages/api-contract/src/schemas/ai.ts`·`market-dev-review.ts`·`market.ts`·`packages/utils/src/dev-review-view.ts` 를 읽고 맞출 것)
- `GET/PATCH /api/admin/settings/ai` → `{ baseUrl, apiKeyMasked, baseUrlFromEnv, apiKeyFromEnv, visionModel, visionModelFromEnv, devReview: { enabled, model, extraInstructions, promptVersion, updatedAt } }`
- `POST /api/admin/settings/ai/test` `{ model, extraInstructions }` → `{ jobId }` → `GET /api/ai/jobs/:id` 폴링(`{ status, stage, review, error, elapsedSecs }`)
- `GET /api/admin/settings/ai/models` · `GET /api/admin/settings/ai/jobs?page&pageSize` → `{ items[], total }`
- 관리자 프로젝트 상세 `devReview: MarketDevReview | null`(옛 `diagramHtml/diagramSpec/rocMd/postings/aiProvenance/interviewAnswers` 는 없음)

## 2. `components/admin/AiSettingsForm.vue` 전면 재작성 (`admin/useAdminSettings.ts` 동반)
세 블록, 위에서 아래로:
1. **연결** — 기존 UX 유지: API 주소·API 키(입력=교체·비움=유지·체크=삭제, env 우선이면 잠금+안내)·연결 테스트(모델 목록 → 이후 셀렉트 datalist).
2. **검토서 생성** — 사용 토글 · 주모델(datalist) · 첨부 판독 모델(datalist, env 우선이면 잠금) · 추가 지침 textarea(≤2000자, 도움말: "프롬프트 끝에 붙는 운영 지침. 출력 형식·판정 규칙은 코드가 고정") · 프롬프트 버전(읽기 전용 텍스트) · 저장 · **샘플 테스트 실행**(저장하지 않은 현재 모델·지침으로 비식별 샘플 실행 → 진행 단계·경과 표시 → 결과: "확정 N · 확인 필요 M" 배지 + summary + 핵심 요구 목록 + 전문가와 확정할 항목 목록 + 구성도(sandbox iframe) + "JSON 보기" 접이식).
3. **실행 이력** — 표(시각·단계·모델·상태·소요(초)·오류·회원(마스킹)) + 페이지네이션(기존 `UiPagination` 관례). 새로고침 버튼.
옛 유스케이스 카드 반복·프롬프트 textarea·rnd 항목·`AiUsecaseConfigType` 의존 전부 제거. i18n `admin.settings.ai.*` 키 정리(옛 `usecases.*` 키 삭제, 새 키 ko/en 추가).

## 3. `pages/admin/AdminMarketProjects.vue` 드로어
- `MARKET_REQUEST_TYPE_LABELS[detail.requestType]` 표시는 유지해도 되지만 분야 배지는 `devReviewAreaBadge(detail.serviceAreas)`(@sp/utils) 로.
- 옛 AI 표시(구성도/지시서/카드/provenance)가 있으면 제거하고, `detail.devReview` 가 있으면 축약 섹션: 배지(확정/확인 필요) · summary · 분야별 확인 필요 개수 · 전문가와 확정할 항목 목록 · 구성도(sandbox iframe) · "JSON 보기" 접이식.
- 목록 필터에 `requestType` 이 있으면 제거(분야 필터는 `MARKET_ACTIVE_SERVICE_AREAS`).
- `AdminMarketExperts.vue`: 분야 표시는 응답값 라벨 그대로(필터가 있으면 활성 3종).

## 4. 검증
1. `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`.
2. dev(5173)에서 `/app/admin/settings` → AI 연동 탭: 연결 테스트 → 검토서 생성 켜기·저장 → 샘플 테스트 실행 → 결과 렌더 확인 → 실행 이력에 방금 잡이 보이는지. 가능하면 `e2e/`(playwright-core, `/spcb/api/me` 스텁 로그인 관례) 로 스크린샷을 `.tmp/dev-review-ui/admin-*.png` 에 저장.
3. 보고: 변경 파일·이탈·스크린샷 경로·남긴 이슈.

## 5. 함정
- 관리자 토큰의 mbId 가 샘플 테스트 잡의 소유자다 — 폴링은 `/api/ai/jobs/:id`(관리자 전용 라우트 아님).
- 샘플 테스트는 실제 LLM 호출(30초~3분). 진행 중 탭을 떠나도 폴링이 정리되게(기존 `AiSettingsForm` 의 폴링 정리 관례).
- 도메인와이드 PHPSESSID 충돌로 `/spcb/api/me` 401 이면 쿠키 삭제(메모리 함정).
