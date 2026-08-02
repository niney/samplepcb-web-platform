-- 협력사 거래 문서: 조직 사업자정보 + PO 견적/회신조건 스냅샷.
ALTER TABLE `sp_partner`
  ADD COLUMN `businessNo` VARCHAR(30) NULL AFTER `contactEmail`,
  ADD COLUMN `ownerName` VARCHAR(100) NULL AFTER `businessNo`,
  ADD COLUMN `businessZip` VARCHAR(10) NULL AFTER `ownerName`,
  ADD COLUMN `businessAddress` VARCHAR(500) NULL AFTER `businessZip`,
  ADD COLUMN `businessType` VARCHAR(100) NULL AFTER `businessAddress`,
  ADD COLUMN `businessItem` VARCHAR(100) NULL AFTER `businessType`,
  ADD COLUMN `fax` VARCHAR(50) NULL AFTER `businessItem`;

ALTER TABLE `sp_bom_po`
  ADD COLUMN `quotationData` JSON NULL AFTER `externalRef`,
  ADD COLUMN `quotationDeliveryDate` DATETIME(3) NULL AFTER `quotationData`,
  ADD COLUMN `quotationMemo` TEXT NULL AFTER `quotationDeliveryDate`;

ALTER TABLE `sp_bom_po_item`
  ADD COLUMN `moq` INTEGER NULL AFTER `lineTotal`,
  ADD COLUMN `stock` INTEGER NULL AFTER `moq`,
  ADD COLUMN `dateCode` VARCHAR(100) NULL AFTER `stock`,
  ADD COLUMN `leadTime` VARCHAR(64) NULL AFTER `dateCode`,
  ADD COLUMN `quotationMemo` VARCHAR(500) NULL AFTER `leadTime`;
