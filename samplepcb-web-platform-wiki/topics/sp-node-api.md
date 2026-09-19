---
topic: sp-node-api
last_compiled: 2026-09-19
sources_count: 90
status: active
---

# sp-node-api

## Purpose [coverage: high — 41 sources]

**sp-node** = Fastify 5 API 서버 (`samplepcb-web-mono-app/apps/api`, nginx `/api` 프록시, 기본 127.0.0.1:3333). 소스 날짜 범위 **2026-07-02 ~ 2026-09-18**. 이전 패턴(2026-07, 이전 컴파일 07-27 시점)은 거버 담기·재능마켓·AI 인터뷰·부품 카탈로그·고객 BOM 견적이 축이었고, **최근 합의(2026-08~09, 커밋 209건)** 는 ① SmartBOM **파트너 협력 트랙**(RFQ→주문·결제→발주→물류→클레임, D18~D43) ② **PCB 파트너 트랙** 이식(RFQ·발주·EQ·송금·선적·A/S·클레임, P1~P5+여정 43편) ③ **발송 이력 원장·배송방법·협력사 보유 부품·파트너 포털 셸** ④ AI 산출물의 **"사전 검토서 1건" 재구성**(08-28)과 **개발의뢰(sp-develop) 직접 모델**(09-05~09-11) ⑤ **운영 재이관·DB 스냅샷 원복·설정 보존 전체 초기화**(09-11~09-16) 다. 이전 컴파일(07-27) 내용은 아래 각 절에 날짜와 함께 남긴다.

핵심 역할(라우트 파일 61종, prisma 모델 78종):

- **거버 PCB 담기·가격** (`/api/pcb-projects`·`POST /api/pcb-pricing`): 검증→견적→파일서버 업로드 대행→`sp_*` 저장→`g5_shop_cart` 스냅샷. 가격 엔진은 레거시 패리티 + **2026-08-07부터 라이브 `pricing_data.json` 을 계산 직전에 fetch**(폴백 사다리) — [live-pricing.ts](../../samplepcb-web-mono-app/apps/api/src/pricing/live-pricing.ts)
- **고객 스마트 BOM 견적** (`/api/bom`, 정본 [BOM_QUOTE](../../docs/BOM_QUOTE.md)) + **사내 서비스용 `/api/svc`**(같은 라우트를 서비스 액터로 재등록, [BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md))
- **SmartBOM 협력 트랙 관리자·포털** (`admin-bom-{quotes,rfqs,pos,orders,receiving,claims}`·`partner-{rfqs,pos,parts,access}`·`rfq-reply` 매직링크) — 정본 [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md), 업무 관점은 [partner-tracks](partner-tracks.md)
- **PCB 협력 트랙** (`admin-pcb-{rfqs,pos,orders,remittances,eq-reviews,cases,as-cases,claims,packages}`·`partner-pcb-{rfqs,pos,shipments,as-cases}`·`pcb-{eq-reviews,claims,rfq-reply}`) — 정본 [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) §9
- **부품 카탈로그+ES**(`admin-parts`, [PARTS_SEARCH](../../docs/PARTS_SEARCH.md)) · **sp-engine 게이트웨이**(`lib/bom-engine-jobs`·`engine-client`, [parts-engine](parts-engine.md)) · **협력사 보유 부품 원장**([PARTNER_PARTS](../../docs/PARTNER_PARTS.md))
- **재능마켓 백엔드**(`market-*`·`admin-market-*`, [MARKET_FLOW](../../docs/MARKET_FLOW.md)) · **AI 사전 검토서·정밀 구성도**(`routes/ai.ts`+`lib/ai/`, [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md)) · **개발의뢰**(`develop-requests`·`admin-develop-*`, [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md), 화면은 [sp-develop-web](sp-develop-web.md))
- **관리자 코어 API** (`/api/admin/*`, `requireAdmin`): 견적·회원·주문(상태 전이·환불 기록·배송방법·엑셀)·설정(사업자·거버가격·AI·BOM)·SEO·슬라이드·**빠른 메일+발송 이력**([MAIL_LOG](../../docs/MAIL_LOG.md))·파트너(조직) 관리·DigiKey 연결
- **레거시 DB 마이그레이션·운영 재이관·DB 스냅샷**(`src/scripts/migrate/`·`lib/db-snapshot.ts`) — [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md)·[legacy-production-reimport](../../docs/legacy-production-reimport.md)·[db-snapshot-rollback](../../docs/db-snapshot-rollback.md)
- **g5 접근 카탈로그** ([g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts)): ①~㉑(㉑=개발의뢰 결제 앵커 `sp-develop-svc`)

소비 주체: 거버 뷰어(React), sp-vue(`/app` 관리자 3모듈+`/partner` 포털+`/app/bom`), sp-market(`/market`), sp-develop(`/develop`, 5177), sp-php 커스텀 페이지·테마(주문내역이 서버사이드로 EQ 확인·클레임·진행 상황 API 호출). sp-rnd(`/rnd`)는 2026-08-28 삭제.

## Architecture [coverage: high — 12 sources]

