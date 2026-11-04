-- 개발의뢰 설정 — 인건비 기본값(노임 단가표, 2026-11-04, docs/DEVELOP_FLOW.md §5.1).
-- [{role 직무, grade 등급, task 담당 업무, dailyRate 일일 노임비(원/일)}]. 견적 편집기가 인건비 줄로 복사한다.
-- NULL 이면 코드의 처음 값(DEVELOP_DEFAULT_LABOR_PRESETS)으로 답한다 — 설정 화면에서 저장하면 그때부터 이 칸 값이다(시드 불요).

ALTER TABLE `sp_develop_settings`
  ADD COLUMN `laborPresets` JSON NULL;
