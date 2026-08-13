-- PCB Case QR: 합배송 박스 안 PO(견적/주문 건)마다 QR 1개 + append-only 이력.
-- BOM 부품 포장과 달리 PCB는 수량 분할·LOT/DATE CODE·창고 출고 상태를 만들지 않는다.

CREATE TABLE `sp_pcb_package` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shipmentId` BIGINT NOT NULL,
  `poId` BIGINT NOT NULL,
  `token` CHAR(64) NOT NULL,
  `labelCode` VARCHAR(24) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'prepared',
  `printedAt` DATETIME(3) NULL,
  `receivedAt` DATETIME(3) NULL,
  `voidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sp_pcb_package_token_key` (`token`),
  UNIQUE INDEX `sp_pcb_package_labelCode_key` (`labelCode`),
  UNIQUE INDEX `sp_pcb_package_shipmentId_poId_key` (`shipmentId`, `poId`),
  INDEX `sp_pcb_package_poId_status_idx` (`poId`, `status`),
  INDEX `sp_pcb_package_shipmentId_status_idx` (`shipmentId`, `status`),
  CONSTRAINT `sp_pcb_package_shipmentId_fkey` FOREIGN KEY (`shipmentId`)
    REFERENCES `sp_pcb_shipment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `sp_pcb_package_poId_fkey` FOREIGN KEY (`poId`)
    REFERENCES `sp_pcb_po` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_pcb_package_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `packageId` BIGINT NOT NULL,
  `eventType` VARCHAR(16) NOT NULL,
  `actorType` VARCHAR(16) NOT NULL,
  `actorMbId` VARCHAR(191) NULL,
  `fromStatus` VARCHAR(16) NULL,
  `toStatus` VARCHAR(16) NULL,
  `note` TEXT NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `sp_pcb_package_event_packageId_occurredAt_idx` (`packageId`, `occurredAt`),
  CONSTRAINT `sp_pcb_package_event_packageId_fkey` FOREIGN KEY (`packageId`)
    REFERENCES `sp_pcb_package` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
