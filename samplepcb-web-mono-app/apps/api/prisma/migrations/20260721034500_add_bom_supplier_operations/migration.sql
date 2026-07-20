-- 공급사 검색 운영 지표와 회원별 일일 사용량을 서버 재시작 후에도 보존한다.
ALTER TABLE `sp_bom_supplier_search_run`
    ADD COLUMN `result_summary` JSON NULL;

CREATE TABLE `sp_bom_supplier_daily_usage` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mbId` VARCHAR(60) NOT NULL,
    `dayKey` CHAR(10) NOT NULL,
    `searchCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_bom_supplier_daily_usage_mbId_dayKey_key`(`mbId`, `dayKey`),
    INDEX `sp_bom_supplier_daily_usage_dayKey_searchCount_idx`(`dayKey`, `searchCount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
