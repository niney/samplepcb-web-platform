---
concept: 관리=sp-vue / 소비=sp-php (공유 DB 브릿지 + 쓰기 브리지)
last_compiled: 2026-09-19
topics_connected: [sp-vue-web, sp-node-api, theme-sp-lite, spcb-bridge, gnuboard-integration, partner-tracks]
status: active
---

# 관리=sp-vue / 소비=sp-php

## Pattern
콘텐츠·설정의 **관리(쓰기) UI 는 sp-vue(`/app/admin`)+sp-node API** 에, **사용자 노출은 sp-php(테마 include 또는 `spcb/pages/`)** 에 두는 역할 분담. 코어·`.htaccess` 무수정 + 테마 include 1지점 + 조회 실패 시 `die` 금지(조용한 폴백)가 반복 요소다.

**2026-08 방향 전환** — 2026-07-13 판은 "PHP→Node HTTP 호출이 없으므로 런타임 결합이 없고, 테이블 스키마가 두 세계의 계약"이라고 단언했다. ⚠ **[2026-08, 대체됨]** 그 서술은 읽기 전용 콘텐츠에만 유효하다. 08월부터 **쓰기·판정이 필요한 고객 화면은 PHP 가 sp-node 를 서버사이드로 호출**한다(extend 훅 6종 + `spcb/api/` 쓰기 브리지 4종, 2분 회원 JWT 로 `127.0.0.1:3333` 직결 curl). 즉 축이 둘로 갈렸다:

- **읽기 전용 콘텐츠** = 여전히 공유 DB 직접 SELECT(슬라이드 `g5_shop_banner`·후기 `sp_review`·SEO `sp_seo`·`sp_config.home_slides`) — **테이블 스키마가 계약**이고 런타임 결합이 없다
- **쓰기·판정** = PHP 는 로그인·CSRF 만 보고 sp-node 를 호출하며 **원장은 sp-node 가 쓴다** — "PHP 는 sp_* 에 쓰지 않는다"가 명문 규칙(권한·상태·회차 판정을 두 곳에 복제하면 반드시 어긋난다 → [server-single-truth](server-single-truth.md)·[judgment-single-owner](judgment-single-owner.md))

