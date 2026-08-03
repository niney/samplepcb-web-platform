-- 단일검색 결과를 새로고침·다른 탭에서도 유지되는 견적 draft로 관리한다.
-- 기존 업로드 견적은 기본값 upload로 보존되며, 활성 키는 단일검색 draft에만 기록한다.
ALTER TABLE `sp_bom_quote`
    ADD COLUMN `source_kind` VARCHAR(16) NOT NULL DEFAULT 'upload',
    ADD COLUMN `active_search_cart_key` VARCHAR(60) NULL;

CREATE UNIQUE INDEX `sp_bom_quote_active_search_cart_key_key`
    ON `sp_bom_quote`(`active_search_cart_key`);

CREATE INDEX `sp_bom_quote_mbId_source_kind_status_idx`
    ON `sp_bom_quote`(`mbId`, `source_kind`, `status`);
