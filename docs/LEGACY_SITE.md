# 레거시 사이트 정보 — samplepcb.co.kr

현재 운영 중인 **프로덕션 원본 사이트**(`https://www.samplepcb.co.kr/`)의 구조·콘텐츠 스냅샷.
플랫폼 현대화(`samplepcb-web` 그누보드 subtree + `sp-vue` 신규 프론트) 작업의 기준점으로 참고한다.

> 조사일 2026-07-02, 홈페이지 기준. 게시판/견적 상세는 미포함(필요 시 추가 조사).

---

## 1. 개요

- **정식명**: PCB온라인플랫폼 샘플피씨비 (SAMPLE PCB)
- **핵심 서비스**: 온라인 Gerber Viewer("Gerber Eyes" 3.0) 기반 실시간 PCB 가격 확인·주문 플랫폼 (PC·모바일)
- **원스톱 범위**: 회로개발 → PCB설계 → PCB제작 → 부품구매 → PCB조립(SMT)
- **플랫폼 기반**: 그누보드5 / 영카트 (URL 구조 `/bbs/`, `/shop/` 에서 확인)

---

## 2. 네비게이션 / 주요 URL

| 메뉴 | 링크 |
|------|------|
| 회로개발 | `/shop/estimate_intro.php?category=circuit` |
| PCB 설계 | `/shop/estimate_intro.php?category=artwork` |
| PCB 주문 (Gerberview) | `/gerberview` |
| PCB 조립 | `/shop/estimate_intro.php?category=assembly` |
| 생산규격 | `/bbs/board.php?bo_table=production_s` |
| 회사소개 | `/bbs/content.php?co_id=about_us` |
| Blog | `/bbs/content.php?co_id=blog` |
| 로그인 | `/bbs/login.php` |
| 회원가입 | `/bbs/register.php` |
| 비회원 주문조회 | `/shop/orderinquiry.php` |
| 견적관리 | `/shop/estimate_list.php` |
| 고객센터(FAQ) | `/bbs/board.php?bo_table=faq` |
| 별점후기 | `/shop/itemuselist.php` |

---

## 3. 제품 & 가격 (실시간 견적)

| 제품 | 시작가 | 사양 |
|------|--------|------|
| Standard PCB | 31,000원~ | FR-4 TG130-140, 2 Layer, 제작 3~4일, 100×100mm |
| Metal PCB | 200,000원~ | 알루미늄 1W 1 Layer, 제작 7~8일, 100×100mm |
| Flexible PCB | 350,000원~ | Polyamid 1 Layer, 제작 7~8일, 100×100mm |
| Metal Mask | 80,000원~ | 국내제작, 300×400mm, Non Frame 타입, 당일/익일배송 |
| PCB 설계 | 200,000원~ | Net 100 이하 |
| PCB Assembly (SMT) | 200,000원~ | 온라인주문, 최소주문수량 없음, 부품 사급&도급 |

---

## 4. 주요 기능

- **Smart BOM / AI 부품매칭(1분)**: PCB 부품 검색 → 전세계 재고 실시간 확인(24h) → 최저가 검색
- **연동 부품 유통사**: Mouser, Digi-Key, element14, LCSC, Texas Instruments, Arrow, Verical, Rochester Electronics
- **개발 7단계 프로세스**:
  1. 프로젝트분석 → 2. H/W·S/W 설계 → 3. PCB 1차 제작 → 4. PCB조립·시험평가 →
  5. 시스템 보완·2차 제작 → 6. 최종 평가 → 7. 납품·A/S 처리
- **강조 가치**: 시간 절약 / 인원 절감 / 소요비용 절감 / 품질 관리

---

## 5. 게시판 / 커뮤니티

- **공지사항**: IoT All-in-One 솔루션 출시, 베트남[호치민] 지사 설립, NuMakers 2025 RTOS, 메탈마스크 보관기한 안내
- **Q&A**: 거버 파일 문의, 견적서 요청 등
- **FAQ**: 양산/샘플 주문법, 표면마감(Surface finished), 메탈마스크 제작시간 등

---

## 6. 회사 정보 (푸터)

- **회사명**: 주식회사 샘플피씨비 · **대표**: 오혜영
- **사업자등록번호**: 331-88-01750
- **통신판매업신고번호**: 2024-경기광명-0624
- **개인정보관리자**: 오혜영
- **주소**: 경기도 광명시 하안로 60 광명SK테크노파크 A-1303, 1407
- **연락처**: Tel 070-8667-1080~1 · Fax 02-6455-4490 · info@samplepcb.co.kr
- **운영시간**: 평일 09:00~18:00 (공휴일 휴무)

### 채널 / 외부 링크

- Facebook · Blog · YouTube
- 네이버톡: `talk.naver.com/WCE3TY`
- 카카오채널: `pf.kakao.com/_svExbT` (ID `samplepcb`)
- 관련 사이트: `korlinx.com` (회로개발 "자세히보기" 연결)
