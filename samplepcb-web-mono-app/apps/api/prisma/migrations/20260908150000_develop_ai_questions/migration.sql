-- 개발의뢰 시스템개발 AI 후속 질문·답(docs/DEVELOP_FLOW.md §7.2.2, 2026-09-08) — additive.
ALTER TABLE `sp_develop_request` ADD COLUMN `aiQuestions` JSON NULL AFTER `production`;
