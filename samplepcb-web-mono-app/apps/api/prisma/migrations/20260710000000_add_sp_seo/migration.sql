-- 페이지별 SEO 메타 sp_seo 신설 (2026-07-10, P1)
-- 공유 DB(samplepcb) 관례: 추가 전용(CREATE)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지)
-- 관리=sp-vue/sp-node, 소비=sp-php 테마 head.sub.php read-only 참조. 정본 docs/SEO_MANAGEMENT.md.

CREATE TABLE `sp_seo` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(20) NOT NULL,
    `refKey` VARCHAR(191) NOT NULL DEFAULT '',
    `metaTitle` VARCHAR(255) NULL,
    `metaDescription` VARCHAR(500) NULL,
    `ogImage` VARCHAR(500) NULL,
    `canonical` VARCHAR(500) NULL,
    `robots` VARCHAR(50) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sp_seo_scope_refKey_key`(`scope`, `refKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
