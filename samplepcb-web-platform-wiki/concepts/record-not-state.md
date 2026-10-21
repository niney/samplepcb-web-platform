---
concept: 상태 기계는 포크하지 않고 기록으로 넓힌다 (Record, Not State)
last_compiled: 2026-10-12
topics_connected: [partner-tracks, api-contract, sp-node-api, sp-vue-web, docs-knowledge]
status: active
---

# 상태 기계는 포크하지 않고 기록으로 넓힌다 (Record, Not State)

## Pattern
새 업무 단계가 필요해질 때마다 **상태 값을 늘리거나 상태 기계를 두 벌로 가르는 대신, 기록 필드 하나(시각·주체·형식)와 그 기록을 읽는 판정 함수를 더한다.** 근거는 매번 같다 — 상태 사전은 혼자 쓰이지 않는다. PCB 발주 5단계에는 워크큐·12단계 표시·선적·MD 관전·메일·e2e 31본이 물려 있고, 선적 상태 사전은 BOM 과 PCB 가 함께 쓴다. 거기에 단계 하나를 끼우면 **묻지 않은 화면이 전부 바뀌고**, 한쪽 역할의 진행이 다른 쪽 클릭에 묶인다.

그래서 세 조각이 한 벌로 움직인다:

1. **기록** — `shipConfirmedAt/By`, `format: message|items`, `canceledAt`·`purgeAfter`, Case ID 의 `caseRefRequestedAt`·`caseRefFilledAt`. 일어난 사실만 적고, 일어나지 않은 사실은 지어내지 않는다(관리자가 확인 없이 다음 단계로 넘기면 확인 기록은 `null` 그대로).
2. **판정 함수** — 기록을 직접 읽지 않고 계약(`@sp/api-contract`)의 순수 함수 하나를 거친다([judgment-single-owner](judgment-single-owner.md)). 이 조각이 빠지면 패턴이 결함이 된다(아래 08-16).
3. **가상 단계·차례 신호** — 화면에는 단계처럼 보이지만 저장된 상태가 아니라 조회 시점 파생이다([lazy-derived-state](lazy-derived-state.md)).

