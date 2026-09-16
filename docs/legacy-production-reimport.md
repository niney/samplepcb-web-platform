# 운영 DB 초기화 후 레거시 재이관

대상은 Ubuntu 운영 서버의 `/home/samplepcb/samplepcb-web-platform`과 MariaDB `samplepcb`다. 개발 폴더·`samplepcb_dev`·`sp-api-dev`·`sp-engine-dev`는 대상이 아니다. 이 문서의 명령은 서버에서 직접 실행하는 절차이며, 코드 변경 과정에서 운영 DB에 실행한 명령이 아니다.

2026-09-16부터 `admin`도 레거시 정본으로 이관한다. 최초 이관은 설치 과정에서 이미 만들어진 admin의 회원 정보·비밀번호를 갱신하고 프로필·포인트를 함께 이관한다. 같은 레거시 비밀번호를 신규 코어가 재해시한 경우에는 새 해시를 보존한다. 증분 동기화도 admin을 기본 보호하지 않는다. `kpeter`와 `MIGRATE_PROTECTED_MB_IDS`에 명시한 계정의 기존 보호 정책은 유지한다.

## 초기화 범위

- **삭제**: 회원(admin 포함), 프로필, 포인트, 주문, 장바구니, 견적, 게시글, 쿠폰, BOM·부품 카탈로그, 재능마켓·개발의뢰·협력사 업무 데이터 등 아래 보존 목록을 제외한 모든 테이블의 행.
- **보존**: 테이블·인덱스·FK 구조, `_prisma_migrations`, `g5_config`, `g5_shop_default`, `g5_menu`, `g5_content`, `sp_config`의 행. 사이트·쇼핑몰·메뉴·고정 페이지·앱 설정을 유지한다.
- **DB 밖**: PHP `data/`, 외부 파일 서버, 개발 DB, 공유 Elasticsearch는 변경하지 않는다. DB를 비워도 외부 파일이 삭제되지는 않는다. ES를 개발과 공유하므로 이 절차에 ES 초기화·재색인을 추가하지 않는다.
- 상품 앵커는 초기화 후 시드로 재생성한다. 레거시가 이관하지 않는 BOM·마켓·개발의뢰 등 신규 기능 데이터는 복원되지 않는다. 메인 배너도 필요하면 다시 등록한다.

이 절차는 스키마와 필수 설정을 유지한 **업무 데이터 재이관**이다. DB 자체를 DROP하거나 `prisma migrate reset`을 실행하지 않는다. 기존 `migrate:wipe`는 거래 일부만 지우고 회원·게시판을 남기므로 이 절차의 대체 명령이 아니다.

## 1. 코드와 이관 환경 확인

이번 변경 파일을 운영 폴더에 반영한 다음 `samplepcb` 계정으로 실행한다. 원격에 아직 반영하지 않은 로컬 변경은 서버의 `git pull`만으로 내려오지 않는다.

실행 코드 변경은 `apps/api/src/scripts/migrate/` 아래 `lib/member-policy.ts`(신규), `lib/sync/member-resync.ts`, `phases/01-members.ts`, `verify.ts` 네 파일이다. 이관 명령은 TS 소스를 직접 실행하므로 파일 반영이 필요하다. 기존 `.env.migration`의 비밀번호는 서버 값을 유지한다.

```bash
cd /home/samplepcb/samplepcb-web-platform/samplepcb-web-mono-app/apps/api
pnpm install --frozen-lockfile
```

`.env`는 현재 운영 앱, `.env.migration`은 이관 스크립트의 연결 설정이다. **두 파일 모두 타깃은 운영 `samplepcb`**인지 확인한다. `.env.migration`은 다음 형태다. 기존 파일을 example로 덮어쓰지 말고 필요한 값을 편집한다.

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

## 2. 운영 쓰기 중지와 백업

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

