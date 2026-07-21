-- 공급사 결과 인제스트를 견적 완료 경로와 분리하고, 동일 결과를 영속 fingerprint로 합친다.
ALTER TABLE `sp_part`
    ADD COLUMN `factsFingerprint` CHAR(64) NULL,
    ADD COLUMN `indexFingerprint` CHAR(64) NULL;

ALTER TABLE `sp_part_offer`
    ADD COLUMN `contentFingerprint` CHAR(64) NULL;

CREATE TABLE `sp_part_ingest_run` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `fingerprint` CHAR(64) NOT NULL,
    `policyVersion` VARCHAR(64) NOT NULL,
    `sourceJobId` VARCHAR(64) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `leaseUntil` DATETIME(3) NULL,
    `stats` JSON NULL,
    `timing` JSON NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_part_ingest_run_fingerprint_key`(`fingerprint`),
    INDEX `sp_part_ingest_run_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_supplier_search_run`
    ADD COLUMN `catalogIngestRunId` BIGINT NULL,
    ADD INDEX `sp_bom_supplier_search_run_catalogIngestRunId_idx`(`catalogIngestRunId`),
    ADD CONSTRAINT `sp_bom_supplier_search_run_catalogIngestRunId_fkey`
        FOREIGN KEY (`catalogIngestRunId`) REFERENCES `sp_part_ingest_run`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;
