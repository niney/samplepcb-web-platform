-- SmartSMT 견적의 관리자 확정 — 항목별 가격 수정(2026-11-19, docs/SMARTSMT_INTEGRATION.md §9).
-- 관리자가 견적 줄 · 블록의 금액을 고친 것을 견적 하나에 한 벌 보관한다. 합계(간접비 · 기업이윤 · 부가세 포함)는
-- 저장할 때 서버가 계산해 함께 남긴다. 추가 전용(CREATE 1개 + FK 1개) — 기존 표는 건드리지 않는다.
-- DDL 은 `prisma migrate diff`(스키마 대 스키마, DB 무접속)가 낸 것을 그대로 옮겼다.

-- CreateTable
CREATE TABLE `sp_smt_review` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `quoteRefId` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `lineAmounts` JSON NOT NULL,
    `blockAmounts` JSON NOT NULL,
    `customerNote` TEXT NULL,
    `directCost` DECIMAL(16, 2) NOT NULL,
    `indirectCost` DECIMAL(16, 2) NOT NULL,
    `profit` DECIMAL(16, 2) NOT NULL,
    `supplyPrice` DECIMAL(16, 2) NOT NULL,
    `vat` DECIMAL(16, 2) NOT NULL,
    `total` DECIMAL(16, 2) NOT NULL,
    `totals` JSON NOT NULL,
    `updatedBy` VARCHAR(60) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_smt_review_quoteRefId_key`(`quoteRefId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_smt_review` ADD CONSTRAINT `sp_smt_review_quoteRefId_fkey` FOREIGN KEY (`quoteRefId`) REFERENCES `sp_smt_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
