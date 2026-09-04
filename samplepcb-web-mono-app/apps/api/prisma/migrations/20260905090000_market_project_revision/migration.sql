-- 의뢰 수정 이력(docs/MARKET_FLOW.md §의뢰 수정·버전, 2026-09-05).
-- 견적이 들어온 뒤에도 의뢰를 고칠 수 있게 열면서, 수정 직전 값을 append-only 로 남긴다.
CREATE TABLE `sp_market_project_revision` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `projectId` BIGINT NOT NULL,
  `revNo` INTEGER NOT NULL,
  `actorMbId` VARCHAR(191) NOT NULL,
  `byOwner` BOOLEAN NOT NULL DEFAULT true,
  `major` BOOLEAN NOT NULL DEFAULT false,
  `changedFields` JSON NOT NULL,
  `snapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `sp_market_project_revision_projectId_revNo_key`(`projectId`, `revNo`),
  INDEX `sp_market_project_revision_projectId_createdAt_idx`(`projectId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
