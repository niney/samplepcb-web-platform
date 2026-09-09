-- 기존 의뢰는 매핑이 없으면 G, C 신규 의뢰는 생성 트랜잭션에서 소속을 고정한다.
CREATE TABLE `sp_develop_prototype` (
  `requestId` BIGINT NOT NULL,
  `variant` CHAR(1) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`requestId`),
  INDEX `sp_develop_prototype_variant_idx` (`variant`),
  CONSTRAINT `sp_develop_prototype_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sp_develop_request` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
