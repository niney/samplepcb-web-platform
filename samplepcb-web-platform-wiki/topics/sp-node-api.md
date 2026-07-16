---
topic: sp-node-api
last_compiled: 2026-07-13
sources_count: 16
status: active
---

# sp-node-api

## Purpose [coverage: high — 7 sources]

**sp-node** = Fastify 5 API 서버 (`samplepcb-web-mono-app/apps/api`, nginx `/api` 프록시, 기본 127.0.0.1:3333). 동적 PCB 주문(거버 업로드 → 사양·가격이 그때 정해지는 주문)을 영카트 **코어 무수정**으로 구현하는 백엔드로 출발해, 2026-07-04 "sp-php 업무 기능의 모노레포 점진 마이그레이션" 방침 이후 관리자 백엔드 전반으로, **2026-07-08~13 사이 재능마켓 거래 완결·AI 유스케이스 실행·레거시 DB 마이그레이션·SEO/슬라이드 관리까지** 확장됐다. 현재 핵심 역할:

- **거버 PCB 담기 API** (`/api/pcb-projects`): 검증 → 견적 → 파일서버 업로드 대행 → `sp_*` 저장 → `g5_shop_cart` 스냅샷 INSERT
- **가격 엔진** (`src/pricing/engine.ts`): 레거시 PHP `pcb_price*.lib.php` 실측 패리티 이식 + **거버 가격모드**(`gerber-price-mode.ts` — 공급가 ×1.1 정규화, 2026-07-05)
- **재능마켓 백엔드** (`market-*.ts` 5 + `admin-market-*.ts` 4): 전문가 승인·블라인드 입찰·채택 → 계약·영카트 재사용 결제·검수(7일 자동확정)·정산 — 정본 [MARKET_FLOW](../../docs/MARKET_FLOW.md)
- **AI 유스케이스 실행 계층** (`routes/ai.ts` + `lib/ai/`): `sp_config`(연결) + `sp_ai_usecase`(케이스별 설정) + `POST /api/ai/:useCase/run` 비동기 잡. 인터뷰 파이프라인 Phase 1~3(structurize·diagram-spec·roc·postings)과 설명·첨부 기반 최초 질문 선분석(multipart 비동기 잡) — 정본 [AI_DIAGRAM](../../docs/AI_DIAGRAM.md)
- **관리자 API** (`/api/admin/*`, `requireAdmin`): 견적(가격 확정)·회원·주문내역(orderlist.php 풀 패리티)·설정(사업자정보·거버가격·AI)·SEO(`admin-seo.ts`)·메인 슬라이드(`admin-slides.ts`)·마켓 심사/계약/정산
- **레거시 DB 마이그레이션 스크립트군** (`src/scripts/migrate/`): 운영 레거시(EAV 상품 4.5만 건) → 신규 모델 변환 이관 + 증분 sync — P1~P3 verify 그린, 정본 [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md)
- **g5 접근 카탈로그** (`src/lib/g5-db.ts`): 그누보드/영카트 DB 접근을 함수·컬럼 단위로 규율한 단일 모듈 — 현재 ①~⑲(마켓 계약 결제 포함)

소비 주체: 거버 뷰어(React, 별도 repo), sp-vue 관리자(`/app/admin/*`), sp-market 고객 SPA(`/market`), sp-php 커스텀 페이지(`/shop/quotes` 등).

## Architecture [coverage: high — 7 sources]

