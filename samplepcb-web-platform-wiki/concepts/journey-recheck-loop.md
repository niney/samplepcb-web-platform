---
concept: 완주 여정 재점검 루프 (Journey Recheck Loop)
last_compiled: 2026-09-19
topics_connected: [testing, partner-tracks, sp-node-api, api-contract, sp-develop-web, sp-market-web, docs-knowledge]
status: active
---

# 완주 여정 재점검 루프 (Journey Recheck Loop)

## Pattern
기능은 "구현했다"로 끝나지 않는다. **시나리오를 끝까지 주행 → 화면을 관찰 → 원인이 특정된 것만 엄선 → 수정 → 어서션을 뒤집어 회귀선으로 남긴다**를 **편(호) 단위**로 반복하는 것이 이 코드베이스의 완성 절차다([testing](../topics/testing.md) 검증 철학). 한 편은 테스트 파일 하나가 아니라 **결함 추적 단위**이고, 문서 절 번호(`PCB_PARTNER_TRACK §9 완주 여정 N호` · `SMARTBOM §6.2x D3x 완주`)가 커밋 메시지에 그대로 박혀 결함·수정·회귀선이 한 줄로 이어진다([docs-knowledge](../topics/docs-knowledge.md)).

편은 무작위로 늘지 않고 **열(列)로 편성**된다 — PCB·횡단 1~12호는 흐름(고객 주문에서 입고까지), 13~22호는 경계·시간·경합·권한, 23~32호는 **횡단면**(집계·검색·삭제·이력·돈·화면, 다섯 편이 read-only 라 실데이터 2만 건 위에서만 의미가 있다), 33호는 미결 판단의 종결, 34~43호는 "발이 빠지는 자리"(앵커 끊김·빈 화면·험한 값·좁은 창·동시 조작)다. 각 편은 "그 편만 할 수 있는 검증" 하나를 갖는다. 같은 루프가 BOM 트랙에서는 같은 `createJourneyReport` 로 `findings-bom-*` 편을, 마켓·개발의뢰에서는 브라우저 없는 **API 하네스 + 관찰 워크**로 변형돼 돈다 — 네 트랙.

이 패턴의 값은 잡은 결함 수(PCB 계열 확정 60여 건)가 아니라 **검증이 조용히 비는 자리를 알게 된 것**이다. 판정을 복제하지 않는 규율([judgment-single-owner](judgment-single-owner.md))의 테스트판이기도 하다 — 하네스는 출하 코드와 **같은 함수를 임포트**한다.

