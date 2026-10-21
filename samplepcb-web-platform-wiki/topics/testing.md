---
topic: testing
last_compiled: 2026-10-12
sources_count: 81
status: active
---

# testing

## Purpose [coverage: high — 16 sources]

플랫폼 전 계층의 검증 체계 — 소스 날짜 범위 2026-07-03(가격 엔진 레거시 패리티 골든) ~ 2026-10-11(PCB EQ 문항형 D20 주행·`journey-ship-confirm`). 중심은 **모노레포 E2E 하네스** `samplepcb-web-mono-app/e2e/`(2026-08-10 편입, vitest + playwright-core, 시스템 Chrome/Edge)다: sp-vue 가 마운트 전 `/spcb/api/me` 로 PHPSESSID→JWT 교환을 하는 구조를 Playwright 라우트 스텁으로 가로채 **비밀번호·PHP 세션 없이** 임의 계정(관리자·협력사·고객)으로 실 Vue + 실 Node API 풀스택을 돌린다. 스펙 145개(`test`/`it` 937개 — 2026-09-19 컴파일 때 117·727)가 파일명 접두로 트랙을 나눈다 — PCB·횡단 여정 `journey-*` 62, BOM 여정 `journey-bom-*` 30, 마스터딜러 `md-*` 8, PCB 회귀 `pcb-*` 9, BOM 회귀 `bom-*` 7, 협력사 부품 `partner-parts*` 4(+여정 3), 데모 무대 `demo-*` 7, 관측 `status-matrix*` 2, 개발의뢰 `develop-*` 2, 그 외 11. 그 바깥에 네 계층이 더 있다: ① apps/api·packages/utils 단위 vitest(테스트 파일 140+11, 2026-09-11 기록 api 1031·utils 186 → 2026-10-11 기록 api 1412) ② `PARTS_IT=1` 류 옵트인 통합 테스트(실 DB·ES·격리 MariaDB) ③ 리포 루트 API 하네스 `ops/scripts/e2e-market.mts`(148/0)·`e2e-develop.mts`(191/0) ④ Python 엔진 pytest(29 파일, [parts-engine](parts-engine.md)). 여기에 코어 비수정 가드 `check-core-patches.sh`, 관리자 리뉴얼 일관성 가드 `pnpm lint:next`(2026-10-06, [sp-vue-web](sp-vue-web.md)), 헤드리스 도구 `shot.mjs`(피그마 대조)·`hero-perf.mjs`(히어로 성능·강등, 2026-09-21), 모델 프로빙 하네스 `probe-eq-parse.ts`(합성 코퍼스 + 결정적 채점, 2026-10-11)가 붙는다. 검증 철학은 여정(journey) 편에서 확립됐다 — **주행 → 화면 관찰(스크린샷·innerText) → 원인이 특정된 것만 엄선 → 수정 → 어서션을 뒤집어 회귀선으로 승격**(2026-08-10~11, PCB 여정 1~44호에서 확정 결함 60건+ 종결, [partner-tracks](partner-tracks.md)). 2026-09-30~10-11 에는 같은 루프가 BOM 부품 확인(22~24호)·견적 취소(25호)·외화/마스터딜러 중개·PCB EQ 문항형(D20)·관리자 리뉴얼 컷오버로 넓어졌다.

## Architecture [coverage: high — 30 sources]

**다섯 계층 + 프로빙·가드** — 전부 그누보드와 동거하는 공유 DB `samplepcb` 위에서 돈다(`prisma migrate reset` 절대 금지):

```
단위       apps/api/src/**/*.test.ts(140) · packages/utils/src/*.test.ts(11)     pnpm --filter api test · turbo test
통합       *.int.test.ts / *.integration.test.ts — describe.skipIf(!RUN)         PARTS_IT=1 · DB_SNAPSHOT_INTEGRATION=1 · MIGRATION_RESET_INTEGRATION=1
E2E        samplepcb-web-mono-app/e2e/specs/*.e2e.test.ts(145)                   PORTAL_E2E=1 (+JOURNEY=1) · /spcb/api/me 스텁 로그인
API 하네스  ops/scripts/e2e-market.mts · e2e-develop.mts                          run → cleanup (tsx, apps/api .env 차용)
엔진       samplepcb-parts-engine {app,packages/*}/tests (pytest 29 파일)          uv run pytest (testpaths 3곳)
프로빙     apps/api/src/scripts/probe-eq-parse.ts (+ gen-pcb-eq-fixtures.ts)      실 LLM · 정답(gold) 대비 결정적 채점 · 산출물 .tmp/eq-probe/
가드       ops/scripts/check-core-patches.sh (코어 최소 수정 5 assert)             git subtree pull 직후
           apps/web `pnpm lint:next` (@shadcn/lint 0.2.0 → scripts/next-ui-audit.mjs)  src/next/** 를 고친 뒤
```

