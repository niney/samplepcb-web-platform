-- 개발의뢰 견적 항목 내부 원가 제거(2026-11-04 저녁 사용자 결정, docs/DEVELOP_FLOW.md §5.1).
-- 같은 날 20261104150000_develop_quote_item_cost 가 더한 원가 단가·업체명 두 칸을 지운다(운영엔 둘이 함께 나가 더했다가 지운다).

ALTER TABLE `sp_develop_quote_item`
  DROP COLUMN `costPrice`,
  DROP COLUMN `vendor`;
