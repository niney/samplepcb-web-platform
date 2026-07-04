-- AlterTable
ALTER TABLE `sp_order_spec` ADD COLUMN `companyName` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `sp_member_profile` (
    `mbId` VARCHAR(20) NOT NULL,
    `companyName` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`mbId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
