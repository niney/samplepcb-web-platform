-- RFQ 부분 행 선택(§6.13, 레거시 승계): 요청 부품행 id 배열. null=전체(하위호환). 추가 전용.
ALTER TABLE `sp_bom_rfq`
  ADD COLUMN `requestedItemIds` JSON NULL AFTER `magicTokenAt`;
