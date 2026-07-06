-- 레거시 마이그레이션 확폭 (2026-07-07, P1 리허설 실증 반영)
-- ① mb_id 계열: 레거시는 이메일을 회원 아이디로 사용(varchar 255 운영, 실측 최대 29자).
--    sp 측은 utf8mb4 인덱스 한도(191×4=764B < 767B)를 지키는 VARCHAR(191) 채택.
-- ② message: 레거시 it_basic 실측 최대 ~1MB — TEXT(64KB) 절단 방지로 MEDIUMTEXT.
-- 전부 무손실 확폭(MODIFY) — `prisma migrate deploy` 전용(공유 DB, dev/reset 금지).

ALTER TABLE `sp_order_spec`
    MODIFY `mbId` VARCHAR(191) NULL,
    MODIFY `pricedBy` VARCHAR(191) NULL,
    MODIFY `message` MEDIUMTEXT NULL;

ALTER TABLE `sp_member_profile`
    MODIFY `mbId` VARCHAR(191) NOT NULL;
