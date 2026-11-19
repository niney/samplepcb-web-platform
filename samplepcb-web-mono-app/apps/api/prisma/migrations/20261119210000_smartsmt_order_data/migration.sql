-- SmartSMT 의뢰 데이터 보관(2026-11-19, docs/SMARTSMT_INTEGRATION.md §10).
-- 의뢰 데이터는 samplepcb 가 보관하고 SmartSMT 가 읽어 간다 — 읽어 갈 때 필요한 칸을 더한다.
--   sp_smt_order.title      의뢰 이름(header.title). 없으면 화면이 파일 이름으로 대신한다.
--   sp_smt_quote.processes  이 주문에서 시킨 공정(header.processes) — 목록이 견적서 본문을 읽지 않게 뽑아 둔다.
--   sp_smt_quote.state      SmartSMT 의 작업 상태(state 파트) — 뜻을 보지 않고 받은 그대로 보관했다가 돌려준다.
-- 추가 전용(ADD COLUMN 3개) — 기존 값은 건드리지 않는다. DDL 은 `prisma migrate diff`(스키마 대 스키마)가 낸 그대로다.

-- AlterTable
ALTER TABLE `sp_smt_order` ADD COLUMN `title` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `sp_smt_quote` ADD COLUMN `processes` JSON NULL,
    ADD COLUMN `state` MEDIUMTEXT NULL;

-- 이미 받은 견적 채우기 — 저장해 둔 견적서에서 공정 목록을 꺼낸다. 배열이 아니면(칸 없음 · null) 비워 둔다.
UPDATE `sp_smt_quote`
SET `processes` = JSON_EXTRACT(`envelope`, '$.header.processes')
WHERE JSON_VALID(`envelope`)
  AND JSON_TYPE(JSON_EXTRACT(`envelope`, '$.header.processes')) = 'ARRAY';
