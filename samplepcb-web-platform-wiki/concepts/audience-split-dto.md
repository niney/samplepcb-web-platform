---
concept: 보는 사람마다 따로 자른다 (Audience-Split DTO)
last_compiled: 2026-11-09
topics_connected: [sp-develop-web, sp-node-api, api-contract, sp-vue-web, partner-tracks]
status: active
---

# 보는 사람마다 따로 자른다 (Audience-Split DTO)

## Pattern
같은 기록을 고객·협력사·관리자가 함께 본다. 이 리포는 그 차이를 **화면에서 숨기지 않고 서버가 응답을 보는 사람마다 따로 잘라 내린다** — 보이면 안 되는 값은 응답에 아예 없다. 자르는 자리는 셋이다.

- **응답에서 자른다** — 같은 행을 읽되 계약 타입을 둘로 두고(`AdminDevelopQuoteView` = 고객 뷰 + `internalNote`), 내부 키를 벗긴다(`toClientSpec`, `sourcePrice`).
- **쓸 때 가른다** — 한 사건을 보는 사람마다 다른 **두 기록**으로 남긴다. 고객 응답에 실리는 기록에는 처음부터 관리자 값을 넣지 않는다.
- **문서를 두 판으로 그린다** — 같은 내용을 판마다 다르게 새로 그린다(EQ 회신서의 협력사용 판, 고객에겐 중립 이름).

[server-single-truth](server-single-truth.md) 가 "무엇이 맞는 값인가"를 서버에 둔다면, 이 개념은 **"누구에게 무엇을 보여 주는가"** 를 서버에 둔다.

## Instances
- **2026-11-04** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): **연락처 수정의 타임라인 두 줄** — 관리자가 의뢰 연락처를 고치면 서버가 고객도 보는 줄('담당자가 연락처를 수정했습니다' + 바뀐 칸 **이름**)과 관리자만 보는 '연락처 변경 내역'(이전 → 이후)을 따로 남긴다. 이벤트 payload·body 가 고객 응답에도 실리기 때문에 **이전 값은 고객 줄에 처음부터 넣지 않는다** — 응답에서 지우는 것이 아니라 쓸 때 가른 사례. 바뀐 칸 판정은 계약 `developContactChanges`, sp-vue 는 그리기만 한다
- **2026-11-04 (없는 칸이 가장 안전하다)** in [sp-develop-web](../topics/sp-develop-web.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): 견적 항목별 **내부 원가·마진**을 낮에 관리자 전용 칸으로 넣고(`ecc1f504c` — 마이그레이션·원가 대화상자·발송 뒤 원가 고치기 라우트까지) 같은 날 저녁 사용자 결정으로 **계약째 걷어냈다**(`c1edfe0e3`, `DROP COLUMN` 마이그레이션). 관리자 견적 뷰는 계약 이름 `AdminDevelopQuoteView` = 고객 뷰 + 내부 메모만 남았고, 옛 호출이 원가·업체를 보내도 zod 가 조용히 버린다(400 아님)
- **2026-10-22** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 고객 메일은 **고객 공개로 남긴 답변·중간 확인 요청만** 보내고 내부 메모는 보내지 않는다. 같은 기간 고객 화면은 검토서 정보 줄의 **AI 모델명을 숨기고**, 출력물 표지는 담당자 휴대전화 대신 회사 대표번호를 싣는다(개인 연락처 미노출 — 견적서의 공급자 칸만 계약 상수 `DEVELOP_QUOTE_SUPPLIER` 로 예외). 고객 상세의 `assigneeName` 은 그누보드 기본 관리자 이름이면 null 로 내린다
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md): **EQ 회신서는 판마다 새로 그린다** — 공장 원본 `.xls` 에 써넣지 않고 ExcelJS 로 새로 그리며, 협력사용 판에는 대리 입력 사실과 고객이 본 한국어 문장을 싣지 않는다. 원본 엑셀·공장 로고는 고객에게 보이지 않고, 관리자가 올린 그림은 고객에게 중립 이름(`figure-{id}`)으로 나간다
- **2026-10-09** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): **돈은 보는 쪽에 따라 통화가 갈린다** — BOM 발주서 금액 계산이 `PoMoneyAudience`(`'admin' | 'partner'`)를 인자로 받아 협력사에게는 결제통화만, 관리자에게는 원화 회계값까지 낸다. 선정 박제의 원본 공급가 `selectedOffer.sourcePrice` 는 공급망 정보라 고객 응답에서 지우고, 송금 원장은 협력사에게 받은 금액·잔액만 보인다
- **2026-07-07** in [sp-node-api](../topics/sp-node-api.md): 레거시 이관 견적의 `specJson` 에 섞인 `_legacy`(내부 id·회원 연락처 PII)를 견적 상세·견적서 응답에서 벗기는 `toClientSpec` — 이 함수를 거치지 않은 새 라우트는 응답 스키마 검사에서 500 이 됐다(빠뜨리면 새는 대신 터진 운 좋은 경우)

## What This Means
보는 사람마다 자르는 일은 **응답 하나를 고칠 때마다 다시 해야 하는 일**이다 — 관리자 전용 칸 하나는 응답·메일·인쇄·PDF·엑셀·포털 모든 고객 경로에서 빠져 있어야 한다. 11-04 의 내부 원가가 하루를 못 넘긴 것이 그 비용의 크기를 보여 준다: 가장 안전한 관리자 전용 칸은 **없는 칸**이고, 꼭 둬야 하면 고객용 타입과 관리자용 타입을 계약에서 **이름부터 갈라** 둔다(`AdminDevelopQuoteView` 가 교차 타입 `DevelopQuoteViewType & {internalNote}` 를 대체한 이유).

두 번째 교훈은 **기록이 응답에 실린다**는 것이다. 이벤트 payload 처럼 "내부용 같지만 화면에 그대로 실려 나가는" 칸이 있으면 응답에서 자르는 것만으로는 부족하고 쓸 때 갈라야 한다(연락처 두 줄). 문서도 같다 — 한 파일에 써넣고 가리는 대신 판마다 새로 그린다(EQ 회신서).

자르는 판단도 한 곳이 소유한다([judgment-single-owner](judgment-single-owner.md)) — `PoMoneyAudience` 같은 인자나 계약의 판별 타입으로 갈라야 화면마다 다르게 숨기는 일이 생기지 않는다. 대리 접속처럼 관리자가 협력사의 눈으로 볼 때도 서버는 협력사용으로 자른 응답을 내린다([act-as-actor-stamp](act-as-actor-stamp.md)).

## Sources
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [partner-tracks](../topics/partner-tracks.md)
- [packages/api-contract/src/schemas/develop.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop.ts) — `AdminDevelopQuoteView`·`developContactChanges`
- [apps/api/src/lib/bom-po.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-po.ts) — `PoMoneyAudience`
- [apps/api/src/routes/admin-pcb-projects.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-projects.ts) — `toClientSpec`
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §5.1 견적서(내부 원가 제거)·§7.3 연락처 수정
