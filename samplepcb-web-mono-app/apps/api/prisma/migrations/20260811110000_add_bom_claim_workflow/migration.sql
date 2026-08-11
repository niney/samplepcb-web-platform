-- Smart BOM 배송·완료 후 고객 클레임 워크플로우(D37).
-- 영카트 주문 상태와 조달 문서는 변경하지 않고, 접수 시점 주문·품목 스냅샷과
-- 관리자 상태 전이를 별도 append-only 원장으로 보존한다.

CREATE TABLE `sp_bom_claim` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `quoteTitle` VARCHAR(191) NOT NULL,
  `mbId` VARCHAR(60) NOT NULL,
  `odId` VARCHAR(64) NOT NULL,
  `ctId` INTEGER NOT NULL,
  `activeKey` VARCHAR(96) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `kind` VARCHAR(24) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `orderSnapshot` JSON NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `adminMbId` VARCHAR(191) NULL,
  `adminResponse` TEXT NULL,
  `resolutionKind` VARCHAR(24) NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewStartedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_bom_claim_activeKey_key`(`activeKey`),
  INDEX `sp_bom_claim_quoteId_submittedAt_idx`(`quoteId`, `submittedAt`),
  INDEX `sp_bom_claim_mbId_submittedAt_idx`(`mbId`, `submittedAt`),
  INDEX `sp_bom_claim_status_submittedAt_idx`(`status`, `submittedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_claim_item` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `claimId` BIGINT NOT NULL,
  `quoteItemId` BIGINT NOT NULL,
  `mpn` VARCHAR(191) NOT NULL,
  `manufacturerName` VARCHAR(191) NULL,
  `description` TEXT NULL,
  `orderedQty` INTEGER NOT NULL,
  `affectedQty` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `sp_bom_claim_item_claimId_quoteItemId_key`(`claimId`, `quoteItemId`),
  INDEX `sp_bom_claim_item_quoteItemId_idx`(`quoteItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_claim_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `claimId` BIGINT NOT NULL,
  `action` VARCHAR(24) NOT NULL,
  `actorRole` VARCHAR(12) NOT NULL,
  `actorMbId` VARCHAR(191) NOT NULL,
  `fromStatus` VARCHAR(16) NULL,
  `toStatus` VARCHAR(16) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `sp_bom_claim_event_claimId_createdAt_idx`(`claimId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_claim_item`
  ADD CONSTRAINT `sp_bom_claim_item_claimId_fkey`
    FOREIGN KEY (`claimId`) REFERENCES `sp_bom_claim`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_claim_event`
  ADD CONSTRAINT `sp_bom_claim_event_claimId_fkey`
    FOREIGN KEY (`claimId`) REFERENCES `sp_bom_claim`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
