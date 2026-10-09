-- 하위 협력사 직접 관리(docs/PARTNER_PORTAL.md "하위 협력사 직접 관리").
-- 마스터딜러가 포털에서 하위 협력사를 등록·수정·삭제하고, 관리자는 그 조직의 포털에
-- 대리 접속할 수 있다. 회원은 대신 만들지 않는다 — 필요하면 초대 링크로 본인이 연결한다.
-- 추가형 마이그레이션 — 기존 컬럼은 바꾸지 않는다(공유 DB, migrate reset 금지).

-- 소유 조직·등록 계정·소유자 사용 중지 시각
ALTER TABLE `sp_partner`
    ADD COLUMN `ownerPartnerId` BIGINT NULL,
    ADD COLUMN `createdBy` VARCHAR(191) NULL,
    ADD COLUMN `ownerSuspendedAt` DATETIME(3) NULL;

CREATE INDEX `sp_partner_ownerPartnerId_idx` ON `sp_partner`(`ownerPartnerId`);

ALTER TABLE `sp_partner`
    ADD CONSTRAINT `sp_partner_ownerPartnerId_fkey`
    FOREIGN KEY (`ownerPartnerId`) REFERENCES `sp_partner`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 소속 링크: 연결한 계정과 관리자 강제 전환 사유
ALTER TABLE `sp_partner_relation`
    ADD COLUMN `createdBy` VARCHAR(191) NULL,
    ADD COLUMN `forceNote` VARCHAR(255) NULL;

-- CreateTable: sp_partner_invite — 포털 초대(본인 계정 연결용 1회용 링크)
CREATE TABLE `sp_partner_invite` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partnerId` BIGINT NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sp_partner_invite_token_key`(`token`),
    INDEX `sp_partner_invite_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_partner_invite`
    ADD CONSTRAINT `sp_partner_invite_partnerId_fkey`
    FOREIGN KEY (`partnerId`) REFERENCES `sp_partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: sp_partner_act_log — 관리자 대리 접속 쓰기 원장(FK 없음 — 조직 삭제 뒤에도 보존)
CREATE TABLE `sp_partner_act_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `partnerId` BIGINT NOT NULL,
    `partnerName` VARCHAR(191) NOT NULL,
    `adminMbId` VARCHAR(191) NOT NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_partner_act_log_partnerId_id_idx`(`partnerId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
