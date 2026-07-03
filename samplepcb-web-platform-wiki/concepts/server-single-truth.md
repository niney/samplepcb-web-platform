---
concept: 서버 단일 진실 (클라이언트 불신)
last_compiled: 2026-07-03
topics_connected: [sp-node-api, api-contract, spcb-bridge, sp-vue-web]
status: active
---

# 서버 단일 진실 (Server as Single Source of Truth)

## Pattern
가격·인증·상태 판정은 전부 서버에서만 계산하고, 클라이언트가 보낸 값은 표시용으로만 취급한다. 위변조 차단이 1차 목적이지만, 부수 효과로 "두 화면이 같은 값을 보여준다"는 일관성도 서버 단일 계산에서 나온다.

## Instances
- **2026-07-02** in [sp-node-api](../topics/sp-node-api.md): 거버 제출 payload 에 **가격이 아예 없다** — 서버 calculateQuote 재계산만이 진실. 수량 수정도 PATCH → 전체 재견적(새 quoteId 불변 스냅샷)
- **2026-07-02** in [spcb-bridge](../topics/spcb-bridge.md): JWT 는 10분 만료 + **매 액션 직전 재발급, 클라이언트 저장 금지** — 세션이 진실원본, 토큰은 캐시
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): 두 화면(cart/quotes)의 사양 표기를 맞출 때도 프런트 중복 구현이 아니라 **서버 buildOptionSummary 하나**를 `optionSummary` 필드로 내려 통일
- **2026-07-02** in [sp-node-api](../topics/sp-node-api.md): cart↔spec 관계를 저장하지 않고 **조회 시점 파생**(ct_id 조인) — 동기화 로직이 없으니 불일치도 없다
- **상시** in [sp-vue-web](../topics/sp-vue-web.md) / [api-contract](../topics/api-contract.md): 클라이언트는 Zod 계약으로 형태만 맞추고, 판정 값(가격·상태)은 응답을 그대로 표시

## What This Means
새 기능에서 "클라이언트가 이 값을 보내주면 되지 않나?"가 나오면 이 패턴 위반 신호다. 값은 서버가 계산하고, 클라이언트는 식별자(projectId, qty)만 보낸다. 화면 간 표기 불일치 문제도 프런트 수정이 아니라 "서버가 문자열을 내려주는" 방향으로 푸는 것이 이 코드베이스의 관례다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-vue-web](../topics/sp-vue-web.md)
