-- 프로토타입 롤백(docs/DEVELOP_FLOW.md §13.4) — Prisma 는 이 파일을 읽지 않는다. 코드를 main 으로 되돌린 뒤(또는 전에) 수동 실행:
--   mysql samplepcb < down.sql
-- 되돌리기 전에 트라이얼 데이터를 보존하려면:
--   mariadb-dump --single-transaction samplepcb sp_develop_document sp_develop_task > ~/workflow-trial-$(date +%F).sql
-- 첨부 원본은 파일서버에 고아로 남는다(무해). 발송된 메일·sp_mail_log 는 되돌리지 않는다.
DELETE FROM `sp_file` WHERE `ref_type` = 'sp_develop_document';
DELETE FROM `sp_develop_event` WHERE `type` IN ('document_sent', 'document_decided');
DELETE FROM `sp_ai_job` WHERE `useCase` = 'develop.doc-mail';
DELETE FROM `sp_ai_usecase` WHERE `useCase` = 'develop.doc-mail';
DROP TABLE IF EXISTS `sp_develop_task`;
DROP TABLE IF EXISTS `sp_develop_document`;
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20260909120000_develop_workflow_docs';
