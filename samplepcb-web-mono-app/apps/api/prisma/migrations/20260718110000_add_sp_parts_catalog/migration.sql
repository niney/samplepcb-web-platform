-- 부품 카탈로그 신설 (sp_part*, 2026-07-18) — BOM 공급사 검색 자동 인제스트 + ES(sp-parts) 색인 원천
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지)
-- 설계: docs/PARTS_SEARCH.md — DB=진실원본, ES=재구축 가능 파생물. BOM 매칭 상태(문맥)는 저장하지 않는다.

-- CreateTable: sp_part — 정규 부품(공급사 무관). upsert 키 = (mpnNorm, manufacturerNorm)
CREATE TABLE `sp_part` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mpn` VARCHAR(191) NOT NULL,
    `mpnNorm` VARCHAR(191) NOT NULL,
    `manufacturerName` VARCHAR(191) NOT NULL,
    `manufacturerNorm` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `packageCode` VARCHAR(32) NULL,
    `lifecycle` VARCHAR(64) NULL,
    `datasheetUrl` VARCHAR(500) NULL,
    `specsJson` JSON NOT NULL,
    `specsSi` JSON NOT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `indexedAt` DATETIME(3) NULL,

    UNIQUE INDEX `sp_part_mpnNorm_manufacturerNorm_key`(`mpnNorm`, `manufacturerNorm`),
    INDEX `sp_part_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_part_offer — 공급사별 판매 정보(공급사 추가 = supplier 값 추가)
CREATE TABLE `sp_part_offer` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partId` BIGINT NOT NULL,
    `supplier` VARCHAR(32) NOT NULL,
    `supplierSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productUrl` VARCHAR(1000) NULL,
    `stock` INTEGER NULL,
    `moq` INTEGER NULL,
    `orderMultiple` INTEGER NULL,
    `packaging` VARCHAR(64) NULL,
    `currency` VARCHAR(8) NULL,
    `leadTime` VARCHAR(64) NULL,
    `rawJson` JSON NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_part_offer_partId_supplier_supplierSku_key`(`partId`, `supplier`, `supplierSku`),
    INDEX `sp_part_offer_supplier_idx`(`supplier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_part_price_break — 수량 구간 단가(fetch 단위 replace-all)
CREATE TABLE `sp_part_price_break` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `offerId` BIGINT NOT NULL,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(14, 6) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT '',

    UNIQUE INDEX `sp_part_price_break_offerId_qty_key`(`offerId`, `qty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sp_part_index_queue — ES 색인 실패 재시도 큐
CREATE TABLE `sp_part_index_queue` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partId` BIGINT NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_part_index_queue_partId_idx`(`partId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sp_part_offer` ADD CONSTRAINT `sp_part_offer_partId_fkey` FOREIGN KEY (`partId`) REFERENCES `sp_part`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sp_part_price_break` ADD CONSTRAINT `sp_part_price_break_offerId_fkey` FOREIGN KEY (`offerId`) REFERENCES `sp_part_offer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