- **E2E 러너 골격**(`vitest.config.ts`): `include: specs/**/*.e2e.test.ts`, **`fileParallelism: false`**(공유 DB 시드·정리 교차 방지 — 파일 안 test 도 정의 순서), `testTimeout 60s`·`hookTimeout 120s`. 게이트 `RUN = PORTAL_E2E==='1'` 을 모든 스펙이 `describe.skipIf(!RUN)` 로 감싸 `turbo test`/CI 에선 전부 skip(apps/api 의 `PARTS_IT` 관례 미러). 완주 여정은 2중 게이트(`PORTAL_E2E=1 && JOURNEY=1`).
- **로그인 3방식**: ① `newSession(identity)` — `context.route('**/spcb/api/me')` 가 `signJwt(identity)`(me.php 동형 클레임 HS256, `apps/api/.env` 의 `JWT_SECRET` 로컬 서명, TTL 30분 — me.php 는 10분)를 `{token, member}` 로 응답. 관리자는 `isAdmin:true`(level 10), 영카트 버킷 검증은 `cartId` 클레임, 진입 리졸버는 `localStorage sp.partnerModule` 프리셋 ② `newPhpSession(creds)` — 그누보드 `/bbs/login.php` 실로그인(진짜 PHPSESSID, `/bbs`·`/shop` 주문서·거버 제출용, 자격은 gitignore `e2e/.env.e2e`) ③ 익명 `newSession(null)`(requiresMember 가드의 로그인 왕복 검증).
- **브라우저**: playwright-core 가 시스템 `chrome` → `msedge` channel 순으로 시도(다운로드 0). 컨텍스트 1440×900·ko-KR·`ignoreHTTPSErrors`(mkcert). Node 측 fetch 는 스크립트에 박힌 `NODE_OPTIONS=--use-system-ca`(`bom:verify` 관례).
- **시드 원칙 = 자족 시드 → 검증 → 무잔재 정리**: 만든 id 를 레지스트리에 등록하고 afterAll 이 일괄 정리 + 잔재 카운트 0 을 어서션. g5 테이블은 Prisma 스키마 밖이라 raw SQL(`g5.ts`), 회원·주문 픽스처는 **기존 행 복제**(컬럼 목록을 INFORMATION_SCHEMA 에서 읽어 코어가 컬럼을 늘려도 따라감 — `cloneG5Member`·`createG5OrderFixture`).
- **여정 공용부** `journey.ts`: `createJourneyReport()` 가 `F(step, kind, note)`(kind = bug·ux·obs·blocker)·`ledger`(생성물 대장)·`watchHttp`(≥400 수집)·`view`(관찰용 재로드+캡처 — API 전이는 열어 둔 페이지를 안 바꾸므로 재로드 없으면 스크린샷이 첫 단계에 멈춤)·`assertView`(이동·필수 문구·캡처 중 하나라도 실패하면 테스트를 세움)·`write`(→ `output/journey/<file>.md`) 를 준다. 고객 손놀림(`submitGerberRfq`·`placeOrderFromQuotes`·`placeOrderFromBomQuote`)을 공유해 "한쪽만 고쳐지고 다른 쪽은 묵는" 분기를 막는다 — 10호의 한 주문서 여러 줄도 새 함수가 아니라 `placeOrderFromQuotes({ alsoSpecIds })`. 2026-10 추가: `completeBankTransferOrder` 공개(주문서 진입 뒤의 공통 무통장 조작 — BOM 22·23호가 재사용) · `write()` 가 `sweepEqAiJobs` 를 걸어 대장에 적힌 **자기 발주서 id 로만** EQ AI 잡을 거둔다(리포트 쓰기가 동기라 `trackCleanup` 에 걸어 두고 `disconnectPrisma` 가 기다린 뒤 닫는다).
- **스펙 계보**: `journey-*` PCB·횡단 여정 1~44호(1~12호 흐름, 13~22호 경계·시간·경합·권한, 23~32호 read-only 횡단면, 33호 미결 판단 구현, 34~43호 "발이 빠지는 자리", 44호 마이페이지 A/S) + 2026-10 무번호 주제편 14본(EQ 문항형 D20 `journey-eq-items*` 6·추가 EQ 요청 `journey-eq-reopen*` 3·MD `journey-md-children`/`-designate`/`-rfq-portal`·`journey-caseref-admin`·`journey-ship-confirm`) · `journey-bom-*` BOM 1~25호(22~24호 결제 후 부품 확인 D43·D44, 25호 견적 취소·보존 기간 자동 정리)+외화·마스터딜러 4편(`-partner-fx`·`-md-rfq`·`-md-po`·`-md-detail`)+입고 주문 · `md-*` MD 1~5편+관전(`md-eq-observe`)·선적 구간(`md-ship-legs`) · `pcb-*` 회귀(확정 409 가드 10종·QR·운송수단·Case ID·직접 발송 게이트·클레임·발주 선정 안내) · `bom-*` D41 Mouser 카트·D42 입고 스캔·Case ID·단일검색·RFQ 미회신 요청 행 추가(`bom-rfq-scope-add`) · `rework-probe` 재작업 가드 W2~W9 "잠김→정리→열림" 순환 · `harness` 자가 검증(새 스펙의 복사 시작점) · `prompt-modal` 네이티브 대화상자 대체 확인 · `admin-develop-journey` 관리자 「개발」 화면 접수→완료 · `php-bridge-escape` sp-php 브리지 4종의 원문 보존([spcb-bridge](spcb-bridge.md)).
- **한 기능 = API 박제 한 본 + 화면 소유자별 주행**(2026-10-11, D20): `journey-eq-items`(API 왕복·경계 — 초안은 고객에게 없다·낙관적 잠금 409 `VERSION_CONFLICT`·공급망 미노출·회신 검증·전달 전 협력사 비노출·개정 연결·대리 회신·EQ 전이가 열린 초안을 닫음)가 규칙을 박제하고, 화면은 `-admin`(sp-vue 작업공간)·`-customer`(sp-php 테마 + POST+CSRF 브리지)·`-portal`(공장이 읽는 화면·MD 관전)이 따로 본다. 화면 스펙의 공통 표적 = 390px 가로 넘침 0 · en/zh-CN 한글 잔류 없음(데이터 원문 제외) · 어휘·공급망 미노출. 포털 스펙은 web 의 `translatePartnerMessage`·locale 사전과 계약 사전(`PCB_EQ_ITEM_CATEGORY_LABELS_BY_LOCALE`·`pcbMdQuoteAmount`)을 **직접 import** 해 화면·내려받은 파일·미리보기가 서버와 같은 말을 하는지 대조한다. AI 구간(`-ai`·`-ai-admin`)은 LLM 없이 도는 장면(유스케이스 꺼짐·엑셀 아닌 EQ → 잡 failed·수동 분석 가드·완료 잡 행 직삽입으로 서버가 만든 주의 문구 확인)을 기본으로 하고 실 LLM 은 `EQ_AI_E2E=1` 옵트인.
- **옛·새 화면 양쪽 주행**(2026-10-07): `admin-develop-journey` 한 스펙을 `DEVELOP_ADMIN_UI=old|next` 로 두 번 — 옛 화면 green = 시나리오가 맞음, 새 화면 green = 동작이 같음(둘 다 9/9). 선택자는 role·이름(문구) 중심이고 구조 차이(탭 버튼↔`role=tab`·네이티브 체크박스↔`role=checkbox`·인라인 확인↔포털 대화상자·사이드바 마크업·select↔combobox·checkbox↔`role=switch`)는 `helpers/develop-admin.ts` 어댑터가 가린다. 고객 행동은 API, 의뢰는 e2e 전용 계정이 `aiConsent=false` 로 만들고 지운다. 컷오버(2026-10-10) 뒤 `old` 는 `/app/admin/legacy/develop` 을 본다.
- **칸별 흐름 도구** `helpers/bom-md-flow.ts`(2026-10-09): BOM 외화 회신 + 마스터딜러 중개의 견적요청 발송→송금 완료 열세 칸을 `BomMdCase.advanceTo(n)` 으로 한 칸씩 끊어 실행하고, 칸마다 스스로 `expect` 한 뒤 나온 값을 facts 로 돌려준다. 상세 여정(`journey-bom-md-detail` — 필요한 칸까지 올린 뒤 경계를 찌름, 16케이스)과 흔적 주행(`demo-bom-md-trail-keep` — 칸마다 Case 를 하나씩 13개 멈춰 남김)이 공유한다.
- **관측 러너 vs 회귀 스펙**: `status-matrix`(2026-08-25)는 어서션을 "조작 API 가 200 인가"만 두고 `output/status-matrix.md` 표(관리자 조작 → DB od_status → 관리자 배지·탭 → 고객 배지·class·제작 카드·스텝퍼)가 산출물이다. `partner-parts-observe`·`md-eq-observe`·`output/obs-*.mts`·`tools/dev-review-v2-walk.ts`(자동 판정 없음)도 같은 계열 — 플레이북의 "실브라우저 사각"(DOM 검증으로 못 잡는 인쇄 드로어 겹침)을 사람 육안 1회로 메운다.
- **API 하네스**(리포 루트): 브라우저 없이 Fastify 를 직접 치는 단일 `.mts` — 실존 회원 JWT 를 `JWT_SECRET` 로 직접 서명(의뢰인엔 `cartId` 클레임), 결제는 코어 `orderformupdate` 를 prisma raw 로 최소 시뮬, 시작 시 `sp_ai_usecase` 를 `enabled=0` 으로 내려 **실 LLM 호출 0**, 생성 id 를 `tmpdir()/sp-*-e2e-ids.json` 에 적고 `cleanup` 이 전수 회수. 마켓(2026-07-08, 33→89→148항목, [sp-market-web](sp-market-web.md))이 원형이고 개발의뢰(2026-09-05, 110→191, [sp-develop-web](sp-develop-web.md))가 관례를 복제했다. Mailpit 미가동이면 메일 항목만 SKIP.
- **엔진 pytest**: `pyproject.toml` `testpaths` 3곳(bom-extraction-engine·supplier-search-engine·app), `pytest-asyncio`. 이식 시점 패리티 171 → 최근 537 passed. 2026-09-30 `test_procurement.py` +3 — 양산 모드에서 가격·기술 대체로 그룹이 이미 바뀐 뒤의 Reel 선택은 교체 사유를 하나만 유지한다(사유 2개가 `ValidationError` 를 내던 결함의 회귀선).
- **모델 프로빙 하네스**(2026-10-11, `apps/api/src/scripts/probe-eq-parse.ts`): 출하 코드(추출기·직렬화기·템플릿 파서·`chatWithOptionFallback`·`extractJsonObject`)를 그대로 실행해 정답 대비 **결정적으로** 채점한다(`lib/pcb-eq-extract/probe-score.ts` — 계약 통과·문항 짝짓기·선택지 기호·그림 연결·지어내기 검사·용어집, 종합 0~100). DB 는 쓰지 않는다. 코퍼스는 생성기 `gen-pcb-eq-fixtures.ts` 가 **사양 하나에서 파일과 정답(gold)을 함께** 만든 합성 14개 + 실샘플 1개(문항 95개). 같은 픽스처를 단위 테스트 5본(`pcb-eq-extract/*.test.ts`)이 읽어 템플릿 파서의 a~j 구조를 고정하고(홀드아웃 k~n 은 throw 만 안 하면 된다), e2e 옵트인 장면이 승인요청 첨부로 다시 쓴다([golden-as-spec](../concepts/golden-as-spec.md)).
- **리뉴얼 일관성 가드**(2026-10-06, apps/web): `@shadcn/lint` 0.2.0 은 `src/next/**` 에만 `error`(`no-restyle`·`no-raw-colors`·`no-arbitrary-values`·`no-inline-styles`·`require-static-classes`)로 토큰 사용과 shadcn 컴포넌트 restyle 만 본다 → 일반 div 로 알림 상자·섹션 상자를 화면마다 새로 짓는 반복(실측 123건)은 `scripts/next-ui-audit.mjs`(alert·tint·box·max-h·raw-control·heading 6규칙, 1초, 예외는 `ui-audit-allow: 사유` 주석)가 잡는다. `pnpm lint:next` 가 둘을 잇는다([sp-vue-web](sp-vue-web.md)).

## Talks To [coverage: high — 15 sources]

| 검증 주체 | 상대 | 방식 |
|---|---|---|
| e2e 브라우저 | `E2E_BASE_URL` 기본 `https://local-web.samplepcb.co.kr` | nginx 통합 도메인(실환경 동형 `/app`→vite·`/api`→node·`/`→PHP). `http://127.0.0.1:5173` 우회 시 `/bbs` 검증 불가([infrastructure](infrastructure.md)) |
| e2e `api()` | `E2E_API_URL` `http://127.0.0.1:3333` | Fastify 직결. body 없으면 content-type 미부착(붙이면 `FST_ERR_CTP_EMPTY_JSON_BODY`) |
| e2e `getPrisma()` | 공유 DB(`apps/api/.env` `DATABASE_URL`) | apps/api 에 생성된 Prisma Client 를 `createRequire` 로 빌림(스키마·버전 단일화), g5_* 는 raw SQL |
| e2e 메일 검증 | Mailpit REST `E2E_MAILPIT_URL` `:8025` | 목록·검색·본문(매직링크 추출)·선택 삭제만 — 전체 삭제 의도적 미제공 |
| PCB 여정 1~4호·데모 | `E2E_GERBER_URL` `https://local-gerber.samplepcb.co.kr`(vite 8040) | 거버 뷰어 업로드 → [견적요청] → `sp_order_spec` 도착이 앵커 |
| BOM 여정 1~3·14·21호 | `E2E_BOM_ENGINE_URL` `:8400` | sp-engine 사전 점검·엔진 잡 회수. 4~13호는 회신 완료 스냅샷부터 시작해 엔진 불필요 |
| `partner-catalog.ts` 정리 | ES `ES_NODE_URL` `:9200` `sp-parts` | 스펙이 만든 색인 문서 `_delete_by_query`(안 지우면 다음 검색 스펙이 유령을 봄) |
| `bom-mouser-cart-handoff`(MOUSER_E2E=1) | **실 Mouser Cart API** | SamplePCB 계정에 e2e 카트 1개 생성·비움 |
| `dev-diagram-probe`(DIAGRAM_PROBE=1) | ollama `AI_BASE_URL`/`AI_API_KEY` | 운영 코드(`lib/ai/dev-diagram`) 그대로 실 LLM 프로빙 |
| `journey-eq-items-ai*`·`journey-eq-reopen`(EQ_AI_E2E=1) | 유스케이스 `pcb.eq-parse`(전역 설정 `pcbEqParse.enabled`) → 실 LLM | 분석 한 번에 10~40초. 설정을 켰다 원래 값으로 되돌린다 — 옵트인을 꺼도 로컬에서 켜져 있으면 승인요청마다 잡이 선다 |
| `probe-eq-parse.ts` | `AI_BASE_URL=https://ollama.com` 직결(운영과 같은 경로) | 실행 직전 `GET /api/tags` 로 모델 확인, 동시 3~10, 호출당 타임아웃 600초, temperature 0 |
| `php-bridge-escape`·`journey-eq-items-customer` | 실 PHP(8888) 브리지 `spcb/api/*.php` → sp-node | `newPhpSession` 실로그인 + 폼 필드 그대로 POST(CSRF) — 저장값 === 입력을 sp_ 원장에서 대조 |
| EQ 문항 그림·EQ 첨부 | 파일서버 `FILE_SERVER_URL` | `journey-eq-items*` 의 그림 업로드·공개/비공개 404 검증 |
| `hero-perf.mjs` | 홈 `https://local-web.samplepcb.co.kr/` + CDP CPU 스로틀 | e2e 의 playwright-core 차용(`shot.mjs` 와 같은 방식), 배너 5장 rAF 프레임 간격·longtask |
| API 하네스 | sp-node 3333 + Mailpit + 파일서버 `FILE_SERVER_URL` | `pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-*.mts run` |
| `check-core-patches.sh` | `samplepcb-web/` subtree 5파일 | `grep -qF` 고정 문자열 존재 검사([gnuboard-integration](gnuboard-integration.md)) |

