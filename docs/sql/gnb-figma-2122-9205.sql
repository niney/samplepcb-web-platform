-- GNB(헤더 메뉴)를 Figma 「top_submenu」(2122:9205)대로 — 2026-09-06
-- 그누보드 메뉴는 관리자 > 환경설정 > 메뉴설정(g5_menu) 데이터라 코드가 아니라 이 SQL 로 맞춘다.
--   · 1차: PCB 설계 · PCB 주문 · 부품 주문 · PCBA 주문 · 회사소개 · 블로그 (18 Medium, gap 30)
--   · 회사소개 2차(피그마 숨김 프레임 2122:9251): About Us · History · Customer · Certification · Location
--   · 아직 갈 곳이 없는 PCB 설계·PCBA 주문·블로그는 '#' (docs/FIGMA_PAGES.md 기록). PCB 주문은 옛 'PCB샘플'(거버 사이트),
--     부품 주문은 옛 'SMARTBOM'(/app/bom) 링크를 잇는다. 운영 적용 시 거버 도메인(local-gerber → gerber)을 바꿀 것.
-- 적용: mysql --default-character-set=utf8mb4 -u<user> -p samplepcb < docs/sql/gnb-figma-2122-9205.sql
--       뒤에 data/cache/ 의 menu 캐시가 있으면 지운다(get_menu_db 캐시).
-- me_code: 1차 2자리('10'…), 2차 4자리('5010'…). me_use=PC 노출, me_mobile_use=모바일 노출.

SET NAMES utf8mb4;

DELETE FROM g5_menu WHERE LEFT(me_code, 2) IN ('10','20','30','40','50','60');

INSERT INTO g5_menu (me_code, me_name, me_link, me_target, me_order, me_use, me_mobile_use) VALUES
('10',   'PCB 설계',      '#',                                   'self', 1, 1, 1),
('20',   'PCB 주문',      'https://local-gerber.samplepcb.co.kr', 'self', 2, 1, 1),
('30',   '부품 주문',     '/app/bom',                            'self', 3, 1, 1),
('40',   'PCBA 주문',     '#',                                   'self', 4, 1, 1),
('50',   '회사소개',      '/about',                              'self', 5, 1, 1),
('5010', 'About Us',      '/about',                              'self', 1, 1, 1),
('5020', 'History',       '/history',                            'self', 2, 1, 1),
('5030', 'Customer',      '/about#customer',                     'self', 3, 1, 1),
('5040', 'Certification', '/history#certification',              'self', 4, 1, 1),
('5050', 'Location',      '/location',                           'self', 5, 1, 1),
('60',   '블로그',        '#',                                   'self', 6, 1, 1);
