-- PCB 파트너 트랙 P1: 협력사 견적행 sp_pcb_rfq 신설 + 협력사 입력통화 (2026-08-04)
-- 설계: docs/PCB_PARTNER_TRACK.md §5.3 — 앵커는 sp_order_spec(specId). BOM RFQ 와 달리
-- 부품행 계층이 없는 단일가 문서(레거시 sp_pcb_partner_order 대응). MD 2단·통화 3종
-- 1차 포함(§6 D1·D2). 공유 DB 관례: 추가 전용 — `prisma migrate deploy` 로만 적용
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지).

-- AlterTable: sp_partner — 입력/표시 통화(레거시 mb_sub_currency 대응, 결제통화와 다를 때만 의미)
ALTER TABLE `sp_partner` ADD COLUMN `inputCurrency` VARCHAR(8) NULL;

-- CreateTable: sp_pcb_rfq — (spec × 협력사 × 중개 트랙 × 회차) 1건
CREATE TABLE `sp_pcb_rfq` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `specId` BIGINT NOT NULL,
    `partnerId` BIGINT NOT NULL,
    `parentPartnerId` BIGINT NOT NULL DEFAULT 0,
    `reorderRound` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'requested',
    `currency` VARCHAR(8) NOT NULL DEFAULT 'KRW',
    `priceOriginal` DECIMAL(15, 2) NULL,
    `exchangeRate` DECIMAL(12, 6) NULL,
    `krwAmount` INTEGER NULL,
    `subCurrency` VARCHAR(8) NULL,
    `subPriceOriginal` DECIMAL(15, 2) NULL,
    `subExchangeRate` DECIMAL(12, 6) NULL,
    `selectedChildRfqId` BIGINT NULL,
    `marginRate` INTEGER NULL,
    `sourceCurrency` VARCHAR(8) NULL,
    `sourceAmount` DECIMAL(15, 2) NULL,
    `sourceRate` DECIMAL(12, 6) NULL,
    `suggestedDeliveryDate` DATETIME(3) NULL,
    `quotedDeliveryDate` DATETIME(3) NULL,
    `memo` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `selectedAt` DATETIME(3) NULL,
    `magicToken` VARCHAR(64) NULL,
    `magicTokenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_pcb_rfq_magicToken_key`(`magicToken`),
    UNIQUE INDEX `sp_pcb_rfq_specId_partnerId_parentPartnerId_reorderRound_key`(`specId`, `partnerId`, `parentPartnerId`, `reorderRound`),
    INDEX `sp_pcb_rfq_partnerId_status_idx`(`partnerId`, `status`),
    INDEX `sp_pcb_rfq_specId_idx`(`specId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_pcb_rfq` ADD CONSTRAINT `sp_pcb_rfq_specId_fkey`
    FOREIGN KEY (`specId`) REFERENCES `sp_order_spec`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_pcb_rfq` ADD CONSTRAINT `sp_pcb_rfq_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
