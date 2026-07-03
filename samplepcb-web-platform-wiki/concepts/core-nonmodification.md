---
concept: 코어 비수정 우회 기법
last_compiled: 2026-07-03
topics_connected: [gnuboard-integration, sp-node-api, theme-sp-lite, spcb-bridge, infrastructure]
status: active
---

# 코어 비수정 우회 기법 (Core Non-Modification)

## Pattern
이 플랫폼의 모든 설계 결정을 지배하는 단일 제약: **그누보드5/영카트 코어는 한 줄도 수정하지 않는다** (subtree pull 로 보안 패치를 계속 받아야 하므로). 코어와 요구사항이 충돌할 때마다 "코어를 고치는" 대신 코어의 기존 확장점(테마 오버라이드, extend/, 스냅샷 모델)을 역이용하거나, 코어 밖(spcb/, sp-node, nginx)에서 문제를 푼다. 충돌 지점별 우회 기법 카탈로그가 docs/GERBER_ORDER_FLOW.md 4장에 10건 누적되어 있다.

## Instances
- **2026-07-03** in [theme-sp-lite](../topics/theme-sp-lite.md): [선택사항수정] 팝업의 수량 변경이 견적 행에서 선형 곱 오류를 내자 — 코어 팝업을 고치지 않고 **테마 cart 스킨에서 버튼을 분기 숨김** (기법 #8)
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md): 장바구니 삭제를 훅 없이 감지 — **lazy reconcile** (목록 조회 시점에 "ctId 있음+cart 행 없음" 파생, 기법 #10)
- **2026-07-02** in [sp-node-api](../topics/sp-node-api.md): 코어 가격 재검증(before_check_cart_price)을 **옵션 행 실등록(io_id=quoteId)** 으로 정당하게 통과 (기법 #3)
- **2026-07-02** in [spcb-bridge](../topics/spcb-bridge.md): 세션 키(ss_cart_id)를 외부 서버가 알 수 없는 문제 — 코어 대신 **me.php JWT 에 cartId 클레임** 추가 (기법 #4)
- **상시** in [gnuboard-integration](../topics/gnuboard-integration.md): 커스텀 계층 규칙 자체(extend/·spcb/·테마·모노레포)와 g5 한정 예외 4종
- **상시** in [infrastructure](../topics/infrastructure.md): 통합을 코드가 아닌 **nginx 라우팅**(/→PHP, /app→Vue, /api→Node)으로 해결

## What This Means
"코어를 못 고친다"는 제약이 오히려 아키텍처를 깨끗하게 유지시킨다 — 모든 커스텀이 명시적 경계(spcb/, 테마, sp-node) 안에 있어 업스트림 동기화·소유권·책임이 명확하다. 새 요구사항이 코어와 충돌하면: ① 기법 카탈로그에서 유사 사례를 먼저 찾고 ② 없으면 새 기법을 만들되 반드시 카탈로그에 추가한다. "코어 한 줄만 고치면 되는데"라는 유혹이 가장 위험한 순간이다.

## Sources
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [infrastructure](../topics/infrastructure.md)
