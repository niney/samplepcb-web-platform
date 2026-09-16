# 운영 DB 초기화 후 레거시 재이관

대상은 Ubuntu 운영 서버의 `/home/samplepcb/samplepcb-web-platform`과 MariaDB `samplepcb`다. 개발 폴더·`samplepcb_dev`·`sp-api-dev`·`sp-engine-dev`는 대상이 아니다. 이 문서의 명령은 서버에서 직접 실행하는 절차이며, 코드 변경 과정에서 운영 DB에 실행한 명령이 아니다.

2026-09-16부터 `admin`도 레거시 정본으로 이관한다. 최초 이관은 설치 과정에서 이미 만들어진 admin의 회원 정보·비밀번호를 갱신하고 프로필·포인트를 함께 이관한다. 같은 레거시 비밀번호를 신규 코어가 재해시한 경우에는 새 해시를 보존한다. 증분 동기화도 admin을 기본 보호하지 않는다. `kpeter`와 `MIGRATE_PROTECTED_MB_IDS`에 명시한 계정의 기존 보호 정책은 유지한다.

## 초기화 범위

- **삭제**: 회원(admin 포함), 프로필, 소셜 연결·자동 로그인·관리권한·포인트·주소록, 주문·장바구니·견적·게시글·쿠폰, PCB·BOM·부품 카탈로그·재능마켓·개발의뢰·협력사 업무 데이터와 파일 메타·발송 이력·AI 작업 등 보존 목록 이외의 `g5_*`/`sp_*` 행.
- **보존**: 테이블·인덱스·FK 구조, `_prisma_migrations`, 사이트·쇼핑몰·사업자·결제·앱 설정, 게시판/그룹/1:1 문의 설정, 메뉴·고정 페이지·FAQ·팝업·배너·SEO, 상품 분류·배송비·쿠폰존·기획전 설정, AI 유스케이스·메일 템플릿, **마켓 수수료와 개발의뢰 기본 조건**.
- **부분 보존**: `g5_shop_item`의 PCB 4종·BOM·마켓·개발의뢰 **7개 고정 결제 상품**과 그 상품끼리의 기획전/연관상품 연결. 일반 상품은 삭제한다. 보존 상품의 판매수·후기수·평점과 게시판의 글/댓글 수·공지글 참조는 0/빈 값으로 초기화한다.
- **DB 밖**: PHP `data/`, 외부 파일 서버, 개발 DB, 공유 Elasticsearch는 변경하지 않는다. DB를 비워도 외부 파일이 삭제되지는 않는다. ES를 개발과 공유하므로 이 절차에 ES 초기화·재색인을 추가하지 않는다.
- 기존 고정 상품은 보존하고 누락된 것만 시드로 보충한다. 레거시가 이관하지 않는 BOM·마켓·개발의뢰 등 신규 기능 데이터는 복원되지 않는다. 배너 이미지 등 실제 파일은 보존한다.

이 절차는 스키마와 설정을 유지한 **업무 데이터 재이관**이다. 전용 명령은 **`pnpm migrate:reset-data`**이며 기본은 미리보기다. 실제 실행은 전체 백업과 SHA-256 검증에 성공한 뒤 진행한다. 보존 정책의 정본은 `apps/api/src/scripts/migrate/lib/reset-data-policy.ts`다. 분류하지 못한 테이블/설정은 삭제하지 않고 중단한다. DB 자체를 DROP하거나 `prisma migrate reset`을 실행하지 않는다. 기존 `migrate:wipe`는 거래 일부만 지우고 회원·게시판을 남기므로 이 절차의 대체 명령이 아니다.

## 1. 코드와 이관 환경 확인

이번 변경 파일을 운영 폴더에 반영한 다음 `samplepcb` 계정으로 실행한다. 원격에 아직 반영하지 않은 로컬 변경은 서버의 `git pull`만으로 내려오지 않는다.

`apps/api/package.json`과 `src/scripts/migrate/` 아래 새 초기화 명령(`reset-data.ts`, `lib/reset-data.ts`, `lib/reset-data-policy.ts`), 앞서 수정한 admin 이관 코드를 함께 반영한다. 명령은 TS 소스를 직접 실행한다. 기존 `.env.migration`의 비밀번호는 서버 값을 유지한다.

