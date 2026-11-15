---
concept: cron 없는 lazy 파생 상태
last_compiled: 2026-11-15
topics_connected: [sp-node-api, partner-tracks, sp-develop-web, sp-vue-web, spcb-bridge, api-contract, sp-market-web, parts-engine, smartsmt-integration]
status: active
---

# cron 없는 lazy 파생 상태

## Pattern
시간 경과·외부 이벤트로 바뀌어야 하는 상태(마감, 결제 확인, 자동 확정, 진행 단계)를 **스케줄러/cron 으로 미리 갱신하지 않고, 조회·액션 시점에 lazy 하게 판정·승격**한다. 저장된 상태는 "마지막으로 확인된 값"일 뿐이고 진실은 매 요청 시점의 재계산이다. 별도 데몬이 없어 배포·로컬 환경이 단순해지고, [server-single-truth](server-single-truth.md)와 결합해 "클라이언트가 본 상태"와 "서버 판정"의 불일치를 요청 시점에 흡수한다.

2026-08~09 에 이 패턴은 **"아예 저장하지 않는다"** 쪽으로 더 갔다. 협력 트랙의 12단계 타임라인·워크큐 대기 큐·고객 진행 표시·`bom-orders` 주문 축은 컬럼이 없다 — 원장(RFQ·PO·선적·od·`sp_file`)에서 조회 시점에 계산해 내려준다. 덕분에 영카트 `od` 를 **무접촉**으로 두고도 고객이 제작 진행을 본다. [snapshot-freeze](snapshot-freeze.md)와는 정확히 반대편 짝이다 — 결정 시점의 **사실**은 굳히고, 원장에서 다시 셀 수 있는 **상태**는 굳히지 않는다.

## Instances
- **2026-11-13~14 (경계 — 쓸 때 뽑아 두는 값, 읽을 때 대조하는 값)** in [smartsmt-integration](../topics/smartsmt-integration.md) / [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): SMT 받은 견적 목록은 대부분 이 패턴의 반대편이다 — 목록용 값(최종 금액 `finalTotal`·`quoteStatus`·`blockedBy` …)은 견적서를 **받을 때** `summarizeSmartsmtEnvelope` 로 뽑아 열에 올리고, '최신 견적'도 저장할 때마다 옮기는 포인터 `latestQuoteId`(받은 순서)다. 그래서 '합계 미확정' 탭은 저장된 `finalTotal` null 을 거르는 것이고, 목록·이력 조회는 MEDIUMTEXT 원문 `envelope` 를 읽지 않는다. 반면 **'회원 아님' 표지는 저장하지 않는다** — 목록·상세 응답을 만들 때마다 `owner_mb_id` 를 `g5_member` 와 한 번에 대조하고(`getMembersByIds`), 조회가 실패하면 null(모름)이라 표지를 달지 않는다(모름 ≠ 아님)
- **2026-11-13** in [sp-develop-web](../topics/sp-develop-web.md) / [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md): 개발의뢰 확인 사항 고객 답변의 **파생 둘** — ① 번호가 없던 옛 검토서 문항은 읽을 때 문구 해시로 번호를 얻는다(계약 `devReviewQuestionId` — trim 한 문구의 FNV-1a 32비트를 36진으로; `withDevReviewQuestionIds` 는 있는 번호는 두고 없으면 채우고 겹치면 `-2`…). 저장분을 고쳐 쓰는 작업 없이 서버·고객 앱 등 읽는 쪽마다 같은 번호가 되고, LLM 출력 스키마엔 `id` 가 없어 모델도 번호를 만들지 않는다 ② '지금 답변'(`questionAnswers`)은 저장 칸이 아니라 `question_answered` 이벤트를 조회 때 시간순으로 접은 값이다(같은 문항은 마지막 것, [record-not-state](record-not-state.md)). 함정은 해시 파생의 몫이다 — 작업본 문구를 고쳐 놓고 재공개 전에 고객이 답하면 공개본·작업본 해시가 달라 답이 짝을 잃고(관리자 편집기 아래에 따로 보임), 필드별 복사 `cloneDevelopReview` 가 `id` 를 빠뜨리면 저장 때 해시로 다시 붙는다. 그래서 서버가 번호를 채워 내려주고 편집기는 그 번호를 쥔 채 저장한다
- **2026-10-30~11-03** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 관리자 목록의 `rightsCheck`(역설계 권리 확인 답이 '유지보수 목적'·'상담')·`preQuote`(PCB 설계만 의뢰의 사전 견적 요청)는 저장 컬럼이 아니라 **목록을 낼 때 답에서 파생**한다 — 답에서 셀 수 있으니 컬럼을 만들지 않는다
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md) / [api-contract](../topics/api-contract.md): 협력사 '선적 완료'는 저장된 단계가 아니라 **가상 단계**(기록 `shipConfirmedAt` + 조회 시점 판정), 고객 확인 회차 번호·발송 여부도 파생. 관리자가 미확인 채 다음 단계로 넘기면 협력사 쪽은 끝난 것으로 **보이되** 기록은 생기지 않는다([record-not-state](record-not-state.md))
- **2026-10-10 (반례 — 파생에서 저장으로)** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): 마스터딜러 판정: "하위 소속 링크가 하나라도 있으면"(파생) → **`sp_partner.isMasterDealer` 저장 표시**. 하위 없이 처음부터 마스터딜러로 지정해야 하는 사실은 원장에서 셀 수 없었다. 저장으로 돌아가자 가드가 따라 붙었다(끄기는 `HAS_CHILDREN` 이 막는다) — 파생이 공짜로 주던 정합성을 손으로 지켜야 한다
- **2026-10-05 (경계 — 타이머가 필요한 곳)** in [sp-node-api](../topics/sp-node-api.md): 취소 견적 보존 기간 정리는 lazy 가 아니라 **서버 타이머 6시간**이다. 취소한 고객은 그 견적을 다시 조회하지 않으니 "조회 시점에 판정"할 조회가 없다. 그래도 정상 여부(`backlog`)는 실행 기록이 아니라 데이터에서 센다 — 원칙의 뒤 절반은 유지
- **2026-09-30** in [sp-node-api](../topics/sp-node-api.md) / [spcb-bridge](../topics/spcb-bridge.md): 추가결제 앵커 `sp-bom-extra` 의 paid 승격도 조회 시점 **lazy 라인 검증** — 마켓·개발의뢰에 이은 세 번째 같은 꼴. 마이페이지 배지는 PHP 가 같은 모수를 SQL 로 다시 센다(결제 대기 `orderPending` 은 모수에서 뺀다)
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

2026-11 에 파생은 **식별자**로도 넓어졌다 — 번호가 없던 옛 저장분에 마이그레이션 대신 읽을 때 문구 해시로 번호를 붙였다. 다만 파생 키는 원천(문구)이 바뀌면 같이 바뀌므로, 원천을 고칠 수 있는 곳에서는 한 번 받은 번호를 쥐고 다니게(편집기가 보존) 하는 것이 짝이다. 반대 경계도 섰다 — SmartSMT 처럼 받은 뒤 바뀌지 않는 바깥 원문은 쓸 때 목록 값을 뽑아 두고(큰 원문을 목록이 읽지 않게), 우리 쪽에서 바뀌는 사실(회원 여부)만 읽을 때 대조한다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [api-contract](../topics/api-contract.md)
- [sp-market-web](../topics/sp-market-web.md)
- [parts-engine](../topics/parts-engine.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [packages/api-contract/src/schemas/market-dev-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-review.ts) — `devReviewQuestionId`·`withDevReviewQuestionIds`
