-- 부품 정본 스펙 충돌 기록 (2026-07-19) — 공급사 간 스펙이 SI 오차(0.5%) 밖으로 갈리는 경우
-- resolvePartFacts 가 채택값(다수결→공급사 신뢰순위→최신)과 함께 전체 그룹을 남긴다.
-- 공유 DB(samplepcb) 관례: 추가 전용 — `prisma migrate deploy` 로 적용.

ALTER TABLE `sp_part` ADD COLUMN `specConflicts` JSON NULL;
