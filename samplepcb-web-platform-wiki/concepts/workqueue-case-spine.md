---
concept: 역할별 워크큐 + 단일 Case 척추 (Workqueue & Case Spine)
last_compiled: 2026-09-19
topics_connected: [sp-vue-web, partner-tracks, sp-develop-web, sp-node-api, api-contract]
status: active
---

# 역할별 워크큐 + 단일 Case 척추 (Workqueue & Case Spine)

## Pattern
BOM·PCB·협력사 포털·개발 네 모듈이 같은 화면 문법을 반복한다. 문법은 다섯 조각이다:

1. **목록 = 역할별 워크큐** — 메뉴가 엔티티(견적·주문·발주·선적)가 아니라 **누가 지금 무엇을 해야 하는가**로 갈린다. 첫 탭은 언제나 그 역할의 **대기 큐**이고, 레거시 이관분은 대기 큐에서만 제외한다.
2. **배지 = "지금 움직여야 하는 수" 하나씩** — 대기 + 진행 중 내 차례의 합산이며, 메뉴마다 딱 하나.
3. **상세 = 단일 Case 척추** — 역할마다 상세 화면을 4벌 만들지 않고 하나를 쓰되, `?from=`으로 무관한 섹션을 **한 줄 접힘 바**로 내린다.
4. **모듈 스위처 + 모듈별 메뉴** — 모듈 간 **화면 공유는 금지**(미러로 따로 구현), 컴포넌트 재사용은 허용([share-render-mirror-domain](share-render-mirror-domain.md)).
5. **URL 이 화면 상태의 정본** — 탭·페이지·검색·진입 경로가 전부 쿼리에 있어 새로고침·뒤로가기·딥링크가 산다.

그리고 이 문법을 떠받치는 것은 저장이 아니라 **파생**이다. 12단계 타임라인·대기 큐 소속·`myTurn`·배지 숫자는 어느 것도 컬럼이 아니고 서버가 원장에서 계산해 내려준다([lazy-derived-state](lazy-derived-state.md)).

