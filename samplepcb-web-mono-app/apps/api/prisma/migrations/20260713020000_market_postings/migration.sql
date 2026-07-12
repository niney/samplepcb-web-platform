-- 인터뷰 파이프라인 Phase 3 — 분야별 포스팅 카드. additive, migrate deploy 전용.
ALTER TABLE `sp_market_project`
  ADD COLUMN `postings` JSON NULL AFTER `interviewAnswers`;