```bash
cd /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/api
pnpm install --frozen-lockfile
pnpm db:generate
```

`.env`는 현재 운영 앱, `.env.migration`은 이관 스크립트의 연결 설정이다. **두 파일 모두 타깃은 운영 `samplepcb`**인지 확인한다. `.env.migration`은 다음 형태다. 기존 파일을 example로 덮어쓰지 말고 필요한 값을 편집한다.

운영 PHP의 `samplepcb-web/data/dbconfig.php`도 `G5_MYSQL_DB='samplepcb'`여야 한다. 새 명령은 Node/이관의 네 URL을 검사하며 PHP 설정 파일을 자동 수정하지 않는다.

```dotenv
LEGACY_DATABASE_URL="mysql://레거시읽기계정:URL인코딩한비밀번호@레거시DB호스트:3306/레거시DB명"
DATABASE_URL="mysql://운영DB계정:URL인코딩한비밀번호@127.0.0.1:3306/samplepcb"
G5_DATABASE_URL="mysql://운영DB계정:URL인코딩한비밀번호@127.0.0.1:3306/samplepcb"
MIGRATE_PROTECTED_MB_IDS=
MIGRATE_LEGACY_DATA_DIR=
MIGRATE_LEGACY_FILES_DIR=
```

소스는 레거시 DB, 타깃은 `samplepcb`다. 비밀번호는 URL 인코딩한다. `MIGRATE_PROTECTED_MB_IDS`에 `admin`이 있으면 제거한다. 파일 미이관 정책을 유지하므로 레거시 파일 경로는 비워 둔다. 원본 레거시 DB의 테이블을 신규 DB에 직접 SQL import하는 방식은 사용하지 않는다. 주문·견적 모델 변환은 `migrate:run`이 담당한다.

레거시 최고관리자와 admin 존재를 읽기 전용으로 확인한다(비밀번호 해시 출력 없음).

```bash
/usr/bin/node --env-file=.env.migration --import tsx --input-type=module <<'JS'
import { legacySelect, closeLegacyPool } from './src/lib/legacy-db.ts';
try {
  console.log(await legacySelect('SELECT cf_admin FROM g5_config'));
  console.log(await legacySelect('SELECT mb_id, mb_level FROM g5_member WHERE mb_id = ?', ['admin']));
} finally {
  await closeLegacyPool();
}
JS

sudo mariadb samplepcb -e "SELECT cf_admin FROM g5_config;"
```

보존할 운영 `g5_config.cf_admin`이 레거시에서 이관될 회원 ID인지 확인한다. 이관은 `cf_admin` 자체를 변경하지 않는다. 최고관리자 ID 변경이 필요하면 현재 값을 기록해 두고, 아래 백업과 이관 후 검증 전에 의도한 **레거시 최고관리자 ID**로 맞춘다.

## 2. 운영 쓰기 중지

레거시는 일관된 덤프 DB를 소스로 사용하거나, 이관 시간 동안 레거시 사이트의 쓰기를 중지한다. 다음은 현재 대화에서 구성한 `centrafab-main` 운영 nginx 파일 기준이다. 다른 설정 파일을 활성화했다면 먼저 `sudo nginx -T`로 실제 경로를 확인한다.

```bash
umask 077
reimport_dir=$(mktemp -d /home/samplepcb/legacy-reimport-XXXXXX)
sudo cp /etc/nginx/sites-enabled/centrafab-main "$reimport_dir/centrafab-main.before"

sudo tee /etc/nginx/sites-enabled/centrafab-main >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name centrafab.co.kr www.centrafab.co.kr;
    add_header Retry-After 300 always;
    add_header Cache-Control "no-store" always;
    return 503;
}
NGINX

sudo nginx -t && sudo systemctl reload nginx
sudo systemctl stop sp-api
```

이미 처리 중이던 PHP 요청·배치·수동 이관/동기화와 외부에서 DB에 직접 쓰는 작업도 종료된 후 진행한다. 정기 동기화를 별도로 등록했다면 일시 중지한다. 공용 `php8.1-fpm`이나 개발 서비스를 통째로 중지할 필요는 없다. nginx의 유지보수 응답과 API 중지가 실제로 적용됐는지 확인한다.

```bash
curl -I https://centrafab.co.kr/
systemctl is-active sp-api
```

