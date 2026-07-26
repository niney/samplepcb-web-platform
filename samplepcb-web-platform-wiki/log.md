# Compile Log

## 2026-07-27

**Topics updated:** sp-node-api, sp-vue-web, parts-engine, infrastructure, docs-knowledge, api-contract (07-13 이후 첫 갱신 — bom-quote.ts +600·parts.ts +207 계약 확장 반영)
**New topics:** none
**New concepts:** judgment-single-owner (판단 단일 소유권 — AGENTS.md "BOM 역할 경계" 명문화: 엔진=기술·조달 판단 원본, 노드=계약·저장·정책, 뷰=표시 전용. decision 계약 fail-closed·판정 그대로 렌더·타입 보증 `z.literal(0)`, 5토픽 연결). 기존 2종 갱신 — in-memory-async-jobs(**방향 전환 기록**: 07-20~23 BOM 트랙이 완료 원문·사용량·중복 방지를 DB 원장으로 승격 — 분석 append-only·gzip 아티팩트+30초 복구 워커·fingerprint 인제스트 원장·일일 사용량 DB; 구 "일일 카운터 인메모리" 인스턴스 대체 표기), snapshot-freeze(provenance 박제 — 검색어 trace·분석 원문·Walsin 가격 Git 스냅샷)
**Sources scanned:** 44 knowledge files (+ 토픽별 경량 코드 스캔)
**Sources changed:** 13 (AGENTS.md — sp-engine 별칭+BOM 역할 경계, docs/BOM_QUOTE.md +433, docs/PARTS_SEARCH.md +126, docs/AI_WORKFLOW_PLAYBOOK.md +1행(07-22 2워커 병렬), schema.prisma +364(-157 — 신규 모델 5종: SpPartIngestRun·SpBomSupplierResultArtifact·SpBomSupplierSearchTrace·SpBomSupplierDailyUsage + fingerprint 3컬럼·searchRequirements), apps/api .env.example(PART_INGEST_DB_CONCURRENCY), sp-engine README +150·.env.example(SUPPLIER_MAX_CALLS=3000), ops/README.md(deploy 케이스 10) + 신규 5종: docs/DB_TUNING.md·walsin README 2종·yeonho Rev2 README·docs/prompts/sp-engine-candidate-decision.md)
**핵심 변화:** ① 제조사 카탈로그 → SamplePCB 자체 취급 편입(연호 Rev2 1,606·Walsin R/C 2,628 — `offer_kind='manufacturer_catalog'` 분리, 부품 유형별 로컬 우선 조회 `catalog-evaluate-batch` API 0회, "문의 견적"=금액 없는 identity 선정, Walsin 가격 사전 스냅샷) ② 엔진 결과 영속 원장 전환(인메모리 소실 대비 구조 해소) ③ 판단 단일 소유권 경계 확립(검색 조건 판정 엔진 일원화 — sp-node switch 제거, 정확 MPN 우선 선정, 제조사 충돌 판정 폐기) ④ 카탈로그 파괴 작업 안전 등급 분리(필터 전건 삭제=견적 보호 vs 초기화=`RESET_WITH_QUOTES` 견적 강제 삭제) ⑤ sp-engine 운영 배포(systemd 유닛+deploy.sh 케이스 10 — 풀 재배포에 미포함 주의) ⑥ InnoDB buffer pool 16M→1G(P2028 후속, 운영 최소 2G 체크리스트). sp-market-web·shared-packages·spcb-bridge·theme-sp-lite·gnuboard-integration 은 유의미 변경 없어 건너뜀
**미분류/후보:** docs/prompts/ 하위 디렉토리는 `docs/*.md` 패턴 밖이나 parts-engine·docs-knowledge 소스로 수동 편입(패턴에 `docs/prompts/*.md` 추가 검토). 지난 회 후보 "sp_config key-value 전역 스위치"는 이번에도 신규 인스턴스 없음(유지 관찰), "신규 앱 온보딩 체크리스트"는 3회째 반복 미발생. 신규 관찰: "fingerprint 파생 증분"(factsFingerprint→indexFingerprint→contentFingerprint 사슬 — 현재 sp-node-api 단독이라 개념 승격 보류)

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
