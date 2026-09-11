# 개발 프로토타입 정리 — G 제거·C 승격 (2026-09-10)

2026-09-09 `prototype/develop-g-c` 에서 **개발(G)**(수행관리, JSON 상태 한 통)과 **개발(C)**(문서 8종·업무표·단계별 워크큐)를 같은 로그인·DB 위에 나란히 두고 비교했다. 검토(채팅 기록)와 사용자 결정에 따라 **C 를 정본으로 승격하고 G 를 제거**했다. G 에서 가져올 규칙 7건은 먼저 C 에 이식했다(태그 `proto-gc-coexist-20260910` 의 마지막 커밋). 정본 업무 흐름은 [DEVELOP_FLOW.md](DEVELOP_FLOW.md) §13·§14.

## 경로·이름 되돌림

| 항목 | 공존 기간(C) | 승격 뒤(정본) |
|---|---|---|
| 관리자 화면 | `/app/admin/develop-c/*` | `/app/admin/develop/*` |
| 고객 화면 | `/develop/c/*` | `/develop/*` (옛 `/develop/c/*` 는 라우터 redirect) |
| 회원 API | `/api/develop-c/*` | `/api/develop/*` |
| 관리자 API | `/api/admin/develop-c/*` | `/api/admin/develop/*` |
| 모듈 라벨 | 개발(C) / 개발(G) | 개발 |
| 계약 | `@sp/api-contract/develop-c` | `@sp/api-contract`(`schemas/develop.ts`·`develop-docs.ts`) |
| 웹 코드 | `AdminDevelopC*.vue`·`components/admin/develop-c/`·`useAdminDevelopC.ts`·`develop-c-menu/navigation.ts`·`develop-c-ko/en.ts` | `AdminDevelop*.vue`·`components/admin/develop/`·`useAdminDevelop.ts`·`develop-menu/navigation.ts`·`develop-ko/en.ts` |
| 고객 앱 | `apps/develop/src/c/*` | `apps/develop/src/*` |
| API 코드 | `develop-c-requests.ts`·`admin-develop-c-*.ts`·`lib/develop-c.ts`·`develop-c-email.ts`·`develop-c-settings.ts` | `develop-requests.ts`·`admin-develop-*.ts`·`lib/develop.ts`·`develop-email.ts`·`develop-settings.ts`(단일 행 id=1) |
| 쿼리 키·저장 키 | `['admin','develop-c']`·`develop-c.admin.sideContent`·`sp-develop-c-request-draft` | `['admin','develop']`·`develop.admin.sideContent`·`sp-develop-request-draft` |

C 의뢰는 로컬·운영 모두 0건이어서 `/develop/c/…` 딥링크가 박힌 메일은 없다. 로컬 북마크용으로 고객 앱 라우터에 `/c/*` → `/*` redirect 만 남겼다.

## 지운 것(G 전용)

- API: `develop-requests.ts`(G)·`admin-develop-{requests,quotes,settings,workspace}.ts`·`develop-workflow.ts`·lib `develop.ts`(G)·`develop-email.ts`(G)·`develop-workflow*.ts`·`develop-workspace*.ts`·`develop-prototype.ts`·스크립트 `develop-g-smoke.ts`·`preview-develop-workflow.ts`·통합 테스트 2본(`develop-workflow`·`develop-prototype`)·`develop:g-smoke` 스크립트.
- 계약: `schemas/develop.ts`(G)·`develop-workflow.ts`·`develop-workspace.ts`·`src/develop-c.ts` 엔트리(C 스키마가 `schemas/develop.ts` 로 승격).
- `@sp/ui`: `DevelopWorkflowPanel`·`WorkDocumentView`·`WorkPlanView`.
- 관리자 웹: `AdminDevelop{Workspace,Requests,RequestDetail,Settings}.vue`(G)·`components/admin/develop/`(G 17개)·`useAdminDevelop.ts`(G)·`develop-navigation.ts`(G)·i18n `admin.develop.*`(G 블록)·`admin.menu.develop{Overview…Payments}`.
- 고객 앱: 루트 `pages/`·`layouts/`·`components/`·`composables/`·`lib/`·`api/`(G) — C 의 `c/` 트리가 루트로 올라왔다.
- e2e `develop-workflow.e2e.test.ts`, 문서 `develop-workflow-prototype.md`·`develop-g-smoke.md`·`develop-prototype-coexistence-review.md`.
- `local-g-smoke.ts` 는 파일서버·메일·g5 DB 의 **로컬 테스트 대역 가드**로 계속 쓰이므로 남기고, G 수행관리 체크포인트 함수와 소속 조회만 뺐다.

## DB — 정리 결과

