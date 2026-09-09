# 개발(G)·개발(C) 공존 프로토타입

구현: 2026-09-09. 작업 브랜치: `prototype/develop-g-c`.
G 원본 `91a0ddfef`, C 원본 `67c70a183`(`origin/feat/develop-workflow-docs`)의 업무 화면과 규칙을 각각 유지한다.

## 바로 사용하기

기존처럼 `samplepcb-web-mono-app`에서 `pnpm dev`를 실행한다. 별도 nginx 경로나 기능용 환경변수는 추가하지 않는다.

| 기능 | 개발(G) | 개발(C) |
|---|---|---|
| 관리자 | `/app/admin/develop` | `/app/admin/develop-c` |
| 신규 의뢰 | `/develop/request` | `/develop/c/request` |
| 고객 내 의뢰 | `/develop/me` | `/develop/c/me` |
| 고객 상세 | `/develop/requests/:id` | `/develop/c/requests/:id` |
| API | `/api/develop`, `/api/admin/develop` | `/api/develop-c`, `/api/admin/develop-c` |

관리자 상단에 `통합 | PCB | BOM | 개발(G) | 개발(C)`가 함께 보인다. 각 진행현황의 **의뢰하기** 버튼은 해당 프로토타입의 고객 등록 화면을 연다. 등록한 로그인 계정이 의뢰인이며 관리자 등록도 기존 회원 인증을 그대로 사용한다.

기존 의뢰는 모두 G다. C 등록 화면에서 새 의뢰를 만들면 C로 고정된다. 같은 요구사항을 비교하려면 각 화면에서 별도 의뢰를 등록한다. 기존 의뢰를 C로 자동 전환하거나 결제·승인 이력을 복사하지 않는다.

## 분리 경계

- `sp_develop_prototype`은 의뢰 번호와 G/C 소속을 연결한다. 매핑이 없는 기존 의뢰는 G이며, C의 등록 트랜잭션은 의뢰와 소속을 함께 생성한다. 소속 변경 API는 제공하지 않는다.
- 관리자·고객 목록, G 업무 목록, C 신호·배지 집계는 서버에서 소속 조건을 적용한다. 제목·검색어로 구분하지 않는다.
- 의뢰뿐 아니라 견적 번호·결제 단계 번호·문서 번호·파일 번호만 받는 경로도 연결된 의뢰의 소속을 검사한다. 반대 프로토타입의 URL로 접근하면 404이며 기존 회원 소유권·관리자 권한 검사도 유지한다.
- 개발 업무 설정은 기존 `sp_develop_settings`의 **id=1(G), id=2(C)**에 독립적으로 저장한다. C 행이 없으면 코드 기본값을 사용하며 G의 사용자 설정을 덮어쓰지 않는다. 결제 알림과 자동 AI 초안도 해당 의뢰의 설정을 읽는다.
- 기존 회원·인증·파일 전송·결제 기반과 AI 접속/모델 설정은 공유한다. C의 문서 메일 초안은 별도 `develop.doc-mail` 유스케이스를 사용하며 통합 AI 설정에서 관리한다.
- 브라우저 쿼리 키, 고객 등록 임시저장, 관리자 옆 보기 설정을 분리한다. C용 계약은 `@sp/api-contract/develop-c`로 구분해 G의 목록·상세 계약을 덮어쓰지 않는다.
- 공용 결제/자동 검수 알림도 의뢰 소속에 맞는 고객·관리자 링크를 사용한다. C의 문서 메일·인쇄 경로는 C 상세로 연결된다.

## 코드 배치

| 영역 | C 구현 위치 |
|---|---|
| 관리자 화면 | `apps/web/src/pages/admin/AdminDevelopC*.vue`, `components/admin/develop-c/` |
| 관리자 상태/메뉴 | `admin/useAdminDevelopC.ts`, `admin/develop-c-menu.ts` |
| 고객 화면 | `apps/develop/src/c/`, `develop-c-routes.ts` |
| API | `routes/develop-c-requests.ts`, `routes/admin-develop-c-*.ts` |
| 문서·업무표 | `lib/develop-docs.ts`, `schemas/develop-docs.ts` |
| C 의뢰 계약 | `packages/api-contract/src/schemas/develop-c.ts`, `src/develop-c.ts` |
| 소속 보호 | `apps/api/src/lib/develop-prototype.ts` |

C의 공통 화면 조각도 별도 폴더에 두어 비교 기간 동안 G의 화면 변경이 C에 섞이지 않게 했다. 양쪽에서 공통 결제·AI·파일 기반을 변경할 때는 두 프로토타입의 회귀 검증을 함께 실행한다. C 원본 브랜치의 단계별 메뉴, 문서 8종, 견적 기반 계약서 보기, 변경요청 승인 시 추가 견적 초안 생성과 납품 회신 동작을 유지한다.

