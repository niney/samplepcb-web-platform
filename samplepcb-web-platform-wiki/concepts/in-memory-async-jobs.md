---
concept: 인메모리 비동기 잡 + 영속 스냅샷 복구
last_compiled: 2026-07-27
topics_connected: [sp-node-api, parts-engine, sp-market-web, sp-vue-web]
status: active
---

# 인메모리 비동기 잡 + 영속 스냅샷 복구 (In-Memory Async Jobs)

## Pattern
오래 걸리는 작업(AI 생성, BOM 엔진 검색)은 **sp-node 가 게이트웨이가 되어 비동기 잡으로 감싼다** — `POST …/run → jobId → GET …/jobs/:id 폴링`. 잡 상태는 **단일 인스턴스 인메모리 전제**로 저장하되, 소실을 전제로 설계한다: 완료 산출물은 DB 에 영속 스냅샷([[snapshot-freeze]])으로 박제하고, 미완료분은 조회 시점 게으른 치유([[lazy-derived-state]])나 재실행으로 복구한다. 외부 엔진 인증·자격증명은 sp-node/엔진 서버에만 두고 브라우저로 내리지 않는다.

**2026-07-20~23 방향 전환**: BOM 트랙에서 "소실 허용"의 범위가 좁혀졌다 — 완료 원문·사용량·중복 방지는 **DB 원장(ledger)으로 영속화**하고, 인메모리로 남는 것은 잡 진행 상태뿐이다. 로드맵 후보였던 "잡 스토어 영속화"가 BOM 검색 계열에서 실제 구현됐다.

## Instances
- **2026-07-20~23** in [sp-node-api](../topics/sp-node-api.md): **영속 원장 전환(BOM 트랙)** — ① 분석 결과는 append-only 정본(`sp_bom_analysis_run/sheet/component`, build 가 원본 잡을 다시 읽지 않음) ② 공급사 검색 완료 원문은 gzip 아티팩트(`sp_bom_supplier_result_artifact`+checksum)로 먼저 보존하고 30초 워커가 무인 복구 ③ 인제스트 중복은 fingerprint 원장(`sp_part_ingest_run`, `leaseUntil`)으로 재시작·**다중 인스턴스**에서도 한 번으로 수렴 ④ 일일 검색 카운터는 `sp_bom_supplier_daily_usage`(mbId+KST dayKey)로 DB 이관
- **2026-07-18~20** in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **BOM 엔진 잡** — `engine-client.ts` 가 parts-engine FastAPI(:8400)를 HTTP async job 으로 호출, 후보는 `sp_bom_quote_candidate` 로 박제, searching 상태 견적의 GET 이 엔진 잡 상태를 확인해 수렴(게으른 치유). 공급사 API 키는 엔진 `.env` 전용
- **2026-07-12~16** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md): **AI 유스케이스 잡** — `POST /api/ai/:useCase/run` → jobId → 5초 폴링. 인메모리 잡 스토어 + 재시도, 산출물(구성도·ROC·포스팅 카드)은 프로젝트에 영속. 위저드 v2 의 선분석·인터뷰도 같은 잡 계층 위
- ⚠ **[2026-07-20 이전, 대체됨]** "일일 검색 카운터 등 경량 인메모리 상태(재기동 시 소실 허용)" — 07-23 에 DB 원장으로 **대체**. 현재 인메모리로 남은 것은 AI 잡과 **최초 파일 파싱 잡·잡 소유 맵**(prepare 전 재시작 = 재업로드 안내)뿐. FE(sp-vue·sp-market)는 여전히 잡 상태를 폴링 소비만 한다

## What This Means
큐 인프라(Redis·BullMQ) 없이 비동기를 도입하는 이 코드베이스의 표준 형태다. 성립 조건도 진화 경로도 명확해졌다: 시작은 "① 산출물이 DB 스냅샷으로 남아 잡 소실이 재실행 가능한 불편에 그칠 것 ② 단일 인스턴스일 것"이지만, **소실이 "불편"을 넘어 비용(외부 API 재호출·사용량 한도·중복 인제스트)이 되는 지점부터 그 부분만 DB 원장으로 승격**한다 — 전용 큐 도입 없이 원장(fingerprint unique·leaseUntil·gzip 아티팩트+복구 워커)으로 다중 인스턴스 내성까지 확보하는 것이 BOM 트랙이 만든 선례다. 새 장시간 작업은 여전히 이 계층(run→jobId→폴링+스냅샷+치유)을 재사용하되, "소실되면 돈이 드는" 산출물은 처음부터 원장 쪽에 두는 것이 관례가 됐다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [parts-engine](../topics/parts-engine.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