503 응답과 `sp-api`의 inactive 상태를 확인한다. 다음 초기화 명령이 자동으로 전체 백업을 만들고 검증하므로 별도 수동 백업 명령은 필수가 아니다.

## 3. 초기화 대상 확인·실행

운영 `apps/api` 디렉터리에서 먼저 미리본다.

```bash
pnpm migrate:reset-data
```

`초기화 대상: 127.0.0.1:3306/samplepcb`와 테이블별 **보존/초기화/일부 보존, 전체 행 수/삭제 행 수**를 확인한다. 이 단계는 DB에 쓰지 않는다. `.env`와 `.env.migration`의 두 DB URL 네 개가 모두 같은 호스트·포트·DB여야 하며, 레거시 DB 이름과도 달라야 한다. `localhost`와 `127.0.0.1`을 섞어 쓰면 같은 표기로 맞춘다(PHP `dbconfig.php`의 Host와는 별개다).

다음 명령은 운영 업무 데이터를 실제 삭제한다. **BOM·개발·마켓·회원 데이터까지 삭제하는 명령이 이것이다.**

```bash
pnpm migrate:reset-data -- --yes --confirm-database samplepcb
```

명령은 다음 순서로 동작한다.

1. 대상 DB 확인, DB 준비/초기화 작업 간 잠금 획득.
2. 테이블·보존 설정과 외부/보존 테이블의 FK, 활성 DB 예약 이벤트, 부분 삭제·카운터 갱신 때 실행될 트리거 검사. 범위 밖 데이터에 영향을 줄 수 있는 구조는 먼저 확인하도록 중단한다.
3. **`.env.migration`의 실제 타깃 전체 백업 → 파일 크기·SHA-256 검증**. 실패하면 데이터와 원장을 그대로 둔다.
4. 기존 이관 원장을 백업 폴더에 복사하고 활성 원장을 제거한다. 위치는 기존 이관 코드의 `resolveMigrateTmpDir()`를 그대로 사용하며 `MIGRATE_TMP_DIR`도 반영한다. 원장 경로를 수동 추측해 삭제하지 않는다.
5. 단일 DB 연결에서 FK 검사 설정을 일시 조정해 업무 행을 비우고 설정·고정 상품을 보존한다. 세션 설정은 종료 시 복원한다.
6. 모든 초기화 테이블의 0건, 보존 테이블의 행 수, 일반 상품 제거를 확인하고 백업 폴더의 `reset-report.json`에 완료/실패 결과를 저장한다.

