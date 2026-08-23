-- 협력사 보유 부품 원장(docs/PARTNER_PARTS.md) — 협력사가 올린 재고표를 부품 카탈로그
-- (sp_part)와 **분리해** 저장한다. 카탈로그 편입은 로컬-우선 검색·ES 패싯·고객 단일검색·
-- 기본 구매 조건 선정으로 새고, type='partner' 조직에 supplierCode 를 금지한 규칙과도
-- 충돌하기 때문이다. 여기 값은 협력사의 주장이며 가격 판단에 쓰지 않는다.
-- 추가 전용(additive) — 공유 DB(g5_* 동거)라 migrate dev/reset 금지, 수기 SQL + migrate deploy.

CREATE TABLE `sp_partner_part_upload` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partnerId` BIGINT NOT NULL,
    `fileId` BIGINT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `fileSize` BIGINT NOT NULL DEFAULT 0,
    `engineJobId` VARCHAR(64) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'parsing',
    `mode` VARCHAR(12) NOT NULL DEFAULT 'replace',
    `mappingJson` JSON NULL,
    `statsJson` JSON NULL,
    `previewJson` JSON NULL,
    `error` VARCHAR(500) NULL,
    `uploadedBy` VARCHAR(20) NOT NULL DEFAULT 'PARTNER',
    `uploadedById` VARCHAR(191) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sp_partner_part_upload_partnerId_createdAt_idx`(`partnerId`, `createdAt`),
    INDEX `sp_partner_part_upload_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_partner_part` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partnerId` BIGINT NOT NULL,
    `uploadId` BIGINT NOT NULL,
    `mpn` VARCHAR(191) NOT NULL,
    `mpnRaw` VARCHAR(255) NOT NULL,
    `mpnNorm` VARCHAR(191) NOT NULL,
    `manufacturer` VARCHAR(191) NULL,
    `manufacturerNorm` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `description` VARCHAR(500) NULL,
    `packageCode` VARCHAR(100) NULL,
    `stockQty` INTEGER NULL,
    `dateCode` VARCHAR(100) NULL,
    `leadTime` VARCHAR(100) NULL,
    `unitPrice` DECIMAL(14, 4) NULL,
    `currency` VARCHAR(8) NULL,
    `moq` INTEGER NULL,
    `sourceRow` INTEGER NULL,
    `sourceSheetName` VARCHAR(191) NULL,
    `rawFields` JSON NULL,
    `flags` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_partner_part_mpnNorm_isActive_idx`(`mpnNorm`, `isActive`),
    INDEX `sp_partner_part_partnerId_mpnNorm_idx`(`partnerId`, `mpnNorm`),
    INDEX `sp_partner_part_uploadId_idx`(`uploadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 한 행이 만드는 조회 키 여럿(원문 정리본 + 엔진이 준 대체 후보). "진짜 품번" 하나를
-- 고르면 반드시 틀리므로 고르지 않고 전부 건다.
CREATE TABLE `sp_partner_part_key` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partId` BIGINT NOT NULL,
    `partnerId` BIGINT NOT NULL,
    `mpnNorm` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'canonical',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_partner_part_key_partId_mpnNorm_key`(`partId`, `mpnNorm`),
    INDEX `sp_partner_part_key_mpnNorm_isActive_idx`(`mpnNorm`, `isActive`),
    INDEX `sp_partner_part_key_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_partner_part_upload` ADD CONSTRAINT `sp_partner_part_upload_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_partner_part` ADD CONSTRAINT `sp_partner_part_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_partner_part` ADD CONSTRAINT `sp_partner_part_uploadId_fkey` FOREIGN KEY (`uploadId`) REFERENCES `sp_partner_part_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
