-- 인터뷰 파이프라인(P1 구조화) 산출 구성 명세 JSON 보존 — additive, migrate deploy 전용.
ALTER TABLE `sp_market_project`
  ADD COLUMN `diagramSpec` MEDIUMTEXT NULL AFTER `diagramHtml`;
