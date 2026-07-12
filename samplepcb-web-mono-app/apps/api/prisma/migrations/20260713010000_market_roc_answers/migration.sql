-- 인터뷰 파이프라인 Phase 2 — 작업검토지시서 + 인터뷰 답변 원본. additive, migrate deploy 전용.
ALTER TABLE `sp_market_project`
  ADD COLUMN `rocMd` MEDIUMTEXT NULL AFTER `diagramSpec`,
  ADD COLUMN `interviewAnswers` JSON NULL AFTER `rocMd`;
