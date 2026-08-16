-- 운송수단(2026-08-16) — 국제 발송의 "무엇으로 나르는가" 축. mode(국내/국제)와 직교한다.
-- 값은 air|sea, 국내 체인(택배)엔 의미가 없어 서버가 국제에서만 저장한다.
-- NULL 을 남기는 이유: 컬럼 default 를 주면 "명시적으로 항공을 고른 발송"과 "이 축이
-- 없던 시절의 데이터"를 영영 못 가른다. 표시·게이트는 읽는 쪽에서 'air' 로 접는다
-- (계약 pcbTransportOf). 운송서류는 이 값에서 갈린다 — 항공 AWB / 해상 B/L.
ALTER TABLE `sp_pcb_shipment`
  ADD COLUMN `transport` VARCHAR(8) NULL AFTER `destinationCountry`;
