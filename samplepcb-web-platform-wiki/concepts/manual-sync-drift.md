---
concept: 수동 동기화 지점과 드리프트 리스크
last_compiled: 2026-07-20
topics_connected: [sp-node-api, theme-sp-lite, spcb-bridge, docs-knowledge, infrastructure, parts-engine]
status: active
---

# 수동 동기화 지점과 드리프트 리스크 (Manual Sync Drift)

## Pattern
시스템 경계(PHP↔Node, 로컬↔라이브, 코어 설정↔실발송)를 넘는 곳마다 **코드로 강제되지 않는 수동 동기화 지점**이 생기고, 여기서 드리프트가 실사고로 이어진 이력이 반복된다. 이 코드베이스에서 버그가 났던 곳은 대부분 로직 오류가 아니라 "두 곳에 같은 값이 있는데 한쪽만 바뀐" 경우다. 대응은 두 방향 — ① 동기화 지점 자체를 없애거나(서버가 값을 내려주기, SSOT 상수), ② 없앨 수 없으면 정본 명시 + 검증 자동화 + 이 문서 등록.

## Instances
- **2026-07-19~20 (드리프트 봉인)** in [sp-node-api](../topics/sp-node-api.md) / [docs-knowledge](../topics/docs-knowledge.md): **공유 함수 SSOT 확장** — bom-pricing 을 서버·FE 가 `@sp/utils` 동일 함수로 계산(+골든 테스트), spec-units 단위 해석을 색인·검색이 공유(골든 74케이스=명세). 계약(Zod)을 넘어 로직 계층까지 "동기화 지점 제거" 방향 확장
- **2026-07-18~20 (신규 동기화 지점)** in [sp-node-api](../topics/sp-node-api.md) / [parts-engine](../topics/parts-engine.md): **`BOM_ENGINE_URL`(sp-node .env) ↔ parts-engine 실행 포트(기본 8400)** — 코드로 강제되지 않는 한 값. 8100→8400 변경 이력(Hyper-V 예약범위 회피)이 이미 한 번 있었고, 불일치 시 BOM 후보 검색이 조용히 실패
- **2026-07-17~19 (문서 드리프트)** in [docs-knowledge](../topics/docs-knowledge.md) / [infrastructure](../topics/infrastructure.md): **문서가 코드를 못 따라온 지점 3건** — 루트/모노 AGENTS.md 의 "sp-vue=관리자 전용" 전제가 `/app/bom` 회원 라우트 신설(정본 router.ts+BOM_QUOTE.md)과 어긋남 · ops/README "현재" 절에 `/rnd` 누락 · parts-engine README 구조도의 `app/ (예정)` 표기 vs 실제 코드 존재
- **2026-07-05 (드리프트 봉인)** in [sp-node-api](../topics/sp-node-api.md): **`ACTIVE_ORDER_STATUSES` 상수 = SSOT** — 정상합계/부분취소/counts 의 IN절 상태 리터럴이 6곳에 복제돼 있던 것을 상수 하나로 통합(제작 8단계 도입 시 리터럴 누락 위험 제거). g5-db·계약·FE 탭·배지·i18n·sp-lite 배지가 이 한 소스를 따르게 함
- **2026-07-05 (신규 동기화 지점)** in [spcb-bridge](../topics/spcb-bridge.md) / [infrastructure](../topics/infrastructure.md): `JWT_SECRET`(sp-node .env) ↔ `SPCB_JWT_SECRET`(spcb/lib/secret.php) 한 값이 이제 **회원 JWT·서비스 JWT 양쪽**을 서명 — 불일치 시 인증·알림 둘 다 401. 부하가 커진 단일 대칭키
- **2026-07-05 (코어 내부 불일치)** in [docs-knowledge](../topics/docs-knowledge.md): 알림 게이트 — 코어 상세의 SMS 노출 조건(`cf_sms_use` truthy)과 실발송 조건(`cf_sms_use==='icode'`)이 어긋나 "노출됐는데 skip". sp-vue 가 실발송과 정합하도록 게이트를 좁혀 교정
- **2026-07-03 (실사고)** in [docs-knowledge](../topics/docs-knowledge.md) / [sp-node-api](../topics/sp-node-api.md): **가격표 스냅샷 드리프트** — 라이브 pricing_data 를 관리자가 수시 조정하는데 로컬 스냅샷이 낡아 가격 불일치. `pnpm pricing:sync`+PRICE_VERSION+패리티 테스트로 절차화
- **2026-07-03 (실사고)** in [docs-knowledge](../topics/docs-knowledge.md) / [api-contract](../topics/api-contract.md): **differentDesign 키 누락** — 어댑터 역행 매핑 잔존으로 키가 빠지자 조용히 "0원 → rfq". 계약 통일로 해소
- **상시 리스크** in [theme-sp-lite](../topics/theme-sp-lite.md) / [spcb-bridge](../topics/spcb-bridge.md) / [sp-node-api](../topics/sp-node-api.md): **템플릿 4종 it_id(TEMPLATE_ITEMS)가 3곳에 복제** — g5-db.ts(정본)·테마 cart.php·quotes/archive 썸네일. 카테고리 추가 시 3곳 동시 수정
- **상시 리스크** in [gnuboard-integration](../topics/gnuboard-integration.md): CSS/JS 고친 뒤 `version.extend.php` 의 `G5_CSS_VER` 미상향 → 캐시로 "적용 안 됨"

## What This Means
동기화 지점을 없애는 게 최선(예: optionSummary·notify-config 를 서버가 boolean/문자열로 내려 프런트 중복 제거, ACTIVE_ORDER_STATUSES 상수로 리터럴 복제 제거). 없앨 수 없으면 ① 정본이 어디인지 주석으로 명시하고 ② 검증을 자동화(패리티 테스트·단위테스트)하며 ③ 이 문서에 지점을 등록해 둔다. 새 기능 리뷰 때 "이 값이 다른 곳에도 있나?"를 표준 질문으로. 특히 시크릿 한 값이 인증+알림 두 경로를 지게 된 지금, 시크릿 정합은 배포 체크리스트 1순위다. 템플릿 it_id 3중 복제는 향후 서버가 매핑을 내려주는 방향으로 수렴할 후보다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [infrastructure](../topics/infrastructure.md)
