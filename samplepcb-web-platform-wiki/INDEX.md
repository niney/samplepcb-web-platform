# samplepcb-web-platform Knowledge Base

Last compiled: 2026-07-13
Total topics: 10 | Total sources: 30 knowledge files (+ 토픽별 경량 코드 스캔)

## Topics

| Topic | Also Known As | Sources | Last Updated | Status |
|-------|--------------|---------|-------------|--------|
| [sp-node-api](topics/sp-node-api.md) | sp-node, Fastify API, 담기 API, 가격 엔진, 관리 API, g5 접근 카탈로그 ⑤–⑲, 재능마켓 백엔드, AI 유스케이스, 인터뷰 파이프라인, 거버 가격모드, 레거시 마이그레이션, requireAdmin | 16 | 2026-07-13 | active |
| [sp-vue-web](topics/sp-vue-web.md) | sp-vue, /app, Vue SPA, 관리자 화면, admin, 견적·회원·주문 관리, AdminMarket, AdminSeo, AdminSlides, AI 설정, GerberPricingForm | 17 | 2026-07-13 | active |
| [sp-market-web](topics/sp-market-web.md) | sp-market, /market, 재능마켓, RequestWizard, 의뢰 위저드, 전문가, 입찰, 계약, NDA, RocViewer, DiagramViewer | 8 | 2026-07-13 | active |
| [api-contract](topics/api-contract.md) | @sp/api-contract, Zod 계약, PcbProjectPayload, market·ai·seo·slides·settings 스키마, MARKET_* 코드 사전, AI_USECASES | 14 | 2026-07-13 | active |
| [shared-packages](topics/shared-packages.md) | @sp/config, @sp/shared, @sp/utils | 10 | 2026-07-03 | active |
| [spcb-bridge](topics/spcb-bridge.md) | spcb/, me.php, order-notify.php, 인증 브리지, 알림 브리지, 견적관리, quotes.php, 보관함, reviews.php, 이용후기 | 16 | 2026-07-13 | active |
| [theme-sp-lite](topics/theme-sp-lite.md) | sp-lite, 테마, cart 스킨, default_shop.css, 주문내역·마이페이지, main_slider, main_reviews, seo_head, 위시숨김 | 24 | 2026-07-13 | active |
| [gnuboard-integration](topics/gnuboard-integration.md) | 그누보드, 영카트, subtree, 코어 비수정, extend, SP_USE_WISHLIST, G5_CSS_VER, 레거시 DB 이관 | 9 | 2026-07-13 | active |
| [infrastructure](topics/infrastructure.md) | nginx, ops/, 라우팅, /market 경로, deploy.sh, DEPLOY_CENTRAFAB, systemd sp-api, Mailpit, 파일서버, e2e-market | 10 | 2026-07-13 | active |
| [docs-knowledge](topics/docs-knowledge.md) | docs/, 설계 기록, MARKET_FLOW, AI_DIAGRAM, SEO_MANAGEMENT, GERBER_PRICE_MODE, LEGACY_DB_MIGRATION, 배포 런북 | 17 | 2026-07-13 | active |

## Concepts

| Concept | Connects | Last Updated |
|---------|----------|-------------|
| [core-nonmodification](concepts/core-nonmodification.md) | gnuboard-integration, sp-node-api, theme-sp-lite, spcb-bridge, infrastructure | 2026-07-06 |
| [server-single-truth](concepts/server-single-truth.md) | sp-node-api, api-contract, spcb-bridge, sp-vue-web, sp-market-web | 2026-07-13 |
| [manual-sync-drift](concepts/manual-sync-drift.md) | sp-node-api, theme-sp-lite, spcb-bridge, docs-knowledge, infrastructure | 2026-07-06 |
| [admin-vue-consume-php](concepts/admin-vue-consume-php.md) | sp-vue-web, sp-node-api, theme-sp-lite, spcb-bridge | 2026-07-13 |
| [lazy-derived-state](concepts/lazy-derived-state.md) | sp-node-api, sp-market-web, sp-vue-web | 2026-07-13 |

## Recent Changes
- 2026-07-13: 증분 재컴파일 — 지식 파일 8종 신규(MARKET_FLOW·AI_DIAGRAM·SEO_MANAGEMENT·GERBER_PRICE_MODE·DEPLOY_CENTRAFAB·LEGACY_DB_MIGRATION·review-naming·wishlist-hidden). **신규 토픽 sp-market-web**(재능마켓 Vue 앱 /market). 9개 토픽 갱신: 재능마켓 백엔드(매칭·계약·결제·검수·정산, g5 카탈로그 ⑲)·AI 유스케이스 계층+인터뷰 파이프라인 Phase 1~3·거버 가격모드·레거시 DB 마이그레이션 완료·SEO(sp_seo)·메인 슬라이드·이용후기(sp_review)·위시리스트 숨김·운영 배포(DEPLOY_CENTRAFAB). **신규 개념 2종**: admin-vue-consume-php, lazy-derived-state. server-single-truth에 마켓 서버 강제 인스턴스 추가.
- 2026-07-06: 증분 재컴파일 — 지식 파일 12종 변경(신규 4: AI_WORKFLOW_PLAYBOOK·DELIVERY_CARRIER_INTEGRATION·LOCAL_MAIL_TESTING·order-notify-gating). 6개 토픽 갱신: 관리 기능 모노레포 이관(g5 접근 카탈로그 ⑤–⑱·관리자 견적/회원/주문/설정 관리·PCB 제작 8단계 선형 전이)·PHP 알림 브리지(order-notify.php, sp-node→sp-php 역방향)·로컬 메일(Mailpit)·모노레포 3경로 가동. 개념 3종에 새 인스턴스 추가.
- 2026-07-03: 최초 컴파일 — 토픽 9개 + 개념 3개 생성 (지식 파일 18개 + 토픽별 경량 코드 스캔)
