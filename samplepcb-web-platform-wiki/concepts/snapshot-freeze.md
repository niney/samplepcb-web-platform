---
concept: 스냅샷 박제 + 서버 재계산 (Snapshot Freeze)
last_compiled: 2026-09-19
topics_connected: [partner-tracks, sp-node-api, api-contract, sp-market-web, sp-develop-web, parts-engine, sp-vue-web, gnuboard-integration]
status: active
---

# 스냅샷 박제 + 서버 재계산 (Snapshot Freeze)

## Pattern
외부·가변 원천(가격표, 환율, 공급사 구매 조건, AI 산출물, 수수료율, 설정)은 **결정(확정) 시점에 스냅샷으로 박제**해 이후 원천 변화와 절연하고, 금액·상태의 최종 진실은 **저장값이 아니라 서버 재계산**으로 유도한다. 스냅샷은 표시·감사용 "그때의 사실"이고, 확정 행위(결제·RFQ·계약)는 서버가 다시 계산한 값만 신뢰한다. [server-single-truth](server-single-truth.md)가 "클라이언트를 불신한다"면 이 패턴은 **"시간을 불신한다"**.

2026-08~09 에 박제 대상이 값에서 **문서와 이력**으로 넓어졌다. 발주서·견적서·프로젝트 문서는 "생성 시점에 굳은 한 벌"이고, 마켓 수정 이력·개발의뢰 검토서 버전 원장은 스냅샷을 **이력으로 승격**한 변형이다. 반대 방향의 규율도 같이 섰다 — **박제하지 말아야 할 것은 파생으로 둔다**([lazy-derived-state](lazy-derived-state.md)). 원장에서 매번 계산할 수 있는 것을 굳히면 동기화 코드가 생기고, 결정 시점의 사실을 안 굳히면 과거 거래가 소급 오염된다.

