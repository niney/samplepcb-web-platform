---
concept: 고객 확인은 문항으로 쪼개 묻는다 (Itemized Customer Confirm)
last_compiled: 2026-11-15
topics_connected: [partner-tracks, sp-develop-web, sp-node-api, api-contract, spcb-bridge, theme-sp-lite, sp-vue-web]
status: active
---

# 고객 확인은 문항으로 쪼개 묻는다 (Itemized Customer Confirm)

## Pattern
고객에게 확인받을 일이 생기면 이 리포는 "이대로 진행할까요? [승인]/[반려]" 한 덩어리로 묻지 않는다. **요청 1건 = 문항 N개**로 쪼개고, 문항마다 선택지나 답 칸을 두어 문항별로 답을 받는다. 이유는 늘 같다. 한 덩어리 반려로는 "무엇이 싫은지"를 말할 수 없고(D16 문구형은 공장 EQ 표를 담지 못했다), 그렇다고 여러 번 나눠 물으면 답을 기다리는 동안 본 흐름이 멈춘다(D44-4). 원형은 2026-09-30 BOM 부품 확인(D43)이다. 10-11 PCB EQ(D20)가 "같은 모양의 선례"라며 그 형식을 가져왔고, 11-13 개발의뢰 '확인이 필요한 사항'이 세 번째 트랙에서 같은 문법을 **다른 잠금·저장 방식으로** 다시 썼다.

함께 따라다니는 조각은 다섯이다.

- **문항에 안정된 번호를 준다** — 답은 문항 번호에 붙어서, 문구·순서·번역이 바뀌어도 답이 그 문항을 따라간다. 번호와 개정 연결은 사람이나 LLM 이 아니라 결정적 규칙이 정한다.
- **고객이 쓴 칸과 담당자가 정한 칸을 나눈다** — 고객의 답은 근거이고 확정이 아니다. 확정은 담당자의 별도 동작이고(D43 적용, D20 `eq_done`, 개발의뢰 '확인 결과'), 둘 사이에는 단축 버튼 하나만 둔다.
- **누가 답했는지 남긴다** — 대리 회신은 채널·메모와 함께 기록한다([act-as-actor-stamp](act-as-actor-stamp.md)).
- **질문을 굳힌다** — 근거·선택지·질문 문구를 묻는 시점이나 답한 시점에 박제한다([snapshot-freeze](snapshot-freeze.md)).
- **답이 없다고 시스템이 대신 고르지 않는다** — 무응답은 대리 회신으로 메우거나, 처음부터 필수가 아니게 둔다.

10-12 판은 이 후보를 "D43·D20 이 요청 1건=문항 N×선택지·낙관적 잠금·대리 회신 형식을 공유한다 — 사례 2건"이라 보고 [share-render-mirror-domain](share-render-mirror-domain.md)의 사례로만 흡수했다. 11-09 판에서도 새 사례가 없었다. 11-13 의 세 번째 트랙은 형식만 따른 것이 아니라 **어디를 다르게 골라야 하는지**까지 드러냈고, 그래서 이번에 승격한다. 공용 라이브러리는 없다. 셋은 형식만 같고 사전·오류 코드·저장은 트랙마다 따로다.

