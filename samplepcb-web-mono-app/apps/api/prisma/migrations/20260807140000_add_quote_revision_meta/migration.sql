-- 관리자 사양 수정(P4.2) — 견적 스냅샷은 불변이라 수정할 때마다 새 sp_quote 행이 발급되고
-- sp_order_spec.quoteId 가 옮겨간다. 그 체인이 곧 "언제 무엇이 바뀌었나"의 이력이므로
-- 별도 원장을 만들지 않고, 체인이 답하지 못하는 "누가·왜"만 두 칸으로 남긴다.
-- 기존 행은 전부 NULL = 고객이 만든 견적(최초 신청·재견적).
ALTER TABLE `sp_quote`
  ADD COLUMN `revisedBy` VARCHAR(191) NULL AFTER `createdAt`,
  ADD COLUMN `revisedReason` TEXT NULL AFTER `revisedBy`;
