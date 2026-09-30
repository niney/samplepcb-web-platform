-- Smart BOM 결제 후 부품 확인 요청(D43, docs/SMARTBOM_PARTNER_RFQ.md §6.39).
-- 결제 뒤 재고 소진·MOQ 증가처럼 고객 결과가 바뀌는 품목을 관리자가 지정해 선택지를 묻고,
-- 고객 선택을 적용·정산한다. 원 주문은 1건 그대로 두고 차액만 오간다(정산 원장).
-- 추가형 마이그레이션 — 기존 행·컬럼을 바꾸지 않는다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_bom_quote_item`
  ADD COLUMN `fulfillment` VARCHAR(16) NOT NULL DEFAULT 'normal',
  ADD COLUMN `fulfillmentOn` DATETIME(3) NULL;

CREATE TABLE `sp_bom_confirm_request` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `mbId` VARCHAR(60) NOT NULL,
  `odId` VARCHAR(64) NOT NULL,
  `ctId` INTEGER NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'requested',
  `settlementMode` VARCHAR(16) NOT NULL DEFAULT 'difference',
  `message` TEXT NULL,
  `dueOn` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `requestedBy` VARCHAR(191) NOT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `answeredAt` DATETIME(3) NULL,
  `answeredBy` VARCHAR(191) NULL,
  `answeredRole` VARCHAR(12) NULL,
  `answerChannel` VARCHAR(16) NULL,
  `customerNote` TEXT NULL,
  `resolvedAt` DATETIME(3) NULL,
  `canceledAt` DATETIME(3) NULL,
  `cancelReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `sp_bom_confirm_request_quoteId_requestedAt_idx`(`quoteId`, `requestedAt`),
  INDEX `sp_bom_confirm_request_mbId_status_idx`(`mbId`, `status`),
  INDEX `sp_bom_confirm_request_status_requestedAt_idx`(`status`, `requestedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_confirm_issue` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `quoteItemId` BIGINT NOT NULL,
  `sortOrder` INTEGER NOT NULL,
  `activeKey` VARCHAR(64) NULL,
  `issueType` VARCHAR(24) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `description` TEXT NOT NULL,
  `evidence` JSON NOT NULL,
  `options` JSON NOT NULL,
  `chosenCode` VARCHAR(4) NULL,
  `shipPreference` VARCHAR(16) NULL,
  `appliedAt` DATETIME(3) NULL,
  `appliedBy` VARCHAR(191) NULL,
  `applyNote` TEXT NULL,
  `followupCarrier` VARCHAR(40) NULL,
  `followupInvoice` VARCHAR(60) NULL,
  `followupShippedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_bom_confirm_issue_activeKey_key`(`activeKey`),
  INDEX `sp_bom_confirm_issue_requestId_idx`(`requestId`),
  INDEX `sp_bom_confirm_issue_quoteItemId_idx`(`quoteItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_confirm_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `issueId` BIGINT NULL,
  `action` VARCHAR(32) NOT NULL,
  `actorRole` VARCHAR(12) NOT NULL,
  `actorMbId` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `payload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `sp_bom_confirm_event_requestId_createdAt_idx`(`requestId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_settlement` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `mbId` VARCHAR(60) NOT NULL,
  `requestId` BIGINT NULL,
  `kind` VARCHAR(12) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `amount` INTEGER NOT NULL,
  `chargeKey` VARCHAR(32) NULL,
  `ctId` INTEGER NULL,
  `paidOdId` VARCHAR(64) NULL,
  `paidAt` DATETIME(3) NULL,
  `odId` VARCHAR(64) NULL,
  `targetCtId` INTEGER NULL,
  `reducedAt` DATETIME(3) NULL,
  `refundedAt` DATETIME(3) NULL,
  `note` TEXT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_bom_settlement_chargeKey_key`(`chargeKey`),
  INDEX `sp_bom_settlement_quoteId_idx`(`quoteId`),
  INDEX `sp_bom_settlement_requestId_idx`(`requestId`),
  INDEX `sp_bom_settlement_status_kind_idx`(`status`, `kind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_confirm_request`
  ADD CONSTRAINT `sp_bom_confirm_request_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_confirm_issue`
  ADD CONSTRAINT `sp_bom_confirm_issue_requestId_fkey`
    FOREIGN KEY (`requestId`) REFERENCES `sp_bom_confirm_request`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_confirm_event`
  ADD CONSTRAINT `sp_bom_confirm_event_requestId_fkey`
    FOREIGN KEY (`requestId`) REFERENCES `sp_bom_confirm_request`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
