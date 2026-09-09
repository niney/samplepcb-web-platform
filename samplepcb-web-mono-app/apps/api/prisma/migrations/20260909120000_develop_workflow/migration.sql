-- 追加 테이블만 사용한다. 기능 원복 시 테이블·파일·migration 이력은 보존한다.
CREATE TABLE `sp_develop_workflow` (
  `requestId` BIGINT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `state` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`requestId`),
  CONSTRAINT `sp_develop_workflow_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `sp_develop_workflow_audit` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requestId` BIGINT NOT NULL,
  `revision` INTEGER NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `actorMbId` VARCHAR(191) NOT NULL,
  `byAdmin` BOOLEAN NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `sp_develop_workflow_audit_requestId_createdAt_idx` (`requestId`, `createdAt`),
  CONSTRAINT `sp_develop_workflow_audit_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_workflow` (`requestId`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
