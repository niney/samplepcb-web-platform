-- 원본 BOM 추출값과 분리된 사용자 행 단위 스펙 검색조건을 보존한다.
ALTER TABLE `sp_bom_quote_item`
    ADD COLUMN `search_requirements` JSON NULL;
