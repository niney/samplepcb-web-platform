-- 3차 물류 — 경량 선적 (sp_bom_shipment, D21, docs/SMARTBOM_PARTNER_RFQ.md §6.4)
-- 1차는 발주서당 1건(poId UNIQUE). 발주 스키마 무참조(D13) — 부분 입고·선적 그룹은
-- UNIQUE 해제/그룹 컬럼 추가로 발주서 무변경 확장. 공유 DB 관례: 추가 전용(CREATE)만.

CREATE TABLE `sp_bom_shipment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `poId` BIGINT NOT NULL,
    `quoteId` BIGINT NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'international',
    `status` VARCHAR(20) NOT NULL,
    `carrier` VARCHAR(50) NULL,
    `trackingNumber` VARCHAR(100) NULL,
    `trackingUrl` VARCHAR(500) NULL,
    `shippedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `receivedNote` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_shipment_poId_key`(`poId`),
    INDEX `sp_bom_shipment_quoteId_idx`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_bom_shipment`
    ADD CONSTRAINT `sp_bom_shipment_poId_fkey`
    FOREIGN KEY (`poId`) REFERENCES `sp_bom_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
