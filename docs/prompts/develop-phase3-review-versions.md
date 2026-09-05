# 지시서 — 개발의뢰(sp-develop) P3: AI 검토서 버전 원장·비교·복원 (worker C2)

> 기록: 워커는 사용자가 중단해 **Fable 이 직접 구현**했다(2026-09-05 저녁). 아래 설계가 그대로 구현됐고, 벗어난 점은 §3.7 백필 스크립트 위치(`apps/api/src/scripts/`, lint 프로젝트 범위 때문)와 하네스 픽스처의 `generatedAt` 고정(같은 내용 재저장 검증용)뿐이다.

리포 `D:\work\workspace_other\samplepcb-web-platform`. 브랜치 `feat/develop-mvp`(체크아웃됨 — 브랜치 변경·커밋 금지, 트리 클린에서 시작).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · 정본 `docs/DEVELOP_FLOW.md`(§6·§6.1·§7.3·§8·§11.1) · 직전 지시서 `docs/prompts/develop-phase3-schedule.md`(규칙·검증 방식 동일).

## 0. 한 줄 요약
검토서 3층(초안·작업본·공개본)은 "현재 포인터"만 있고 이력이 없다. **버전 원장 테이블**을 붙여 AI 초안 완성·관리자 저장·공개의 세 순간마다 스냅샷을 쌓고, 관리자 검토서 탭에 **버전 목록·두 판 구조 비교·작업본으로 복원**을 제공한다. 고객은 최신 공개본만 보되 헤더에 버전 라벨(v3 · 공개일)을 표시한다(2026-09-05 사용자 결정). 구성도(diagram)는 이번 범위 밖.

## 1. 불변식
- 3층 컬럼(`devReviewDraft`·`devReview`·`devReviewPublic` 등)은 **그대로** — 현재 포인터 역할. 원장은 additive 테이블 하나.
- 공유 DB: `prisma migrate reset/dev` 금지. 수기 additive 마이그레이션 → `pnpm --filter api exec prisma migrate deploy`. 백필 스크립트는 idempotent(이미 버전이 있는 의뢰는 건너뜀).
- diff 는 **구조 비교**(글자 diff 아님) — 계약/유틸의 순수 함수로, 단위 테스트 필수. 서버는 저장·조회·복원만.
- 마켓(`apps/market`·`sp_market_*`) 무변경. 커밋 금지. 네이티브 confirm/alert 금지(인라인 확인). i18n 은 `apps/web` 만(`@sp/ui`·`apps/develop` 는 한국어 하드코딩 관례).
- 파일 스코프: `apps/api/prisma/schema.prisma`(+ 새 마이그레이션 폴더 `apps/api/prisma/migrations/20260905190000_develop_review_version/`), `apps/api/scripts/backfill-develop-review-versions.ts`(신규), `apps/api/src/lib/develop-review-versions.ts`(신규), `apps/api/src/lib/ai/runner.ts`(develop 기록 훅만), `apps/api/src/routes/admin-develop-requests.ts`, `apps/api/src/routes/develop-requests.ts`(고객 상세에 `reviewPublicSeq` 만), `packages/api-contract/src/schemas/develop.ts`, `packages/api-contract/src/routes.ts`(필요시), `packages/utils/src/dev-review-diff.ts`(+ `.test.ts`, `index.ts` export), `packages/ui/src/components/DevReviewView.vue`(버전 라벨 prop 만), `apps/web/src/admin/useAdminDevelop.ts`, `apps/web/src/components/admin/develop/{DevelopReviewPanel.vue, DevelopReviewVersions.vue(신규), DevelopReviewDiff.vue(신규)}`, i18n `ko.ts`/`en.ts`(`admin.develop.review.versions.*`), `apps/develop/src/pages/RequestDetail.vue`(라벨 전달만), `ops/scripts/e2e-develop.mts`, `docs/DEVELOP_FLOW.md`. 그 밖은 손대지 말 것.

