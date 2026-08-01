-- 관리자 SmartBOM Case 영구 삭제의 최소 감사 원장.
-- 삭제 대상 sp_bom_quote와 FK를 두지 않아 정상 강제 삭제 뒤에도 감사행만 보존한다.
-- "감사기록 없이 초기화" 모드는 애플리케이션에서 이 테이블에 행을 만들지 않는다.
CREATE TABLE `sp_bom_case_delete_audit` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `mbId` VARCHAR(60) NOT NULL,
  `quoteStatus` VARCHAR(16) NOT NULL,
  `actorMbId` VARCHAR(191) NOT NULL,
  `actorIp` VARCHAR(64) NOT NULL,
  `reason` TEXT NOT NULL,
  `snapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `sp_bom_case_delete_audit_quoteId_createdAt_idx` (`quoteId`, `createdAt`),
  INDEX `sp_bom_case_delete_audit_actorMbId_createdAt_idx` (`actorMbId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
