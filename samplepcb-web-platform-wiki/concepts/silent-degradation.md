---
concept: 실패가 오류가 아니라 그럴듯한 값으로 나타난다 (Silent Degradation)
last_compiled: 2026-11-15
topics_connected: [sp-node-api, infrastructure, spcb-bridge, gnuboard-integration, parts-engine, shared-packages, testing, api-contract, sp-develop-web, theme-sp-lite, sp-market-web, smartsmt-integration, sp-vue-web]
status: active
---

# 실패가 오류가 아니라 그럴듯한 값으로 나타난다 (Silent Degradation)

## Pattern
이 리포에서 가장 오래 숨어 있던 결함들은 **오류를 내지 않았다.** 대신 그럴듯한 값을 냈다 — 전부 같은 IP, 0원 가산, 고정 문구, 잘린 이름, 기본값. 화면은 멀쩡하고 테스트는 통과하고 로그는 조용하다. 기전은 매번 같다: **실패를 부드럽게 넘기려고 둔 장치(폴백·기본값·격리·자동 이스케이프)가 실패 신호 자체를 삼킨다.**

네 부류로 나뉜다:

- **경계에서 값이 평탄해진다** — 프록시 뒤의 `request.ip`, 코어가 건 `addslashes`, DB 가 조용히 자르는 긴 문자열, 조각 경계에서 깨지는 다바이트 글자. 값은 있는데 뜻이 사라졌다.
- **폴백이 다른 실패를 흡수한다** — 표에 없으면 0, 헤더가 없으면 연결 주소, 옵션 오류면 옵션 빼고 재시도. 원래 잡으려던 실패 말고도 걸려든다.
- **격리가 원인을 지운다** — 행 하나의 예외가 배치를 죽이지 않게 한 격리가 메시지를 고정 문구로 바꾼다.
- **검증한 것과 도는 것이 다르다** (2026-10~11 추가) — 개발 빌드·개발 서버·실행 중에 바뀐 스크립트는 운영 산출물과 다른 방식으로 실패를 삼킨다. 테스트는 통과했는데 운영만 다르다.