## API Surface [coverage: high — 16 sources]

**실행 명령**(`e2e/package.json` — 전부 `cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run …`):
- `pnpm -F e2e e2e`(전체) · `e2e:headed` · `e2e <파일명필터>` · `pnpm -F e2e test`(게이트 없음 → 전부 skip) · `typecheck`.
- 여정: `journey`(journey-* 전부, `--no-file-parallelism`) · `journey:intl|domestic|batch|md|as|as2|money|multi|cancel|combo|proxy|suspend|overdue|rewind|concurrency|legacy|customer|bulk|currency|mdmulti|files|counts|search|authz|stock|delete|maillog|asrounds|remitmulti|notify|screens|decisions|orphan|empty|input|precision|narrow|recipient|revive|moneyrace|myturn|customerview|asmypage|direct|eq|children|mddesignate` · `journey:bom`(1~25호 + 외화·MD 4편 = 29파일 직렬 명시 목록, `:headed`) · `journey:bom:N`(N=1~25, +`:headed`) · `journey:bom:fx|md|mdpo|detail`(+`:headed`) · `journey:bom:receiving`.
- 기타: `md`·`md:domestic`·`md:cn`·`md:direct` · `probe`(rework-probe) · `pcb:qr`·`pcb:invoice` · `e2e:mouser`(+`:headed`) · `e2e:receiving`(+`:seed`=RECEIVING_E2E_SEED_ONLY 발주 상태만 남김, `:keep`=RECEIVING_E2E_KEEP) · `e2e:status-matrix`·`e2e:status-matrix-bom` · 남김 주행 `demo:bom-confirm`·`demo:bom-confirm-types`·`demo:bom-md-trail`(전부 `DEMO_KEEP=1`).
- 스크립트 없는 2026-10 스펙은 파일명 필터로: `pnpm -F e2e e2e journey-eq-items`(이름이 겹쳐 `-admin`·`-customer`·`-portal`·`-ai`·`-ai-admin` 이 함께 돈다 — 한 본만이면 `specs/<파일>.e2e.test.ts`) · `journey-eq-reopen` · `journey-md-rfq-portal` · `journey-caseref-admin` · `journey-ship-confirm` · `php-bridge-escape` · `bom-rfq-scope-add` · `[DEVELOP_ADMIN_UI=next] … admin-develop-journey`. 실 LLM 까지는 앞에 `EQ_AI_E2E=1`.
- 단위/통합: `pnpm --filter api test` · `pnpm --filter @sp/utils test` · `PARTS_IT=1 pnpm exec vitest run parts-ingest.int|admin-parts.search.int`(apps/api 에서, `DATABASE_URL` 를 셸에 export) · `pnpm -r typecheck`/`lint`(turbo 가 Windows 에서 깨져 `pnpm -r` 우회).
- 하네스·도구: `… e2e-market.mts run|cleanup` · `… e2e-develop.mts run|cleanup` · `uv run pytest` · `bash ops/scripts/check-core-patches.sh` · `node ops/scripts/shot.mjs <url> <out.png> [--width --height --full --selector --wait --scroll --scale --mobile --hover --click]` · `node e2e/tools/verify-gerber-fixtures.mjs [필터]`(거버 8040+nginx, 제출 없음) · `pnpm exec tsx tools/dev-review-v2-walk.ts`(`WALK_SCENARIO`·`WALK_KEEP`) · `node ops/scripts/hero-perf.mjs perf [--url --widths=1920,2560 --cpu=4 --dpr=1]`(배너별 rAF 평균·최대·50ms 초과·longtask) / `verify`(라이트 모드 강등·`will-change`·cpu×20 에서 `.is-lite` 판정 시간·리사이즈 중 translateX 점프·이음새 픽셀).
- 리뉴얼 가드(apps/web): `pnpm lint:next`(eslint `src/next` 수 분 → audit) · `node scripts/next-ui-audit.mjs`(점검만 1초) · `npx eslint src/next/<경로>`(고친 파일만).
- 프로빙(apps/api): `node --env-file=.env --import tsx src/scripts/probe-eq-parse.ts --models=kimi-k3@low,… --files=all|a,b,…|real --runs=N --think=default,low --mode=llm|combo|template --prompt=v1|v2|v3 --concurrency=3..10 [--resume=<폴더>] --tag=…` · 코퍼스 재생성 `node --import tsx src/scripts/gen-pcb-eq-fixtures.ts`.

**환경변수**: 게이트 `PORTAL_E2E`·`JOURNEY` · 대상 `E2E_BASE_URL`·`E2E_API_URL`·`E2E_BOM_ENGINE_URL`·`E2E_MAILPIT_URL`·`E2E_GERBER_URL`·`ES_NODE_URL` · `E2E_HEADED` · 실로그인 `E2E_CUSTOMER_ID/PW`(+`E2E_CUSTOMER2_ID`, `.env.e2e`)·데모 고객 `E2E_DEMO_CUSTOMER_ID/PW`(`requireDemoCustomerCreds`) · 화면 선택 `DEVELOP_ADMIN_UI=old|next`(기본 old) · 남김 스위치 `JOURNEY_KEEP`·`DEMO_KEEP`·`DEMO_PARTNER`·`KEEP_QUOTE`·`KEEP_FIXTURE`·`RECEIVING_E2E_KEEP`·`WALK_KEEP` · 실외부 `MOUSER_E2E`·`DIGIKEY_E2E`·`FOLLOWUP_LLM`·`EQ_AI_E2E`·`DIAGRAM_PROBE`(+`DIAGRAM_MODEL/THINK/FIXTURES/TIMEOUT_MS/FORCE`)·`PARTNER_I18N_E2E` · 통합 `PARTS_IT`·`DB_SNAPSHOT_INTEGRATION`·`MIGRATION_RESET_INTEGRATION`. `JWT_SECRET`·`DATABASE_URL`·`MOUSER_ORDER_API_KEY`·`AI_BASE_URL`·`AI_API_KEY` 는 `apps/api/.env` 에서 자동 — `requireXxx()` 가 필요 시점에만 검증하므로 게이트 꺼진 수집 단계에서도 import 안전.

**헬퍼 함수**(`import { … } from '../helpers'`, `index.ts` 재수출): `env.ts` RUN·URL 상수·`requireCustomerCreds(slot)`·`requireJwtSecret`·`requireDatabaseUrl`·`requireMouserOrderKey`·`requireAiConnection` / `jwt.ts` `signJwt({mbId, isAdmin?, level?, cartId?, ttlSec?})` / `browser.ts` `getBrowser`·`closeBrowser`·`newSession(identity, {partnerModule, localStorage})`·`gotoApp`·`snap` / `php-login.ts` `newPhpSession` / `api.ts` `api(token, method, path, body?)` / `db.ts` `getPrisma`·`disconnectPrisma`·`num`(BigInt→number) / `g5.ts` `findLatestOrder`·`countCartRows`·`deleteOrderHard` / `seed.ts` `getPartner(name)`·`pickFreeSpecs(n)`·`ensureSecondCustomer`·`cloneG5Member`·`ensureStagePartner`·`ensureMdRelation`·`createG5OrderFixture`·`createOrderSpec`·`createPcbPo`·`cleanupPcbPos`·`countPcbResidue` / `mailpit.ts` `mailpitList`·`mailpitSearch`·`mailpitMessage`·`mailpitDelete(ids)` / `journey.ts` `resetSupplierSearchQuota`·`createJourneyReport`·`submitGerberRfq`·`placeOrderFromQuotes`·`placeOrderFromBomQuote`·`placeBatchOrderFromBomQuotes`·`completeBankTransferOrder`·`measureQuotesRowWidths`·`measurePoRowPartnerWidths` / `partner-catalog.ts` `cleanupPartnerCatalog(partnerId)`. 2026-10 추가: `env.ts` `requireDemoCustomerCreds` / `db.ts` `trackCleanup(promise)` / `seed.ts` `ensureStagePartner({ …, capabilities? })`(생략 시 `['pcb_rfq']`, BOM 무대는 `['bom_rfq']`) / `bom-md-flow.ts` `ensureBomMdStage`·`BomMdCase`(`advanceTo`)·`BOM_MD_ORGS`·`BOM_MD_CHILDREN`·`FLOW_LINES`·`FLOW_PRICES`·`FLOW_STEP_COUNT`·`round2`·`round4` / `xlsx.ts` `unzipXml`·`xlsxText`·`fetchXlsx`(의존성 없이 내려받은 xlsx 의 글자만 읽는다 — ExcelJS 스트리밍 출력은 로컬 헤더 크기가 0 이라 중앙 디렉터리에서 읽음, 칸 위치·서식은 서버 단위 테스트 몫). `develop-admin.ts` 는 `index.ts` 재수출 밖(`'../helpers/develop-admin'` 직접 import): `DEVELOP_ADMIN_UI`·`developQueuePath`·`developDetailPath`·`customerApi`·`adminApi`·`createDevelopRequestAsCustomer`·`cleanupDevelopUi`·`purgeDevelopUiMail`·어댑터 `queueTab`·`detailTab`·`answerConfirm`·`setCheck`·`chooseOption`·`fillByLabel`·`menuBadge`.

