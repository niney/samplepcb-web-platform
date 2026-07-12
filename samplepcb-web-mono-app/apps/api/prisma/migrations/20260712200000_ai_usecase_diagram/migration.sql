-- AI 연동 기반 — 유스케이스 설정 테이블 + 프로젝트 구성도 컬럼.
-- 공유 DB(sp_* 는 그누보드 samplepcb DB 동거) — additive only, 적용은 `migrate deploy` 로만.
-- 기본 행(market.request-diagram)은 서버가 레지스트리 기준으로 lazy upsert 한다(INSERT 없음).

CREATE TABLE `sp_ai_usecase` (
  `useCase` VARCHAR(100) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `model` VARCHAR(100) NOT NULL,
  `promptTemplate` TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`useCase`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AI 생성 시스템 구성도(단일 HTML, 렌더는 sandbox iframe 전용).
ALTER TABLE `sp_market_project`
  ADD COLUMN `diagramHtml` MEDIUMTEXT NULL AFTER `description`;
