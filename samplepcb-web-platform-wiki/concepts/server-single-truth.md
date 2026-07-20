---
concept: 서버 단일 진실 (클라이언트 불신)
last_compiled: 2026-07-20
topics_connected: [sp-node-api, api-contract, spcb-bridge, sp-vue-web, sp-market-web]
status: active
---

# 서버 단일 진실 (Server as Single Source of Truth)

## Pattern
가격·인증·상태·권한·노출 판정은 전부 서버에서만 계산하고, 클라이언트가 보낸 값은 표시용으로만 취급한다. 위변조 차단이 1차 목적이지만, 부수 효과로 "두 화면이 같은 값을 보여준다"는 일관성도 서버 단일 계산에서 나온다. 관리자 화면이 붙으면서 이 패턴은 가격·사양 표기를 넘어 **권한 경계·알림 노출·상태 전이 가능 여부**로 확장됐다 — FE 는 서버가 내려준 boolean/값을 소비만 한다.

## Instances
- **2026-07-19~20** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): **BOM 견적 — 합계·확정가는 서버 재계산만 진실**. FE 편집은 PATCH 후 서버 값을 소비하고(setQueryData 로 응답 반영), RFQ 확정가는 서버가 정본화. AI·엔진 산출물도 클라이언트 제출값을 믿지 않고 서버 재렌더·해시 대조로 검증. 스냅샷 박제와 쌍([[snapshot-freeze]])
- **2026-07-12** in [sp-node-api](../topics/sp-node-api.md) / [sp-market-web](../topics/sp-market-web.md): 재능마켓의 **블라인드·실명 마스킹·입찰 제한(system×individual 403)을 전부 서버가 강제** — FE는 선반영 UX일 뿐, 마스킹 해제·입찰 가능 판정은 sp-node가 계산. 위저드의 동적 스텝 존재 여부도 서버/관리자 설정(sp_ai_usecase 활성)이 결정하고 FE는 boolean 소비만
- **2026-07-05** in [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): 알림 체크박스 **노출을 서버가 계산** — `getNotifyConfig`(cf_email_use·cf_sms_use·de_sms_use4/5)가 boolean 3종을 내려주고 FE(`OrderActionBar`·`OrderDetailDrawer`)는 `v-if` 로 소비만. "노출됐는데 안 나감"을 서버 단일 계산이 원천 차단
- **2026-07-05** in [sp-node-api](../topics/sp-node-api.md): 주문 상태 전이 가능 여부·미수금/과세 재계산·취소 스킵 판정을 **서버가 전담**(orderTransitionGuard·computeOrderMoney·resolveForceStatusStock). 클라이언트는 target 만 보낸다
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md): 관리 API 경계는 **`requireAdmin` 데코레이터가 JWT `isAdmin` 클레임으로 검증** — sp-vue 라우터 가드는 UX용, 진짜 경계는 서버(router.ts 주석에 명시)
- **2026-07-02** in [sp-node-api](../topics/sp-node-api.md): 거버 제출 payload 에 **가격이 아예 없다** — 서버 재계산만이 진실. 수량 수정도 PATCH → 전체 재견적(새 quoteId 불변 스냅샷)
- **2026-07-02** in [spcb-bridge](../topics/spcb-bridge.md): JWT 는 10분 만료 + **매 액션 직전 재발급, 클라이언트 저장 금지** — 세션이 진실원본, 토큰은 캐시
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): 두 화면(cart/quotes) 사양 표기를 맞출 때도 프런트 중복이 아니라 **서버 buildOptionSummary 하나**를 `optionSummary` 필드로 내려 통일
- **2026-07-02** in [sp-node-api](../topics/sp-node-api.md): cart↔spec 관계를 저장하지 않고 **조회 시점 파생**(ct_id 조인) — 동기화 로직이 없으니 불일치도 없다

## What This Means
새 기능에서 "클라이언트가 이 값을 보내주면/판정하면 되지 않나?"가 나오면 이 패턴 위반 신호다. 값·권한·노출은 서버가 계산하고, 클라이언트는 식별자(projectId, qty, odId, target)만 보낸다. 화면 간 표기 불일치나 "노출됐는데 실제론 다르게 동작" 문제도 프런트 수정이 아니라 "서버가 문자열/boolean 을 내려주는" 방향으로 푸는 것이 이 코드베이스의 관례다. 라우터 가드·FE `v-if` 는 UX 편의일 뿐 절대 보안·정합 경계가 아니다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-vue-web](../topics/sp-vue-web.md)