## Instances
- **2026-11-13~14 (반대편 처방 — 시끄럽게 닫는다)** in [smartsmt-integration](../topics/smartsmt-integration.md) / [spcb-bridge](../topics/spcb-bridge.md) / [infrastructure](../topics/infrastructure.md) / [sp-node-api](../topics/sp-node-api.md): SmartSMT 공유 비밀이 비었거나·32자 미만이거나·**`JWT_SECRET` 과 같으면** sp-node(수신·가져오기)와 PHP 로그인 인계가 **둘 다 503 으로 닫힌다**. 운영에 같은 값을 넣는 실수가 가장 위험해서(그 값을 가진 쪽은 로그인 없이 관리자 토큰을 만들 수 있다) 코드로 막았고, 정본은 "조용히 열려 있는 것보다 시끄럽게 닫히는 쪽"을 골랐다고 적는다. 그래서 런북에 반영 단계가 없어도 빠뜨리면 조용하지는 않다. 다만 소리가 닿는 곳이 좁다 — 503 은 SmartSMT 화면에 `HTTP_503` 으로만 뜨고 재시도가 없으며, 관리자 '연동 상태'의 '공유 비밀 설정됨'은 **sp-node 쪽만** 보므로 PHP `secret.php` 가 빠져 인계가 503 이어도 "설정됨"으로 보일 수 있다(구조상 그렇다는 판독 — 실제로 겪은 사례는 아니다. 인계 쪽은 `/spcb/sso/smartsmt` 를 직접 열어 확인한다)
- **2026-11-13~14 (바깥 원문을 화면이 조용히 비운다)** in [sp-vue-web](../topics/sp-vue-web.md) / [sp-node-api](../topics/sp-node-api.md) / [smartsmt-integration](../topics/smartsmt-integration.md): SMT 견적 상세는 바깥 JSON 을 타입 가드로만 읽어 칸이 없거나 모양이 다르면 '—' 로 둔다(화면이 죽지 않는 것이 먼저). 그런데 그 칸 목록은 SmartSMT 문서로 짠 **가짜 견본**(`smartsmt-sample.ts`) 기준이라, 실제 견적서의 칸 이름·모양이 다르면 화면은 **조용히 비고** 값은 접힌 '원문' 섹션에만 남는다(실제 견본이 오면 원문과 나란히 대조할 것). 같은 축의 코드 읽기 발견 둘 — ① 중복 판정이 파일 대조보다 먼저라, 관리자가 **가져오기로 먼저 저장한 견적**(파일 없음)과 같은 `quote_id` 로 전송이 뒤늦게 오면 200 `duplicate` 로 끝나고 동봉 파일이 버려진다(문서·테스트엔 없는 경우) ② 인증 실패 기록 상한(시간당 30건, 프로세스 메모리 창)에 `NOT_CONFIGURED` 도 묶여, 미설정 상태에서 SmartSMT 가 계속 보내면 31번째부터는 기록이 남지 않는다
- **2026-11-13** in [sp-develop-web](../topics/sp-develop-web.md): **장을 다시 재는 한 틱이 쓰던 글을 지웠다** — 16:9 장 판에서 다시 재는 동안 장 목록이 비면 장 아래 판(`QuoteActions`)이 걷혔다 다시 서는데, 수정 요청 사유를 쓰다 창을 옮겼다 오면(vue-query 재조회) 그 사이에 입력이 오류 없이 비워졌다. `settled`(앞서 그린 장 유지)로 막았고 고객 여정이 그것을 되돌리면 실패하는 것까지 확인했다 — 지워진 입력은 화면에 아무 흔적도 남기지 않는다
- **2026-11-04** in [sp-develop-web](../topics/sp-develop-web.md) / [testing](../topics/testing.md): **의뢰 출력물이 운영 빌드에서만 빈 화면** — 쪽 나누기 전(`pageCount` 0)에 판 사이 가림 `v-for` 가 `pageCount - 1` = −1 을 받았다. 운영 빌드의 숫자 범위 `v-for` 는 `new Array(-1)` 그대로라 RangeError 로 출력물 전체가 비고, **개발 빌드는 경고 뒤 빈 목록**이라 로컬·개발 서버 위 e2e 에선 쪽 나누기를 넣은 `c4875889d` 이후 고칠 때까지 드러나지 않았다. 처방은 0 아래로 내려가지 않는 `maskCount` + 같은 데이터로 운영 빌드 전/후 비교(전 RangeError·빈 화면, 후 22쪽·오류 0)
- **2026-10-30** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md) / [sp-develop-web](../topics/sp-develop-web.md): **AI 스트림의 한글이 조각 경계에서 U+FFFD 로** — Ollama 스트림을 조각마다 `Buffer.toString` 으로 따로 디코딩해 경계에 걸린 3바이트 글자가 깨졌다("열처리" → "열처�"). 오류도 없고 JSON 파싱도 통과한다. 검토서·구성도·EQ 번역·후속 질문이 모두 같은 클라이언트라 전부 해당됐고, 맞춤 질문 **프로빙**이 찾았다([probe-before-decide](probe-before-decide.md)). `TextDecoder` 스트림 모드로 고쳤지만 10-30 이전에 저장된 AI 산출물의 깨진 글자는 정리하지 않았다
- **2026-10-22** in [infrastructure](../topics/infrastructure.md): **배포 스크립트가 받은 자기 자신을 실행하지 않았다** — `deploy.sh` 는 도중에 자기를 `git pull` 하는데 bash 는 함수를 시작할 때 이미 읽어 두므로 그 실행은 옛 단계로 돌았다. 빌드에서 `vue-tsc` 를 뺀 첫 배포에서 `vue-tsc` 가 그대로 돈 원인. 처방은 pull 전후 해시 비교 → 같은 케이스로 한 번만 `exec`(DB 원복 기준 커밋은 처음 실행의 HEAD 를 물려받음). ⚠ 자체 `git pull` 을 쓰는 케이스 6·10 은 이 재시작을 안 탄다
- **2026-10-22** in [spcb-bridge](../topics/spcb-bridge.md) / [gnuboard-integration](../topics/gnuboard-integration.md): **로그인이 오류 없이 안 붙는다** — 레거시 사이트가 `.samplepcb.co.kr` 전체에 심은 `PHPSESSID` 와 이 서버의 호스트 전용 `PHPSESSID` 가 같이 실리면 PHP 는 먼저 만들어진 레거시 쪽을 읽고 `/spcb/api/me` 는 401 이다. 우회(`legacy-session-pick.php`)가 이 서버에 실제로 있는 세션을 고르는데, 그 우회도 세션 저장이 `files` 가 아니면 **조용히 꺼진 채 지나간다**
- **2026-10-13** in [theme-sp-lite](../topics/theme-sp-lite.md): 로그인 아이디 칸 `maxLength` 20 — 07-07 코어가 이메일 아이디를 허용한 뒤로 20자를 넘는 이관 회원 855명(6,402명 중)이 석 달 동안 아이디를 끝까지 칠 수 없었다. 입력칸은 글자를 더 받지 않을 뿐 아무 말도 하지 않는다. 30자로 늘렸고 30자를 넘는 8명은 여전히 못 친다
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
"방어적으로 짠다"가 여기서는 양날이다. 폴백·기본값·격리는 장애를 좁히지만 **좁힌 만큼 보이지 않게 된다.** 10-12 까지의 아홉 건 중 테스트가 먼저 잡은 것은 08-11 의 셋뿐이고 나머지는 운영 데이터나 사용자 제보가 먼저였다 — 그리고 그 셋도 "주행이 통과했는데 화면이 이상하다"는 육안에서 시작했다([journey-recheck-loop](journey-recheck-loop.md)의 "검증이 조용히 비는 3패턴"). 10-13~11-04 의 다섯 건도 테스트가 먼저 잡은 것은 없다 — 프로빙(스트림 한글)·운영 빌드(출력물)·배포 그 자체(deploy.sh)·운영 사이트(세션)가 먼저였고, 아이디 길이는 석 달이 걸렸다.

