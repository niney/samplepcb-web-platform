-- D20 EQ 문항형 회차(docs/PCB_PARTNER_TRACK.md D20).
-- D16 고객 확인 원장(sp_pcb_eq_review)을 회차로 넓힌다: 공장 EQ 표의 문항 N개를 고객이 문항별로
-- 답하고(관리자 대리 회신 포함), 개정 EQ 는 새 회차로 직전 회차에 연결된다.
-- 추가형 마이그레이션 — 기존 행은 format='message'(D16 문구형)로 그대로 읽힌다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_pcb_eq_review`
    ADD COLUMN `format`        VARCHAR(16)  NOT NULL DEFAULT 'message',
    ADD COLUMN `version`       INT          NOT NULL DEFAULT 1,
    ADD COLUMN `prevReviewId`  BIGINT       NULL,
    ADD COLUMN `sourceFileIds` JSON         NULL,
    ADD COLUMN `answeredRole`  VARCHAR(16)  NULL,
    ADD COLUMN `answerChannel` VARCHAR(16)  NULL,
    ADD COLUMN `forwardedAt`   DATETIME(3)  NULL,
    ADD COLUMN `forwardedBy`   VARCHAR(191) NULL;

CREATE TABLE `sp_pcb_eq_review_item` (
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `reviewId`      BIGINT       NOT NULL,
    `seq`           INT          NOT NULL,
    `factoryNo`     VARCHAR(32)  NULL,
    `category`      VARCHAR(32)  NOT NULL,
    `question`      TEXT         NOT NULL,
    `questionOrig`  TEXT         NULL,
    `options`       JSON         NOT NULL,
    `figures`       JSON         NOT NULL,
    `prevItemId`    BIGINT       NULL,
    `change`        VARCHAR(16)  NULL,
    `answerKey`     VARCHAR(8)   NULL,
    `answerComment` TEXT         NULL,
    `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`     DATETIME(3)  NOT NULL,

    INDEX `sp_pcb_eq_review_item_reviewId_idx` (`reviewId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_pcb_eq_review_item`
  ADD CONSTRAINT `sp_pcb_eq_review_item_reviewId_fkey`
  FOREIGN KEY (`reviewId`) REFERENCES `sp_pcb_eq_review`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `sp_pcb_eq_review_event` (
    `id`        BIGINT       NOT NULL AUTO_INCREMENT,
    `reviewId`  BIGINT       NOT NULL,
    `action`    VARCHAR(32)  NOT NULL,
    `actorRole` VARCHAR(16)  NOT NULL,
    `actorMbId` VARCHAR(191) NULL,
    `channel`   VARCHAR(16)  NULL,
    `note`      TEXT         NULL,
    `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sp_pcb_eq_review_event_reviewId_idx` (`reviewId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_pcb_eq_review_event`
  ADD CONSTRAINT `sp_pcb_eq_review_event_reviewId_fkey`
  FOREIGN KEY (`reviewId`) REFERENCES `sp_pcb_eq_review`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
