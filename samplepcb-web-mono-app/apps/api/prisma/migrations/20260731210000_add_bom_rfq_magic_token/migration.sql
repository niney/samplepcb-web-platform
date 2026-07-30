-- 매직링크 무로그인 회신(§6.9): RFQ 별 랜덤 토큰(재발급 회전). 추가 전용.
ALTER TABLE `sp_bom_rfq`
  ADD COLUMN `magicToken` VARCHAR(64) NULL AFTER `respondedAt`,
  ADD COLUMN `magicTokenAt` DATETIME(3) NULL AFTER `magicToken`,
  ADD UNIQUE INDEX `sp_bom_rfq_magicToken_key` (`magicToken`);
