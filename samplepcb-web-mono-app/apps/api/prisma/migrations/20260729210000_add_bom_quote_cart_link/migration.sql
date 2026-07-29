-- 스마트 BOM 주문 전환(D16, docs/SMARTBOM_PARTNER_RFQ.md §6) — 영카트 카트 파생 조인 키.
-- 거버 sp_order_spec.ctId 관례와 동일: 주문·결제 상태는 저장하지 않고 ct/od 조인 파생.
-- 공유 DB(samplepcb) 관례: 추가 전용(ALTER ADD)만 — `prisma migrate deploy` 로 적용.

ALTER TABLE `sp_bom_quote`
  ADD COLUMN `ctId` INTEGER NULL AFTER `procurementMode`;

ALTER TABLE `sp_bom_quote`
  ADD INDEX `sp_bom_quote_ctId_idx`(`ctId`);
