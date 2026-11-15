---
concept: AI 는 떼어낼 수 있는 층 (AI as a Removable Layer)
last_compiled: 2026-11-15
topics_connected: [sp-develop-web, sp-node-api, api-contract, partner-tracks, sp-vue-web, testing, sp-market-web]
status: active
---

# AI 는 떼어낼 수 있는 층 (AI as a Removable Layer)

## Pattern
이 리포의 AI 기능은 **AI 없이도 완결되는 결정적 흐름 위에 얹힌다.** 꺼도, 실패해도, 시간이 넘어가도 흐름은 그대로 서고, AI 가 내놓은 것은 이미 있던 코드 공간 안으로 끌려 들어온 뒤에만 저장된다. 그래서 AI 품질이 흔들려도 분기·검토서·관리자 신호·저장 데이터가 흔들리지 않고, 끄는 비용이 0 이다.

같은 규칙 다섯이 기능마다 되풀이된다.

1. **분기·판정은 고정 코드가 쥔다** — AI 가 만든 질문·선택지 코드는 의뢰마다 달라 분야 판정·필수 게이트·관리자 신호에 쓸 수 없다. 판정에 쓰이는 질문은 AI 에 맡기지 않는다.
2. **AI 출력은 기존 코드로 정규화된 뒤에만 저장된다** — 선택지마다 원래 코드(`maps`), 없는 코드·근거 없는 채움은 원래 문구로 되살림, 새 선택지는 기본 질문에 '기타'가 있을 때만 `other`+메모.
3. **기본 꺼짐, 스위치가 곧 롤백** — 유스케이스마다 관리자 설정의 켜기 스위치가 있고 운영에서 켜는 것은 배포 뒤처리다.
4. **실패·시간 초과는 결정적 기본값으로** — 고정 질문, 기본 질문, 전이는 진행.
5. **고객에게 가기 전에 사람이 선다** — AI 초안은 관리자 검토를 거친다.

테스트도 같은 층 구조를 따른다 — **실 LLM 은 0 이 기본**이고 옵트인으로만 부른다.