이미 처리 중이던 PHP 요청·배치와 외부에서 DB에 직접 쓰는 작업도 종료된 후 진행한다. 공용 `php8.1-fpm`이나 개발 서비스를 통째로 중지할 필요는 없다. nginx의 유지보수 응답과 API 중지가 실제로 적용됐는지 확인한다.

```bash
curl -I https://centrafab.co.kr/
systemctl is-active sp-api
pnpm db:snapshot backup --label before-legacy-reimport
```

503 응답과 `sp-api`의 inactive 상태를 확인한다. 백업 명령은 운영 `.env`의 `DATABASE_URL`을 사용한다. 출력된 백업 폴더를 기록하고 다음으로 검사한다.

```bash
pnpm db:snapshot inspect /home/samplepcb/samplepcb-db-backups/실제로출력된백업폴더
```

백업 실패·검사 오류가 있으면 다음 초기화 단계로 진행하지 않는다. 백업에는 g5·sp 전체, 설정, 마이그레이션 기록이 포함된다.

## 3. 초기화 SQL 생성·검토·실행

아래 SQL은 **`samplepcb`만** 대상으로 완전히 수식된 TRUNCATE 문을 생성한다. 먼저 파일로 생성해 삭제 대상 목록을 확인한다. 같은 SSH 세션에서 앞서 만든 `reimport_dir` 변수를 사용한다.

```bash
sudo mariadb --batch --skip-column-names samplepcb <<'SQL' > "$reimport_dir/reset-samplepcb.sql"
SELECT 'SET FOREIGN_KEY_CHECKS=0;';
SELECT CONCAT('TRUNCATE TABLE `samplepcb`.`', REPLACE(TABLE_NAME, '`', '``'), '`;')
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'samplepcb'
  AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_NAME NOT IN (
    '_prisma_migrations', 'g5_config', 'g5_shop_default',
    'g5_menu', 'g5_content', 'sp_config'
  )
ORDER BY TABLE_NAME;
SELECT 'SET FOREIGN_KEY_CHECKS=1;';
SQL

cat "$reimport_dir/reset-samplepcb.sql"
```

목록에 `g5_member`, 주문·견적 테이블 등이 포함되고 보존 테이블·개발 DB·레거시 DB가 없는지 확인한다. **다음 명령은 이 목록의 운영 데이터를 실제 삭제한다. TRUNCATE는 트랜잭션으로 원복되지 않으므로 앞 단계의 전체 백업이 필요하다.** [MariaDB TRUNCATE 설명](https://mariadb.com/docs/server/reference/sql-statements/table-statements/truncate-table)

```bash
sudo mariadb samplepcb < "$reimport_dir/reset-samplepcb.sql"
```

오류가 나면 서비스를 재개하거나 이관을 이어가지 말고 오류를 확인한다. 세션 종료 시 FK 설정은 해당 연결과 함께 사라진다. 부분 초기화 상태에서 정상 서비스로 재개하지 않는다.

이전 이관 원장을 별도로 보관한다. 완료 마커가 남아 있으면 주문 재이관이 스킵될 수 있다.

```bash
ledger_file=/home/samplepcb/samplepcb-web-platform/.tmp/migrate/ledger-samplepcb.json
if [ -f "$ledger_file" ]; then
  mv "$ledger_file" "$reimport_dir/ledger-samplepcb.before.json"
fi
```

## 4. 필수 시드와 이관

계속 운영 `apps/api` 디렉터리에서 실행한다. 원래 스키마와 `_prisma_migrations`를 보존했으므로 DB 재설치·Prisma reset은 하지 않는다.

```bash
pnpm db:generate
pnpm exec tsx --env-file=.env.migration src/scripts/seed-initial-data.ts
pnpm develop:seed-anchor

pnpm migrate:gate
pnpm migrate:dry
pnpm migrate:run
```

각 명령이 성공한 다음 명령을 실행한다. `develop:seed-anchor`는 운영 `.env`를 사용하므로 1단계에서 두 env의 타깃 일치를 확인해야 한다. 게이트 위반은 내용 확인 없이 `--allow-unknown`으로 넘기지 않는다.

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