이번 기간이 더한 부류는 **검증 환경의 격차**다. 개발 서버 위 e2e 는 운영 빌드에만 있는 실패를 원리적으로 못 본다. 10-22 배포 빌드에서 타입 검사를 뺀 것(운영 서버 메모리)도 같은 축의 선택이다 — 검사는 "푸시 전 로컬 `typecheck`"로 옮겨 갔는데 그 규칙은 `deploy.sh` 주석에만 있고 CI 는 없다.

리포가 찾은 처방은 다섯이다.

1. **조용히 넘기지 말고 멈춘다** — `strictPort`(포트가 밀리면 기동 실패), 분류 안 된 테이블 앞에서 중단하는 재이관, 길면 우리가 자르고 표시를 남기는 `clampPcbProjectName`([judgment-single-owner](judgment-single-owner.md)의 fail-closed).
2. **경계에서 출처를 다시 읽는다** — 변환된 값을 되돌리려 하지 않고 원문을 다시 읽거나(`sp_bridge_text`), 믿을 조건을 좁힌다(연결 상대가 루프백일 때만 `X-Real-IP`).
3. **폴백의 입구를 좁힌다** — "4xx 면 재시도"가 아니라 "이 코드들은 그대로 던진다".
4. **삼키더라도 지문은 남긴다** — `_batch_error_type`, `unknownSpecKeys`, AI 초안의 `aiFlags`, 잡의 실패 사유 코드. 막지 않기로 했다면 드러내는 짝을 같이 짓는다([surface-dont-block](surface-dont-block.md)).
5. **운영과 같은 산출물로 확인한다** (2026-11 추가) — 운영 빌드 전후를 같은 데이터로 비교하고(`vite build` + preview), 배포 스크립트는 받은 자기 자신으로 다시 시작한다.

새 폴백을 넣을 때 물을 것은 하나다 — **이 장치가 실패를 가렸을 때 누가 어떻게 알게 되는가.** 답이 "아무도"면 그것은 방어가 아니라 지연이다.

2026-11-13~14 에는 처방 1('멈춘다')이 **바깥 연동의 설계 결정**으로 먼저 적혔다 — SmartSMT 는 위험한 설정을 503 으로 닫고, `settled` 는 고친 자리를 e2e 가 되돌림 시험으로 지킨다. 남은 숙제는 **닫힌 소리가 누구에게 들리는가**다. 바깥 상대 화면의 `HTTP_503` 한 줄과 두 쪽 중 한쪽(sp-node)만 보는 상태 화면은 '시끄럽게 닫기'를 반쯤 조용하게 만든다 — 닫는 장치를 둘 때 그 상태를 읽는 화면이 닫히는 쪽을 전부 보고 있는지 같이 물을 것.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [infrastructure](../topics/infrastructure.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [parts-engine](../topics/parts-engine.md)
- [shared-packages](../topics/shared-packages.md)
- [testing](../topics/testing.md)
- [api-contract](../topics/api-contract.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [sp-market-web](../topics/sp-market-web.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [apps/api/src/lib/smartsmt-token.ts](../../samplepcb-web-mono-app/apps/api/src/lib/smartsmt-token.ts) — `smartsmtSecret()`: 비었거나·짧거나·`JWT_SECRET` 과 같으면 null → 503
- [samplepcb-web/spcb/sso/smartsmt.php](../../samplepcb-web/spcb/sso/smartsmt.php) — PHP 쪽 같은 거부 판정(따로 구현)
- [apps/web/src/next/components/smt/smt-envelope.ts](../../samplepcb-web-mono-app/apps/web/src/next/components/smt/smt-envelope.ts) — 타입 가드 판독, 모르는 모양은 '—'
- [apps/api/src/lib/ai/ollama.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/ollama.ts) — 스트림 `TextDecoder`(10-30)
- [samplepcb-web/spcb/lib/legacy-session-pick.php](../../samplepcb-web/spcb/lib/legacy-session-pick.php) — 겹친 `PHPSESSID` 중 이 서버의 세션 고르기(임시)
- [deploy.sh](../../deploy.sh) — 받은 자기 자신이 바뀌면 다시 시작
- [apps/api/src/lib/client-ip.ts](../../samplepcb-web-mono-app/apps/api/src/lib/client-ip.ts) — 루프백일 때만 `X-Real-IP`
- [apps/api/src/pricing/engine.ts](../../samplepcb-web-mono-app/apps/api/src/pricing/engine.ts) — `optionPrice`: 표에 없으면 0
- [samplepcb-web/extend/sp_pcb_eq.extend.php](../../samplepcb-web/extend/sp_pcb_eq.extend.php) — `sp_bridge_text`
- [docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) — pull 직후 가드 필수
