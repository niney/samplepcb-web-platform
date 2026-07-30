-- D22 선적 핑퐁 워크플로우: 출고예정일(협력사 '선적 요청' 진입 시 입력).
-- 추가 전용 — 공유 DB(g5_* 동거)라 DROP/ALTER 파괴 연산 금지.
ALTER TABLE `sp_bom_shipment`
  ADD COLUMN `shipDate` DATETIME(3) NULL AFTER `trackingUrl`;
