-- 외부공급사 발주 자동화(D20, docs/SMARTBOM_PARTNER_RFQ.md §6.3)
-- 발주서에 외부 실행 결과(Mouser cartKey / DigiKey single-use URL / 실패) 박제 컬럼과
-- 발주 행에 실행용 supplierSku 스냅샷을 추가한다. 공유 DB 관례: 추가 전용(ALTER ADD).

ALTER TABLE `sp_bom_po`
  ADD COLUMN `externalRef` JSON NULL AFTER `memo`;

ALTER TABLE `sp_bom_po_item`
  ADD COLUMN `supplierSku` VARCHAR(191) NULL AFTER `description`;