## Data [coverage: high — 17 sources]

- **상설 픽스처(조직)**: 협력1(진행 중 **실데이터** — 읽기만) · 협력2(CN/USD, PCB PO 0건 전제 — 쓰기 시드의 기본 무대) · `마스터딜러상사`(#7 KR/KRW·mdtester) · `mdtester2상사`(#8 CN/USD·다중 상위) · `e2e한국협력`(#9 KR/KRW·**연결 계정 0** = 관리자 대행 전용, 12호 주인공) · `e2e정지협력`(13호). ⚠ `output/cleanup-md.mts` 는 MD 관계를 해제하므로 상설 편에 쓰면 안 된다 — 정리는 `cleanup-probe.mts`(e2e-customer 스펙 축 훑기, 상설 무접촉).
- **2026-10 에 늘어난 전용 무대**(조직은 `ensureStagePartner` 자기창조·하위는 포털 등록 API 로 — 이름에 검사 문구·통화 코드 없음): BOM 외화 `e2e해외부품가`(US/USD)·`e2e해외부품나`(CN/CNY)·`e2e국내부품다`(KR/KRW) · BOM 중개 `e2e부품중개상사`(CN/USD)·제3자 `e2e남의협력사` + 하위 `e2e하위부품가`(CNY)·`e2e하위부품나`(USD, **계정·이메일 없음** = 마스터딜러 대행 경로) · RFQ 행 추가 `e2e범위협력가/나` · 하위 직접 관리 `e2e한빛중개`·`e2e별빛제작`·`e2e은빛기판`(등록한 하위·관계·시드 발주는 주행 앞뒤로 지움) · 선적 완료 `e2e-선적확인`(CN — 보드 건수를 정확히 세려고 다른 주행의 발송과 격리, 기존 발주서가 남아 있으면 시작에서 throw) · 마스터딜러 지정은 상설 없이 `e2e-mdd-` 접두 조직을 만들고 지운다.
- **계정 규칙**: e2e 전용 계정만(`e2e-*` 접두). **데모 고객은 따로**(`E2E_DEMO_CUSTOMER_ID/PW`, 2026-09-30) — BOM 데모 3본(`demo-bom-*-keep`)은 주행이 멈춘 자리에서 사람이 그 계정으로 로그인해 이어 가므로 자동 여정 고객(`e2e-customer`)이 아니라 평소 쓰는 로컬 테스트 계정이어야 한다(값은 코드에 두지 않는다). 관리자 「개발」 주행은 `e2e-develop-admin-ui` 계정의 의뢰를 통째로 지운다(cascade). `ensureStagePartner` 는 1계정=1조직 가드를 지켜 기존 멤버십이 있으면 그 조직을 무대로 재사용하고 없을 때만 조직을 만든다(2026-08-13 복구 DB 에서 실계정 mdtester 가 이미 다른 조직 소속이던 실측 — 직삽입 덧연결 금지). 고객 1번 `e2e-customer`(`.env.e2e`), 2번 `e2e-customer2` 는 1번 **회원 행 복제**라 비밀번호 해시 동일 → 원문이 코드·문서·.env 어디에도 늘지 않고 주문서 자동 채움 조건이 100% 같아 "누구냐"만 다르다.
- **파일 픽스처**(`e2e/fixtures/`): 거버 zip 8종(tracespace 공개 보드, 뷰어 제한 5MB 이내 — `arduino-uno.zip` 만 검증 완료 2026-08-10, 나머지는 `verify-gerber-fixtures.mjs` 판정 후 사용, 사적 보드는 gitignore `fixtures/local/`) · BOM `bom-journey-1-diverse.csv`(정확 MPN·파라메트릭·DNP·수량 0 혼합 — 행 수를 하드코딩하지 않고 엔진이 활성화한 행을 런타임에 읽음)·`bom-journey-3-revision.csv`·`bom-journey-14-multi-sheet.xlsx`·`bom-journey-14-no-bom.xlsx` · 협력사 재고 짝 `partner-stock-eureka-sample.csv`+`bom-partner-stock-match.csv`(품번이 일부러 겹침, `LPC2387FBD100,551` 이 대체 조회 키 검증 — 수량과 Reference 개수가 어긋나면 `included=false` 로 조용히 빠짐).
- **DB 시드 규칙**: 발주서 UK `(specId, partnerId, parentPartnerId, reorderRound)` 충돌 회피는 `pickFreeSpecs()`(2026-08-11 부터 `status='active'` 만 — 삭제·만료 스펙이 섞여 `NOT_ACTIVE` 409 로 20·21호가 연달아 걸렸다). 합성 od_id 는 14자리 9-접두(코어 YmdHis+2 는 16자리라 자릿수로 갈림) 또는 8-접두 16자리 ≤ 2^53(관리자 API 가 Number 로 다뤄 초과분 반올림). 날짜는 KST 앵커 `YYYY-MM-DDT00:00:00+09:00`(UTC 파싱 시 하루 밀림).
- **산출물**(`e2e/output/`, gitignore): 여정 리포트 `journey/findings-*.md` 80편(생성물 대장·발견 사항 `[bug|ux|obs|blocker]`·HTTP ≥400·pageerror 4절) + 스크린샷 932파일(여정별 접두 글자 전용) + 흔적 대장 `journey/trail-bom-md.html`(칸별 한 일·볼 곳 링크·값·스크린샷) · `status-matrix(.md|.json)`·`status-matrix-bom` · 관찰 `obs-*.mts` 15본·정리 `cleanup-*.mts` 5본·점검 `check-*.mts` 14본(전부 `../helpers` 재사용) · `dev-review-v2/`·`dev-diagram/`·`diagram-free/`·`bom-rfq-scope-add/`. EQ 화면 주행(2026-10-11)은 캡처를 리포 루트 `.tmp/eq-{admin,customer,portal}-shots/` 에 둔다(e2e/output 밖, `.tmp/` gitignore). 프로빙 산출물은 `.tmp/eq-probe/<타임스탬프>-<tag>/`(records.jsonl·summary.md·translations.md·raw/·drafts/). API 하네스는 `tmpdir()/sp-market-e2e-ids.json`·`sp-develop-e2e-ids.json`(usecase enabled 원복값 포함).
- **골든**: `packages/utils/src/spec-units.cases.json`(parse 46·variants 11·packages 10 — **요구사항 명세**, 2026-07-21 기록 A 골든 74/74) · `apps/api/src/pricing/__fixtures__/legacy-pricing-goldens.json`(`pnpm pricing:capture` 로 라이브 레거시 API 재생 캡처 → 판매가·제작일·무게·eta 패리티) · 엔진 `contracts/fixtures` · **EQ 합성 코퍼스** `apps/api/src/lib/pcb-eq-extract/__fixtures__/`(2026-10-11, `a-lhd-bilingual`~`n-hard-dense` 14종 `.xlsx/.xls/.zip` + `<id>.gold.json`, 356KB — 공장명·품번은 지어낸 것, k~n 은 템플릿 파서를 고정한 **뒤** 만든 홀드아웃). 실샘플 정답은 고객 품번·공장 정보가 있어 `.tmp/eq-probe/real/` 에만 둔다(커밋 안 함 — 있으면 단위 테스트가 함께 읽는다).
- **생성물 정리 순서**(여정 수동 정리): ① 주문을 `force-status '주문'` 으로 내려 **재고 복원**(26호가 이 관례의 근거를 검증) ② g5 cart+order ③ sp_* 역순(file→shipment_po→shipment→eq_review→po→rfq→file→spec). BOM 1~11호는 원칙적으로 자동 정리 안 함(리포트 대장을 보고 손으로), 12~21호 격리 fixture 는 하네스가 직접 회수, 22~24호·외화·MD 4편은 다시 대장에 남긴다(주문·정산 자동 정리 없음 — Case 는 관리자 Case 삭제로), 25호의 취소 무대는 정리하지 않고 30일 뒤 **제품의 자동 정리가** 지운다. EQ AI 분석 잡(`sp_ai_job`, `useCase='pcb.eq-parse'`)은 발주서에 FK 가 없어(업무 대상 규약 `targetType`·`targetId`) cascade 로 안 지워진다 → `cleanupPcbPos` 가 발주서 삭제 전에, 여정은 `sweepEqAiJobs` 가 거둔다.

## Key Decisions [coverage: high — 27 sources]

- **2026-10-11 — EQ 문항형(D20) 검증 편성**: API 박제 1본(`journey-eq-items` 12) + 화면 소유자별 주행(`-admin` 13·`-customer` 10·`-portal` 6) + AI 2본(`-ai` 8·`-ai-admin` 7) + 추가 EQ 요청 3본(`journey-eq-reopen` 9·`-admin` 8·`-portal` 8). AI 는 **LLM 없이 도는 장면이 기본**이고 실 LLM 은 `EQ_AI_E2E=1` 옵트인, 화면 스펙은 전역 AI 설정을 건드리지 않으려고 EQ 질의서를 `.pdf` 로 올린다(켜져 있어도 모델을 안 부른다). 화면 주행이 API 박제가 못 본 것을 잡았다 — 회차 번호가 발주서별이 아니라 목록 전체로 세어지던 결함(→ `eqRoundNumbers` 단위 회귀), 최신 회차의 결말은 이력이 아니라 발주 상태가 정본(R6)([partner-tracks](partner-tracks.md)).
- **2026-10-11 — `php-bridge-escape`: 고치기 전 실측을 스펙 헤더에 박제(1/6) → 6/6**: 그누보드 `common.php` 가 `$_POST` 전체에 addslashes 를 걸어 브리지 넷 중 셋이 `\'`·`\"`·`\\` 를 sp_ 원장에 저장하고 있었다. 입력 세트(홑·겹따옴표·백슬래시 한 개·`C:\temp\new`·LF/CRLF·한글·이모지)가 곧 명세 — **홑따옴표만 넣어 보면 고객 화면에서는 멀쩡해 보인다**(`get_text` 가 `\'` 만 되돌린다)라 저장값을 원장에서 직접 대조한다([spcb-bridge](spcb-bridge.md)).
- **2026-10-11 — EQ AI 분석의 모델·프롬프트는 프로빙으로 정했다**: 합성 코퍼스 14(사용자 승인)+실샘플 1 위에서 LLM 작업 633건(1단 15모델×3파일 → 2단 상위 4×15파일×3회 → think 단계 → 프롬프트 v1~v3) → 기본 `kimi-k3`·think `low`·`eq-parse-v3`. 홀드아웃 3개에서 템플릿 파서가 0점이라 **LLM 전체 분석이 주 경로, 템플릿 파서는 대조용+폴백**. 번역 품질은 숫자로 재지 않고 `translations.md` 에 참조 번역과 나란히 저장해 사람이 판정. 문서가 "같은 자료로 고치고 잰 것"이라는 단서를 스스로 단다(v3 규칙·실샘플 4번).
- **2026-10-10: 관리자 화면 e2e 의 대상 = 옛 화면(`/app/admin/*`) → 리뉴얼 화면이 정식 경로, 옛 화면은 `/app/admin/legacy/*`**: 컷오버가 경로·라우트 이름을 이어받아 메일 딥링크·QR·e2e URL 517곳은 고치지 않는다 — e2e 는 **선택자만** 새 화면에 맞추거나(정석), 옛 화면 대조가 목적이면 legacy 경로로 옮긴다. 바뀐 선택자 목록(탭 `role=tab`·shadcn Checkbox `role=checkbox`·body 포털 대화상자·'Case 강제 영구 삭제'→'Case 삭제')과 유지한 것(`data-testid`·버튼 이름·`#bomc-*` 앵커)은 `docs/ADMIN_NEXT_UI.md` §10·§11 — 맞추는 일은 남은 일이다([sp-vue-web](sp-vue-web.md)).
- **2026-10-09 — BOM 외화·마스터딜러: API 여정 3편 위에 화면 상세 여정 + 흔적 주행**(사용자 요청): `journey-bom-partner-fx`(8)·`-md-rfq`(7)·`-md-po`(6)가 API 로 약속을 확인한 뒤, 화면 동선을 직접 밟는 `-md-detail` 이 **API 여정은 통과하던 결함 3건**을 잡았다(숫자 입력칸 `v-model` 이 숫자를 주는데 `trim()` 해 요청이 아예 안 나감 · 미리보기 0.004 vs 저장 0.0039 — 반올림 두 번 · 무로그인 회신 페이지에 요청처 없음). 교훈: 저장 경로를 API 로만 검증하면 화면의 입력 처리가 통째로 비어 있다 → 새 입력 화면은 **실제로 타이핑해 저장하는 케이스**를 하나씩. 같은 날 재점검이 "PCB 에는 있고 BOM 에는 빠진" 가드 2건을 더했다([journey-recheck-loop](../concepts/journey-recheck-loop.md)).
- **2026-10-06~07 — 관리자 리뉴얼의 검증 두 겹**: ① 정적 — `@shadcn/lint`(토큰·restyle)가 못 보는 "손으로 지은 공통 부품"을 `next-ui-audit.mjs` 가 잡는다(`pnpm lint:next`, mono-app `AGENTS.md` 에 통과 의무 명시, 옛 화면 코드에는 안 건다) ② 동작 — 화면 e2e 가 없던 개발 모듈은 스펙을 같이 만들어 **같은 시나리오를 옛·새 화면 양쪽에서** 돌린다(`admin-develop-journey` 둘 다 9/9). 접수→완료를 끝까지 몬 주행이 찾은 프로세스 결함은 고치지 않고 `docs/DEVELOP_FLOW.md` §15 에 사용자 결정 대기로 남겼다.
- **2026-10-05 — 여정 25호는 정책을 정하기 전의 "현행 동작 관찰"로 세웠다**: 고객 BOM 견적 취소가 지금 무엇을 하는지 상태별로 따라가 다섯 가지(취소 뒤 열린 RFQ·삭제 시 회신 유실·검토 중 화면/서버 불일치·검색 중 굳음·확정↔취소 겹침)를 드러냈고 → 사용자 정책 결정 → 구현 → **기대값을 새 동작으로 뒤집어** 12장면 회귀선(K09 는 확정 도중 여러 시점에 취소를 끼워 넣어 매번 한쪽만 성공, K10 은 행 잠금으로 순서 고정)으로. 여정 13호도 같이 맞췄다 — `2026-10-05: 내역 삭제 대상 = 취소 견적 포함 → 작성 중만`(취소 견적은 삭제 예정일만 보인다).
- **2026-09-30~10-01 — BOM 부품 확인(D43·D44) 여정 22·23·24호 = 고객 화면편·관리자 화면편·유형 확장편**: 22호는 요청·적용·정산을 API 로 부르고 고객 PHP 화면을 조작, 23호는 관리자 sp-vue 화면을 손으로 조작하며 22호가 지나지 않은 예외 경로(발주서에 든 품목·추가결제 주문 뒤 취소 거절·'모아서' 입고 대기·다른 고객 404·열린 화면에서 취소된 뒤 제출)를 연다, 24호는 새 유형을 실 API/DB/고객 화면으로 교차 확인(7/7). 같이 세운 `demo-bom-confirm(-types)-keep` 은 **확인 요청 보내기 직전**에서 멈춰 사람이 이어 가게 한다(사용자 요청, 데모 고객 계정 분리).
- **2026-09-21 — `ops/scripts/hero-perf.mjs` 히어로 성능·강등 회귀 점검**: "배경 움직임 적용 시 wide 로 조정하면 끊김" 제보의 원인을 헤드리스 Chrome + CDP CPU 스로틀 실측으로 갈랐다. `perf`(배너 5장 각 3초 — 01 SVG 윤곽 회전만 메인스레드, 기준값 cpu×4·1920 에서 01 평균 8.2ms/나머지 6.9ms)와 `verify`(정상 기기는 라이트 아님 · sessionStorage 플래그로 처음부터 라이트 · cpu×20 에서 6초 안에 `.is-lite` · 1920→3400 리사이즈에 translateX 안 뜀 · 이음새 픽셀 점프 ≤3)가 강등 정책의 회귀선이다([theme-sp-lite](theme-sp-lite.md)).
- **2026-09-18 — `ops/scripts/shot.mjs` 헤드리스 스크린샷 헬퍼**: 피그마 구현 대조용. e2e 의 playwright-core 를 `createRequire` 로 빌려 URL→PNG(전체·셀렉터·스크롤·모바일·hover·click)를 찍고 JSON 한 줄(치수·박스) + 홈이면 `.sp-home` 직계 섹션 top/height + 콘솔 error·pageerror·≥400·requestfailed 목록을 함께 낸다(Aside/Chrome 확장과 충돌 없음).
- **2026-09-05 — 개발의뢰 API 하네스 `e2e-develop.mts` 는 마켓 하네스 관례 복제**: `develop.*` 유스케이스 4종 `enabled=0`→원복, run→cleanup 잔여 0, 결제 DB 시뮬, 카트 버킷은 마켓과 다른 합성값. 2026-09-11 「개발」 정본(문서 5종·업무표) 도입으로 191/0. 브라우저 쪽은 `develop-wizard`(5스텝 완주, pageErrors 0 게이트)·`develop-contact`(연락처 API 스텁, DB 쓰기 0)가 스모크.
- **2026-08-25 — 관측 러너 분리**(`status-matrix`·`status-matrix-bom`): 시안(스텝퍼) 매핑을 정하기 전에 "지금 무엇이 보이는가"를 표로 확정 — 어서션 대신 관측, 끝나면 시드 되돌리고 삭제. 같은 날 `demo-*-keep`(EQ 직전·국제 발송 전·3건 묶음·MD 선적 준비)가 **정리 없이 무대를 남기는** 러너로 신설(사용자 요청, 협력사 기본 tester2협력 = 사람이 로그인 가능한 실계정).
- **2026-08-16 — 여정 연속 502 의 원인은 앱이 아니라 프록시**: Vite dev 는 모듈 하나가 요청 하나라 여정 몇 편이면 수만 건 → nginx 가 upstream 을 재사용 안 하면 Windows 임시 포트(약 14K)가 TIME_WAIT 로 고갈(`10048`). `map $http_upgrade` + `upstream keepalive` 를 `ops/nginx/local-web.conf` 에 반영. 같은 날 `resetSupplierSearchQuota`(회원당 하루 20회 소진 → 429 → 후보 0건이 "수량 미반영"처럼 보이던 함정, e2e 계정만 되돌림).
- **2026-08-13 — MD 무대 자기창조 `ensureStagePartner`**: DB 복구로 픽스처가 사라지면 md e2e 전체가 `getPartner` throw 로 눕지만, 실계정에 조직을 직삽입 덧연결하면 1계정=1조직 운영 가드를 우회해 사용자 무대를 오염시킨다 → e2e 전용 계정만·기존 멤버십 재사용·없을 때만 생성·관계는 관리자 API 로(전환 가드 검증 겸), 전부 멱등.
- **2026-08-11 — 검증 규율 4종 명문화**(13·29·34~43호의 자기 실수에서): ① 스펙 작성 전 **라우트·body 스키마를 먼저 읽는다**(1차 11회+2차 4회 추측 실수 — 포털엔 `pcb/pos` 목록 라우트가 없어 빈 화면이 났고 이는 정지와 무관한 404) ② **픽스처 이름·시드 메모에 검사 키워드 금지**(`e2e정지협력`+"협력사 정지 검증" 메모가 화면 '정지' 검사에 걸려 2회 연속 오탐) ③ 워크큐 **기본 탭 함정**(`/app/admin/pcb/pos` 기본=발주 대기라 진행 중 발주가 거기 없다 — P4 가 멈추자 P5~P8 이 연쇄 붕괴) ④ **없는 필드를 읽으면 기본값이 조용히 어서션을 통과한다**(29호 `-1·-1·-1`). 부가 규율: raw SQL 컬럼명 추측 금지(Prisma 필드로)·placeholder 는 화면별 실제 문구·같은 견적으로 같은 협력사에 RFQ 재발송은 중복이라 시도조차 없다.
- **2026-08-10~11 — 여정(journey) 편 = 재점검 루프**: 주행 → 화면 관찰 러너(`obs-*.mts`, 스크린샷+innerText 덤프) → 원인 특정된 것만 엄선 → 수정 → 어서션을 뒤집어 회귀선(10호 X6 부분 취소 가드 `isPcbOrderLineCanceled`, 12호 P5 [발송 시작] 라우트, 11호 X7 회차 배지·X9 직송 판정 축). 각 편은 "그 편만 할 수 있는 검증" 하나를 갖는다(3호=고객 축과 묶음의 접합, 8호=돈이 발주와 따로 흐른다, 9호=남의 것이 안 보인다, 16호=경합은 500 이 아니라 도메인 응답).
- **2026-08-10 — E2E 하네스 편입 결정 4종**: ① 로그인 = `/spcb/api/me` 라우트 스텁(그누보드 실로그인은 PHP 화면 왕복 검증에만) ② playwright-core + 시스템 브라우저(다운로드 0) ③ 파일 간 직렬(공유 DB) ④ 자족 시드→검증→무잔재 정리 + `PORTAL_E2E` 옵트인(`PARTS_IT` 미러). 시나리오는 재설계 본 세션이 쓰고 하네스는 기반만 — `harness.e2e.test.ts` 가 복사 시작점. 사용자 방침으로 서버 스모크(scratchpad 소멸 전제)를 대체.
- **2026-08-05 — 코어 최소 수정 가드 `check-core-patches.sh`**: subtree pull 이 충돌 경고 없이 조용히 되돌리는 코어 한 줄 수정(`get_member` 이메일 아이디 필터·`orderform` `G5_IS_MOBILE`·`orderform.sub` `sp_custom_row_it_ids_in`·`orderformupdate` pc/mobile `sp_order_cart_count_sql`)을 pull 직후 `assert_contains` 로 잡는다([core-nonmodification](../concepts/core-nonmodification.md)).
- **2026-07-21 — 통합 테스트는 옵트인, 골든 벡터는 명세**: `PARTS_IT=1` 없으면 CI 자동 skip. `spec-units.cases.json` 이 요구사항 명세(A 골든 74/74 · B 인제스트 2/2 · C 실 ES 검색 27/27, [parts-catalog](sp-node-api.md)).
- **2026-07-08 — 재능마켓 API E2E 스크립트 영구화**(`e2e-market.mts` 33항목 → 같은 날 89 → 2026-09 148): 브라우저 없는 계약·결제·검수·정산 회귀. **하네스가 출하 코드와 같은 함수를 임포트**(`devReviewInputHash`) — 규칙이 갈라지면 정상 등록이 `REVIEW_STALE` 로 튕기는 결함을 하네스가 못 잡기 때문.
- **2026-07-04 — 플레이북**: 공유 DB 를 픽스처로 쓰는 검증은 **단일 agent**(카운트 단언이 경합에 깨짐) · **실브라우저 사각** → UI 는 육안 1회를 절차에 포함 · 위임 지시서에 검증 절차(스냅샷→픽스처→실측→정확 원복)와 "명시 스펙과 코어가 다르면 보고".
- **2026-07-03 — 가격 엔진 레거시 패리티 골든**: 실캡처 body 매트릭스를 라이브 레거시 API 에 재생해 저장(`pricing:capture`), 오프라인 테스트가 판매가·제작일·무게·eta 를 대조([snapshot-freeze](../concepts/snapshot-freeze.md)).

## Gotchas [coverage: high — 16 sources]

- **README 스펙 목록이 실제와 어긋난다** — README 최종 2026-10-10(이번 기간 +11줄: `bom-rfq-scope-add`·BOM 22·23·25호·`demo:bom-confirm`), 스펙 145개 중 **64개 미등재**(2026-09-19 엔 117개 중 40개). 기존 미등재(`status-matrix*`·`demo-*`·`develop-*`·`partner-parts*`·`journey-decisions/orphan/empty/input/precision/narrow/recipient/revive/money-race/myturn/customer-view/eq-reply/multi-item-payment/pcb-claim/partner-parts-*`·`pcb-claim/caseref/selfship-gate/po-selection-guide/invoice-attach`·`md-eq-observe/ship-legs`·`bom-caseref/single-search-results/receiving-navigation`·`dev-diagram-probe`·`partner-i18n`)에 2026-10 신규 24본이 그대로 얹혔다 — BOM 24호(`journey-bom-confirm-types`)·외화·MD 4편·`journey-eq-items*` 6·`journey-eq-reopen*` 3·`journey-md-children/designate/rfq-portal`·`journey-caseref-admin`·`journey-ship-confirm`·`admin-develop-journey`·`php-bridge-escape`·데모 3본(`demo-bom-confirm-keep` 은 명령 표에 스크립트만). 명령 표도 `journey:bom:headed` 를 "1~23호"라 적지만 스크립트는 25호+외화·MD 4편까지 29파일을 돈다. 스펙 헤더 주석과 `package.json` scripts 가 더 정확하다. `e2e-market.mts` 헤더의 "총 134항목"도 stale(문서 148/0) — [manual-sync-drift](../concepts/manual-sync-drift.md).
- **관리자 컷오버(2026-10-10) 뒤 옛 선택자 스펙은 새 화면을 연다** — URL 은 그대로인데 화면이 바뀌었다. 탭을 `getByRole('button')` 으로, 체크박스를 `input[type=checkbox]` 로, 대화상자를 특정 섹션 안에서 찾던 스펙은 `role=tab`·`role=checkbox`·`getByRole('dialog')` 로 고쳐야 한다. 실패가 회귀인지 선택자인지부터 가를 것(목록 `docs/ADMIN_NEXT_UI.md` §10·§11).
- **전역 설정을 켰다 끄는 스펙은 한 vitest 실행에 묶는다** — `journey-eq-items-ai`·`-ai-admin`·`journey-eq-reopen`(L1)이 모두 `pcbEqParse.enabled` 를 켰다 "원래 값"으로 되돌린다. 따로 띄워 **동시에** 돌리면 서로의 원래 값을 잘못 읽어 중간에 꺼 버린다(2026-10-11 실측 2회). 한 실행 안에서는 `fileParallelism: false` 라 안 겹친다. 31호(`cf_email_use`)와 같은 계열.
- **로컬에서 'PCB EQ 분석'이 켜져 있으면 무관한 스펙에도 부작용** — 승인요청을 올리는 **모든** 스펙에 자동 분석 잡이 붙고(가짜 EQ 파일이라 실패 잡, FK 없어 발주서를 지워도 남음 → `cleanupPcbPos`·`sweepEqAiJobs`), 고객 회신이 있는 스펙마다 뒤에서 실제 번역 호출이 한 번 나간다(결과에 기대는 단언은 없다).
- **거버 앱은 번들이 다 실리기 전에 넣은 파일을 조용히 버린다**(2026-10-09) — 거버 제출로 시작하는 여정 1·2·4·12·20호가 전부 첫 단계에서 60초 타임아웃. 원인은 거버 앱이 아니라 `submitGerberRfq` 가 입력 칸이 붙자마자 파일을 넣은 **헬퍼 경합**(webpack dev) → `load` 대기. 이 기간엔 낡은 단언도 드러났다 — PCB 12호의 단언 5개(08-25 고객 화면이 짧은 배지로 바뀐 뒤 미갱신)·`journey-metal-mask` M3(09-06 포털 문구 변경 뒤 미갱신)·BOM 13호의 옛 상태 문구('견적 요청'). 오래 안 돌린 여정은 이번 변경과 무관하게 눕는다.
- **공급사 발주서 생성 = 실제 카트 API** — Mouser·DigiKey 는 자동 실행 대상(`EXTERNAL_AUTOMATED_SUPPLIERS`)이라 e2e 픽스처의 구매 조건은 UniKeyIC 로 깐다(22~24호·데모 주행).
- **Mailpit `subject:"…"` 검색은 프로젝트명에 따옴표가 있으면 0건** — 빌려 쓰는 스펙이 험한 이름 픽스처일 수 있다(`journey-md-rfq-portal` 실측). 주행이 만든 메일은 목록에서 제목·시각으로 고른다.
- **건수를 세는 스펙은 전용 조직이 필요하다** — `journey-ship-confirm` 은 보드 건수를 정확히 세려고 `e2e-선적확인` 을 따로 두고, 앞선 주행의 잔재가 있으면 시작에서 멈춘다. `harness` 의 `tracks` 검사도 capability 가 늘자(`parts`) `toEqual` → `toMatchObject` 로 풀었다 — 넓어지는 응답에 전체 일치 단언은 묵는다.
- **관례 정본 `HANDOFF_E2E_TEST.md` 는 gitignore**(`HANDOFF*.md`) — README 가 "준비 산출물" 절을 정본으로 가리키지만 리포에 없다. 다른 머신에선 README·헬퍼 주석이 정본.
- **여정 연속 주행이 502 로 죽으면 프록시부터 의심** — 증상이 테스트마다 떠돈다(어제 K03, 오늘 C06). 리포트 `## HTTP ≥400` 에 502 무더기면 nginx keepalive·임시 포트 고갈.
- **워크큐 기본 탭이 우리 건의 탭이 아니다** — `pos`=발주 대기·`orders`=입금 대기. RFQ·발주 큐는 기본 탭에 **검색창이 없다**(별도 데이터 소스). 탭 클릭 후 검색으로 좁힐 것.
- **없는 필드는 조용히 기본값** — `sp_pcb_shipment` 엔 `reorderRound` 가 없어(대표 발주에서 파생) `-1` 이 찍혀도 어서션은 통과했다. 리포트 문자열을 눈으로 확인. 같은 계열: 발주에 `rfqId` 누락이 200 인데 pos 가 비어 뒤가 조용히 무너짐, 응답 키 오독(`data.items`), placeholder 를 '검색'으로 가정(여섯 중 다섯이 안 맞아 검증이 통째로 비었다).
- **픽스처 이름에 검사 키워드를 넣으면 자기가 심은 글자를 자기가 찾는다**(2회 오탐). 없는 라우트는 Vue Router 가 아무것도 안 그려 빈 화면 = 404 이지 결함이 아니다.
- **Mailpit 은 사용자 관찰용이기도 하다** — 전체 삭제 금지, 시드가 유발한 메일만 id 로. 같은 제목이 주행마다 반복(프로젝트명=픽스처 파일명)이라 **발송 전 기준선(최신 1통 ID)** 을 잡고 신착만 본다. 31호는 전역 `cf_email_use` 를 잠깐 끄므로 순차 주행 전제·원복 어서션 필수(38호도 상설 픽스처를 만져 같은 관례).
- **협력1 은 실데이터** — 쓰기 시드는 협력2 또는 신규. `cleanup-md.mts` 는 상설 MD 관계를 지운다. 스펙이 조직·원장을 Prisma 로 직접 지우면 라우트의 동기화를 건너뛰어 카탈로그 `sp_part_offer` 고아가 남는다(12,000행 대형 스펙이 개발 DB 를 12,000건 부풀렸다 → `cleanupPartnerCatalog` 를 원장 삭제 **전에**).
- **공급사 검색 429** — 회원당 하루 20회, 소진되면 후보 0건·수량·선정·가격이 통째로 비어 엉뚱한 어서션이 깨진다(1호 B02·2호 C09 가 그렇게 죽었다). 반복 주행 여정은 beforeAll 에서 `resetSupplierSearchQuota`.
- **스크린샷 접두 충돌** — `output/journey/` 공용 폴더라 여정별 글자 하나(D=2호·J=6호·X=11호·P=12호…)를 전용으로, 겹치면 조용히 덮어쓴다. 8호만은 스크린샷(M8)을 가드 순환보다 **먼저** 찍는다(순환의 종착이 원장·발주 소멸이라 순서를 지키면 빈 화면).
- **playwright-core 는 설치된 channel 만** — Chrome/Edge 둘 다 없으면 즉시 실패. `closeBrowser`·`disconnectPrisma` 를 afterAll 에서 안 부르면 vitest 프로세스가 안 끝난다. `.env.e2e` 가 비면 `requireCustomerCreds` 가 안내와 함께 중단(운영 실계정 금지).
- **Fastify 오류 두 형태** — 봉투형 `{result:false,error}` 와 sensible 표준형이 같은 상태 코드로 나오는데 응답 스키마가 한쪽만 선언하면 **직렬화에서 500 으로 뒤바뀐다**(2026-08-16 실측: 시트 변경 409 가 `FST_ERR_FAILED_ERROR_SERIALIZATION`, 부하 높을 때 더 자주 보였을 뿐 상시 존재). `bom-quotes.biz-error.test.ts` 가 박제. 이관 spec 의 `_legacy` 메타도 같은 직렬화 500 계열(17호).
- **동시 조작은 500 이 아니라 도메인 응답이어야 한다**(16·41호) — 유니크 위반이 500 으로 새면 결함(담기=합류 200, 발행=중복 409). 완납 통지 레이스는 프로세스 내 직렬화까지만 — 다중 인스턴스는 이월.
- **환경마다 갈리는 실패** — 191자 초과 프로젝트명이 비 strict MySQL 은 조용히 잘리고 strict 는 500(36호) → 계약 `clampPcbProjectName`. 로컬에서 안 터진다고 운영이 안전하지 않다. 대형 재고표 12,175행(6.36MB JSON)은 MySQL 패킷 한도로 연결이 끊겨 표본 크기 픽스처로는 절대 안 잡힌다 → `partner-parts-large` 는 **크기 자체가 검사 대상**.
- **`PARTS_IT=1` 통합은 `DATABASE_URL` 을 셸에서 export** — vitest 가 .env 를 자동 로드하지 않는다. `local-g-smoke.test.ts` 는 운영·원격·다른 DB 에서 테스트 대역이 켜지지 않음을 박제(보존 스모크의 안전 경계). 격리 MariaDB 통합(`MIGRATION_RESET_INTEGRATION`·`DB_SNAPSHOT_INTEGRATION`)은 별도 옵트인.
- **turbo 가 Windows 에서 깨짐** — 검증은 `pnpm -r typecheck`/`lint`. 전체 `eslint .` 는 25분 안에 끝나지 않아 종료한 기록이 있다(2026-10-11 관리자 EQ 작업공간 작업, 원인 미확인) — **만진 파일만** 돌린다(`src/next` 전체도 타입 인지 린트라 수 분). mono-app `AGENTS.md` 에는 테스트 규율 절이 없다(2026-10 에 `src/next/**` lint 통과 의무만 생겼다) — 규율은 e2e README "핵심 설계"·"함정"과 플레이북에 산다.
- 잔재: `e2e/e2e/output/` 빈 stray 디렉터리(untracked). `docs/AI_DEV_REVIEW.md` §12.11 이 가리키는 `dev-review-diagram-free.e2e.test.ts` 는 현재 없음(`dev-diagram-probe` 로 대체 추정). 4호 픽스처 드리프트(2026-08-10)처럼 상설 조직의 상태가 바뀌면 여정이 통째로 눕는다.

## Sources [coverage: high — 81 sources]

- [e2e README](../../samplepcb-web-mono-app/e2e/README.md) — 실행·구조·완주 여정 해설·핵심 설계·함정(2026-10-10 — BOM 22·23·25호·`bom-rfq-scope-add`·데모 명령 추가)
- [e2e/fixtures/README.md](../../samplepcb-web-mono-app/e2e/fixtures/README.md) — BOM CSV·재고표 짝·거버 zip 검증 상태·local/ 규칙
- [e2e/package.json](../../samplepcb-web-mono-app/e2e/package.json) — scripts 전수(게이트·여정·BOM 1~25+외화·MD·데모·매트릭스)
- [e2e/vitest.config.ts](../../samplepcb-web-mono-app/e2e/vitest.config.ts) — fileParallelism false·타임아웃
- [helpers/env.ts](../../samplepcb-web-mono-app/e2e/helpers/env.ts) — RUN·URL 상수·.env 로더·requireXxx(+데모 고객 자격)
- [helpers/jwt.ts](../../samplepcb-web-mono-app/e2e/helpers/jwt.ts) — me.php 동형 HS256 로컬 서명
- [helpers/browser.ts](../../samplepcb-web-mono-app/e2e/helpers/browser.ts) — /spcb/api/me 라우트 스텁·localStorage 프리셋·snap
- [helpers/php-login.ts](../../samplepcb-web-mono-app/e2e/helpers/php-login.ts) — 그누보드 실로그인
- [helpers/api.ts](../../samplepcb-web-mono-app/e2e/helpers/api.ts) — Fastify 직결·empty-json 함정
- [helpers/db.ts](../../samplepcb-web-mono-app/e2e/helpers/db.ts) — apps/api Prisma Client 차용·trackCleanup(닫기 전 뒷정리 대기)
- [helpers/g5.ts](../../samplepcb-web-mono-app/e2e/helpers/g5.ts) — g5 raw SQL·주문 하드 삭제
- [helpers/seed.ts](../../samplepcb-web-mono-app/e2e/helpers/seed.ts) — 행 복제 픽스처·pickFreeSpecs·ensureStagePartner(capabilities)·PO 시드·EQ AI 잡 정리
- [helpers/journey.ts](../../samplepcb-web-mono-app/e2e/helpers/journey.ts) — createJourneyReport·고객 손놀림·검색 한도 리셋·sweepEqAiJobs·거버 load 대기
- [helpers/mailpit.ts](../../samplepcb-web-mono-app/e2e/helpers/mailpit.ts) — Mailpit REST(전체 삭제 미제공)
- [helpers/partner-catalog.ts](../../samplepcb-web-mono-app/e2e/helpers/partner-catalog.ts) — 카탈로그·ES 고아 정리
- [helpers/bom-md-flow.ts](../../samplepcb-web-mono-app/e2e/helpers/bom-md-flow.ts) — BOM 외화·MD 열세 칸 흐름 도구·상설 무대(2026-10-09)
- [helpers/develop-admin.ts](../../samplepcb-web-mono-app/e2e/helpers/develop-admin.ts) — 관리자 「개발」 옛/새 화면 차이 어댑터·시드·정리(2026-10-07)
- [helpers/xlsx.ts](../../samplepcb-web-mono-app/e2e/helpers/xlsx.ts) — 의존성 없는 xlsx 글자 읽기(회신서 엑셀 검증)
- [specs/harness.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/harness.e2e.test.ts) — 하네스 자가 검증
- [specs/admin-develop-journey.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/admin-develop-journey.e2e.test.ts) — 옛·새 화면 양쪽 주행(DEVELOP_ADMIN_UI)
- [specs/journey-bom-confirm-admin.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/journey-bom-confirm-admin.e2e.test.ts) — BOM 23호(관리자 화면 조작+예외 경로, 22호와의 분담)
- [specs/journey-bom-quote-cancel.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/journey-bom-quote-cancel.e2e.test.ts) — BOM 25호(현행 동작 관찰 → 정책 회귀선)
- [specs/journey-bom-md-detail.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/journey-bom-md-detail.e2e.test.ts) — 외화·MD 화면 상세 여정
- [specs/demo-bom-md-trail-keep.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/demo-bom-md-trail-keep.e2e.test.ts) — 칸마다 Case 를 남기는 흔적 주행
- [specs/journey-eq-items.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/journey-eq-items.e2e.test.ts) — D20 API 박제(화면편 5본의 기준)
- [specs/journey-eq-items-ai-admin.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/journey-eq-items-ai-admin.e2e.test.ts) — AI 화면 주행·EQ_AI_E2E 옵트인·전역 설정 동시 실행 함정
- [specs/php-bridge-escape.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/php-bridge-escape.e2e.test.ts) — 브리지 4종 원문 보존(고치기 전 실측 박제)
- [specs/journey-ship-confirm.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/journey-ship-confirm.e2e.test.ts) — 건수 격리용 전용 조직
- [specs/status-matrix.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/status-matrix.e2e.test.ts) — 관측 러너(어서션 최소)
- [specs/status-matrix-bom.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/status-matrix-bom.e2e.test.ts) — BOM 12단계 관측
- [specs/rework-probe.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/rework-probe.e2e.test.ts) — 가드 W2~W9 순환
- [specs/demo-pre-eq-keep.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/demo-pre-eq-keep.e2e.test.ts) — 무대 남김 러너
- [specs/develop-wizard.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/develop-wizard.e2e.test.ts) — 개발의뢰 브라우저 스모크
- [specs/dev-diagram-probe.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/dev-diagram-probe.e2e.test.ts) — 실 LLM 프로빙(운영 코드 재사용)
- [specs/partner-parts-large.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/partner-parts-large.e2e.test.ts) — 크기 자체가 검사 대상
- [specs/partner-parts-observe.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/partner-parts-observe.e2e.test.ts) — 화면 관찰 계열
- [specs/md-eq-observe.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/md-eq-observe.e2e.test.ts) — MD 관전·대행 회귀
- [tools/verify-gerber-fixtures.mjs](../../samplepcb-web-mono-app/e2e/tools/verify-gerber-fixtures.mjs) — 거버 zip 일괄 판정
- [tools/dev-review-v2-walk.ts](../../samplepcb-web-mono-app/e2e/tools/dev-review-v2-walk.ts) — 검토서 실브라우저 완주(관찰용)
- [ops/scripts/e2e-market.mts](../../ops/scripts/e2e-market.mts) — 재능마켓 API 하네스(2026-07-08~)
- [ops/scripts/e2e-develop.mts](../../ops/scripts/e2e-develop.mts) — 개발의뢰 API 하네스(2026-09-05~)
- [ops/scripts/shot.mjs](../../ops/scripts/shot.mjs) — 헤드리스 스크린샷 헬퍼(2026-09-18)
- [ops/scripts/hero-perf.mjs](../../ops/scripts/hero-perf.mjs) — 히어로 성능 측정·강등 회귀 점검(2026-09-21)
- [ops/scripts/check-core-patches.sh](../../ops/scripts/check-core-patches.sh) — 코어 최소 수정 5 assert
- [AGENTS.md](../../AGENTS.md) — pnpm -r 검증·인증 브리지
- [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 타입 강성·Zod 계약(테스트 규율 절 없음, `src/next` lint 통과 의무 2026-10)
- [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — §9 여정 1~43호 기록·검증 함정·재점검 루프 + D20 단계별 "검증" 줄(api 단위 1351→1412·EQ 주행·거버 헬퍼 경합·Mailpit 따옴표)
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) — D 단계별 E2E 케이스 누적(vitest 557·API E2E 22~) + §6.39~6.45(22~24호·외화·MD 여정·흔적 주행·픽스처 규율)
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — "취소와 보존 기간" 검증(25호 12장면·13호)
- [docs/ADMIN_NEXT_UI.md](../../docs/ADMIN_NEXT_UI.md) — 컷오버 뒤 e2e 남은 일·선택자 변경 목록·`@shadcn/lint`·`lint:next`·옛/새 양쪽 주행(2026-10-06~10)
- [docs/PCB_EQ_AI_PROBE.md](../../docs/PCB_EQ_AI_PROBE.md) — 합성 코퍼스·채점 산식·모델 프로빙 결과(2026-10-11)
- [docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) — 히어로 저사양 대응의 실측 근거(hero-perf)
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — e2e-market 92→148·실행법
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — e2e-develop 110→175→191·단위 수·§15 리뉴얼 주행이 찾은 미결
- [docs/AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md) — 단일 agent·실브라우저 사각·검증 절차
- [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) — 골든 A/B/C·PARTS_IT 옵트인
- [docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·발송 조건
- [docs/PARTNER_PORTAL.md](../../docs/PARTNER_PORTAL.md) — E2E 기반 검증 방침(§6)
- [docs/PARTNER_PARTS.md](../../docs/PARTNER_PARTS.md) — 협력사 부품 스펙 5종·고아 정리
- [docs/partner-i18n.md](../../docs/partner-i18n.md) — PARTNER_I18N_E2E
- [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) — 프로빙 하네스·walk 도구
- [samplepcb-parts-engine/README.md](../../samplepcb-parts-engine/README.md) — uv run pytest·패리티 우선
- [samplepcb-parts-engine/pyproject.toml](../../samplepcb-parts-engine/pyproject.toml) — testpaths 3곳
- [apps/api/package.json](../../samplepcb-web-mono-app/apps/api/package.json) — test·pricing:capture·bom:verify
- [admin-parts.search.int.test.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-parts.search.int.test.ts) — PARTS_IT 실 ES
- [parts-ingest.int.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/parts-ingest.int.test.ts) — PARTS_IT 실 DB·ES
- [db-snapshot.integration.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/db-snapshot.integration.test.ts) — DB_SNAPSHOT_INTEGRATION
- [reset-data.integration.test.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/migrate/lib/reset-data.integration.test.ts) — MIGRATION_RESET_INTEGRATION
- [spec-units.test.ts](../../samplepcb-web-mono-app/packages/utils/src/spec-units.test.ts) — 골든 벡터(cases.json)
- [pricing/legacy-parity.test.ts](../../samplepcb-web-mono-app/apps/api/src/pricing/legacy-parity.test.ts) — 레거시 가격 골든
- [local-g-smoke.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/local-g-smoke.test.ts) — 보존 스모크 안전 경계
- [bom-quotes.biz-error.test.ts](../../samplepcb-web-mono-app/apps/api/src/routes/bom-quotes.biz-error.test.ts) — 오류 두 형태 직렬화
- [scripts/probe-eq-parse.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/probe-eq-parse.ts) — EQ 분석 모델 프로빙 하네스(출하 코드 그대로·옵션)
- [scripts/gen-pcb-eq-fixtures.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/gen-pcb-eq-fixtures.ts) — 합성 코퍼스 생성기(파일+gold 동시 생성)
- [pcb-eq-extract/template.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-eq-extract/template.test.ts) — 코퍼스 gold 를 읽는 단위 회귀(a~j 고정·k~n 홀드아웃)
- [apps/web/scripts/next-ui-audit.mjs](../../samplepcb-web-mono-app/apps/web/scripts/next-ui-audit.mjs) — 리뉴얼 일관성 점검 6규칙(2026-10-06)
- [test_procurement.py](../../samplepcb-parts-engine/packages/supplier-search-engine/tests/test_procurement.py) — 양산 모드 Reel 사유 회귀 3건(2026-09-30)
- e2e/output/journey/findings.md·findings-search.md — 여정 리포트 형식(gitignore, 로컬 산출물)
- e2e/output/status-matrix.md — 관측 표(gitignore)
- e2e/output/obs-j9-screens.mts·cleanup-probe.mts·cleanup-md.mts — 관찰·정리 러너(gitignore)
- git log `samplepcb-web-mono-app/e2e` 2026-08-10~2026-10-11 (189 커밋 — 지난 컴파일 뒤 34, 스펙 최초 커밋 8월 111·9월 9·10월 25)
