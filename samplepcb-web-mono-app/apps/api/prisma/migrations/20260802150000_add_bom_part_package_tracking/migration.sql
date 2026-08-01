-- 선적 리스트·QR 추적(D24): 선적 리비전 + 발주 품목 투영 + 실물 포장 + append-only 이벤트.
ALTER TABLE `sp_bom_shipment`
  ADD COLUMN `packingRevision` INTEGER NOT NULL DEFAULT 0 AFTER `invoiceData`,
  ADD COLUMN `packingUpdatedAt` DATETIME(3) NULL AFTER `packingRevision`,
  ADD COLUMN `packingFinalizedAt` DATETIME(3) NULL AFTER `packingUpdatedAt`;

CREATE TABLE `sp_bom_shipment_item` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shipmentId` BIGINT NOT NULL,
  `poItemId` BIGINT NOT NULL,
  `partId` BIGINT NULL,
  `expectedQty` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sp_bom_shipment_item_shipmentId_poItemId_key` (`shipmentId`, `poItemId`),
  INDEX `sp_bom_shipment_item_poItemId_idx` (`poItemId`),
  INDEX `sp_bom_shipment_item_partId_idx` (`partId`),
  CONSTRAINT `sp_bom_shipment_item_shipmentId_fkey` FOREIGN KEY (`shipmentId`)
    REFERENCES `sp_bom_shipment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `sp_bom_shipment_item_poItemId_fkey` FOREIGN KEY (`poItemId`)
    REFERENCES `sp_bom_po_item` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_part_package` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shipmentItemId` BIGINT NOT NULL,
  `token` CHAR(64) NOT NULL,
  `labelCode` VARCHAR(24) NOT NULL,
  `packageNo` INTEGER NOT NULL,
  `quantity` INTEGER NOT NULL,
  `lotNo` VARCHAR(100) NULL,
  `dateCode` VARCHAR(100) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'prepared',
  `storageLocation` VARCHAR(191) NULL,
  `receivedAt` DATETIME(3) NULL,
  `inspectedAt` DATETIME(3) NULL,
  `issuedAt` DATETIME(3) NULL,
  `voidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sp_bom_part_package_token_key` (`token`),
  UNIQUE INDEX `sp_bom_part_package_labelCode_key` (`labelCode`),
  INDEX `sp_bom_part_package_shipmentItemId_status_idx` (`shipmentItemId`, `status`),
  INDEX `sp_bom_part_package_status_updatedAt_idx` (`status`, `updatedAt`),
  CONSTRAINT `sp_bom_part_package_shipmentItemId_fkey` FOREIGN KEY (`shipmentItemId`)
    REFERENCES `sp_bom_shipment_item` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_part_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `packageId` BIGINT NOT NULL,
  `eventType` VARCHAR(16) NOT NULL,
  `actorType` VARCHAR(16) NOT NULL,
  `actorMbId` VARCHAR(191) NULL,
  `fromStatus` VARCHAR(16) NULL,
  `toStatus` VARCHAR(16) NULL,
  `quantity` INTEGER NULL,
  `location` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `sp_bom_part_event_packageId_occurredAt_idx` (`packageId`, `occurredAt`),
  CONSTRAINT `sp_bom_part_event_packageId_fkey` FOREIGN KEY (`packageId`)
    REFERENCES `sp_bom_part_package` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
