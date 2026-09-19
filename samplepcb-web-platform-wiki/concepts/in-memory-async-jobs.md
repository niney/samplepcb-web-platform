---
concept: 비동기 잡 — 인메모리에서 DB 원장으로
last_compiled: 2026-09-19
topics_connected: [sp-node-api, parts-engine, api-contract, sp-develop-web, sp-market-web, sp-vue-web]
status: active
---

# 비동기 잡 — 인메모리에서 DB 원장으로 (In-Memory Async Jobs)

## Pattern
오래 걸리는 작업(AI 생성, BOM 추출·공급사 검색)은 **sp-node 가 게이트웨이가 되어 비동기 잡으로 감싼다** — `POST …/run → jobId → GET …/jobs/:id 폴링`. FE(sp-vue·sp-market·sp-develop)는 3~5초 폴링으로 **소비만** 한다. 완료 산출물은 DB 에 영속 스냅샷으로 박제하고([snapshot-freeze](snapshot-freeze.md)), 미완료분은 조회 시점 게으른 치유([lazy-derived-state](lazy-derived-state.md))나 재실행으로 복구한다. 외부 엔진 인증·공급사 API 키는 sp-node/엔진 서버에만 두고 브라우저로 내리지 않는다. **큐 인프라(Redis·BullMQ)는 여전히 도입하지 않았다.**

**2026-08-28 전환 완료** — 07-27 판이 예고한 방향이 끝까지 갔다. ⚠ **[2026-08-28, 대체됨]** "AI 잡 = 인메모리 잡 스토어 + 재시도" 서술은 낡았다: AI 잡은 `sp_ai_job`(DB)로 이전돼 재시작에 견딘다. 이제 지형은 **"돈이 드는 것은 원장, 값싼 진행 상태만 인메모리"** 로 갈린다.

## Instances
- **2026-09-11** in [sp-node-api](../topics/sp-node-api.md) / [sp-develop-web](../topics/sp-develop-web.md): 잡 계층을 **타깃 어댑터로 재사용** — 같은 러너가 `DevReviewTarget {market|develop}`·`DiagramTargetRef` 로 두 트랙을 돌리고 `features.schedule` 은 develop 일 때만 켜져 마켓 프롬프트는 바이트 동일. 잡 저장소·폴링·재사용 규칙(`inputHash` 같으면 1시간 재사용)은 공유하고 도메인만 갈린다
- **2026-09-04~08 (아직 인메모리)** in [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): **정밀 구성도는 프로세스 내 큐 동시 1**(`dev-diagram-runner.ts`, 프로빙 141~581초, 기동 시 `resumeDevDiagramQueue` 로 재개·중단 표기). 잡 레코드 자체는 `sp_ai_job` 이라 살아남지만 **대기열 순서는 프로세스 메모리**다. 고객이 기다리는 `develop.followup` 은 300초 초과·실패·유스케이스 꺼짐이면 **고정 3문항으로 조용히 폴백**한다 — 잡 소실을 기능 소실로 만들지 않는 설계
- **2026-08-28** in [sp-node-api](../topics/sp-node-api.md): **AI 잡 = `sp_ai_job`(DB)** — 인메모리 폐기. 재시작 내성, `useCase`·`mbId`·`inputHash`·`resultJson` 저장, 동일 입력 1시간 재사용, 등록은 `devReviewJobId` 만 보내고 **서버가 소유자·done·inputHash 를 대조**한다(미연결 잡은 방치되지 않고 버려진다). 이유는 단순하다 — 잡 하나가 실 LLM 수백 초이고 고객·관리자가 그 결과를 기다린다
- **2026-08-23** in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **엔진 출력을 통째로 DB 열에 넣지 말 것** — 재고표 12,175행 결과 JSON 6.36MB 를 `previewJson` 에 저장하자 MySQL 패킷 벽에 부딪혀 연결이 끊기고 화면엔 `BOM_ENGINE_ERROR` 로 위장됐다. 처방은 **표본 200행만 저장 + 커밋은 보관 원본 재실행**(추출은 결정론적이라 결과가 같다). "원장에 둔다"가 "원문을 통째로 넣는다"는 아니다
- **2026-08-01** in [parts-engine](../topics/parts-engine.md): 엔진 잡 스토어의 **수명주기 계약** `DELETE /jobs/{id}`(204) — Case 영구 삭제(§6.14)의 엔진 측. 실행 중 스레드는 취소 불가라 **409**, 없는 잡은 **404**(호출부가 멱등 성공 처리), supplier 시작과의 경합은 같은 상태 락에 `deleted` 를 박제해 고아 작업을 막는다. ⚠ 엔진 잡은 **TTL·자동 만료가 없다** — 비우는 경로는 이 DELETE 와 프로세스 재시작뿐
- **2026-07-20~23 (원장 전환의 시작)** in [sp-node-api](../topics/sp-node-api.md): BOM 트랙 4종이 DB 원장으로 — ① 분석 결과 append-only 정본(`sp_bom_analysis_run/sheet/component`, build 가 원본 잡을 다시 읽지 않는다) ② 공급사 검색 완료 원문은 **gzip 아티팩트**(`sp_bom_supplier_result_artifact`+checksum)로 먼저 보존하고 30초 워커가 무인 복구 ③ 인제스트 중복은 fingerprint 원장(`sp_part_ingest_run`, `leaseUntil`)으로 재시작·**다중 인스턴스**에서도 한 번으로 수렴 ④ 일일 검색 카운터는 `sp_bom_supplier_daily_usage`(mbId+KST dayKey)
- **2026-07-18~20 (아직 인메모리)** in [parts-engine](../topics/parts-engine.md) / [sp-node-api](../topics/sp-node-api.md): **엔진 잡은 sp-engine 인메모리 `dict` + ThreadPoolExecutor 4** 이고 sp-node 는 서버측 폴러(5초·10분)+결과 GET 백업 훅으로 수렴시킨다. **최초 파일 파싱 잡**과 **잡 소유 맵**도 인메모리 — prepare 전에 재시작하면 `ENGINE_JOB_GONE` 으로 표면화돼 재업로드를 안내하고(영속 스냅샷이 있으면 `POST /supplier-jobs` 로 재개), 소유는 견적 행의 `engineJobId+mbId` 가 복구한다. searching 상태 견적의 GET 이 엔진 잡 상태를 확인해 수렴하는 것이 게으른 치유
- **서버 타이머 4종(상시)** in [sp-node-api](../topics/sp-node-api.md): 잡이 아니라 주기 작업으로 도는 것들 — ES 색인 큐 드레인 1분 · 부품 정보 복구 워커 30초(10건 직렬) · 발송 이력 retention 6시간(회당 5만 행 청크) · 수출입은행 환율 매일 12:10 KST(USD+CNH). 전부 단일 인스턴스 전제이고 실패해도 다음 주기가 흡수한다
- **2026-08-10~11 (직렬화가 필요한 자리)** in [sp-node-api](../topics/sp-node-api.md): **완납 통지가 동시에 2번 나간 사고**(여정 41호 — 33호가 주석으로 남긴 레이스가 실측됐다) → 발주서별 **프로세스 내 직렬화**. 같은 계열로 동시 조작은 500 이 아니라 도메인 응답이어야 한다(담기=합류 200, 발행=중복 409, 16호). ⚠ **다중 인스턴스는 이월 과제** — 지금 방어는 프로세스 하나를 전제한다
- **⚠ [2026-07-20 이전, 대체됨]** "일일 검색 카운터 등 경량 인메모리 상태(재기동 시 소실 허용)" — 07-23 DB 원장으로 대체. **⚠ [2026-08-28 이전, 대체됨]** "AI 유스케이스 잡 = 인메모리 잡 스토어 + 재시도" — `sp_ai_job` 으로 대체

