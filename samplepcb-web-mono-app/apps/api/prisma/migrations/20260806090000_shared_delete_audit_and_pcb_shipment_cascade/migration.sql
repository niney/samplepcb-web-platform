-- 1) 삭제 감사 원장을 트랙 횡단 공용으로 승격.
--    sp_bom_case_delete_audit → sp_delete_audit. RENAME 이라 기존 감사행은 그대로 따라온다.
--    quoteId(BOM Case 전용) → subjectType + subjectId 로 중립화한다. 이름만 공용이고 키가
--    한 트랙에 묶여 결국 다시 고쳐야 하는 sp_mail_log 의 전철을 밟지 않기 위함.
--    ⚠ 배포 원자성: 구 코드가 옛 테이블명을 참조하므로 이 마이그레이션은 코드와 함께 나가야 한다.
RENAME TABLE `sp_bom_case_delete_audit` TO `sp_delete_audit`;

ALTER TABLE `sp_delete_audit`
  ADD COLUMN `subjectType` VARCHAR(24) NOT NULL DEFAULT 'bom_case' AFTER `id`,
  ADD COLUMN `subjectId` VARCHAR(64) NOT NULL DEFAULT '' AFTER `subjectType`,
  CHANGE COLUMN `quoteStatus` `subjectStatus` VARCHAR(16) NOT NULL;

UPDATE `sp_delete_audit` SET `subjectId` = CAST(`quoteId` AS CHAR) WHERE `subjectId` = '';

ALTER TABLE `sp_delete_audit`
  DROP INDEX `sp_bom_case_delete_audit_quoteId_createdAt_idx`,
  DROP INDEX `sp_bom_case_delete_audit_actorMbId_createdAt_idx`,
  DROP COLUMN `quoteId`,
  ALTER COLUMN `subjectType` DROP DEFAULT,
  ALTER COLUMN `subjectId` DROP DEFAULT;

CREATE INDEX `sp_delete_audit_subjectType_subjectId_createdAt_idx`
  ON `sp_delete_audit` (`subjectType`, `subjectId`, `createdAt`);
CREATE INDEX `sp_delete_audit_actorMbId_createdAt_idx`
  ON `sp_delete_audit` (`actorMbId`, `createdAt`);

-- 2) PCB 선적을 스펙 삭제 cascade 에 편입.
--    sp_pcb_rfq·sp_pcb_po 는 이미 ON DELETE CASCADE 인데 sp_pcb_shipment 만 관계가 없어,
--    스펙을 영구 삭제하면 선적 행이 남아 선적 워크큐에 조작 불가능한 유령 행으로 영구히
--    떴다(2026-08-06 실측). 고아 행이 이미 있으면 FK 생성이 실패하므로 먼저 정리한다.
DELETE `sps` FROM `sp_pcb_shipment` `sps`
  LEFT JOIN `sp_order_spec` `s` ON `s`.`id` = `sps`.`specId`
 WHERE `s`.`id` IS NULL;

ALTER TABLE `sp_pcb_shipment`
  ADD CONSTRAINT `sp_pcb_shipment_specId_fkey`
  FOREIGN KEY (`specId`) REFERENCES `sp_order_spec`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
