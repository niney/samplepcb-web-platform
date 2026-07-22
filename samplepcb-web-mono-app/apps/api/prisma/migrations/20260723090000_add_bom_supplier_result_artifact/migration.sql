-- 공급사 결과를 sp-engine 인메모리 잡과 분리해 영속 보존하고, 실패한 DB·ES 후처리를 재개한다.
CREATE TABLE `sp_bom_supplier_result_artifact` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `supplier_search_run_id` BIGINT NOT NULL,
    `payload` LONGBLOB NOT NULL,
    `payload_checksum` CHAR(64) NOT NULL,
    `payload_bytes` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NULL,
    `lease_until` DATETIME(3) NULL,
    `last_error_code` VARCHAR(64) NULL,
    `last_error` VARCHAR(500) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_supplier_result_artifact_supplier_search_run_id_key`(`supplier_search_run_id`),
    INDEX `sp_bom_supplier_result_artifact_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_supplier_result_artifact`
    ADD CONSTRAINT `sp_bom_supplier_result_artifact_supplier_search_run_id_fkey`
        FOREIGN KEY (`supplier_search_run_id`) REFERENCES `sp_bom_supplier_search_run`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;
