-- PCB 송금 원장 — 발주서 1:N 송금(부분·분할 송금 기록 + 미지급 잔액 계산).
-- sp_pcb_po.remittedAt 은 이 원장에서 파생하는 캐시로 강등된다(컬럼은 유지 — 목록·
-- 협력사 포털의 기존 표시가 쓴다). 기존 remittedAt 값이 있으면 원장 1행으로 승계하고
-- 금액은 발주가 전액으로 본다(그것이 종전의 암묵 가정이었다).
CREATE TABLE `sp_pcb_remittance` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    `poId`         BIGINT       NOT NULL,
    `remittedOn`   DATETIME(3)  NOT NULL,
    `currency`     VARCHAR(8)   NOT NULL,
    `amount`       DECIMAL(15, 2) NOT NULL,
    `exchangeRate` DECIMAL(12, 6) NULL,
    `krwAmount`    INT          NULL,
    `memo`         VARCHAR(500) NULL,
    `createdBy`    VARCHAR(191) NOT NULL,
    `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`    DATETIME(3)  NOT NULL,

    INDEX `sp_pcb_remittance_poId_idx` (`poId`),
    INDEX `sp_pcb_remittance_remittedOn_idx` (`remittedOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_pcb_remittance`
  ADD CONSTRAINT `sp_pcb_remittance_poId_fkey`
  FOREIGN KEY (`poId`) REFERENCES `sp_pcb_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 송금 표시 승계 — 날짜만 있고 금액이 없던 기록을 '발주가 전액 1회'로 해석한다.
INSERT INTO `sp_pcb_remittance`
  (`poId`, `remittedOn`, `currency`, `amount`, `exchangeRate`, `krwAmount`, `memo`, `createdBy`, `createdAt`, `updatedAt`)
SELECT
  `id`,
  `remittedAt`,
  `currency`,
  `priceOriginal`,
  `exchangeRate`,
  `krwAmount`,
  '이력 승계 — 금액 미기록분(발주가 전액으로 간주)',
  'system',
  NOW(3),
  NOW(3)
FROM `sp_pcb_po`
WHERE `remittedAt` IS NOT NULL;
