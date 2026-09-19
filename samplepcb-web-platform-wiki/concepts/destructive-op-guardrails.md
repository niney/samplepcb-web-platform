---
concept: 파괴 작업 가드레일 (Destructive Op Guardrails)
last_compiled: 2026-09-19
topics_connected: [infrastructure, sp-node-api, gnuboard-integration, partner-tracks, sp-vue-web, sp-develop-web]
status: active
---

# 파괴 작업 가드레일 (Destructive Op Guardrails)

## Pattern
데이터를 지우는 모든 경로가 같은 계단을 밟는다:

1. **미리보기가 기본** — 아무 플래그 없이 실행하면 무엇이 지워지는지만 보여준다.
2. **명시 플래그로만 실행** — `--yes` + `--confirm-database <DB명>` 처럼 **대상을 손으로 적어야** 한다.
3. **실행 전 전체 백업 + SHA-256 검증** — 검증에 성공한 뒤에야 첫 행이 지워진다.
4. **분류하지 못한 대상은 삭제 대신 중단** — fail-closed. "모르면 지운다"가 아니라 "모르면 멈춘다".
5. **복원 직전에도 다시 백업** — 되돌리는 행위 자체가 파괴적이므로.

앱 레벨에서도 같은 태도가 세 형태로 나타난다. **가드는 전진만 막고 정리 경로를 반드시 남긴다**(잠김→정리→열림). **강제 삭제는 막는 대신 대가를 끝까지 보여준다**. **프리뷰와 실행은 같은 함수를 쓴다**(둘이 갈라지면 프리뷰가 거짓말을 한다).

확인 UI 의 형태는 [no-native-dialogs](no-native-dialogs.md)가 맡고, 업무 데이터의 시점 보존인 [snapshot-freeze](snapshot-freeze.md)와는 결이 다르다 — 이쪽은 **운영 안전장치**다.

## Instances
- **2026-09-16** in [infrastructure](../topics/infrastructure.md) / [sp-node-api](../topics/sp-node-api.md): **`migrate:reset-data` 가 다섯 계단의 완성형** — 기본 미리보기, `-- --yes --confirm-database samplepcb` 필수, 전체 백업+SHA-256 **검증 성공 뒤에만** 업무 행 삭제, 보존 정책 정본은 파일 하나 `reset-data-policy.ts`(설정·`_prisma_migrations`·고정 결제 상품 7종 부분 보존), **분류되지 않은 테이블은 삭제하지 않고 중단**, 결과는 `reset-report.json`. 유지보수 진입도 절차다 — `centrafab-main` 을 **503 서버 블록으로 잠시 교체**(원본은 `mktemp -d` 보관) + `systemctl stop sp-api`. 기존 `migrate:wipe` 는 거래 일부만 지워 "대체 수단이 아님"을 문서가 못박는다
- **2026-09-11** in [infrastructure](../topics/infrastructure.md): **원복점을 코드로 강제** — `deploy.sh` 의 DB 단계가 `db:prepare --always-backup`, 로컬 `pnpm dev` 도 미적용 migration 앞에서 같은 함수를 돈다(MySQL advisory lock `samplepcb-schema-<DB>` 로 동시 실행 직렬화). 백업은 리포 **밖 형제 디렉터리** `samplepcb-db-backups/`에 `database.sql.gz`+`manifest.json`(SHA-256·테이블 목록, 비밀번호 없음). 복원 `db:snapshot restore … --confirm-database` 는 **복원 직전 상태를 또 백업**(`before-restore`)하고, DB 를 바꾸기 **전에** `max_allowed_packet` 을 검사해 모자라면 중단한다
- **2026-09-11** in [infrastructure](../topics/infrastructure.md) / [sp-develop-web](../topics/sp-develop-web.md): 운영 프로토타입 정리 `prod-develop-cleanup.sh` — dry-run → `--check` 가 `"work":true` 일 때만, **스냅샷 먼저**(`before-develop-g-rollback`) 뜨고 G 테이블 3개를 FK 순서로. 되돌릴 지점은 태그 `proto-gc-coexist-20260910` + 그 스냅샷 둘. 끝에 검증 4종(`/api/health` 200 · 옛 경로 404 · 새 경로 401 · 유닛 상태)
- **2026-09-09** in [infrastructure](../topics/infrastructure.md) / [gnuboard-integration](../topics/gnuboard-integration.md): 로컬 MariaDB 시스템 테이블 손상 복구가 같은 태도를 보인다 — `aria_chk` 는 **실행 중인 서버 파일에 쓰지 않고**, 복제본(3341, read_only)에서 덤프 2.1GB 를 떠 새 데이터 디렉터리에 적재해 **296 테이블·1,613,377행 체크섬을 맞춘 뒤에야** 데이터 디렉터리를 통째 교체(구본은 `data-before-recovery-…` 보관). `innodb_force_recovery` 를 남기지 않았다
- **2026-08-10~11** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): **PCB 가드 6종의 "잠김→정리→열림" 순환** — `PO_ISSUED`(→발주 취소) · `RFQ_NOT_SELECTED`(→선정) · `HAS_REMITTANCE`(→원장 삭제, leaf-first) · `IN_SHIPMENT`(→박스에서 detach) · `DOC_LOCKED`(→되돌리기) · `RECEIVE_REQUIRED`(→입고 확인). 어느 가드도 막다른 골목이 아니고 출구가 명시돼 있으며, **검사 순서가 곧 명세**다(발주 취소는 `NOT_ISSUED` 를 `IN_SHIPMENT` 보다 먼저 본다). `ORDER_CANCELED` 는 전진만 막고 정리(revert·detach·취소)는 연다
- **2026-08-06** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): **관리자 재량 삭제(D14) — 막기에서 보여주기로.** `forceDeleteAll` 체크 하나로 `PAID_ORDER`·`PO_ISSUED`·`SHIPMENT_EXISTS`·`SHARED_ORDER` 전부 해제되지만, `blockReasons` 는 사라지지 않고 모달과 감사 스냅샷(`sp_delete_audit`)에 그대로 실린다. 코드 주석이 규율을 직접 말한다 — *"판정의 역할은 '막기'에서 '무엇을 각오하는지 건별로 보여주기'로 옮겨갔다"*. 다만 고객 경로의 `PARTNER_TRACK_ACTIVE` 는 불변
- **2026-08-02 ~ 08-06** in [sp-node-api](../topics/sp-node-api.md) / [partner-tracks](../topics/partner-tracks.md): **프리뷰와 실행이 같은 함수** — Case 영구 삭제는 프리뷰 SHA-256 토큰을 발급하고 실행 때 재조회해 어긋나면 `STALE_PREVIEW` 409. 판정 코어(`pcb-case-delete.ts`) 헤더가 이유를 적는다: *"프리뷰에서만 판정하고 실행이 다시 세면 둘이 갈라진다 — BOM 삭제의 교훈"*
- **2026-07-24 · 상시** in [sp-node-api](../topics/sp-node-api.md) / [gnuboard-integration](../topics/gnuboard-integration.md): 삭제의 물리적 한계도 가드가 됐다 — 대량 cascade 삭제는 **무트랜잭션 청크**(P2028, 후보 스냅샷 1.7GB 가 배경) · TRUNCATE 는 트랜잭션으로 안 돌아오므로 실패 시 자동 백업 복원에 기댄다 · 그리고 최상위 금기, **공유 DB 라 `prisma migrate reset`/`migrate dev` 영구 금지**(sp_* 가 g5_* 와 동거 — reset 은 그누보드 전체를 드랍한다)