## DB 적용·원복

기존 G 테이블 2개에 더해 아래 migration을 적용한다. 기존 업무 테이블의 컬럼은 변경하지 않는다.

- `20260909120000_develop_workflow_docs`: C의 `sp_develop_document`, `sp_develop_task`.
- `20260910090000_develop_prototype_scope`: `sp_develop_prototype`.

현재 개발 DB는 전체 스냅샷을 확보한 뒤 적용했다. 적용 전 C 테이블·소속 테이블은 없었으며 기존 의뢰를 변경하지 않았다. 백업:
`D:/work/workspace_other/samplepcb-db-backups/2026-09-09T13-11-52-452Z-before-migration-7601aa`.

운영은 이 브랜치의 코드와 배포 스크립트를 먼저 받은 뒤 기존 `./deploy.sh 5`로 전체 배포한다. 자동 백업·미적용 migration·빌드 절차를 유지한다. C 원본 브랜치의 `down.sql`은 공존 코드에 포함하지 않았다. 전체 원복은 [DB 스냅샷과 원복](db-snapshot-rollback.md)을 따른다. 같은 DB 전체를 복원하므로 G/C 양쪽과 백업 이후 회원·주문도 함께 돌아간다.

커밋 후 로컬 PC에서 원격에 올린다.

```sh
git push -u origin prototype/develop-g-c
```

운영 서버에서 원복용 현재 커밋을 기록한 뒤 아래 순서로 실행한다. 기존 배포 스크립트를 먼저 실행하고 그 안의 pull만 기다리지 않는다. 처음부터 새 버전의 백업 절차를 사용해야 하기 때문이다.

```sh
cd /home/samplepcb/samplepcb-web-platform
git rev-parse HEAD  # 출력값을 이전 배포 버전으로 기록
git fetch origin
git switch prototype/develop-g-c
git pull --ff-only
./deploy.sh 5
```

이번 프로토타입 migration들만 미적용 상태라면 추가형 변경이므로 중단 질문에는 `N`을 선택할 수 있다. 운영 서버에는 MariaDB/MySQL 백업 클라이언트와 DB 백업 권한, 저장 공간이 필요하다. 백업 실패 시 migration 단계로 진행하지 않는다. 완료 후 관리자에서 G/C 메뉴를 확인하고 C 신규 의뢰는 `/develop/c/request`로 등록한다.

## 검증

- API 전체 단위: 1,043개 통과. 환경 의존 테스트 54개는 기본 실행에서 건너뜀.
- 격리 DB 통합: 기존 G 수행관리 15개 + G/C 분리 6개 + 실제 브라우저 여정 1개 = **22개 통과**.
- 실제 C 등록 API의 소속 저장, G/C 목록·배지·고객 목록 분리, 교차 조회/수정/승인/작업표/견적/결제/파일 차단을 검증했다.
- C 결제의 자동 착수, 변경요청의 추가 견적, 납품 완료 및 C 설정 변경이 G에 영향을 주지 않음을 확인했다.
- 관리자 메뉴 전환·C 문서 상세·C 설정·고객 G/C 목록·C 고객 회신·문서 인쇄·등록 화면·모바일을 브라우저로 확인했다. 페이지 오류 0, 관리자/고객 모바일 가로 넘침 없음.
- 브라우저는 통합 도메인의 실제 프런트를 사용하고 API는 별도 3344 테스트 DB의 시험 서버로 전달했다. 메일·파일 서버는 대역으로 처리해 실제 고객 발송/외부 업로드를 하지 않았다. 시험 데이터는 종료 후 제거했다.
- 실제 통합 API의 G/C 목록 및 G/C 설정 HTTP 200을 추가 확인했다. 전체 `pnpm -r typecheck`, 변경 파일 ESLint, 관리자·고객·API 빌드가 통과했다. C 문서의 순수 함수 테스트 6개도 통과했다. 증거는 `.tmp/develop-coexist/`와 `.tmp/coexist-lint-*.log`에 보관한다.

통합 여정 재실행은 격리 DB를 준비하고 API 디렉터리에서 `WORKFLOW_INTEGRATION=1`, `PROTOTYPE_BROWSER=1`을 지정하여 `vitest run --no-file-parallelism src/routes/develop-prototype.integration.test.ts src/routes/develop-workflow.integration.test.ts`로 실행한다. 이 두 변수는 검증 전용이며 일반 사용·배포에는 필요 없다.

Windows에서 이미 실행 중인 API가 Prisma DLL을 잠그면 generate의 파일 교체가 실패할 수 있다. 이번에는 API 자식 프로세스만 잠시 종료한 뒤 생성하고 기존 watch 프로세스로 재기동했다. DB·프런트 서버는 유지했으며 이후 일반 DB 준비 명령의 정상 종료도 확인했다.