## Instances
- **2026-11-13 (번호는 AI 가 만들지 않는다)** in [api-contract](../topics/api-contract.md) / [sp-develop-web](../topics/sp-develop-web.md): 검토서 '확인이 필요한 사항'에 고객 답을 붙이려고 문항 번호 `openQuestions[].id` 를 더했는데, **LLM 출력 스키마(`buildDevReviewLlmJsonSchema`)엔 `id` 가 없다** — 모델은 번호를 만들지 않고 서버가 읽을 때 질문 문구의 해시로 채운다(`withDevReviewQuestionIds`). 그래서 AI 가 초안을 다시 만들어도 문구가 같은 문항은 같은 번호이고, 고객 답의 짝은 결정적 코드가 붙든다. 경계는 그대로 남는다 — AI 가 문구를 바꾼 초안을 만들면 답이 짝을 잃고 관리자 편집기 아래 '짝을 잃은 고객 답변'으로만 보인다. 고객 답을 다음 AI 검토서 입력으로 쓰는 것(사용자 결정 ④)은 후속이다
- **2026-11-12 (11-06 결정의 커밋)** in [sp-develop-web](../topics/sp-develop-web.md) / [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md): 시스템개발 범위가 `d97844e58` 로 커밋되며 두 가지가 더 드러났다 — ① 고정 질문 `system.software` 는 `askOnDelegate`(고객이 "전문가에게 맡김"을 골라 AI 후속 질문을 건너뛰어도 묻는다) — 판정에 쓰는 질문은 AI 경로가 꺼져도 사라지면 안 된다 ② **AI 프롬프트 쪽도 줄였다**: 후속 질문 `develop-followup.v2` 는 '연동 대상'에서 "새로 만드는지 이미 있는지"를 빼고 그 판단을 고정 질문에 넘겼다 — 같은 것을 AI 와 고정 질문이 둘 다 묻지 않게. 대가: 옛 시스템개발 의뢰 중 기구 '준비됨·다른 업체·필요 없음' 답이 있는 건은 AI 원천의 조건 줄이 하나 늘어 **원천 서명이 바뀌고** 검토서·구성도에 '원천 변경' 표시가 뜬다(로컬 #92). 운영 DDL 없음
- **2026-11-06 (미커밋)** in [sp-develop-web](../topics/sp-develop-web.md) / [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md): **AI 가 범위를 판정하게 두지 않고 AI 에게 줄 칸을 줄였다** — 시스템개발은 저장 분야가 늘 6개라 앱·서버가 필요 없는 제품도 검토서에 빈 앱·서버 칸이 생기고 구성도가 앱↔서버 토폴로지를 지어냈다(로컬 #92·#257). "서버 안 함" 답은 AI 후속 질문에서도 나오지만 그 코드는 의뢰마다 AI 가 만들어 판정에 못 쓴다 → 고정 질문 `system.software` 를 더하고 답으로 뺄 분야를 계약 `developSystemExcludedAreas` 가 정한다. **저장 분야는 6개 그대로**, 줄이는 곳은 AI 원천(`developReviewAreas`)뿐 — 배지 25곳이 저장 분야를 읽기 때문이다([record-not-state](record-not-state.md))
- **2026-11-02** in [sp-develop-web](../topics/sp-develop-web.md): PCB 설계는 개별 메뉴 AI 맞춤 질문에서 빼고 **고정 질문 + 질문별 설계 자료 첨부**로 묻는다 — 거버·BOM·외형 같은 제작 입력은 AI 가 고쳐 물을 대상이 아니다
- **2026-10-30** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): **개별 메뉴 AI 맞춤 질문(`develop.area-followup`)이 다섯 규칙을 한 기능에 다 담았다** — ① AI 에 맡기지 않는 질문 `DEVELOP_AREA_FOLLOWUP_LOCKED`(분야 판정·필수 권리 확인·조건부 질문의 근거) ② 결정적 정규화(답의 코드는 그대로라 분기·검토서·관리자 신호·임시저장이 안 바뀐다) ③ 기본 꺼짐, 관리자 AI 설정 카드가 **롤백 스위치**("끄면 바로 기본 질문"), 코드 롤백도 커밋 3개로 적어 둠 ④ 실패·시간 초과면 조용히 기본 질문 ⑤ think 하한 목록 `DEVELOP_AREA_FOLLOWUP_THINK_LEVELS` 하나를 선택지·저장 검증·실행 보정이 같이 본다. 사용자 결정은 "일단 해보고 퀄리티 안 나오면 롤백" — 시험 운영이 가능한 것은 떼어낼 수 있게 지었기 때문이다
- **2026-10-30 (층이 진실에 닿는 자리)** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): AI 가 **답을 미리 채우면** 그 값은 고객 답처럼 저장된다. think low 는 3~13초지만 정황으로 짐작한 답을 채웠고, medium 은 14~118초(중간값 약 50초)지만 직접 적힌 것만 채웠다 → **지연보다 정확도**를 택해 기본을 medium 으로([probe-before-decide](probe-before-decide.md)). 화면에는 'AI 가 채움'·'AI 가 채움 · 고객이 고침' 표시와 근거 인용이 남는다
- **2026-10-30** in [testing](../topics/testing.md): 실 LLM 브라우저 테스트는 `FOLLOWUP_LLM=1` 옵트인, 나머지는 유스케이스를 끄거나 완료 잡을 직삽입하고 실 LLM 건너뜀을 따로 센다. ⚠ 반례 — 고객 여정 e2e 는 끌 유스케이스 목록(`USECASES`)을 계약 `AI_USECASES` 와 따로 들고 있어, 10-30 에 생긴 `develop.area-followup` 이 11-02(`bea8c968c`)에야 목록에 들어갔다. 그 사이 로컬에서 켜져 있으면 고객 여정이 실 LLM 을 불렀다([manual-sync-drift](manual-sync-drift.md))
- **2026-10-11** in [partner-tracks](../topics/partner-tracks.md) / [sp-node-api](../topics/sp-node-api.md): **PCB EQ 엑셀 AI 분석(`pcb.eq-parse`)** — AI 는 문항 **초안**만 만들고 관리자가 검토한 뒤 고객에게 보낸다. 승인요청 전이에 매달려 돌되 전이를 실패시키지 않고 실패는 사유 코드 4종으로만 남는다([surface-dont-block](surface-dont-block.md)). 켜짐·모델·think 는 관리자 설정 "PCB EQ 분석" 한 스위치(기본 꺼짐) — 운영에서 켜는 것이 배포 뒤처리 목록에 올라 있다
- **2026-09-04~11** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-market-web](../topics/sp-market-web.md): 시스템개발 AI 후속 질문(`develop.followup`)은 300초 초과·실패·유스케이스 꺼짐이면 **고정 3문항**으로 폴백한다. 개발의뢰 검토서는 관리자 주도(초안 → 검토 → 공개본)로, 마켓 사전 검토서와 같은 러너를 쓰되 고객에게 나가는 문은 사람이 연다
- **2026-07** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md): 범용 AI 유스케이스 계층(`sp_ai_usecase` + `/api/ai/:useCase/run` 비동기 잡) — 처음부터 **유스케이스마다 켜기 스위치**였고 "로컬은 켜고 운영은 관리자 탭에서 켜야 한다"가 첫 배포 때부터의 관례다

