---
concept: 골든 표가 곧 명세 (Golden as Spec)
last_compiled: 2026-09-19
topics_connected: [shared-packages, parts-engine, testing, sp-node-api, api-contract, partner-tracks, docs-knowledge]
status: active
---

# 골든 표가 곧 명세 (Golden as Spec)

## Pattern
기대값을 **구현 출력에서 유도하지 않는다**. 표(JSON 골든·실파일 코퍼스·실캡처 픽스처)를 도메인에서 먼저 쓰고, 코드가 그 표를 따라간다. `spec-units.cases.json` 은 파일 안 `$comment` 가 스스로 **"이 표가 곧 요구사항 명세"**라 선언하고([shared-packages](../topics/shared-packages.md)), BOM 추출 코퍼스 runner 는 **"엔진 출력에서 기대값을 절대 유도하지 않는다"**를 원칙으로 적는다([parts-engine](../topics/parts-engine.md)).

따라서 골든의 용도는 **회귀 방지이지 발견이 아니다** — 2026-08-24 합성 코퍼스의 결정 문장이 그 말이다. 그럼에도 표를 도메인에서 쓰면 구현을 보기 전에 결함이 드러난다(같은 날 `1k` 가 1 로 읽히던 것과 소계 행이 부품으로 앉던 것 둘을 즉시 잡았다). 표를 고치는 것이 곧 명세 변경이고, 구현이 표를 못 맞추면 **구현이 틀린 것**이다.

이 패턴은 [judgment-single-owner](judgment-single-owner.md)와 짝이다 — FE/BE 가 **같은 함수를 공유**하는 형태가 허용되는 근거가 "골든 벡터가 명세 노릇을 한다"이기 때문이다. 골든이 없으면 공유 함수도, 두 계층의 사전도 조용히 갈린다([manual-sync-drift](manual-sync-drift.md)).

