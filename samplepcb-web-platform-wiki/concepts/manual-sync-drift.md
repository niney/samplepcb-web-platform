---
concept: 수동 동기화 지점과 드리프트 리스크
last_compiled: 2026-09-19
topics_connected: [sp-node-api, api-contract, spcb-bridge, theme-sp-lite, gnuboard-integration, docs-knowledge, infrastructure, parts-engine, testing, sp-develop-web]
status: active
---

# 수동 동기화 지점과 드리프트 리스크 (Manual Sync Drift)

## Pattern
시스템 경계(PHP↔Node, 로컬↔운영, 코드↔문서, 코어 설정↔실발송)를 넘는 곳마다 **코드로 강제되지 않는 수동 동기화 지점**이 생기고, 여기서 드리프트가 실사고로 이어진 이력이 반복된다. 이 코드베이스에서 버그가 났던 곳은 대부분 로직 오류가 아니라 "두 곳에 같은 값이 있는데 한쪽만 바뀐" 경우다. 대응은 두 방향 — ① 동기화 지점 자체를 없애거나(서버가 값을 내려주기·SSOT 상수·라이브 fetch), ② 없앨 수 없으면 정본 명시 + 검증 자동화 + 이 문서 등록.

2026-08~09 에 지점 수가 크게 늘었다(협력 트랙 2개·개발의뢰·운영 도메인 3개). 아래는 전수가 아니라 **범주별 대표 사례 + 위험도**다.

