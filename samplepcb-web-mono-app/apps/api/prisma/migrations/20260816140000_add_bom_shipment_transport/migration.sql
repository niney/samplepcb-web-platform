-- 운송수단(2026-08-16) — PCB 트랙에 먼저 세운 축(20260816100000)을 BOM 선적에도 옮긴다.
-- 같은 실물 축을 두 트랙이 다른 어휘로 부르면 협력사가 화면마다 다른 말을 듣는다.
-- 값은 air|sea, 국내 체인(택배)엔 의미가 없어 서버가 국제에서만 저장한다.
-- NULL 을 남기는 이유는 PCB 와 같다: 컬럼 default 를 주면 "명시적으로 항공을 고른
-- 발송"과 "이 축이 없던 시절의 데이터"를 영영 못 가른다.
ALTER TABLE `sp_bom_shipment`
  ADD COLUMN `transport` VARCHAR(8) NULL AFTER `status`;