- **스택**: TypeScript / Node 22, Fastify 5 + `fastify-type-provider-zod`(Zod가 req/res 검증·직렬화의 단일 진실원본), `@fastify/multipart`(거버 zip 최대 100MB), `@fastify/jwt`, `exceljs`(배송 엑셀), `nodemailer`(견적 메일 직송 `lib/mailer.ts`). pnpm + Turborepo 모노레포의 `apps/api`.
- **타입 강성 "매우 강함"**: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes 등, ESLint `no-explicit-any`=error. 데이터 흐름 DB(Prisma/mysql2) → Fastify(zod) → `@sp/api-contract` → Vue.
- **계약**: 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod). `PcbProjectPayload`(spec 키 39종)·`JwtClaims`·관리 계약군(`admin`/`members`/`orders`/`settings`/`seo`) + **`market.ts`**(마켓 스키마·`MARKET_*` 코드 사전과 한글 라벨 정본 — sp-market·sp-vue·sp-node 메일 빌더 3곳 공유)·`AI_USECASES`.
- **디렉토리** (`src/`):
  - `server.ts` — 부트스트랩, 라우트 prefix `/api`, HOST 기본 127.0.0.1(로컬 전용, nginx 뒤)
  - `routes/` — `pcb-projects.ts`(담기)·`pcb-thumbs.ts`·`me.ts`·`health.ts` · **마켓 회원** `market-{experts,projects,bids,contracts,settings}.ts` · **AI** `ai.ts`(run/jobs) · **관리자** `admin-pcb-projects` `admin-members` `admin-orders` `admin-settings` `admin-seo` `admin-slides` `admin-market-{experts,projects,contracts,settings}`
  - `plugins/auth.ts` — 그누보드 JWT **검증만** + `requireAdmin` 데코레이터(JWT `isAdmin` 클레임)
  - `pricing/` — `engine.ts`(불변, 골든테스트 고정) + `gerber-price-mode.ts`(엔진 "밖" 후처리 순수함수) + `pricing-data.json` 스냅샷 + `legacy-parity.test.ts`(실측 47케이스)
  - `lib/` — **`g5-db.ts`(접근 카탈로그, mysql2)** · `market.ts`(asXxx 내로잉·lazy 마감)·`market-contract.ts`(`ensureContractLazy` paid 승격)·`market-email.ts` · **`ai/`**(`ollama.ts` 스트림 클라이언트·`usecases.ts` 레지스트리+기본 프롬프트·`jobs.ts` 인메모리 잡) · `sp-config.ts`(sp_config KV) · `file-server.ts` · `php-bridge.ts`(알림 브리지) · `mailer.ts`/`alimtalk.ts`(견적 메일·알림톡) · `banner-image.ts`(슬라이드 이미지 → `G5_DATA_PATH`/banner) · `option-summary.ts` · `order-edit.ts` · `delivery-excel.ts` · `quote-delete.ts` · `estimate-email.ts` · `legacy-db.ts`(마이그레이션 전용·읽기 전용) · `kst.ts`
  - `scripts/` — `sync-pricing-data.ts`·`capture-legacy-pricing-goldens.ts`·`seed-template-items.ts`·`seed-market-anchor-item.ts`(앵커 상품 `sp-market-svc`)·`seed-market-house-expert.ts` · **`migrate/`**(run/sync/manifest 게이트 + phases 01-members~05-reviews + verify/wipe/upload-files)
- **AI 실행 모델**: 생성이 수 분(glm-5.2 ~3분)이라 run은 jobId 즉시 반환 → `GET /api/ai/jobs/:id` 폴링. 잡은 인메모리(단일 인스턴스 전제, 재시작 시 소실=재시도). Ollama 호출은 **`stream:true` 필수**(비스트림은 undici 헤더 타임아웃 ~300s에 걸림).

## Talks To [coverage: high — 7 sources]

| 상대 | 방향/방식 |
|---|---|
| 거버 뷰어 (React) | multipart POST + `Authorization: Bearer JWT` 수신 |
| sp-vue 관리자 / sp-market 고객 SPA | `/api/admin/*`(requireAdmin) / `/api/market*`·`/api/ai/*` 소비 (Bearer JWT) |
| 그누보드 인증 브리지 `spcb/api/me.php` | 직접 통신 없음 — 브리지 발급 HS256 JWT(TTL 10분, `mbId`·`cartId`·`isAdmin`)를 공유 시크릿(`JWT_SECRET`=`spcb/lib/secret.php` 수동 동기화)으로 검증만 |
| PHP 알림 브리지 `spcb/api/order-notify.php` | sp-node → sp-php 역방향: 주문 상태 전이(입금/배송) 시 `notifyOrderEvent`가 서비스 JWT(`svc:'sp-node'`)로 POST — 레거시 커스텀 메일 템플릿 재사용 발송. 실패는 삼켜 전이 성공 불변 |
| SMTP (`SMTP_HOST:PORT`) | **sp-node 직송 메일** — 견적 메일(`lib/mailer.ts`) + 마켓 알림 메일 8종(`market-email.ts`, 매칭 4+거래 4, 비차단). 로컬은 Mailpit(127.0.0.1:25)이 가로챔 |
| 알림톡 (iwinv) | `lib/alimtalk.ts` — `ALIMTALK_ENABLED=false` 기본(fail-safe). 마켓 알림톡은 템플릿 사전 심사 대기로 2차 |
| Ollama (`AI_BASE_URL`) | AI 유스케이스 실행 — 기본 로컬 데몬 127.0.0.1:11434, 운영은 `https://ollama.com`+API 키. 우선순위 `.env` > 관리자 저장값(sp_config) > 기본값 |
| samplepcb DB (공유) | Prisma로 `sp_*` 소유 (`DATABASE_URL`) |
| 그누보드/영카트 DB (`G5_DATABASE_URL`) | mysql2 직결 — 접근 카탈로그 ①~⑲ (아래 Data) |
| 레거시 운영 DB (`LEGACY_DATABASE_URL`) | 마이그레이션/증분 sync 전용 — `legacy-db.ts`가 SELECT 외 거부(읽기 전용) |
| file.samplepcb.kr | 서버-to-서버 업로드·삭제 대행, pathToken 클라이언트 미노출. serviceType: 거버 `gerber` / 마켓 `MARKET_FILE_SERVICE_TYPE`(기본 `market` — 운영 전 수용 실측 필요) |
| sp-php 디스크 (`G5_DATA_PATH`) | 메인 슬라이드 배너 이미지를 `data/banner/{bn_id}`에 직접 쓰고 sp-php가 서빙(디스크 공유) |
| nginx | `/api/` → 3333 프록시 |

