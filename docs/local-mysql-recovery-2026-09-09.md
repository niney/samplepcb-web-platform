# 로컬 MySQL 복구 기록 (2026-09-09)

대상: XAMPP MariaDB 10.4.32, `C:/xampp/mysql/data`, 포트 3306.
사용자 요청: 기존 sp-php·sp-node DB 접속 장애 처리. 운영 서버는 대상이 아니다.

## 확인한 원인

- PHP와 Node는 같은 `samplepcb@localhost` 계정·비밀번호를 사용했고 설정 파일도 변경되지 않았다.
- 계정 인증은 성공했으나 `samplepcb` DB 선택은 1044 접근 거부였다. 서버가 인식한 권한은 USAGE뿐이었다.
- root로 확인하니 `mysql.db`에는 기존 권한 레코드가 있었다. 권한을 삭제한 상황으로 단정했던 초기 진단을 정정했다.
- `mysqldump mysql`이 `mysql.db`에서 Aria 오류 176(`Read page with wrong checksum`)으로 실패했다.
- 오프라인 검사에서 시스템 테이블 **`mysql.db`·`mysql.procs_priv`**의 손상을 확인했다. `db.MAD`는 기대 크기 16,384바이트 대비 753,664바이트였고, `procs_priv.MAD`는 기대 크기 8,192바이트 대비 172,450바이트였다.
- InnoDB에는 페이지 LSN이 redo log보다 앞선다는 오류가 있었고, 재기동 중 `os0file.cc:6132`, `Failing assertion: slot`로 서버가 종료되기도 했다.
- 최초 물리 파일 손상 발생 원인은 확정하지 않았다. 권한 재부여만으로 해결할 문제가 아니었다.

## 보존과 복구

백업 디렉터리: `.tmp/db-recovery-20260909-190235/` (gitignore).

1. `my.ini`, 장애 로그와 전체 데이터 파일을 보존했다. 서버 중지 상태에서 `data-cold-copy/`를 추가로 확보했다.
2. 손상된 권한 테이블의 별도 복사본에서 `aria_chk --recover --backup`을 시험했다. `mysql.db` **7행**, `mysql.procs_priv` **0행**을 유지했고 재검사가 통과했다.
3. 원본이 중지된 상태에서 해당 두 테이블만 같은 방법으로 복구했다. 비밀번호 변경이나 새 권한 추가는 하지 않았다.
4. InnoDB 재기동 문제도 해결하기 위해 별도 작업 복제본을 3341에서 실행했다. 버퍼풀 기동 시 불러오기를 끈 **정상 모드(`innodb_force_recovery=0`)**에서 데이터 조회와 전체 SQL 덤프가 성공했다. 복제본은 read_only로 두었다.
5. `all-databases.sql` **2,146,103,558바이트**를 새 데이터 디렉터리의 3342 서버에 가져왔다. SQL 내보내기·가져오기 모두 종료 코드 0이다.
6. **296개 테이블 검사 모두 정상**. 업무 데이터와 권한 등 **275개 테이블·1,613,377행**의 행 수와 확장 체크섬이 복제본과 모두 일치했다. 스키마 객체 **297개**도 일치했다.
7. 기존 애플리케이션 계정으로 임시 테이블 읽기·쓰기, PHP mysqli, Prisma 조회를 검증했다. 임시 검증 서버를 정상 종료했다.
8. 새 데이터 파일 731개(3,142,401,486바이트)를 C 드라이브 준비 디렉터리에 복사하고 모든 파일의 SHA-256 일치를 확인했다.
9. 기존 디렉터리를 **`C:/xampp/mysql/data-before-recovery-20260909-190235`**로 보관하고, 검증된 디렉터리를 `C:/xampp/mysql/data`로 교체했다. 기존 `bin/my.ini`로 재기동했다.

`data-copy/`는 실행 중 초기 보존본, `data-cold-copy/`는 중지 후 보존본이다. `mysql-system-before.sql`은 최초 손상 때문에 중단된 **불완전한 덤프**이므로 복구용으로 사용하지 않는다. 성공한 전체 덤프는 `all-databases.sql`이다. SQL에는 회원 데이터와 인증 정보가 포함되므로 외부 공유하거나 Git에 넣지 않는다.

## 최종 검증

- 실제 3306, `samplepcb@localhost` 계정으로 DB 선택 및 임시 테이블 읽기·쓰기 성공.
- PHP 기존 설정 그대로 연결 성공. sp-php 홈페이지 HTTP **200**, MySQL 접속 오류 문구 없음.
- Prisma 조회 성공: 개발의뢰 **2건**, AI 작업 **90건**, 설정 **6건**.
- 회원 **6,387명**, 주문 **16,349건**, 개발의뢰 **2건** 확인.
- `mysql.db`·`mysql.procs_priv` 최종 CHECK TABLE 정상. samplepcb 계정의 DB별 권한 레코드 4개 확인.
- 새 기동 로그의 InnoDB LSN 불일치·assertion·ERROR 없음.
- `innodb_force_recovery=0`, `read_only=0`. 강제 복구 모드를 남기지 않았다.
- 실제 `C:/xampp/mysql/bin/my.ini`는 백업과 해시가 같으며 PHP/Node 접속 설정·비밀번호도 변경하지 않았다.
- 사용자가 실행한 Vue 개발 서버는 변경하지 않았다. 앞선 DB 오류로 sp-node의 watch 자식 프로세스가 종료되어 있었다면 사용자가 `pnpm dev`를 다시 실행하면 된다.

검증 원장: `restore-verification.json`, `staging-manifest.json`, `final-verification.json` (위 백업 디렉터리).

## 참고

- [MariaDB aria_chk](https://mariadb.com/docs/server/clients-and-utilities/aria-clients-and-utilities/aria_chk): 실행 중인 서버의 파일에 오프라인 도구를 사용하지 않는다.
- [MariaDB InnoDB 복구](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-troubleshooting/innodb-recovery-modes): 강제 복구는 데이터 추출 수단이며 손상 파일 자체를 고치지 않는다. 이번에는 강제 복구 모드 없이 내보내기에 성공했다.
- [MDEV-34758](https://jira.mariadb.org/browse/MDEV-34758): Windows 10.4 계열 I/O assertion 관련 참고 사례. 이번 최초 손상 원인으로 확정한 것은 아니다.