## Instances
- **2026-09-11** in [sp-develop-web](../topics/sp-develop-web.md) / [testing](../topics/testing.md): 개발의뢰 간편 서식 간소화(문서 8종→5종·단계 6·기간 가중)를 API 하네스 **191/0** 으로 닫았다. 브라우저 쪽은 스모크 2본뿐이고, 화면 판단은 `tools/dev-review-v2-walk.ts`(**"자동 판정 없음"**)가 실브라우저로 훑어 사람이 본다 — 어서션이 못 잡는 "실브라우저 사각"을 육안 1회로 메우는 플레이북 규율
- **2026-08-25** in [testing](../topics/testing.md) / [api-contract](../topics/api-contract.md): **관측 러너를 회귀 스펙에서 분리**(`status-matrix`·`status-matrix-bom`) — 어서션은 "조작 API 가 200 인가"뿐이고 산출물은 표(관리자 조작 → od_status → 배지·탭 → 고객 배지·스텝퍼). 시안을 정하기 **전에** "지금 무엇이 보이는가"를 먼저 확정했고, 그 표가 트랙 공용 `/api/order-progress` 와 PHP 사전 교정의 근거가 됐다
- **2026-08-11** in [testing](../topics/testing.md): **검증이 조용히 비는 3패턴**을 자기 실수에서 명문화 — ① 워크큐 **기본 탭이 우리 건의 탭이 아니다**(`pos`=발주 대기·`orders`=입금 대기, 그 탭엔 검색창도 없다. P4 가 멈추자 P5~P8 이 연쇄 붕괴) ② **없는 필드를 읽으면 기본값이 조용히 어서션을 통과한다**(29호 `-1·-1·-1`) ③ 픽스처 이름·시드 메모에 검사 키워드가 들어가면 자기가 심은 글자를 자기가 찾는다(2회 오탐). + 규율 "**라우트·body 스키마를 먼저 읽을 것**"(1차 11회 + 2차 4회 추측 실수)
- **2026-08-11** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): 34~43호 "발이 빠지는 자리"에서 확정 결함 5건 **전부 교정** — 미입금 주문 삭제 시 `ct_status='삭제'` 행이 "주문됨"으로 세어져 **고객 견적이 어느 목록에도 없어짐**(34호) · 완납 통지 동시 2번(41호, 33호가 주석에 밝힌 레이스의 실측) · grid item `min-width:auto` 로 295자 파일명이 협력사 보드를 가로로 터뜨림(36·39호). 결함 0 인 편도 버리지 않고 **확인편**으로 남는다(35 빈 상태·37 금액 정밀도·40 전량 취소는 되돌릴 수 있는 종결·43 고객 화면에 공급망 미노출)
- **2026-08-11** in [sp-node-api](../topics/sp-node-api.md) / [testing](../topics/testing.md): 23~32호 **횡단면 편**(흐름이 아니라 집계·검색·권한·재고·삭제·이력·돈·화면) — 확정 결함 1건이 **검색창 `%` 한 글자가 전체 20,805건 반환**(`escapeLike` 가 PCB 큐 두 곳에만 빠져 있었다; `_` 는 파일명에 흔해 더 조용히 틀린다). 나머지 아홉은 구조 확인·규명이고, 26호가 **모든 e2e 정리가 기대는 관례**(force-status `'주문'` 이 취소를 되돌리고 재고를 복원한다)의 근거를 처음 검증했다
- **2026-08-11** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md): 13~22호 경계·시간·경합·권한 편이 **판정 축 자체를 교정** — 포털 가능 판정 '멤버 존재' → **'멤버 ∧ 조직 approved'**(13호, 매직링크 우회 발견) · 부분 취소는 헤더가 아니라 줄 축 `isPcbOrderLineCanceled`(10·13호) · 납기 경과 `isPcbDeliveryOverdue`(KST 자정 앵커) · **동시 조작은 500 이 아니라 도메인 응답**이어야 한다(16호 — 담기=합류 200, 발행=중복 409). 교정 5건이 전부 계약 순수 함수로 착지했다
- **2026-08-10~11** in [testing](../topics/testing.md) / [partner-tracks](../topics/partner-tracks.md): 루프 자체의 확립 — `createJourneyReport()` 가 `F(step, kind, note)`(bug·ux·obs·blocker)·생성물 대장·`watchHttp`(≥400)·`view`(**API 전이는 열어 둔 페이지를 안 바꾸므로 재로드 없으면 스크린샷이 첫 단계에 멈춘다**)·`assertView`·리포트 `write` 를 준다. 관찰 러너 `obs-*.mts` 가 스크린샷+innerText 를 덤프하고, 엄선된 수정은 어서션을 뒤집어 회귀선이 된다(10호 부분 취소 가드·12호 [발송 시작] 라우트·11호 직송 판정 축)
- **2026-08-10** in [testing](../topics/testing.md): 하네스 편입 결정 4종이 루프의 전제 — `/spcb/api/me` 라우트 스텁 로그인(비밀번호·PHP 세션 없이 관리자·협력사·고객 아무나) · playwright-core + 시스템 브라우저 · **파일 간 직렬**(공유 DB) · 자족 시드→검증→**무잔재 정리 + 잔재 0 어서션**. `harness.e2e.test.ts` 가 새 편의 복사 시작점이고, 시나리오는 하네스가 아니라 재설계 세션이 쓴다
- **2026-08-10~11** in [partner-tracks](../topics/partner-tracks.md): 재작업 가드 프로브 `rework-probe` 가 **"잠김→정리→열림" 순환**을 W2~W9 로 돌아 409 회귀로 승격 — 가드 체계(`PO_ISSUED`·`RFQ_NOT_SELECTED`·`HAS_REMITTANCE`·`IN_SHIPMENT`·`DOC_LOCKED`·`RECEIVE_REQUIRED`·`ORDER_CANCELED`)의 **검사 순서가 곧 명세**가 된 것이 이 편의 산물이다
- **2026-07-08** in [sp-market-web](../topics/sp-market-web.md) / [testing](../topics/testing.md): 브라우저 없는 API 하네스의 원형 `e2e-market.mts`(33→89→**148/0**) — run → cleanup 으로 스스로 만들고 지우고, 시작 시 AI 유스케이스를 끄고 끝에 원복해 **실 LLM 호출 0**. 결정적으로 **하네스가 출하 코드의 `devReviewInputHash` 를 그대로 임포트**한다: 규칙이 갈라지면 정상 등록이 `REVIEW_STALE` 로 튕기는 결함을 하네스가 못 잡기 때문. 2026-09-05 `e2e-develop.mts` 가 이 관례를 통째로 복제했다

## What This Means
이 코드베이스에서 **"완성"의 정의는 구현이 아니라 주행으로 확인된 상태**다. 새 트랙·새 기능을 열면 편 번호를 이어서 쓰고, 편마다 "이 편만 할 수 있는 검증" 하나를 정한 뒤 문서 절 번호를 커밋에 박아라(절을 재번호하면 이력이 끊긴다).

주행 전 반드시 확인할 것 넷: **① 라우트·body 스키마를 먼저 읽는다**(추측이 가장 흔한 실수다) ② 워크큐는 **탭을 클릭하고 검색으로 좁힌다** ③ 어서션이 읽는 필드가 실제로 존재하는지 리포트 문자열을 눈으로 본다 ④ 픽스처 이름·메모에 검사 키워드를 넣지 않는다. 그리고 하네스는 판정을 재구현하지 말고 **출하 코드의 함수를 임포트**하라.

결함 0 인 편은 실패가 아니다 — 구조를 증명한 **확인편**으로 남기고, 화면 판단처럼 어서션이 닿지 않는 자리는 관측 러너·실브라우저 워크로 사람 눈 1회를 절차에 포함한다.

## Sources
- [testing](../topics/testing.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [docs-knowledge](../topics/docs-knowledge.md)
