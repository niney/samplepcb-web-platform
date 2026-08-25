# 마이페이지 재설계 (Figma 103:2361) — 2026-08-25

고객 마이페이지(`/shop/mypage.php`)와 공용 계정 사이드바를 Figma `Samplepcb_Web` 103:2361 에
맞춰 갈아입혔다. 코어 비수정 — 전부 테마(`theme/sp-lite/**`)다.

## 화면 구성

**사이드바(`theme/sp-lite/shop/_account_nav.php`, 공용 SSOT)** — 계정 전 페이지 공유(마이페이지·
주문내역·장바구니·견적관리·제조확인·A/S 접수·포인트·쿠폰·쪽지·스크랩)라 여기 손대면 전부 바뀐다.
- 상단 프로필 카드(아바타·포인트/쿠폰 타일) **폐기** → 이름(마이페이지 링크) + `[정보수정 | 로그아웃]` 알약.
- 그룹: 나의 쇼핑 정보(마이페이지 홈·주문내역·견적 관리·장바구니) · 확인 요청(제조 확인) ·
  혜택(포인트·쿠폰) · 활동(쪽지·스크랩) · 문의(A/S 접수). 회원탈퇴는 하단 작은 링크.
- 아이콘 = 라인 SVG `theme/sp-lite/img/account/ico-*.svg`(`<img>`, 회색 baked). 마스크는 stroke
  아이콘이라 안 보여 폐기.
- 건수는 pill 이 아니라 **우측 정렬 굵은 텍스트** — `.nav_badge`(숫자) + `.nav_unit`(단위). 제조
  확인만 파랑(`.on`, 고객 차례), 나머지 중립. ⚠ `.nav_badge` 안에는 **숫자만** 둔다 —
  e2e(customer-eq-menu·customer-as-menu·여정 44호)가 textContent 를 `Number()` 로 파싱한다.

**콘텐츠(`theme/sp-lite/shop/mypage.php`)** — 카드 상자 없이:
1. **요약 밴드**(`.smb_dash`) 4칸 — 주문내역(전체) · 견적관리(견적대기·견적확정) · 확인요청(제조 확인) ·
   포인트. 각 칸 클릭 → 해당 목록. 견적 건수는 **PCB(sp_order_spec) + 부품 BOM(sp_bom_quote) 합산**
   (대기 = PCB rfq + BOM requested|reviewing · 확정 = PCB quoted·미주문 + BOM answered·확정가·미주문).
   Figma 의 "워킹 파일" 칸은 고객 워킹 확인 단계가 없어 제외 — 확인요청 = 제조 확인 하나.
2. **내 정보**(`#smb_my_ov`) — 기본 **접힘**, `[내 정보 보기]` 토글, `localStorage(sp_my_ov_open)` 기억.
3. **최근 주문**(`#smb_my_od`) — 8건, `orderinquiry.sub.php` 공용, 더보기 버튼 유지.

**주문 목록(`theme/sp-lite/shop/orderinquiry.sub.php`, 마이페이지·주문내역 공용)** — Figma 열 순서로:
주문일 · 주문번호 · **상품명**(첫 카트행 it_name + "외 N건", 240px 말줄임) · 상품수 · 주문금액 ·
결제액 · 미입금액 · 상태. 상태 배지 색은 기존 6단계(`status_01~06`) 유지.

## 색

계정 셸만의 스코프 토큰(`#container.is-account, .account-layout` 에 `--acc-*`)에 **Figma 색값**을 담아
사이트 전역 토큰(`--sp-*`)은 불변으로 뒀다(사용자 결정): primary `#1e64fd` · ink `#0a151e` ·
text `#141e34` · muted `#666` · line `#d9d9d9` · 밴드 `#f0f4fa`/`#c0c6ce`. 레이아웃 그리드는
`200px + gap 40`(Figma). `G5_CSS_VER` 26082503.

## 주문내역 유형 탭 (Figma 103:4215 — 2026-08-25 2차)

`/shop/orderinquiry.php` 에 **전체 / PCB / 부품** 탭(`?track=pcb|bom`).
- **판별키 = 카트행 it_id**(PCB `sp-pcb-std/sp-mask/sp-pcb-adv/sp-pcb-flex` · 부품 `sp-bom-parts`).
  혼합 주문은 D17(같은 유형끼리만 주문)상 없고 실데이터 16,346건에서도 0. 레거시 일반 상품
  주문 1,619건은 어느 탭도 아님 → **전체에서만**(사용자 결정). 설계·SMT 탭은 데이터 축이 없어 미구현.
- **코어 무수정**: 목록·탭·필터는 테마 `orderinquiry.sub.php` 가 담당. 코어 `get_paging` 이
  sub include **뒤에** 실행되는 순서를 이용해 sub 가 `$total_count/$total_page/$qstr` 를
  재계산해 덮는다 — 총건("총 N건" 유지, 탭 추종)·페이지 수·페이지 링크(track 유지)까지 일치.
  탭은 `isset($total_count)` 마커로 주문내역 페이지에서만 렌더(마이페이지 최근 주문 무영향).
- **사이드바 활성 = 다크 필**(`#0a151e`·흰 글씨·아이콘 `filter` 흰색화, 좌우 -12px 알약) —
  전 계정 페이지 공통(사용자 결정). 960px 이하 3열 그리드에선 마진 0.
- **제목** = 아이콘 + '주문내역' 36px — 코어가 넣는 `$g5['title']`('주문내역조회') 표기를
  테마 `shop.head.php` 가 스크립트명 기준으로 오버라이드(코어 무수정).
- **페이지네이션** = Figma `‹ 숫자 ›`(파랑 활성 밑줄) — `get_paging` 마크업·동작 그대로,
  CSS 로 처음/맨끝 숨김·이전/다음을 화살표로. `G5_CSS_VER` 26082507.
- 검증: e2e `orderinquiry-tabs` 5/5(총건=DB count 3종 · 페이지 링크 track 유지 · 폴백 ·
  다크 필 색·아이콘 · 제목 36px · 마이페이지 무영향) + 기존 메뉴 e2e 12/12 회귀.

## 범위 밖(사용자 결정)

글로벌 헤더(PCB 설계/주문/부품/PCBA — Figma 상단 nav)는 현행 헤더와 별건이라 **미작업**.
1:1문의 사이드바 편입도 하지 않음(A/S 접수 한 줄).

## 검증

실브라우저(1440·iPhone 12) 캡처로 밴드·토글·상품명·상태 열·모바일 스택 확인, 표 폭 1040=컨테이너
(상태 열 노출), 가로 오버플로 0. 기존 e2e 21/21 회귀 green.
