-- sp_member_profile.bizZip 확폭 (2026-07-07, sync 리허설 실증)
-- 레거시 mb_10(우편번호 칸)에 주소 문자열이 들어간 오염 데이터 실재(최대 35자) —
-- VARCHAR(20) 저장 절단이 재대조와 충돌해 매회 upsert 진동. 데이터 보존 우선 확폭.
ALTER TABLE `sp_member_profile` MODIFY `bizZip` VARCHAR(100) NULL;
