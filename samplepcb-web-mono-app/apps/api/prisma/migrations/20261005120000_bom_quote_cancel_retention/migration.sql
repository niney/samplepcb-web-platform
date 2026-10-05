-- Smart BOM 견적 취소 보존 기간(docs/BOM_QUOTE.md "취소와 보존 기간").
-- 취소된 견적은 아무 일도 하지 않는 기록으로 남고, 고객에게 고지한 날(purgeAfter)이 지나면
-- 자동 정리 배치가 관리자 강제 삭제와 같은 경로로 지운다.
-- 추가형 마이그레이션 — 기존 컬럼은 바꾸지 않는다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_bom_quote`
  ADD COLUMN `canceledAt` DATETIME(3) NULL,
  ADD COLUMN `purgeAfter` DATETIME(3) NULL;

-- 이미 취소된 견적: 취소 시각은 마지막 수정 시각으로 채운다(취소 뒤에는 쓰기가 없었다).
-- 삭제 예정일은 **이 마이그레이션을 적용한 날부터** 30일로 잡는다 — 고지를 받지 못한 고객의
-- 견적이 배포 직후 지워지지 않게 한다. Prisma 는 DATETIME 을 UTC 로 쓰므로 UTC_TIMESTAMP 를 쓴다.
UPDATE `sp_bom_quote`
   SET `canceledAt` = `updatedAt`,
       `purgeAfter` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
 WHERE `status` = 'canceled';
