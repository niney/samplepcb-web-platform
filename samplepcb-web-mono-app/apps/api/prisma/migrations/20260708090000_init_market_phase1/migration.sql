-- PCB 재능마켓 1차(매칭까지) 테이블 신설 (sp_market_*, 2026-07-08)
-- 공유 DB(samplepcb) 관례: 추가 전용(ALTER ADD / CREATE / CREATE INDEX)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지 — HANDOFF 결정 로그 9)
-- 첨부·증빙 파일 테이블은 만들지 않는다 — 기존 sp_file 폴리모픽(refType/refId) 재사용.

-- CreateTable: sp_market_expert — 전문가 프로필(회원당 1행) + 승인 워크플로
CREATE TABLE `sp_market_expert` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mbId` VARCHAR(191) NOT NULL,
    `expertType` VARCHAR(20) NOT NULL,
    `displayName` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(50) NOT NULL,
    `identityVerified` BOOLEAN NOT NULL DEFAULT false,
    `careerRange` VARCHAR(20) NOT NULL,
    `contactHours` VARCHAR(100) NULL,
    `region` VARCHAR(20) NULL,
    `travelRange` VARCHAR(20) NULL,
    `intro` TEXT NULL,
    `categories` JSON NOT NULL,
    `cadTools` JSON NOT NULL,
    `bankName` VARCHAR(50) NULL,
    `bankHolder` VARCHAR(50) NULL,
    `bankAccount` VARCHAR(50) NULL,
    `termsAgreedAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `statusReason` VARCHAR(255) NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_market_expert_mbId_key`(`mbId`),
    INDEX `sp_market_expert_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_market_project — 프로젝트 의뢰(역견적/지정견적)
CREATE TABLE `sp_market_project` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mbId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `category` VARCHAR(30) NOT NULL,
    `cadTools` JSON NOT NULL,
    `description` TEXT NOT NULL,
    `ndaRequired` BOOLEAN NOT NULL DEFAULT true,
    `budgetRange` VARCHAR(20) NOT NULL,
    `startHopeDate` VARCHAR(10) NULL,
    `dueHopeDate` VARCHAR(10) NULL,
    `bidDeadlineAt` DATETIME(3) NOT NULL,
    `method` VARCHAR(20) NOT NULL,
    `targetExpertId` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'bidding',
    `awardedBidId` BIGINT NULL,
    `awardedAt` DATETIME(3) NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sp_market_project_status_bidDeadlineAt_idx`(`status`, `bidDeadlineAt`),
    INDEX `sp_market_project_mbId_idx`(`mbId`),
    INDEX `sp_market_project_targetExpertId_idx`(`targetExpertId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_market_bid — 입찰(블라인드 견적)
CREATE TABLE `sp_market_bid` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `projectId` BIGINT NOT NULL,
    `expertId` BIGINT NOT NULL,
    `mbId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `durationDays` INTEGER NOT NULL,
    `warranty` VARCHAR(255) NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'submitted',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_market_bid_projectId_expertId_key`(`projectId`, `expertId`),
    INDEX `sp_market_bid_projectId_status_idx`(`projectId`, `status`),
    INDEX `sp_market_bid_mbId_idx`(`mbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_market_nda_sign — NDA 전자서명 기록(프로젝트×회원 1행)
CREATE TABLE `sp_market_nda_sign` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `projectId` BIGINT NOT NULL,
    `mbId` VARCHAR(191) NOT NULL,
    `textVersion` VARCHAR(20) NOT NULL,
    `signedName` VARCHAR(100) NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_market_nda_sign_projectId_mbId_key`(`projectId`, `mbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_market_settings — 마켓 설정 싱글턴(id=1, 행 부재 시 GET 기본값 폴백)
CREATE TABLE `sp_market_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `feeRateBp` INTEGER NOT NULL DEFAULT 1000,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
