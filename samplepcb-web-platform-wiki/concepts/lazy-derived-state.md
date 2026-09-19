---
concept: cron 없는 lazy 파생 상태
last_compiled: 2026-09-19
topics_connected: [sp-node-api, partner-tracks, sp-develop-web, sp-vue-web, spcb-bridge, api-contract, sp-market-web, parts-engine]
status: active
---

# cron 없는 lazy 파생 상태

## Pattern
시간 경과·외부 이벤트로 바뀌어야 하는 상태(마감, 결제 확인, 자동 확정, 진행 단계)를 **스케줄러/cron 으로 미리 갱신하지 않고, 조회·액션 시점에 lazy 하게 판정·승격**한다. 저장된 상태는 "마지막으로 확인된 값"일 뿐이고 진실은 매 요청 시점의 재계산이다. 별도 데몬이 없어 배포·로컬 환경이 단순해지고, [server-single-truth](server-single-truth.md)와 결합해 "클라이언트가 본 상태"와 "서버 판정"의 불일치를 요청 시점에 흡수한다.

2026-08~09 에 이 패턴은 **"아예 저장하지 않는다"** 쪽으로 더 갔다. 협력 트랙의 12단계 타임라인·워크큐 대기 큐·고객 진행 표시·`bom-orders` 주문 축은 컬럼이 없다 — 원장(RFQ·PO·선적·od·`sp_file`)에서 조회 시점에 계산해 내려준다. 덕분에 영카트 `od` 를 **무접촉**으로 두고도 고객이 제작 진행을 본다. [snapshot-freeze](snapshot-freeze.md)와는 정확히 반대편 짝이다 — 결정 시점의 **사실**은 굳히고, 원장에서 다시 셀 수 있는 **상태**는 굳히지 않는다.

## Instances
- **2026-09-05~11** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): **`ensureDevelopLazy` 3종** — 마일스톤 paid 승격(영카트 라인 `ct_status ∈ PAID ∧ io_id==paymentKey ∧ io_price==amount` 을 조회 시점 검증, **단방향 래칫**이라 되돌지 않는다) · `reviewDays` 자동확정 · 견적 `validUntil` 만료. 첫 paid 가 `accepted→in_progress` 를 연다. 여기에 납품확인서 자동 동기화(`closeDeliveryConfirmDocs`)가 붙어 문서 상태도 액션 경로에서 수렴한다. cron 없음
- **2026-08-25** in [partner-tracks](../topics/partner-tracks.md) / [spcb-bridge](../topics/spcb-bridge.md): **주문 진행 표시 = od 무접촉 파생**. 트랙 공용 `/api/order-progress` 가 PCB 7칸·BOM 6칸을 조회 시점에 만들고 PHP 주문내역과 Vue 관리자 드로어가 **같이** 소비한다. PHP 쪽 `sp_order_customer_steps()` 는 결제 뒤·배송 전 구간에서만 이 파생이 od 배지를 덮게 우선순위를 준다 — g5 미러 컬럼을 두지 않는다
- **2026-08-05~11** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): **워크큐 대기 큐가 파생** — `todo_rfq`/`todo_po`(PCB Case 탭 7 = 구간 5 + 대기 2)는 RFQ/PO 행이 없어도 모수에 들어야 해서 저장 대신 계산한다. 배지는 "대기 + 진행 중 내 차례" 합산이고 `_legacy` 이관분은 **대기 큐에서만** 제외한다(안 하면 요청 330·발주 195건이 눌러앉아 실제 6·5건을 덮는다)
- **2026-08-11** in [api-contract](../topics/api-contract.md): 파일 축의 파생 두 가지 — `isLatest`(종류별 최신, 판정 키는 writeDate 가 아니라 **fileId**; `inquiry` 만 누적 예외)와 `afterReject`(반려↔재요청 사이에 새 파일이 있는가). 저장 플래그가 아니라 목록을 훑어 붙이므로 첨부가 늘어도 이력이 안 꼬인다. `partnerHasPortal`(대행 필요 배지)도 같은 결의 조회 시점 파생이다
- **2026-08-10** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): **12단계 타임라인은 저장이 아니라 계산**(`smartbomStepOf`·`PCB_STEPS`). 주문·결제 상태도 `ctId→g5_shop_cart→g5_shop_order` 조인 파생이고 `bom-orders.ts` 는 **전부 파생**(주문 축 워크큐에 저장이 없다)
- **2026-08-10~22** in [sp-vue-web](../topics/sp-vue-web.md): 화면 쪽 파생 둘 — 관리자 **활성 모듈은 라우트 이름 접두에서 순수 파생**(`resolveAdminModuleKey`)이라 북마크·새로고침에도 메뉴가 안 어긋나고(레거시 `useAppMode` 함정 회수), 포털 배지 8종은 홈 카드와 **같은 vue-query 캐시**(`usePartnerWork`)를 구독해 숫자 불일치와 추가 요청이 구조적으로 0 이다
- **2026-09-09~10** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 관리자 큐의 `signals`(`docs_awaiting`·`inquiries_open`·`reply_overdue`)는 문서·이벤트 파생이라 **DB 로 잘라낼 수 없어** 탭 전 행을 메모리에서 페이징한다 — 파생의 대가를 명시적으로 치른 자리(활성 의뢰 100건 초과 시 서버 탭 전환이 후속 과제)
- **2026-07-19~20**(유지) in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **BOM 견적 `enrichStatus` 게으른 치유** — searching 상태 견적의 GET 이 엔진 잡 상태를 확인해 수렴시킨다. 인메모리 잡 소실도 조회 시점 치유로 흡수([in-memory-async-jobs](in-memory-async-jobs.md))
- **2026-07-08~12**(유지) in [sp-market-web](../topics/sp-market-web.md): 마켓 계약 paid 승격·**7일 자동확정**·입찰 마감 판정이 전부 조회/관리자 액션 경로 — 웹훅·폴러 없음. 개발의뢰가 그대로 물려받았다
- **2026-07-02~06**(유지) in [sp-node-api](../topics/sp-node-api.md): cart↔spec 관계를 저장하지 않고 **조회 시점 조인 파생**(`ct_id`) — 동기화 로직이 없으니 불일치도 없다. `sp_order_track()` 도 카트 `it_id` 로 매 조회 pcb/bom/generic 을 판정한다
- ⚠ **함정 사례** in [sp-market-web](../topics/sp-market-web.md): `hasDevReview` 배지는 파생이 아니라 **컬럼 존재 기준**이다 — v1 검토서 저장분은 `safeParse` 실패로 null(검토서 없음)이 되는데 목록 배지는 그대로 남는다. "파생처럼 보이는 저장 플래그"가 정확히 이 패턴을 어긴 자리

