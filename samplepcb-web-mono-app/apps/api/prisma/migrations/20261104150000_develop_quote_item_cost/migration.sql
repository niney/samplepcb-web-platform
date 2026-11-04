-- 개발의뢰 견적 항목 내부 원가(2026-11-04, docs/DEVELOP_FLOW.md §5.1) — 원가 단가·업체명, 관리자 전용.
-- 원가 금액 = 원가 단가 × 항목 수량. 비우면 원가 미입력 줄. 고객 응답·인쇄 시트·엑셀에는 싣지 않는다.

ALTER TABLE `sp_develop_quote_item`
  ADD COLUMN `costPrice` INTEGER NULL,
  ADD COLUMN `vendor` VARCHAR(100) NULL;
