-- 고객 BOM 다중 시트 선택 — 전체 워크북을 파싱하되 선택 시트만 견적·공급사 검색에 사용.
-- 기존 견적은 이미 계산이 끝난 문서이므로 buildStatus 기본값을 ready 로 둔다.

ALTER TABLE `sp_bom_quote`
    ADD COLUMN `buildStatus` VARCHAR(12) NOT NULL DEFAULT 'ready';

ALTER TABLE `sp_bom_quote_item`
    ADD COLUMN `sourceSheetIndex` INTEGER NULL,
    ADD COLUMN `sourceSheetName` VARCHAR(191) NULL;

CREATE INDEX `sp_bom_quote_item_quoteId_sourceSheetIndex_idx`
    ON `sp_bom_quote_item`(`quoteId`, `sourceSheetIndex`);

CREATE TABLE `sp_bom_quote_sheet` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `sheetIndex` INTEGER NOT NULL,
    `sheetName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `componentCount` INTEGER NOT NULL DEFAULT 0,
    `selected` BOOLEAN NOT NULL DEFAULT false,
    `failureReason` VARCHAR(500) NULL,
    `warnings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_quote_sheet_quoteId_sheetIndex_key`(`quoteId`, `sheetIndex`),
    INDEX `sp_bom_quote_sheet_quoteId_selected_idx`(`quoteId`, `selected`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_quote_sheet`
    ADD CONSTRAINT `sp_bom_quote_sheet_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
