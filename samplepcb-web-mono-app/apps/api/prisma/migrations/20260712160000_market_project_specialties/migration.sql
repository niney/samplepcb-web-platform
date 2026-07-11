-- 프로젝트 의뢰 STEP2 확장 — 세부분야(specialties) 컬럼 신설 + 레거시 'any' 요구 툴 백필.
-- 공유 DB(sp_* 는 그누보드 samplepcb DB 동거) — additive only, 적용은 `migrate deploy` 로만.
-- 물리명 specialties: 인접 물리 컬럼 `category`(=Prisma requestType)와의
-- category/categories 혼동을 피한다. Prisma 필드는 전문가와 대칭인 categories @map("specialties").

ALTER TABLE `sp_market_project`
  ADD COLUMN `specialties` JSON NULL AFTER `serviceAreas`;

UPDATE `sp_market_project`
SET `specialties` = JSON_ARRAY()
WHERE `specialties` IS NULL;

ALTER TABLE `sp_market_project`
  MODIFY COLUMN `specialties` JSON NOT NULL;

-- 레거시 '상관없음'(['any'] 단독) → 빈 배열 — 신규 의미 체계는 "빈 배열 = 특정 툴 요구 없음".
UPDATE `sp_market_project`
SET `cadTools` = JSON_ARRAY()
WHERE JSON_CONTAINS(`cadTools`, JSON_QUOTE('any'));
