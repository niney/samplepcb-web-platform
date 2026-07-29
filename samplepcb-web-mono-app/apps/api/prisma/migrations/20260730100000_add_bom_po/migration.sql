-- 협력사 발주서 신설 (sp_bom_po*, D18, docs/SMARTBOM_PARTNER_RFQ.md §6.1)
-- 발주서 = 박제 문서(생성 시점 스냅샷·불변). Case × 협력사 1건, 결제 확인 후 발행.
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE)만 — `prisma migrate deploy` 로 적용.

-- CreateTable: sp_bom_po — 협력사 발주서 헤더
CREATE TABLE `sp_bom_po` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `partnerId` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'issued',
    `totalAmount` INTEGER NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'KRW',
    `memo` TEXT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_po_quoteId_partnerId_key`(`quoteId`, `partnerId`),
    INDEX `sp_bom_po_partnerId_status_idx`(`partnerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_bom_po_item — 발주 행(부품·수량·단가 스냅샷)
CREATE TABLE `sp_bom_po_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `poId` BIGINT NOT NULL,
    `quoteItemId` BIGINT NOT NULL,
    `rfqItemId` BIGINT NULL,
    `mpn` VARCHAR(191) NOT NULL,
    `manufacturerName` VARCHAR(191) NULL,
    `description` VARCHAR(1000) NULL,
    `qty` INTEGER NOT NULL,
    `unitPrice` DECIMAL(14, 4) NOT NULL,
    `lineTotal` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_bom_po_item_poId_idx`(`poId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_bom_po`
    ADD CONSTRAINT `sp_bom_po_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_po`
    ADD CONSTRAINT `sp_bom_po_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sp_bom_po_item`
    ADD CONSTRAINT `sp_bom_po_item_poId_fkey`
    FOREIGN KEY (`poId`) REFERENCES `sp_bom_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
