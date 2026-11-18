-- SmartSMT 견적 — 추정 금액 두 칸(2026-11-18, docs/SMARTSMT_INTEGRATION.md §8 "실제 견적서에서 알게 된 것").
-- 실제 견적서는 확정 금액(total)이 미정(null)인 채로 오고, 가견적을 따로 싣는다:
--   smtEstimatedTotal    quote.estimated_total                    SMT 작업비 추정
--   finalEstimatedTotal  quote.integrated.totals.estimated_total  최종 금액 추정(고객 화면의 "최종합계")
-- 목록은 견적서 본문(envelope)을 읽지 않으므로 열로 뽑아 둔다. 추가 전용(ADD COLUMN 2개) — 기존 값은 건드리지 않는다.
-- DDL 은 `prisma migrate diff`(스키마 대 스키마, DB 무접속)가 낸 것을 그대로 옮겼다.

-- AlterTable
ALTER TABLE `sp_smt_quote` ADD COLUMN `finalEstimatedTotal` DECIMAL(16, 2) NULL,
    ADD COLUMN `smtEstimatedTotal` DECIMAL(16, 2) NULL;

-- 이미 받은 견적 채우기 — 저장해 둔 견적서에서 같은 값을 꺼낸다. 숫자가 아니면(칸 없음 · null) 비워 둔다.
UPDATE `sp_smt_quote`
SET
  `smtEstimatedTotal` = CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(`envelope`, '$.quote.estimated_total')) REGEXP '^-?[0-9]{1,13}(\.[0-9]{1,2})?$'
    THEN JSON_UNQUOTE(JSON_EXTRACT(`envelope`, '$.quote.estimated_total'))
  END,
  `finalEstimatedTotal` = CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(`envelope`, '$.quote.integrated.totals.estimated_total')) REGEXP '^-?[0-9]{1,13}(\.[0-9]{1,2})?$'
    THEN JSON_UNQUOTE(JSON_EXTRACT(`envelope`, '$.quote.integrated.totals.estimated_total'))
  END
WHERE JSON_VALID(`envelope`);
