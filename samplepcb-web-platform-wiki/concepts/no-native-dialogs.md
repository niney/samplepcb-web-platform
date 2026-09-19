---
concept: 네이티브 대화상자를 쓰지 않는다 (No Native Dialogs)
last_compiled: 2026-09-19
topics_connected: [sp-vue-web, theme-sp-lite, spcb-bridge, sp-develop-web, docs-knowledge, partner-tracks]
status: active
---

# 네이티브 대화상자를 쓰지 않는다 (No Native Dialogs)

## Pattern
`alert`·`confirm`·`prompt` 를 PHP·Vue 양쪽에서 전면 금지하고 공용 커스텀 대화상자로 대체했다. 취향의 문제가 아니라 **업무가 막히는 결함**이었다:

1. **브라우저의 "이 사이트에서 추가 대화상자를 표시하지 않음" 체크 한 번이면** `confirm()` 이 조용히 `false` 를 돌려주고, 확인이 필요한 **조작 자체가 통째로 막힌다**(`confirmDialog.ts` 헤더가 이 문장을 그대로 담고 있다). 사용자는 버튼이 안 먹는다고만 느낀다.
2. **네이티브 창을 두 번 띄우면 두 번째 취소가 첫 입력을 지운다** — 값을 받는 `prompt` 사슬에서 실제로 났던 결함.
3. **그누보드 코어 `alert()` 은 `bbs/alert.php` 로 페이지를 통째로 갈아치운다** — 빈 화면 → 시스템 팝업 → 뒤로가기. 작업 맥락이 사라지고, 실패 시 자체 alert 로 끝나 버려 **감쌀 수조차 없다**.
4. 브라우저마다 모양이 달라 사이트 톤과 따로 논다.

대체물은 두 벌이다 — Vue 쪽 `confirmDialog()` + 앱 루트 `UiConfirmHost` 하나(+값 입력은 `UiPromptModal`), PHP 테마 쪽 `js/sp-dialog.js`. 둘 다 **호출 모양은 네이티브 그대로**(`if (!(await confirmDialog('…'))) return;`) 유지해 교체 비용을 호출부에 떠넘기지 않았다.