- **스택**(07-27 유지): TypeScript / Node 22, Fastify 5 + `fastify-type-provider-zod`, `@fastify/multipart`(100MB), `@fastify/jwt`, `@fastify/sensible`, Prisma+mysql2, `exceljs`·`nodemailer`. 타입 강성 "매우 강함"(strict·noUncheckedIndexedAccess·exactOptionalPropertyTypes·`no-explicit-any`=error). 계약은 반드시 `@sp/api-contract`(Zod, 41 스키마 파일 — pcb-rfq·pcb-po·pcb-remittance·partner·partner-parts·bom-rfq·bom-po·bom-receiving·develop·develop-docs·admin-mail·order-progress·digikey 등 신설) — [api-contract](api-contract.md).
- **인가 3단**([plugins/auth.ts](../../samplepcb-web-mono-app/apps/api/src/plugins/auth.ts)): `authenticate`(HS256 JWT 검증+`JwtClaims` 재검사) → `requireAdmin`(`isAdmin` 클레임) → **`requirePartner`**(JWT 에 조직 클레임 없음 — `sp_partner_member` ∧ `partner.status='approved'` 를 **매 요청 서버 판정**, `request.partnerContext={partnerId,partnerName,role}`; capability `part_sale` 등은 라우트가 DB 재확인). 무인증 경로: health·pcb-pricing·pcb-thumbs(서명 쿼리)·매직링크 2종·DigiKey OAuth 콜백·`/api/svc`(nginx allow/deny 가 경계).
- **디렉토리**(`src/`): `server.ts`(prefix `/api`·`/api/admin`·`/api/svc`) · `routes/` 61본(+테스트 5) · `plugins/auth.ts` · `pricing/`(engine 불변+`live-pricing`+`legacy-body-adapter`+골든) · `es/` · `lib/` ~180본(도메인 코어: `bom-*` 30여·`pcb-*` 25여·`partner*`·`develop*`·`ai/`·`mail-log`·`db-snapshot`·`service-actor`·`order-progress`) · `scripts/`(migrate/ 6 phase+sync+reset-data·db-snapshot·parts:*·seed-*·probe-dev-review). `services/` 디렉토리는 없다 — 코어는 전부 `lib/`.
- **트랙 미러 규율**: PCB 코어(`pcb-po`·`pcb-shipment`·`pcb-claim`)는 BOM 코어와 **함수를 공유하지 않고** 계약 코드사전(BOM_SHIPMENT_*)만 공유하는 미러 — "도메인 식별자가 다르면 분리"(BOM 회귀 위험 제거). 판정 축은 파일 하나에 둔다(공정 track 은 `pcb-po.ts`, 잔액은 `pcb-remittance.ts`, EQ 반려 판정은 계약 `isPcbEqRejectionEvent`) — [judgment-single-owner](../concepts/judgment-single-owner.md).
- **비동기 잡 3계열**: ① **AI 잡 = DB `sp_ai_job`**(2026-08-28 인메모리 폐기 — 재시작 내성, 동일 입력 1h 재사용, 러너 `lib/ai/runner.ts`·`followup-runner`·`doc-mail-runner`) + **정밀 구성도는 프로세스 내 큐 동시 1**(`dev-diagram-runner.ts`, 프로빙 141~581초·기동 시 `resumeDevDiagramQueue`) ② 엔진 잡(sp-engine 인메모리 소유, 서버측 폴러 5s·10분 + 결과 GET 백업 훅; 완료 원문은 gzip 아티팩트 원장) ③ **서버 타이머**: ES 색인 큐 드레인 1분 · 부품 정보 복구 워커 30초(10건 직렬) · 발송 이력 retention 6시간(회당 5만 행 청크) · 수출입은행 환율 매일 12:10 KST(USD+CNH). — [in-memory-async-jobs](../concepts/in-memory-async-jobs.md)
- **기동 전 DB 준비**(2026-09-11): `pnpm dev` 는 `prepare-dev.ts` 가 미적용 migration 이 있을 때만 **스냅샷 → `migrate deploy`** 를 MySQL advisory lock 으로 직렬화해 실행. 운영 `deploy.sh` 도 배포 전 스냅샷. 백업 위치는 리포 밖 형제 `samplepcb-db-backups/`.
- **BOM 견적 생명주기**(07-20~, 유지): `buildStatus`·`enrichStatus` 서버 영속 단일 진실, 분석·검색 실행 append-only + 활성 포인터 원자 전환, searching 상세 GET 자기 치유.

## Talks To [coverage: high — 14 sources]

| 상대 | 방향/방식 |
|---|---|
| 거버 뷰어 / sp-vue / sp-market / sp-develop | Bearer JWT 수신. 거버 뷰어는 가격 API 대상 토글(legacy\|platform)로 `POST /api/pcb-pricing` 도 직접 호출(무인증, 레거시 body·응답 동형) |
| 그누보드 인증 브리지 `spcb/api/me.php` | 직접 통신 없음 — HS256 JWT(TTL 10분) 검증만. `JWT_SECRET`=`spcb/lib/secret.php` 수동 동기화 — [spcb-bridge](spcb-bridge.md) |
| sp-php 브리지·테마 | ① `order-notify.php` 에 서비스 JWT POST(입금·배송 메일 — 결과만 `sp_mail_log` 기록, PHP 무수정) ② 테마 주문내역이 서버사이드로 `pcb-eq-reviews`·`pcb-claims/mine`·`bom/claims/mine`·주문 진행(`order-progress`) 호출 ③ 접수는 `spcb/api/claim-create` 브리지 |
| **sp-engine (Python, :8400)** | BOM 추출·공급사 검색·`inventory` 추출 프로필(협력사 재고표)·`catalog-evaluate-batch`·`procurement/reevaluate-batch`. 무인증 사설망, 인증·소유·한도는 sp-node. 후보 판단 계약 `decision`(v3) 은 엔진 단일 소유 — [prompts/sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md) |
| Elasticsearch (`ES_NODE_URL`) | sp-parts 색인·검색(xpse 공유 노드, `sp-` prefix). 다운이어도 앱은 뜸. 협력사 보유 부품은 `supplier='partner'`·`supplierSku='{partnerId}:{rowId}'` 로 투영 |
| 레거시 가격표 서버 `PRICING_DATA_URL` | `gerber_api/pricing_data.json` 을 계산 직전 fetch(60초 재사용·실패 60초 폴백 즉답). 관리자 도구가 예고 없이 덮어쓰는 파일이 가격의 단일 진실 |
| **Mouser Order API / DigiKey MyLists·Barcoding** | 외부공급사 발주 "카트까지"(D20) — Mouser 는 발주서당 고정 CartKey 재충전+GET 대조(D41), DigiKey MyLists 무인증 single-use URL. **DigiKey Barcoding 은 3-legged OAuth 전용**(관리자 [연결] → 콜백 → refresh 90일 회전, `sp_config` 보관, 환경별 각자 연결) — 입고 스캔 자체는 ECIA 2D 라벨 로컬 파싱 |
| 한국수출입은행 Open API | USD(BOM·PCB 공용)+**CNH(PCB D2, KRW 경유 교차)** 자동 환율, `sp_config` 캐시, 15초 역탐색 예산 |
| Ollama (`AI_BASE_URL`) | 2단 파이프라인(비전 판독 `qwen3.5:397b` → 주모델 `deepseek-v4-pro`/`kimi-k3`/`glm-5.3`), `format` JSON 스키마·`think`·스트림 필수. `.env` > 관리자 저장값 > 기본 |
| SMTP / 알림톡(iwinv) | 도메인 래퍼 3종(`sendBomRfqMail`·`sendPcbMail`·`sendMarketMail`)+개발의뢰 메일 10종 — 전부 `sp_mail_log` 자동 기록. 로컬 Mailpit 25번 |
| samplepcb DB (공유) | Prisma `sp_*`(`DATABASE_URL`) / g5_* mysql2 카탈로그 ①~㉑(`G5_DATABASE_URL`) / 레거시 운영 DB 읽기 전용(`LEGACY_DATABASE_URL`, `migrate:sync` 직결). `g5_shop_order.od_delivery_method` 는 sp 가 추가한 코어 컬럼(수동 DDL) |
| file.samplepcb.kr | 서버-to-서버 업로드·삭제 대행. serviceType: `gerber`·`market`·`bom`·`develop`·BOM 선적 첨부(`BOM_SHIPMENT_FILE_SERVICE_TYPE`)·협력사 재고표 원본(보관 필수 — 커밋이 원본 재실행에 의존) |
| MariaDB 클라이언트(`mariadb-dump`/`mysqldump`) | `db:snapshot backup|inspect|restore` — 임시 옵션 파일로 암호 전달, SHA-256 manifest, 복원 전 직전 상태 백업 |

