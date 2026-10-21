---
concept: 정하기 전에 잰다 (Probe Before Decide)
last_compiled: 2026-10-12
topics_connected: [sp-node-api, docs-knowledge, testing, theme-sp-lite, spcb-bridge, sp-market-web, infrastructure]
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
- **2026-10-11** in [sp-node-api](../topics/sp-node-api.md) / [docs-knowledge](../topics/docs-knowledge.md) / [testing](../topics/testing.md): **PCB EQ 엑셀 AI 분석 프로빙** — 15모델·LLM 작업 543건을 합성 코퍼스(사양 하나에서 파일과 정답을 같이 만든 14종, 홀드아웃 포함)로 채점해 `kimi-k3`·think `low`·프롬프트 `eq-parse-v3` 를 골랐다. 표가 직관을 뒤집었다 — **사고 수준을 올려도 정확도는 안 오르고 지연만 3배.** 근거는 설계 문서와 분리된 [PCB_EQ_AI_PROBE](../../docs/PCB_EQ_AI_PROBE.md) 에 채점식·실패 유형·"남은 의문"까지 남겼고, 프로빙 하네스(`probe-eq-parse.ts`)와 코퍼스는 단위·e2e 가 같이 쓴다
- **2026-10-05** in [sp-node-api](../topics/sp-node-api.md): **sp-node 전수 점검 — "측정이나 코드로 확인된 결함만" 고친다.** 폴링 경로가 읽던 0.5~3.5MB → 거의 0, 관리자 비교 로더 14.9 → 6.9초, PCB Case 목록 ~500 → 216ms 처럼 고친 것마다 전후 수치가 붙는다. 확인되지 않은 것은 손대지 않았고 `/api/svc` 보호는 사용자 결정으로 범위에서 뺐다
- **2026-10-05** in [testing](../topics/testing.md): **여정 25호는 정책을 정하기 전의 현행 관찰** — 고객 BOM 견적 취소가 지금 무엇을 하는지 상태별로 따라가 다섯 가지(취소 뒤 열린 RFQ·삭제 시 회신 유실·검토 중 화면/서버 불일치·검색 중 굳음·확정↔취소 겹침)를 드러낸 뒤에 사용자가 정책을 정했고, 구현 뒤 기대값을 뒤집어 회귀선이 됐다
- **2026-09-21** in [theme-sp-lite](../topics/theme-sp-lite.md) / [infrastructure](../topics/infrastructure.md): **히어로 배경 "wide 에서 끊김"을 실측으로 둘로 갈랐다** — ① 끊김의 주범은 배너 01 SVG 윤곽 회전(매 프레임 404KB 문자열, CPU 4배 스로틀에서 메인스레드 68%) ② "wide" 는 별개 결함(팬 진폭이 `100vw` 라 리사이즈 순간 146px 점프). 처방도 둘로 나뉘었고(`.is-lite` 강등 / 진폭 상수 600px) 측정 스크립트 `hero-perf.mjs` 가 `verify` 모드로 남았다
- **2026-09-06** in [spcb-bridge](../topics/spcb-bridge.md) / [theme-sp-lite](../topics/theme-sp-lite.md): **로그인 배경 실험실** — `spcb/previews/` 에 그누보드·인증·DB 와 무관한 자족 정적 페이지 2벌을 두고 안을 비교해, 채택안(`center-swap` 연속 회전)만 테마 `js/motion-path.js` 스냅샷으로 옮겼다
- **2026-08-28~09-04** in [sp-market-web](../topics/sp-market-web.md) / [sp-node-api](../topics/sp-node-api.md): AI 사전 검토서·정밀 구성도 — 모델별 지연을 재서(정밀 구성도 141~581초) **동기로 기다릴 수 없다**는 것을 확인한 뒤 비동기 잡+동시 1 큐로 설계가 갈렸다. 측정이 화면 구조를 정했다
- **2026-08-25** in [testing](../topics/testing.md) / [api-contract](../topics/api-contract.md): **관측 러너 `status-matrix`** — 어서션은 "조작 API 가 200 인가"뿐이고 산출물은 표(관리자 조작 → `od_status` → 배지·탭 → 고객 배지·스텝퍼). 고객 진행 표시 시안을 정하기 **전에** 지금 보이는 것을 확정했고, 그 표가 `/api/order-progress` 와 PHP 사전 교정의 근거가 됐다

## What This Means
이 리포의 결정 기록이 유독 **"A 가 아니라 B, 왜냐하면 수치가"** 꼴인 이유다. 프로빙을 건너뛴 자리에는 대신 "직관으로 정했다가 되돌린" 기록이 남는다. 재는 단계가 주는 것은 정답이 아니라 **뒤집힐 때의 근거**다 — 모델이 바뀌거나 양식이 늘면 같은 채점식으로 다시 돌리면 된다.

[golden-as-spec](golden-as-spec.md) 과 짝이다. 골든은 "정해진 것을 고정"하고 프로빙은 "정하기 전에 잰다" — EQ 코퍼스처럼 프로빙용으로 만든 표가 결정 뒤에는 골든이 된다. [journey-recheck-loop](journey-recheck-loop.md) 의 "관찰 → 엄선"도 같은 순서를 여정 단위로 밟는다.

함정은 문서다. **프로빙 문서의 "제안" 절은 구현과 어긋난 채 남는다** — [PCB_EQ_AI_PROBE](../../docs/PCB_EQ_AI_PROBE.md) §8 은 잡 결과에 `eqDraft` 를 저장하고 번역용 유스케이스를 따로 두자고 했지만 코드는 LLM 원출력만 저장하고 `pcb.eq-parse` 스위치를 같이 쓴다. §10 의 "번역은 넣지 않는다"는 같은 날 P4 가 뒤집었다. 프로빙 문서는 **측정 절만 정본**이고 제안 절은 그 시점의 생각으로 읽어야 한다([manual-sync-drift](manual-sync-drift.md)). 또 하나 — 실험실은 "검토 끝나면 삭제"라 적고도 남는다(`previews/` 10-12 현재 잔존).

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [testing](../topics/testing.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-market-web](../topics/sp-market-web.md)
- [infrastructure](../topics/infrastructure.md)
- [docs/PCB_EQ_AI_PROBE.md](../../docs/PCB_EQ_AI_PROBE.md) — 채점식·코퍼스·모델 표·남은 의문
- [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) — 검토서·정밀 구성도 모델 선택
- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — 히어로 저사양 대응 실측
- [ops/scripts/hero-perf.mjs](../../ops/scripts/hero-perf.mjs) — perf|verify
