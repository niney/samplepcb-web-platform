-- PCB 발주 이행 방식 박제(2026-08-18) — 같은 MD도 건별로 직접 제작 또는 하위 위임 가능.
-- 관계 보유 여부를 매 조회마다 다시 해석하면 직접 회신 건까지 하위 발주 대기로 막히므로,
-- 발주 생성 시 self|delegated 를 저장한다. 공유 DB additive migration, migrate deploy 전용.
ALTER TABLE `sp_pcb_po`
  ADD COLUMN `fulfillmentMode` VARCHAR(16) NOT NULL DEFAULT 'self' AFTER `rfqId`;

-- RFQ 연결 건: 하위 회신 선정 흔적이 있으면 위임, 직접 회신이면 직접 제작.
UPDATE `sp_pcb_po` AS p
INNER JOIN `sp_pcb_rfq` AS r ON r.`id` = p.`rfqId`
SET p.`fulfillmentMode` = CASE
  WHEN r.`selectedChildRfqId` IS NULL THEN 'self'
  ELSE 'delegated'
END
WHERE p.`parentPartnerId` = 0;

-- RFQ 없는 레거시/수동 MD 발주는 기존 동작 보존: 하위 관계를 가진 조직이면 위임 대기.
UPDATE `sp_pcb_po` AS p
INNER JOIN `sp_partner_relation` AS rel ON rel.`parentPartnerId` = p.`partnerId`
SET p.`fulfillmentMode` = 'delegated'
WHERE p.`parentPartnerId` = 0
  AND p.`rfqId` IS NULL;

-- 실제 하위 발주가 존재하면 최우선으로 위임. 과거 불완전 RFQ 흔적보다 실행 문서를 신뢰한다.
UPDATE `sp_pcb_po` AS parent
INNER JOIN `sp_pcb_po` AS child
  ON child.`specId` = parent.`specId`
 AND child.`parentPartnerId` = parent.`partnerId`
 AND child.`reorderRound` = parent.`reorderRound`
SET parent.`fulfillmentMode` = 'delegated'
WHERE parent.`parentPartnerId` = 0;
