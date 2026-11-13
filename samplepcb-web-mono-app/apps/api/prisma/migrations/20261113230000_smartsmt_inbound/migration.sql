-- SmartSMT 연동 — 견적서 수신(2026-11-13, docs/SMARTSMT_INTEGRATION.md §4.1).
-- 바깥(SmartSMT)에서 계산을 끝낸 SMT 견적서를 받아 보관한다. 추가 전용(CREATE 3개 + FK 2개) — 기존 표는 건드리지 않는다.
--   sp_smt_order        주문 1건(orderId 유니크). 최신 견적 연결.
--   sp_smt_quote        견적 1건(quoteId 유니크). envelope = 받은 견적서 JSON 전체, 나머지는 목록용으로 뽑아 올린 값.
--   sp_smt_receive_log  수신 시도 1건(성공·실패 모두).
-- DDL 은 `prisma migrate diff`(스키마 대 스키마, DB 무접속)가 낸 것을 그대로 옮겼다.

-- CreateTable
CREATE TABLE `sp_smt_order` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `orderId` VARCHAR(100) NOT NULL,
    `ownerMbId` VARCHAR(60) NULL,
    `ownerName` VARCHAR(191) NULL,
    `latestQuoteId` BIGINT NULL,
    `quoteCount` INTEGER NOT NULL DEFAULT 0,
    `adminMemo` TEXT NULL,
    `firstReceivedAt` DATETIME(3) NOT NULL,
    `lastReceivedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_smt_order_orderId_key`(`orderId`),
    UNIQUE INDEX `sp_smt_order_latestQuoteId_key`(`latestQuoteId`),
    INDEX `sp_smt_order_lastReceivedAt_idx`(`lastReceivedAt`),
    INDEX `sp_smt_order_ownerMbId_idx`(`ownerMbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sp_smt_quote` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `orderRefId` BIGINT NOT NULL,
    `quoteId` VARCHAR(100) NOT NULL,
    `orderId` VARCHAR(100) NOT NULL,
    `source` VARCHAR(8) NOT NULL,
    `envelopeVersion` VARCHAR(16) NOT NULL,
    `madeAt` DATETIME(3) NULL,
    `currency` VARCHAR(8) NULL,
    `lang` VARCHAR(8) NULL,
    `strategy` VARCHAR(16) NULL,
    `quoteStatus` VARCHAR(32) NULL,
    `quantity` INTEGER NULL,
    `smtTotal` DECIMAL(16, 2) NULL,
    `finalSupplyPrice` DECIMAL(16, 2) NULL,
    `finalVat` DECIMAL(16, 2) NULL,
    `finalTotal` DECIMAL(16, 2) NULL,
    `blockedBy` JSON NULL,
    `files` JSON NULL,
    `envelope` MEDIUMTEXT NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_smt_quote_quoteId_key`(`quoteId`),
    INDEX `sp_smt_quote_orderRefId_id_idx`(`orderRefId`, `id`),
    INDEX `sp_smt_quote_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sp_smt_receive_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `result` VARCHAR(24) NOT NULL,
    `reason` VARCHAR(32) NULL,
    `httpStatus` INTEGER NOT NULL,
    `quoteId` VARCHAR(100) NULL,
    `orderId` VARCHAR(100) NULL,
    `bytes` BIGINT NULL,
    `durationMs` INTEGER NOT NULL,
    `remoteAddr` VARCHAR(64) NULL,
    `message` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_smt_receive_log_createdAt_idx`(`createdAt`),
    INDEX `sp_smt_receive_log_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_smt_order` ADD CONSTRAINT `sp_smt_order_latestQuoteId_fkey` FOREIGN KEY (`latestQuoteId`) REFERENCES `sp_smt_quote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sp_smt_quote` ADD CONSTRAINT `sp_smt_quote_orderRefId_fkey` FOREIGN KEY (`orderRefId`) REFERENCES `sp_smt_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
