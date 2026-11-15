---
concept: 막지 않고 드러낸다 (Surface, Don't Block)
last_compiled: 2026-11-15
topics_connected: [sp-node-api, partner-tracks, sp-develop-web, sp-vue-web, api-contract, smartsmt-integration, infrastructure]
status: active
---

# 막지 않고 드러낸다 (Surface, Don't Block)

## Pattern
본 흐름(돈·상태 전이·사람이 누른 조작)과 거기에 **덧붙은 일**(메일·알림, 기록 원장, AI 분석·번역, 확인 표시)을 가른다. 덧붙은 일이 실패하거나 규칙에서 벗어나도 **본 흐름은 막지 않는다** — 대신 그 실패·편차를 **상태 값이 있는 행**으로 남기고, 그 행을 읽는 화면을 둔다.

반복되는 장치는 넷이다.

- **본 흐름 뒤에 던진다** — 발송·분석은 응답·전이가 끝난 뒤에 돌리고(`void`), 실패는 예외가 아니라 `failed` 행·사유 코드가 된다.
- **기록 원장에는 FK 를 걸지 않는다** — 대상이 지워져도 기록은 남아야 하므로 참조는 `refType/refId`·이름 박제로 둔다.
- **규칙을 넘는 값은 거절하지 않고 표시한다** — 초과 지급은 `over`, 모르는 사양 키는 `unknownSpecKeys`, 미확인 선적은 '확인 대기'.
- **변화가 없으면 행을 만들지 않는다** — 원장이 의미 없는 줄로 차지 않게.

09-19 판에 "부수 원장은 본 흐름을 막지 않는다"(side-ledger-never-blocks)로 처음 관찰했고, 10-12 판에 AI 분석·번역·통지로 넓어져(side-effects-never-block) 보류됐다가, 이번에 "막지 않는 것"과 "드러내는 것"이 짝이라는 점까지 확인돼 승격했다.

## Instances
- **2026-11-13~14** in [smartsmt-integration](../topics/smartsmt-integration.md) / [sp-node-api](../topics/sp-node-api.md) / [infrastructure](../topics/infrastructure.md) / [sp-vue-web](../topics/sp-vue-web.md): **SmartSMT 수신 원장 `sp_smt_receive_log`** — 보내는 쪽은 타임아웃 10초·**재시도 없음**이고 실패를 자기 화면에 `HTTP_<코드>` 로만 띄우므로, "왜 실패했나"는 이 원장(결과 accepted|duplicate|rejected|failed + 응답과 같은 `reason`·`durationMs`·보낸 주소)에서만 찾는다. 읽는 화면도 같이 지었다('연동 상태'의 수신 기록, 결과 필터). 원장 기록 실패는 수신 결과를 바꾸지 않고, 바깥에서 얼마든지 만들 수 있는 인증 실패는 시간당 30건까지만 적는다. 받는 계약은 느슨하다 — 모르는 칸·코드는 거절하지 않고(필수 6칸 밖은 `passthrough`, 화면은 사전에 없는 코드를 **코드 그대로**) "모르는 값이라 거절 = 재시도 없는 상대에게는 데이터 유실"이라 적었다. 10초 타임아웃 상향도 미리 요청하지 않고 `durationMs` 로 지켜본다. 대신 **막는 자리**를 좁혀 정했다 — 인증·형식·번호 불일치·파일 해시 불일치, 그리고 파일 저장이 실패하면 견적을 반쪽으로 남기지 않고 502(다시 보내게). ⚠ 원장의 테두리: 관리자 가져오기(pull)는 이 원장에 남지 않고(서버 로그뿐), nginx·Cloudflare 앞단에서 413 으로 끊긴 요청은 sp-node 에 닿지 않아 원장에도 없다(추정)
- **2026-11-12~13** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 두 자리 — ① 확인 사항 고객 답변은 **필수가 아니고 견적 수락을 막지 않는다**(사용자 결정 ②). 답이 오면 진행 사항의 '확인 사항 답변' 줄과 담당자 알림 메일로 드러난다 ② 16:9 장 배분은 넘침 8% 까지 한 장에 싣고 글자를 줄이며(`zoom` 하한 0.72), 그래도 넘치면 막거나 다시 쪼개지 않고 `data-deck-overflow` 표시만 남긴다 — 그 표시를 읽는 쪽은 e2e 다(`develop-print-deck` 이 0 인지 본다)
- **2026-11-04** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 관리자 연락처 수정은 **바뀐 칸이 없으면 기록하지 않고**, 사용자 결정으로 알림 메일도 보내지 않는다(다음 알림부터 새 주소로) — 덧붙은 일을 아예 만들지 않는 쪽의 선택
- **2026-10-22** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 개발의뢰 고객 메일 2종(담당자 답변 `develop_reply`·중간 확인 요청 `develop_review_request`) — 조작이 끝난 뒤 던지고(`void sendDevelopMail`), 실패는 `sp_mail_log` 의 `failed` 행(사유 포함)으로 남아 관리자 발송 이력 화면에 보인다
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): **PCB EQ 엑셀 AI 분석**은 승인요청 전이·회신 뒤에 던질 뿐 **어떤 실패도 본 흐름을 막지 않는다** — 실패는 계약 사유 코드로만 남는다([ai-removable-layer](ai-removable-layer.md)). 같은 날 협력사 **'선적 완료' 확인**도 관리자 진행을 막지 않는 기록(`shipConfirmedAt/By`)으로 넣었다 — 미확인 채 국내도착으로 넘어가면 뒤늦은 확인은 `SHIP_CONFIRM_UNAVAILABLE` 로 닫힌다([record-not-state](record-not-state.md))
- **2026-10-09** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): 관리자 대리 접속의 쓰기 원장 `sp_partner_act_log` — **기록 실패는 요청을 막지 않는다**(`partner-act-as.ts`), FK 없이 조직명을 박제한다([act-as-actor-stamp](act-as-actor-stamp.md)). BOM 송금 원장은 **초과 지급을 막지 않고 `over` 로 드러내며**, 정정은 삭제 뒤 다시 적는다. 확인 요청의 차액을 담는 `sp_bom_settlement` 도 Case FK 가 없다 — Case 가 지워져도 오간 돈의 기록은 남는다
- **2026-10-05** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): `sp_delete_audit`(FK 없음)에 **읽는 화면**('삭제 기록')이 생겼다 — 그전까지는 쓰기만 하고 볼 곳이 없던 원장이라, 막지 않았지만 드러나지도 않았다([exception-ledger](exception-ledger.md))
- **2026-08-07** in [sp-node-api](../topics/sp-node-api.md): 발송 이력 원장 `sp_mail_log`(`refType/refId` FK 없음, `sent|failed|skipped`+사유) — 메일 래퍼의 4번째 인자로 자동 기록되고, 기록 실패가 발송·본 조작을 되돌리지 않는다
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md): 거버 담기 API 는 모르는 사양 키를 거절하지 않고 `unknownSpecKeys` 로 **보고**한다 — 뷰어가 값 표기를 바꿔도 주문은 서되, 이 보고가 가격이 조용히 0 이 되는 틈의 유일한 신호다([silent-degradation](silent-degradation.md))