백업에는 초기화 전 g5·sp 전체와 설정·마이그레이션 이력이 들어 있다. 출력되는 **`검증된 전체 백업:` 경로를 기록**한다. TRUNCATE는 트랜잭션으로 원복되지 않으므로 실패 시 그 백업으로 복원한다. [MariaDB TRUNCATE 설명](https://mariadb.com/docs/server/reference/sql-statements/table-statements/truncate-table)

초기화 성공 후 이관 전에 직접 0건을 확인할 수도 있다.

```bash
sudo mariadb samplepcb -e "
SELECT 'member' AS domain, COUNT(*) AS rows_left FROM g5_member
UNION ALL SELECT 'pcb', COUNT(*) FROM sp_order_spec
UNION ALL SELECT 'bom', COUNT(*) FROM sp_bom_quote
UNION ALL SELECT 'develop', COUNT(*) FROM sp_develop_request
UNION ALL SELECT 'market', COUNT(*) FROM sp_market_project;
"
```

오류가 나면 유지보수를 해제하거나 이관을 이어가지 말고 백업과 `reset-report.json`을 확인한다. 잠금은 이 초기화 명령과 DB 준비 명령 사이의 중복 실행을 막으며, 웹 요청·수동 SQL·기존 migrate:sync를 대신 중지하지 않는다.

## 4. 필수 시드와 이관

계속 운영 `apps/api` 디렉터리에서 실행한다. 원래 스키마와 `_prisma_migrations`를 보존했으므로 DB 재설치·Prisma reset은 하지 않는다.

```bash
pnpm exec tsx --env-file=.env.migration src/scripts/seed-template-items.ts
pnpm market:seed-anchor
pnpm develop:seed-anchor

pnpm migrate:gate
pnpm migrate:dry
pnpm migrate:run
```

각 명령이 성공한 다음 명령을 실행한다. 앵커 시드는 이미 있는 상품은 수정하지 않고 누락분만 만든다. `market:seed-anchor`·`develop:seed-anchor`는 운영 `.env`를 사용하며, 초기화 명령이 두 env의 타깃 일치를 확인한다. 사업자 설정까지 채우는 `db:seed-initial`을 반복 실행할 필요는 없다. 게이트 위반은 내용 확인 없이 `--allow-unknown`으로 넘기지 않는다.

1단계에서 최고관리자 ID 변경이 필요하다고 확인한 경우 이 시점에 `g5_config.cf_admin`을 실제 이관된 레거시 최고관리자 ID로 맞춘다. 그 다음 검증한다.

```bash
pnpm migrate:verify
```

초기화 후 admin은 새 회원으로 삽입된다. 설치 admin이 남아 있는 다른 재이관 상황에서도 이제 레거시 값으로 갱신한다. `migrate:verify`는 admin의 이름·레벨·비밀번호 반영(같은 비밀번호 재해시 허용)과 `cf_admin` 회원 존재를 확인한다. 비밀번호 해시는 검증 결과에 출력하지 않는다. 프로필·포인트·권한·주소록은 회원 phase에서 함께 처리한다.

파일은 기존 결정대로 이관하지 않는다. 레거시 거버·첨부 파일까지 옮기는 작업은 별도 절차다. 레거시가 다시 쓰기를 시작했다면 실제 전환 직전에 쓰기를 멈추고 아래 최종 동기화 후 다시 검증한다.

```bash
pnpm migrate:sync -- --final
pnpm migrate:verify
```

## 5. 운영 재개

```bash
sudo mariadb samplepcb -e "SELECT c.cf_admin, m.mb_id, m.mb_level FROM g5_config c LEFT JOIN g5_member m ON m.mb_id=c.cf_admin;"
sudo systemctl start sp-api
curl -fsS --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:3333/api/health

sudo cp "$reimport_dir/centrafab-main.before" /etc/nginx/sites-enabled/centrafab-main
sudo nginx -t && sudo systemctl reload nginx
```

API health는 DB 정합성을 검증하지 않으므로 앞 단계의 verify가 먼저 통과해야 한다. 브라우저에서 **레거시 admin 비밀번호**로 로그인해 `/adm/`, `/app/admin`, 회원·주문·견적·게시판을 확인한다. 유지보수 중 파일 세션이 남아 있을 수 있으므로 기존 로그인 세션 대신 로그아웃 후 다시 로그인해 확인한다.

## 원복

실패 시 운영 유지보수 상태와 API 중지를 유지한다. 저장한 **운영 DB 백업 폴더**로 원복한다. 이 명령은 개발 DB 백업에 사용하지 않는다.

```bash
pnpm db:snapshot restore /home/samplepcb/samplepcb-db-backups/실제로출력된백업폴더 --confirm-database samplepcb
```

복원은 현재 `.env`의 DB와 백업 DB 이름이 맞는지 확인하고 복원 직전 상태도 백업한다. 초기화 이전 상태로 돌아간 뒤 원장을 보관했다면 그 파일도 기존 위치로 복사하고, nginx 원본 복원·검사와 API 재기동 후 확인한다. 파일 서버와 공유 ES에는 이 절차로 변경을 가하지 않는다.

## 구현 검증

- 이관 관련 87개 테스트 통과(초기화 정책 9개, 격리 MariaDB 통합 12개 포함).
- MyISAM·InnoDB와 BOM FK를 가진 임시 DB에서 모든 업무 데이터 0건, 설정 값과 고정 상품 7개 보존을 확인했다. 게시판·상품 집계도 초기화했다.
- 백업 실패·해시 검증 실패·잠금 경합·설정 누락·분류 누락·외부/보존 FK·활성 이벤트·영향 있는 트리거는 삭제 전에 중단했다.
- 백업 뒤 외부 DDL이 끼어든 부분 실패를 재현하고, 자동 백업으로 회원·BOM·개발의뢰·상품을 복구했다. 원본/개발 역할의 별도 테스트 DB는 유지됐다.
- API 타입 검사·변경 파일 ESLint·CLI 도움말·안내서 Bash 문법 검사 통과. 테스트가 생성한 임시 DB는 모두 정리했다. 운영 DB에서는 실행하지 않았다.