sp-php 가 sp_* 를 직접 SELECT 하는 역방향(sp_review·sp_seo)과 "관리=sp-vue/sp-node, 소비=sp-php 같은 DB" 패턴은 유지 — [admin-vue-consume-php](../concepts/admin-vue-consume-php.md). sp-vue→sp-engine 직접 연결 금지([AGENTS.md](../../AGENTS.md) "BOM 역할 경계").

## API Surface [coverage: high — 20 sources]

**거버·가격**(07-27 유지 + 08-07): `POST/GET /api/pcb-projects`·`/cart-items`·`/order`·`PATCH /:id`(수량=재견적)·`DELETE /:id`(**`PARTNER_TRACK_ACTIVE` 가드** — 협력 기록이 있으면 고객 삭제 불가) · `POST /api/pcb-pricing`(레거시 드롭인, 무인증·저장 없음·가격모드 미적용) · `GET /api/pcb-thumbs/:fileId`(HMAC 서명 쿼리).

**고객 BOM `/api/bom`**(07-27 표 유지): quotes CRUD·prepare/build·sheets·candidates/selection·search-requirements·passive-defaults·part-data/prepare·comparison·request/cancel·jobs 프록시·parts-search(+`supplement`). 08월 추가: 단일검색 견적(08-04~) · `GET /bom/claims/mine`+견적별 클레임 접수(배송 후 문제 접수 D37) · 관리자 품목 교체·추가·확인 대기열(D25·D26·D29). **`/api/svc`** = `bomRoutes`+`bomQuoteRoutes` 를 `{prefix:'/api/svc', actor:'service'}` 로 재등록 — 고정 mbId(`SVC_BOM_MB_ID`, 기본 `apibot`) 주입, 소유 검사 그대로라 고객 견적은 404, 일일 한도만 Int32 max.

**SmartBOM 협력(관리자 `/api/admin`, 정본 §6)**: `bom-quotes/:id/rfqs`(diff 발송·부분 행 §6.13·대리 입력) · `bom-quotes/:id/pos`(D18 — paid 게이트·all-or-nothing·issued 만 삭제) · `bom-orders`(D19 주문 축 파생, 저장 없음) · 외부공급사 발주(D20/D41 Mouser·DigiKey 카트) · 선적(D21/D22 핑퐁·§6.10 그룹·D23 상업송장·D24 QR·D39 운송수단·D40 Case ID) · `bom-receiving`(D42 scan/scans/pos/:poId) · `bom-quotes/:id/force-delete[-preview]`(§6.14 2단계, `previewToken` SHA-256 재조회 409) · `bom-claims` · `bom-quotes/:id/partner-stock` · `mail-logs[/:id/resend]`·빠른 메일 템플릿(§6.15) · `partners`(조직/계정/관계) · `partner-parts`(대행 업로드·뒤처리 10종).

**포털(`requirePartner`)**: `partner/access`(tracks `{bom,pcb,parts}` 파생 — 단일 진입 근거) · `partner/rfqs`·`partner/pos`(BOM) · `partner/parts/*`(재고표 업로드→미리보기→remap→commit, 행 수정·삭제) · `partner/pcb-rfqs`(회신·MD 하위 배정/선정) · `partner/pcb-pos`(EQ 4전이·MD 하위 발주) · `partner/pcb-shipments`(📦 보내기 보드 — 박스=컨텍스트당 1개, `ensurePcbShipment` 합류) · `partner/pcb-as-cases`. 매직링크 `rfq-reply/:token`·`pcb-rfq-reply/:token`(256bit·30일·회전, 선정 후 GET 열람·PUT `NOT_EDITABLE`).

**PCB 협력(관리자)**: `pcb-rfqs`(횡단 워크큐+배정 diff·대리 회신·선정/해제·매직링크, 선정 모달에 확정가 통합 P4.7) · `pcb-pos`(발행 paid 게이트·조건 수정·삭제·eq-approve/reject/revert — 승인은 관리자만 D3) · `pcb-orders`(경리 워크큐 — 이관 2만 건이라 SQL 조인 페이지네이션 "한정 예외 ⑳"·입금확인·고객 배송 큐 P4.6·주문 취소) · `pcb-remittances`(원장·협력사별 잔액·증빙) · `pcb-eq-reviews`(고객 확인 요청 — 전이 머신 불변) · `pcb-cases`(진행현황 12단계 파생+todo 큐) · `pcb-as-cases`(회차 재발주) · `pcb-claims` · `pcb-packages`(Case QR) · `pcb-projects/:id` 사양 수정(관리자 재견적 D17)·`/refund`(과입금 환불 기록)·force-delete 배치 프리뷰(D13/D14).

**주문·회원·설정**: `admin/orders`(상태 전이·force-status·`refund`·**배송방법** `parcel|quick_cod|pickup|direct`·엑셀 택배 전용·notify 게이트) · `admin/members` · `admin/settings`(사업자·거버가격·**AI**: `settings/ai`·`/test`·`/models`·`/jobs`·BOM 견적·`partner_parts`) · `admin/seo`·`slides`·`digikey/oauth/*`.