## What This Means
규칙은 한 문장이다 — **되돌릴 수 있게 만들고, 되돌릴 수 없으면 멈춘다.**

새 파괴 스크립트는 다섯 계단(미리보기 기본 · 명시 플래그 · 검증된 전체 백업 · 미분류 중단 · 복원 전 재백업)을 **전부 갖추기 전에는 운영에 올리지 않는다**. 앱 안의 삭제·취소 기능은 세 규율을 따른다: 가드마다 **출구를 명시**하고, 강제 해제는 **대가를 전부 보여준 뒤** 감사 원장에 남기며, 프리뷰와 실행은 **같은 코드**를 돈다.

운영자가 알아야 할 대가도 분명하다:
- ⚠ **DB 원복은 전체를 되돌린다** — 회원·주문·`_prisma_migrations` 까지. 결제사 실결제와 이미 나간 메일은 취소되지 않는다. 복원 도구는 쓰기 서비스를 멈춰 주지 않으므로 **먼저 API·PHP 를 멈춰야** 한다. 스냅샷의 코드 ref 는 *배포 시작 시점 HEAD* 라 복원할 코드는 실제 이전 배포 버전으로 고른다.
- ⚠ **스크립트가 만든 원장을 손으로 지우지 말 것** — `reset-data` 가 마이그레이션 원장을 백업 폴더로 보관·제거한다. 추측 삭제는 재이관을 망가뜨린다.
- ⚠ 가드가 **등록돼야만 지켜지는 종류**도 있다 — 그누보드 코어 최소 수정 가드는 7파일 중 5건만 등록돼 있고, 그마저 실 subtree pull 로 검증된 적이 없다([core-nonmodification](core-nonmodification.md)·[exception-ledger](exception-ledger.md)).

## Sources
- [infrastructure](../topics/infrastructure.md)
- [sp-node-api](../topics/sp-node-api.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [sp-develop-web](../topics/sp-develop-web.md)
