ALTER TABLE `sp_market_expert`
  ADD COLUMN `serviceAreas` JSON NULL AFTER `intro`;

UPDATE `sp_market_expert`
SET `serviceAreas` = JSON_ARRAY(
  CASE
    WHEN JSON_LENGTH(`cadTools`) > 0 THEN 'pcb'
    ELSE 'circuit'
  END
)
WHERE `serviceAreas` IS NULL;

ALTER TABLE `sp_market_expert`
  MODIFY COLUMN `serviceAreas` JSON NOT NULL;

ALTER TABLE `sp_market_project`
  ADD COLUMN `serviceAreas` JSON NULL AFTER `category`;

UPDATE `sp_market_project`
SET
  `serviceAreas` = CASE `category`
    WHEN 'artwork' THEN JSON_ARRAY('pcb')
    WHEN 'both' THEN JSON_ARRAY('circuit', 'pcb')
    WHEN 'consult' THEN JSON_ARRAY('etc')
    ELSE JSON_ARRAY('circuit')
  END,
  `category` = CASE `category`
    WHEN 'both' THEN 'system'
    ELSE 'individual'
  END
WHERE `serviceAreas` IS NULL;

ALTER TABLE `sp_market_project`
  MODIFY COLUMN `serviceAreas` JSON NOT NULL;
