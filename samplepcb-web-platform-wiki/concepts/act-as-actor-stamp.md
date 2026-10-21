---
concept: 대행은 통로를 열되 주체를 박제한다 (Act-As with Actor Stamp)
last_compiled: 2026-10-12
topics_connected: [partner-tracks, sp-node-api, sp-vue-web, shared-packages, api-contract, spcb-bridge]
status: active
---

# 대행은 통로를 열되 주체를 박제한다 (Act-As with Actor Stamp)

## Pattern
협력사·고객이 해야 할 일을 관리자(또는 마스터딜러)가 대신 할 수 있게 **통로는 넓게 열고**, 그 대신 **"누가·어느 길로 했는가"를 기록에 남긴다.** 전제는 현실이다 — 포털 계정이 없는 협력사가 있고, 답하지 않는 고객이 있고, 그래도 발주·생산·선적은 멈추면 안 된다.

세 가지가 일관된다:

- **그 사람인 척하지 않는다.** 가짜 회원을 만들거나 그 회원의 세션으로 로그인하는 방식은 매번 기각됐다(무계정 조직에는 불가능하고, 그누보드 세션 쿠키 충돌을 다시 부른다). 대행자는 자기 신원(관리자 토큰) 그대로 들어온다.
- **주체를 박제한다.** `byRole`(`ADMIN`·`MASTER_DEALER`·`PARTNER`), `uploadedBy`, `answeredRole`·`answeredChannel`+메모, 쓰기 전량 원장 `sp_partner_act_log`. 화면·회신서·타임라인이 이 값으로 "대행한 것"을 가려 보여 준다.
- **평소엔 숨긴다.** 대행 버튼은 필요할 때만 드러난다 — 무계정 조직에는 늘, 계정이 있는 조직에는 스위치를 켰을 때만.

## Instances
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): **EQ 문항형 회차의 대리 회신** — 관리자가 고객 대신 답을 넣을 때는 `web` 을 뺀 채널(전화·메일…)과 메모가 필수이고 이벤트 `proxy_answered` 로 남는다. 기록은 남기되 **보여 줄 곳은 가린다** — 대리 입력 경로는 관리자용 회신서에만 적히고 협력사용에는 싣지 않는다(포털이 안 보이는 것은 파일에도 없다). 같은 날 관리자 Case 에 **[협력사 대행 동작 보기] 스위치**(기본 꺼짐, 무계정 조직은 늘 보임) — 협력사 몫 버튼이 평소 화면을 덮지 않게
- **2026-10-09** in [sp-node-api](../topics/sp-node-api.md) / [shared-packages](../topics/shared-packages.md) / [sp-vue-web](../topics/sp-vue-web.md): **관리자 대리 접속 = 관리자 토큰 + 헤더** — 그 회원으로 로그인하는 안을 기각하고 `x-sp-act-as-partner` 헤더 하나로 냈다. 서버는 `requirePartner`·`/partner/access` 가 같은 `lib/partner-act-as.ts` 로 다시 판정하고 GET 이외 요청을 `sp_partner_act_log` 에 1행씩 남긴다(기록 실패는 요청을 막지 않는다). 클라이언트는 조직 id 만 탭 단위(sessionStorage)로 기억하고 셸이 붉은 띠로 늘 알린다
- **2026-10-09** in [partner-tracks](../topics/partner-tracks.md): 무계정 대행 안내 메일의 주체 = '샘플피씨비 담당자' 고정 → **그 문서의 발주처**. 마스터딜러가 하위 협력사 대신 움직인 일을 본사가 한 것처럼 적지 않는다. 마스터딜러의 하위 협력사 등록도 같은 결 — **회원은 만들지 않고** 초대 링크로 본인이 자기 계정을 연결한다
- **2026-09-30** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): 결제 후 부품 확인(D43) — **무응답은 자동으로 정하지 않는다.** 시스템이 대신 고르지 않고 관리자가 고객에게 확인한 뒤 대리 회신한다(채널·메모 기록). 돈이 움직이는 결정을 타이머에 맡기지 않는다
- **2026-08-13** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): **마스터딜러 관전·대행** — 하위 협력사 발주를 MD 가 대신 밀면 `byRole='MASTER_DEALER'`, 타임라인은 `meRole` 로 하위 활동을 상대측에 세우고 삭제(✕)는 자기가 대행해 올린 파일에만 붙는다
- **2026-08-11** in [partner-tracks](../topics/partner-tracks.md) / [testing](../topics/testing.md): **여정 12호 관리자 대행 완주** — 포털 계정이 0인 조직의 발주를 관리자 토큰 하나로 끝까지 몰아 `uploadedBy`/`byRole=ADMIN` 박제와 무계정 대행 안내 메일 4종을 실측했다. 이 주행이 `partnerHasPortal` '대행 필요' 배지를 낳았다(발주 이후 한정 — RFQ 는 매직링크라 자력 가능)
- **2026-08 초 (PCB P1)** in [partner-tracks](../topics/partner-tracks.md): **PCB D11 관리자 만능 대행** — EQ·생산 전이(advance/revert)에서 관리자면 주체 검증을 통과하고 이력에 `byRole: 'ADMIN'` 이 박힌다(선적과 같은 원칙). 근거는 문서가 그대로 적는다 — 무계정 협력사는 메일과 전화로 일한다
- **2026-07-29~08-02** in [partner-tracks](../topics/partner-tracks.md): **BOM D11 관리자 대리 입력** — 협력사 회신을 관리자가 대신 넣을 수 있되 **같은 저장 경로**(`saveRfqReply` 코어 공유)를 타고 actor 가 기록된다. 대행용 길을 따로 내지 않은 것이 이후 모든 대행의 원형이다

