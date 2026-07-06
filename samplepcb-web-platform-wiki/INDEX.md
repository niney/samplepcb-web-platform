# samplepcb-web-platform Knowledge Base

Last compiled: 2026-07-06
Total topics: 9 | Total sources: 22 knowledge files (+ 토픽별 경량 소스 스캔)

## Topics

| Topic | Also Known As | Sources | Last Updated | Status |
|-------|--------------|---------|-------------|--------|
| [sp-node-api](topics/sp-node-api.md) | sp-node, Fastify API, 담기 API, 가격 엔진, 관리 API, orderlist, 주문내역, g5 접근 카탈로그, 알림 브리지, requireAdmin | 14 | 2026-07-06 | active |
| [sp-vue-web](topics/sp-vue-web.md) | sp-vue, /app, Vue SPA, 관리자 화면, admin, 견적·회원·주문·설정 관리 | 8 | 2026-07-06 | active |
| [api-contract](topics/api-contract.md) | @sp/api-contract, Zod 계약, PcbProjectPayload, orders·members·admin·settings 스키마 | 9 | 2026-07-03 | active |
| [shared-packages](topics/shared-packages.md) | @sp/config, @sp/shared, @sp/utils | 10 | 2026-07-03 | active |
| [spcb-bridge](topics/spcb-bridge.md) | spcb/, me.php, order-notify.php, 인증 브리지, 알림 브리지, 견적관리, quotes.php, 보관함 | 13 | 2026-07-06 | active |
| [theme-sp-lite](topics/theme-sp-lite.md) | sp-lite, 테마, cart 스킨, default_shop.css, 주문내역·마이페이지 | 12 | 2026-07-03 | active |
| [gnuboard-integration](topics/gnuboard-integration.md) | 그누보드, 영카트, subtree, 코어 비수정, g5 접근 카탈로그, extend | 8 | 2026-07-06 | active |
| [infrastructure](topics/infrastructure.md) | nginx, ops/, 라우팅, SPCB_BRIDGE_URL, Mailpit, file.samplepcb.kr, 파일서버 | 8 | 2026-07-06 | active |
| [docs-knowledge](topics/docs-knowledge.md) | docs/, 설계 기록, GERBER_ORDER_FLOW, 가격 패리티, 알림 게이트, 메일 테스트, AI 플레이북, 택배 연동 | 9 | 2026-07-06 | active |

## Concepts

| Concept | Connects | Last Updated |
|---------|----------|-------------|
| [core-nonmodification](concepts/core-nonmodification.md) | gnuboard-integration, sp-node-api, theme-sp-lite, spcb-bridge, infrastructure | 2026-07-06 |
| [server-single-truth](concepts/server-single-truth.md) | sp-node-api, api-contract, spcb-bridge, sp-vue-web | 2026-07-06 |
| [manual-sync-drift](concepts/manual-sync-drift.md) | sp-node-api, theme-sp-lite, spcb-bridge, docs-knowledge, infrastructure | 2026-07-06 |

## Recent Changes
- 2026-07-06: 증분 재컴파일 — 지식 파일 12종 변경(신규 4: AI_WORKFLOW_PLAYBOOK·DELIVERY_CARRIER_INTEGRATION·LOCAL_MAIL_TESTING·order-notify-gating). 6개 토픽 갱신: 관리 기능 모노레포 이관(g5 접근 카탈로그 ⑤–⑱·관리자 견적/회원/주문/설정 관리·PCB 제작 8단계 선형 전이)·PHP 알림 브리지(order-notify.php, sp-node→sp-php 역방향)·로컬 메일(Mailpit)·모노레포 3경로 가동. 개념 3종에 새 인스턴스(접근 카탈로그 확장·알림 브리지 재사용·ACTIVE_ORDER_STATUSES SSOT·서버 게이트 계산) 추가.
- 2026-07-03: 최초 컴파일 — 토픽 9개 + 개념 3개 생성 (지식 파일 18개 + 토픽별 경량 코드 스캔)
