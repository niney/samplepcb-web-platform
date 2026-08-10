-- Smart BOM 조달 차질·잔량 대체발주(D31).
-- 원 발주서/품목 스냅샷은 변경하지 않고 부족 수량을 별도 원장에 기록한다.
-- 대체 발주 품목이 발행 취소로 삭제되면 recoveryPoItemId만 NULL이 되어 재복구할 수 있다.

CREATE TABLE `sp_bom_po_shortage` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sourcePoItemId` BIGINT NOT NULL,
  `shortageQty` INTEGER NOT NULL,
  `reason` VARCHAR(32) NOT NULL,
  `note` TEXT NULL,
  `reportedByMbId` VARCHAR(191) NULL,
  `reportedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `recoveryPoItemId` BIGINT NULL,
  `recoveredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_bom_po_shortage_sourcePoItemId_key`(`sourcePoItemId`),
  UNIQUE INDEX `sp_bom_po_shortage_recoveryPoItemId_key`(`recoveryPoItemId`),
  INDEX `sp_bom_po_shortage_recoveryPoItemId_idx`(`recoveryPoItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_bom_po_shortage`
  ADD CONSTRAINT `sp_bom_po_shortage_sourcePoItemId_fkey`
    FOREIGN KEY (`sourcePoItemId`) REFERENCES `sp_bom_po_item`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `sp_bom_po_shortage_recoveryPoItemId_fkey`
    FOREIGN KEY (`recoveryPoItemId`) REFERENCES `sp_bom_po_item`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
