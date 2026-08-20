-- BOM 국제 선적에도 PCB와 같은 샘플피씨비 운송(Case ID) 갈래를 둔다.
-- 상태 코드는 바꾸지 않고 요청 → 관리자 입력/부킹 → 실선적의 문서 차례만 기록한다.
ALTER TABLE `sp_bom_shipment`
  ADD COLUMN `caseRefRequestedAt` DATETIME(3) NULL AFTER `shipDate`,
  ADD COLUMN `caseRefNote` VARCHAR(255) NULL AFTER `caseRefRequestedAt`,
  ADD COLUMN `caseRef` VARCHAR(100) NULL AFTER `caseRefNote`,
  ADD COLUMN `caseRefFilledAt` DATETIME(3) NULL AFTER `caseRef`;
