---
concept: 완주 여정 재점검 루프 (Journey Recheck Loop)
last_compiled: 2026-11-15
topics_connected: [testing, partner-tracks, sp-node-api, api-contract, sp-develop-web, sp-market-web, docs-knowledge, sp-vue-web, shared-packages, smartsmt-integration]
status: active
---

# 완주 여정 재점검 루프 (Journey Recheck Loop)

## Pattern
기능은 "구현했다"로 끝나지 않는다. **시나리오를 끝까지 주행 → 화면을 관찰 → 원인이 특정된 것만 엄선 → 수정 → 어서션을 뒤집어 회귀선으로 남긴다**를 **편(호) 단위**로 반복하는 것이 이 코드베이스의 완성 절차다([testing](../topics/testing.md) 검증 철학). 한 편은 테스트 파일 하나가 아니라 **결함 추적 단위**이고, 문서 절 번호(`PCB_PARTNER_TRACK §9 완주 여정 N호` · `SMARTBOM §6.2x D3x 완주`)가 커밋 메시지에 그대로 박혀 결함·수정·회귀선이 한 줄로 이어진다([docs-knowledge](../topics/docs-knowledge.md)).

편은 무작위로 늘지 않고 **열(列)로 편성**된다 — PCB·횡단 1~12호는 흐름(고객 주문에서 입고까지), 13~22호는 경계·시간·경합·권한, 23~32호는 **횡단면**(집계·검색·삭제·이력·돈·화면, 다섯 편이 read-only 라 실데이터 2만 건 위에서만 의미가 있다), 33호는 미결 판단의 종결, 34~43호는 "발이 빠지는 자리"(앵커 끊김·빈 화면·험한 값·좁은 창·동시 조작)다. 각 편은 "그 편만 할 수 있는 검증" 하나를 갖는다. 같은 루프가 BOM 트랙에서는 같은 `createJourneyReport` 로 `findings-bom-*` 편을, 마켓·개발의뢰에서는 브라우저 없는 **API 하네스 + 관찰 워크**로 변형돼 돈다 — 네 트랙.

이 패턴의 값은 잡은 결함 수(PCB 계열 확정 60여 건)가 아니라 **검증이 조용히 비는 자리를 알게 된 것**이다. 판정을 복제하지 않는 규율([judgment-single-owner](judgment-single-owner.md))의 테스트판이기도 하다 — 하네스는 출하 코드와 **같은 함수를 임포트**한다.

