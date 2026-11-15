---
concept: 정하기 전에 잰다 (Probe Before Decide)
last_compiled: 2026-11-15
topics_connected: [sp-node-api, docs-knowledge, testing, theme-sp-lite, spcb-bridge, sp-market-web, infrastructure, sp-develop-web, smartsmt-integration, api-contract]
status: active
---

# 정하기 전에 잰다 (Probe Before Decide)

## Pattern
모델을 고르고, 성능을 고치고, 정책을 정하기 **전에 재는 단계가 따로 있다.** 재는 일은 결정과 섞지 않는다 — 별도 문서(프로빙 기록), 별도 도구(관측 러너·성능 스크립트), 별도 자리(`spcb/previews/`)에서 하고, 결과로 **표**를 낸다. 결정은 그 표를 근거로 달린다.

재는 것의 모양은 넷이다:

- **모델 프로빙** — 후보 여러 개를 같은 입력·같은 채점식으로 돌려 정확도·지연·실패 유형을 낸다.
- **현행 관측** — 시안이나 정책을 정하기 전에 "지금 무엇이 보이는가/무슨 일이 일어나는가"를 먼저 표로 굳힌다.
- **원인 분리 실측** — 제보 하나를 측정으로 쪼개 서로 다른 결함으로 가른다.
- **자족 실험실** — 본 시스템과 무관한 정적 페이지에서 안을 나란히 보고 채택안만 옮긴다.

재고 난 도구는 버리지 않고 리포에 남겨 **회귀 감시**로 바꾼다.