## Instances
- **2026-09-18** in [theme-sp-lite](../topics/theme-sp-lite.md) / [sp-vue-web](../topics/sp-vue-web.md): **소비가 관리보다 먼저 생긴 변형** — 홈 히어로 템플릿 on/off 는 `sp_config.home_slides`(Node/Prisma 소유 표)를 테마 `inc/main_slider.php` 가 `sql_fetch(…, false)` 로 **읽기만** 하는데 **관리 UI 가 아직 없다**(운영에선 SQL 로 직접 넣어야 한다). 행이 없으면 조용히 기본값 5장. 이미지 슬라이드 쪽은 정상 짝(`/app/admin/slides` ↔ `g5_shop_banner`)
- **2026-08-25** in [spcb-bridge](../topics/spcb-bridge.md) / [sp-vue-web](../topics/sp-vue-web.md) / [partner-tracks](../topics/partner-tracks.md): **주문 진행 표시가 트랙 공용 파생 하나를 양쪽이 소비** — sp-node `/api/order-progress`(PCB 7칸·BOM 6칸)를 PHP 브리지(`sp_pcb_progress[_batch]`, 50건 청크)와 sp-vue 관리자 드로어가 **같이** 읽고, 배지·줄·카드·스텝퍼가 같은 축을 쓴다. od 는 안 건드린다(D6). 라벨은 서버가 완성해 내려주므로 PHP 는 그대로 출력
- **2026-08-25** in [spcb-bridge](../topics/spcb-bridge.md): 계정 진입점 2종(`/shop/eq` 제조 확인·`/shop/as` A/S)이 **서버사이드 브리지 렌더 패턴** — PHP 안에서 `sp_pcb_node_call()` 이 sp-node 를 부르고 PHP 가 그린다(견적관리처럼 브라우저 JS 로 부르지 않는 이유는 "EQ 축이 이미 서버사이드 관례를 쓰고 화면이 한 벌이면 되기 때문"). 목록은 **목록만** — 결정·접수 폼은 복제하지 않고 주문 상세 앵커로 보낸다(폼이 두 곳이면 첨부·기한·수량 검증이 갈린다)
- **2026-08-15~16** in [spcb-bridge](../topics/spcb-bridge.md): **PHP 가 파일까지 중계한다** — `claim-create.php` 가 사진 ≤10장을 `CURLFile` multipart 로 sp-node 에 1회 제출, `eq-file.php`·`coord-file.php` 가 Bearer 를 요구하는 sp-node 파일 라우트를 대신 열어 헤더(UTF-8 한글 파일명 포함)를 승계해 스트림한다. 소유권·공개 여부·단계 판정은 전부 sp-node
- **2026-08-07** in [spcb-bridge](../topics/spcb-bridge.md) / [sp-node-api](../topics/sp-node-api.md): **sp-php 가 처음 쓰기 경로에 들어간 날의 네 규칙** — ① 메일 링크는 GET 으로 **열기만**, 결정은 화면 안 POST(보안 스캐너가 링크를 자동 GET 하므로 GET 으로 상태가 바뀌면 고객이 열어보기도 전에 승인된다 → [get-opens-post-decides](get-opens-post-decides.md)) ② PHP 는 `sp_*` 에 쓰지 않는다 ③ 세션 → 2분 JWT → `127.0.0.1:3333` 직결 ④ 코어 `alert()`·`check_token()` 폐기
- **2026-08-02** in [gnuboard-integration](../topics/gnuboard-integration.md) / [sp-vue-web](../topics/sp-vue-web.md): **노출 판정도 서버 하나** — PHP GNB 의 '파트너 포탈' 링크(`sp_is_approved_partner()`)와 sp-vue 홈 링크가 같은 축(`sp_partner_member` 존재 ∧ 조직 `approved`)을 쓴다. sp-node 는 `GET /api/partner/access` 로, PHP 는 같은 기준을 미러로. 테이블 부재 초기 설치는 SQL 오류를 화면에 내지 않고 **비파트너로 폴백**
- **2026-07-10~12 (유지)** in [sp-vue-web](../topics/sp-vue-web.md) / [theme-sp-lite](../topics/theme-sp-lite.md): **SEO** — `sp_seo` 를 AdminSeo 가 upsert/DELETE, 테마 `inc/seo_head.php` 가 전역변수 매칭으로 소비(옵션 B, `$it` 자동유도 기본·레코드는 오버라이드). spcb 페이지는 슬러그가 아니라 **파일명**(`about.php`)이 매칭 키
- **2026-07-09~10 (유지)** in [sp-node-api](../topics/sp-node-api.md) / [spcb-bridge](../topics/spcb-bridge.md): **별점 후기** — `sp_review` 를 sp-node 가 관리, `spcb/pages/reviews.php` 가 `isConfirm=1` 게이트·실명 마스킹으로 read-only 소비(표준 `itemuselist.php` 는 INNER JOIN 구조상 표시 불가였다)
- **2026-07-09 (유지, 패턴 원형)** in [sp-vue-web](../topics/sp-vue-web.md) / [theme-sp-lite](../topics/theme-sp-lite.md): **메인 슬라이드** — `g5_shop_banner('메인')` 을 AdminSlides(multipart CRUD+정렬)가 관리하고 테마가 직접 쿼리+렌더. 영카트 배너관리와 **같은 테이블을 공유**한다

## What This Means
"PHP 화면에 새 기능을 띄워야 한다"는 요구가 오면 먼저 **읽기냐 쓰기냐**를 가른다.

- **읽기 전용 콘텐츠**면 예전 답 그대로: 관리 화면은 sp-vue 에, 노출은 테마 include 한 지점에 read-only SELECT. 대가는 스키마 드리프트 — 테이블 구조를 바꾸면 소비측 PHP 쿼리를 손으로 따라 고쳐야 하고, 이는 [manual-sync-drift](manual-sync-drift.md) 의 동기화 지점이다.
- **쓰기·판정**이면 PHP 로 로직을 내리지 말고 **extend 브리지 훅 + sp-node 호출**을 쓴다. 판정이 두 곳에 복제되는 순간(상태 문자열·권한·회차) 어긋나는 것은 시간문제다. 배지 **건수 세기만** 예외적으로 DB 직접 count 인데, 사이드바가 모든 계정 페이지에서 렌더돼 API 를 태우면 그 전부에 HTTP 왕복이 붙기 때문이다 — 그 대신 상태 문자열이 PHP 에 복제된다는 비용을 안다.

두 축에 공통인 것이 **소비측 fail-soft** 다: 브리지 실패(5초 타임아웃 → `null`)·`secret.php` 미배치(토큰 `''` → 호출 자체 생략)·`sql_query($sql, false)`·테이블 부재 — 어느 경우에도 **섹션만 사라지고 페이지는 산다**. 관리측·API 장애가 고객 주문내역을 죽이면 안 된다는 것이 이 개념의 마지막 규칙이고, 그래서 "EQ·A/S·진행 섹션이 비어 보인다"는 sp-node 다운·시크릿 불일치를 먼저 의심해야 하는 증상이다. 예외는 `me.php`·`order-notify.php` 로, 이 둘만 `include_once` 직행이라 시크릿이 없으면 Fatal 이다.

## Sources
- [sp-vue-web](../topics/sp-vue-web.md)
- [sp-node-api](../topics/sp-node-api.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [partner-tracks](../topics/partner-tracks.md)
