-- PCB EQ 고객 확인 원장 — 발주서 1:N 확인 요청(반려 → 보완 → 재요청이 반복되므로 회차별).
-- EQ 전이 머신 옆에 붙는 별도 축: 고객이 승인해도 상태는 eq_requested 그대로이고
-- eq_done 전이는 관리자 몫이다(고객 확인 = 관리자 승인의 근거).
CREATE TABLE `sp_pcb_eq_review` (
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `poId`          BIGINT       NOT NULL,
    `specId`        BIGINT       NOT NULL,
    `status`        VARCHAR(16)  NOT NULL DEFAULT 'requested',
    `message`       TEXT         NOT NULL,
    `dueOn`         DATETIME(3)  NULL,
    `sharedFileIds` JSON         NOT NULL,
    `requestedBy`   VARCHAR(191) NOT NULL,
    `requestedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedBy`     VARCHAR(191) NULL,
    `decidedAt`     DATETIME(3)  NULL,
    `decisionNote`  TEXT         NULL,
    `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`     DATETIME(3)  NOT NULL,

    INDEX `sp_pcb_eq_review_poId_idx` (`poId`),
    INDEX `sp_pcb_eq_review_specId_status_idx` (`specId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_pcb_eq_review`
  ADD CONSTRAINT `sp_pcb_eq_review_poId_fkey`
  FOREIGN KEY (`poId`) REFERENCES `sp_pcb_po`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
