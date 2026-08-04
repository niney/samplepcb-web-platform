-- PCB 파트너 트랙 P2: 협력사 발주서 sp_pcb_po 신설 (2026-08-04)
-- 설계: docs/PCB_PARTNER_TRACK.md §5.3 — 레거시 sp_pcb_partner_order_document 대응.
-- status 가 EQ·생산 5단계 진행 머신을 겸하고(서버 검증), 발주가는 생성 시점 박제.
-- 공유 DB 관례: 추가 전용 — `prisma migrate deploy` 로만 적용(migrate dev/reset 금지).

CREATE TABLE `sp_pcb_po` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `specId` BIGINT NOT NULL,
    `partnerId` BIGINT NOT NULL,
    `parentPartnerId` BIGINT NOT NULL DEFAULT 0,
    `reorderRound` INTEGER NOT NULL DEFAULT 0,
    `rfqId` BIGINT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'issued',
    `currency` VARCHAR(8) NOT NULL DEFAULT 'KRW',
    `priceOriginal` DECIMAL(15, 2) NOT NULL,
    `exchangeRate` DECIMAL(12, 6) NULL,
    `krwAmount` INTEGER NULL,
    `subCurrency` VARCHAR(8) NULL,
    `subPriceOriginal` DECIMAL(15, 2) NULL,
    `subExchangeRate` DECIMAL(12, 6) NULL,
    `destinationCountry` VARCHAR(2) NULL,
    `paymentTerms` VARCHAR(50) NULL,
    `remittedAt` DATETIME(3) NULL,
    `deliveryDate` DATETIME(3) NULL,
    `eqHistory` JSON NULL,
    `memo` TEXT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_pcb_po_specId_partnerId_parentPartnerId_reorderRound_key`(`specId`, `partnerId`, `parentPartnerId`, `reorderRound`),
    INDEX `sp_pcb_po_partnerId_status_idx`(`partnerId`, `status`),
    INDEX `sp_pcb_po_specId_idx`(`specId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_pcb_po` ADD CONSTRAINT `sp_pcb_po_specId_fkey`
    FOREIGN KEY (`specId`) REFERENCES `sp_order_spec`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_pcb_po` ADD CONSTRAINT `sp_pcb_po_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