## Instances
- **2026-09-11** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 문서 5종 중 `kickoff` 의 **계약부 = 수락 견적 스냅샷**(읽기 전용, PATCH 가 원값을 복원한다). 견적은 **발송 시** `supply/vat/total`+마일스톤 금액이 확정돼 설정이 바뀌어도 불변, 문서 재발송은 새 판(`revise`)이며 **첨부는 복사하지 않는다**(파일 행 복제 → 한쪽 삭제가 실파일을 지운다)
- **2026-09-05** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-market-web](../topics/sp-market-web.md): **스냅샷의 이력 승격 두 갈래** — 마켓 `sp_market_project_revision.snapshot` 은 수정 직전 값을 한 덩어리로 담아 필드가 늘어도 스키마가 안 변하고, 개발의뢰 `sp_develop_review_version` 은 `seq`·`kind`·`contentHash`·`parentSeq` 로 검토서 판을 원장화한다(직전 판과 `kind`+`contentHash` 가 같으면 미기록, 복원은 `parentSeq`). 공개본은 작업본의 스냅샷이다
- **2026-08-23** in [parts-engine](../topics/parts-engine.md) / [sp-node-api](../topics/sp-node-api.md): 대형 스냅샷은 **표본만** — 재고표 12,175행 엔진 결과 6.36MB 를 `previewJson` 에 통째로 넣자 MySQL 패킷 한도에서 연결이 끊겼다(화면엔 `BOM_ENGINE_ERROR` 로 위장). 처방은 표본 200행 저장 + 커밋 시 **보관 원본 재실행**(추출이 결정론적이라 결과가 같다)
- **2026-08-21** in [parts-engine](../topics/parts-engine.md): `identity_overrides` 는 **분석 원본을 건드리지 않고 실행 배치에만** 적용되고, 결과는 같은 `identityKey` 의 구매 조건만 병합해 원본 기술 판정을 보존한다. 같은 결로 `storedPartPrioritySearchEnabled`(관리자 토글)는 **실행 시작 시 옵션으로 스냅샷**되어 도중 변경은 다음 검색부터 먹는다
- **2026-08-06~16** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md): **통화·환율 박제 3층** — ① RFQ 통화·환율은 배정/회신/**선정** 시점에 행에 박제하고 조회 재계산 금지(환율은 회신이 아니라 **선정**에서 굳는다, 발주 뒤엔 조직 통화를 바꿔도 불변) ② 송금 KRW 환산은 **송금 시점 환율을 따로** 박제해 환차를 보존한다 — `krwPoAmount ≠ krwPaidAmount + krwBalance` 가 정상이다 ③ 입력통화 원본은 `sub_*`, MD 원가는 `source_*` 에 남는다
- **2026-08-04~18** in [partner-tracks](../topics/partner-tracks.md): 발주서(`sp_bom_po`·`sp_pcb_po`)는 **생성 시점 박제 문서** — 결제 확인(od isPaid) 뒤 발행, VAT 별도, `issued` 만 삭제 가능. 부족분은 문서를 고치지 않고 별도 감사 원장(D31)으로 가고, MD 이행 방식 `fulfillmentMode self|delegated` 도 조직 속성이 아니라 **발주 건별 박제**다(같은 MD 가 건마다 다르게). 선적 mode 는 협력사 `country` 로, 받는측은 생성 시 박제
- **2026-08-04** in [partner-tracks](../topics/partner-tracks.md): PCB 선정은 **확정가 등록 앞단**에 두고 담김/주문 뒤엔 409 — 레거시의 "소급 전파"를 폐기하고 **선확정**으로 문법을 바꿨다. 결제 후 고객 금액 소급 변경 금지도 같은 뿌리(대체 발주 단가 차이는 내부 조달 차이, D31-4)
- **2026-07-28** in [sp-vue-web](../topics/sp-vue-web.md): **화면 코드 스냅샷**이라는 변종 — 관리자 BOM 워크벤치가 고객 BOM 표시 컴포넌트를 복제한 독립 사본(`BomCandidateDrawer` 3,306줄 별본)으로 서서, 고객 화면 개편이 관리자로 자동 전파되지 않게 한다. 대가는 명시적 양쪽 반영이며 계약·훅·`src/bom/` 원본만 공유한다
- **2026-07-21~26**(유지) in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **provenance 박제** — 엔진이 실행 순간 확정한 실제 검색어·fallback 을 `sp_bom_supplier_search_trace` 로, 분석 원문을 append-only payload 로 보존(엔진 신규 필드가 표시 계층보다 먼저 남는다). Walsin 자체 카탈로그 가격은 런타임 조회 대신 **초기화 전 1회 전수 조회한 Git 전달 스냅샷**
- **2026-07-19~20**(유지) in [sp-node-api](../topics/sp-node-api.md): **BOM 견적** — `selectedOffer`·`orderQty`·엔진 후보를 박제하고 수출입은행 환율도 `exchangeRateSnapshot` 으로 동결. 합계·확정가는 서버 재계산만 진실이며 RFQ 가 확정 종점
- **2026-07-08~16**(유지) in [sp-market-web](../topics/sp-market-web.md): 재능마켓 계약 — 채택 시점 수수료율·정산액(fee/payout) 스냅샷 + `requestSnapshot`(검토서 포함) 박제. 결제는 앵커 상품 `sp-market-svc` 의 스냅샷 카트행
- **2026-07-02~03**(유지, 패턴 원형) in [gnuboard-integration](../topics/gnuboard-integration.md): 거버 견적 `quoteId` 불변 스냅샷 + 카트행 실등록(`io_id=quoteId`)으로 코어 가격 재검증을 정당 통과. 수량 수정도 PATCH → 전체 재견적(새 quoteId). 가격표 스냅샷 드리프트 실사고([manual-sync-drift](manual-sync-drift.md))가 이 방향을 강화했고, 2026-08-07 에는 반대로 **라이브 가격표를 계산 직전 fetch** 하도록 뒤집혔다(번들 스냅샷이 실측 최대 10% 어긋남 — 골든만 번들로 남겨 결정론 유지)

## What This Means
"이 값이 나중에 바뀌면 어떡하지?"가 나오는 설계 지점의 기본 답은 정해져 있다: **결정 시점에 박제하고, 확정은 서버 재계산으로.** 박제 없이 원천을 참조하면 가격표·환율·설정 변동이 과거 거래를 소급 오염시키고, 재계산 없이 박제값만 믿으면 위변조·드리프트에 노출된다 — 둘은 반드시 쌍으로 간다. 거버→마켓→BOM→PCB→개발의뢰로 다섯 영역째 동형이므로, 결제·확정이 걸린 새 기능은 이 패턴을 기본값으로 시작한다.

박제할 때 결정할 것은 셋이다. ① **무엇을 굳히나** — 결정 시점의 사실(금액·통화·환율·조건)이지 원장에서 파생 가능한 상태가 아니다. ② **어디에 굳히나** — 행 컬럼(통화·환율), 문서(발주서·견적서), 한 덩어리 JSON(`snapshot`·`previewJson`), 또는 버전 원장(`contentHash`+`parentSeq`). 한 덩어리 JSON 은 필드 추가에 강한 대신 **크기가 곧 사고**이므로 표본+원본 재실행을 기본으로 본다. ③ **변환점이 어디인가** — 환율은 회신이 아니라 선정에서, 금액은 편집이 아니라 발송에서 굳는다. 변환점을 틀리면 "다 맞는데 값이 하루/한 단계 어긋난" 버그가 된다.

DB 백업 매니페스트(SHA-256)도 형태는 스냅샷이지만 성격이 달라 파괴적 작업의 안전장치 쪽으로 읽는다 — [destructive-op-guardrails](destructive-op-guardrails.md).

## Sources
- [partner-tracks](../topics/partner-tracks.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [parts-engine](../topics/parts-engine.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
