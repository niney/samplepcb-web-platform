-- 재능마켓 v5(2026-09-04): 예산 구간을 참고안 수준으로 상향(docs/AI_DEV_REVIEW.md §13.8).
-- 옛 코드는 가장 가까운 새 구간으로 옮긴다. 읽기(asBudgetRange)는 미지 코드를 undecided 로 떨어뜨리므로
-- 이 UPDATE 는 표시값 보존용이다.
UPDATE sp_market_project SET budgetRange = 'under500'   WHERE budgetRange IN ('under300', 'r300_700');
UPDATE sp_market_project SET budgetRange = 'r500_2000'  WHERE budgetRange = 'r700_1500';
UPDATE sp_market_project SET budgetRange = 'r2000_5000' WHERE budgetRange = 'over1500';
