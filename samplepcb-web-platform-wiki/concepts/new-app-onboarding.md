---
concept: 신규 앱 온보딩 체크리스트 (New App Onboarding)
last_compiled: 2026-09-19
topics_connected: [infrastructure, sp-develop-web, sp-market-web, sp-node-api, api-contract, gnuboard-integration, shared-packages, testing]
status: active
---

# 신규 앱 온보딩 체크리스트 (New App Onboarding)

## Pattern
새 프런트 앱을 모노레포에 붙이는 순서가 **세 번 반복되며 사실상 체크리스트로 굳었다** — sp-market(2026-07-08) → sp-rnd(2026-07-17) → sp-develop(2026-09-05). 2026-07-20 컴파일이 "3회째에 개념 승격 검토"로 예고했던 항목이고, 세 번째 앱이 두 번째 앱의 **포트·nginx 블록·deploy 케이스를 그대로 회수**해 쓰면서 순서가 확정됐다.

열한 단계다: ① 루트 `AGENTS.md` 에 호칭·예약 경로 등록 ② 포트 배정 + Vite `host:'127.0.0.1'`·`allowedHosts`·`strictPort`·`base` ③ 로컬 nginx upstream+location(keepalive 포함), 운영은 정적 `dist` alias + 무슬래시 301 ④ `main.ts` 부트스트랩 순서(pinia→i18n→vue-query→`bootstrap()`→**그다음** `app.use(router)`) ⑤ 계약 파일 신설 + `apiRoutes` 상수 ⑥ `sp_*` additive 마이그레이션(공유 DB 라 `migrate reset` 금지) ⑦ `deploy.sh` 빌드 함수 + 앱 단독 케이스 + 풀 케이스 편입 ⑧ 앵커 상품 시드 + PHP `it_id` 사전 union ⑨ 관리자 화면은 sp-vue 에 ⑩ API 하네스 run→cleanup ⑪ **스크립트 밖 체크리스트**(AI 유스케이스 켜기·파일서버 serviceType 실측·nginx 보관본 복사).

앱이 늘 때마다 대가도 함께 는다 — 런북·`ops/README` 같은 문서가 뒤처지고([manual-sync-drift](manual-sync-drift.md)), 폐지한 앱의 흔적이 남는다.