## Instances
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): **협력사 '선적 완료' = 상태가 아니라 기록** — 국제 발송에서 협력사의 일을 끝내는 자리를 `sp_pcb_shipment.shipConfirmedAt/By` 와 판정 둘(`pcbShipConfirmPending`·`pcbShipmentSenderDone`)로 냈다. 선적 상태 사전이 BOM 과 공유라 단계를 끼우면 BOM 화면이 전부 바뀌고 관리자 진행이 협력사 클릭에 묶인다. 포털 스텝퍼의 '선적 완료' 칸은 가상 단계(`lib/pcb-ship-steps.ts`)이고, 관리자가 미확인 채 국내도착으로 넘기면 협력사 쪽은 끝난 것으로 보되 확인 기록은 비워 둔다
- **2026-10-11** in [api-contract](../topics/api-contract.md) / [partner-tracks](../topics/partner-tracks.md): **추가 EQ 요청은 전이 사전을 트랙으로 가르지 않고 트랙별 문턱으로** — `PCB_EQ_REOPEN` 은 되돌리기 사전과 다른 축이고 스텐실은 `canReopenPcbEq` 가 막는다. 부작용도 같이 왔다: `issued` 가 더는 "아직 아무것도 안 낸 상태"가 아니어서(승인됐다 다시 열린 건일 수 있다) 파일 삭제 판정에 `isPcbEqFileRecord`, 워크큐 반려 표시에 `lastPcbEqReworkBoundary` 가 필요해졌다 — 상태를 안 늘린 값은 **판정 함수가 늘어나는 것**으로 치른다
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md) / [docs-knowledge](../topics/docs-knowledge.md): **D20 EQ 문항형 회차** — 새 원장을 만들지 않고 D16 원장 `sp_pcb_eq_review` 에 `format`·`version`·문항·이벤트를 더했고, 발주 상태 머신은 그대로다. 설계 절이 "상태 머신은 포크하지 않는다 — 원장을 회차로 넓힌다"를 구조 원칙으로 명문화했다(스텐실의 교훈이라고 적는다). 고객 확인 회차 번호·발송 여부도 저장이 아니라 파생
- **2026-10-09** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md): **같은 근거의 반대 결론** — BOM 마스터딜러 하위 발주는 `sp_bom_po` 에 발주처 컬럼을 더하지 않고 **별도 표**(`bom-md-po.ts`)로 냈다. 발주 원장을 읽는 조회가 60여 곳(입고 스캔·선적 묶음·부족분 복구·고객 진행 파생)이라 한 곳이라도 못 거르면 판정이 틀린다. PCB 는 같은 일을 한 표에 발주처를 두고 푼다 — 기준은 "넓히느냐 가르느냐"가 아니라 **이미 물려 있는 독자가 몇이냐**다
- **2026-10-05** in [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): 고객 BOM 견적 취소 = **"아무 일도 하지 않는 기록"** — 취소가 삭제를 겸하던 것을 `canceledAt`·`purgeAfter` 기록으로 바꿨다. 자동 정리의 정상 여부(`backlog`)도 실행 이력 테이블 없이 **데이터에서** 센다
- **2026-08-16~17** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md): **메탈마스크 = status 포크 없이 category 파생 트랙** — `PCB_PO_TRACKS` eq|stencil 이 라벨·게이트만 가른다(좌표파일 필수·문의 선택). 포크했다면 워크큐·12단계·선적·MD·메일·e2e 31본이 두 벌이 됐을 것. 이후 결정들이 "스텐실의 교훈"으로 되짚는 원형
- **2026-08-16 (이 패턴이 결함이 되는 조건)** in [api-contract](../topics/api-contract.md): 반려와 요청취소는 **같은 전이**(`eq_requested→issued`)이고 `note` 유무로만 갈린다 — 상태를 늘리지 않고 기록으로 가른 가장 이른 사례인데, 그 규칙을 네다섯 화면이 각자 복제해 요청취소가 반려로 읽혔다. `isPcbEqRejectionEvent` 하나로 모은 뒤에야 닫혔다

## What This Means
이 리포에서 "단계를 추가해 달라"는 요청의 기본 답은 **상태 추가가 아니다.** 먼저 물을 것은 그 상태 사전을 누가 읽느냐이고, 읽는 곳이 많을수록 기록+판정 쪽이 싸다. 10월의 세 건(D20·선적 완료·추가 EQ)이 하루 안에 같은 문장으로 결정된 것은 08월 스텐실에서 값을 한 번 치렀기 때문이다.

대신 값은 다른 데서 낸다. ① **판정 함수가 늘고, 그것을 안 거치는 코드가 곧 결함**이다 — "끝났다"를 `receivedAt` 이나 마지막 단계로 직접 판정하면 보드 건수와 완료 내역이 어긋난다. ② **같은 상태가 여러 뜻을 갖게 된다**(`issued` = 처음 / 반려 뒤 / 다시 열림) — 상태 이름만 보고 분기하던 옛 코드가 조용히 틀린다. ③ 문서와 e2e 가 "단계"라는 낱말을 계속 쓰므로 가상 단계와 저장 상태를 구별해 읽어야 한다.

반례도 기록해 둔다. **파생으로 표현할 수 없는 사실은 저장으로 돌아간다** — 마스터딜러 판정은 "하위 링크가 하나라도 있으면"(파생)이었다가 2026-10-10 에 `isMasterDealer` 저장 표시가 됐다(하위 없이 처음부터 지정해야 했다). 기록으로 넓히는 것은 수단이지 교리가 아니다.

## Sources
- [partner-tracks](../topics/partner-tracks.md)
- [api-contract](../topics/api-contract.md)
- [sp-node-api](../topics/sp-node-api.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — D16·스텐실 트랙·D20 설계·협력사 '선적 완료' 확인
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) — §6.43 하위 발주를 별도 표로
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — 취소와 보존 기간
