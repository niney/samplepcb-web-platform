---
concept: 서버 단일 진실 (Server as Single Source of Truth)
last_compiled: 2026-09-19
topics_connected: [sp-node-api, api-contract, spcb-bridge, sp-vue-web, sp-market-web, sp-develop-web, partner-tracks, gnuboard-integration]
status: active
---

# 서버 단일 진실 (Server as Single Source of Truth)

## Pattern
가격·인증·상태·권한·노출 판정은 전부 서버에서만 계산하고, 클라이언트가 보낸 값은 표시용으로만 취급한다. 위변조 차단이 1차 목적이지만, 부수 효과로 "두 화면이 같은 값을 보여준다"는 일관성도 서버 단일 계산에서 나온다.

2026-08~09 에 소비자가 셋(관리자 sp-vue · 협력사 포털 · sp-php 고객 화면)으로 늘면서 이 패턴은 **"서버가 문자열까지 완성해 내려준다"** 로 한 걸음 더 갔다. `CustomerOrderProgressItem.label/shortLabel` 은 PHP·Vue 가 그대로 출력하고, 협력사명·발주가·협력사 수는 아예 싣지 않는다(공급망 비노출). FE 는 boolean·라벨·파생 필드를 소비만 하고 재조합하지 않는다.

[judgment-single-owner](judgment-single-owner.md)가 "중복 구현을 불신"한다면 이 패턴은 **"클라이언트를 불신"**한다. 둘은 한 쌍으로 붙어 다닌다 — 판정 함수를 계약에 올려도(②) 그 함수를 **호출하는 주체**는 서버여야 하고, FE 가 같은 함수를 부르는 것은 선반영일 뿐 진실이 아니다.

