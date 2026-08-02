-- 빠른 메일(§6.15): 템플릿 + 발송 이력. 추가 전용.
CREATE TABLE `sp_mail_template` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_mail_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NULL,
  `toEmail` VARCHAR(255) NOT NULL,
  `toMbId` VARCHAR(191) NULL,
  `subject` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `attachments` JSON NULL,
  `sentBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `sp_mail_log_quoteId_idx` (`quoteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
