---
concept: cron 없는 lazy 파생 상태
last_compiled: 2026-07-13
topics_connected: [sp-node-api, sp-market-web, sp-vue-web]
status: active
---

# cron 없는 lazy 파생 상태

## Pattern
시간 경과·외부 이벤트로 바뀌어야 하는 상태(마감, 결제 확인, 자동 확정)를 **스케줄러/cron으로 미리 갱신하지 않고, 조회·액션 시점에 lazy하게 판정·승격**한다. 저장된 상태는 "마지막으로 확인된 값"일 뿐이고, 진실은 매 요청 시점의 재계산이다. 별도 데몬이 없어 배포·로컬 환경이 단순해지고, [[server-single-truth]]와 결합해 "클라이언트가 본 상태"와 "서버 판정"의 불일치를 요청 시점에 흡수한다.

## Instances
- **2026-07-08~12** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md): **마켓 계약 paid 승격** — 영카트 주문(od) 상태를 조회 시점에 라인 검증하며 lazy 승격, 별도 웹훅·폴러 없음. **7일 자동확정**도 스윕이 조회/관리자 액션 경로에서 실행
- **2026-07-08** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md): **입찰 마감 판정** — 마감 시각을 저장된 플래그가 아니라 요청 시점 비교로 판정, FE는 서버 판정을 소비만
- **2026-07-04~06** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): **PCB 제작 프로젝트 lazy reconcile** — g5 주문 상태와 sp_* 프로젝트 상태를 조회 시점에 대조·파생(cart↔spec도 저장 대신 ct_id 조인 파생)

## What This Means
"이 상태 언제 갱신돼요?"의 답이 "누군가 볼 때"인 설계다. 새 시간 종속 기능(만료, 자동 전이)을 붙일 때 cron부터 찾지 말고 lazy 판정 지점을 먼저 검토하는 것이 관례. 단, 두 가지 함정이 따라온다: (1) 아무도 조회하지 않으면 부수효과(정산 집계·알림)도 영원히 안 일어난다 — 부수효과가 시간 보장을 요구하면 이 패턴만으로 부족하다. (2) 판정 로직이 여러 조회 경로에 흩어지면 경로마다 다른 답이 나온다 — 판정 함수를 한 곳(lib)에 모아 모든 라우트가 공유해야 한다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
