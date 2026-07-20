-- 고객 BOM USD 환산 감사 정보.
-- 숫자 환율(usdKrwRateUsed)은 기존 호환을 유지하고 출처·기준일·안전계수를 JSON으로 확장한다.

ALTER TABLE `sp_bom_quote`
    ADD COLUMN `exchangeRateSnapshot` JSON NULL;