## Instances
- **2026-11-13~14 (바깥 상대를 짓기 전에 잰다)** in [smartsmt-integration](../topics/smartsmt-integration.md) / [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): SmartSMT 연동은 상대 문서가 말하지 않는 것을 **짓기 전에 실측**으로 채웠다 — ① 개발 서버를 키 없이 불러 `403 {"detail":{"reason":"BAD_KEY",…}}` 를 받고 **실패 사유가 `detail.reason` 에 있다**는 것을 알았다(문서 미기재 — 우리 실패 본문도 그 모양으로 맞췄다) ② `@fastify/multipart` 10.0.0 이 `application/json` 값 파트를 **객체로 바꿔 넘긴다**는 것을 플러그인 소스(index.js 312–326)로 확인하고, 그대로 쓰면 공용 `collectMultipart` 가 견적서를 버린다는 것을 알아 전용 `collectSmartsmtParts` 를 지었다 ③ 파일서버가 새 버킷 `smt` 를 받는지(올리기·내려받기·지우기·해시 일치)를 재고 정했다 ④ 실제 서버·DB 로 여섯 경우(정상·중복·같은 주문 새 견적·잘못된 토큰·파일 내용 바뀜·파일 없음)를 보내 기대대로 답하는지 본 뒤 시험 행을 지웠다 ⑤ 가져오기는 실제 개발 서버를 불러 `403 BAD_KEY` → `502 SMARTSMT_AUTH_REJECTED` 를 확인했다(상대가 아직 `X-API-Key` 방식). 요청서의 curl 예시도 로컬 서버에 실제로 돌려 `duplicate` false → true 를 본 뒤 넣었다. 반대로 **아직 잴 수 없는 것은 정하지 않고 재는 자리를 남겼다** — 10초 타임아웃 상향은 미리 요청하지 않고(사용자 결정) 걸린 시간을 수신 원장 `durationMs` 에 남기며, 실제 견본이 없어 화면 칸은 문서로 짠 가짜 견본 기준이고 계약은 해석 함수를 갖지 않는다
- **2026-11-03** in [sp-develop-web](../topics/sp-develop-web.md) / [infrastructure](../topics/infrastructure.md): 개발의뢰 랜딩 히어로를 반복 영상에서 **캔버스 프레임 재생**으로 바꾸며 프레임 팩의 폭·용량을 재서 정했다(`hero-frames.mjs` — ffmpeg 없이 시스템 Chrome 디코더로 굽는다, 4.93MB 1요청). 재는 도구는 이번에도 `ops/scripts/` 에 남았다
- **2026-10-30** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md) / [testing](../topics/testing.md): **개별 메뉴 AI 맞춤 질문 프로빙** — 예시 의뢰 17건(메뉴별 짧은 설명·자세한 설명·첨부 + 여러 메뉴 2)을 `probe-develop-area-followup.ts` 로 돌리며 프롬프트를 v1 → v4(→ v5)로 고쳤고, 같은 프롬프트를 think low·medium 으로 34회씩 돌렸다. low 는 3~13초·형식 오류 0 이지만 정황으로 짐작한 답을 채웠고, medium 은 14~118초(중간값 약 50초)지만 직접 적힌 것만 채웠다 → **medium**. EQ 프로빙(10-11)은 "사고 수준을 올려도 정확도가 안 오른다"로 low 를 골랐는데 여기선 반대로 갔다 — 같은 절차, 반대 결론, 갈림은 표가 냈다(잘못 채운 답은 고객 답처럼 저장된다, [ai-removable-layer](ai-removable-layer.md)). 두 가지가 새로웠다: ① **채점식 없이 사람이 나란히 보는 프로빙**(EQ 는 합성 정답 채점) ② 프로빙이 출하된 코드의 결함을 찾았다 — 모든 AI 기능 공통의 스트림 한글 깨짐([silent-degradation](silent-degradation.md)). 결정도 "시험 운영 + 끄면 롤백"이라 **운영 자체가 다음 프로빙**이다
- **2026-10-11** in [sp-node-api](../topics/sp-node-api.md) / [docs-knowledge](../topics/docs-knowledge.md) / [testing](../topics/testing.md): **PCB EQ 엑셀 AI 분석 프로빙** — 15모델·LLM 작업 543건을 합성 코퍼스(사양 하나에서 파일과 정답을 같이 만든 14종, 홀드아웃 포함)로 채점해 `kimi-k3`·think `low`·프롬프트 `eq-parse-v3` 를 골랐다. 표가 직관을 뒤집었다 — **사고 수준을 올려도 정확도는 안 오르고 지연만 3배.** 근거는 설계 문서와 분리된 [PCB_EQ_AI_PROBE](../../docs/PCB_EQ_AI_PROBE.md) 에 채점식·실패 유형·"남은 의문"까지 남겼고, 프로빙 하네스(`probe-eq-parse.ts`)와 코퍼스는 단위·e2e 가 같이 쓴다
- **2026-10-05** in [sp-node-api](../topics/sp-node-api.md): **sp-node 전수 점검 — "측정이나 코드로 확인된 결함만" 고친다.** 폴링 경로가 읽던 0.5~3.5MB → 거의 0, 관리자 비교 로더 14.9 → 6.9초, PCB Case 목록 ~500 → 216ms 처럼 고친 것마다 전후 수치가 붙는다. 확인되지 않은 것은 손대지 않았고 `/api/svc` 보호는 사용자 결정으로 범위에서 뺐다
- **2026-10-05** in [testing](../topics/testing.md): **여정 25호는 정책을 정하기 전의 현행 관찰** — 고객 BOM 견적 취소가 지금 무엇을 하는지 상태별로 따라가 다섯 가지(취소 뒤 열린 RFQ·삭제 시 회신 유실·검토 중 화면/서버 불일치·검색 중 굳음·확정↔취소 겹침)를 드러낸 뒤에 사용자가 정책을 정했고, 구현 뒤 기대값을 뒤집어 회귀선이 됐다
- **2026-09-21** in [theme-sp-lite](../topics/theme-sp-lite.md) / [infrastructure](../topics/infrastructure.md): **히어로 배경 "wide 에서 끊김"을 실측으로 둘로 갈랐다** — ① 끊김의 주범은 배너 01 SVG 윤곽 회전(매 프레임 404KB 문자열, CPU 4배 스로틀에서 메인스레드 68%) ② "wide" 는 별개 결함(팬 진폭이 `100vw` 라 리사이즈 순간 146px 점프). 처방도 둘로 나뉘었고(`.is-lite` 강등 / 진폭 상수 600px) 측정 스크립트 `hero-perf.mjs` 가 `verify` 모드로 남았다
- **2026-09-06** in [spcb-bridge](../topics/spcb-bridge.md) / [theme-sp-lite](../topics/theme-sp-lite.md): **로그인 배경 실험실** — `spcb/previews/` 에 그누보드·인증·DB 와 무관한 자족 정적 페이지 2벌을 두고 안을 비교해, 채택안(`center-swap` 연속 회전)만 테마 `js/motion-path.js` 스냅샷으로 옮겼다
- **2026-08-28~09-04** in [sp-market-web](../topics/sp-market-web.md) / [sp-node-api](../topics/sp-node-api.md): AI 사전 검토서·정밀 구성도 — 모델별 지연을 재서(정밀 구성도 141~581초) **동기로 기다릴 수 없다**는 것을 확인한 뒤 비동기 잡+동시 1 큐로 설계가 갈렸다. 측정이 화면 구조를 정했다
- **2026-08-25** in [testing](../topics/testing.md) / [api-contract](../topics/api-contract.md): **관측 러너 `status-matrix`** — 어서션은 "조작 API 가 200 인가"뿐이고 산출물은 표(관리자 조작 → `od_status` → 배지·탭 → 고객 배지·스텝퍼). 고객 진행 표시 시안을 정하기 **전에** 지금 보이는 것을 확정했고, 그 표가 `/api/order-progress` 와 PHP 사전 교정의 근거가 됐다