## Instances
- **2026-11-12~13 (작은 픽스처는 배분 경로를 타지 않는다)** in [testing](../topics/testing.md) / [sp-develop-web](../topics/sp-develop-web.md) / [shared-packages](../topics/shared-packages.md): 개발의뢰 출력물을 16:9 장 판으로 바꾼 뒤 고객 여정은 통과했지만, 여정 픽스처(분야 2·명세 3/2)는 장이 거의 비어 **배분 코드가 한 번도 일어나지 않았다**. 로컬 #257 과 크기만 같은 지어낸 제품([e2e/fixtures/develop-deck-rich.ts](../../samplepcb-web-mono-app/e2e/fixtures/develop-deck-rich.ts) — 시스템개발 6분야·명세 6/5/6/2/1/0·확인 사항 6·일정 8단계·도면 2장 …)으로 [develop-print-deck](../../samplepcb-web-mono-app/e2e/specs/develop-print-deck.e2e.test.ts)(4 → 6)을 세우자 첫 주행이 "조건 표가 한 단을 조금 넘거나 의뢰 내용이 조금 길면 개요·의뢰 내용·세부 답변·첨부가 네 장으로 흩어진다"를 잡았고, 의뢰 개요 짜임 둘(㉠·㉡ 중 장 수가 적은 쪽)을 넣어 **17장 → 14장**(`40c3992b4`). 품질은 **숫자 문턱**(넘친 장 `data-deck-overflow` 0·글자 줄임 15% 이내·주요 장 본문 40% 이상·장 수 = PDF 쪽 수)으로 박았고 운영 빌드(`vite build`+preview)로도 16/16. 같은 기간 고객 여정에는 "다시 재는 한 틱에 수정 요청 사유가 지워지던 것"(`DeckBook` `settled`)을 넣고 **고친 코드를 되돌리면 실패하는 것까지** 확인했다(DEVELOP_FLOW §7.2.12 검증 줄) — 회귀선이 정말 그 결함을 잡는지를 뒤집어서 본 것
- **2026-11-13~14 (바깥 시스템 흉내 시드)** in [testing](../topics/testing.md) / [smartsmt-integration](../topics/smartsmt-integration.md): SmartSMT 관리자 화면 e2e `admin-smt`(8)의 beforeAll 은 apps/api 의 출하 코드(`buildSampleEnvelope`·`buildSampleMultipart`·`signSmartsmtToken`)를 **그대로 import** 해 수신 주소에 견적 4건(정상·같은 주문 두 번째 = 검토 필요 + 합계 막힘·파일 없이·회원 아닌 주인)을 보낸다 — 시드가 곧 수신 라우트의 실주행이고, 정리는 이 실행의 주문 번호 접두만 지운 뒤 잔재 0 을 단언한다. ⚠ 새 함정: 마지막 케이스(가져오기 대화상자)는 옵트인 변수 없이 **실제 SmartSMT 개발 서버를 1회** 부르고 "실패 문장이 뜨는가"만 본다 — 바깥 서버 상태에 따라 오는 코드가 바뀌어도(`AUTH_REJECTED`→`NOT_FOUND`) 통과하므로, 이 단언은 결함을 잡는 회귀선이 아니라 **연결 확인편**이다
- **2026-10-22~11-03** in [testing](../topics/testing.md) / [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰에 **고객 여정**(`develop-customer-journey` — 관리자 여정의 거울상: 고객 화면 + 관리자 API)이 생겼고 첫 주행이 고객 문구 6건을 고쳤다(`db558821b`). ⚠ 루프는 돌려야 돈다: 11-02~03 필수 문항(PCB 회로도·BOM)을 바꾼 세 절의 검증 줄에 관리자 여정이 빠져 관리자 여정이 이틀간 깨진 채였다
- **2026-10-11** in [testing](../topics/testing.md): **검증이 조용히 비는 네 번째 패턴 — 전역 설정을 건드리는 스펙** — AI e2e 는 `pcbEqParse.enabled` 를 켰다가 원래 값으로 되돌리는데, 따로 돌리면 서로의 되돌림을 밟는다(실측 2회; 31호의 `cf_email_use` 가 선례). 규율: 그런 스펙은 **한 실행에 묶는다**. 반대 방향 함정도 있다 — 옵트인(`EQ_AI_E2E`)을 꺼도 로컬 설정이 켜져 있으면 승인요청마다 실 LLM 잡이 선다
- **2026-10-09** in [testing](../topics/testing.md) / [partner-tracks](../topics/partner-tracks.md): BOM 외화·마스터딜러 **상세 여정**(SMARTBOM §6.45)이 API 여정은 통과하던 화면 결함 3건을 잡았고 재점검에서 가드 2건이 더해졌다 — "API 로 박제하고 화면별로 다시 주행한다"가 편의 기본 꼴이 됐다
- **2026-10-07** in [testing](../topics/testing.md) / [sp-develop-web](../topics/sp-develop-web.md) / [sp-vue-web](../topics/sp-vue-web.md): 화면 이식을 검증하려고 접수→완료를 끝까지 몬 주행(`admin-develop-journey`, 옛·새 양쪽 9/9)이 화면이 아니라 **업무 흐름** 결함 23건을 찾았다. 고치지 않고 [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §15 에 등록 — 루프의 "엄선" 단계가 "이번엔 고치지 않는다"로 끝난 첫 편([parallel-build-cutover](parallel-build-cutover.md))
- **2026-10-05** in [testing](../topics/testing.md) / [sp-node-api](../topics/sp-node-api.md): **여정 25호 — 관찰을 정책보다 먼저** — 고객 BOM 견적 취소의 현행 동작을 상태별로 따라가 다섯 가지(취소 뒤 열린 RFQ·삭제 시 회신 유실·검토 중 화면/서버 불일치·검색 중 굳음·확정↔취소 겹침)를 드러낸 뒤 사용자가 정책을 정했고, 구현 뒤 **기대값을 뒤집어** 12장면 회귀선이 됐다(K09 는 확정 도중 여러 시점에 취소를 끼워 매번 한쪽만 성공하는지 본다)
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

11-12~13 이 "검증이 조용히 비는" 다섯 번째 자리를 더했다 — **작은 픽스처는 배분 경로를 타지 않는다.** 흐름을 보는 여정 픽스처는 짧고 가볍게 만들기 마련인데, 크기에 따라 갈리는 코드(배분·쪽 나누기·글자 맞춤)는 그 크기에서만 돈다. 그래서 편이 둘로 갈렸다: **여정 픽스처는 흐름을, 실전 규모 픽스처는 모양을** 맡는다. 실전 규모는 실데이터를 옮기지 않고 길이·개수만 맞춘 지어낸 내용으로 만든다(사적 자료 비커밋). 그리고 엄선한 수정이 회귀선이 됐는지는 **고친 코드를 되돌려 실패하는지**로 확인한다 — 어서션을 뒤집는 것만으로는 그 어서션이 결함 자리를 지나는지 알 수 없다.

## Sources
- [testing](../topics/testing.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [shared-packages](../topics/shared-packages.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.10 의뢰 개요 짜임 둘(17장 → 14장)·검증 줄 · §7.2.12 `settled`(되돌리면 실패 확인)
- [e2e/specs/develop-print-deck.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/develop-print-deck.e2e.test.ts) · [e2e/fixtures/develop-deck-rich.ts](../../samplepcb-web-mono-app/e2e/fixtures/develop-deck-rich.ts) — 실전 규모 픽스처