## Instances
- **2026-11-13** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): **개발의뢰 '확인이 필요한 사항 — 고객이 직접 답한다'**(DEVELOP_FLOW §7.2.13). 답변 칸은 원래 담당자가 상담 뒤 적는 '확인 결과'(`openQuestions[].resolution`) 자리였고, 고객에게 묻는 질문인데도 고객이 답할 길이 없었다. 그래서 **'고객 답변'과 '확인 결과'를 다른 칸으로** 나눴다. 고객 답을 바로 확인 결과로 쓰면 "잘 모르겠다"도 확정처럼 보이고 누가 적었는지가 사라지기 때문이다. 관리자 편집기(새·옛 둘 다)는 답을 보여 주고 [확인 결과로 가져오기]로 옮겨 적는 길만 연다. 자동으로 채우지는 않는다. D20 의 [고객 회신대로 승인]과 같은 자리의 장치다. 답은 `openQuestions[].id` 에 붙는다. 번호가 없는 옛 저장분은 `withDevReviewQuestionIds` 가 질문 문구의 FNV-1a 해시(`devReviewQuestionId`)로 채운다. LLM 출력 스키마에는 `id` 가 없어서 모델은 번호를 만들지 않는다. AI 가 초안을 다시 만들어도 문구가 같은 문항은 번호가 같으니 답이 이어진다. 저장 이벤트 payload 에는 `qid` 와 함께 **그때의 질문 문구**도 적는다
- **2026-11-13 (다르게 고른 지점)** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 개발의뢰가 다르게 고른 곳은 다섯이다.
  - ① **잠금이 문항별이고 한 방향이다.** 요청 전체의 `version` 대신, 공개본에 `resolution` 이 적힌 문항만 409 `QUESTION_RESOLVED` 로 잠근다. 그 전까지 고객은 몇 번이고 고칠 수 있다. 잠금 검사와 이벤트 추가는 트랜잭션 밖에서 한다(동시 수정이 드물다).
  - ② **답이 필수가 아니고 견적 수락을 막지 않는다.** §7.2.13 에는 대리 답변 경로도 없다. 기다리는 흐름이 없으니 대신 답할 이유도 없고, 담당자는 자기 칸에 적는다.
  - ③ **저장은 원장 표가 아니라 `sp_develop_event` 의 `question_answered` 이벤트다.** 바뀐 문항만 적고, 빈 답은 지움이고, 같은 답을 다시 보내면 기록하지 않는다. 처음 낸 '별도 표' 안을 버려서 DB 변경이 없다([record-not-state](record-not-state.md)).
  - ④ **번호를 해시로까지 지어야 했다.** 문항이 표의 행이 아니라, 담당자가 고쳐 재공개하고 AI 가 다시 만드는 **문서(JSON) 안의 항목**이기 때문이다. 대가도 있다. 번호 없는 옛 공개본에 답이 붙은 뒤 작업본 문구를 고쳐 재공개하면 답이 짝을 잃는다. 짝 잃은 답은 고객 화면에 싣지 않고 관리자 편집기 아래에 따로 둔다([audience-split-dto](audience-split-dto.md)).
  - ⑤ **오른쪽 판의 배치가 반대다.** 입력은 오른쪽 판(`QuestionAnswerPanel`)에서 받지만, 문서에 적힌 근거는 D43 관례가 아니라 "장은 높이가 고정이다"(견적 수락과 같은 이유)다. 또 판을 쓰는 쪽이 **고객**이고 관리자는 인라인이어서, D43·D20(관리자=넓은 오른쪽 패널, 고객=주문 상세 인라인)과 배치가 정반대다
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md) / [spcb-bridge](../topics/spcb-bridge.md) / [theme-sp-lite](../topics/theme-sp-lite.md) / [sp-vue-web](../topics/sp-vue-web.md): **PCB EQ 문항형 회차(D20) — 한 덩어리가 문항으로 바뀐 순간.** D16 은 "문구 1개 + 승인/반려 1개"였다. 그래서 공장 EQ 표(문항 N × A/B/C × 그림)를 담지 못했고, 대리 결정이 없었고, 개정 EQ 와는 시각으로만 이어졌다. 설계 절은 "BOM D43 이 같은 모양의 선례라 그 형식을 따른다"고 적는다. 그래서 다음을 D43 에서 가져왔다.
  - `version` 낙관적 잠금: `expectedVersion` 을 쓰고 코드 주석은 'D43-3 관례'라고 적는다. 다만 오류 코드는 `STALE_VERSION` 이 아니라 `VERSION_CONFLICT` 다.
  - 대리 회신: `web` 을 뺀 채널과 메모가 필수이고, 이벤트 `proxy_answered` 로 남는다.
  - 넓은 오른쪽 작업공간: D20-3, "같은 일은 같은 모양".

  문항형에는 통째 반려가 없다. 반대 뜻은 문항마다 선택지와 의견으로 말한다. 식별자는 두 겹이다. 선택지 `key` 는 공장 원문 기호를 그대로 쓴다("번역이 어긋나도 B 를 골랐다는 사실은 어긋나지 않는다"). 개정 회차의 문항은 `prevItemId`·`same|changed|new` 로 잇고, '동일' 문항에는 이전 답을 미리 채운다. 이 대조도 LLM 이 아니라 결정적 규칙(원문 일치 먼저, 그다음 번호)이 한다. AI 는 초안까지만 만들고, 고객 발송은 관리자 검토 뒤다(D20-1). 고객 회신은 새 브리지 `eq-answer` 로 받는다(문구형 `eq-decide` 와 폼·라우트를 나눴다). 화면은 주문 상세 부분 파일 `_pcb_eq_items_round.php` 이고 형식은 D43 섹션을 따랐다
