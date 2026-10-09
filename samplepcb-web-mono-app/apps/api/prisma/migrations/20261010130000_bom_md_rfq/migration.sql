-- BOM 마스터딜러 견적 단계(docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개").
-- 마스터딜러가 받은 견적요청을 하위 협력사에 재요청하고(sp_bom_rfq.parentPartnerId — 자리는
-- 이미 있다), 품목별로 하위 회신을 골라 마진을 얹는다. 그 변환점의 근거를 품목 행에 남긴다.
-- 추가형 마이그레이션 — 기존 컬럼은 바꾸지 않는다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_bom_rfq_item`
    ADD COLUMN `selectedChildRfqId` BIGINT NULL,
    ADD COLUMN `marginRate` DECIMAL(6, 2) NULL,
    ADD COLUMN `sourceCurrency` VARCHAR(8) NULL,
    ADD COLUMN `sourceUnitPrice` DECIMAL(14, 4) NULL,
    ADD COLUMN `sourceRate` DECIMAL(12, 6) NULL;