## Instances
- **2026-09-16** in [infrastructure](../topics/infrastructure.md) / [sp-develop-web](../topics/sp-develop-web.md): 운영 런북 [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md) 이 09-16 에 갱신됐는데도 nginx 전문·pnpm 필터에 **`/rnd` 가 남고 `/develop` 은 없다**. `ops/README.md` 도 2026-07-20 판이라 `deploy.sh 9` 를 R&D 로 기술한다. 배포 절차의 진실은 `deploy.sh` 헤더와 `ops/nginx-live/` 보관본(gitignore — 클론만으로는 없다)
- **2026-09-11** in [infrastructure](../topics/infrastructure.md): `deploy.sh` 의 DB 단계가 `db:prepare --always-backup --code-ref <배포 전 HEAD>` 로 바뀌며 **마이그레이션 뒤 `develop:seed-anchor` 가 자동**으로 붙었다(케이스 2·5). 새 앱의 앵커 시드는 이 자리에 편입하는 것이 관례 — 반면 `db:seed-initial`(템플릿 상품 5종)은 여전히 수동이라 누락 시 BOM 주문이 `TEMPLATE_ITEM_MISSING` 으로 죽는다
- **2026-09-05** in [sp-develop-web](../topics/sp-develop-web.md) / [infrastructure](../topics/infrastructure.md): sp-develop 이 **폐지된 rnd 의 자리를 회수** — 포트 **5177**, `/develop/` nginx 블록(구 `/rnd` 5177 블록 재활용), `deploy.sh` **9번**. 체크리스트에 "폐지 앱의 자리 회수"가 들어간다. `strictPort: true` 인 이유가 명시적이다: nginx 가 5177 고정 프록시라 **점유 시 조용히 밀리면 `/develop` 이 끊기므로** 기동을 실패시킨다
- **2026-09-05** in [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md): 계약 신설 — `develop.ts`·`develop-areas.ts`·`develop-docs.ts`·`develop-followup.ts` + `apiRoutes` 에 `develop{Requests,MyRequests}`·`adminDevelop{Requests,Quotes,Milestones,Documents,Files,Settings}`. **테이블은 분리**(`sp_market_project` 에 channel 컬럼을 더하는 안을 기각 — 공개 목록 쿼리에서 필터 하나가 빠지면 비공개 의뢰가 마켓에 샌다). 마이그레이션은 수기 additive 6본, `migrate deploy` 전용
- **2026-09-05** in [shared-packages](../topics/shared-packages.md) / [sp-market-web](../topics/sp-market-web.md): 두 번째 앱이 생길 때가 아니라 **세 번째 앱이 생길 때** 공용 UI 패키지 `@sp/ui` 를 마켓에서 **추출**했다(복사 아님 — 복사하면 3앱이 갈린다). 새 앱이 이것을 쓰려면 `style.css` 에 **`@source "../../../packages/ui/src"`** 와 시맨틱 토큰 이름 전부가 있어야 한다. 빠뜨리면 **에러 없이 스타일만 사라진다**
- **2026-09-05** in [gnuboard-integration](../topics/gnuboard-integration.md) / [sp-node-api](../topics/sp-node-api.md): 결제 배관은 마켓 카탈로그 ⑲ 를 그대로 복제 — 앵커 상품 **`sp-develop-svc`**(`it_price 0`·`it_sc_type 1`, 멱등 시드) + g5 접근 카탈로그 **㉑** + PHP `sp_quote_cart.extend.php` 의 `sp_develop_it_ids()` 를 앵커 **4계열 union** 에 추가(주문서·주문메일이 자동으로 커스텀 행을 그린다). ⚠ 이 사전은 `TEMPLATE_ITEMS`·`MARKET_ANCHOR_IT_ID` 와 **사람이 맞추는 동기화 지점**이다
- **2026-09-05** in [testing](../topics/testing.md) / [sp-develop-web](../topics/sp-develop-web.md): API 하네스 `e2e-develop.mts` 가 마켓 하네스 관례를 **복제** — `develop.*` 유스케이스 4종을 시작 시 `enabled=0` 으로 내리고 끝에 원복(실 LLM 0), 결제는 prisma raw 로 최소 시뮬, 생성 id 를 `tmpdir()` 에 적고 `cleanup` 이 전수 회수, 카트 버킷은 마켓과 분리. 110 → **191/0**
- **2026-08-28** in [infrastructure](../topics/infrastructure.md) / [sp-market-web](../topics/sp-market-web.md): **sp-rnd 폐지**(`apps/rnd` 삭제, AI 산출물 재구성과 함께). 앱을 지울 때 남는 것은 포트·nginx 블록·deploy 케이스·문서 문구인데, 앞의 셋은 다음 앱이 회수하고 **문서만 남는다**
- **2026-08-16** in [infrastructure](../topics/infrastructure.md): nginx upstream **keepalive 는 선택이 아니다** — Vite dev 는 모듈 하나가 요청 하나라 e2e 연속 주행이면 수만 건이 나가고, `Connection "upgrade"` 고정값이 매번 새 연결을 만들어 Windows 임시 포트(13,977개)가 TIME_WAIT 로 고갈된다(`10048` → 502 → SPA 빈 화면). 새 upstream 을 추가할 때 `map $http_upgrade` + `keepalive` + `proxy_http_version 1.1` 을 같이 넣는다
- **2026-07-17 → 2026-07-08** in [infrastructure](../topics/infrastructure.md) / [sp-market-web](../topics/sp-market-web.md): 절차의 원형 — sp-market 이 "고객 대면 신규 화면은 sp-php" 원칙의 **첫 예외**로 별도 Vue 앱 + `/market` 예약 경로(5176·`strictPort`)를 세웠고, `main.ts` 설치 순서(`bootstrap()` 뒤에 router — 어기면 딥링크가 비로그인으로 첫 렌더)·영카트 앵커 결제·액션 단위 로그인 왕복이 이때 굳었다. 2026-07-17 sp-rnd 가 같은 순서를 두 번째로 밟았다

## What This Means
다음 앱은 이 열한 단계를 그대로 따르되, **빠뜨리면 조용히 깨지는 항목부터** 확인하라 — `strictPort`(없으면 포트가 밀려 라우팅이 끊긴다) · `host:'127.0.0.1'`(기본 localhost 는 Windows 에서 IPv6 만 열려 nginx 502) · `allowedHosts`(없으면 Vite 403) · `@source`(없으면 무색) · 앵커 `it_id` 의 PHP union(없으면 주문서가 커스텀 행을 못 그린다) · `deploy.sh` 풀 케이스 편입(없으면 다른 사람의 배포에서 이 앱만 옛 번들로 남는다).

**이미 있는 것은 복사하지 말고 공유하라** — 렌더러는 `@sp/ui` 로 추출하고, 서버 러너는 타깃 어댑터로 일반화하고(`DevReviewTarget {market|develop}`), 계약 레지스트리는 팩토리로 나눈다([judgment-single-owner](judgment-single-owner.md)). 반대로 **테이블·어휘·위저드는 나눈다** — 한 테이블에 channel 컬럼을 더하는 편의가 "필터 하나 빠지면 비공개가 샌다"는 위험과 바꿀 값어치가 없다는 것이 09-05 의 판단이다.

마지막 단계는 코드가 아니다: 운영 nginx 보관본 복사 → `deploy.sh 7`, 관리자 화면에서 AI 유스케이스 켜기(**기동 시 행만 생기고 기본 꺼짐**), 파일서버가 새 `serviceType` 버킷을 받는지 **운영 전 1회 실측**(`market`·`develop` 은 아직 미실측). 그리고 런북·`ops/README` 를 같이 고치지 않으면 다음 사람이 `/rnd` 를 배포한다.

## Sources
- [infrastructure](../topics/infrastructure.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-node-api](../topics/sp-node-api.md)
- [api-contract](../topics/api-contract.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [shared-packages](../topics/shared-packages.md)
- [testing](../topics/testing.md)