- **2026-10-01** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md): **D44 유형 11개 — 무엇을 문항으로 만들지의 규칙.**
  - **묻는 기준을 한 규칙으로 정했다.** "고객이 받는 것(부품·금액·수량·도착일)이 바뀌면 묻고, 고른 대로 처리한다."
  - **대체품·기다리기·가격을 한 번에 묻는다.** 선택지마다 바뀌는 것과 금액을 함께 적어서, 고르면 둘을 같이 승인한 것이 된다. 고객이 고른 금액으로 확정하고 다시 묻지 않는다.
  - **답할 것이 없는 소식(가격 인하·단종)은 질문으로 보내지 않는다.** 만들자마자 '안내'로 종결해 게이트와 배지에 들지 않는다. 질문과 한 요청에 섞이지 않게 계약 `superRefine` 이 막는다.
  - **유형→허용 선택지 조합은 계약이 갖는다**([judgment-single-owner](judgment-single-owner.md)).
- **2026-09-30** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md) / [spcb-bridge](../topics/spcb-bridge.md) / [theme-sp-lite](../topics/theme-sp-lite.md) / [sp-vue-web](../topics/sp-vue-web.md): **BOM 결제 후 부품 확인 요청(D43) — 이 형식의 원형.**
  - **요청과 잠금.** 요청 1건 = Case × 문제 품목 N이다(`sp_bom_confirm_request`/`_issue`/`_event`). 고객은 한 번에 제출하고, 요청 전체에 `version` 낙관적 잠금(`STALE_VERSION`)이 걸린다.
  - **문항 식별자 = 품목.** 품목당 열린 이슈는 1건이다(`activeKey='item:{quoteItemId}'` unique).
  - **박제와 상담.** 근거와 선택지는 요청 시점에 박제한다. 모든 질문에는 '상담 요청'(`consult`) 선택지가 늘 붙는다.
  - **무응답은 자동으로 정하지 않는다.** 관리자가 고객에게 확인한 뒤 대리 회신하고, 채널과 `answeredRole` 을 남긴다.
  - **고른 것과 적용한 것은 다른 단계다.** 고객이 고른 것(`answered`)과 관리자가 적용한 것(`resolved`)을 나눈다. 원 주문은 그대로 두고 차액만 오간다.
  - **회신 경로.** 고객 회신은 sp-php 쓰기 브리지 `bom-confirm-answer` 를 거쳐 sp-node 로 간다. 메일에는 링크만 있고 결정은 주문 상세에서 POST 로 한다([get-opens-post-decides](get-opens-post-decides.md)).
  - **작성 화면.** 관리자 작성 화면은 사용자가 가운데 팝업을 거부하고 고른 넓은 오른쪽 패널이다(3열: 품목 | 작성 | 고객 미리보기).
  - **열린 이슈는 막는다.** 그 품목 그룹의 발주와 배송을 붙잡는다(409 `CONFIRM_PENDING`). 돈과 부품이 걸린 곳이라 막는 쪽을 골랐다
- **2026-08-07 (덩어리였던 때)** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md): D16 EQ 고객 확인은 문구 1개 + 승인/반려였다. 그래도 이미 사용자 결정으로 "고객 확인은 **관리자 승인의 근거이지 권한 이양이 아니다**"였다. 고객이 승인해도 `eq_done` 은 관리자 몫이었다. 문항으로 쪼갠 뒤에도 이 문장은 세 트랙 모두에 남았다. 고객 칸과 담당자 칸을 나누는 축의 뿌리다

## What This Means
다음에 고객에게 무언가 확인받는 기능을 만들 때, 화면보다 먼저 정할 것이 다섯이다.