sp-php가 **sp_* 를 직접 SELECT하는 역방향**도 정착: `sp_review`(reviews.php·main_reviews.php)·`sp_seo`(테마 head.sub.php, read-only 1쿼리·`sql_fetch($sql,false)` 방어) — "관리=sp-vue/sp-node, 소비=sp-php 같은 DB" 패턴.

## API Surface [coverage: high — 6 sources]

**담기·견적 (사용자, `pcb-projects.ts`)**

| 메서드/경로 | 역할 |
|---|---|
| `POST /api/pcb-projects` | 담기: Zod 검증 → JWT → 견적 재계산(+가격모드 정규화) → 파일 업로드 → Prisma 트랜잭션 → flow=order & 가격 확정 시 cart INSERT |
| `GET /api/pcb-projects` (`?status=`) | 목록 — lazy reconcile 겸함(ctId 있음+cart 행 없음 → deleted) |
| `GET /api/pcb-projects/cart-items` | 장바구니 카드 보강(ct_id별 실수량·projectId·썸네일) |
| `POST /api/pcb-projects/order` | 바로 주문: 배치 담기 + `ct_select` 행(ct_id) 단위 UPDATE → orderform 직행 |
| `PATCH /api/pcb-projects/:id` | 수량 수정 = 서버 재견적(새 quoteId). 담김 허용(rfq 강등 수량만 거부) |
| `DELETE /api/pcb-projects/:id` | active→소프트 삭제 / deleted→하드 삭제(실파일 선삭제, 멱등) |

**재능마켓 (회원 `market-*.ts` / 관리자 `admin-market-*.ts`)** — 상세 명세는 [MARKET_FLOW](../../docs/MARKET_FLOW.md) §5·§6

- 전문가 등록·수정(`market-experts`), 의뢰 CRUD·첨부·NDA 서명·다운로드 프록시(`market-projects`), 입찰 제출/철회/채택(`market-bids`), 계약 checkout·납품·검수 확정(`market-contracts`), 공개 설정(`market-settings`)
- 접근 제어는 **서버 강제**: 블라인드(타인 입찰 주는 엔드포인트 자체가 없음)·의뢰인 maskName·NDA 미서명 시 첨부 개수만·입찰 가드 사슬(승인 전문가→자기 프로젝트 금지→targeted 지정자→**system×individual 403 FULL_SERVICE_COMPANY_ONLY**→lazy 마감→unique 중복)
- 관리자: 전문가 심사(approve/reject/suspend)·프로젝트 감독·**계약 목록(od 파생 결제상태 드로어·hold/unhold·정산 settle·운영취소)**·수수료 설정(feeRateBp)

**AI (`ai.ts`)**

| 메서드/경로 | 역할 |
|---|---|
| `POST /api/ai/:useCase/run` | 유스케이스 실행(레지스트리가 입력 스키마·프롬프트 바인딩 케이스별 명시) → jobId 즉시 반환 |
| `GET /api/ai/jobs/:id` | 잡 폴링(5초). 유스케이스 5종: `market.request-diagram`(폴백 단발)·`-structurize`(답변→DiagramSpec JSON)·`-diagram-spec`(spec→HTML)·`-roc`(작업검토지시서 md)·`-postings`(분야별 카드) |

