-- 개발의뢰 프로젝트 문서·업무표(docs/DEVELOP_FLOW.md §13, 2026-09-09) — 계약 이후 수행 구간의 문서 층.
-- 프로토타입 롤백 조건: 새 테이블 2개만, 기존 sp_develop_* ALTER 없음. 되돌리기는 같은 폴더의 down.sql(Prisma 는 읽지 않는다).
CREATE TABLE `sp_develop_document` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `type` VARCHAR(24) NOT NULL,
  `seq` INTEGER NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `title` VARCHAR(200) NOT NULL,
  `content` JSON NOT NULL,
  `replyDueOn` VARCHAR(10) NULL,
  `internalNote` TEXT NULL,
  `mailSubject` VARCHAR(200) NULL,
  `mailBody` TEXT NULL,
  `sentAt` DATETIME(3) NULL,
  `sentBy` VARCHAR(191) NULL,
  `decision` VARCHAR(20) NULL,
  `decisionNote` VARCHAR(2000) NULL,
  `decidedAt` DATETIME(3) NULL,
  `decidedName` VARCHAR(100) NULL,
  `decidedIp` VARCHAR(64) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_develop_document_requestId_type_seq_version_key`(`requestId`, `type`, `seq`, `version`),
  INDEX `sp_develop_document_requestId_status_idx`(`requestId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sp_develop_task` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `seq` INTEGER NOT NULL,
  `phase` VARCHAR(20) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'planned',
  `startOn` VARCHAR(10) NULL,
  `endOn` VARCHAR(10) NULL,
  `weightBp` INTEGER NOT NULL DEFAULT 0,
  `progressPct` INTEGER NOT NULL DEFAULT 0,
  `note` VARCHAR(500) NULL,
  `visibleToCustomer` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sp_develop_task_requestId_seq_key`(`requestId`, `seq`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sp_develop_document` ADD CONSTRAINT `sp_develop_document_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sp_develop_task` ADD CONSTRAINT `sp_develop_task_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
