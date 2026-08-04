CREATE TABLE `sp_bom_quote_item_review` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quoteId` BIGINT NOT NULL,
  `quote_item_id` BIGINT NOT NULL,
  `action` VARCHAR(12) NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `actor_mb_id` VARCHAR(60) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `idx_bom_quote_item_review_item_created`(`quote_item_id`, `created_at`),
  INDEX `idx_bom_quote_item_review_quote_created`(`quoteId`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sp_bom_quote_item_review_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `sp_bom_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `sp_bom_quote_item_review_quote_item_id_fkey`
    FOREIGN KEY (`quote_item_id`) REFERENCES `sp_bom_quote_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
