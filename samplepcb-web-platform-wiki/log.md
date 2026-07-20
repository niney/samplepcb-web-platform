# Compile Log

## 2026-07-20

**Topics updated:** sp-node-api, sp-vue-web, sp-market-web, infrastructure, docs-knowledge
**New topics:** parts-engine (samplepcb-parts-engine — Python uv workspace BOM 추출·공급사 검색 엔진, FastAPI :8400, sp-node 게이트웨이 소비)
**New concepts:** snapshot-freeze (스냅샷 박제+서버 재계산 — 거버→마켓→BOM 3연속 동형으로 확정), in-memory-async-jobs (인메모리 비동기 잡+영속 스냅샷 복구 — AI 잡·BOM 엔진 잡). 기존 3종 갱신 — lazy-derived-state(BOM enrichStatus 게으른 치유), server-single-truth(BOM 서버 재계산·RFQ), manual-sync-drift(공유 함수 SSOT·BOM_ENGINE_URL 동기화 지점·문서 드리프트 3건)
**Sources scanned:** 39 knowledge files (+ 토픽별 경량 코드 스캔)
**Sources changed:** 14 (AGENTS.md, mono AGENTS.md, apps/api .env.example, schema.prisma +9모델, ops/README.md, ops/nginx/local-web.conf, docs/AI_DIAGRAM.md, docs/DEPLOY_CENTRAFAB.md, docs/MARKET_FLOW.md + 신규 5종: docs/BOM_QUOTE.md·docs/PARTS_SEARCH.md·docs/bom-quote-code-review-2026-07-19.md·samplepcb-parts-engine README·.env.example)
**핵심 변화:** 고객 스마트 BOM 견적 전 계층(sp_bom_quote* 5테이블·/api/bom·/app/bom 회원 라우트 — **sp-vue "관리자 전용" 전제 공식 폐기**·RFQ·환율 스냅샷)·부품 카탈로그+ES 검색(sp_part*·sp-parts·2트랙·parts-facts)·parts-engine 프로덕션 이식+sp-node 게이트웨이·위저드 v2(AI-우선 4스텝, 2026-07-16)·sp-rnd 연구 앱(/rnd:5177, nginx 5경로·deploy.sh 9케이스)·E2E 92항목. api-contract·shared-packages·spcb-bridge·theme-sp-lite·gnuboard-integration 은 유의미 변경 없어 건너뜀
**미분류/후보:** 크로스커팅 후보로 "sp_config key-value 전역 스위치"(gerber_price_mode→AI 연결→bom_quote 네임스페이스)와 "신규 앱 온보딩 체크리스트"(market·rnd 2회 반복 — 3회째에 개념 승격 검토)가 관찰됨

## 2026-07-13

**Topics updated:** sp-node-api, sp-vue-web, api-contract, spcb-bridge, theme-sp-lite, gnuboard-integration, infrastructure, docs-knowledge
**New topics:** sp-market-web (재능마켓 Vue 앱 /market — 신규 서비스)
**New concepts:** admin-vue-consume-php (관리=sp-vue/소비=sp-php 공유 DB 브릿지 — 슬라이드·후기·SEO 3회 반복), lazy-derived-state (cron 없는 lazy 파생 상태 — paid 승격·자동확정·입찰 마감·reconcile). server-single-truth에 마켓 서버 강제 인스턴스 추가
**Sources scanned:** 30 knowledge files (+ 토픽별 경량 코드 스캔)
**Sources changed:** 16 (AGENTS.md, mono AGENTS.md, .env.example, schema.prisma, ops/README.md, ops/nginx/local-web.conf, docs/GERBER_ORDER_FLOW.md, docs/DELIVERY_CARRIER_INTEGRATION.md + 신규 docs 8종: MARKET_FLOW·AI_DIAGRAM·SEO_MANAGEMENT·GERBER_PRICE_MODE·DEPLOY_CENTRAFAB·LEGACY_DB_MIGRATION·review-naming·wishlist-hidden)
**핵심 변화:** 재능마켓 1차+2차(매칭·계약·결제·검수·정산 + apps/market SPA + 관리자 4화면 + g5 카탈로그 ⑲)·AI 유스케이스 계층+인터뷰 파이프라인 Phase 1~3·거버 가격모드·레거시 DB 마이그레이션 완료(운영 풀 덤프 이관)·SEO 관리(sp_seo)·메인 슬라이드·이용후기(sp_review)·위시리스트 숨김·운영 배포 런북. shared-packages는 유의미 변경 없어 건너뜀

## 2026-07-06

**Topics updated:** sp-node-api, sp-vue-web, spcb-bridge, gnuboard-integration, infrastructure, docs-knowledge
**New topics:** none
**New concepts:** none (기존 3종에 새 인스턴스 추가)
**Sources scanned:** 22 knowledge files (+ 토픽별 경량 코드 스캔)
**Sources changed:** 12 (AGENTS.md, mono AGENTS.md, .env.example, schema.prisma, spcb/.htaccess, ops/README.md, ops/nginx/local-web.conf, docs/GERBER_ORDER_FLOW.md + 신규 docs 4종: AI_WORKFLOW_PLAYBOOK·DELIVERY_CARRIER_INTEGRATION·LOCAL_MAIL_TESTING·order-notify-gating)
**핵심 변화:** 관리 기능 모노레포 이관(g5 접근 카탈로그 ⑤–⑱)·관리자 견적/회원/주문/설정 관리·PCB 제작 8단계 선형 전이·PHP 알림 브리지(order-notify.php)·로컬 메일(Mailpit)·모노레포 3경로 가동

## 2026-07-03

**Topics updated:** sp-node-api, sp-vue-web, api-contract, shared-packages, spcb-bridge, theme-sp-lite, gnuboard-integration, infrastructure, docs-knowledge
**New topics:** 전체 (최초 컴파일)
**New concepts:** core-nonmodification, server-single-truth, manual-sync-drift
**Sources scanned:** 18 knowledge files (+ 토픽별 경량 코드 스캔)
**Sources changed:** 18 (first run)
