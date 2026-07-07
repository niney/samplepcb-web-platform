-- PCB 재능마켓 2차(계약·결제·검수·정산) 테이블 신설 (sp_market_contract, 2026-07-08)
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지 — HANDOFF 결정 로그 9)
-- 산출물 파일 테이블은 만들지 않는다 — 기존 sp_file 폴리모픽(refType='sp_market_contract') 재사용.

-- CreateTable: sp_market_contract — 채택 계약(프로젝트당 1건) + 결제·검수·정산 워크플로
CREATE TABLE `sp_market_contract` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `projectId` BIGINT NOT NULL,
    `bidId` BIGINT NOT NULL,
    `clientMbId` VARCHAR(191) NOT NULL,
    `expertMbId` VARCHAR(191) NOT NULL,
    `expertId` BIGINT NOT NULL,
    `amount` INTEGER NOT NULL,
    `feeRateBp` INTEGER NOT NULL,
    `feeAmount` INTEGER NOT NULL,
    `payoutAmount` INTEGER NOT NULL,
    `contractKey` VARCHAR(36) NOT NULL,
    `ctId` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `paidAt` DATETIME(3) NULL,
    `paidOdId` VARCHAR(20) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `deliveryNote` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `confirmedBy` VARCHAR(10) NULL,
    `holdAt` DATETIME(3) NULL,
    `holdReason` VARCHAR(500) NULL,
    `settledAt` DATETIME(3) NULL,
    `settledBy` VARCHAR(191) NULL,
    `settleNote` VARCHAR(500) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_market_contract_projectId_key`(`projectId`),
    UNIQUE INDEX `sp_market_contract_contractKey_key`(`contractKey`),
    INDEX `sp_market_contract_status_idx`(`status`),
    INDEX `sp_market_contract_clientMbId_idx`(`clientMbId`),
    INDEX `sp_market_contract_expertMbId_idx`(`expertMbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