## Instances
- **2026-09-19 (스캔)** in [sp-vue-web](../topics/sp-vue-web.md): 실측 성적표 — `apps/*/src`·`packages/*/src` 전체에서 `window.confirm` 실호출 **0건**(남은 3건은 전부 "쓰지 말라"는 주석), `window.prompt` 실호출 **1건**(`BomRfqPanel.vue` — 클립보드 복사 실패 시 링크를 직접 복사하게 하는 폴백). `confirmDialog(` 호출은 63곳
- **2026-09-09~11** in [sp-develop-web](../topics/sp-develop-web.md): 개발 모듈이 규율을 그대로 상속 — 위저드의 확인 대화는 **전부 인라인 패널**(파일 헤더가 "네이티브 confirm 금지"를 명시), 편집 중 이탈 가드는 `confirmDialog`(라우터) + `beforeunload` 조합. 관리자 상세의 상태 사유 입력도 인라인
- **2026-09-05 ~ 09-08** in [docs-knowledge](../topics/docs-knowledge.md) / [sp-vue-web](../topics/sp-vue-web.md): **워커 지시서의 공통 불변식에 들어갔다** — `docs/prompts/` 지시서 골격의 불변식 목록이 파일 스코프·타입 강성·커밋 금지와 나란히 **"네이티브 confirm 금지"**를 적는다. 관리자 화면 지시서 5편(`develop-phase1b`·`2b`·`wizard-v2b`·`followup-admin`·`dev-review-phase4b`)이 같은 줄을 반복한다 — 규율이 코드 리뷰가 아니라 **작업 계약**으로 굳은 지점
- **2026-08-10** in [sp-vue-web](../topics/sp-vue-web.md) / [partner-tracks](../topics/partner-tracks.md): **P4.11 전면 제거** — `window.prompt` 7곳 → `UiPromptModal`(필드 정의·필수값 잠금·Ctrl+Enter), `window.confirm` 33곳 → `confirmDialog()` + 앱 루트 `UiConfirmHost` 하나. `tone:'danger'` 로 되돌리기 어려운 조작의 확인 버튼을 붉게, 동시에 하나만 뜨고 앞선 물음은 취소로 닫힌다
- **2026-08-07~10** in [theme-sp-lite](../topics/theme-sp-lite.md) / [spcb-bridge](../topics/spcb-bridge.md): PHP 쪽 짝 `js/sp-dialog.js` — 의존성 0(jQuery 불필요), Promise 기반이라 기존 `confirm()` 자리를 그대로 대체, `role=alertdialog`·ESC 취소·포커스 복귀·배경 스크롤 잠금, **메시지는 `textContent` 로만** 넣어 서버 문구를 그대로 받아도 XSS 가 되지 않는다
- **2026-08-07~25** in [spcb-bridge](../topics/spcb-bridge.md) / [core-nonmodification](core-nonmodification.md): 브리지 결과 안내의 배관 — 코어 alert 대신 **원래 화면으로 `?sp_msg=&sp_tone=` 를 실어 리다이렉트**하고 `sp-dialog.js` 가 모달로 띄운 뒤 `replaceState` 로 쿼리를 지운다. 대가는 복제 하나 — 코어 `check_token()` 이 실패 시 자체 alert 로 끝나 감쌀 수 없어 `sp_pcb_check_token()` 사본을 뒀다(⚠ `lib/common.lib.php` 가 바뀌면 같이 맞춰야 한다)
- **2026-08-06** in [sp-vue-web](../topics/sp-vue-web.md): 같은 시기 **삭제 확인 UX 를 3단 레이어로 통일** — 차단 사유 전부 표시 → 관리자 체크로 해제 → 실행. 네이티브 창 한 줄로는 담을 수 없는 정보량이고, 이것이 커스텀 대화상자가 필요한 **적극적** 이유다([destructive-op-guardrails](destructive-op-guardrails.md))

## What This Means
확인 절차는 UI 부품이 아니라 **업무 안전장치**다. 안전장치를 **사용자가 체크박스 하나로 끌 수 있는 브라우저 기능** 위에 올리면, 꺼진 순간 조작이 막히거나(그나마 다행) 확인 없이 지나간다. 그래서 규칙은 단순하다 — 새 화면에서 `alert`/`confirm`/`prompt` 를 쓰지 않는다.

- **확인**은 `confirmDialog()`(Vue) 또는 `spDialog.confirm()`(PHP 테마). 되돌리기 어려우면 `tone:'danger'`.
- **값 입력**은 `UiPromptModal` — 필드를 정의하고 필수값을 잠근다. 여러 값을 연속 `prompt` 로 받던 패턴은 **한 화면에서 한 번에** 받는 형태로 접는다.
- **상태 사유·이탈 확인처럼 맥락이 필요한 것**은 모달조차 아니고 **인라인 패널**이 낫다(개발 모듈 관례).
- 호출 모양을 네이티브와 같게 유지하는 것이 이 전환을 가능하게 했다 — 40여 호출부를 바꾸면서 로직은 건드리지 않았다.

⚠ 남은 예외는 하나, 클립보드 복사 실패 폴백의 `window.prompt` 다(복사할 텍스트를 선택 가능한 형태로 내놓는 것 외에 대안이 마땅치 않은 자리). 새로 만들지 말 것.

⚠ 브라우저 자동화에도 영향이 있다 — 네이티브 대화상자는 드라이버가 별도 핸들러로 받아야 하고 그 전까지 페이지가 멈춘다. 같은 결로 `FileDropZone` 의 숨은 input 을 `display:none` 대신 `sr-only` 로 둔 것도 자동화가 잡을 수 있게 하기 위함이다 — **화면 부품의 선택이 검증 가능성을 좌우한다.**

## Sources
- [sp-vue-web](../topics/sp-vue-web.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [partner-tracks](../topics/partner-tracks.md)
