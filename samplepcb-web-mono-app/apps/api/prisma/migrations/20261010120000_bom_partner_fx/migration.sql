-- BOM 협력사 외화 회신(docs/SMARTBOM_PARTNER_RFQ.md "외화 회신").
-- 협력사가 자기 결제통화(KRW|USD|CNY)로 단가를 회신하고, 원화 환산은 견적 단위로 한 번
-- 고정한 환율을 쓴다. 발주는 결제통화 금액이 정본이고 원화 컬럼은 발행 시점 실제 환율의 회계값이다.
-- 추가형 마이그레이션 — 기존 컬럼은 바꾸지 않는다(공유 DB, migrate reset 금지). 기존 행은 전부 원화다.

ALTER TABLE `sp_bom_quote`
    ADD COLUMN `partnerFxRates` JSON NULL;

ALTER TABLE `sp_bom_rfq`
    ADD COLUMN `totalOriginal` DECIMAL(15, 2) NULL;

ALTER TABLE `sp_bom_po`
    ADD COLUMN `totalOriginal` DECIMAL(15, 2) NULL,
    ADD COLUMN `exchangeRate` DECIMAL(12, 6) NULL;

ALTER TABLE `sp_bom_po_item`
    ADD COLUMN `unitPriceOriginal` DECIMAL(14, 4) NULL,
    ADD COLUMN `lineTotalOriginal` DECIMAL(15, 2) NULL;
