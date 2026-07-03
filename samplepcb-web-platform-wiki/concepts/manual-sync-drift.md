---
concept: 수동 동기화 지점과 드리프트 리스크
last_compiled: 2026-07-03
topics_connected: [sp-node-api, theme-sp-lite, spcb-bridge, docs-knowledge]
status: active
---

# 수동 동기화 지점과 드리프트 리스크 (Manual Sync Drift)

## Pattern
시스템 경계(PHP↔Node, 로컬↔라이브)를 넘는 곳마다 **코드로 강제되지 않는 수동 동기화 지점**이 생기고, 여기서 드리프트가 실사고로 이어진 이력이 반복된다. 이 코드베이스에서 버그가 났던 곳은 대부분 로직 오류가 아니라 "두 곳에 같은 값이 있는데 한쪽만 바뀐" 경우다.

## Instances
- **2026-07-03 (실사고)** in [docs-knowledge](../topics/docs-knowledge.md) / [sp-node-api](../topics/sp-node-api.md): **가격표 스냅샷 드리프트** — 라이브 pricing_data 를 관리자가 수시 조정하는데 로컬 스냅샷이 낡아 가격 불일치. 해법: `pnpm pricing:sync` + PRICE_VERSION + 실측 패리티 테스트 절차화
- **2026-07-03 (실사고)** in [docs-knowledge](../topics/docs-knowledge.md) / [api-contract](../topics/api-contract.md): **differentDesign 키 누락** — 어댑터의 역행 매핑(diffDesign) 잔존으로 키가 빠지자 조용히 "0원 → rfq" 강등. 계약 통일로 해소
- **상시 리스크** in [theme-sp-lite](../topics/theme-sp-lite.md) / [spcb-bridge](../topics/spcb-bridge.md) / [sp-node-api](../topics/sp-node-api.md): **템플릿 4종 it_id(TEMPLATE_ITEMS)가 3곳에 복제** — sp-node g5-db.ts(정본), 테마 cart.php 분기, quotes/archive 페이지 썸네일 매핑. 카테고리 추가 시 3곳 동시 수정 필요
- **상시 리스크** in [spcb-bridge](../topics/spcb-bridge.md): quotes.php 의 ERROR_MSG 매핑이 서버 에러 코드와 수동 대응 — 서버에 코드 추가 시 프런트 매핑 누락 가능

## What This Means
동기화 지점을 없애는 게 최선(예: optionSummary 를 서버가 내려 표기 중복 제거), 없앨 수 없으면 ① 정본이 어디인지 주석으로 명시하고 ② 검증을 자동화(패리티 테스트)하며 ③ 이 문서에 지점을 등록해 둔다. 새 기능 리뷰 때 "이 값이 다른 곳에도 있나?"를 표준 질문으로 삼을 것. 템플릿 it_id 3중 복제는 향후 서버가 매핑을 내려주는 방향으로 수렴할 후보다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [docs-knowledge](../topics/docs-knowledge.md)
