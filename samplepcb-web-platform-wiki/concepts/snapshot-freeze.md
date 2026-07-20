---
concept: 스냅샷 박제 + 서버 재계산
last_compiled: 2026-07-20
topics_connected: [sp-node-api, sp-vue-web, sp-market-web, gnuboard-integration, docs-knowledge]
status: active
---

# 스냅샷 박제 + 서버 재계산 (Snapshot Freeze)

## Pattern
외부·가변 원천(가격표, 환율, 공급사 오퍼, AI 산출물, 수수료율)은 **결정(확정) 시점에 스냅샷으로 박제**해 이후 원천 변화와 절연하고, 금액·상태의 최종 진실은 **저장값이 아니라 서버 재계산**으로 유도한다. 스냅샷은 표시·감사·감사추적용 "그때의 사실"이고, 확정 행위(결제·RFQ·계약)는 서버가 다시 계산한 값만 신뢰한다. [[server-single-truth]]가 "클라이언트를 불신한다"면 이 패턴은 **"시간을 불신한다"** — 원천이 언제든 바뀔 수 있으므로 결정 시점의 값을 동결한다.

## Instances
- **2026-07-19~20** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): **BOM 견적** — selectedOffer·orderQty·엔진 후보(sp_bom_quote_candidate)를 박제하고, 수출입은행 환율도 exchangeRateSnapshot 으로 동결. 합계·확정가는 서버 재계산만 진실이며 RFQ 가 확정 종점. 3영역째 동형 반복으로 패턴 확정
- **2026-07-08~16** in [sp-market-web](../topics/sp-market-web.md) / [sp-node-api](../topics/sp-node-api.md): **재능마켓 계약** — 채택 시점 수수료율·정산액(fee/payout) 스냅샷 + AI 인터뷰 requestSnapshot 박제(신선도 서명 2계층 — 원천 입력 해시로 실효 판정). 결제는 앵커 상품 `sp-market-svc` 스냅샷 카트행
- **2026-07-02~03** in [sp-node-api](../topics/sp-node-api.md) / [gnuboard-integration](../topics/gnuboard-integration.md): **거버 견적(패턴 원형)** — quoteId 불변 스냅샷 + 카트행 실등록(io_id=quoteId)으로 코어 가격 재검증 정당 통과. 수량 수정도 PATCH → 전체 재견적(새 quoteId). 가격표 스냅샷 드리프트 실사고([[manual-sync-drift]])가 이 방향을 강화

## What This Means
"이 값이 나중에 바뀌면 어떡하지?"가 나오는 설계 지점의 기본 답이 정해져 있다: 결정 시점에 박제하고, 확정은 서버 재계산으로. 박제 없이 원천을 참조하면 가격표·환율·오퍼 변동이 과거 거래를 소급 오염시키고(실사고 이력), 재계산 없이 박제값만 믿으면 위변조·드리프트에 노출된다 — 둘은 반드시 쌍으로 간다. 거버→마켓→BOM 3연속 동형이므로, 결제·확정이 걸린 새 기능은 이 패턴을 기본값으로 시작하는 것이 관례다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [docs-knowledge](../topics/docs-knowledge.md)