**코드.** Prisma 스키마에서 `SpDevelopWorkflow`·`SpDevelopWorkflowAudit`·`SpDevelopPrototype` 모델과 `SpDevelopRequest` 의 두 관계를 지웠다. G 테이블을 만들던 마이그레이션 폴더 2개(`20260909120000_develop_workflow`·`20260910090000_develop_prototype_scope`)도 리포에서 뺐다 — 아직 적용하지 않은 DB(운영이 main 기준이면 그렇다)에는 죽은 테이블을 만들지 않고, 이미 적용된 DB 에서는 `migrate deploy` 가 폴더 없는 행을 무시한다(C 원본 문서에서 실측). C 테이블 마이그레이션 `20260909120000_develop_workflow_docs` 만 남아 운영 배포 때 적용된다. 설정은 C 가 쓰던 id=2 행 대신 사용자 설정이 든 **id=1 단일 행**(로컬은 id=2 가 없었다).

**로컬 dev DB(2026-09-10 완료).** 3테이블을 `D:/work/workspace_other/samplepcb-db-backups/2026-09-10T09-27-17-346Z-develop-g-tables/develop-g-tables.sql` 에 덤프한 뒤 `sp_develop_workflow_audit` → `sp_develop_workflow` → `sp_develop_prototype` 순으로 DROP 하고 `_prisma_migrations` 의 두 행을 지웠다. 앞서 G 스모크 픽스처(g_smoke 13건: audit 148·workflow 10·request 13)도 지웠다. 남은 것: admin 계정 시험 의뢰 3건(G workflow 행 2개는 테이블과 함께 사라짐), `sp_file` refType=sp_develop_workflow 3건과 파일서버 고아 파일(무해).

**운영.** 서버에서 `_prisma_migrations` 에 `20260909120000_develop_workflow`·`20260910090000_develop_prototype_scope` 행이 **없으면 할 일이 없다**(테이블이 만들어진 적이 없다). 있으면 위 로컬 절차와 같이 덤프 → DROP → 두 행 삭제를 수동 SQL 로 한다(`deploy.sh 2/5` 의 전체 스냅샷이 먼저 잡힌다). `sp_develop_workflow_audit` 가 `sp_develop_workflow` 에 Restrict FK 라 순서를 지킨다.

```sql
DROP TABLE IF EXISTS `sp_develop_workflow_audit`;
DROP TABLE IF EXISTS `sp_develop_workflow`;
DROP TABLE IF EXISTS `sp_develop_prototype`;
DELETE FROM `_prisma_migrations` WHERE migration_name IN ('20260909120000_develop_workflow', '20260910090000_develop_prototype_scope');
```

## 운영 정리 스크립트 (`ops/scripts/prod-develop-cleanup.sh`)

운영 서버에 파일을 올려 `bash prod-develop-cleanup.sh`(단계마다 물음) 또는 `--yes`(무인)로 돌린다. 순서와 동작:

1. **git** — `origin` 갱신 → `main` 으로 전환 → `git pull --ff-only` → **main 외 로컬 브랜치 전부 삭제**(`git branch -D`, `worktree prune`). 원격 프로토타입 브랜치(`prototype/develop-g-c`·`prototype/develop-workflow`·`feat/develop-workflow-docs`)는 기본 유지, `--delete-remote` 를 주면 같이 지운다(태그 `proto-gc-coexist-20260910` 은 남는다). 작업 트리에 미커밋 변경이 있으면 시작하지 않는다.
2. **DB** — `pnpm install` · `db:generate` 뒤 `apps/api/src/scripts/develop-g-rollback.ts`(`pnpm --filter api develop:g-rollback`)를 dry-run → `--yes`. G 테이블 3개(`sp_develop_workflow_audit` → `sp_develop_workflow` → `sp_develop_prototype`, FK 순서)·제거된 마이그레이션 2행·C 공존 설정 행 id=2 를 지우되, **먼저 기존 스냅샷 도구로 DB 전체 백업**(`samplepcb-db-backups/<시각>-before-develop-g-rollback-*`)을 남긴다. 셋 다 없으면 "할 일 없음"으로 지나간다(운영이 main 기준이었다면 이 경우다). `--skip-db` 로 건너뛸 수 있다.
3. **배포** — `printf 'N\n' | ./deploy.sh 5`(무중단). 남은 마이그레이션은 C 테이블 CREATE(`20260909120000_develop_workflow_docs`) 뿐이라 추가형이다. `--deploy-case N`·`--skip-deploy`.
4. **검증** — 상태 JSON(테이블·마이그레이션 행·설정 id=2 없음, docs 마이그레이션 적용), `/api/health` 200, 옛 `/api/admin/develop-c/requests` 404, 새 `/api/admin/develop/requests` 401, `sp-api`·`nginx`·`mariadb` 상태. 로그는 `~/develop-cleanup-<시각>.log`, 첫머리에 이전 배포 커밋을 적는다.