## Instances
- **런북 드리프트 — 위험도 최상 (2026-09-19 현재)** in [infrastructure](../topics/infrastructure.md): ① **`SPCB_BRIDGE_URL` 값이 어긋난다** — `docs/DEPLOY_CENTRAFAB.md` STEP 5 는 `https://centrafab.co.kr/spcb/api/me` 로 적혀 있는데 `php-bridge.ts` 는 이 값을 **base** 로 보고 `/spcb/api/order-notify` 를 붙인다. 런북대로 넣으면 경로가 `/spcb/api/me/spcb/api/order-notify` 가 돼 **알림 브리지가 조용히 깨진다**(실패는 삼켜져 전이는 성공한다). ② 같은 런북 STEP 9 의 인라인 nginx 전문은 구판(`/rnd` 잔존·`/develop` 없음·`/shop/eq|as` rewrite 없음·슬러그를 `try_files` 로 찾아 **PHP 소스 다운로드** 함정)이고 정본은 **gitignore 된 `ops/nginx-live/` 보관본** — 클론만으로는 없고 서버 `/etc/nginx` 에서 다시 복사해야 한다
- **PHP 사전 ↔ 계약 미러 4종 (2026-08~09)** in [gnuboard-integration](../topics/gnuboard-integration.md) / [api-contract](../topics/api-contract.md) / [spcb-bridge](../topics/spcb-bridge.md): 앵커 it_id 목록(`sp_quote_it_ids`↔`TEMPLATE_ITEMS`, `sp-market-svc`↔`MARKET_ANCHOR_IT_ID`, `sp-develop-svc`↔`DEVELOP_ANCHOR_IT_ID`, `sp-bom-parts`) · 스텝퍼 stage 순서표(`sp_order_slowest_progress` rank ↔ 계약 배열) · EQ/클레임 라벨(`sp_pcb_eq_status_label`↔`PCB_EQ_REVIEW_STATUS_LABELS`, `PCB_CLAIM_*`·`BOM_CLAIM_*`) · 배송방법 한글 라벨(↔ `/adm`·메일 `{택배회사}` 치환). 게다가 **`ORDER_STATUS_CUSTOMER_LABELS` 는 역방향** — PHP `sp_order_status_customer()` 가 정본이고 계약이 사본이다(Node 가 죽어도 주문내역은 그려야 하므로). 배지 count 의 상태 문자열(`'requested'`·`'open'`·`'reviewing'`)도 PHP 가 직접 SELECT 하므로 sp-node 가 상태값을 바꾸면 **배지만 조용히 0**
- **운영 스키마는 sync 가 나르지 않는다 (2026-08-17)** in [gnuboard-integration](../topics/gnuboard-integration.md) / [sp-node-api](../topics/sp-node-api.md): `od_delivery_method` DDL 은 운영 DB 에 **수동 실행**이고 `SET SESSION sql_mode=''` 선행이 필요하며(기존 zero-date 기본값이 strict 재검증에 걸림), **DDL 먼저·배포 나중**이어야 한다(미적용 상태로 배포하면 목록·상세 SELECT 가 `Unknown column`). 같은 계열의 환경 편차 — 191자 초과 프로젝트명이 비 strict 에선 조용히 잘리고 strict 에선 500 이라 **환경마다 실패 모양이 갈린다**(여정 36호 → 계약 `clampPcbProjectName` 으로 우리가 자른다)
- **문서가 코드를 못 따라온 지점 (2026-07~09, 다발)** in [docs-knowledge](../topics/docs-knowledge.md) / [testing](../topics/testing.md) / [parts-engine](../topics/parts-engine.md) / [sp-develop-web](../topics/sp-develop-web.md): 루트·모노 `AGENTS.md` 의 "sp-vue = 관리자 전용"(실제는 관리자·회원·협력사 3축, 정본은 `router.ts` 주석+PARTNER_PORTAL) · `ops/README.md` 는 2026-07-20 판(`/develop` 없음, `deploy.sh 9` 를 R&D 로 기술) · e2e README 가 스펙 117개 중 **40개 미등재**, `e2e-market.mts` 헤더 "134항목" vs 정본 148 · parts-engine README 머리 절("437 passed" vs 수집 640 · `parser_version 1.6` vs `1.12` · `app/ 예정` vs 운영 중 · "nginx `/engine` 프록시" vs location 없음) · `docs/AI_DIAGRAM.md` 는 08-28 대체 표기 · `DEVELOP_FLOW §7.3` 의 `GET /api/admin/develop/workspace` 는 코드에 없고 **§13.5·§14 가 가리키는 `prompts/develop-workflow-{a-app,b-admin,c-module}.md` 3본은 리포에 없다**(태그 `proto-gc-coexist-20260910` 에만) · `DEPLOY_CENTRAFAB` 는 sp-engine 절이 아예 없고 sp-develop 도 모른다
- **가드 등록 누락 자체가 드리프트 (2026-09-19 스캔)** in [gnuboard-integration](../topics/gnuboard-integration.md): 코어 최소 수정 **7파일** vs `check-core-patches.sh` **5 assert** — `mobile/shop/orderform.sub.php`·`shop/ordermail1.inc.php` 가 빠져 있다. pull 한 번이면 모바일 주문서·주문 메일이 조용히 순정으로 돌아간다([core-nonmodification](core-nonmodification.md)·[exception-ledger](exception-ledger.md))
- **캐시·빌드 두 벌 (2026-08~09)** in [theme-sp-lite](../topics/theme-sp-lite.md): CSS/JS 를 고친 뒤 `extend/version.extend.php` 의 `G5_CSS_VER`(26091804)·`G5_JS_VER`(26091801) **둘 다** 올려야 한다(안 올리면 "적용 안 됨") · `css/home/` 부분 파일이 있으면 병합본 `home.css` 는 **무시되므로** 작업 뒤 병합·삭제를 잊으면 두 벌이 갈린다 · `spcb/previews/` 의 `motion-path.js` ↔ 테마 스냅샷 복사본 · `latest()` 1시간 캐시
- **시크릿·주소 (2026-07~08, 부하 증가)** in [spcb-bridge](../topics/spcb-bridge.md) / [infrastructure](../topics/infrastructure.md): `JWT_SECRET`(sp-node `.env`) ↔ `SPCB_JWT_SECRET`(`spcb/lib/secret.php`) **한 대칭키가 이제 4용도** — 회원 JWT 10분·서비스 JWT·브리지 회원 JWT 2분·주문서 썸네일 서명 15분. 불일치면 인증·알림·첨부가 동시에 죽는다. 주소도 방향별로 갈린다 — PHP→Node 는 상수 `SPCB_NODE_BASE`(`define`, 127.0.0.1:3333), Node→PHP 는 env `SPCB_BRIDGE_URL`(기본 8888), Node→엔진은 `BOM_ENGINE_URL`(8400, 8100→8400 변경 이력 1회). 포트가 바뀌면 각각 따로 논다
- **해소 사례 ① 라이브 fetch (2026-08-07)** in [sp-node-api](../topics/sp-node-api.md): 가격표 스냅샷 드리프트(관리자가 수시 조정하는 라이브 `pricing_data.json` 과 번들 스냅샷이 최대 10% 어긋남)를 **계산 직전 fetch**(60초 재사용·실패 시 폴백 사다리, `priceVersion='live-<날짜>'`)로 바꿔 동기화 지점 자체를 없앴다. 결정론이 필요한 골든 테스트만 번들 스냅샷을 계속 쓴다
- **해소 사례 ② SSOT 상수·서버 계산 (2026-07~08)** in [sp-node-api](../topics/sp-node-api.md) / [api-contract](../topics/api-contract.md): 상태 리터럴 6곳 복제 → `ACTIVE_ORDER_STATUSES` 상수 하나 · 프런트 중복 계산 → 서버가 boolean·완성된 라벨 문자열을 내려준다(알림 게이트·`CustomerOrderProgressItem.label`) · 복제된 판정 5곳 → 계약 순수 함수 하나(`isPcbEqRejectionEvent`, [judgment-single-owner](judgment-single-owner.md)) · bom-pricing·spec-units 는 `@sp/utils` 공유 함수 + 골든 74케이스
- **상시 리스크(이전 컴파일분 유지)** in [docs-knowledge](../topics/docs-knowledge.md): 알림 게이트의 코어 내부 불일치(노출 조건 `cf_sms_use` truthy vs 실발송 `==='icode'`)는 sp-vue 가 실발송 쪽에 맞춰 교정 · `differentDesign` 키 누락이 조용히 "0원 → rfq" 를 만든 사고는 계약 통일로 해소 · SMARTBOM 문서에 **§6.35·§6.36 이 두 번씩** 있어 절 번호만으로 링크하면 어긋난다

