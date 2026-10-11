-- D20 P4 고객 의견 번역(docs/PCB_PARTNER_TRACK.md D20 P4).
-- 고객 의견은 한국어다. 협력사 포털 언어가 영어·중국어면 화면과 회신서 엑셀에 번역문을 원문과 함께 보인다.
-- 번역은 고객 회신이 도착했을 때 한 번 해서 문항에 저장한다 — { en, zh-CN, by: ai|admin, at }.
-- 추가형 마이그레이션 — 기존 행은 그대로다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_pcb_eq_review_item`
    ADD COLUMN `answerCommentI18n` JSON NULL;
