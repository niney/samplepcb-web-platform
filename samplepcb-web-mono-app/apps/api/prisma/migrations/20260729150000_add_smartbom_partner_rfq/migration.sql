-- 스마트 BOM 파트너·협력사 RFQ 신설 (sp_partner*, sp_bom_rfq*, 2026-07-29)
-- 설계: docs/SMARTBOM_PARTNER_RFQ.md — 조직/계정/자동화 3축 분리(sp_partner) +
-- 사람 협력사 전용 RFQ 레이어(sp_bom_rfq*). 공급사 시세는 후보/구매 조건 원장 파생(D6).
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE·ALTER ADD)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지)

-- CreateTable: sp_partner — 협력사·공급사·자사 조직 정본
CREATE TABLE `sp_partner` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(12) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `supplierCode` VARCHAR(32) NULL,
    `country` VARCHAR(2) NULL,
    `defaultCurrency` VARCHAR(8) NOT NULL DEFAULT 'KRW',
    `capabilities` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `contactName` VARCHAR(100) NULL,
    `contactPhone` VARCHAR(50) NULL,
    `contactEmail` VARCHAR(255) NULL,
    `memo` TEXT NULL,
    `statusReason` VARCHAR(255) NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `legacyJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_partner_supplierCode_key`(`supplierCode`),
    INDEX `sp_partner_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_partner_member — 계정 연결(로그인 능력). mbId 는 조인 키(FK 금지)
CREATE TABLE `sp_partner_member` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partnerId` BIGINT NOT NULL,
    `mbId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(12) NOT NULL DEFAULT 'owner',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_partner_member_partnerId_mbId_key`(`partnerId`, `mbId`),
    INDEX `sp_partner_member_mbId_idx`(`mbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_partner_relation — 마스터딜러 2단 중개 링크(스키마만 선반영, D4)
CREATE TABLE `sp_partner_relation` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `parentPartnerId` BIGINT NOT NULL,
    `childPartnerId` BIGINT NOT NULL,
    `settlementCurrency` VARCHAR(8) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_partner_relation_parentPartnerId_childPartnerId_key`(`parentPartnerId`, `childPartnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_bom_rfq — 협력사 견적요청 문서. (quote × 협력사 × 중개 경로) 1건
CREATE TABLE `sp_bom_rfq` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `partnerId` BIGINT NOT NULL,
    `parentPartnerId` BIGINT NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'requested',
    `totalAmount` INTEGER NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'KRW',
    `deliveryDate` DATETIME(3) NULL,
    `memo` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_rfq_quoteId_partnerId_parentPartnerId_key`(`quoteId`, `partnerId`, `parentPartnerId`),
    INDEX `sp_bom_rfq_partnerId_status_idx`(`partnerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_bom_rfq_item — 협력사 회신 행(부품행 단위, 안정 quote_item_id 연결)
CREATE TABLE `sp_bom_rfq_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `rfqId` BIGINT NOT NULL,
    `quote_item_id` BIGINT NOT NULL,
    `source` VARCHAR(8) NOT NULL DEFAULT 'manual',
    `unitPrice` DECIMAL(14, 4) NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'KRW',
    `replyQty` INTEGER NULL,
    `moq` INTEGER NULL,
    `stock` INTEGER NULL,
    `dateCode` VARCHAR(100) NULL,
    `leadTime` VARCHAR(64) NULL,
    `memo` VARCHAR(500) NULL,
    `offerId` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_rfq_item_rfqId_quote_item_id_key`(`rfqId`, `quote_item_id`),
    INDEX `sp_bom_rfq_item_quote_item_id_idx`(`quote_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: sp_bom_quote_item — 협력사 회신 선정 참조(selectionSource='partner')
ALTER TABLE `sp_bom_quote_item`
  ADD COLUMN `selectedRfqItemId` BIGINT NULL AFTER `selectedOffer`;

-- AddForeignKey
ALTER TABLE `sp_partner_member`
    ADD CONSTRAINT `sp_partner_member_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_partner_relation`
    ADD CONSTRAINT `sp_partner_relation_parentPartnerId_fkey`
    FOREIGN KEY (`parentPartnerId`) REFERENCES `sp_partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_partner_relation`
    ADD CONSTRAINT `sp_partner_relation_childPartnerId_fkey`
    FOREIGN KEY (`childPartnerId`) REFERENCES `sp_partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_rfq`
    ADD CONSTRAINT `sp_bom_rfq_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_rfq`
    ADD CONSTRAINT `sp_bom_rfq_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sp_bom_rfq_item`
    ADD CONSTRAINT `sp_bom_rfq_item_rfqId_fkey`
    FOREIGN KEY (`rfqId`) REFERENCES `sp_bom_rfq`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_rfq_item`
    ADD CONSTRAINT `sp_bom_rfq_item_quote_item_id_fkey`
    FOREIGN KEY (`quote_item_id`) REFERENCES `sp_bom_quote_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote_item`
    ADD CONSTRAINT `sp_bom_quote_item_selectedRfqItemId_fkey`
    FOREIGN KEY (`selectedRfqItemId`) REFERENCES `sp_bom_rfq_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