## Instances
- **2026-09-16** in [sp-vue-web](../topics/sp-vue-web.md): 모듈 정리 — 통합 안에 얹혀 있던 마켓 4메뉴가 **마켓 모듈**로 독립하고, 중복 BOM 견적요청(`/admin/bom-quotes`)은 **리다이렉트 없이 제거**해 Case 상세로 일원화. 저빈도 메뉴(BOM 업로드)는 `placement:'bottom'`으로 사이드바 하단. 모듈 5종 = 통합·PCB·BOM·개발·마켓
- **2026-09-09~11** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰가 **네 번째 모듈**로 같은 문법을 그대로 받는다 — 통합 메뉴 2개였던 것을 스위처 「개발」 + **단계별 워크큐 8메뉴**(접수·검토 / 견적·계약 / 진행 프로젝트 / 납품·검수 / 문의·A/S …)로, 배지 6종은 전부 "관리자 차례"(`useDevelopModuleSignals` 60초). 상세는 단일 컬럼 1120px + 탭 6(`?tab=`, **`v-show`로 전부 마운트**해 탭 이동에 편집 초안이 안 날아간다). 큐 복귀는 `develop-navigation.ts`가 `lt/ls/lq/lp`를 실어 「← 목록으로」가 떠난 자리로 돌려놓는다 — PCB 가 08-14 에 세운 `pcb-navigation.ts` 규약의 이식
- **2026-08-22** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): **포털 R3 사이드바 셸** — 허브-앤-스포크(홈만 허브)에서 관리자 `AdminLayout` 동형으로 전환하되 홈 '오늘 할 일'은 유지한 하이브리드. 워크큐 목록 4화면(`bom|pcb/rfqs·pos`)에 `useRouteTab.ts`(`?tab=`, 기본 탭은 쿼리에서 생략, 탭 바뀌면 page 리셋), 헤더는 `PartnerPageHeader`로 통일. 결정적인 것은 배지 — **홈 카드와 같은 vue-query 캐시**(`usePartnerWork`)를 구독해 숫자 불일치와 추가 요청을 **구조로** 없앴다. 모듈 스위처는 보유 트랙이 2개일 때만 뜬다(1트랙이면 사이드바 상단 모듈명이 정체성)
- **2026-08-11~14** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): 워크큐가 다루는 축이 넓어진다 — 클레임 큐 편입(08-11), PCB 관리자 **마지막 작업 위치 복원**(7섹션의 섹션·탭을 관리자 mbId 별 localStorage 에, 화면 상태는 URL 로 — 두 저장소의 역할이 갈린다)
- **2026-08-05** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): **대기 큐 + 이관분 제외(D12)** — RFQ/PO/선적 행이 있어야 모수에 들던 3화면에 `PcbTodoQueue`를 편입하고, 배지를 "대기 + 진행 중 내 차례" 합산으로. 이관분(`specJson._legacy`)을 안 빼면 요청 대기 330건·발주 대기 195건이 영구히 눌러앉아 **실제 6·5건이 묻힌다**. 진행현황 기본 탭은 발주·생산 — 완료 2만 건이 모수를 덮지 않게
- **2026-08-02** in [partner-tracks](../topics/partner-tracks.md): **문법의 선언**(SMARTBOM §6.12) — 관리자 메뉴를 역할별 워크큐(견적 / 주문·결제 / 발주 / 선적·배송)로 자르고 발주를 주문·결제에서 분리, 상세는 4벌 대신 `?from=`으로 무관 섹션 접힘. 초기 안이던 `?focus=` 스크롤+강조는 **과잉으로 제거**됐다. 2026-07-29 의 모듈 스위처(D9/D15)가 한 달 먼저 자리를 깔았다
- **2026-08-25 · 09-19 현재** in [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md): 목록·배지·상세가 같은 파생을 본다 — `PCB_STEPS` 12단계·`order-progress` 칸·`bom-orders.ts` 전부·대기 큐(`todo_rfq`/`todo_po`)·`partnerHasPortal`·`overdue`가 모두 계산값이고 FE 는 라벨만 붙인다. ⚠ 다만 `counts` 키 규약은 큐마다 다르다(PO snake_case `eq_pending`, Case camelCase `todoRfq`, Order `toShip`)

## What This Means
새 업무 모듈을 세울 때 이 문법이 **기본값**이다 — 화면부터 그리지 말고 ① 역할을 세고 ② 역할마다 대기 큐를 정의하고 ③ 그 큐의 수가 곧 배지가 되게 하고 ④ 상세는 하나로 두고 `?from=`으로 접는다. 개발 모듈(09-09)이 기획부터 구현까지 빠르게 착지한 것은 이 네 걸음을 새로 발명하지 않았기 때문이다.

지켜야 할 규율 셋:

1. **목록·배지·상세가 같은 파생·같은 캐시를 본다.** 배지를 따로 세면 숫자가 어긋나고 요청이 는다 — 포털 R3 가 `usePartnerWork` 하나로 묶은 것이 정답 형태다.
2. **화면 상태는 URL 에, 진입 기억은 localStorage 에.** 섞으면 새로고침이 상태를 잃거나 남의 북마크가 내 마지막 탭을 연다.
3. **모듈 간 화면은 공유하지 않는다**(D9) — 미러로 짓고 컴포넌트만 재사용한다. 한 모듈의 큐 정의가 다른 모듈을 흔들지 않게 하는 비용이다.

⚠ 그리고 이 문법에는 검증을 조용히 비게 만드는 함정이 하나 있다: **워크큐의 기본 탭은 "우리 건"의 탭이 아니다.** `/admin/pcb/pos`는 '발주 대기'(발주서 **없는** 건), `/pcb/orders`는 '입금 대기', 포털은 `todo`. 방금 만든 건은 기본 탭에 없는 것이 정상이고, RFQ·발주 큐의 기본 대기 탭엔 검색창조차 없다. 화면 검증은 반드시 **탭 클릭 + 검색**으로 좁혀야 하며, 이것이 주행 검증 오탐의 단골 원인이다([journey-recheck-loop](journey-recheck-loop.md)).

## Sources
- [sp-vue-web](../topics/sp-vue-web.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
