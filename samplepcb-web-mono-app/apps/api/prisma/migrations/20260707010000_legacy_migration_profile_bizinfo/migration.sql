-- 레거시 DB 마이그레이션 스키마 확장 (2026-07-07)
-- 공유 DB(samplepcb) 관례: 추가 전용(ALTER ADD / CREATE / CREATE INDEX)만 — `prisma migrate deploy` 로 적용.
-- (`migrate dev`/`reset` 은 g5_* drift 로 전체 reset 을 요구하므로 절대 사용 금지 — HANDOFF 결정 로그 9)

-- AlterTable: sp_member_profile — 레거시 g5_member 여분/커스텀 필드의 명시 컬럼 승격
ALTER TABLE `sp_member_profile`
    ADD COLUMN `memberType` VARCHAR(20) NULL,
    ADD COLUMN `bizNo` VARCHAR(50) NULL,
    ADD COLUMN `ceoName` VARCHAR(255) NULL,
    ADD COLUMN `bizType` VARCHAR(255) NULL,
    ADD COLUMN `bizItem` VARCHAR(255) NULL,
    ADD COLUMN `managerName` VARCHAR(255) NULL,
    ADD COLUMN `taxEmail` VARCHAR(255) NULL,
    ADD COLUMN `managerPhone` VARCHAR(50) NULL,
    ADD COLUMN `managerEmail` VARCHAR(255) NULL,
    ADD COLUMN `bizZip` VARCHAR(20) NULL,
    ADD COLUMN `bizAddr1` VARCHAR(255) NULL,
    ADD COLUMN `bizAddr2` VARCHAR(255) NULL,
    ADD COLUMN `partnerKind` VARCHAR(100) NULL,
    ADD COLUMN `partnerAuth` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `legacyJson` JSON NULL;

-- CreateTable: sp_order_biz_info — 레거시 g5_shop_order od_1~od_11(세금계산서 정보) 이관처
CREATE TABLE `sp_order_biz_info` (
    `odId` VARCHAR(30) NOT NULL,
    `companyName` VARCHAR(255) NULL,
    `bizNo` VARCHAR(50) NULL,
    `ceoName` VARCHAR(255) NULL,
    `bizType` VARCHAR(255) NULL,
    `bizItem` VARCHAR(255) NULL,
    `managerName` VARCHAR(255) NULL,
    `taxEmail` VARCHAR(255) NULL,
    `companyTel` VARCHAR(50) NULL,
    `bizZip` VARCHAR(20) NULL,
    `bizAddr1` VARCHAR(255) NULL,
    `bizAddr2` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`odId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex: sp_order_spec.ctId — 레거시 이관·ct_id 조인(테마 뱃지/썸네일) 조회용
CREATE INDEX `sp_order_spec_ctId_idx` ON `sp_order_spec`(`ctId`);
