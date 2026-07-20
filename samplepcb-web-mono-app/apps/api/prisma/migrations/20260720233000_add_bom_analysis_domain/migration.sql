-- BOM 추출 결과를 견적 가변 상태와 분리해 영속하는 분석 도메인.
-- sp-engine 잡은 계산 수단일 뿐이며, 성공한 AnalysisRun이 원본 기술 데이터의 단일 진실이다.

CREATE TABLE `sp_bom_analysis_run` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `engineJobId` VARCHAR(64) NULL,
    `engine` VARCHAR(32) NOT NULL,
    `schemaVersion` VARCHAR(32) NOT NULL,
    `parserVersion` VARCHAR(191) NOT NULL,
    `sourceFile` VARCHAR(255) NOT NULL,
    `engineModel` VARCHAR(191) NULL,
    `promptVersion` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL,
    `summary` JSON NOT NULL,
    `headers` JSON NOT NULL,
    `failures` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `sp_bom_analysis_run_quoteId_createdAt_idx`(`quoteId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_analysis_sheet` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `analysisRunId` BIGINT NOT NULL,
    `sheetIndex` INTEGER NOT NULL,
    `sheetName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `componentCount` INTEGER NOT NULL DEFAULT 0,
    `columnCount` INTEGER NOT NULL DEFAULT 0,
    `failureReason` VARCHAR(500) NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_bom_analysis_sheet_analysisRunId_sheetIndex_key`(`analysisRunId`, `sheetIndex`),
    INDEX `sp_bom_analysis_sheet_analysisRunId_status_idx`(`analysisRunId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_analysis_component` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `analysisRunId` BIGINT NOT NULL,
    `analysisSheetId` BIGINT NOT NULL,
    `engineComponentId` VARCHAR(24) NOT NULL,
    `sourceRows` JSON NOT NULL,
    `referenceDesignators` JSON NOT NULL,
    `partNumber` VARCHAR(191) NULL,
    `manufacturer` VARCHAR(191) NULL,
    `componentType` VARCHAR(64) NULL,
    `description` VARCHAR(1000) NULL,
    `quantity` INTEGER NULL,
    `packageCode` VARCHAR(191) NULL,
    `reviewStatus` VARCHAR(16) NOT NULL,
    `confidence` DOUBLE NULL,
    `searchText` TEXT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_bom_analysis_component_analysisRunId_engineComponentId_key`(`analysisRunId`, `engineComponentId`),
    INDEX `sp_bom_analysis_component_analysisSheetId_id_idx`(`analysisSheetId`, `id`),
    INDEX `sp_bom_analysis_component_analysisRunId_reviewStatus_idx`(`analysisRunId`, `reviewStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_supplier_search_run` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `analysisRunId` BIGINT NOT NULL,
    `engineJobId` VARCHAR(64) NULL,
    `status` VARCHAR(16) NOT NULL,
    `options` JSON NOT NULL,
    `preflight` JSON NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `sp_bom_supplier_search_run_quoteId_createdAt_idx`(`quoteId`, `createdAt`),
    INDEX `sp_bom_supplier_search_run_analysisRunId_createdAt_idx`(`analysisRunId`, `createdAt`),
    INDEX `sp_bom_supplier_search_run_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_quote`
    ADD COLUMN `active_analysis_run_id` BIGINT NULL,
    ADD COLUMN `active_supplier_search_run_id` BIGINT NULL,
    ADD UNIQUE INDEX `sp_bom_quote_active_analysis_run_id_key`(`active_analysis_run_id`),
    ADD UNIQUE INDEX `sp_bom_quote_active_supplier_search_run_id_key`(`active_supplier_search_run_id`);

ALTER TABLE `sp_bom_quote_item`
    ADD COLUMN `analysis_component_id` BIGINT NULL,
    ADD INDEX `sp_bom_quote_item_analysis_component_id_idx`(`analysis_component_id`);

-- 후보·선택 이력을 표시 순서(rowIdx)가 아니라 영속 견적 라인 ID에 연결한다.
-- NOT NULL 전환이 실패하면 고아 데이터가 있다는 뜻이므로 조용히 잘못 매핑하지 않고 migration을 중단한다.
ALTER TABLE `sp_bom_quote_candidate`
    ADD COLUMN `quote_item_id` BIGINT NULL;

UPDATE `sp_bom_quote_candidate` AS candidate
INNER JOIN `sp_bom_quote_item` AS item
    ON item.`quoteId` = candidate.`quoteId`
    AND item.`rowIdx` = candidate.`rowIdx`
SET candidate.`quote_item_id` = item.`id`;

ALTER TABLE `sp_bom_quote_candidate`
    MODIFY `quote_item_id` BIGINT NOT NULL,
    DROP INDEX `sp_bom_quote_candidate_quoteId_rowIdx_candidateKey_key`,
    DROP INDEX `sp_bom_quote_candidate_quoteId_rowIdx_technicalRank_idx`,
    DROP COLUMN `rowIdx`,
    ADD UNIQUE INDEX `sp_bom_quote_candidate_quote_item_id_candidateKey_key`(`quote_item_id`, `candidateKey`),
    ADD INDEX `sp_bom_quote_candidate_quoteId_technicalRank_idx`(`quoteId`, `technicalRank`),
    ADD INDEX `sp_bom_quote_candidate_quote_item_id_technicalRank_idx`(`quote_item_id`, `technicalRank`);

ALTER TABLE `sp_bom_quote_selection_event`
    ADD COLUMN `quote_item_id` BIGINT NULL;

UPDATE `sp_bom_quote_selection_event` AS event
INNER JOIN `sp_bom_quote_item` AS item
    ON item.`quoteId` = event.`quoteId`
    AND item.`rowIdx` = event.`rowIdx`
SET event.`quote_item_id` = item.`id`;

-- quoteId FK가 기존 (quoteId,rowIdx,createdAt) 인덱스를 사용하므로 대체 인덱스를 먼저 만든다.
ALTER TABLE `sp_bom_quote_selection_event`
    ADD INDEX `sp_bom_quote_selection_event_quoteId_createdAt_idx`(`quoteId`, `createdAt`);

ALTER TABLE `sp_bom_quote_selection_event`
    MODIFY `quote_item_id` BIGINT NOT NULL,
    DROP INDEX `sp_bom_quote_selection_event_quoteId_rowIdx_createdAt_idx`,
    DROP COLUMN `rowIdx`,
    ADD INDEX `sp_bom_quote_selection_event_quote_item_id_createdAt_idx`(`quote_item_id`, `createdAt`);

ALTER TABLE `sp_bom_analysis_run`
    ADD CONSTRAINT `sp_bom_analysis_run_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_analysis_sheet`
    ADD CONSTRAINT `sp_bom_analysis_sheet_analysisRunId_fkey`
    FOREIGN KEY (`analysisRunId`) REFERENCES `sp_bom_analysis_run`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_analysis_component`
    ADD CONSTRAINT `sp_bom_analysis_component_analysisRunId_fkey`
    FOREIGN KEY (`analysisRunId`) REFERENCES `sp_bom_analysis_run`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `sp_bom_analysis_component_analysisSheetId_fkey`
    FOREIGN KEY (`analysisSheetId`) REFERENCES `sp_bom_analysis_sheet`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_supplier_search_run`
    ADD CONSTRAINT `sp_bom_supplier_search_run_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `sp_bom_supplier_search_run_analysisRunId_fkey`
    FOREIGN KEY (`analysisRunId`) REFERENCES `sp_bom_analysis_run`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote`
    ADD CONSTRAINT `sp_bom_quote_active_analysis_run_id_fkey`
    FOREIGN KEY (`active_analysis_run_id`) REFERENCES `sp_bom_analysis_run`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote`
    ADD CONSTRAINT `sp_bom_quote_active_supplier_search_run_id_fkey`
    FOREIGN KEY (`active_supplier_search_run_id`) REFERENCES `sp_bom_supplier_search_run`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote_item`
    ADD CONSTRAINT `sp_bom_quote_item_analysis_component_id_fkey`
    FOREIGN KEY (`analysis_component_id`) REFERENCES `sp_bom_analysis_component`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote_candidate`
    ADD CONSTRAINT `sp_bom_quote_candidate_quote_item_id_fkey`
    FOREIGN KEY (`quote_item_id`) REFERENCES `sp_bom_quote_item`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote_selection_event`
    ADD CONSTRAINT `sp_bom_quote_selection_event_quote_item_id_fkey`
    FOREIGN KEY (`quote_item_id`) REFERENCES `sp_bom_quote_item`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