**관리자 (`/api/admin/*`, `requireAdmin`)** — 기존 표면 유지 + 신규:

| 영역 | 표면 |
|---|---|
| 견적 | 목록·상세 / `PATCH :id/price`(rfq→quoted, 담김·주문 409) / `PATCH :id/company-name` / 배치 완전삭제 / 파일 다운로드 |
| 회원 | 목록·상세·차단/레벨·정보/메모 편집(`admin-members.ts`) — `MbIdParams` max 191(이메일 아이디 수용) |
| 주문 | 목록·상세(orderlist.php 이식) / `PATCH orders/status`(선형 전이: 준비→가격확인→…→생산완료→배송→완료, 메일/SMS는 브리지) / `force-status`(A/S 포함) / `items/status`(카트행 취소/반품/품절, 무통장 한정) / `info·memo·receipt` 편집 / `print` / `delivery-excel` GET·POST / `notify-config`(체크박스 게이트 boolean) / 배치 미입금 삭제 |
| 설정 | `settings/business-info`(de_admin_* 11필드) / `settings/gerber-pricing`(order·supply 모드) / AI 연동(연결 sp_config + 유스케이스 sp_ai_usecase — 키 원문은 어떤 응답에도 없음, 마스킹만) |
| SEO | `admin-seo.ts` — `sp_seo` CRUD(scope global/item/board/page + refKey upsert), 소비는 sp-php 직접 SELECT |
| 슬라이드 | `admin-slides.ts` — g5_shop_banner('메인') 관리 + 이미지 `G5_DATA_PATH/banner/{bn_id}` 기록 |

가격 엔진 커버리지: standard(면적식+옵션표+마진브래킷+소형고정가) / metalMask(국내가표) / advance·flexible류·mass·가격 0 → **rfq**. 레거시 body↔spec 별칭(mixTrace→minTraceSpacing 등)은 [pricing-engine-parity](../../docs/pricing-engine-parity.md), 실측 body 구성은 [samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md).

## Data [coverage: high — 6 sources]

**Prisma (sp-node 소유, `sp_` 접두)** — 그누보드와 **같은 DB(`samplepcb`) 공유**(DB 공유 ≠ 스키마 결합). 상태값은 String+앱단 리터럴 유니온(enum 미사용), mbId는 FK 금지 조인 키(VarChar 191 — 이메일 아이디 수용):

- **`sp_quote`** — 견적 스냅샷(단일 진실원본). `specHash`·`autoPrice`(null=rfq)·`priceVersion`·`expiresAt`(+72h)
- **`sp_order_spec`** — 주문 실체(=PCB 프로젝트). `ctId`(cart 파생 조회 키)·`specJson`·`quoteStatus`·`finalPrice`·`companyName` 스냅샷. `message`는 MediumText(레거시 it_basic ~1MB)
- **`sp_file`** — 폴리모픽 파일 연결(refType='sp_order_spec'|'sp_market_project'|'sp_market_expert'|'sp_market_contract'), `pathToken`만
- **`sp_member_profile`** — 회원별 기본값(회사명 프로필층) + **레거시 mb_1~15 커스텀 필드의 명시 컬럼 승격처**(memberType·bizNo·managerPhone… 잔여는 `legacyJson`)
- **`sp_order_biz_info`** — 레거시 od_1~11 세금계산서 정보 이관처(odId PK)
- **`sp_review`** — 영카트 별점후기(g5_shop_item_use) 이관본. it_id→레거시 cart 라인→`quoteId=uuidV5("od:ct")`로 **프로젝트 단위 재귀속**, `legacyIsId` unique=증분 sync 멱등 키, `is_password`(회원 비번 해시 사본)는 절대 미저장
- **`sp_market_*` 6종** — expert(승인 워크플로·정산계좌)·project(lazy 마감 `bidDeadlineAt`·`diagramHtml`/`diagramSpec`/`rocMd`/`interviewAnswers`(응답 미노출)/`postings` AI 산출물 5필드)·bid(unique(projectId,expertId))·nda_sign·settings(싱글턴 feeRateBp)·**contract**(projectId unique·fee/payout 채택 시점 스냅샷·`contractKey` uuid=영카트 io_id·paid/delivered/completed/settled 상태기계)
- **`sp_seo`** — scope(global|item|board|page)+refKey unique. canonical은 계산이 기본(수동 오버라이드만 저장), jsonLd 컬럼 없음($it 자동 유도)
- **`sp_config`** — sp 소유 KV 싱글턴(`gerber_price_mode`·`ai_base_url`·`ai_api_key`) / **`sp_ai_usecase`** — 유스케이스별 enabled·model·promptTemplate, 행은 레지스트리 기준 lazy 생성