## 2. 현재 구조(읽고 시작)
- 초안 기록: `apps/api/src/lib/ai/runner.ts` `writeReviewToTarget`(develop 타깃) — `devReviewDraft/At/JobId` 갱신 + 작업본이 비어 있으면 같은 내용으로 seed + `ai_drafted` 이벤트.
- 관리자 라우트 `apps/api/src/routes/admin-develop-requests.ts`: `PUT /develop/requests/:id/review`(작업본 저장, meta.editedAt/By 찍음) · `POST …/review/:action`(publish → `devReviewPublic` 스냅샷 + `published` 이벤트 / unpublish / reset = 초안을 작업본으로 복사). 상세 응답은 `buildAdminDetail` → `AdminDevelopReviewState`(계약 `develop.ts` 579행 근처: draft·draftAt·draftJobId·draftRunning·draftError·stale·working·editedAt·editedBy·publicReview·publishedAt·publishedStale).
- 고객 상세 `develop-requests.ts` `buildDevelopRequestDetail` — `review`(공개본) 를 준다.
- 관리자 패널 `apps/web/src/components/admin/develop/DevelopReviewPanel.vue`: `tab: 'edit' | 'preview'`, 편집기 `DevelopReviewEditor.vue`(`seedKey` 가 바뀌면 로컬을 다시 세움 — 현재 `requestId:work:editedAt`), 저장·공개·초안 가져오기·다시 생성 버튼. 훅은 `apps/web/src/admin/useAdminDevelop.ts`(`useAdminDevelopReviewPut`·`useAdminDevelopReviewAction` 관례 — 성공 시 상세 쿼리 setQueryData/invalidate).
- 공용 뷰 `packages/ui/src/components/DevReviewView.vue`(props: review·title·diagram…), 헤더에 모델·생성 시각 줄이 있다.
- 검토서 스키마 `market-dev-review.ts`(`MarketDevReview`: summary·requirements[{text,evidence}]·areas[{area,summary,spec[{item,text,evidence}],observations[{text,evidence}]}]·openQuestions[{question,why,area,resolution}]·checks·schedule{phases[{name,minWeeks,maxWeeks,output,prerequisite,note}],wishCode,assumptions}·adminComment·meta).
- 유틸 테스트 관례: `packages/utils/src/*.test.ts`(vitest). API 하네스 `ops/scripts/e2e-develop.mts`(run→cleanup; 관리자 `ai/review` 호출 금지).

## 3. 확정 설계