**마켓·AI·개발의뢰**: `market-*`(+ `PATCH /projects/:id`·`GET :id/revisions` 수정 이력 09-05) · `GET /ai/market.dev-review/status`·`POST /ai/market.dev-review/run`(multipart, 검토서+구성도 병렬 잡)·`GET /ai/jobs/:id`·`/ai/develop.followup/*` · `develop/requests`(회원 17종: 등록·첨부·취소·수락/거절·문의·checkout·검수·확인 요청 응답) · `admin/develop/{requests,quotes,milestones,documents,tasks,settings}`(워크큐 탭 `intake`·`contract`+`signal`, AI 3층 편집·버전 원장·문서 5종·업무표). 오류 봉투: 회원 `{result:false,error}` · 관리자 `ApiError`.

**서버 가드 코드 사전**(앱 가드, 스키마 무변경 — "잠김→정리→열림" 순환):

| 코드 | 자리 | 뜻 |
|---|---|---|
| `PO_ISSUED` / `RFQ_NOT_SELECTED` | PCB 선정 해제 / 발주 생성 | 발주가 있으면 해제 불가 / 미선정 회신을 근거로 발주 불가 |
| `HAS_REMITTANCE` / `IN_SHIPMENT` / `DOC_LOCKED` | 발주 삭제·수정 / 첨부 삭제 | 송금 기록·발송 소속·preparing 아닌 발송이면 409(정리 후 열림) |
| `RECEIVE_REQUIRED` | BOM·PCB 국내 선적 delivered | 입고확인 없는 종결 금지 |
| `ORDER_CANCELED` | 취소 주문의 새 작업 전부 | 전진만 막고 정리는 연다 |
| `PAID_ORDER`·`SHIPMENT_EXISTS`·`SHARED_ORDER` | Case 강제 삭제 | `forceDeleteAll` 체크로 전부 해제 가능(D14) |
| `IN_CART`·`ORDERED`·`REQUOTE_RFQ_IN_CART` | 확정가·사양 수정 | 판매가 불변 / 담긴 견적을 rfq 사양으로 못 바꿈 |
| `NOT_EDITABLE`·`LOCKED_UNTIL_PAID`·`REVIEW_STALE`·`USECASE_DISABLED` | 마켓·개발의뢰·AI | 수정 창 밖 / 잔금 전 산출물 / 검토서 원천 불일치 / 유스케이스 꺼짐 |

## Data [coverage: high — 15 sources]

**Prisma 78 모델, 마이그레이션 84개(추가 전용 `migrate deploy`)** — 그누보드와 같은 DB. 07-27 기술한 견적·BOM 견적·분석·검색 원장·part·market·seo·config 모델은 유지되고 아래가 추가됐다:

- **파트너 6종**: `sp_partner`(type partner\|supplier\|house · capabilities `bom_rfq|pcb_rfq|part_sale` · `defaultCurrency`+`inputCurrency` · country) / `sp_partner_member`(mbId 조인 키, 1계정=1조직 운영) / `sp_partner_relation`(MD 2단, settlementCurrency) / `sp_partner_part_upload`(회차, `previewJson` 표본 200행만)·`sp_partner_part`(재고표 1행, `mpnRaw` 보존)·`sp_partner_part_key`(canonical\|alternative 조회 키 전부, FK 없음)
- **BOM 협력 15종**: `sp_bom_rfq`/`_item`(quote×조직×경로, source manual\|api) · `sp_bom_po`/`_item`(**박제 문서**, 선적 참조 없음 D13)·`_shortage`(D31 잔량 대체발주) · `sp_bom_shipment`/`_po`(1:N 조인이 소속의 진실)/`_item` · `sp_bom_part_package`/`_event`(QR token≠권한) · `sp_bom_receiving_scan`(D42 미매칭도 기록) · `sp_bom_claim`/`_item`/`_event`(D37, activeKey unique) · `sp_bom_quote_item_review`(관리자 확인 fingerprint)
- **PCB 협력 11종**: `sp_pcb_rfq`(spec×협력사×parent×회차 UK, 통화 6컬럼+MD source_*+매직링크) · `sp_pcb_po`(status 가 EQ 5단계 머신 겸용 `issued→eq_requested→eq_done→producing→produced`, `fulfillmentMode self|delegated`, `eqHistory` Json) · `sp_pcb_eq_review`(고객 확인 별도 축) · `sp_pcb_remittance`(발주서 1:N, FK 필요라 공용화 거부) · `sp_pcb_as_case`(reorderRound 는 proceed 시 부여) · `sp_pcb_claim`/`_event` · `sp_pcb_shipment`/`_po`(receiverKind admin\|md) · `sp_pcb_package`/`_event`
- **횡단**: `sp_delete_audit`(subjectType+subjectId, FK 없음 — `sp_bom_case_delete_audit` 승계) · `sp_mail_template`·**`sp_mail_log`**(kind·refType/refId·channel·status sent\|failed\|skipped·body 는 quick_mail 만) · **`sp_ai_job`**(useCase·mbId·inputHash·resultJson, 인메모리 대체) · `sp_market_project_revision`(수정 직전 스냅샷) · **개발의뢰 8종** `sp_develop_request`(검토서 3층 draft/현재/공개+`requestMode`+일정 3컬럼)·`_review_version`·`_event`·`_quote`/`_quote_item`·`_milestone`(paymentKey=io_id)·`_settings`·`_document`(5종·승인형)·`_task`(업무표 11행 기본)
- **g5 접근 카탈로그 ①~㉑**: ⑳ 배너 + **"한정 예외 ⑳" PCB 주문 워크큐 SQL 조인**(같은 번호 이중 사용, read-only) · ㉑ `sp-develop-svc` 앵커. 신규 쓰기: 환불 기록(`od_refund_price`·`od_mod_history` append — 돈은 안 보낸다) · 카트행 취소류 ⑮·임의 전이 ⑯ · `purgeOrderRows`(강제 하드 삭제 일반화) · `od_delivery_method` 병용 라벨 기록. **`'삭제'` cart 행은 없는 것으로 본다**(여정 34호).
- **`sp_config` 키**: `gerber_price_mode`·`ai_base_url/ai_api_key/ai_vision_model`·`bom_quote`(+`storedPartPrioritySearchEnabled`)·`bom_estimate_contact`·`bom_quote_exchange_rate_usd`·`pcb_exchange_rate_cnh`·`mail_log_retention_days`(180)·`partner_parts`·DigiKey 토큰·`home_slides`.
- **환경변수 추가**(.env.example 밖 포함): `DIGIKEY_CLIENT_ID/SECRET/OAUTH_REDIRECT_URI`·`MOUSER_ORDER_API_KEY/BASE_URL`·`PRICING_DATA_URL`·`SVC_BOM_MB_ID`·`DEVELOP_FILE_SERVICE_TYPE`·`MARKET_FILE_SERVICE_TYPE`·`BOM_SHIPMENT_FILE_SERVICE_TYPE`·`MIGRATE_PROTECTED_MB_IDS`·`MIGRATE_TMP_DIR`·`PARTS_IT`·`DB_SNAPSHOT_INTEGRATION`·`MIGRATION_RESET_INTEGRATION`.
- **스크립트**: `db:prepare|snapshot(backup|inspect|restore)` · `migrate:gate|dry|run|files|sync|verify|wipe|reset-data` · `pricing:sync|capture` · `parts:catalog|catalog-prices|catalog-market-prices|reindex|refacts|merge-mfr` · `backfill:partner-catalog` · `smartbom:seed-partners|audit-shipment-modes` · `market:seed[-anchor]`·`develop:seed-anchor|g-rollback` · `bom:verify`.

