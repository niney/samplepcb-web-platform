-- D20 P2 EQ AI 분석(docs/PCB_PARTNER_TRACK.md D20 P2 · docs/PCB_EQ_AI_PROBE.md).
-- 협력사가 승인요청을 누르면 EQ 엑셀을 자동으로 분석해 문항 초안을 만든다. 잡은 기존 sp_ai_job 에 싣되
-- "어느 발주서의 분석인가"를 찾을 수 있게 업무 대상(targetType·targetId)을 더한다(회원 소유 잡은 null).
-- 추가형 마이그레이션 — 기존 행은 그대로다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_ai_job`
    ADD COLUMN `targetType` VARCHAR(32) NULL,
    ADD COLUMN `targetId`   BIGINT      NULL;

CREATE INDEX `sp_ai_job_target_idx` ON `sp_ai_job`(`useCase`, `targetType`, `targetId`, `startedAt`);

-- 문항별 AI 검토 표시(구조·번역·그림 확인 필요) — 관리자 전용.
ALTER TABLE `sp_pcb_eq_review_item`
    ADD COLUMN `aiFlags` JSON NULL;
