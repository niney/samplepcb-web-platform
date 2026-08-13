-- 발송 참조번호(Case ID) 핑퐁 — 협력사가 국제 발송을 부치기 전에 수취인 측 참조값
-- (특송 계정·포워더 부킹·통관 참조)이 필요한 실무를 원장에 올린다(2026-08-13).
-- 흐름: 협력사 요청(caseRefRequestedAt) → 관리자 입력(caseRef·caseRefFilledAt) →
-- 협력사 운송장 입력(기존 '선적' 전이). 요청됐는데 미입력이면 '선적' 전이 게이트.
-- 상태 사전(BOM 공유)은 건드리지 않는다 — 문서 필드 + 차례 신호로만.
ALTER TABLE `sp_pcb_shipment`
  ADD COLUMN `caseRefRequestedAt` DATETIME(3) NULL AFTER `shipDate`,
  ADD COLUMN `caseRefNote` VARCHAR(255) NULL AFTER `caseRefRequestedAt`,
  ADD COLUMN `caseRef` VARCHAR(100) NULL AFTER `caseRefNote`,
  ADD COLUMN `caseRefFilledAt` DATETIME(3) NULL AFTER `caseRef`;
