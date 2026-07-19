-- 고객 BOM 후보 비교·선택의 영속 단일 진실.
-- 엔진 잡은 인메모리이므로 후보/오퍼/검증 근거를 견적 문맥에 스냅샷으로 보존한다.

ALTER TABLE `sp_bom_quote_item`
    ADD COLUMN `recommendedCandidateKey` VARCHAR(64) NULL,
    ADD COLUMN `selectedCandidateKey` VARCHAR(64) NULL,
    ADD COLUMN `selectionSource` VARCHAR(16) NOT NULL DEFAULT 'legacy';

-- 기존 행만 legacy로 표식하고 이후 신규 행의 기본값은 명시 계약(none)과 맞춘다.
ALTER TABLE `sp_bom_quote_item`
    MODIFY COLUMN `selectionSource` VARCHAR(16) NOT NULL DEFAULT 'none';

CREATE TABLE `sp_bom_quote_candidate` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `rowIdx` INTEGER NOT NULL,
    `candidateKey` VARCHAR(64) NOT NULL,
    `technicalRank` INTEGER NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `selectionMode` VARCHAR(24) NOT NULL,
    `safety` VARCHAR(12) NOT NULL,
    `autoEligible` BOOLEAN NOT NULL DEFAULT false,
    `mpn` VARCHAR(191) NOT NULL,
    `manufacturerName` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_quote_candidate_quoteId_rowIdx_candidateKey_key`(`quoteId`, `rowIdx`, `candidateKey`),
    INDEX `sp_bom_quote_candidate_quoteId_rowIdx_technicalRank_idx`(`quoteId`, `rowIdx`, `technicalRank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_bom_quote_selection_event` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteId` BIGINT NOT NULL,
    `rowIdx` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `actorId` VARCHAR(60) NULL,
    `previousCandidateKey` VARCHAR(64) NULL,
    `selectedCandidateKey` VARCHAR(64) NULL,
    `previousMpn` VARCHAR(191) NULL,
    `selectedMpn` VARCHAR(191) NULL,
    `previousOfferKey` VARCHAR(64) NULL,
    `selectedOfferKey` VARCHAR(64) NULL,
    `previousLineTotalKrw` DECIMAL(14, 2) NULL,
    `selectedLineTotalKrw` DECIMAL(14, 2) NULL,
    `reasonCodes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_bom_quote_selection_event_quoteId_rowIdx_createdAt_idx`(`quoteId`, `rowIdx`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_quote_candidate`
    ADD CONSTRAINT `sp_bom_quote_candidate_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_bom_quote_selection_event`
    ADD CONSTRAINT `sp_bom_quote_selection_event_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
