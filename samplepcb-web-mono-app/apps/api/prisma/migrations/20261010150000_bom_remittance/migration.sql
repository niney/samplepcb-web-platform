-- BOM 송금 원장(docs/SMARTBOM_PARTNER_RFQ.md "송금 원장").
-- 협력사 발주서(sp_bom_po) 1:N 송금. 외화 발주가 생기면서 "얼마를 발주했고 실제로 얼마가 나갔는가"를
-- 통화별로 남길 자리가 필요해졌다. PCB 송금 원장(sp_pcb_remittance)과 같은 모양이다 —
-- 송금 통화 = 발주 통화, 외화면 실제 적용 환율과 원화 환산을 함께 박제한다(환차의 근거).
-- 추가형 마이그레이션 — 기존 테이블은 건드리지 않는다(공유 DB, migrate reset 금지).

CREATE TABLE `sp_bom_remittance` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `poId` BIGINT NOT NULL,
    `remittedOn` DATETIME(3) NOT NULL,
    `currency` VARCHAR(8) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `exchangeRate` DECIMAL(12, 6) NULL,
    `krwAmount` INTEGER NULL,
    `memo` VARCHAR(500) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sp_bom_remittance_poId_idx`(`poId`),
    INDEX `sp_bom_remittance_remittedOn_idx`(`remittedOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_remittance`
    ADD CONSTRAINT `sp_bom_remittance_poId_fkey`
    FOREIGN KEY (`poId`) REFERENCES `sp_bom_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
