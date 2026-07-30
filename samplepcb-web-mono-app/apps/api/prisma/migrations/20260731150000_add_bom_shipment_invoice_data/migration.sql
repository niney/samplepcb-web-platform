-- D23 상업송장 생성기: 편집본 영속(다음 열기 프리필). 추가 전용.
ALTER TABLE `sp_bom_shipment`
  ADD COLUMN `invoiceData` JSON NULL AFTER `completedAt`;
