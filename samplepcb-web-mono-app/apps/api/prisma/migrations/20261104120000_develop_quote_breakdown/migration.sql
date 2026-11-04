-- 개발의뢰 견적서 산출 내역(2026-11-04, docs/DEVELOP_FLOW.md §5) — 참고 견적서 '개발견적서' 서식.
-- 항목 = 구분(인건비·직접비) × 단가 × 수량 + 간접비·제경비·기업이윤(앞 합계 × 비율, 천 원 미만 버림).
-- 옛 견적은 비율·가산 금액이 0 이라 공급가가 그대로이고, 옛 항목은 단가 = 금액 · 수량 1 로 채운다.

ALTER TABLE `sp_develop_quote_item`
  ADD COLUMN `category` VARCHAR(10) NOT NULL DEFAULT 'labor',
  ADD COLUMN `grade` VARCHAR(50) NULL,
  ADD COLUMN `unitPrice` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `qty` DECIMAL(10, 2) NOT NULL DEFAULT 1,
  ADD COLUMN `unit` VARCHAR(20) NOT NULL DEFAULT '식';

UPDATE `sp_develop_quote_item` SET `unitPrice` = `amount`;

ALTER TABLE `sp_develop_quote`
  ADD COLUMN `indirectBp` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `overheadBp` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `profitBp` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `indirectAmount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `overheadAmount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `profitAmount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `recipientDept` VARCHAR(100) NULL;

ALTER TABLE `sp_develop_settings`
  ADD COLUMN `defaultIndirectBp` INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN `defaultOverheadBp` INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN `defaultProfitBp` INTEGER NOT NULL DEFAULT 1000;