## What This Means
"막지 않는다"와 "드러낸다"는 **반쪽씩만 하면 서로 다른 결함**이 된다. 막지만 않고 드러내지 않으면 [silent-degradation](silent-degradation.md) 이다(쓰기만 하던 `sp_delete_audit`). 드러내면 될 것을 막으면 현실이 멈춘다 — 물건은 이미 배에 실렸는데 협력사가 '선적 완료'를 누르지 않았다는 이유로 관리자가 국내 도착을 못 찍는 식이다(그래서 선적 완료는 게이트가 아니라 기록이 됐다). 그래서 둘을 한 쌍으로 짓는다: **상태 값이 있는 행 + 그 행을 읽는 화면**. 행만 있고 화면이 없으면 아직 반쪽이다.

막아야 하는 자리도 이 개념이 가른다. 진행했을 때 **되돌릴 수 없는 고객 쪽 사실**이 생기는 곳 — 돈이 나가거나(완납 통지가 두 번 나간 사고 뒤의 직렬화, [in-memory-async-jobs](in-memory-async-jobs.md)), 판정이 틀린 채 굳거나(fail-closed 결정 계약, [judgment-single-owner](judgment-single-owner.md)), AI 코드가 분기에 들어가는 곳 — 은 막는다. 나머지는 드러낸다.

기록 원장에 FK 를 걸지 않는 것도 같은 판단이다. 원장은 대상보다 오래 살아야 하고(삭제·정리 뒤에도 "누가 무엇을 했나"가 남아야 한다), 원장 쓰기가 대상 쪽 제약 때문에 실패해 본 흐름을 깨면 안 된다. 대가는 고아 행이고, 그것은 [destructive-op-guardrails](destructive-op-guardrails.md) 의 정리 경로가 받는다.

2026-11 SmartSMT 는 **바깥 상대가 재시도하지 않는** 경우의 모양을 보여 준다. 거기서는 막는 것이 곧 잃는 것이라, 거절은 받아들이면 틀린 사실이 굳는 경우(가짜 토큰·다른 번호·다른 파일·반쪽 저장)로만 좁히고 나머지 실패·편차는 원장 한 줄 + 연동 상태 화면으로 드러낸다. 드러내는 짝의 읽는 쪽이 사람이 아닐 수도 있다 — `data-deck-overflow` 는 e2e 가 읽는 표시다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [api-contract](../topics/api-contract.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [infrastructure](../topics/infrastructure.md)
- [apps/api/src/routes/smartsmt-inbound.ts](../../samplepcb-web-mono-app/apps/api/src/routes/smartsmt-inbound.ts) — 수신 순서·실패 사유·수신 원장
- [docs/SMARTSMT_INTEGRATION.md](../../docs/SMARTSMT_INTEGRATION.md) — §4.4 재시도 없음·느슨한 수신·§8 구현하며 정한 것
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.10 넘침 표시·§7.2.13 답은 수락을 막지 않는다
- [apps/api/src/lib/develop-email.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-email.ts) — 발송 실패 → `failed` 행
- [apps/api/src/lib/mail-log.ts](../../samplepcb-web-mono-app/apps/api/src/lib/mail-log.ts) — `recordMailLog`
- [apps/api/src/lib/partner-act-as.ts](../../samplepcb-web-mono-app/apps/api/src/lib/partner-act-as.ts) — 기록 실패는 요청을 막지 않는다
- [docs/MAIL_LOG.md](../../docs/MAIL_LOG.md) — 발송 이력 원장
