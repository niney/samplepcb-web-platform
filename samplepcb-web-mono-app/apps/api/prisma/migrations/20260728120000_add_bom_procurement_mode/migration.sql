-- 견적별 샘플/양산 조달 정책. 기존 견적은 현행 동작을 보존하도록 sample로 둔다.
ALTER TABLE `sp_bom_quote`
  ADD COLUMN `procurementMode` VARCHAR(8) NOT NULL DEFAULT 'sample' AFTER `buildStatus`;