## What This Means
성립 조건은 그대로다 — **① 산출물이 DB 스냅샷으로 남아 잡 소실이 "재실행 가능한 불편"에 그칠 것 ② 단일 인스턴스일 것**. 바뀐 것은 기본값이다: 예전엔 "인메모리로 시작해서 아프면 원장으로 승격"이었지만, 지금은 **"소실되면 돈이 드는 것은 처음부터 원장에 둔다"** 가 관례다. 돈이 드는 것의 판별 기준 넷 — **외부 API 재호출**(공급사·LLM) · **사용량 한도**(일일 카운터·`max_calls`) · **중복 인제스트**(fingerprint) · **사람이 기다리는 잡**(AI 검토서·후속 질문).

반대로 **인메모리로 남겨도 되는 것**은 "다시 만들면 그만인 진행 상태"다 — 엔진 파싱 잡, 잡 소유 맵, 구성도 큐의 순서, 폴러. 다만 남기기로 했다면 **소실의 사용자 경험까지 설계**해야 한다: `ENGINE_JOB_GONE` → 재업로드 안내, followup 실패 → 고정 3문항 폴백, 기동 시 resume·중단 표기. 엔진 잡 스토어에 **TTL 이 없다**는 것도 같이 기억할 것 — 오래 도는 프로세스는 메모리를 쥔 채 커진다.

큐 인프라는 여전히 없고, 원장(unique fingerprint·`leaseUntil`·gzip 아티팩트+복구 워커)으로 다중 인스턴스 내성까지 확보한 BOM 트랙이 선례다. 남은 구멍은 하나로 좁혀져 있다 — **프로세스 내 직렬화에 의존하는 통지·큐**는 인스턴스를 늘리는 순간 깨진다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [parts-engine](../topics/parts-engine.md)
- [api-contract](../topics/api-contract.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