1. **문항의 정체성은 무엇인가.** 문항이 표의 행이면(D43 품목, D20 문항) 정체성은 공짜로 생긴다. 담당자가 고쳐 쓰는 문서나 AI 산출물 안의 항목이면 지어야 하고, 짓는 규칙은 결정적이어야 한다(문구 해시, 원문 대조). LLM 에게 번호나 개정 연결을 맡기지 않는다. 번호를 들고 다니는 경로(편집기 복제 `cloneDevelopReview`) 가운데 하나라도 놓치면 답이 **조용히** 짝을 잃는다.
2. **답이 무엇을 닫는가 — 그것이 잠금의 단위다.** D43·D20 에서는 고객 제출 하나가 요청 전체를 `answered` 로 넘기고, 그 답이 돈·생산 결정의 근거가 된다. 그래서 요청 전체에 `version` 을 걸고, 제출 뒤에는 고객이 고치지 못한다(고칠 것은 새 회차나 새 요청으로 온다). 개발의뢰에서는 고객 답이 아무것도 넘기지 않고, 담당자의 확인 결과가 문항을 하나씩 닫는다. 그래서 잠금도 문항별이고 한 방향이다. "낙관적 잠금을 붙일까"보다 "누가 무엇을 닫나"를 먼저 물어야 한다.
3. **고객 칸과 담당자 칸을 나눴는가.** 고객 답을 그대로 확정에 쓰면 모른다는 답도 확정처럼 보이고 작성자가 사라진다. 칸을 나누고, 담당자 쪽에 둘을 잇는 단축 버튼(옮겨 적기, 원클릭 승인)을 두되 자동 채움은 하지 않는다. 선택지가 고정이라 "모르겠다"를 쓸 자리가 없으면 `consult` 같은 상담 선택지를 같이 둔다.
4. **답이 없으면 무엇이 멈추는가.** 멈추는 것이 있으면(D43 의 발주·배송) 막는다. 단, 시스템이 대신 고르지 않고 대리 회신 통로와 주체 박제를 연다. 멈출 것이 없으면(개발의뢰) 필수로 만들지 않고 대리 통로도 만들지 않는다. 이것은 [surface-dont-block](surface-dont-block.md)의 경계, "되돌릴 수 없는 고객 쪽 사실이 생기는 곳만 막는다"를 그대로 따른 것이다. 답할 것이 없는 소식은 질문으로 보내지 않는다(D44 알림). 질문으로 보내면 무응답이 흐름을 멈춘다.
5. **저장은 얼마나 무거워야 하나.** 세 트랙 모두 덧붙이기만 하는 이벤트 원장이 있다. 차이는 그 원장이 **이력**이냐 **저장**이냐다. 답이 게이트·정산을 움직이면 상태가 있는 원장이 필요하다(D43 전용 표, D20 원장 확장). 답이 기록일 뿐이면 기존 이벤트 스트림의 한 종류로 충분하다. 이 경우 진행 기록과 저장이 한 몸이라 어긋날 수 없다. 어느 쪽이든 질문 문구는 답과 함께 굳힌다.

공용화 유혹도 이 개념이 막는다. 세 사례는 형식을 공유하지만 코드는 공유하지 않는다. 유형·선택지 사전, 회신 채널 사전(`BOM_CONFIRM_ANSWER_CHANNELS` 와 `PCB_EQ_ANSWER_CHANNELS`), 잠금 오류 코드(`STALE_VERSION` 과 `VERSION_CONFLICT`)까지 트랙마다 따로다. [share-render-mirror-domain](share-render-mirror-domain.md)의 "모양은 같게, 사전은 격리"다. 공통 '확인 요청 엔진'을 만들자는 제안이 나오면 위 다섯 질문의 답이 세 트랙에서 다 다르다는 것부터 보일 것이다. 잠금 단위, 필수 여부, 저장 방식이 갈린 이유가 곧 업무의 차이다. 그리고 어느 트랙에서든 화면의 "전 항목·의견 필수" 검사는 안내용이고, 판정은 sp-node 한 곳이다.

## Sources
- [partner-tracks](../topics/partner-tracks.md) — D43·D44·D20·D16, 두 트랙 비교표 '고객에게 묻기' 줄
- [sp-develop-web](../topics/sp-develop-web.md) — §7.2.13 결정·짝 맞추기 주의
- [sp-node-api](../topics/sp-node-api.md) — `sp_bom_confirm_request`·`question_answered` 이벤트 접기·`QUESTION_RESOLVED`·`STALE_VERSION`
- [api-contract](../topics/api-contract.md) — `bom-confirm.ts`·`pcb-eq-review.ts` 문항형·`devReviewQuestionId`·`withDevReviewQuestionIds`, 트랙 사이 사전 격리
- [spcb-bridge](../topics/spcb-bridge.md) — 쓰기 브리지 `bom-confirm-answer`·`eq-answer`
- [theme-sp-lite](../topics/theme-sp-lite.md) — 주문 상세 부분 파일 `_bom_confirm_section.php`·`_pcb_eq_items_round.php`
- [sp-vue-web](../topics/sp-vue-web.md) — D43 작성 패널·`EqWorkspacePanel`·개발의뢰 검토서 편집기의 고객 답변 블록
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) — §6.39 D43 · §6.40 D44
- [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — D16 · D20 · 「D20 설계」(D43 형식을 따른다는 근거)
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.13 확인이 필요한 사항 — 고객이 직접 답한다
- [apps/api/src/lib/bom-confirm.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-confirm.ts) · [apps/api/src/lib/pcb-eq-review.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-eq-review.ts) — 같은 낙관적 잠금, 다른 오류 코드(`STALE_VERSION` / `VERSION_CONFLICT`)
- [apps/api/src/lib/develop-questions.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-questions.ts) — 이벤트를 접은 '지금 답변'
- [packages/api-contract/src/schemas/market-dev-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-review.ts) — 문항 번호와 문구 해시
- [apps/develop/src/components/detail/QuestionAnswerPanel.vue](../../samplepcb-web-mono-app/apps/develop/src/components/detail/QuestionAnswerPanel.vue) — 고객 답변 판