## Instances
- **2026-09-19** in [shared-packages](../topics/shared-packages.md) / [api-contract](../topics/api-contract.md): 구조적 사실 하나 — **계약 패키지엔 테스트 러너가 없다**(`@sp/api-contract` package.json 에 `test` 도 vitest 도 없음). 그래서 계약 순수 함수의 골든·회귀(`market-areas` 14·`develop-areas` 11·`develop-docs` 9+5·`develop-quote` 8 = 47)는 **`packages/utils/src/*.test.ts` 에 살고**, PCB 판정 함수는 `apps/api/src/lib/*.test.ts` 에 산다. 함수를 옮기면 표가 있는 자리를 같이 봐야 한다
- **2026-08-27** in [shared-packages](../topics/shared-packages.md) / [partner-tracks](../topics/partner-tracks.md): 협력사 회신 실효 수량을 `effectiveRfqReplyQty` **한 공식**으로 모으고(폼 금액·RFQ 합계·비교 모달이 같은 함수) 골든이 MOQ→회신수량 한 방향 파생을 고정 — 셋이 각자 반올림하던 시절로 돌아갈 수 없게 만든 것이 표의 역할이다
- **2026-08-24** in [parts-engine](../topics/parts-engine.md): **"합성 코퍼스는 회귀 방지용이지 발견용이 아니다"** — 재고표 병리(헤더 5행 아래·품번의 날짜 변환·앞자리 0 손실·소계 행·병합 셀·전각·숨긴 열)를 3본에 **섞어** 담았다(실제 파일은 그렇게 오고, 겹칠 때가 사고 지점이므로). 처방도 표가 정했다 — 영숫자 없는 값은 버리지 않고 `mpn_needs_review`
- **2026-08-21** in [parts-engine](../topics/parts-engine.md) / [testing](../topics/testing.md): **로컬 회귀 코퍼스**(`local-corpus/bom-extraction/`) — 실 고객 BOM 을 SHA-256 단위로 보관하고 `verify-bom-extraction-corpus.py --check headers|extraction|all` 이 시트 단위 정답(헤더 블록·anchor 허용 행·component 첫 행·금지 행·기대 열)을 검사한다. **정답은 엔진 결과를 보기 전에 원본 셀로 작성**. 실측 206파일·350시트·0이슈, 사람 확인 헤더 정답 111/111. ⚠ `workbooks/`·`manifest.local.json`·`reports/` 는 Git 제외라 **수치는 리포에서 재현되지 않는다**(개인정보 없는 합성본만 `tests/` 에 고정)
- **2026-07-24** in [parts-engine](../topics/parts-engine.md) / [sp-node-api](../topics/sp-node-api.md): `contracts/fixtures/component-record.json` — 엔진(Python)과 sp-node(TS)가 **공유하는 골든**. 계약 식별자(`supplier-candidate-decision-v3`·`search_schema_version`…)가 소비자 계약이라 임의 변경 금지인 것과 같은 결로, 두 언어 사이의 모양을 표가 붙든다
- **2026-07-21** in [testing](../topics/testing.md) / [docs-knowledge](../topics/docs-knowledge.md): **"통합 테스트는 옵트인, 골든 벡터는 명세"**가 같은 날 한 쌍으로 결정됐다 — `PARTS_IT=1` 이 없으면 CI 에서 자동 skip 되는 실 DB·ES 테스트와, 환경 없이도 항상 도는 골든(A 74/74 · B 인제스트 2/2 · C 실 ES 검색 27/27)의 역할 분담. [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) 도 `spec-units.cases.json` 을 같은 문장("요구사항 명세")으로 인용한다
- **2026-07-19** in [shared-packages](../topics/shared-packages.md) / [sp-node-api](../topics/sp-node-api.md): `bom-pricing` — 레거시 `priceService/useEstimate` 규칙을 **검증 가능하게 재구현**하고 서버·FE 가 같은 함수를 import(골든 14 → 현재 17). 다만 합계의 진실은 여전히 서버 재계산이다([server-single-truth](server-single-truth.md)) — 골든은 산식의 명세이지 값의 권위가 아니다
- **2026-07-18** in [shared-packages](../topics/shared-packages.md) / [parts-engine](../topics/parts-engine.md): **"단위 지능은 ES 애널라이저가 아니라 TS 코드에"** — xpse 의 커스텀 토크나이저 방식을 기각한 이유가 정확히 이 패턴이다: 색인과 검색이 같은 파서를 쓰고, **유닛테스트가 가능하며**, 양쪽 불일치의 원천이 차단된다. `parseSpecToken` 의 다중 해석 설계 때문에 골든의 `expect` 는 부분 일치, `si` 는 상대오차 1e-6
- **2026-07-03** in [testing](../topics/testing.md) / [sp-node-api](../topics/sp-node-api.md): **레거시 가격 패리티 골든** — 실캡처 body 매트릭스([samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md), 메뉴 7종+옵션)를 라이브 레거시 API 에 재생해 `legacy-pricing-goldens.json` 으로 저장(`pricing:sync → capture → test`). 오프라인 테스트가 판매가·제작일·무게·eta 를 대조한다. 2026-08-07 가격 계산이 **라이브 가격표 fetch** 로 바뀐 뒤에도 골든은 번들 스냅샷으로 남아 결정론을 지킨다([snapshot-freeze](snapshot-freeze.md))
- **2026-07-18~2026-09** in [parts-engine](../topics/parts-engine.md): 엔진 이식의 첫 규율이 **"패리티 우선·리팩토링 나중"** — pytest 171(이식 시점) → 537 → 수집 기준 **640건/29파일**. 판정 계약이 바뀔 때마다 표가 먼저 늘고 코드가 따라갔다

## What This Means
골든은 테스트가 아니라 **문서**다. 새 산식·새 파서·외부 계약을 만들 때 순서는 ① 도메인에서 표를 쓴다 ② 구현한다 ③ 표를 맞춘다이고, **구현 출력을 복사해 기대값으로 삼는 순간 그 표는 아무것도 지키지 못한다**(그저 오늘의 동작을 박제할 뿐이다).

실무 규칙 넷:
1. **표의 위치를 알아 둘 것** — 계약(`@sp/api-contract`)에는 러너가 없어 표가 `packages/utils`·`apps/api/src/lib` 에 산다. 함수를 옮기면 표도 같이 옮긴다.
2. **재현 가능성을 구분할 것** — `spec-units.cases.json`·`legacy-pricing-goldens.json` 은 리포 안이라 누구나 돌리지만, `local-corpus` 의 실파일·리포트는 Git 밖이라 **수치를 인용할 때 재현 불가를 함께 적는다**.
3. **실패 모드는 "표만 고치기"** — 구현이 안 맞아 표를 고치려 할 때는 그것이 명세 변경인지 먼저 답하라. 명세 변경이면 정본 문서의 같은 절도 같이 바꾼다([exception-ledger](exception-ledger.md)).
4. **골든은 발견 도구가 아니다** — 새 실파일 패턴·새 병리는 코퍼스에 넣기 전에 주행으로 찾는다([journey-recheck-loop](journey-recheck-loop.md)). 표는 그것이 다시 오지 못하게 막는 자리다.

## Sources
- [shared-packages](../topics/shared-packages.md)
- [parts-engine](../topics/parts-engine.md)
- [testing](../topics/testing.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [partner-tracks](../topics/partner-tracks.md)
- [docs-knowledge](../topics/docs-knowledge.md)
