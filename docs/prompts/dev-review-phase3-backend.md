# 지시서 — AI 사전 검토서 Phase 3: 계약·서버·마이그레이션·관리자 API·삭제

> 정본: `docs/AI_DEV_REVIEW.md`(먼저 전부 읽을 것). 작업 방식 규율: `docs/AI_WORKFLOW_PLAYBOOK.md` · 리포 규칙: `AGENTS.md` · 모노레포 `samplepcb-web-mono-app/AGENTS.md`(있으면).
> 이 지시서는 정본의 §1~§4·§6~§8·§10 을 **서버 측**으로 구현하는 범위다. 화면(apps/market·apps/web)은 다음 단계의 다른 워커가 맡는다 — **건드리지 않는다**.

## 0. 불변식 (위반 금지)

1. **공유 DB**: `prisma migrate dev` / `migrate reset` **절대 금지**(g5_* 전부 드랍). 수기 SQL 마이그레이션 → `pnpm --filter api exec prisma migrate deploy` → `prisma generate`. 마이그레이션은 **additive 만**(컬럼·테이블 삭제 없음).
2. 그누보드 코어(`samplepcb-web/`) 비수정.
3. API 키 원문은 어떤 응답·로그에도 싣지 않는다(마스킹만).
4. 타입 강성(strict·noUncheckedIndexedAccess·exactOptionalPropertyTypes·verbatimModuleSyntax·`no-explicit-any` error). `pnpm -r typecheck`/`lint` 가 통과 상태여야 하는 패키지: `@sp/api-contract`·`@sp/utils`·`api`. **`apps/web`·`apps/market` 는 이 단계에서 깨져도 된다**(다음 단계가 고침) — 손대지 말 것.
5. 커밋하지 않는다. HANDOFF.md 를 만들지 않는다.
6. 이미 구현된 다음 파일은 **수정하지 말고 그대로 쓴다**(프로빙으로 확정된 출하 코드): `apps/api/src/lib/ai/dev-review.ts`(+test) · `apps/api/src/lib/ai/ollama.ts` · `packages/api-contract/src/schemas/market-dev-review.ts` · `schemas/diagram-spec.ts` · `packages/utils/src/dev-review-view.ts` · `apps/api/src/scripts/probe-dev-review.ts` · `apps/api/src/scripts/fixtures/dev-review/*`. 필요한 보강이 있으면 **이탈 보고**로 제안만.
7. 명시 스펙과 코드 사실이 다르면 강행하지 말고 **이탈 보고**(플레이북 §위임 필수 절차 3).

## 1. 데이터 — Prisma + 마이그레이션 `20260828120000_market_dev_review`

