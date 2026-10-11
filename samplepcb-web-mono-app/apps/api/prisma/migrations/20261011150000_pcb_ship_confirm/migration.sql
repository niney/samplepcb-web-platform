-- 협력사 '선적 완료' 확인(2026-10-11) — 받는 쪽이 국제 '선적'을 진행한 뒤 보내는 쪽(협력사)이
-- "실제로 넘겼다"를 남기는 기록. 상태 사전(BOM 공유)은 그대로 두고 문서 필드로만 둔다.
ALTER TABLE `sp_pcb_shipment`
  ADD COLUMN `shipConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `shipConfirmedBy` VARCHAR(16) NULL;
