-- 마스터딜러 지정(docs/PARTNER_PORTAL.md "마스터딜러 지정").
-- 그전에는 "하위 소속 링크가 하나라도 있으면 마스터딜러"라는 파생 판정뿐이라, 하위 없이 관리자가
-- 마스터딜러를 만들 수 없었다. 표시를 저장하고, 이미 하위가 있는 조직은 켜 둔다.
-- 추가형 마이그레이션 — 기존 컬럼은 바꾸지 않는다(공유 DB, migrate reset 금지).

ALTER TABLE `sp_partner`
    ADD COLUMN `isMasterDealer` BOOLEAN NOT NULL DEFAULT false;

UPDATE `sp_partner` AS p
    SET p.`isMasterDealer` = true
    WHERE EXISTS (SELECT 1 FROM `sp_partner_relation` AS r WHERE r.`parentPartnerId` = p.`id`);
