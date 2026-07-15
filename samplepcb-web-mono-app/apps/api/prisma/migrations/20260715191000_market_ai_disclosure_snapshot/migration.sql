-- 신규 AI 답변 공개 동의 시각 + 채택 시점 계약 요청 스냅샷. additive, migrate deploy 전용.
ALTER TABLE `sp_market_project`
  ADD COLUMN `interviewAnswersSharedAt` DATETIME(3) NULL AFTER `interviewAnswers`;

ALTER TABLE `sp_market_contract`
  ADD COLUMN `requestSnapshot` JSON NULL AFTER `cancelReason`;