```sql
ALTER TABLE `sp_market_project` ADD COLUMN `devReview` JSON NULL;
ALTER TABLE `sp_ai_usecase` ADD COLUMN `extraInstructions` TEXT NULL;
CREATE TABLE `sp_ai_job` (
  `id` CHAR(36) NOT NULL,
  `useCase` VARCHAR(100) NOT NULL,
  `mbId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(20) NOT NULL,          -- running|done|error
  `stage` VARCHAR(20) NULL,               -- attachments|review
  `model` VARCHAR(100) NOT NULL,
  `promptVersion` VARCHAR(100) NOT NULL,  -- 'dev-review.v1' 같은 코드 버전 태그(해시 아님)
  `inputHash` CHAR(64) NOT NULL,
  `resultJson` MEDIUMTEXT NULL,           -- 후처리된 MarketDevReview 직렬화
  `error` VARCHAR(100) NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `finishedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `sp_ai_job_owner_idx` (`mbId`, `startedAt`),
  INDEX `sp_ai_job_reuse_idx` (`useCase`, `mbId`, `model`, `promptVersion`, `inputHash`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
Prisma: `SpMarketProject.devReview Json?` · `SpAiUsecase.extraInstructions String? @db.Text` · `SpAiJob`(@@map sp_ai_job). 기존 AI 컬럼(`diagramHtml·diagramSpec·rocMd·interviewAnswersSharedAt·postings·aiGenerationMeta`)은 **남기되** 주석에 `deprecated 2026-08-28 — 미사용(docs/AI_DEV_REVIEW.md §7)` 명시. `interviewAnswers Json?` 는 **재사용**(9문항 답변 `DevReviewAnswers`).

## 2. 계약 (`packages/api-contract`)

### 2.1 `schemas/ai.ts` 재작성
- `AI_USECASES = ['market.dev-review'] as const`. 옛 키·`AiDiagramRunBody`·`AiStructurizeRunBody`·`AiQuestionPreanalysis*`·`AiRocRunBody`·`AiPostingsRunBody`·`AiInterviewAnswer`·`Rnd*` 전부 삭제.
- `AiUsecaseStatusResponse` 유지. `AiRunResponse { jobId, cached }` 유지.
- `AiJobResponse.data = { jobId, status: 'running'|'done'|'error', stage: 'attachments'|'review'|null, review: MarketDevReview | null, error: string|null, elapsedSecs }`.
- 관리자: `AiSettingsResponse.data = { baseUrl, apiKeyMasked, baseUrlFromEnv, apiKeyFromEnv, visionModel, visionModelFromEnv, devReview: { enabled, model, extraInstructions, promptVersion, updatedAt } }` · `AiSettingsUpdate = { baseUrl?, apiKey?(string|null), visionModel?, devReview?: { enabled, model, extraInstructions(≤2000) } }` · `AiAdminDevReviewTestRun = { model, extraInstructions }` · `AiModelsResponse` 유지 · 신규 `AiJobLogQuery { page, pageSize≤100 }` · `AiJobLogResponse.data = { items: [{ jobId, useCase, stage, model, status, mbIdMasked, elapsedSecs, error, startedAt, finishedAt }], total }` (mbIdMasked = `@sp/utils maskName` 적용).
- `schemas/ai-interview-questions.ts` **삭제**(+index export 제거).

### 2.2 `schemas/market.ts`
- `MarketAiInterviewAnswer`·`MarketPostingCards`·`MarketAiArtifactProvenance`·`MarketAiProvenance`·관련 헬퍼 삭제.
- `MarketProjectCreatePayload`: `requestType`·`diagramHtml`·`diagramSpec`·`rocMd`·`postings`·`interviewAnswers`·`shareInterviewAnswers`·`aiJobIds`·`startHopeDate`·`dueHopeDate` 제거(시작/완료 희망일은 이미 v2 에서 UI 삭제 — 컬럼은 남음, 항상 null). 추가: `answers: DevReviewAnswers.default([])`, `devReviewJobId: z.string().uuid().optional()`. `serviceAreas: z.array(MarketActiveServiceArea).min(1).max(3)`. `categories`·`cadTools` 는 `.default([])` 유지. "개별=1분야" refine 삭제.
- `MarketProjectPatchBody`: AI 필드 전부 제거, `devReview: z.null().optional()`(null=검토서 제거) 추가, `requestType` 제거, refine 삭제. `serviceAreas` 는 활성 3종.
- `MarketProjectListQuery`: `requestType` 필터 제거.
- 응답(상세·목록·관리자·내 의뢰 등 `requestType`이 있는 모든 스키마): 옛 AI 필드 제거, `devReview: MarketDevReview.nullable()` 추가(목록엔 `hasDevReview: boolean` 만). `requestType` 은 응답에 **유지**(서버 파생값 표시용).
- 전문가 등록/수정 `serviceAreas`: 입력은 `MarketActiveServiceArea` 배열, 응답은 전체 enum(읽기 호환).
- `routes.ts`: `rndAi` 제거.

## 3. 서버 (`apps/api`)

### 3.1 `lib/ai/usecases.ts` 재작성
- 레지스트리는 `market.dev-review` 하나: `{ defaultModel: 'deepseek-v4-pro:0813', promptVersion: DEV_REVIEW_PROMPT_VERSION, think: false }` — **defaultModel/think 는 프로빙 결과로 감사 때 바꿀 수 있는 상수**이므로 한 곳에만 둘 것.
- 유지: `getAiConnection`/`setAiConnection`/`maskApiKey`/`ensureAiUsecaseRows`/`getAiUsecase`(행 lazy 생성 시 `promptTemplate=''`, `extraInstructions=null`).
- 추가: `getAiVisionModel()` — 우선순위 env `AI_ATTACHMENT_VISION_MODEL` > sp_config `ai_vision_model` > 기본 `'qwen3.5:397b'`; `setAiVisionModel()`; 응답에 `visionModelFromEnv`.
- 옛 프롬프트 상수·파서·`buildTechnicalContext`·`CUSTOMER_INPUT_POLICY`·`hasElectronicsArea` 등 전부 삭제(dev-review.ts 가 대체).

### 3.2 `lib/ai/jobs.ts` → DB 저장소로 재작성
- `createAiJob({ useCase, mbId, model, promptVersion, inputHash })` · `setAiJobStage(id, stage)` · `finishAiJob(id, { review } | { error })` · `getAiJob(id)` · `findReusableAiJob(useCase, mbId, { model, promptVersion, inputHash })`(status done ∧ finishedAt ≥ now−1h) · `listAiJobs({ page, pageSize })`. 해시 헬퍼 `hashAiText/hashAiBytes/hashAiInput` 는 `lib/ai/hash.ts` 로 옮기고 attachment-extractor 임포트 수정.
- `resultJson` 은 `MarketDevReview.parse` 를 통과한 객체의 직렬화. 읽을 때 파손이면 status error 로 취급.

### 3.3 `lib/ai/runner.ts` → `startDevReviewJob`
입력 `{ mbId, model, think, extraInstructions, source: DevReviewSource(첨부 텍스트만), images: string[], attachmentHashes, inputHash, log, reuseCompleted=true }`.
1. `reuseCompleted` 면 `findReusableAiJob` → 히트 시 `{ job, cached: true }`.
2. `createAiJob` 후 비동기: `images.length>0` 이면 stage `attachments` → `ollamaChatDetailed(conn, visionModel, buildAttachmentReadPrompt(n), 180_000, images, { format: ATTACHMENT_READ_JSON_SCHEMA })` → `parseAttachmentReadResult` 를 `source.attachmentContext` 뒤에 붙임(실패는 warn 후 텍스트만으로 계속).
3. stage `review` → `ollamaChatDetailed(conn, model, buildDevReviewPrompt(source, extraInstructions), 600_000, [], { format: DEV_REVIEW_LLM_JSON_SCHEMA, think })` → `parseDevReviewLlmOutput`(throw 시 동일 프롬프트 1회 재시도) → `postProcessDevReview(output, source, meta)` → `finishAiJob(id, { review })`.
   - `format`/`think` 로 HTTP 4xx 가 오면 그 옵션을 빼고 1회 재시도(프로브 하네스 `chatWithFallback` 과 동일 규칙 — 함수로 공유해도 좋다).
   - meta = `{ jobId, model, promptVersion, inputHash, generatedAt: ISO, attachmentFiles }`.
4. 오류는 `GENERATION_FAILED` / `EMPTY_RESULT` 등 짧은 코드로 `finishAiJob(id, { error })`.

### 3.4 `routes/ai.ts` 재작성
- `GET /ai/market.dev-review/status` — 공개, `{ useCase, enabled }`.
- `POST /ai/market.dev-review/run` — multipart(`payload` JSON + `attachment[]`), 본문 소비 뒤 `jwtVerify`(기존 패턴). `DevReviewRunPayload` 파싱(400 `PAYLOAD_SCHEMA_MISMATCH`), 비활성 409 `USECASE_DISABLED`. 첨부: `expandAiArchives` → `prepareAiAttachments(files.map(f => ({...f, filename: f.displayPath})), { maxFiles: 50 })`. `inputHash = devReviewInputHash({ …payload, attachmentHashes: 원본(zip 전개 전) 첨부의 hashAiBytes 앞 10개 })` — **등록 라우트와 정확히 같은 규칙**이어야 한다(§3.5). `startDevReviewJob` → `{ jobId, cached }`.
- `GET /ai/jobs/:jobId` — 소유자만(타인 404). 응답 §2.1.
- 옛 라우트(`/:useCase/run` 범용·preanalyze·run-with-attachments) 삭제.

### 3.5 `routes/market-projects.ts`
- create: 새 payload. `requestType = serviceAreas.length > 1 ? 'system' : 'individual'` 로 저장. `interviewAnswers = payload.answers`(빈 배열이면 DbNull). `devReviewJobId` 가 있으면: `getAiJob` → 소유자·`useCase==='market.dev-review'`·`status==='done'` 아니면 400 `REVIEW_JOB_INVALID`; `job.inputHash !== devReviewInputHash({ title, serviceAreas, description, answers, attachmentHashes(§3.4 와 같은 규칙) })` 면 400 `REVIEW_STALE`; 통과 시 `devReview = job 의 review 객체`(클라이언트가 보낸 본문은 존재하지 않는다). 옛 AI 컬럼엔 아무것도 쓰지 않는다(`startHopeDate/dueHopeDate` null).
- detail(공개·소유자·관리자·전문가 공통): `devReview` 는 상세를 볼 수 있는 모든 뷰어에게 노출(공개 범위 = description 동일 — 기존 diagramHtml 과 같은 정책). 옛 필드·`interviewAnswers` 노출 로직·`expertCanViewInterviewAnswers` 삭제(`lib/market-ai-access.test.ts` 도 삭제).
- list: `hasDevReview`. `requestType` 필터 제거.
- PATCH: `devReview: null` → 컬럼 null. **title/description/serviceAreas 중 하나라도 바꾸는 PATCH 는 검토서가 남아 있으면 409 `DEV_REVIEW_ATTACHED`**(같은 요청에 `devReview: null` 을 함께 보내면 허용) — 검토서와 원천이 항상 일치한다는 불변식. serviceAreas 변경 시 requestType 재파생.
- `lib/market.ts`: `toServiceAreaCodes` 는 전체 enum 정규화 유지 + `toActiveServiceAreaCodes`(활성 ∩) 추가. `asRequestType` 유지.

### 3.6 입찰·전문가
- `routes/market-bids.ts`: `FULL_SERVICE_COMPANY_ONLY` 가드와 그 에러 코드 삭제.
- `routes/market-experts.ts`·`admin-market-experts.ts`: 등록/수정 입력은 활성 3종, 목록 필터·응답의 `serviceAreas` 는 `toActiveServiceAreaCodes`(옛 값은 조용히 숨김). 로컬 DB 승인 전문가 1명(10분야)은 **일회성 SQL** `UPDATE sp_market_expert SET serviceAreas='["circuit","pcb","firmware"]' WHERE serviceAreas LIKE '%app%'` 로 백필(마이그레이션 아님 — 실행 후 보고).
- `routes/admin-market-projects.ts`: 옛 AI 필드 제거, `devReview` 포함.

### 3.7 관리자 AI 설정 `routes/admin-settings.ts`
- `GET/PATCH /admin/settings/ai` — §2.1 형태. PATCH 는 연결·visionModel·devReview(enabled/model/extraInstructions) 부분 저장.
- `POST /admin/settings/ai/test` — body `{ model, extraInstructions }`. `lib/ai/admin-samples.ts` 를 재작성해 **픽스처 `01-idea-only.json` 내용을 코드 상수**로 둔 비식별 샘플(`DevReviewSource`, 첨부 없음)로 `startDevReviewJob({ …, reuseCompleted: false })`. 응답 `{ jobId, cached:false }`(폴링은 `/api/ai/jobs/:id` — 관리자 토큰의 mbId 가 소유자).
- `GET /admin/settings/ai/jobs?page&pageSize` — `listAiJobs`.

### 3.8 삭제
- `routes/rnd-ai.ts` + `server.ts` 등록 2줄, `apps/rnd/` 디렉터리 전체, 루트 `package.json` `dev:rnd`, `apps/api/package.json` `rnd:probe`·`rnd:request-probe`, `src/scripts/probe-rnd-*.ts`, `ops/nginx/local-web.conf` 의 `/rnd` upstream·location·주석 블록, `AGENTS.md` 의 sp-rnd 행·문장·라우팅 줄(3곳).
- `lib/ai/provenance.ts`(+test), `lib/ai/interview-questions.test.ts`, `lib/ai/admin-samples.test.ts`(재작성 대상에 맞게 새로), `apps/market/src/lib/diagram-srcdoc.ts` 는 **다음 단계**(건드리지 않음).
- `.env.example` AI 섹션: `AI_ATTACHMENT_VISION_MODEL` 기본값 설명을 `qwen3.5:397b`(ollama.com 직결 태그)로, 관리자 화면에서도 설정 가능함을 명시.
- `routes/ai.ts` 의 `attachmentVisionModel()` 은 `getAiVisionModel()` 로 대체.

## 4. E2E `ops/scripts/e2e-market.mts` 갱신
옛 AI 케이스(diagramHtml/diagramSpec/rocMd/postings 왕복·파손 spec 400·인터뷰 답변 공개·전체서비스 403·`requestType:'system'` 전송)를 제거하고 다음을 추가(정본 §10):
1. `sp_ai_job` 에 `status='done'` 행을 prisma 로 직접 시드(`resultJson` 은 `MarketDevReview` 를 만족하는 최소 객체 — `stats`·`meta`·`brief` 포함, `inputHash` 는 등록 payload 로 `devReviewInputHash` 계산값과 같게. 이 함수는 `apps/api/src/lib/ai/dev-review.ts` 에서 `apiRequire` 대신 `tsx` 임포트가 가능하면 임포트, 아니면 동일 canonical JSON 규칙을 스크립트에 복제하되 주석으로 출처 명시).
2. `devReviewJobId` 로 등록 → 익명 상세에 `devReview.stats` 노출 · 제3자 잡 id 로 등록 시 400 `REVIEW_JOB_INVALID` · 제목을 바꾼 payload 로 등록 시 400 `REVIEW_STALE`.
3. 검토서 있는 프로젝트의 제목 PATCH → 409 `DEV_REVIEW_ATTACHED`; `{ title, devReview: null }` 동시 전송 → 200 · 상세 `devReview === null`.
4. 분야 2개 등록 → 응답 `requestType === 'system'` · **개인 전문가 입찰 200**.
5. cleanup 이 시드한 `sp_ai_job` 행도 지운다.

## 5. 검증 절차 (보고에 결과 첨부)
1. `pnpm --filter api exec prisma migrate deploy` → `prisma generate` 로그.
2. `pnpm --filter @sp/api-contract typecheck && pnpm --filter @sp/utils typecheck && pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test`(dev-review.test.ts 포함 전부 green).
3. api 기동 후 `e2e-market.mts run` → 전항 통과 → `cleanup` → DB 원복 확인(`sp_ai_job`·프로젝트·계약 잔존 0).
4. 실 LLM 호출 1회: `POST /api/admin/settings/ai/test`(관리자 JWT) → `/api/ai/jobs/:id` 폴링 → `review.stats` 출력. (연결은 `.env` 의 ollama.com 직결.)
5. 시드 데이터·전문가 백필 SQL 실행 결과(영향 행 수).

## 6. 알려진 함정
- multipart 라우트는 본문 소비 뒤 `jwtVerify`(기존 `market-projects` create·옛 `ai.ts` 패턴 그대로).
- Ollama `format` 은 ollama.com 직결에서 무시될 수 있다(프로빙 실측 — 코드펜스가 섞여 옴). `parseDevReviewLlmOutput` 이 펜스를 벗기므로 그대로 두되, `format`/`think` 로 4xx 면 옵션 없이 재시도.
- `deepseek-v4-pro` 는 텍스트 전용 — 이미지는 반드시 비전 단계에서 텍스트화한 뒤 주모델로.
- raw SQL 컬럼명 추측 금지(Prisma 필드로). BigInt id 는 `String()`/`BigInt()` 변환.
- e2e 는 공유 DB 픽스처 — 단일 프로세스, 스스로 만들고 스스로 지운다.
- `apps/web`·`apps/market` 는 이 단계 뒤 typecheck 가 깨지는 것이 정상 — 고치지 말 것.

## 7. 보고 형식
변경 파일 목록(생성/수정/삭제) · 이탈 사항과 이유 · 검증 §5 각 항목의 실제 출력(요약) · DB 원복 내역 · 남긴 이슈. 요약이 아니라 **실행한 명령과 결과**를 적을 것.
