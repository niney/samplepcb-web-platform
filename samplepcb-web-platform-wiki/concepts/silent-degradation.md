---
concept: 실패가 오류가 아니라 그럴듯한 값으로 나타난다 (Silent Degradation)
last_compiled: 2026-10-12
topics_connected: [sp-node-api, infrastructure, spcb-bridge, gnuboard-integration, parts-engine, shared-packages, testing, api-contract]
status: active
---

# 실패가 오류가 아니라 그럴듯한 값으로 나타난다 (Silent Degradation)

## Pattern
이 리포에서 가장 오래 숨어 있던 결함들은 **오류를 내지 않았다.** 대신 그럴듯한 값을 냈다 — 전부 같은 IP, 0원 가산, 고정 문구, 잘린 이름, 기본값. 화면은 멀쩡하고 테스트는 통과하고 로그는 조용하다. 기전은 매번 같다: **실패를 부드럽게 넘기려고 둔 장치(폴백·기본값·격리·자동 이스케이프)가 실패 신호 자체를 삼킨다.**

세 부류로 나뉜다:

- **경계에서 값이 평탄해진다** — 프록시 뒤의 `request.ip`, 코어가 건 `addslashes`, DB 가 조용히 자르는 긴 문자열. 값은 있는데 뜻이 사라졌다.
- **폴백이 다른 실패를 흡수한다** — 표에 없으면 0, 헤더가 없으면 연결 주소, 옵션 오류면 옵션 빼고 재시도. 원래 잡으려던 실패 말고도 걸려든다.
- **격리가 원인을 지운다** — 행 하나의 예외가 배치를 죽이지 않게 한 격리가 메시지를 고정 문구로 바꾼다.

## Instances
- **2026-10-11** in [spcb-bridge](../topics/spcb-bridge.md) / [gnuboard-integration](../topics/gnuboard-integration.md): **`$_POST` addslashes 오염** — 그누보드 코어 `common.php` 가 `$_POST` 전체에 이스케이프를 거는데 브리지가 그 값을 그대로 sp-node 에 넘겨, 고객이 쓴 따옴표·백슬래시가 `\'` 로 저장됐다. PHP 화면은 코어가 다시 풀어 보여 주므로 멀쩡해 보였고 네 브리지가 같은 상태였다. 처방은 역변환이 아니라 **원문 다시 읽기**(`sp_bridge_text` — `filter_input`)
- **2026-10-11** in [sp-node-api](../topics/sp-node-api.md): **AI 호출의 4xx 폴백이 엉뚱한 실패를 삼켰다** — `format`/`think` 미지원이면 옵션을 빼고 1회 재시도하는 장치가 429·401·403·408 까지 "옵션 문제"로 읽어, 구조화 출력 없이 같은 벽에 다시 부딪히거나 형식이 깨진 답을 정상처럼 받았다. 같은 날 JSON 추출기는 배열 원소를 줄 맨 앞에 찍는 모델에서 **마지막 원소 하나만** 뽑아 오고도 성공으로 답했다
- **2026-10-09** in [shared-packages](../topics/shared-packages.md): 대리 접속 헤더는 조건(관리자 ∧ `/api/partner/` ∧ 값 있음)이 안 맞으면 **오류 없이 빠진다** — 의도된 동작이지만, 같은 탭에서 계정이 바뀌면 붉은 띠 없이 평소 포털로 돌아간다. 클라이언트 `^\d+$` 와 서버 `^\d{1,18}$` 의 틈도 같은 종류
- **2026-10-05** in [infrastructure](../topics/infrastructure.md) / [sp-node-api](../topics/sp-node-api.md): **증빙 IP 가 전부 127.0.0.1** — sp-node 가 nginx 뒤에서 루프백으로만 들어오니 `request.ip` 가 늘 프록시 주소였고, 개발의뢰 수락·검수·NDA 서명·카트 `ct_ip`·삭제 감사가 모두 같은 값으로 적혔다. 교정한 `client-ip.ts` 도 `X-Real-IP` 줄이 빠진 nginx 블록에서는 **오류 없이** 연결 주소로 돌아간다 — 새 server 블록을 만들 때 그 줄을 옮기지 않으면 다시 조용히 같아진다
- **2026-09-30** in [parts-engine](../topics/parts-engine.md): **한 행의 세 공급사가 동시에 "미실행·0ms·오류"** — 공급사 장애가 아니라 엔진 후처리 예외를 배치 격리가 고정 문구("공급사 검색 작업을 완료하지 못했습니다.")로 합성한 것. 남는 단서는 예외 클래스명(`_batch_error_type`) 하나였고, 양산 Reel 결함은 같은 행을 같은 캐시로 재생해서야 드러났다
- **2026-08-23** in [parts-engine](../topics/parts-engine.md) / [sp-node-api](../topics/sp-node-api.md): 재고표 12,175행 결과 6.36MB 를 통째로 저장하다 MySQL 패킷 한도에서 연결이 끊겼는데 화면에는 **`BOM_ENGINE_ERROR` 로 위장**돼 나왔다 — 가장 가까운 catch 가 원인을 다른 이름으로 바꿨다
- **2026-08-11** in [testing](../topics/testing.md) / [api-contract](../topics/api-contract.md): 여정이 연달아 잡은 세 건 — **없는 필드를 읽으면 기본값이 어서션을 통과한다**(29호 `-1·-1·-1`) · 191자를 넘는 프로젝트명을 비 strict DB 가 **조용히 잘라** 성공으로 답한다(36호 → `clampPcbProjectName` 이 명시적으로 자르고 말줄임표) · 검색창 `%` 한 글자가 전체 20,805건을 돌려준다(24호 — `escapeLike` 누락, `_` 는 파일명에 흔해 더 조용히 틀린다)
- **2026-08-05** in [gnuboard-integration](../topics/gnuboard-integration.md): `git subtree pull` 은 그누보드가 그 줄 근처를 안 건드리면 코어 한 줄 수정을 **충돌 없이 원본으로 덮는다** — 이관 회원 로그인 불가가 경고 없이 재발한다. `check-core-patches.sh` 가 이 한 가지를 잡으려고 생겼다
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md): 가격 엔진 `optionPrice` 는 **표에 없는 값이면 0**(레거시 `getPrice` 동일)이고 `panel` 이 `yes` 면 수량이 0이 돼 견적요청으로 떨어진다 — 거버 뷰어가 값 표기를 하나 바꾸면 오류 없이 주문 금액만 달라진다. 담기 API 가 모르는 spec 키를 막지 않고 `unknownSpecKeys` 로 **보고**하는 것이 이 틈의 유일한 신호