## What This Means
AI 를 "기능"이 아니라 **"떼어낼 수 있는 층"** 으로 지으면 세 가지를 공짜로 얻는다 — 시험 운영(켜 보고 아니면 끈다), 장애 격리(LLM 이 느리거나 죽어도 흐름은 선다), 품질 흔들림의 격리(AI 가 엉뚱한 코드를 내도 정규화가 원래 문구로 되돌린다). 대신 비용이 있다: 고정 질문·기본 질문이라는 **AI 없는 길을 계속 유지보수**해야 하고, 정규화 코드와 스위치 목록이 여러 곳에 생긴다(think 하한 목록은 계약 하나로 모았지만, 테스트가 끄는 유스케이스 목록은 계약과 따로 있어 새 유스케이스가 생길 때마다 손으로 더해야 한다).

층의 경계가 새는 자리는 정해져 있다 — **AI 가 쓴 값이 저장값이 되는 곳**이다. 답을 미리 채우는 맞춤 질문이 그랬고, 그 자리에서만 지연보다 정확도를 택했다. 11-06 의 교훈은 반대 방향이다: AI 에게 빈칸을 주면 **채운다**(빈 앱·서버 칸, 지어낸 토폴로지). AI 가 범위를 판단하게 하지 말고, 고정 질문으로 판단한 뒤 AI 에게 줄 칸을 줄인다.

11월 중순에 층의 규칙이 **식별자**와 **프롬프트**로 넓어졌다. 다른 데이터가 매달리는 키(고객 답이 붙는 문항 번호)는 AI 출력 스키마에 넣지 않고 결정적 코드(문구 해시)가 만든다 — AI 가 다시 써도 키가 흔들리지 않게. 그리고 고정 질문이 판정을 가져가면 AI 프롬프트에서 같은 질문을 **뺀다**(`develop-followup.v2`) — 같은 것을 둘이 묻지 않게 판정 쪽(고정 질문)만 남긴다.

새 AI 기능을 넣을 때 물을 것 셋 — **① 끄면 무엇이 남는가 ② AI 가 쓴 값이 어느 판정·저장에 닿는가 ③ 테스트가 실 LLM 없이 도는가.** 셋 중 하나라도 답이 없으면 층이 아니라 의존이다. 조용한 폴백은 [silent-degradation](silent-degradation.md) 과 종이 한 장 차이라, 폴백할 때는 'AI 가 채움' 표시·사유 코드·`aiFlags` 같은 지문을 같이 남긴다. AI 는 판단의 소유자가 되지 않는다는 점에서 [judgment-single-owner](judgment-single-owner.md) 의 연장이기도 하다.

## Sources
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [testing](../topics/testing.md)
- [sp-market-web](../topics/sp-market-web.md)
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.4 맞춤 질문(시험 운영·롤백)·§7.2.6 PCB 고정 질문·§7.2.9 시스템개발 범위(11-12 커밋 d97844e58)·§7.2.13 문항 번호(고객 답변)
- [apps/api/src/lib/ai/develop-followup.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/develop-followup.ts) — `develop-followup.v2`(연동 대상만 묻는다)
- [packages/api-contract/src/schemas/market-dev-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-review.ts) — `devReviewQuestionId`·`withDevReviewQuestionIds`(LLM 스키마엔 `id` 없음)
- [apps/api/src/lib/ai/develop-area-followup.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/develop-area-followup.ts) — 프롬프트·결정적 정규화
- [packages/api-contract/src/schemas/develop-area-followup.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-area-followup.ts) — `DEVELOP_AREA_FOLLOWUP_LOCKED`
- [packages/api-contract/src/schemas/ai.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/ai.ts) — `DEVELOP_AREA_FOLLOWUP_THINK_LEVELS`