## What This Means
권한 모델이 "역할마다 할 수 있는 일"로만 짜였다면 무계정 협력사 한 곳이 트랙 전체를 세웠을 것이다. 이 리포는 반대로 **"일은 누가 해도 되지만 누가 했는지는 남는다"**로 짰고, 그래서 계정 유무·응답 유무와 상관없이 트랙이 끝까지 간다(여정 12호가 증명).

지킬 것 둘. ① **주체 박제는 "누가 눌렀나"이지 "무슨 뜻인가"가 아니다.** `byRole` 로 업무 판정을 하면 대행에서 틀린다 — 반려 판정을 `byRole` 로 하면 관리자 대행 건이 어긋나므로 `isPcbEqRejectionEvent` 를 거쳐야 한다([judgment-single-owner](judgment-single-owner.md)). ② **대행 통로는 인가를 서버가 다시 본다.** 대리 접속 헤더는 클라이언트 조건(관리자 ∧ `/api/partner/` ∧ 값 있음)이 안 맞으면 오류 없이 빠지고, 실려 와도 서버가 관리자 여부·조직 실존을 다시 판정한다([server-single-truth](server-single-truth.md)).

숨은 비용은 화면이다. 대행 버튼을 다 보여 주면 관리자 화면이 협력사 화면의 합집합이 돼 "지금 내 일"이 묻힌다 — 10-11 의 스위치는 통로를 좁힌 것이 아니라 **보이는 것만 줄인** 처방이다.

## Sources
- [partner-tracks](../topics/partner-tracks.md)
- [sp-node-api](../topics/sp-node-api.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [shared-packages](../topics/shared-packages.md)
- [api-contract](../topics/api-contract.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [docs/PARTNER_PORTAL.md](../../docs/PARTNER_PORTAL.md) — §5.1 하위 협력사 직접 관리·§5.2 관리자 대리 접속
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) — D11 관리자 대리 입력·§6.39 대리 회신
- [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — D11 만능 대행·여정 12호·MD 관전·대행·D20 대리 회신과 회신서 두 판
