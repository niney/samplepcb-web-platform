---
concept: 판단 단일 소유권 (엔진이 원본)
last_compiled: 2026-07-27
topics_connected: [parts-engine, sp-node-api, sp-vue-web, api-contract, docs-knowledge]
status: active
---

# 판단 단일 소유권 (Judgment Single Owner)

## Pattern
한 종류의 판단(기술 매칭·선택 자격·조달 가능성·검색 조건 유효성)은 **정확히 한 계층이 소유**하고, 다른 계층은 그 결과를 계약 필드로 소비만 한다. 2026-07-21 루트 AGENTS.md "BOM 역할 경계"로 명문화 — sp-engine=BOM 추출·정규화·검색·호환성 **판단의 원본**, sp-node=계약·저장·업무 정책(가격·환율·재고·MOQ·권한·한도), sp-vue=표시 전용(재판정 금지), sp-engine↔sp-vue 직접 연결 금지. [[server-single-truth]]가 "클라이언트를 불신"한다면 이 패턴은 **"중복 구현을 불신"**한다 — 같은 판단이 두 곳에 있으면 반드시 드리프트한다([[manual-sync-drift]]의 코드판 예방).

## Instances
- **2026-07-26** in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **로컬 카탈로그 우선 조회의 역할 분담** — DB 조회는 sp-node가 하되 판정은 엔진 `catalog-evaluate-batch`(외부 호출 0)가 하고, `automatic_selected`인 행만 반영. sp-node는 값 완화·호환성 판단을 중복하지 않는다
- **2026-07-25** in [parts-engine](../topics/parts-engine.md) / [sp-node-api](../topics/sp-node-api.md): **검색 조건 판정 일원화** — 부품 유형별 필수값·조건부 조합·단위 해석을 엔진 `contract.py` 버전 계약+`requirements/capabilities`·`validate` 엔드포인트로 통합하고, sp-node의 부품별 변환 switch·기술 조합 검증을 **제거**
- **2026-07-21** in [parts-engine](../topics/parts-engine.md) / [docs-knowledge](../topics/docs-knowledge.md): **후보 판단 단일화 계약**(`supplier-candidate-decision-v3`, `docs/prompts/sp-engine-candidate-decision.md`) — 후보마다 완결된 `decision`(선택 자격·`identity_key`·`lifecycle_state`)을 반환, 근거 부족은 안전하게 `blocked` 축퇴. sp-node는 `decision` 없는 후보를 옛 자체 규칙으로 복구하지 않고 차단(**fail-closed**)
- **2026-07-21~26** in [sp-vue-web](../topics/sp-vue-web.md): **판정 필드 그대로 렌더 원칙** — `procurementUnavailabilityReason`·`catalogInquiry`·`selection_eligibility` 등을 라벨·배지만 붙여 표시, 재고·필수조건을 재조합해 사유를 추론하지 않는다("금액 없음≠미선정" 같은 오독 방지)
- **상시** in [api-contract](../topics/api-contract.md): **경계를 타입으로 보증** — `BomQuoteLocalCatalogTrace.apiCalls: z.literal(0)`(무료 단계 보증), `policyVersion` 고정 필드, "판정 로직 이중화 금지" 계약 주석

## What This Means
"이 판단을 여기(sp-node/sp-vue)서도 하면 되지 않나"가 나오면 위반 신호다. 필요한 판단이 원본 계층에 없으면 응용 계층에서 추측·보완하지 말고 **원본(엔진)부터 고친다** — 당장 비용이 커 보여도, 중복 판단의 드리프트 비용이 더 크다는 것이 이 코드베이스의 결론이다. 판단 공유는 두 형태만 허용된다: ① **같은 함수를 공유**(`@sp/utils` spec-units·bom-pricing — FE/BE 동일 코드+골든 테스트) ② **판단 결과를 버전 있는 계약 필드로 전달**(엔진 `decision`·trace). 어느 쪽이든 "재구현"은 없다. 엔진 장애 시에도 판단을 대행하지 않고 **stale 축퇴**(기존 선택 보존)로 흡수한다.

## Sources
- [parts-engine](../topics/parts-engine.md)
- [sp-node-api](../topics/sp-node-api.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [api-contract](../topics/api-contract.md)
- [docs-knowledge](../topics/docs-knowledge.md)
