-- PCB 파트너 트랙 P3: 선적 sp_pcb_shipment(+묶기 조인) 신설 (2026-08-04)
-- 설계: docs/PCB_PARTNER_TRACK.md §5.3 — 레거시 sp_shipment(order_type 공용) 분리 교정(L4),
-- 발송 시점 묶기(BOM §6.10 모델). 상태·핑퐁은 BOM 선적 계약 코드사전 공유.
-- 공유 DB 관례: 추가 전용 — `prisma migrate deploy` 로만 적용.

CREATE TABLE `sp_pcb_shipment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `poId` BIGINT NOT NULL,
    `specId` BIGINT NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'international',
    `status` VARCHAR(20) NOT NULL,
    `receiverKind` VARCHAR(8) NOT NULL DEFAULT 'admin',
    `receiverPartnerId` BIGINT NULL,
    `destinationCountry` VARCHAR(2) NULL,
    `carrier` VARCHAR(50) NULL,
    `trackingNumber` VARCHAR(100) NULL,
    `trackingUrl` VARCHAR(500) NULL,
    `shipDate` DATETIME(3) NULL,
    `shippedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `receivedNote` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `shipQty` INTEGER NULL,
    `invoiceData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_pcb_shipment_poId_key`(`poId`),
    INDEX `sp_pcb_shipment_specId_idx`(`specId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_pcb_shipment_po` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shipmentId` BIGINT NOT NULL,
    `poId` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_pcb_shipment_po_poId_key`(`poId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_pcb_shipment_po` ADD CONSTRAINT `sp_pcb_shipment_po_shipmentId_fkey`
    FOREIGN KEY (`shipmentId`) REFERENCES `sp_pcb_shipment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
