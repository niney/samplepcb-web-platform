---
concept: 코어 비수정 우회 기법
last_compiled: 2026-07-06
topics_connected: [gnuboard-integration, sp-node-api, theme-sp-lite, spcb-bridge, infrastructure]
status: active
---

# 코어 비수정 우회 기법 (Core Non-Modification)

## Pattern
이 플랫폼의 모든 설계 결정을 지배하는 단일 제약: **그누보드5/영카트 코어는 (거의) 한 줄도 수정하지 않는다** (subtree pull 로 보안 패치를 계속 받아야 하므로). 코어와 요구사항이 충돌할 때마다 "코어를 고치는" 대신 코어의 기존 확장점(테마 오버라이드, extend/, 스냅샷 모델, 커스텀 메일 템플릿 재사용)을 역이용하거나, 코어 밖(spcb/, sp-node, nginx)에서 문제를 푼다. 충돌 지점별 우회 기법 카탈로그가 docs/GERBER_ORDER_FLOW.md 4장에 **11건** 누적됐고, g5 DB 접근은 5장 **접근 카탈로그 ⑤–⑱**로 규율된다. 관리 기능을 모노레포로 이관하며 접근면이 넓어졌지만, "코어를 고치지 않고 코어 밖에서" 원칙은 그대로다.

## Instances
- **2026-07-05** in [spcb-bridge](../topics/spcb-bridge.md) / [sp-node-api](../topics/sp-node-api.md): 주문 알림(메일/SMS)을 Node 로 **재구현하지 않고** 레거시 커스텀 메일 템플릿(`ordermail.inc.php`)을 `order-notify.php` 브리지로 재사용 — 코어의 검증된 발송 자산을 그대로 빌림
- **2026-07-05** in [gnuboard-integration](../topics/gnuboard-integration.md): PCB 제작 8단계 상태를 **신규 컬럼·Prisma 마이그레이션 없이** `od_status`/`ct_status` 재사용으로 구현(공유 DB reset 제약 회피). 고객 배지도 테마 오버라이드로 코어 무수정
- **2026-07-04** in [gnuboard-integration](../topics/gnuboard-integration.md): g5 접근을 "금지+한정 예외"에서 규율된 **접근 카탈로그**로 재정의 — 관리 기능 이관을 위해 접근면을 넓히되 g5-db.ts 일원화·함수/컬럼 단위 기록으로 규율(경계를 넓히면서도 명시적으로 유지)
- **2026-07-04** in [gnuboard-integration](../topics/gnuboard-integration.md): **기법 #11 = 무수정 원칙의 기록된 예외** — orderform.sub.php 의 SUM `ct_select` 필터·옵션 나열 교체는 피할 수 없어 코어를 최소 수정하되, 스톡 불변(no-op) 확인 + subtree 충돌 시 재적용 규약으로 봉인. "고칠 수밖에 없을 때 어떻게 봉인하는가"의 모범
- **2026-07-03** in [theme-sp-lite](../topics/theme-sp-lite.md): [선택사항수정] 선형 곱 오류를 **테마 cart 스킨 버튼 분기 숨김**으로 차단(기법 #8)
- **2026-07-03** in [sp-node-api](../topics/sp-node-api.md): 장바구니 삭제를 훅 없이 감지 — **lazy reconcile**(기법 #10)
- **2026-07-02** in [sp-node-api](../topics/sp-node-api.md): 코어 가격 재검증을 **옵션 행 실등록(io_id=quoteId)** 으로 정당 통과(기법 #3)
- **2026-07-02** in [spcb-bridge](../topics/spcb-bridge.md): 세션 키(ss_cart_id)를 외부 서버가 알 수 없는 문제 — **me.php JWT 에 cartId 클레임**(기법 #4)
- **상시** in [infrastructure](../topics/infrastructure.md): 통합을 코드가 아닌 **nginx 라우팅**으로, 메일을 코어 `G5_SMTP` 모드 유지 + 로컬 Mailpit 맞춤으로 해결

## What This Means
"코어를 못 고친다"는 제약이 오히려 아키텍처를 깨끗하게 유지시킨다 — 모든 커스텀이 명시적 경계(spcb/, 테마, sp-node, 접근 카탈로그) 안에 있어 업스트림 동기화·소유권·책임이 명확하다. 관리 기능 이관으로 g5 접근면이 넓어졌지만, 넓힌 만큼을 카탈로그에 등록·규율하는 것이 "고치지 않는다"를 "무엇을 만지는지 안다"로 진화시킨 형태다. 새 요구사항이 코어와 충돌하면: ① 기법 카탈로그·접근 카탈로그에서 유사 사례를 먼저 찾고 ② 없으면 새 항목을 만들되 반드시 등록한다 ③ 코어를 만질 수밖에 없으면 기법 #11처럼 최소·no-op·재적용 규약으로 봉인한다. "코어 한 줄만 고치면 되는데"라는 유혹이 가장 위험한 순간이다.

## Sources
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [infrastructure](../topics/infrastructure.md)
