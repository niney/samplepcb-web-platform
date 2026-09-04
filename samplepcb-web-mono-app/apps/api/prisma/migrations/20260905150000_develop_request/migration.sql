-- 개발의뢰(sp-develop, docs/DEVELOP_FLOW.md §3) — 의뢰자 ↔ 샘플피씨비 직접 개발 용역. 마켓(sp_market_*)과 테이블 분리.
CREATE TABLE `sp_develop_request` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `mbId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `serviceAreas` JSON NOT NULL,
  `tools` JSON NULL,
  `description` TEXT NOT NULL,
  `answers` JSON NULL,
  `contactName` VARCHAR(100) NOT NULL,
  `contactCompany` VARCHAR(200) NULL,
  `contactPhone` VARCHAR(50) NOT NULL,
  `contactEmail` VARCHAR(191) NOT NULL,
  `contactHours` VARCHAR(100) NULL,
  `budgetRange` VARCHAR(20) NOT NULL,
  `ndaWanted` BOOLEAN NOT NULL DEFAULT false,
  `aiConsent` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(20) NOT NULL DEFAULT 'received',
  `assigneeMbId` VARCHAR(191) NULL,
  `internalMemo` TEXT NULL,
  `aiSupplement` TEXT NULL,
  `devReviewDraft` JSON NULL,
  `devReviewDraftAt` DATETIME(3) NULL,
  `devReviewDraftJobId` CHAR(36) NULL,
  `devReviewInputHash` CHAR(64) NULL,
  `devReview` JSON NULL,
  `devReviewEditedAt` DATETIME(3) NULL,
  `devReviewEditedBy` VARCHAR(191) NULL,
  `devReviewPublic` JSON NULL,
  `devReviewPublishedAt` DATETIME(3) NULL,
  `devDiagram` JSON NULL,
  `devDiagramHtml` MEDIUMTEXT NULL,
  `devDiagramSource` VARCHAR(10) NULL,
  `devDiagramPublicHtml` MEDIUMTEXT NULL,
  `devDiagramPublishedAt` DATETIME(3) NULL,
  `reviewDays` INTEGER NOT NULL DEFAULT 7,
  `startedAt` DATETIME(3) NULL,
  `deliveredAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelReason` VARCHAR(1000) NULL,
  `declinedReason` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `sp_develop_request_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `sp_develop_request_mbId_createdAt_idx`(`mbId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_develop_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `actorMbId` VARCHAR(191) NULL,
  `byAdmin` BOOLEAN NOT NULL DEFAULT false,
  `visibleToCustomer` BOOLEAN NOT NULL DEFAULT true,
  `title` VARCHAR(200) NOT NULL,
  `body` TEXT NULL,
  `payload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `sp_develop_event_requestId_createdAt_idx`(`requestId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_develop_quote` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `version` INTEGER NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'draft',
  `title` VARCHAR(200) NOT NULL,
  `vatMode` VARCHAR(10) NOT NULL DEFAULT 'separate',
  `supplyAmount` INTEGER NOT NULL DEFAULT 0,
  `vatAmount` INTEGER NOT NULL DEFAULT 0,
  `totalAmount` INTEGER NOT NULL DEFAULT 0,
  `durationDays` INTEGER NULL,
  `scheduleNote` TEXT NULL,
  `deliverables` JSON NULL,
  `exclusions` TEXT NULL,
  `terms` TEXT NOT NULL,
  `warrantyDays` INTEGER NULL,
  `reviewDays` INTEGER NOT NULL DEFAULT 7,
  `validUntil` VARCHAR(10) NOT NULL,
  `note` TEXT NULL,
  `internalNote` TEXT NULL,
  `sentAt` DATETIME(3) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `acceptedName` VARCHAR(100) NULL,
  `acceptedIp` VARCHAR(64) NULL,
  `declinedAt` DATETIME(3) NULL,
  `declineReason` VARCHAR(1000) NULL,
  `supersededById` BIGINT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_develop_quote_requestId_version_key`(`requestId`, `version`),
  INDEX `sp_develop_quote_requestId_status_idx`(`requestId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_develop_quote_item` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `seq` INTEGER NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `amount` INTEGER NOT NULL,
  `durationDays` INTEGER NULL,

  UNIQUE INDEX `sp_develop_quote_item_quoteId_seq_key`(`quoteId`, `seq`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_develop_milestone` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `requestId` BIGINT NOT NULL,
  `seq` INTEGER NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `ratioBp` INTEGER NULL,
  `amount` INTEGER NOT NULL,
  `trigger` VARCHAR(20) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'draft',
  `paymentKey` CHAR(36) NOT NULL,
  `ctId` BIGINT NULL,
  `paidOdId` VARCHAR(30) NULL,
  `paidAt` DATETIME(3) NULL,
  `paidBy` VARCHAR(10) NULL,
  `unlocksDeliverables` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_develop_milestone_paymentKey_key`(`paymentKey`),
  UNIQUE INDEX `sp_develop_milestone_quoteId_seq_key`(`quoteId`, `seq`),
  INDEX `sp_develop_milestone_requestId_status_idx`(`requestId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_develop_settings` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `defaultTerms` TEXT NOT NULL,
  `defaultExclusions` TEXT NOT NULL,
  `defaultWarrantyDays` INTEGER NOT NULL DEFAULT 180,
  `defaultReviewDays` INTEGER NOT NULL DEFAULT 7,
  `defaultValidDays` INTEGER NOT NULL DEFAULT 30,
  `defaultVatMode` VARCHAR(10) NOT NULL DEFAULT 'separate',
  `defaultMilestones` JSON NOT NULL,
  `notifyEmails` JSON NOT NULL,
  `aiAutoDraft` BOOLEAN NOT NULL DEFAULT true,
  `aiDiagramAutoDraft` BOOLEAN NOT NULL DEFAULT true,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_develop_event` ADD CONSTRAINT `sp_develop_event_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_develop_quote` ADD CONSTRAINT `sp_develop_quote_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_develop_quote_item` ADD CONSTRAINT `sp_develop_quote_item_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `sp_develop_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_develop_milestone` ADD CONSTRAINT `sp_develop_milestone_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `sp_develop_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_develop_milestone` ADD CONSTRAINT `sp_develop_milestone_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
