-- 개발의뢰 위저드 v2(docs/DEVELOP_FLOW.md §7.2, 2026-09-08) — 의뢰 방식·단계·희망 시기·시제품/생산 계획. 전부 additive.
ALTER TABLE `sp_develop_request`
  ADD COLUMN `requestMode` VARCHAR(12) NOT NULL DEFAULT 'individual' AFTER `budgetRange`,
  ADD COLUMN `currentStage` VARCHAR(20) NULL AFTER `requestMode`,
  ADD COLUMN `targetStage` VARCHAR(20) NULL AFTER `currentStage`,
  ADD COLUMN `wishDate` VARCHAR(10) NULL AFTER `targetStage`,
  ADD COLUMN `wishNote` VARCHAR(200) NULL AFTER `wishDate`,
  ADD COLUMN `expertDelegate` BOOLEAN NOT NULL DEFAULT false AFTER `wishNote`,
  ADD COLUMN `production` JSON NULL AFTER `expertDelegate`;

-- 예산 사전 분리 — 마켓 코드(500만 단위) → 개발의뢰 코드(1천만 단위). 운영엔 개발의뢰 행이 없고 로컬 시험 데이터만 있다.
UPDATE `sp_develop_request` SET `budgetRange` = CASE `budgetRange`
  WHEN 'under500' THEN 'under1000'
  WHEN 'r500_2000' THEN 'under1000'
  WHEN 'r2000_5000' THEN 'r3000_5000'
  WHEN 'over5000' THEN 'r5000_10000'
  WHEN 'undecided' THEN 'after_quote'
  ELSE `budgetRange` END
WHERE `budgetRange` IN ('under500', 'r500_2000', 'r2000_5000', 'over5000', 'undecided');
