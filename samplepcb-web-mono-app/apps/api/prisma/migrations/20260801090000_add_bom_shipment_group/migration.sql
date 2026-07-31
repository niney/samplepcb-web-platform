-- 선적 그룹(§6.10): 선적:발주서 = 1:N 조인. 기존 1:1 선적은 자기 발주서로 백필.
CREATE TABLE `sp_bom_shipment_po` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shipmentId` BIGINT NOT NULL,
  `poId` BIGINT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sp_bom_shipment_po_poId_key` (`poId`),
  INDEX `sp_bom_shipment_po_shipmentId_idx` (`shipmentId`),
  CONSTRAINT `sp_bom_shipment_po_shipmentId_fkey` FOREIGN KEY (`shipmentId`)
    REFERENCES `sp_bom_shipment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `sp_bom_shipment_po_poId_fkey` FOREIGN KEY (`poId`)
    REFERENCES `sp_bom_po` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 백필 — 기존 선적(발주서당 1건)을 조인으로 승격.
INSERT INTO `sp_bom_shipment_po` (`shipmentId`, `poId`)
SELECT `id`, `poId` FROM `sp_bom_shipment`;
