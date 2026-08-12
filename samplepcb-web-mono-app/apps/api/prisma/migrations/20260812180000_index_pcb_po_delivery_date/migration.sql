-- 관리자 발주·EQ 목록의 확정 납기 단일일·기간 검색을 DB 범위 조회로 지원한다.
CREATE INDEX `sp_pcb_po_deliveryDate_idx` ON `sp_pcb_po`(`deliveryDate`);