### 3.1 테이블·Prisma
```sql
CREATE TABLE `sp_develop_review_version` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `seq` INT NOT NULL,                       -- 의뢰 안에서 1부터
  `kind` VARCHAR(16) NOT NULL,              -- ai_draft | working | published
  `review` JSON NOT NULL,                   -- 스냅샷(MarketDevReview)
  `contentHash` CHAR(64) NOT NULL,          -- 정규화 JSON sha256(meta.editedAt/By 는 제외하고 계산)
  `parentSeq` INT NULL,                     -- 복원 원본 등
  `author` VARCHAR(191) NOT NULL,           -- ai_draft=모델명, 그 외=관리자 mbId
  `jobId` CHAR(36) NULL,
  `inputHash` CHAR(64) NULL,
  `note` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sp_develop_review_version_requestId_seq_key` (`requestId`, `seq`),
  INDEX `sp_develop_review_version_requestId_kind_idx` (`requestId`, `kind`),
  CONSTRAINT `sp_develop_review_version_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
Prisma 모델 `SpDevelopReviewVersion @@map("sp_develop_review_version")`, `SpDevelopRequest` 에 relation 추가. 기존 마이그레이션 파일의 관례(주석·컬럼 스타일)를 따르라.

### 3.2 기록 규칙(`apps/api/src/lib/develop-review-versions.ts`)
- `recordDevelopReviewVersion(tx, requestId, { kind, review, author, jobId?, inputHash?, parentSeq?, note? })` — 트랜잭션 안에서 `seq = max(seq)+1`. **중복 규칙**: 같은 의뢰의 **직전 버전**과 `kind` 도 같고 `contentHash` 도 같으면 기록하지 않는다(null 반환). kind 가 다르면 내용이 같아도 기록한다(공개는 공개 시각이 의미).
- `contentHash`: `review` 에서 `meta.editedAt`·`meta.editedBy` 를 뺀 뒤 키 정렬 JSON 의 sha256(작은 순수 함수, 테스트).
- 세 훅:
  1. `runner.writeReviewToTarget`(develop) → `ai_draft`(author=review.meta.model, jobId, inputHash=review.meta.inputHash). 작업본 seed 는 버전을 따로 만들지 않는다(같은 내용).
  2. `PUT …/review` → `working`(author=mbId). `reset`(초안 가져오기) → `working` + note `'초안에서 가져옴'`.
  3. `publish` → `published`(author=mbId). `unpublish` 는 기록하지 않는다.
- 복원: `POST /develop/requests/:id/review/versions/:seq/restore` → `devReview = version.review`(meta.editedAt/By 는 지금·복원자), `working` 버전 기록 with `parentSeq=seq`, note `'v{seq} 복원'`. 없는 seq → 404.

### 3.3 API(prefix `/api/admin`, requireAdmin)
- `GET /develop/requests/:id/review/versions` → `AdminDevelopReviewVersionListResponse`:
  `{ result:true, data: { items: DevelopReviewVersionMeta[], current: { draftSeq, workingSeq, publicSeq } } }`
  - `DevelopReviewVersionMeta = { seq, kind, author, model(review.meta.model), jobId, parentSeq, note, contentHash, createdAt, summary(review.summary 앞 80자), counts: { requirements, questions, phases } }` — 본문 JSON 은 안 준다(목록은 가볍게).
  - `current.*Seq`: 현재 3층 JSON 의 contentHash 와 같은 **가장 최근** 버전의 seq(없으면 null). 화면이 "지금 초안/작업본/공개본" 배지를 달 근거.
- `GET /develop/requests/:id/review/versions/:seq` → `{ result:true, data: { meta: DevelopReviewVersionMeta, review: MarketDevReview } }`.
- `POST /develop/requests/:id/review/versions/:seq/restore` → `AdminDevelopRequestDetailResponse`(기존 상세 응답 그대로 — 훅이 setQueryData 하기 좋다).
- 고객 상세(`GET /api/develop/requests/:id`)의 `review` 옆에 `reviewPublicSeq: number|null`(현재 공개본 contentHash 와 같은 최근 `published` 버전의 seq). 계약 `DevelopRequestDetail` 에 additive.

### 3.4 구조 비교(`packages/utils/src/dev-review-diff.ts`, 순수 함수 + 테스트)
```ts
export type DevReviewDiffOp = 'added' | 'removed' | 'changed';
export interface DevReviewDiffEntry { section: DevReviewDiffSection; label: string; op: DevReviewDiffOp; before: string | null; after: string | null }
export type DevReviewDiffSection = 'summary' | 'requirements' | 'areas' | 'openQuestions' | 'schedule' | 'adminComment';
export interface DevReviewDiff { entries: DevReviewDiffEntry[]; changedSections: DevReviewDiffSection[]; isEmpty: boolean }
export function diffDevReview(a: MarketDevReviewType, b: MarketDevReviewType): DevReviewDiff
export function diffWords(a: string, b: string): { text: string; op: 'same' | 'added' | 'removed' }[]  // 공백 토큰 LCS — 변경 문장 하이라이트용
```
- 매칭 규칙: summary/adminComment/schedule.assumptions = 단일 텍스트(다르면 changed). requirements = text 정확 일치로 짝짓고 남는 것은 removed/added. areas = area 코드로 짝(없으면 분야 통째 added/removed) → 안에서 summary 텍스트, spec 은 `item` 으로 짝지어 text 비교, observations 는 text 정확 일치. openQuestions = question 텍스트로 짝 → resolution 변화도 changed 로(label 에 "확인 결과"). schedule = phases 를 name 으로 짝 → 주·산출물·선행 조건·비고 변화 changed, wishCode 변화 changed; 한쪽만 schedule 이 있으면 단계 전부 added/removed. checks·meta·brief 는 비교하지 않는다.
- label 은 사람이 읽는 위치("요구사항", "회로 개발 › 명세 › 전원", "상의 항목 3", "일정 › 시제품 제작 › 기간") — 한국어 하드코딩(유틸은 i18n 없음).
- 테스트: 동일 → isEmpty · 요구사항 추가/삭제 · 명세 행 텍스트 변경 · 분야 추가 · 상의 항목 확인 결과 변경 · 일정 단계 주 변경·단계 추가 · 한쪽만 일정 · diffWords 기본 3케이스.

### 3.5 관리자 화면
- `DevelopReviewPanel.vue` 탭을 `'edit' | 'preview' | 'versions'` 로. `versions` 탭에 `DevelopReviewVersions.vue`:
  - **왼쪽 목록**(최신 위): `v{seq}` · kind 배지(AI 초안=indigo / 작업본=gray / 공개=emerald) · author(모델명 또는 mbId) · 시각 · note · 현재 포인터 배지("지금 초안"/"지금 작업본"/"지금 공개"). 각 행에 라디오 두 개(A·B) 또는 "A로"/"B로" 버튼 — 두 판을 고른다. 기본 선택: **A=현재 공개본(current.publicSeq), B=현재 작업본(workingSeq)**; 공개본이 없으면 A=최신 ai_draft, B=작업본; 그것도 없으면 최신 두 개.
  - **오른잙 비교**: 헤더에 A·B 요약(v·kind·시각), `diffDevReview(A,B)` 결과를 섹션별 그룹으로 — 각 항목 라벨 + op 배지 + before/after(changed 는 `diffWords` 로 삭제=빨강 취소선·추가=초록 하이라이트). 변경 0 이면 "두 판이 같습니다". 섹션 요약 칩(변경된 섹션 이름들).
  - 행 동작: `보기`(그 판을 `DevReviewView` 로 인라인 펼침 또는 오른쪽 영역에 표시 — 토글) · `작업본으로 복원`(인라인 확인 → restore 훅 → 성공 시 편집기 seedKey 가 바뀌어 다시 세워진다(editedAt 변화로 자동), 탭은 그대로 두고 안내 문구). 편집기에 저장 안 한 변경(dirty)이 있으면 복원 버튼 옆에 경고 "저장하지 않은 편집이 사라집니다"를 붙이되 막지는 않는다.
  - 목록 훅 `useAdminDevelopReviewVersions(requestId, enabled)`(탭이 열릴 때만 fetch), 단건 `useAdminDevelopReviewVersion(requestId, seq)`, 복원 `useAdminDevelopReviewRestore()`. 저장·공개·복원·AI 완료 뒤 목록 invalidate(상세 쿼리 키 관례를 따르라).
  - 폰트 관례: 본문 상향 상태, input 은 한 단계 작게. Tailwind 회색·파랑 계열(관리자 앱).
- 편집기 상단(edit 탭)에도 작게 "v{workingSeq} 작업본 · 마지막 저장 …" 한 줄(있을 때만).

### 3.6 고객·공용 뷰
- `DevReviewView.vue`: `versionLabel?: string` prop — 있으면 헤더 메타 줄 끝에 `· {{ versionLabel }}`. 
- `apps/develop/src/pages/RequestDetail.vue`: `reviewPublicSeq` 가 있으면 `version-label="v{seq} · {공개일 YYYY-MM-DD}"`(공개일은 기존 `review.publishedAt` 류 필드가 응답에 있으면 그것, 없으면 seq 만). 관리자 preview 탭도 작업본 seq 로 같은 라벨.

### 3.7 백필(`apps/api/scripts/backfill-develop-review-versions.ts`)
- 실행: `pnpm --filter api exec tsx --env-file=.env scripts/backfill-develop-review-versions.ts`. 의뢰마다 버전이 0개일 때만: 초안(`ai_draft`, jobId·createdAt=devReviewDraftAt) → 작업본(초안과 contentHash 다르면 `working`, author=devReviewEditedBy ?? 'system', createdAt=devReviewEditedAt) → 공개본(`published`, createdAt=devReviewPublishedAt, author=devReviewEditedBy ?? 'system'). seq 는 시각 순. 마지막에 처리 건수 출력. **로컬 DB 에 실제로 실행**하고 결과 수치를 보고.

### 3.8 하네스·문서
- `e2e-develop.mts`: (a) 작업본 PUT 뒤 목록에 `working` 1건·`current.workingSeq` 일치 (b) 같은 내용 PUT 두 번 → 버전 수 불변 (c) publish → `published` 추가·`current.publicSeq` (d) 다른 내용 PUT → working 추가 → `versions/:seq`(옛 판) 조회 200 → `restore` → 작업본 내용이 옛 판과 같고 `working` 버전 +1(parentSeq=옛 seq) (e) 없는 seq restore 404 (f) 고객 상세 `reviewPublicSeq` 가 publish 판 seq. cleanup 이 버전 행도 지우는지 확인(FK cascade 라 의뢰 삭제로 따라 지워져야 한다 — 잔여 0 확인 추가).
- `docs/DEVELOP_FLOW.md`: §6.2 "검토서 버전 원장" 신설(기록 3순간·중복 규칙·복원·비교 매칭 규칙·고객 라벨·구성도는 후속), §8 API 표에 라우트 추가, §11.1 갱신.

## 4. 검증(전부 그린이어야 보고)
```
pnpm --filter api exec prisma migrate deploy      (새 마이그레이션 1건만 적용돼야 한다 — 출력 확인)
pnpm --filter api exec prisma generate
pnpm --filter api exec tsx --env-file=.env scripts/backfill-develop-review-versions.ts
pnpm --filter @sp/api-contract typecheck && pnpm --filter @sp/utils typecheck && pnpm --filter @sp/utils test && pnpm --filter @sp/ui typecheck
pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test   (기존 lint 2건 bom-claims·pcb-claims 외 0)
pnpm --filter web typecheck && pnpm --filter web lint
pnpm --filter develop typecheck && pnpm --filter market typecheck
cd apps/api && npx tsx --env-file=.env ../../../ops/scripts/e2e-develop.mts run → cleanup
cd apps/api && npx tsx --env-file=.env ../../../ops/scripts/e2e-market.mts run → cleanup   (148/0 회귀)
```
- API 서버(3333)·Vite 가 떠 있으면 그대로 쓰고 끄지 말 것(사용자 것). 새 Prisma 모델을 쓰는 라우트는 **서버 재시작이 필요할 수 있다** — 떠 있는 서버가 tsx watch 라 스스로 다시 뜨는지 확인하고, 아니면 보고서에 "재시작 필요"라고 적을 것(직접 끄지 말 것). 하네스가 새 라우트 404 를 내면 그 이유다.
- 브라우저 확인은 감사자(Fable) 몫. 대신 버전 탭·비교 화면의 구조를 보고서에 글로 설명.

## 5. 보고 형식
변경 파일 목록 · 설계에서 벗어난 점(이유) · 검증 원문 숫자(migrate deploy 출력·백필 건수·테스트 수·e2e PASS/FAIL) · 남은 것. 커밋 금지.
