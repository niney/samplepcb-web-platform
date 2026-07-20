---
concept: 인메모리 비동기 잡 + 영속 스냅샷 복구
last_compiled: 2026-07-20
topics_connected: [sp-node-api, parts-engine, sp-market-web, sp-vue-web]
status: active
---

# 인메모리 비동기 잡 + 영속 스냅샷 복구 (In-Memory Async Jobs)

## Pattern
오래 걸리는 작업(AI 생성, BOM 엔진 검색)은 **sp-node 가 게이트웨이가 되어 비동기 잡으로 감싼다** — `POST …/run → jobId → GET …/jobs/:id 폴링`. 잡 상태는 **단일 인스턴스 인메모리 전제**로 저장하되, 소실을 전제로 설계한다: 완료 산출물은 DB 에 영속 스냅샷([[snapshot-freeze]])으로 박제하고, 미완료분은 조회 시점 게으른 치유([[lazy-derived-state]])나 재실행으로 복구한다. 외부 엔진 인증·자격증명은 sp-node/엔진 서버에만 두고 브라우저로 내리지 않는다.

## Instances
- **2026-07-18~20** in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **BOM 엔진 잡** — `engine-client.ts` 가 parts-engine FastAPI(:8400)를 HTTP async job 으로 호출, 후보는 `sp_bom_quote_candidate` 로 박제, searching 상태 견적의 GET 이 엔진 잡 상태를 확인해 수렴(게으른 치유). 공급사 API 키는 엔진 `.env` 전용
- **2026-07-12~16** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md): **AI 유스케이스 잡** — `POST /api/ai/:useCase/run` → jobId → 5초 폴링. 인메모리 잡 스토어 + 재시도, 산출물(구성도·ROC·포스팅 카드)은 프로젝트에 영속. 위저드 v2 의 선분석·인터뷰도 같은 잡 계층 위
- **상시** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): **일일 검색 카운터 등 경량 인메모리 상태** — 재기동 시 소실을 허용하는 설계. FE(sp-vue·sp-market)는 잡 상태를 폴링 소비만 한다

## What This Means
큐 인프라(Redis·BullMQ) 없이 비동기를 도입하는 이 코드베이스의 표준 형태다. 성립 조건이 명확하다: ① 산출물이 DB 스냅샷으로 남아 잡 소실이 "재실행 가능한 불편"에 그칠 것, ② 단일 인스턴스일 것. 다중 인스턴스 확장이나 "잡 자체가 진실"이 되는 순간 이 전제가 무너지므로, 잡 스토어 영속화가 공통 로드맵 후보로 걸려 있다. 새 장시간 작업을 붙일 땐 전용 큐부터 깔지 말고 이 계층(run→jobId→폴링+스냅샷+치유)을 재사용하는 것이 관례다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [parts-engine](../topics/parts-engine.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