**g5 접근 카탈로그** (`lib/g5-db.ts`) — 함수·컬럼 단위 명시, 민감 컬럼(비밀번호·인증·od_pwd/od_cash) SELECT 자체 배제, Prisma 비편입 불변:

- ① 담기 4종(cart INSERT·옵션 행 INSERT+보상 DELETE·파생 SELECT·ct_select UPDATE) · ⑤⑧ g5_member/g5_config read · ⑥ 견적 행 UPDATE/DELETE(재견적 동기화) · ⑦ 발신처 · ⑨ 회원 UPDATE(차단/레벨·정보/메모) · ⑩⑪ 주문 프리뷰/미입금 삭제 · ⑫ 주문내역 read(`searchOrders`·counts) · ⑬ 상태 전이(입금→준비→배송→완료, 재고·미수금 재계산) · ⑭ 상세 편집 · ⑮ 카트행 취소/반품/품절 · ⑯ force-status · ⑰ **PCB 제작 8단계**(od_status 재사용·`ACTIVE_ORDER_STATUSES` SSOT·선형 전이 `setOrdersStage`) · ⑱ 사업자정보(de_admin_* 11컬럼만) · **⑲ 재능마켓 계약 결제(2026-07-08)** — 계약 카트행 INSERT(io_id=contractKey)·'쇼핑' 행 멱등 청소·버킷 판정 read·앵커 상품 read·paid 승격 **라인 검증** read(`PAID_ORDER_STATUSES` — '부분취소'는 행 단위라 od 헤더만 보면 오판)

**환경변수**(`.env.example`): `PORT`/`HOST`, `JWT_SECRET`, `DATABASE_URL`, `G5_DATABASE_URL`, `LEGACY_DATABASE_URL`, `G5_DATA_PATH`(배너 이미지 — 필수), `SPCB_BRIDGE_URL`(기본 127.0.0.1:8888), `SMTP_HOST/PORT/USER/PASS`·`MAIL_FROM`, `ALIMTALK_ENABLED/URL/AUTH_TOKEN`, `WEB_BASE_URL`, `FILE_SERVER_URL`/`FILE_SERVICE_TYPE`(+마켓 `MARKET_FILE_SERVICE_TYPE`), `AI_BASE_URL`/`AI_API_KEY`(env가 관리자 저장값보다 우선 — 키를 DB에 안 남김).

## Key Decisions [coverage: high — 9 sources]

