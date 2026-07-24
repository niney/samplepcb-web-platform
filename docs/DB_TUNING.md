# DB 튜닝 기록 — InnoDB buffer pool (2026-07-24)

BOM 견적 삭제 P2028 사건(docs/BOM_QUOTE.md 삭제 절)의 후속 조치. 운영 배포 시 이 문서를 참고한다.

## 배경 — 왜 필요했나

로컬 실측(2026-07-24, MariaDB 10.4.32 / XAMPP):

- `sp_bom_quote_candidate` **97,985행 / 1.73GB** (견적 44건 기준 — 견적당 평균 2,512행·최대 21,817행, payload 평균 10KB/행)
- buffer pool이 XAMPP 기본 **16MB**라 위 테이블의 삭제·조회가 전부 디스크 바운드로 전락
  → 전체 삭제 cascade 10.8초(견적당 ~250ms), 인터랙티브 트랜잭션 5초 초과 P2028의 공범

근본 원인은 후보 스냅샷 비대(아이템당 ~35개 후보 full payload 박제)이며 별도 과제.
buffer pool 증설은 스키마와 무관하게 즉효가 있는 인프라 레버다.

## 로컬 적용 내역

- 대상 파일: `c:\xampp\mysql\bin\my.ini` — mysqld가 `--defaults-file="c:\xampp\mysql\bin\my.ini"`로
  기동하므로 **bin 쪽이 실제 로드 파일**이다(`c:\xampp\mysql\data\my.ini`는 미사용 사본, 혼동 주의).
- 변경: `innodb_buffer_pool_size=16M` → `1G` (RAM 93.6GB 로컬 기준 부담 없음)
- 무중단 적용(재시작 불필요, MariaDB 10.2+ 온라인 리사이즈):

  ```sql
  SET GLOBAL innodb_buffer_pool_size = 1073741824;  -- SUPER 권한(root) 필요
  SHOW STATUS LIKE 'Innodb_buffer_pool_resize_status';  -- "Completed resizing ..." 확인
  ```

## 운영 배포 체크리스트

1. **현재값 확인**: `SHOW VARIABLES LIKE 'innodb_buffer_pool_size';`
   (운영이 이미 수 GB면 이 항목은 조치 불요 — 기본값 방치 여부만 확인)
2. **사이징 기준**:
   - DB 전용 서버: RAM의 50~70%
   - 웹과 동거(그누보드 PHP 등): 핫 데이터셋 기준 — 현재 `sp_bom_*` 합계 ~1.8GB에
     g5_* 를 더해 **최소 2G 권장**, 후보 스냅샷 다이어트 전까지는 BOM 데이터 성장에 비례해 재점검
3. **온라인 리사이즈 제약**: 새 값은 `innodb_buffer_pool_chunk_size(기본 128M) × instances`의
   배수여야 한다(1G/2G는 안전). 리사이즈 완료를 status로 확인 후 종료.
4. **my.ini(my.cnf) 영속화 병행**: SET GLOBAL은 재시작하면 증발한다. 설정 파일과 런타임 값을
   항상 같이 맞출 것.
5. **동반 권장(다음 재시작 창구에서)**: 로컬 `innodb_log_file_size=5M`도 기본값 그대로다.
   대량 삭제·카탈로그 인제스트에서 체크포인트 압박을 만드니 buffer pool의 25% 수준(256M~)을
   권장. 단 **재시작 필요 + 클린 셧다운 후 변경**(비정상 종료 상태에서 바꾸면 기동 실패 위험)이라
   이번엔 로컬에 적용하지 않았다.

## 관련 문서

- 삭제 P2028 사건·무트랜잭션 청크 설계: docs/BOM_QUOTE.md (BomHistory 삭제 절)
- 근본 과제(후보 스냅샷 다이어트): docs/BOM_QUOTE.md 후속 로드맵 참조
