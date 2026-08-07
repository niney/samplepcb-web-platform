-- sp_mail_log 를 빠른 메일 전용 → 전 채널(email·alimtalk·sms) 공용 발송 원장으로 승격.
-- sp_delete_audit(20260806090000)와 같은 일반화 수순: 한 트랙에 묶인 키(quoteId)를
-- refType/refId 로 중립화한다(메일 제목 컬럼 subject 와의 충돌을 피해 subject* 명명은 안 씀).
-- ⚠ 배포 원자성: 구 코드가 quoteId·toEmail 을 참조하므로 이 마이그레이션은 코드와 함께 나간다.

-- 1) 새 축 추가(기존 행 backfill 을 위해 일단 DEFAULT 부여) + 정책 변경 컬럼.
ALTER TABLE `sp_mail_log`
  ADD COLUMN `kind` VARCHAR(32) NOT NULL DEFAULT 'quick_mail' AFTER `id`,
  ADD COLUMN `refType` VARCHAR(24) NOT NULL DEFAULT '' AFTER `kind`,
  ADD COLUMN `refId` VARCHAR(64) NOT NULL DEFAULT '' AFTER `refType`,
  ADD COLUMN `channel` VARCHAR(12) NOT NULL DEFAULT 'email' AFTER `refId`,
  ADD COLUMN `status` VARCHAR(12) NOT NULL DEFAULT 'sent' AFTER `channel`,
  ADD COLUMN `reason` VARCHAR(255) NULL AFTER `status`,
  ADD COLUMN `params` JSON NULL AFTER `body`,
  -- 수신처 일반화(이메일 또는 전화번호) — 자동 알림은 body 미보존이라 NULL 허용으로 완화,
  -- 트리거 주체는 시스템 발송(자동·매직링크)이 가능해져 NULL 허용.
  CHANGE COLUMN `toEmail` `recipient` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `body` TEXT NULL,
  MODIFY COLUMN `sentBy` VARCHAR(191) NULL;

-- 2) 기존 행 = 전부 빠른 메일 성공 기록 — 새 축 backfill.
UPDATE `sp_mail_log`
   SET `refType` = 'bom_quote',
       `refId` = COALESCE(CAST(`quoteId` AS CHAR), '')
 WHERE `refId` = '';

-- 3) 구 축 제거 + DEFAULT 회수(앱이 항상 명시 기록하도록) + 조회 인덱스.
ALTER TABLE `sp_mail_log`
  DROP INDEX `sp_mail_log_quoteId_idx`,
  DROP COLUMN `quoteId`,
  ALTER COLUMN `kind` DROP DEFAULT,
  ALTER COLUMN `refType` DROP DEFAULT,
  ALTER COLUMN `refId` DROP DEFAULT,
  ALTER COLUMN `channel` DROP DEFAULT,
  ALTER COLUMN `status` DROP DEFAULT;

CREATE INDEX `sp_mail_log_refType_refId_createdAt_idx`
  ON `sp_mail_log` (`refType`, `refId`, `createdAt`);
CREATE INDEX `sp_mail_log_createdAt_idx`
  ON `sp_mail_log` (`createdAt`);
