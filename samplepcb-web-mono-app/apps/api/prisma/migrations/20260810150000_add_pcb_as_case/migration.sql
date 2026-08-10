-- PCB A/S 케이스 — 완료·출고된 발주의 재생산(회차 재발주) 접수 헤더(P4).
-- 얇은 헤더로 접수·회신만 돌고, [재발주 진행] 시점에 reorderRound 를 채번하면서
-- 회차 발주서(sp_pcb_po reorderRound>0)를 만든다. reorderRound 는 NULL 시작 —
-- 미전송 초안이 회차를 점유하지 않게(UK 는 진행된 건만 회차 유일, NULL 다중 허용).
CREATE TABLE `sp_pcb_as_case` (
    `id`              BIGINT       NOT NULL AUTO_INCREMENT,
    `specId`          BIGINT       NOT NULL,
    `reorderRound`    INT          NULL,
    `caseType`        VARCHAR(16)  NOT NULL,
    `chargeType`      VARCHAR(8)   NOT NULL,
    `description`     TEXT         NULL,
    `status`          VARCHAR(16)  NOT NULL DEFAULT 'draft',
    `targetPartnerId` BIGINT       NOT NULL,
    `parentPartnerId` BIGINT       NOT NULL DEFAULT 0,
    `replyReason`     TEXT         NULL,
    `createdBy`       VARCHAR(191) NOT NULL,
    `submittedAt`     DATETIME(3)  NULL,
    `repliedAt`       DATETIME(3)  NULL,
    `proceededAt`     DATETIME(3)  NULL,
    `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`       DATETIME(3)  NOT NULL,

    UNIQUE INDEX `sp_pcb_as_case_specId_reorderRound_key` (`specId`, `reorderRound`),
    INDEX `sp_pcb_as_case_targetPartnerId_status_idx` (`targetPartnerId`, `status`),
    INDEX `sp_pcb_as_case_parentPartnerId_idx` (`parentPartnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_pcb_as_case`
  ADD CONSTRAINT `sp_pcb_as_case_specId_fkey`
  FOREIGN KEY (`specId`) REFERENCES `sp_order_spec`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_pcb_as_case`
  ADD CONSTRAINT `sp_pcb_as_case_targetPartnerId_fkey`
  FOREIGN KEY (`targetPartnerId`) REFERENCES `sp_partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
