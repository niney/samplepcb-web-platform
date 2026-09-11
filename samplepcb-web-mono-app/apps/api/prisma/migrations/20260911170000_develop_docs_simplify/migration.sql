-- 개발의뢰 프로젝트 문서 간소화(docs/DEVELOP_FLOW.md §13, 2026-09-11) — 문서 8종 → 5종, 단계 7 → 6, 수행계획 문서 → 의뢰 컬럼.
-- 운영엔 2026-09-11 기준 문서·업무 행이 없어 아래 데이터 이관은 사실상 no-op 이지만, 있어도 안전하게 옮기도록 쓴다.

-- 1) 프로젝트 일정 3개 — 옛 plan 문서의 세 날짜가 의뢰 컬럼이 된다.
ALTER TABLE `sp_develop_request`
  ADD COLUMN `baseStartOn` VARCHAR(10) NULL,
  ADD COLUMN `plannedEndOn` VARCHAR(10) NULL,
  ADD COLUMN `expectedEndOn` VARCHAR(10) NULL;

-- 2) 최신 발송 수행계획(plan) 문서의 날짜를 의뢰로 옮기고 plan 문서는 지운다.
UPDATE `sp_develop_request` r
JOIN (
  SELECT d.`requestId`, d.`content`
  FROM `sp_develop_document` d
  JOIN (
    SELECT `requestId`, MAX(`sentAt`) AS `latest`
    FROM `sp_develop_document`
    WHERE `type` = 'plan' AND `status` <> 'draft' AND `sentAt` IS NOT NULL
    GROUP BY `requestId`
  ) x ON x.`requestId` = d.`requestId` AND x.`latest` = d.`sentAt` AND d.`type` = 'plan'
) p ON p.`requestId` = r.`id`
SET r.`baseStartOn` = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.`content`, '$.baseStartOn')), ''),
    r.`plannedEndOn` = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.`content`, '$.plannedEndOn')), ''),
    r.`expectedEndOn` = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.`content`, '$.expectedEndOn')), '');
DELETE FROM `sp_file` WHERE `ref_type` = 'sp_develop_document' AND `ref_id` IN (SELECT `id` FROM `sp_develop_document` WHERE `type` = 'plan');
DELETE FROM `sp_develop_document` WHERE `type` = 'plan';

-- 3) 중간검토(design_review)·제작승인(production_approval)·시험검토(test_report) → 단계별 검토·승인(stage_review).
--    (requestId, type, seq, version) 유니크라 세 종류의 번호가 겹치므로 의뢰별로 (옛 type, seq) 묶음 순서대로 다시 매긴다(같은 판들은 같은 번호).
UPDATE `sp_develop_document` d
JOIN (
  SELECT `id`, DENSE_RANK() OVER (PARTITION BY `requestId` ORDER BY `type`, `seq`) AS `rk`
  FROM `sp_develop_document`
  WHERE `type` IN ('design_review', 'production_approval', 'test_report')
) n ON n.`id` = d.`id`
SET d.`type` = 'stage_review', d.`seq` = n.`rk`;
-- 검토 단계 코드: 펌웨어·앱·서버가 한 코드가 됐다.
UPDATE `sp_develop_document`
SET `content` = JSON_SET(`content`, '$.stage', 'firmware_app')
WHERE `type` = 'stage_review' AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.stage')) IN ('firmware', 'app_server');
-- 제목(문서번호+종류 라벨)은 새 접두·라벨로.
UPDATE `sp_develop_document` SET `title` = CONCAT('REV-', LPAD(`seq`, 2, '0'), ' 단계별 검토·승인') WHERE `type` = 'stage_review';
UPDATE `sp_develop_document` SET `title` = CONCAT('KO-', LPAD(`seq`, 2, '0'), ' 계약·개발착수 확인') WHERE `type` = 'kickoff';

-- 4) 업무 단계 7 → 6: 요구사항은 계약·착수로.
UPDATE `sp_develop_task` SET `phase` = 'contract' WHERE `phase` = 'requirements';
