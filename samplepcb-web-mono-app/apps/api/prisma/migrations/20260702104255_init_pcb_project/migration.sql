-- CreateTable
CREATE TABLE `sp_quote` (
    `id` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `orderCategory` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `specJson` JSON NOT NULL,
    `specHash` VARCHAR(191) NOT NULL,
    `autoPrice` INTEGER NULL,
    `eta` VARCHAR(191) NULL,
    `priceVersion` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sp_order_spec` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mbId` VARCHAR(20) NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `ctId` INTEGER NULL,
    `projectName` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `orderCategory` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `message` TEXT NULL,
    `specJson` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `quoteStatus` VARCHAR(191) NOT NULL,
    `finalPrice` INTEGER NULL,
    `pricedBy` VARCHAR(20) NULL,
    `pricedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sp_order_spec_mbId_status_idx`(`mbId`, `status`),
    INDEX `sp_order_spec_quoteId_idx`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sp_file` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ref_type` VARCHAR(50) NOT NULL,
    `ref_id` BIGINT NOT NULL,
    `upload_file_name` VARCHAR(255) NOT NULL,
    `origin_file_name` VARCHAR(255) NOT NULL,
    `path_token` VARCHAR(500) NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `write_date` DATETIME(3) NOT NULL,
    `file_type` VARCHAR(50) NULL,
    `uploaded_by` VARCHAR(20) NULL,

    INDEX `idx_sp_file_ref`(`ref_type`, `ref_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
