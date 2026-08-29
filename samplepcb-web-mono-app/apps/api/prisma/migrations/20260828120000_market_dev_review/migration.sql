-- AI 사전 검토서 (docs/AI_DEV_REVIEW.md §7) — additive only.
-- 옛 AI 컬럼(diagramHtml/diagramSpec/rocMd/postings/aiGenerationMeta/interviewAnswersSharedAt)은
-- 남긴다(코드는 읽지도 쓰지도 않음). 공유 DB 라 삭제 마이그레이션을 두지 않는 선례를 따른다.

ALTER TABLE `sp_market_project` ADD COLUMN `devReview` JSON NULL;

ALTER TABLE `sp_ai_usecase` ADD COLUMN `extraInstructions` TEXT NULL;

CREATE TABLE `sp_ai_job` (
  `id` CHAR(36) NOT NULL,
  `useCase` VARCHAR(100) NOT NULL,
  `mbId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `stage` VARCHAR(20) NULL,
  `model` VARCHAR(100) NOT NULL,
  `promptVersion` VARCHAR(100) NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `resultJson` MEDIUMTEXT NULL,
  `error` VARCHAR(100) NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `finishedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `sp_ai_job_owner_idx` (`mbId`, `startedAt`),
  INDEX `sp_ai_job_reuse_idx` (`useCase`, `mbId`, `model`, `promptVersion`, `inputHash`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
