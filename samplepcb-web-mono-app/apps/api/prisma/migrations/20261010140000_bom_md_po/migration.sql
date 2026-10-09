-- BOM 마스터딜러 하위 발주(docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개 — 발주 단계").
-- 마스터딜러가 샘플피씨비에게서 받은 발주서(sp_bom_po)의 품목 가운데 하위 협력사 회신으로
-- 견적한 것을 그 하위에 다시 발주한다. 샘플피씨비의 발주 원장(입고·검수·선적 묶음·고객 진행)과
-- 섞지 않으려고 따로 둔다 — 하위 발주는 마스터딜러의 문서다.
-- 추가형 마이그레이션 — 기존 테이블은 건드리지 않는다(공유 DB, migrate reset 금지).

-- CreateTable: sp_bom_md_po — 하위 발주서(상위 발주서 × 하위 협력사 1건)
CREATE TABLE `sp_bom_md_po` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `poId` BIGINT NOT NULL,
    `quoteId` BIGINT NOT NULL,
    `parentPartnerId` BIGINT NOT NULL,
    `partnerId` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'issued',
    `currency` VARCHAR(8) NOT NULL,
    `totalAmount` DECIMAL(15, 2) NOT NULL,
    `memo` TEXT NULL,
    `carrier` VARCHAR(100) NULL,
    `trackingNo` VARCHAR(100) NULL,
    `issuedBy` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,
    `shippedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_md_po_poId_partnerId_key`(`poId`, `partnerId`),
    INDEX `sp_bom_md_po_partnerId_status_idx`(`partnerId`, `status`),
    INDEX `sp_bom_md_po_parentPartnerId_status_idx`(`parentPartnerId`, `status`),
    INDEX `sp_bom_md_po_quoteId_idx`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_bom_md_po_item — 하위 발주 품목(상위 발주 품목 하나는 하위 발주 한 건에만)
CREATE TABLE `sp_bom_md_po_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mdPoId` BIGINT NOT NULL,
    `poItemId` BIGINT NOT NULL,
    `quoteItemId` BIGINT NOT NULL,
    `mpn` VARCHAR(191) NOT NULL,
    `manufacturerName` VARCHAR(191) NULL,
    `description` VARCHAR(1000) NULL,
    `qty` INTEGER NOT NULL,
    `unitPrice` DECIMAL(14, 4) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,
    `moq` INTEGER NULL,
    `stock` INTEGER NULL,
    `dateCode` VARCHAR(100) NULL,
    `leadTime` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_bom_md_po_item_poItemId_key`(`poItemId`),
    INDEX `sp_bom_md_po_item_mdPoId_idx`(`mdPoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_md_po`
    ADD CONSTRAINT `sp_bom_md_po_poId_fkey`
    FOREIGN KEY (`poId`) REFERENCES `sp_bom_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_md_po`
    ADD CONSTRAINT `sp_bom_md_po_parentPartnerId_fkey`
    FOREIGN KEY (`parentPartnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sp_bom_md_po`
    ADD CONSTRAINT `sp_bom_md_po_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sp_bom_md_po_item`
    ADD CONSTRAINT `sp_bom_md_po_item_mdPoId_fkey`
    FOREIGN KEY (`mdPoId`) REFERENCES `sp_bom_md_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
