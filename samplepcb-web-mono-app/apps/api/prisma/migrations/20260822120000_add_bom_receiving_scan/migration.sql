-- 입고 스캔 원장(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) — 공급사 봉투 라벨(ECIA 2D) 스캔 1건 = 1행.
-- 패킹 리스트(D24)는 전량 합계 일치가 저장 조건이라 부분 입고를 담지 못해 별도 원장으로 둔다.
-- 추가 전용(additive) — 공유 DB(g5_* 동거)라 migrate dev/reset 금지, 수기 SQL + migrate deploy.
CREATE TABLE `sp_bom_receiving_scan` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `poItemId` BIGINT NULL,
    `poId` BIGINT NULL,
    `supplierCode` VARCHAR(32) NULL,
    `barcode` TEXT NOT NULL,
    `supplierSku` VARCHAR(191) NULL,
    `mpn` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `lotCode` VARCHAR(100) NULL,
    `dateCode` VARCHAR(100) NULL,
    `countryOfOrigin` VARCHAR(16) NULL,
    `supplierOrderNo` VARCHAR(64) NULL,
    `customerOrderNo` VARCHAR(64) NULL,
    `invoiceNo` VARCHAR(64) NULL,
    `note` VARCHAR(500) NULL,
    `scannedBy` VARCHAR(64) NOT NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voidedAt` DATETIME(3) NULL,

    INDEX `sp_bom_receiving_scan_poItemId_idx`(`poItemId`),
    INDEX `sp_bom_receiving_scan_poId_idx`(`poId`),
    INDEX `sp_bom_receiving_scan_scannedAt_idx`(`scannedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_bom_receiving_scan` ADD CONSTRAINT `sp_bom_receiving_scan_poItemId_fkey` FOREIGN KEY (`poItemId`) REFERENCES `sp_bom_po_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
