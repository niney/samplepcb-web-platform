-- 관리자 공급사 엔진의 행별 판정과 자동 선정 근거를 고객 견적에도 보존한다.
-- 카탈로그(sp_part)는 사실 데이터만 소유하고, BOM 문맥 판정은 견적 라인이 소유한다.

ALTER TABLE `sp_bom_quote_item`
    ADD COLUMN `matchEvidence` JSON NULL;
