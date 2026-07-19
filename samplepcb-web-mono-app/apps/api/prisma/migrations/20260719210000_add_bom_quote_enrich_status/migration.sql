-- 자동 보강 생명주기 — 서버 소유 단일 진실원본(idle|searching|done|failed).
-- 추가형만(공유 DB) — migrate deploy 로 적용.
ALTER TABLE `sp_bom_quote` ADD COLUMN `enrichStatus` VARCHAR(12) NOT NULL DEFAULT 'idle';
ALTER TABLE `sp_bom_quote` ADD COLUMN `enrichedAt` DATETIME(3) NULL;