## Instances
- **2026-09-11** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 개발의뢰의 판정이 전부 서버 파생 — 마일스톤 `payable`(`manual` 은 `milestone_opened` 로 연 것만) · `nextAction`(`answer_document` 는 결제·검수보다 뒤) · 미답변 문의 · 회신 기한 초과 · **기간 가중 달성도**. 화면은 재계산하지 않는다
- **2026-09-05** in [sp-market-web](../topics/sp-market-web.md): 검토서 **신선도의 진실은 서버 `inputHash`** — FE 로컬 서명(제목·분야·설명·답변·1스텝 참고 자료)은 앞단 선반영이고, 실행 라우트와 등록 라우트가 같은 `devReviewAttachmentHashes` 를 공유해 400 `REVIEW_STALE` 을 낸다. 두 규칙이 어긋나면 **정상 등록이 튕긴다**(e2e 가 출하 코드의 해시 함수를 그대로 import 하는 이유). 같은 날 **수정 이력 diff 도 서버가 스냅샷 사슬에서 만들어 내려주고** 화면은 계산하지 않는다
- **2026-09-04** in [sp-market-web](../topics/sp-market-web.md) / [api-contract](../topics/api-contract.md): 필수 조건 검사를 `marketRequiredMissing` **한 함수**가 2스텝 "다음" 버튼과 등록 라우트에서 같이 쓰인다 — 화면이 통과시킨 것을 서버가 거부하거나 그 반대가 되는 구멍을 구조로 막는다(`ANSWERS_REQUIRED`)
- **2026-08-25** in [partner-tracks](../topics/partner-tracks.md) / [spcb-bridge](../topics/spcb-bridge.md): 고객 진행 표시를 **라벨까지 서버가 완성** — 트랙 공용 `/api/order-progress` 가 PCB·BOM 칸과 문구를 내려주고 PHP 주문내역·Vue 관리자 드로어·고객 목록·카드가 같이 소비한다. PHP 는 `sp_pcb_progress(_batch)`(50건 청크)로 받아 그리기만 한다
- **2026-08-11** in [partner-tracks](../topics/partner-tracks.md): 협력사 포털 가능 판정 축을 **'멤버 존재' → '멤버 존재 ∧ 조직 approved'** 로 교정(여정 13호). 정지 조직은 매직링크까지 409 `PARTNER_SUSPENDED` — 화면이 아니라 서버 판정 하나가 모든 경로를 닫는다
- **2026-08-07~16** in [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): EQ 전이는 **순서와 주체를 서버가 강제**한다(`PCB_EQ_FORWARD/REVERT` 사전 + `expectedFrom`, 승인은 관리자만 D3, 승인요청 뒤 `EQ_LOCKED`). 고객 승인은 별도 축이라 발주 상태를 바꾸지 않고 관리자 `eq_done` 전이의 근거일 뿐이며, **메일에 승인 버튼을 두지 않는다**(보안 게이트웨이가 링크를 자동 GET 하면 고객이 열어보기도 전에 승인된다 — 링크는 화면만, 결정은 POST)
- **2026-08-06** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): 송금 잔액은 상태 한 칸이 아니라 **원장 위의 서버 계산 하나**(`sp_pcb_remittance`, 잔액=발주가−송금 합계 → `unpaid|partial|paid|over`). 통화는 발주 통화로 서버가 강제해 요청 body 에 `currency` 키 자체가 없고, 무상 A/S·MD 하위 발주는 집계에서 뺀다
- **2026-08-02~10** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): 선적 핑퐁 주체를 **서버가 인가**(`BOM_SHIPMENT_ACTORS` — 레거시는 프론트만 검증했다). `myTurn`·워크큐 소속 탭·배지 카운트도 서버 계산이며 FE 는 배지를 그리기만 한다
- **2026-07-29~** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): **`requirePartner` 가 매 요청 DB 로 조직 권한을 판정**한다 — JWT 에 조직 클레임을 넣지 않아서 정지 즉시 403 이 되고 토큰 재발급이 필요 없다. 포털 진입도 `GET /api/partner/access` 가 `tracks{bom,pcb,parts}` 를 조직 capabilities 에서 파생해 내려주고, PHP 헤더 링크(`sp_is_approved_partner()`)는 같은 축을 미러한다
- **2026-08-07~09** in [spcb-bridge](../topics/spcb-bridge.md) / [gnuboard-integration](../topics/gnuboard-integration.md): **브리지는 중계만, 원장 쓰기는 sp-node** — 양방향 모두. PHP→Node 방향은 `eq-decide`·`claim-create` 가 2분 JWT 로 중계할 뿐 `sp_pcb_eq_review`·`sp_pcb_claim` 을 sp-node 가 쓴다. Node→PHP 방향은 PHP 가 메일·SMS 를 **발송만** 하고 결과 sent/failed/skipped 를 sp-node 가 `sp_mail_log` 에 기록한다
- **2026-07-03~05**(유지) in [sp-node-api](../topics/sp-node-api.md): 알림 체크박스 **노출을 서버가 계산**(`getNotifyConfig` boolean 3종 → FE `v-if`) · 주문 상태 전이 가능 여부·미수금/과세 재계산·취소 스킵 판정 전담 · 관리 경계는 `requireAdmin`(라우터 가드는 UX 용) · 두 화면 사양 표기는 서버 `buildOptionSummary` 하나를 `optionSummary` 로
- **2026-07-02**(유지) in [sp-node-api](../topics/sp-node-api.md) / [spcb-bridge](../topics/spcb-bridge.md): 거버 제출 payload 에 **가격이 아예 없다** — 서버 재계산만이 진실([snapshot-freeze](snapshot-freeze.md)와 쌍). JWT 는 10분 만료 + 매 액션 직전 재발급·클라이언트 저장 금지 — 세션이 진실원본, 토큰은 캐시

## What This Means
새 기능에서 "클라이언트가 이 값을 보내주면/판정하면 되지 않나?"가 나오면 위반 신호다. 값·권한·노출·라벨은 서버가 계산하고, 클라이언트는 식별자(projectId, odId, jobId, target)만 보낸다. 마켓·개발의뢰 등록이 산출물 본문이 아니라 **`devReviewJobId` 만** 보내고 서버가 소유자·완료·유스케이스·해시를 대조해 박제하는 것이 이 규율의 완성형이다.

화면 간 표기 불일치나 "노출됐는데 실제론 다르게 동작" 문제는 프런트 수정이 아니라 **서버가 문자열/boolean 을 내려주는 방향**으로 푼다. 라우터 가드·FE `v-if`·로컬 서명은 UX 편의일 뿐 절대 보안·정합 경계가 아니며, FE 가 같은 계약 함수를 불러도 그것은 선반영이다. 권한은 토큰에 굳히지 말고 **매 요청 판정**하는 쪽이 이 코드베이스의 선택이다(정지가 즉시 먹는다).

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [partner-tracks](../topics/partner-tracks.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
