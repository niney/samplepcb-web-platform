-- PCB 고객 클레임(A/S 접수, P5) — BOM 클레임(D37) 미러 + PCB 고유 판정 축.
-- 주문·발주 문서는 변경하지 않고, 접수 시점 주문 스냅샷과 관리자 판정(귀책·처리)·
-- 상태 전이를 별도 append-only 원장으로 보존한다. 재생산 실행은 기존 A/S 케이스로
-- 핸드오프(asCaseId 느슨 참조 — FK 없음), 환불 실집행 정본은 od_refund_price.

CREATE TABLE `sp_pcb_claim` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `specId` BIGINT NOT NULL,
  `mbId` VARCHAR(60) NOT NULL,
  `odId` VARCHAR(64) NOT NULL,
  `ctId` INTEGER NOT NULL,
  `activeKey` VARCHAR(96) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `kind` VARCHAR(24) NOT NULL,
  `description` TEXT NOT NULL,
  `orderedQty` INTEGER NOT NULL,
  `affectedQty` INTEGER NOT NULL,
  `requestedRemedy` VARCHAR(24) NOT NULL,
  `orderSnapshot` JSON NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdByRole` VARCHAR(12) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `adminMbId` VARCHAR(191) NULL,
  `adminResponse` TEXT NULL,
  `faultType` VARCHAR(24) NULL,
  `resolutionKind` VARCHAR(24) NULL,
  `chargeAmount` INTEGER NULL,
  `refundAmount` INTEGER NULL,
  `returnRequired` BOOLEAN NOT NULL DEFAULT false,
  `returnNote` VARCHAR(500) NULL,
  `asCaseId` BIGINT NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewStartedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_pcb_claim_activeKey_key`(`activeKey`),
  INDEX `sp_pcb_claim_specId_submittedAt_idx`(`specId`, `submittedAt`),
  INDEX `sp_pcb_claim_mbId_submittedAt_idx`(`mbId`, `submittedAt`),
  INDEX `sp_pcb_claim_status_submittedAt_idx`(`status`, `submittedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_pcb_claim_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `claimId` BIGINT NOT NULL,
  `action` VARCHAR(24) NOT NULL,
  `actorRole` VARCHAR(12) NOT NULL,
  `actorMbId` VARCHAR(191) NOT NULL,
  `fromStatus` VARCHAR(16) NULL,
  `toStatus` VARCHAR(16) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `sp_pcb_claim_event_claimId_createdAt_idx`(`claimId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_pcb_claim`
  ADD CONSTRAINT `sp_pcb_claim_specId_fkey`
    FOREIGN KEY (`specId`) REFERENCES `sp_order_spec`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sp_pcb_claim_event`
  ADD CONSTRAINT `sp_pcb_claim_event_claimId_fkey`
    FOREIGN KEY (`claimId`) REFERENCES `sp_pcb_claim`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