## Key Decisions [coverage: high — 30 sources]

- **2026-09-16 — 설정 보존 전체 업무 데이터 초기화 + admin 도 레거시 정본으로 이관**: `migrate:reset-data`(기본 미리보기, `--yes --confirm-database`)는 전체 백업+SHA-256 검증 성공 뒤에만 g5/sp 업무 행을 비우고 설정·고정 결제 상품 7개·`_prisma_migrations` 를 보존한다(정책 정본 `reset-data-policy.ts`, 분류 못 한 테이블은 중단). `migrate:wipe` 는 대체가 아니다. 증분도 admin 을 기본 보호하지 않는다(`kpeter`·`MIGRATE_PROTECTED_MB_IDS` 는 유지) — [legacy-production-reimport](../../docs/legacy-production-reimport.md)
- **2026-09-11 — 실행·배포 전 DB 스냅샷과 시점 원복**: `pnpm dev`·`deploy.sh` 가 미적용 migration 앞에서 자동 백업. 복원은 회원·주문까지 통째로 시점 이동이라 코드 원복과 짝. 대형 BOM JSON 때문에 `max_allowed_packet` 사전 검사. 같은 날 개발의뢰 문서 8종→5종 간소화(§13.6).
- **2026-09-10 — 개발 프로토타입 G 제거, C 를 「개발」정본으로**: 경로 `/api/develop`·`/api/admin/develop` 원복. G 에서 채택한 규칙 = 수동 청구 열기(`milestone_opened`)·납품확인서 자동 동기화·업무표 낙관적 잠금·큐 URL 보존.
- **2026-09-05 — 개발의뢰 = 마켓과 테이블 분리·관리자 주도 AI·마일스톤 영카트 결제**: 공개 목록 쿼리에서 필터 하나 빠지면 비공개 의뢰가 새기 때문에 `sp_develop_*` 분리. 결제는 마켓 ⑲ 동형의 앵커 ㉑ + lazy 승격(`ensureDevelopLazy` — paid·자동확정·견적 만료를 조회 시점에). 같은 날 마켓 **의뢰 수정·버전**: 입찰 유무 무관 수정 허용, `sp_market_project_revision` 스냅샷, 중대 수정+24h 미만이면 마감 48h 연장, `DEV_REVIEW_ATTACHED`(409) 폐지 → `devReviewStale` 배지.
- **2026-08-28 — AI 산출물 "사전 검토서 1건" + AI 잡 인메모리 → `sp_ai_job`(DB)**: 4산출물·80문항 인터뷰·선분석·provenance 폐기, 프롬프트는 코드 정본(관리자는 토글·모델·추가 지침만), 2단 파이프라인(비전 판독→주모델), 후처리 규칙이 정확도 담보. 등록은 `devReviewJobId` 만 보내고 서버가 소유자·done·inputHash 대조. sp-rnd 삭제. 09-04 v3: 분야 레지스트리 5종·정밀 구성도 비동기 큐(kimi-k3 thinking high). ⚠ 07-12~16의 인터뷰 파이프라인 결정은 **대체됨**([AI_DIAGRAM](../../docs/AI_DIAGRAM.md) 은 경위 기록).
- **2026-08-27 — 사내 서비스 BOM API 는 라우트 복제 없이 서비스 액터 주입**: 같은 플러그인을 `/api/svc` 에 재등록, 접근 통제는 nginx allow/deny(코드 아님). `SVC_BOM_MB_ID` 회원은 선점용으로 만들 것. 같은 날 협력사 회신 MOQ↔회신수량 동기·실효 수량 단일 공식(§6.38), 단일검색 Distributor 에 협력사명 공개(P5).
- **2026-08-23 — 협력사 보유 부품 = 별도 원장(정본) + 카탈로그 파생 투영(하이브리드)**: 처음 결정(P1 별도 원장만)을 같은 날 재결정 — 실공급사 결과는 검색마다 카탈로그에 쌓이는데 협력사만 밖에 살면 소스마다 부품 위치가 갈린다. `supplier='partner'`, SKU 접두=소유권, `resolvePartFacts` 다수결에서 제외, 가격 없음→자동 선정 불가·"협력사 보유" 배지. 만료·RFQ 제한 없음(관리자 뒤처리 도구). 같은 날 포털 R3 사이드바 셸.
- **2026-08-22 — Mouser 고정 CartKey 재충전(D41) / DigiKey 3-legged OAuth + ECIA 라벨 로컬 파싱(D42)**: API 카트≠웹 장바구니·하루 뒤 비워짐 실측 → 행 단위 대조 + csv 우회로. Barcoding API 는 2-legged 로 401 → 관리자 연결·토큰 `sp_config`·환경별 각자.
- **2026-08-17 — 배송방법은 신설 컬럼 + 한글 라벨 병용(B안)**: `od_delivery_method`(varchar 코드, `''`=택배)와 `od_delivery_company` 병용으로 영카트 /adm·메일 치환·고객 화면이 0줄 수정 호환. 비택배는 `od_invoice=''` 강제, 엑셀은 택배 전용. **DDL 은 `migrate:sync` 가 나르지 않는다 — 운영 수동 실행 후 배포**. 같은 날 메탈마스크는 EQ 대신 문의(선택)+좌표파일(category 파생 track, status 포크 없음).
- **2026-08-16 — 오류 응답 스키마는 봉투형+sensible 표준형 union**: `reply.conflict()` 409 가 직렬화에서 막혀 500 으로 뒤바뀌던 결함(부하는 트리거일 뿐). 축퇴 행도 `orderQty` 재도장. 운송수단 축(항공/해상·AWB/B/L) D39.
- **2026-08-10~11 — 재작업 가드 6종 신설(잠김→정리→열림) + 여정 33호 미결 3건**: ① EQ 첨부는 **누적 유지+최신 표시**(`isLatest`·`afterReject`, 최신 판정은 fileId) ② 과입금은 **환불 기록 창구만**(`od_refund_price` 가 이미 미수 산식에 있어 새 컬럼 불필요, 코어와 값 공유) ③ 송금 완납 통지는 **잔액 0 달성 1회**(`sp_mail_log kind='pcb_remit_settled'` 조회가 근거, 발주서별 프로세스 내 직렬화). W6 = 주문 후 사양 수정 허용+주문행 `ct_option` 만 동기. 부분 취소는 ct_status 미참조라 협력 트랙을 안 막는다(10호). LIKE escape 누락 교정(24호). 협력사 정지 판정 축 = "멤버 존재 ∧ 조직 승인"(13호).
- **2026-08-07 — 가격 계산은 라이브 가격표를 그대로 쓴다(D18): 번들 스냅샷 → 계산 직전 fetch 전환**(실측 최대 10% 어긋남). 골든은 번들로 결정론 유지, `priceVersion='live-<날짜>'`. `POST /api/pcb-pricing` 드롭인(P4.5). **EQ 고객 확인은 별도 축·메일에 승인 버튼 금지**(보안 게이트웨이 자동 GET — 링크는 화면만, 결정은 POST; 회원 주문만; 공개 파일은 관리자 선택분). **사양 수정=재견적**(새 `sp_quote` 발급, 차단은 `PO_ISSUED`·`REQUOTE_RFQ_IN_CART` 둘뿐, 확정가는 `finalPriceStale` 로 알리기만). **전 채널 발송 이력 원장 `sp_mail_log`**(기록은 부수 원장이지 발송 조건이 아니다, 래퍼 3종 자동, 재발송은 quick_mail 만, retention 180일).
- **2026-08-06 — 삭제 차단 전면 해제(D14)·감사 원장 공용화(D13)·송금은 원장(D15)**: `forceDeleteAll` 체크로 `PAID_ORDER`·`PO_ISSUED`·`SHIPMENT_EXISTS`·`SHARED_ORDER` 전부 해제, `mode:'reset'` 무기록. 코어 `deleteUnpaidOrder` 의 SQL 박힌 가드 때문에 `purgeOrderRows` 로 일반화. `sp_delete_audit` = subjectType 중립화(트랙 접두 없음). 송금은 상태 한 칸이 아니라 `sp_pcb_remittance` 원장(통화=발주 통화 강제, KRW 환산은 송금 시점 환율 별도 박제).
- **2026-08-05 — 워크큐 첫 탭=대기 큐·배지=대기+내 차례 합산, 대기 큐에서 레거시 이관분 제외(D12)**: 제외 안 하면 요청 대기 330·발주 대기 195건이 영구히 눌러앉아 실제 6·5건이 묻힌다. **파일 전면 미이관**(거버·첨부 — 소급은 `migrate:files --sideload --relink`).
- **2026-08-04 — PCB 파트너 트랙 결정 D1~D8**: MD 1차 포함 · KRW+USD+CNY 전부 · EQ 승인 관리자만 · 영문 코드+계약 라벨 · 직송 포함 · od 상태 자동 동기 1차 수동 · 레거시 워크플로 데이터 미이관 · 회수 자료 커밋([legacy-smartbom](../../docs/legacy-smartbom/README.md)). 문법 전환 3 = 앵커 `it_id`→`specId` · 소급 전파→선확정(RFQ 는 확정가 앞단) · 프론트 신뢰→서버 인가. **phase 06 미주문 견적 이관**(`ctId=NULL`, 앵커 `uuidV5('cart:'+ct_id)`, ⚠ 앵커 집합을 `ctId IS NULL` 로 좁히면 중복 삽입).
- **2026-07-29~08-02 — SmartBOM 파트너 모델 D1~D17·2차·3차**: `sp_bom_quote` 단일 척추(견적서 복제 없음) · `sp_partner` 조직/계정/자동화 3축(가짜 회원 없음, 공급사 추가=데이터 1행) · 공급사는 RFQ 로 물질화하지 않고 후보·구매 조건 원장 파생 · 협력사에 목표단가 미노출 · 코드 사전은 계약(한글 리터럴 금지) · 견적 통째 1카트행 ×1.1, 같은 트랙끼리만 배치 · 발주서=박제 문서+paid 게이트 · 선적 경량 모델(발주 스키마 무참조)+핑퐁 서버 인가 · 매직링크 · 역할별 워크큐 · Case 영구 삭제 2단계. 레거시 교훈 가드: manual 불가침·GET 무부작용·상태 계층 분리.
- **2026-07-26 이전**(07-27 컴파일 기록 유지): 자체 카탈로그 부품 유형 선조회+문의 견적(07-26) · 대량 삭제는 가드 문장 청크(07-24, P2028) · 인메모리 소실은 영속 원장으로(07-21~23) · 기술·조달 판단 단일 소유권=sp-engine(07-20~21) · 분석 append-only(07-20) · 스냅샷 박제+서버 재계산+RFQ 모델(07-19~20) · DB=진실·ES=파생(07-18~19) · spec JSON 피벗·결정적 렌더(07-15) · AI 범용 유스케이스 계층/마켓 결제 영카트 재사용(07-08~13) · 코어 비수정+스냅샷 모델+접근 카탈로그(07-02~07).