## What This Means
"방어적으로 짠다"가 여기서는 양날이다. 폴백·기본값·격리는 장애를 좁히지만 **좁힌 만큼 보이지 않게 된다.** 위 아홉 건 중 테스트가 먼저 잡은 것은 08-11 의 셋뿐이고 나머지는 운영 데이터나 사용자 제보가 먼저였다 — 그리고 그 셋도 "주행이 통과했는데 화면이 이상하다"는 육안에서 시작했다([journey-recheck-loop](journey-recheck-loop.md)의 "검증이 조용히 비는 3패턴").

리포가 찾은 처방은 넷이다.

1. **조용히 넘기지 말고 멈춘다** — `strictPort`(포트가 밀리면 기동 실패), 분류 안 된 테이블 앞에서 중단하는 재이관, 길면 우리가 자르고 표시를 남기는 `clampPcbProjectName`([judgment-single-owner](judgment-single-owner.md)의 fail-closed).
2. **경계에서 출처를 다시 읽는다** — 변환된 값을 되돌리려 하지 않고 원문을 다시 읽거나(`sp_bridge_text`), 믿을 조건을 좁힌다(연결 상대가 루프백일 때만 `X-Real-IP`).
3. **폴백의 입구를 좁힌다** — "4xx 면 재시도"가 아니라 "이 코드들은 그대로 던진다".
4. **삼키더라도 지문은 남긴다** — `_batch_error_type`, `unknownSpecKeys`, AI 초안의 `aiFlags`, 잡의 실패 사유 코드.

새 폴백을 넣을 때 물을 것은 하나다 — **이 장치가 실패를 가렸을 때 누가 어떻게 알게 되는가.** 답이 "아무도"면 그것은 방어가 아니라 지연이다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [infrastructure](../topics/infrastructure.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [parts-engine](../topics/parts-engine.md)
- [shared-packages](../topics/shared-packages.md)
- [testing](../topics/testing.md)
- [api-contract](../topics/api-contract.md)
- [apps/api/src/lib/client-ip.ts](../../samplepcb-web-mono-app/apps/api/src/lib/client-ip.ts) — 루프백일 때만 `X-Real-IP`
- [apps/api/src/pricing/engine.ts](../../samplepcb-web-mono-app/apps/api/src/pricing/engine.ts) — `optionPrice`: 표에 없으면 0
- [samplepcb-web/extend/sp_pcb_eq.extend.php](../../samplepcb-web/extend/sp_pcb_eq.extend.php) — `sp_bridge_text`
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — pull 직후 가드 필수