- **2026-07-12~13 — AI는 범용 유스케이스 계층, spec JSON이 피벗**: 라우트는 `POST /api/ai/:useCase/run` 공통, 정책(입력 스키마·프롬프트)은 레지스트리가 케이스별 명시. 인터뷰 파이프라인은 기존 단발 diagram의 의미를 바꾸지 않고 유스케이스를 추가(비활성 시 폴백)했고, LLM 산출은 **실패 대신 복구**(zod `.catch`+`normalizeDiagramSpec`)·저장 전 재검증(파손 spec 400 — 이관 `_legacy` 직렬화 500 교훈). 전체서비스 입찰 제한은 목록·상세 공개+입찰만 403(기획 완화형).
- **2026-07-10 — SEO는 신규 sp_seo + sp-php 테마 직접 SELECT**: cf_add_meta 확장 기각. 관리=sp-vue/sp-node, 소비=테마 head.sub.php 1쿼리(URL 파싱이 아니라 스크립트 basename+`$it`/`$bo_table` 전역변수 매칭). `$it` 자동 유도가 기본, 레코드는 오버라이드.
- **2026-07-09 — 별점후기는 프로젝트 단위 재귀속**: 레거시 it_id 귀속을 uuidV5("od:ct") 결정적 키로 `sp_order_spec.quoteId`에 재귀속(매핑 실패도 저장 — 스킵 금지). `is_password`는 어떤 형태로도 미저장.
- **2026-07-08 — 마켓 결제는 영카트 재사용(거버 담기와 동형)**: 앵커 상품 `sp-market-svc`(it_price=0·it_sc_type=1) + io_id=contractKey 옵션 행. **paid 승격은 cron 없는 lazy write-back**(라인 검증, 단방향 래칫), 자동확정도 조회 시점 스윕(deliveredAt+7d). 수수료는 전문가측 10% 단일 공제, 채택 시점 스냅샷. 마감도 cron 없는 lazy 판정(`isBiddingClosed` — 읽기와 쓰기 가드가 같은 식).
- **2026-07-06~07 — 레거시 마이그레이션은 게이트+멱등**: "애매하면 중단"을 manifest 처분표(운영 96테이블 전수)·컬럼 허용목록·절단 검사로 코드화. 멱등 재실행이 원자성의 대체(uuidV5 quoteId 수렴), 금액은 공급가→VAT 포함 변환 후 `computeOrderMoney` 재산출 항등. 증분 sync는 대조(diff) 기반(레거시에 수정시각 없음), 삭제는 리포트만.
- **2026-07-05 — 거버 가격모드는 엔진 "밖" 후처리**: engine.ts는 골든테스트 고정 불변, `applyGerberPriceMode`가 listPrice를 정규화(supply=×1.1)해 하류(autoPrice·카트·견적서) 자동 정합. 저장소는 코어를 안 건드리는 sp_config 신설. / **제작 8단계는 od_status 재사용·선형 전이**(신규 컬럼·마이그레이션 없음), A/S만 force-status 전용.
- **2026-07-04~05 — 관리 기능 점진 마이그레이션 + 접근 카탈로그**: g5_* 접근은 "금지 예외"가 아니라 규율된 카탈로그 — g5-db.ts 일원화·함수/컬럼 단위 기록·코어 부수효과 정합성·문서 동시 갱신. 알림은 Node 재구현 아닌 PHP 브리지 재사용(발송 실패는 삼킴), 알림 게이트는 서버 계산·FE 소비(코어 목록의 무조건 노출=결함을 의도적 교정).
- **2026-07-02~03 — 코어 비수정 + 스냅샷 모델 + io_price 기법**: 주문 실체는 sp_order_spec 소유, cart엔 스냅샷 행만. 견적가는 `ct_price=0`+옵션 행(`io_id=quoteId, io_price=견적가`) 실등록으로 코어 재검증 정당 통과. 가격은 서버 재계산만이 진실, 라이브 실측 패리티(47케이스)로 보증. cart↔spec 관계는 저장하지 않고 파생(lazy reconcile).

## Gotchas [coverage: high — 8 sources]

