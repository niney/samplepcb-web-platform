-- AI 산출물 출처·입력/출력 해시 메타데이터. additive, migrate deploy 전용.
ALTER TABLE `sp_market_project`
  ADD COLUMN `aiGenerationMeta` JSON NULL AFTER `postings`;
