-- 개발의뢰 검토서 버전 원장(docs/DEVELOP_FLOW.md §6.2) — 3층 컬럼(초안·작업본·공개본)은 현재 포인터, 이 표는 이력.
-- AI 초안 완성 · 관리자 저장 · 공개의 세 순간에 스냅샷 한 판. additive — 기존 컬럼 무변경.
CREATE TABLE `sp_develop_review_version` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `seq` INTEGER NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `review` JSON NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `parentSeq` INTEGER NULL,
  `author` VARCHAR(191) NOT NULL,
  `jobId` CHAR(36) NULL,
  `inputHash` CHAR(64) NULL,
  `note` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `sp_develop_review_version_requestId_seq_key`(`requestId`, `seq`),
  INDEX `sp_develop_review_version_requestId_kind_idx`(`requestId`, `kind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_develop_review_version` ADD CONSTRAINT `sp_develop_review_version_requestId_fkey`
  FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