- ⚠ **`prisma migrate reset` = 그누보드 DB 전멸**, `migrate dev`도 금지(g5_* 60개 drift → 항상 전체 reset 요구). 스키마 변경은 추가 전용 migration.sql 수기 + `migrate deploy` + `generate`.
- ⚠ **`differentDesign` 부재 → 조용한 rfq 강등**: 키 누락 시 "0원 → 견적 대기"(2026-07-03 실사고). / **가격표 스냅샷 드리프트**: `pnpm pricing:sync` → PRICE_VERSION bump → `pricing:capture` → `pnpm test` 절차 누락 시 패리티 첫 케이스 "sha 불일치".
- ⚠ **AI 비스트림 호출 금지**: undici 헤더 타임아웃(~300s)으로 장시간 생성 실패 — `stream:true` 필수. LLM 산출 HTML은 **sandbox iframe(srcdoc) 렌더만**(DOM 직결=XSS), rocMd도 라인 파서 렌더(v-html 금지). 일반/레거시 경로는 텍스트만 전송하고, 첨부 구조화 전용 multipart 경로만 고지 후 제한 추출한 문서 텍스트·래스터를 전송한다(`qwen3.5:cloud`, 원본 해시 provenance). 잡은 인메모리라 서버 재시작 시 소실.
- ⚠ **이관 specJson `_legacy` 메타**: 내부 id·PII(memberContact)가 섞여 있어 spec을 그대로 직렬화하는 라우트는 500(FST_ERR_RESPONSE_SERIALIZATION) — 새 spec-응답 라우트는 언더스코어 키 strip 필수. 신규 모델은 `legacyJson` 분리 저장이 관례.
- ⚠ **mb_id ≤ 20자 가정 금지**: 이관 회원은 이메일 아이디(최대 29자) — 코어 필터·컬럼 폭·계약 3층에 가정이 숨어 있었음(sp측은 VarChar 191). / **만료 견적 정리 배치는 이관 견적(`priceVersion='legacy-migration'`) 제외 필수** — 1.87만 건 삭제 후보화 방지.
- **마켓 paid 판정은 od 헤더가 아니라 라인**: '부분취소'는 od_status 값이 아니라 행 단위 취소 — 자기 카트행 ct_status∈PAID ∧ io_id==contractKey ∧ io_price==amount로 검증. 계약 취소 시 **카트행·옵션행 정리 필수**(잔존 '쇼핑' 행은 코어 buy로 취소 계약을 결제하는 구멍). E2E에서 od_id는 2^53 미만 대역(mysql2 number 정밀도).
- **파일 삭제 API 무인증 GET**(`GET /api/delete/:pathToken`) — pathToken 유출 시 임의 삭제, 내부망 제한 후속 과제. / 마켓 파일서버 serviceType `market` 수용은 운영 전 1회 실측 필요.
- **알림/메일 3중 정합**: 회원 JWT·서비스 JWT 모두 `JWT_SECRET`(=`SPCB_JWT_SECRET`) HS256 — 불일치 시 order-notify 401. 로컬 메일은 Mailpit을 25번에(XAMPP mailtodisk 불통 — G5_SMTP 모드). 발송 조건: `cf_email_use=1`+입금/배송 이벤트+수납액/운송장 존재(준비·완료는 무알림). 브리지는 `mailer()` 반환 미검사라 'sent'여도 실패 가능(apache error.log 확인).
- **관리자 목록 GET은 lazy reconcile 안 함**(읽기가 타 사용자 데이터 변경 금지) — 유령 건은 가격 확정 시점 409 정리. / 주문 전이의 send_cost·쿠폰은 저장값 재사용(포트 미이식 갭), 포인트 복원 no-op(ct_point>0은 HAS_POINT 409).
- **g5 접근 확장은 카탈로그 갱신 선행** — g5-db.ts 밖 g5_* 접근·화이트리스트 밖 컬럼 쓰기 금지. / 마켓 E2E 97항목(`ops/scripts/e2e-market.mts`)에 LLM 실호출은 없음(실생성 검증은 수동 스모크).

## Sources [coverage: high — 16 files]

- [AGENTS.md (루트)](../../AGENTS.md) — 프로젝트 호칭·nginx 라우팅·인증 브리지 단일 설명원본
- [AGENTS.md (모노레포)](../../samplepcb-web-mono-app/AGENTS.md) — 스택·타입 강성·계약 규칙·접근 카탈로그 규율
- [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 환경변수 전체(SMTP·알림톡·AI·G5_DATA_PATH 포함)
- [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — sp_* 전 모델(quote/order_spec/file/member_profile/order_biz_info/review/market_* 6종/seo/config/ai_usecase)
- [MARKET_FLOW](../../docs/MARKET_FLOW.md) — 재능마켓 1·2차(매칭→계약·결제·검수·정산) 단일 설명원본
- [AI_DIAGRAM](../../docs/AI_DIAGRAM.md) — AI 유스케이스 계층·인터뷰 파이프라인 Phase 1~3·프로빙 확정
- [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) — 가격모드(order/supply)·영카트 VAT 처리 실측·sp_config
- [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md) — 마이그레이션 스크립트군·게이트·증분 sync·컷오버 런북
- [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md) — sp_seo 설계 정본(옵션 B 매칭·폴백·자동 유도)
- [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) — 담기 프로세스·코어 무수정 기법 카탈로그·g5 접근 카탈로그 ①~⑲
- [pricing-engine-parity](../../docs/pricing-engine-parity.md) — 가격표 동기화·differentDesign·레거시 실동작
- [samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md) — 레거시 가격 API body 실측 케이스
- [DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md) — 택배 연동 조사(미결정)·배송 전이 코드 접점
- [order-notify-gating](../../docs/order-notify-gating.md) — 알림 체크박스 노출 게이트·`getNotifyConfig`
- [review-naming](../../docs/review-naming.md) — sp_review 노출(/reviews)·후기 명칭 정리
- [LOCAL_MAIL_TESTING](../../docs/LOCAL_MAIL_TESTING.md) — Mailpit·발송 조건·브리지 경로·트러블슈팅