원복: 로그의 이전 커밋으로 `git checkout` + `./deploy.sh 5`, DB 는 위 스냅샷 복원([DB 스냅샷과 원복](db-snapshot-rollback.md)).

리허설(2026-09-10, 로컬): 덤프로 G 테이블·마이그레이션 2행·설정 id=2 를 되살린 뒤 `--check`(work:true) → dry-run → `--yes`(스냅샷 생성·DROP 3·행 2·설정 1 삭제) → `--check`(work:false) 통과. 셸 스크립트는 임시 클론에서 `--skip-db --skip-deploy --yes` 로 main 전환·ff·로컬 브랜치 3개 삭제·원격 유지를 확인했다(`systemctl`·`deploy.sh` 는 서버에서만 돈다).

**운영 실행(2026-09-11 17:30 KST, samplepcb@qn391-0398).** 운영 DB 에 G 테이블이 실제로 있었다(audit 10·workflow 1·prototype 1, 마이그레이션 2행, 설정 id=2 없음). 스냅샷 `samplepcb-db-backups/2026-09-11T08-31-12-706Z-before-develop-g-rollback-04038b` 뒤 DROP·행 삭제 → `work:false`, 로컬 브랜치 3개 삭제(feat/market-mvp·prototype/develop-g-c·prototype/develop-workflow, 원격은 유지), `deploy.sh 5` 완주(배포 전 스냅샷 `…before-deploy-1c71cf`), 서비스 5개 active. 스크립트의 마지막 curl 3줄은 `000000` 을 찍었는데 sp-api 재시작 직후 포트가 열리기 전에 돈 것이라 외부에서 재확인해 `https://centrafab.co.kr` 기준 `/api/health` 200·옛 `-c` 404·새 경로 401·`/develop/`·`/app/admin/develop` 200 을 확인했다. 스크립트는 이후 재시작 뒤 최대 30초 대기하도록 고쳤다. 공개 도메인은 centrafab.co.kr 이다(samplepcb.co.kr 은 다른 호스팅).

## 원복 지점

- 태그 `proto-gc-coexist-20260910` — G·C 공존 마지막 커밋(이식 7건 포함). 코드는 이 태그로, G 테이블은 위 덤프로 되돌린다(마이그레이션 폴더도 태그에 있다).
- 태그 `proto-c-original-20260910` — C 원본 브랜치(`feat/develop-workflow-docs`, 67c70a183) 마지막 커밋. main·공존 태그 어디에도 안 들어 있어 원격 브랜치를 지우기 전에 태그로 보존했다.
- 원격 프로토타입 브랜치 3개(`prototype/develop-g-c`·`prototype/develop-workflow`·`feat/develop-workflow-docs`)는 2026-09-11 삭제했다. main 은 2026-09-11 한 줄로 재작성했다 — 비교 과정 커밋 6개(G 구현·공존·스모크·이식·제거·폴더 정리)는 main 에서 커밋 `17a966dbe`(개발 정본 도입) 하나로 접었고, 세부 이력은 태그 `proto-gc-coexist-20260910` 이 붙들고 있다(G 원본 91a0ddfef 포함).

## 검증(2026-09-10)

- `pnpm -r typecheck` 통과 · API 단위 1,025 통과(G 테스트 제거로 1,047→1,025) · `@sp/utils` 183 · 변경 파일 ESLint 0(기존 오류 5파일 27건은 범위 밖).
- 로컬 dev API(3333) 정본 경로 실호출 스모크 16/16 통과(임시 스크립트, 픽스처·파일 삭제): 옛 `-c` 경로 404 · 설정·목록·상세 계약 파싱 · 옛 G 의뢰가 목록에 그대로 보임(소속 필터 제거) · ops 수납/미수/열기 대기/지연 · tasks stale 409·정상 200 번호 유지 · 문서 PATCH stale 409 · 청구 열기 → 고객 payable·nextAction=pay · 타인 403 · 비관리자 403.
- C 원본 브랜치의 API 하네스 `ops/scripts/e2e-develop.mts`(§13 문서·업무표·워크큐 신호 포함, 이 브랜치에는 §13 이전 판이 있었음)를 되살려 로컬 dev API 에 실행: **PASS 181 / FAIL 0**, cleanup 완료. 실행은 `apps/api` 에서 `node --env-file=.env --import tsx ../../../ops/scripts/e2e-develop.mts run|cleanup`.
- 로컬 dev DB 의 G 스모크 픽스처(g_smoke 13건: audit 148·workflow 10·request 13)는 지웠다. admin 계정의 시험 의뢰 3건과 그 workflow 2행은 남겨 두었다.
- 브라우저 화면 확인은 하지 않았다.
