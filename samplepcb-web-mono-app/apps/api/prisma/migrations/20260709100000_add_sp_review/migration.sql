-- 상품 별점후기(레거시 g5_shop_item_use) 이관처 sp_review 신설 (2026-07-09)
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지)
-- 후기는 sp_order_spec(프로젝트)에 quoteId 로 귀속(05-reviews.ts). is_password(회원 비번
-- 해시 사본)는 이관하지 않으므로 컬럼도 두지 않는다. _legacy 는 legacyJson 으로 분리.

CREATE TABLE `sp_review` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `legacyIsId` INTEGER NULL,
    `mbId` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NULL,
    `specId` BIGINT NULL,
    `score` INTEGER NOT NULL,
    `subject` VARCHAR(255) NULL,
    `content` TEXT NOT NULL,
    `isConfirm` INTEGER NOT NULL DEFAULT 0,
    `replySubject` VARCHAR(255) NULL,
    `replyContent` TEXT NULL,
    `replyName` VARCHAR(50) NULL,
    `repliedAt` DATETIME(3) NULL,
    `writeDate` DATETIME(3) NOT NULL,
    `legacyItId` VARCHAR(20) NULL,
    `legacyJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_review_legacyIsId_key`(`legacyIsId`),
    INDEX `sp_review_quoteId_idx`(`quoteId`),
    INDEX `sp_review_mbId_idx`(`mbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