## What This Means
이 리포의 결정 기록이 유독 **"A 가 아니라 B, 왜냐하면 수치가"** 꼴인 이유다. 프로빙을 건너뛴 자리에는 대신 "직관으로 정했다가 되돌린" 기록이 남는다. 재는 단계가 주는 것은 정답이 아니라 **뒤집힐 때의 근거**다 — 모델이 바뀌거나 양식이 늘면 같은 채점식으로 다시 돌리면 된다. 10-11 EQ(→ think low)와 10-30 맞춤 질문(→ think medium)이 같은 질문에 반대로 답한 것이 그 증거다: "think 는 낮게"라는 관례가 생기지 않은 것은 매번 쟀기 때문이다. 기준도 표 밖에서 왔다 — 지연을 얼마나 참을지는 **틀린 값이 어디에 저장되는가**가 정했다.

[golden-as-spec](golden-as-spec.md) 과 짝이다. 골든은 "정해진 것을 고정"하고 프로빙은 "정하기 전에 잰다" — EQ 코퍼스처럼 프로빙용으로 만든 표가 결정 뒤에는 골든이 된다. [journey-recheck-loop](journey-recheck-loop.md) 의 "관찰 → 엄선"도 같은 순서를 여정 단위로 밟는다.

함정은 문서다. **프로빙 문서의 "제안" 절은 구현과 어긋난 채 남는다** — [PCB_EQ_AI_PROBE](../../docs/PCB_EQ_AI_PROBE.md) §8 은 잡 결과에 `eqDraft` 를 저장하고 번역용 유스케이스를 따로 두자고 했지만 코드는 LLM 원출력만 저장하고 `pcb.eq-parse` 스위치를 같이 쓴다. §10 의 "번역은 넣지 않는다"는 같은 날 P4 가 뒤집었다. 프로빙 문서는 **측정 절만 정본**이고 제안 절은 그 시점의 생각으로 읽어야 한다([manual-sync-drift](manual-sync-drift.md)). 또 하나 — 실험실은 "검토 끝나면 삭제"라 적고도 남는다(`previews/` 10-12 현재 잔존).

11-13 의 SmartSMT 는 재는 대상이 **우리 모델·우리 화면이 아니라 바깥 상대**인 첫 사례다. 상대 문서는 우리가 고칠 수 없고 빠진 곳(실패 사유의 위치)이 있으며, 상대 서버는 개발 단계라 바뀐다. 그래서 측정 결과가 결정의 근거이자 **상대에게 되묻는 목록**이 된다 — 정본은 "실측으로 확인한 것"(§8)과 "SmartSMT 에 물어야 할 것"(§6)을 따로 둔다. 그리고 잴 수 없는 것(실제 견본·상대의 최신 판정 기준·10초 안에 끝나는지)은 결정을 미루되 **잴 자리**(원장의 `durationMs`, 받은 글자 그대로 보관한 원문, 바꿀 한 줄의 위치)를 먼저 깔아 둔다. "정하기 전에 잰다"의 짝은 "지금 못 재면 나중에 잴 수 있게 짓는다"다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [testing](../topics/testing.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-market-web](../topics/sp-market-web.md)
- [infrastructure](../topics/infrastructure.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [api-contract](../topics/api-contract.md)
- [docs/SMARTSMT_INTEGRATION.md](../../docs/SMARTSMT_INTEGRATION.md) — §1 `detail.reason` 실측 · §4.4 envelope 객체 변환(확인됨) · §6 SmartSMT 에 물어야 할 것 · §8 "실측으로 확인한 것"·가져오기 실측
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.4 맞춤 질문 프로빙(v1 → v4, low/medium 34회씩)
- [apps/api/src/scripts/probe-develop-area-followup.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/probe-develop-area-followup.ts) — 예시 의뢰 17건
- [ops/scripts/hero-frames.mjs](../../ops/scripts/hero-frames.mjs) — 히어로 프레임 팩 굽기
- [docs/PCB_EQ_AI_PROBE.md](../../docs/PCB_EQ_AI_PROBE.md) — 채점식·코퍼스·모델 표·남은 의문
- [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) — 검토서·정밀 구성도 모델 선택
- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — 히어로 저사양 대응 실측
- [ops/scripts/hero-perf.mjs](../../ops/scripts/hero-perf.mjs) — perf|verify
