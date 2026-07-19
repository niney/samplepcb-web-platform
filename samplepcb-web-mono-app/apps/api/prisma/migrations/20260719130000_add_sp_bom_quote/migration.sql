-- 고객 스마트 BOM 견적 신설 (2026-07-19) — 업로드→매칭→검토→견적요청(RFQ).
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE)만 — `prisma migrate deploy` 로 적용.
-- 설계: docs/BOM_QUOTE.md — 수량·오퍼 스냅샷 박제가 단일 진실, 금액은 서버 재계산 예상치.

-- CreateTable: sp_bom_quote — 견적 문서(회원 소유)
CREATE TABLE `sp_bom_quote` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mbId` VARCHAR(60) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `fileName` VARCHAR(255) NULL,
    `contentHash` VARCHAR(64) NULL,
    `engineJobId` VARCHAR(64) NULL,
    `setQty` INTEGER NOT NULL DEFAULT 1,
    `spareQty` INTEGER NOT NULL DEFAULT 0,
    `itemsTotal` INTEGER NOT NULL DEFAULT 0,
    `shippingFee` INTEGER NOT NULL DEFAULT 0,
    `managementFee` INTEGER NOT NULL DEFAULT 0,
    `finalTotal` INTEGER NOT NULL DEFAULT 0,
    `usdKrwRateUsed` DECIMAL(10, 2) NULL,
    `uncostedCount` INTEGER NOT NULL DEFAULT 0,
    `customerMemo` TEXT NULL,
    `adminMemo` TEXT NULL,
    `answerNote` TEXT NULL,
    `confirmedShippingFee` INTEGER NULL,
    `confirmedManagementFee` INTEGER NULL,
    `confirmedTotal` INTEGER NULL,
    `requestedAt` DATETIME(3) NULL,
    `answeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sp_bom_quote_mbId_status_idx`(`mbId`, `status`),
    INDEX `sp_bom_quote_status_requestedAt_idx`(`status`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_bom_quote_item — 견적 라인(orderQty·selectedOffer 스냅샷 박제)
CREATE TABLE `sp_bom_quote_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `rowIdx` INTEGER NOT NULL,
    `included` BOOLEAN NOT NULL DEFAULT true,
    `mpn` VARCHAR(191) NOT NULL,
    `manufacturerName` VARCHAR(191) NULL,
    `description` VARCHAR(1000) NULL,
    `bomQty` INTEGER NOT NULL,
    `orderQty` INTEGER NOT NULL DEFAULT 0,
    `matchStatus` VARCHAR(8) NOT NULL DEFAULT 'none',
    `partId` BIGINT NULL,
    `selectedOffer` JSON NULL,
    `lineTotalKrw` DECIMAL(14, 2) NULL,
    `sourceRow` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_quote_item_quoteId_rowIdx_key`(`quoteId`, `rowIdx`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_bom_quote_item` ADD CONSTRAINT `sp_bom_quote_item_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
