-- 재능마켓 v3 — 분야 레지스트리 재설계(docs/AI_DEV_REVIEW.md §13, 2026-09-04).
-- 프로토타입 단계의 sp_market_* 데이터는 버려도 된다(사용자 결정)는 전제로, 옛 컬럼을 지우고
-- 새 모양으로 바꾼다. g5_* 는 건드리지 않는다. sp_file 은 다른 도메인과 공유하므로 nullable 추가만.

-- 첨부 슬롯(분야별 추가자료)
ALTER TABLE `sp_file`
  ADD COLUMN `area` VARCHAR(32) NULL,
  ADD COLUMN `slot` VARCHAR(32) NULL;

-- 전문가: 세부분야·CAD 툴 → 분야별 툴(MarketTools)
ALTER TABLE `sp_market_expert`
  DROP COLUMN `categories`,
  DROP COLUMN `cadTools`,
  ADD COLUMN `tools` JSON NULL;

-- 의뢰: 세부분야·CAD 툴·옛 AI 컬럼 제거, 답변 컬럼 개명, 희망 툴·정밀 구성도 추가.
-- 옛 검토서(v2)·답변(9문항 코드)은 새 파서와 어긋나므로 비운다.
ALTER TABLE `sp_market_project`
  DROP COLUMN `specialties`,
  DROP COLUMN `cadTools`,
  DROP COLUMN `diagramSpec`,
  DROP COLUMN `rocMd`,
  DROP COLUMN `interviewAnswersSharedAt`,
  DROP COLUMN `postings`,
  DROP COLUMN `aiGenerationMeta`,
  CHANGE COLUMN `interviewAnswers` `answers` JSON NULL,
  CHANGE COLUMN `diagramHtml` `devDiagramHtml` MEDIUMTEXT NULL,
  ADD COLUMN `tools` JSON NULL,
  ADD COLUMN `devDiagram` JSON NULL;

UPDATE `sp_market_project` SET `answers` = NULL, `devReview` = NULL, `devDiagramHtml` = NULL;

-- AI 유스케이스: thinking 단계(정밀 구성도 kimi-k3 'high')
ALTER TABLE `sp_ai_usecase` ADD COLUMN `think` VARCHAR(10) NULL;
