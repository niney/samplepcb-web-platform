-- 협력사 보유 부품 행 수정(docs/PARTNER_PARTS.md) — 전체 재업로드 없이 한 줄만 고친다.
-- 누가 언제 고쳤는지 남긴다: 원장 값이 파일 원문과 달라지는 유일한 경로라 추적이 필요하다
-- (원문 `mpnRaw` 는 그대로 보존되므로 "무엇을 고쳤는지"는 두 값의 차이로 읽는다).
-- 추가 전용(additive) — 공유 DB(g5_* 동거)라 migrate dev/reset 금지, 수기 SQL + migrate deploy.

ALTER TABLE `sp_partner_part`
  ADD COLUMN `editedAt` DATETIME(3) NULL,
  ADD COLUMN `editedBy` VARCHAR(191) NULL;