## Gotchas [coverage: high — 18 sources]

- ⚠ **`prisma migrate reset`·공유 DB `migrate dev` 금지**(g5_* 전멸). `migrate:reset-data` 도 DB DROP 이 아니라 행 삭제이며 TRUNCATE 는 트랜잭션으로 안 돌아온다 — 출력된 "검증된 전체 백업" 경로를 기록. 복원 전 `max_allowed_packet` 부족(개발 1MB)이면 DB 교체 전에 거부된다.
- ⚠ **Fastify 훅을 동기 `void` 로 두면 요청이 영구 hang**(`done` 미호출·비 thenable) — 서비스 액터 훅에서 실제 재현, tsc·eslint 는 통과한다. `Promise<void>` 를 반환할 것.
- ⚠ **같은 상태 코드의 두 오류 형태**: 응답 스키마가 봉투형만 선언하면 `reply.conflict()` 가 500 으로 뒤바뀐다(`FST_ERR_FAILED_ERROR_SERIALIZATION`). 연속 조작(e2e 포함)은 `buildStatus==='ready' && enrichStatus!=='searching'` 을 기다려야 정당한 409 를 안 맞는다.
- ⚠ **MySQL 패킷 한도는 표본 픽스처로 못 잡는다**: 재고표 12,175행 결과 JSON 6.36MB 를 `previewJson` 에 넣자 연결 절단(`Server has closed the connection`→화면 `BOM_ENGINE_ERROR`). 표본 200행만 저장, 커밋은 보관 원본 재실행. 대형 후보 저장 20건 배치(07월)와 같은 계열.
- ⚠ **Mouser API 카트는 웹 장바구니가 아니고 GET 은 없는 키에도 빈 카트 200** — "빈 카트"는 존재 증명이 아니다(행 대조로 본다). **DigiKey refresh 토큰은 회전**하므로 로컬/운영이 한 토큰을 나누면 한쪽이 끊긴다. Barcoding 2-legged 는 401.
- ⚠ **`od_delivery_method` DDL 은 수동**(`SET SESSION sql_mode=''` 필요, DDL 먼저·배포 나중 — 미적용이면 목록 SELECT 가 `Unknown column`). 배송 엑셀 열 추가 금지(업로드 파서 A/I/J 고정).
- ⚠ **LIKE escape**: 검색창 `%` 한 글자가 20,805건 전체를 반환했다(PCB 큐 2곳 누락). `_` 는 파일명에 흔해 더 조용히 틀린다. raw SQL 컬럼명은 추측 금지(Prisma 필드로).
- ⚠ **워크큐 첫 탭은 대기 큐**라 방금 만든 건이 기본 탭에 없을 수 있다(pos=발주 대기·orders=입금 대기). 대기 큐는 이관분(`specJson._legacy`)을 제외한다 — 진행현황·Case 상세에는 보인다.
- ⚠ **EQ 반려와 요청취소는 같은 전이라 note 유무로만 갈린다** — 판정은 계약 `isPcbEqRejectionEvent` 하나(다섯 곳 복제가 08-16 결함 원인). 되돌리기는 note 를 남기지 않는다. `MISSING_EQ_FILES` 는 폐기(D19 — 첨부 선택).
- ⚠ **MD 하위 발주는 KRW 회계 없음**(레거시 승계), 송금 통화는 발주 통화로 강제, RFQ 통화·환율은 배정·회신·선정 시점에 행에 박제(조회 재계산 금지). `getOrderInfoByCtId.isPaid` 는 취소 헤더도 true 라 발주 게이트가 취소·완료를 먼저 닫는다.
- ⚠ **`/api/svc` 는 nginx 가 경계**(2026-08-27 기준 allow/deny 미설정). 잡당 `max_calls` 클램프(엔진 3,000)는 풀지 말 것 — 실 과금이 샌다. `prepare` 전에 엔진 잡이 사라지면 `ENGINE_JOB_GONE`(재업로드). 참조번호 개수≠수량은 오류가 아니라 `quantity_confirmation_required`.
- ⚠ **AI**: 스트리밍 필수(비스트림 undici ~300s), ollama.com 직결 태그에 `:cloud` 접미 없음(`qwen3.5:cloud` 는 존재하지 않음), `format`/`think` 4xx 면 옵션 빼고 1회 재시도, 구성도는 동시 1 큐. `.env` AI 값이 관리자 저장값보다 우선.
- ⚠ **07-27 항목 유지**: 아직 인메모리인 것 = 엔진 최초 파싱 잡·잡 소유 맵(견적 행 `engineJobId+mbId` 가 소유를 복구) · searching 중 PATCH 잠금 · 후보 v2 키 `ok2:` · 카탈로그 삭제 3경로 계약 차이(`PART_IN_USE`·필터 전건·`RESET_WITH_QUOTES`) · 제조사 별칭 비소급(`parts:merge-mfr` 되돌릴 수 없음) · ES 유령 문서(08-16 실측) · 환율 result 코드 2/3/4 오진 금지 · `_legacy` strip 필수 · mb_id ≤20자 가정 금지 · 만료 정리 배치는 `priceVersion='legacy-migration'` 제외 · 마켓·개발의뢰 paid 판정은 라인(ct_status∈PAID ∧ io_id==key ∧ io_price==amount) · E2E od_id 는 2^53 미만 · 파일 삭제 API 무인증 GET(pathToken 비노출).
- 테스트 하네스(vitest ~1,000·e2e-market 148·e2e-develop 191·PCB 여정 43편·PARTS_IT 옵트인)는 [testing](testing.md) 참조.

