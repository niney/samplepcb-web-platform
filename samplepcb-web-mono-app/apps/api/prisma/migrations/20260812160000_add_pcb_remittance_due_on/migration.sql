-- PCB 발주 단계의 송금 예정일. 실제 송금일·금액·환율은 sp_pcb_remittance 원장이 정본이고,
-- 이 컬럼은 NET 7 DAYS / CUSTOM PAYMENT DATE 일정과 지연 표시만 담당한다.
ALTER TABLE `sp_pcb_po`
  ADD COLUMN `remittanceDueOn` DATETIME(3) NULL AFTER `paymentTerms`;