## What This Means
"이 상태 언제 갱신돼요?"의 답이 "누군가 볼 때"인 설계다. 새 시간 종속 기능(만료·자동 전이·진행 단계)을 붙일 때 cron 부터 찾지 말고 **lazy 판정 지점을 먼저 검토**하고, 원장에서 계산할 수 있는 상태에는 컬럼을 새로 만들지 않는 것이 관례다. 특히 남의 스키마(영카트 `od`)를 건드리지 않고도 화면을 만들 수 있는 유일한 길이 파생이다.

따라오는 함정 셋:
1. **아무도 조회하지 않으면 부수효과도 안 일어난다** — 정산 집계·알림처럼 시간 보장이 필요한 일에는 이 패턴만으로 부족하다. 실제로 시간 보장이 필요한 것들만 서버 타이머로 남아 있다(ES 색인 드레인 1분 · 발송 이력 retention 6시간 · 환율 매일 12:10 KST).
2. **판정이 여러 조회 경로에 흩어지면 경로마다 다른 답이 나온다** — 이 코드베이스는 이것을 판정 함수를 **계약으로 올려** 풀었다([judgment-single-owner](judgment-single-owner.md)): `isPcbEqRejectionEvent`·`isPcbDeliveryOverdue`·`orderPcbEqFiles`·`developProgressSummary` 는 어느 라우트에서 불려도 같은 답을 낸다. 파생과 단일 소유권은 세트다.
3. **파생은 읽기 비용으로 되돌아온다** — 전건 로드+N+1(`loadAdminPcbPoWorkItems`), 서버 전량 반환 후 클라이언트 페이징(포털 워크큐), 메모리 페이징(개발 신호 큐)이 전부 같은 청구서다. PCB 주문 워크큐가 이관 2만 건 때문에 SQL 조인 페이지네이션이라는 "한정 예외"를 받은 것이 전환점의 모습이다.

검증할 때도 파생임을 기억해야 한다 — 워크큐 **기본 탭이 우리 건의 탭이 아니고**(pos=발주 대기·orders=입금 대기), 없는 필드를 읽으면 기본값이 조용히 어서션을 통과한다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [api-contract](../topics/api-contract.md)
- [sp-market-web](../topics/sp-market-web.md)
- [parts-engine](../topics/parts-engine.md)
