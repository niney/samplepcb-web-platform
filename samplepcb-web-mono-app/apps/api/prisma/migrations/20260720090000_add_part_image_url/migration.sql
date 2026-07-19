-- 부품 정본 이미지 URL(공급사 제품 사진 직링크) — additive only
ALTER TABLE `sp_part` ADD COLUMN `imageUrl` VARCHAR(500) NULL;