## What This Means
동기화 지점을 **없애는 게 최선**이다 — 라이브 fetch·SSOT 상수·서버가 완성해 내려주는 라벨/boolean·계약 순수 함수가 이 리포가 실제로 써 온 네 가지 제거 수단이다. 없앨 수 없으면 ① 정본이 어디인지 주석으로 명시하고(방향까지 — `ORDER_STATUS_CUSTOMER_LABELS` 는 PHP 가 정본이다) ② 검증을 자동화하며(패리티 테스트·골든·가드 스크립트) ③ 여기에 등록한다.

**새 기능 리뷰의 표준 질문 5개**: 이 값이 다른 곳에도 있나? / 어느 쪽이 정본인가? / 두 곳이 갈리면 어떤 증상으로 보이나(조용한 오표시인가, 500 인가)? / 운영에 수동으로 해야 하는 일이 생겼나(DDL·시크릿·nginx·시드)? / 문서·README·가드에 등록했나?

우선순위는 분명하다 — **런북 값 불일치(`SPCB_BRIDGE_URL`)는 배포 사고로 직결되므로 1순위로 고칠 것**. 그다음이 가드 미등록 2건(코어가 조용히 되돌아간다), 그다음이 문서 드리프트(사람을 틀린 방향으로 보낸다). 캐시 버전·병합 파일 두 벌은 자주 물리지만 증상이 즉시 눈에 보이므로 후순위다.

## Sources
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [infrastructure](../topics/infrastructure.md)
- [parts-engine](../topics/parts-engine.md)
- [testing](../topics/testing.md)
- [sp-develop-web](../topics/sp-develop-web.md)
