-- 공급사 검색 실행별·컴포넌트별 실제 검색어와 fallback provenance를 영속한다.
CREATE TABLE `sp_bom_supplier_search_trace` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `supplier_search_run_id` BIGINT NOT NULL,
    `engine_component_id` VARCHAR(24) NOT NULL,
    `row_idx` INTEGER NOT NULL,
    `trace_version` VARCHAR(64) NOT NULL,
    `primary_query` VARCHAR(500) NOT NULL,
    `fallback_query` VARCHAR(500) NULL,
    `fallback_used` BOOLEAN NOT NULL,
    `attempt_count` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_bom_supplier_trace_run_component`(`supplier_search_run_id`, `engine_component_id`),
    INDEX `idx_bom_supplier_trace_run_row`(`supplier_search_run_id`, `row_idx`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_supplier_search_trace`
    ADD CONSTRAINT `fk_bom_supplier_trace_run`
    FOREIGN KEY (`supplier_search_run_id`) REFERENCES `sp_bom_supplier_search_run`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