## Sources [coverage: high — 90 files]

문서(41):
- [AGENTS.md (루트)](../../AGENTS.md) · [AGENTS.md (모노레포)](../../samplepcb-web-mono-app/AGENTS.md) — 호칭(sp-develop 추가)·BOM 역할 경계·인증 브리지·`pnpm dev` 스냅샷 규칙
- [.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) · [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — 환경변수(DigiKey 추가)·78 모델 주석
- [walsin/README](../../samplepcb-web-mono-app/apps/api/catalog-migrations/walsin/README.md) · [walsin/prepared-prices](../../samplepcb-web-mono-app/apps/api/catalog-migrations/walsin/prepared-prices/README.md) · [walsin v2](../../samplepcb-web-mono-app/apps/api/catalog-migrations/walsin/prepared-prices/v2/README.md) · [yeonho/README](../../samplepcb-web-mono-app/apps/api/catalog-migrations/yeonho-connectors-2026-07-17/README.md) · [yeonho/prepared-prices](../../samplepcb-web-mono-app/apps/api/catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/README.md) · [yeonho v2](../../samplepcb-web-mono-app/apps/api/catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/README.md) — 워크북 적재·가격 스냅샷 v1/v2(국내 판매처 KRW 병합)
- [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) · [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) · [pricing-engine-parity](../../docs/pricing-engine-parity.md) · [samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md) — 담기·가격모드·`/api/pcb-pricing` 드롭인
- [BOM_QUOTE](../../docs/BOM_QUOTE.md) · [BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md) · [BOM_INGESTED_RC_EXPERIMENT](../../docs/BOM_INGESTED_RC_EXPERIMENT.md) · [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) · [bom-quote-code-review-2026-07-19](../../docs/bom-quote-code-review-2026-07-19.md) · [prompts/sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md) — BOM 견적·svc·저장 부품 우선·카탈로그·엔진 판단 계약
- [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) · [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) · [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) · [PARTNER_PARTS](../../docs/PARTNER_PARTS.md) · [legacy-smartbom/README](../../docs/legacy-smartbom/README.md) — 협력 트랙 정본 4종+회수 자료
- [MAIL_LOG](../../docs/MAIL_LOG.md) · [DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md) · [DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md) · [order-notify-gating](../../docs/order-notify-gating.md) · [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md) · [LOCAL_MAIL_TESTING](../../docs/LOCAL_MAIL_TESTING.md) · [review-naming](../../docs/review-naming.md) · [DB_TUNING](../../docs/DB_TUNING.md)
- [MARKET_FLOW](../../docs/MARKET_FLOW.md) · [AI_DIAGRAM](../../docs/AI_DIAGRAM.md)(대체됨) · [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md) · [prompts/dev-review-phase3-backend](../../docs/prompts/dev-review-phase3-backend.md) · [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md)
- [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md) · [legacy-production-reimport](../../docs/legacy-production-reimport.md) · [db-snapshot-rollback](../../docs/db-snapshot-rollback.md)

코드(49, 경량 스캔 — 헤더 주석·등록·키):
- [server.ts](../../samplepcb-web-mono-app/apps/api/src/server.ts) · [package.json](../../samplepcb-web-mono-app/apps/api/package.json) · [plugins/auth.ts](../../samplepcb-web-mono-app/apps/api/src/plugins/auth.ts) · [lib/g5-db.ts](../../samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts) · [lib/service-actor.ts](../../samplepcb-web-mono-app/apps/api/src/lib/service-actor.ts) · [lib/sp-config.ts](../../samplepcb-web-mono-app/apps/api/src/lib/sp-config.ts)
- [pricing/live-pricing.ts](../../samplepcb-web-mono-app/apps/api/src/pricing/live-pricing.ts) · [routes/pcb-pricing.ts](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-pricing.ts) · [routes/pcb-projects.ts](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-projects.ts) · [routes/admin-pcb-projects.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-projects.ts) · [routes/admin-orders.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-orders.ts)
- [routes/bom.ts](../../samplepcb-web-mono-app/apps/api/src/routes/bom.ts) · [routes/bom-quotes.ts](../../samplepcb-web-mono-app/apps/api/src/routes/bom-quotes.ts) · [routes/bom-quotes.biz-error.test.ts](../../samplepcb-web-mono-app/apps/api/src/routes/bom-quotes.biz-error.test.ts) · [lib/bom-engine-jobs.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-engine-jobs.ts) · [lib/bom-rfq.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-rfq.ts) · [lib/bom-po.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-po.ts) · [lib/bom-order.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-order.ts) · [lib/bom-case-delete.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-case-delete.ts) · [lib/supplier-order.ts](../../samplepcb-web-mono-app/apps/api/src/lib/supplier-order.ts) · [lib/bom-po-external.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-po-external.ts) · [lib/digikey-oauth.ts](../../samplepcb-web-mono-app/apps/api/src/lib/digikey-oauth.ts) · [lib/bom-receiving.ts](../../samplepcb-web-mono-app/apps/api/src/lib/bom-receiving.ts) · [lib/partner-parts.ts](../../samplepcb-web-mono-app/apps/api/src/lib/partner-parts.ts) · [routes/partner-access.ts](../../samplepcb-web-mono-app/apps/api/src/routes/partner-access.ts)
- [lib/pcb-rfq.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-rfq.ts) · [lib/pcb-po.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-po.ts) · [lib/pcb-remittance.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-remittance.ts) · [lib/pcb-shipment.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-shipment.ts) · [lib/pcb-eq-review.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-eq-review.ts) · [lib/pcb-as-case.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-as-case.ts) · [lib/pcb-claim.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-claim.ts) · [lib/pcb-case-delete.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-case-delete.ts) · [lib/pcb-case-step.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-case-step.ts) · [lib/order-progress.ts](../../samplepcb-web-mono-app/apps/api/src/lib/order-progress.ts) · [lib/exchange-rate.ts](../../samplepcb-web-mono-app/apps/api/src/lib/exchange-rate.ts) · [lib/mail-log.ts](../../samplepcb-web-mono-app/apps/api/src/lib/mail-log.ts)
- [lib/ai/usecases.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/usecases.ts) · [lib/ai/jobs.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/jobs.ts) · [lib/ai/runner.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/runner.ts) · [lib/ai/dev-diagram-runner.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/dev-diagram-runner.ts) · [routes/ai.ts](../../samplepcb-web-mono-app/apps/api/src/routes/ai.ts) · [lib/develop-payment.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-payment.ts) · [lib/develop-review-versions.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-review-versions.ts) · [routes/admin-develop-requests.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-requests.ts) · [routes/develop-requests.ts](../../samplepcb-web-mono-app/apps/api/src/routes/develop-requests.ts)
- [lib/db-snapshot.ts](../../samplepcb-web-mono-app/apps/api/src/lib/db-snapshot.ts) · [scripts/migrate/reset-data.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/migrate/reset-data.ts) · [scripts/migrate/wipe-test-data.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/migrate/wipe-test-data.ts)
