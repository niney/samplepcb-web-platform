---
concept: 링크는 열기만, 결정은 POST (GET Opens, POST Decides)
last_compiled: 2026-09-19
topics_connected: [spcb-bridge, gnuboard-integration, partner-tracks, sp-node-api, theme-sp-lite]
status: active
---

# 링크는 열기만, 결정은 POST (GET Opens, POST Decides)

## Pattern
메일·매직링크로 **밖으로 나가는 URL 은 GET 으로 어떤 상태도 바꾸지 않는다**. 이유는 REST 취향이 아니라 실물 위협이다 — 메일 보안 게이트웨이와 스캐너가 링크를 **사람보다 먼저 자동으로 GET 한다**. 메일 본문에 [승인] 버튼을 두고 그 링크가 승인을 수행하면, 고객이 메일을 열어보기도 전에 승인이 끝나 있다.

그래서 규칙이 둘로 갈린다:
- **GET = 화면을 연다.** 딥링크·목록 열람·첨부 다운로드·매직링크 회신 화면. 마감돼도 GET 은 열린다(읽기는 막을 이유가 없다).
- **POST/PUT = 결정을 한다.** 승인·반려·접수·회신 저장. 반드시 **화면 안에서**, 로그인 또는 토큰 스코프 + CSRF 를 통과해서.

이것은 sp-php 를 처음으로 쓰기 경로에 넣을 때(2026-08-07) 세운 네 규칙 중 첫째이며, [core-nonmodification](core-nonmodification.md)의 브리지 설계 및 [server-single-truth](server-single-truth.md)("판정은 서버 POST 경로에서")와 맞물려 하나의 배관을 이룬다.

## Instances
- **2026-08-25** in [spcb-bridge](../topics/spcb-bridge.md) / [theme-sp-lite](../topics/theme-sp-lite.md): 마이페이지 진입점 2종(`/shop/eq` 제조 확인 · `/shop/as` A/S 접수)은 **"목록은 목록만"** — 결정·접수 폼을 복제하지 않고 주문 상세 앵커(`#eq-{id}`·`#sp_as_wrap`)로 보낸다. 그 앵커가 **메일이 쓰는 바로 그 링크**다. 폼이 두 곳이면 첨부·기한·확인 모달·수량 검증이 갈린다
- **2026-08-16** in [spcb-bridge](../topics/spcb-bridge.md) / [partner-tracks](../topics/partner-tracks.md): 메탈마스크 **좌표파일은 통보 없는 열람** — `coord-file.php`에는 `review` 파라미터가 **아예 없다**. 확인 요청(D16)과 다른 축이라 요청도 결정도 통보도 없고, 종류·단계(관리자 확인 완료)·소유권 판정과 파일명 중립화는 전부 sp-node 가 건다. "열람 신호조차 만들지 않는다"의 가장 순수한 형태
- **2026-08-15** in [spcb-bridge](../topics/spcb-bridge.md): A/S 접수 `claim-create.php` — **POST 전용**, 로그인 + CSRF, 사진 ≤10장을 `CURLFile`로 1회 multipart 중계. 배송 후·활성 클레임 1건·수량 게이트는 sp-node 판정. 접수라는 되돌리기 어려운 행위가 링크 한 번으로 일어나지 않는다
- **2026-08-10** in [spcb-bridge](../topics/spcb-bridge.md) / [sp-node-api](../topics/sp-node-api.md): EQ 고객 확인 브리지 `eq-decide.php` — **POST 전용이고 GET 은 '잘못된 접근' 리다이렉트만** 한다. 결정은 주문 상세 화면 안의 폼에서 `review_id`·`decision=approve|reject`·`note`와 함께 나가고, sp-node `POST /api/pcb-eq-reviews/:id/decide`로 중계된다. 409(재제출·그 사이 관리자가 EQ 를 움직여 닫힘)는 **sp-node 문구를 그대로** 실어 되돌린다
- **2026-08-07** in [sp-node-api](../topics/sp-node-api.md) / [partner-tracks](../topics/partner-tracks.md): **원칙의 선언 — "메일에 승인 버튼 금지"**(D16). 근거가 문서에 그대로 적혀 있다: *보안 게이트웨이 자동 GET → 링크는 화면만, 결정은 POST*. 같은 결정 묶음에 "회원 주문만", "공개 파일은 관리자가 고른 것(`sharedFileIds`)만", "고객 승인이 발주 상태를 바꾸지 않는다"(별도 축)가 함께 선다
- **2026-07-31 ~ 08-11** in [partner-tracks](../topics/partner-tracks.md): 무인증 **매직링크**(64hex·30일·회전)가 같은 규칙 위에 선다 — `GET /api/rfq-reply/:token`·`/pcb-rfq-reply/:token`은 **마감돼도 열람이 열리고**, 상태를 바꾸는 `PUT`만 `RFQ_CLOSED`·`NOT_EDITABLE`로 막힌다. 정지 조직은 GET·PUT 모두 409 `PARTNER_SUSPENDED`, 만료는 404 — **응답이 갈리는 것이 의도**다. 저장형 토큰이라 재발급이 곧 회수(재배정 후 옛 메일 링크는 무효)
- **2026-07-29** in [sp-node-api](../topics/sp-node-api.md): 레거시에서 건져 온 교훈 셋 중 하나가 **"GET 무부작용"**(나머지는 manual 불가침·상태 계층 분리). 협력 트랙 설계 첫날부터 명문화돼 있었다
- **2026-07-05 · 상시** in [spcb-bridge](../topics/spcb-bridge.md) / [gnuboard-integration](../topics/gnuboard-integration.md): 반대 방향인 서버-대-서버 호출도 같은 모양 — sp-node → PHP 알림 브리지는 **`POST /spcb/api/order-notify` + 서비스 JWT**다. 사람이 열 수 있는 URL 로는 발송이 일어나지 않는다

## What This Means
**외부에서 도달하는 URL 을 새로 만들 때의 기본 규칙**이다. 메일 버튼, 매직링크, QR, 알림톡 링크를 설계할 때 먼저 물을 것은 "이 URL 을 로봇이 눌러도 괜찮은가"이며, 답이 '아니오'면 그 동작은 GET 이어서는 안 된다.

실무 형태로 옮기면:
1. **메일 버튼 문구는 "확인하러 가기"**다 — [승인]·[반려]가 아니다. 문구가 곧 계약이라, 버튼 이름이 결정을 약속하는 순간 링크가 결정을 하게 된다.
2. **딥링크는 화면의 그 자리까지만 데려간다.** 결정 폼은 한 곳(주문 상세)에만 두고, 목록·메일·마이페이지는 전부 그 앵커를 가리킨다.
3. **읽기와 쓰기의 게이트를 따로 건다.** 마감·만료·정지는 GET 과 PUT 에 다르게 적용되는 것이 정상이며, 그 차이를 응답 코드로 구분한다(404 만료 / 409 정지).
4. **열람 신호조차 GET 부작용으로 만들지 않는다.** 좌표파일에는 리뷰 레코드가 없다 — "본 것"을 기록하고 싶은 유혹이 곧 GET 부작용의 시작이다.
5. PHP 쪽 POST 에는 함정이 하나 붙는다 — ⚠ 코어 `get_token()`은 hidden 태그가 아니라 **값만** 반환한다. 그냥 찍으면 토큰이 화면에 노출되고 폼에 `name="token"`이 없어 **제출이 전부 막힌다**(2026-08-07 실측). `<input type="hidden" name="token">`으로 감쌀 것.

## Sources
- [spcb-bridge](../topics/spcb-bridge.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
