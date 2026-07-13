---
topic: docs-knowledge
last_compiled: 2026-07-13
sources_count: 17
status: active
---

# docs-knowledge

## Purpose [coverage: high — 17 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 2026-07-06 시점 9개에서 **8개가 추가**(AI 구성도·운영 배포 런북·거버 가격 모드·레거시 DB 이관·재능마켓·후기 명칭·SEO·위시리스트 숨김)돼 17개가 됐고, 마스터 문서 GERBER_ORDER_FLOW 는 g5 접근 카탈로그 ⑲(마켓 계약 결제)까지 확장됐다. 네 층으로 나뉜다:
- **설계 서사(단일 설명원본)** — GERBER_ORDER_FLOW(코어 무수정 기법 카탈로그 + g5 접근 카탈로그 ⑤–⑲) · MARKET_FLOW(재능마켓 1·2차) · AI_DIAGRAM(AI 유스케이스 계층+인터뷰 파이프라인) · SEO_MANAGEMENT(sp_seo) · GERBER_PRICE_MODE(부가세 해석)
- **운영 절차·런북** — DEPLOY_CENTRAFAB(운영 배포)·LEGACY_DB_MIGRATION(데이터 이관)·pricing-engine-parity·UPSTREAM_SYNC·LOCAL_MAIL_TESTING("배포하려면 / 이관하려면 / 표가 바뀌면 / 패치가 나오면 / 메일을 테스트하려면 이렇게 한다")
- **정책·결정 기록** — order-notify-gating(알림 게이트)·wishlist-hidden(위시 숨김)·review-naming(후기 명칭·/reviews)·AI_WORKFLOW_PLAYBOOK(AI 작업 방식)
- **참조 스냅샷·조사** — samplepcb-pricing-api-body-cases·LEGACY_SITE·DELIVERY_CARRIER_INTEGRATION(택배 연동 미결정 조사)

이 문서는 각 문서가 무엇을 다루고 언제 읽어야 하는지의 안내 지도다.

## Architecture — 문서 지도 [coverage: high — 17 sources]

### 설계 서사 (단일 설명원본)

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니→**관리자 관리**까지 전체. 코어 무수정 기법 카탈로그 11종(4장), 인증·알림 브리지, sp-node 담기·관리 파이프라인, **g5 접근 카탈로그 ⑤–⑲**(5장 — ⑰ 제작 8단계 선형 전이·⑱ 사업자정보·⑲ 마켓 계약 결제), 데이터 소유권, 관련 파일 색인 | 2026-07-08 (⑲ 마켓 계약 결제 카탈로그 동기화) | 주문 플로우·cart·`sp_*`·관리 API·g5 접근·spcb 를 건드리기 전 필독. "왜 코어를 안 고치고 이렇게 했나" |
| [MARKET_FLOW.md](../../docs/MARKET_FLOW.md) | 재능마켓(sp-market) **단일 설명원본**. 1차 매칭(전문가 승인→역견적/지정견적→NDA→블라인드 입찰→채택) + 2차 거래 완결(계약→영카트 재사용 결제→납품→검수 7일 자동확정→정산). `sp_market_*` 6테이블, cron 없는 lazy 상태머신(paid 승격=라인 검증), E2E 91+ | 2026-07-12 (인터뷰 Phase 3·포스팅 카드·전체서비스 입찰 403) | `/market`·`sp_market_*`·계약/정산·앵커 상품 `sp-market-svc` 를 만질 때. 마켓 상태 전이가 이상할 때 |
| [AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) | AI 시스템 구성도 자동 생성(Ollama) — **범용 AI 유스케이스 계층**(`sp_config`+`sp_ai_usecase`+`POST /api/ai/:useCase/run` 비동기 잡, stream 필수), 프로빙 확정(glm-5.2:cloud·참조 이미지 불필요), sandbox iframe 렌더(XSS), §6 인터뷰 파이프라인(질문 뱅크 13문항·spec JSON 피벗·ROC·포스팅) | 2026-07-12 | 새 AI 유스케이스를 추가할 때. 위저드 구성도/인터뷰 스텝·관리자 AI 연동 탭·Ollama 연결을 만질 때 |
| [SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) | 페이지별 SEO **설계 정본**(독립 검토 회수됨). 코어엔 cf_title/cf_add_meta 전역뿐 → 신규 `sp_seo` + 관리=sp-vue/소비=sp-php 테마 head.sub.php **전역변수 매칭(옵션 B)**·직접 DB 1쿼리, `$it` 자동유도 기본·레코드는 오버라이드, P1~P3 단계 | 2026-07-10 (설계·스키마까지, 구현 후속) | SEO 메타·OG·sitemap 작업 전 필독. cf_add_meta 를 건드리고 싶을 때(검증 태그 전용 정책) |
| [GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) | 거버 가격을 **주문가(VAT 포함)/공급가(VAT 별도)** 로 해석하는 관리자 설정. 영카트 부가세 사실관계(포함가 역산 유일·1.1 하드코딩·de_tax_flag_use 오해 교정), 정규화는 엔진 밖 `applyGerberPriceMode`, 저장소 `sp_config` 신설 | 2026-07-05 | 거버 가격이 결제액과 ×1.1 어긋날 때. 부가세·면세 품목·`sp_config` 를 다룰 때 |

### 운영 절차·런북

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) | **centrafab.co.kr 운영 배포 런북**(Ubuntu 22.04·nginx 단독+php-fpm — Apache 없음·Cloudflare Flexible). 실서버 검증 명령 STEP 1~: PHP8.1·MariaDB `sql_mode=''`·pnpm 빌드·그누보드 클린 설치→마이그레이션 주입·systemd sp-api·nginx 설정 인라인 | 2026-07-09 | 운영 서버를 새로 세우거나 배포 절차·nginx/DB 설정을 확인할 때 |
| [LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md) | 레거시(samplepcb_php) 실데이터 → 신규 DB 변환 이관의 절차·설계·실증. **운영 96테이블 전수 처분표**(정본 manifest.ts TABLE_RULES), 두 모델 차이(EAV 상품→sp_* 스냅샷·VAT 산식), `migrate:gate/dry/files/run/sync/verify/wipe`, P1~P3 verify 그린 — 개방 항목은 거버 실파일뿐 | 2026-07-09 (sp_review 재처분) | 이관 재실행·증분 sync·verify 실패 조사 시. "이 레거시 테이블 어디 갔나" |
| [pricing-engine-parity.md](../../docs/pricing-engine-parity.md) | TS 가격 엔진 ↔ 레거시 PHP 가격 API 계산 일치. 드리프트 대응 절차(`pnpm pricing:sync`→PRICE_VERSION→`pricing:capture`→test), differentDesign 통일, 레거시 실동작(eta·panel·rfq) | 2026-07-03 | 가격이 라이브와 어긋날 때 1순위. `engine.ts`·가격표·spec 키 수정 전. 패리티 "sha 불일치" 실패 시 |
| [LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) | 주문 메일(입금/배송)을 **로컬에서 실발송 없이** 확인 — Mailpit 을 `127.0.0.1:25` 에. config.php `G5_SMTP` SMTP 모드라 XAMPP mailtodisk 는 안 됨. nssm 서비스 등록, 발송 조건, 발송 경로, 트러블슈팅 | 2026-07-05 | 주문 알림을 로컬에서 확인할 때. 메일이 안 올 때 |
| [UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) | 그누보드5/영카트 코어(`samplepcb-web/`) subtree 최신화 절차. 리모트, `git subtree pull --squash`, 절대 규칙(push 금지·config.php 금지), 충돌/롤백, 새 클론 셋업 | (절차, 안정) | 보안 패치 수신·새 클론 셋업·`samplepcb-web/` 수정하고 싶을 때 |

### 정책·결정 기록

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [order-notify-gating.md](../../docs/order-notify-gating.md) | 주문 처리 메일/SMS 체크박스 **노출 게이트** sp-vue 정책. 코어 목록(무조건 노출=결함)↔상세(설정 게이트) 불일치를 통일, 실발송과 정합(`cf_email_use`/`cf_sms_use==='icode'`+de_sms_use4/5) | 2026-07-05 | 관리자 주문 알림 체크박스를 만질 때. "체크했는데 안 나감" 조사 시 |
| [wishlist-hidden.md](../../docs/wishlist-hidden.md) | 위시리스트 진입점 전부 숨김 → 견적관리(`/shop/quotes`) 일원화 결정. 근거(템플릿 it_id 공유라 견적 찜 불가·위시→카트가 껍데기), 토글 `SP_USE_WISHLIST`(기본 false·미정의 시 숨김 폴백), 코어 위시 코드는 보존 — "다시 켜기" 절차 포함 | 2026-07-06 | 위시/하트 UI 가 안 보이는 이유. 일반 카탈로그 상품 도입으로 위시를 되살릴 때 |
| [review-naming.md](../../docs/review-naming.md) | 게시판 `review` "사용후기"→**"고객후기"**(bo_subject DB 데이터 — 운영 수동 반영 필요) + 별점후기(`sp_review` 61건) 공개 페이지 `/reviews` 신설(spcb 브릿지·XSS 정제·실명 마스킹) + 홈 메인 별점후기 쇼케이스·3단 게시판 그리드 | 2026-07-10 | 후기 명칭·`/reviews`·홈 메인 하단을 만질 때. 별점후기 관리/작성 기능(후속) 착수 전 |
| [AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md) | 메인 세션이 작업마다 진행 방식(직접/Opus 위임+전수 감사/병렬 agent)을 **자율 결정**하는 실증 기반 기준. 원칙(퀄리티>비용·Fable 결정+사용자 원-체크), 방식별 특성, 위임 품질 게이트, 실증 로그 | 2026-07-05 | 규모 있는 작업의 진행 방식을 정할 때. 위임 지시서를 쓸 때 |

### 참조 스냅샷·조사

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) | 택배(CJ대한통운) 연동 **조사 노트 — 미결정(보류)**. 송장 발급·출력(굿스플로/CJ직접)·배송추적·자동완료 옵션, 현재 수동 3필드/엑셀 왕복 접점, 통합 시나리오 제안 | 2026-07-06 (조사만) | 배송처리 자동화를 검토할 때. CJ 계약 확정/배송 물량이 수동 한계 초과 시 |
| [samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 `samplepcb_pricing_api.php` request body 실캡처. 메뉴 7종 baseline + 옵션 케이스 매트릭스, hidden 필드·panel 대소문자·qty 올림 규칙 | 2026-07-03 | 레거시 body 포맷·옵션 동작. 패리티 fixture 케이스 근거 |
| [LEGACY_SITE.md](../../docs/LEGACY_SITE.md) | 프로덕션 원본(`www.samplepcb.co.kr`) 구조·콘텐츠 스냅샷(2026-07-02): 네비게이션·제품·가격표·회사정보 | 2026-07-02 조사 | 현대화 기준점(레거시 URL·메뉴·제품) 확인 |

## Talks To — 문서 간 참조 관계 [coverage: high — 12 sources]

- **GERBER_ORDER_FLOW ↔ MARKET_FLOW**: 카탈로그 ⑲(마켓 계약 결제 — 계약 카트행 INSERT·paid 라인 검증)가 두 문서에 동기 서술. 마켓 결제는 거버 담기(스냅샷 카트행)와 동형.
- **MARKET_FLOW → AI_DIAGRAM**: 위저드 "시스템 구성도"·인터뷰 스텝의 정본을 AI_DIAGRAM 으로 지목(diagramHtml·diagramSpec 저장은 MARKET 데이터 모델 쪽에 서술).
- **DEPLOY_CENTRAFAB → LEGACY_DB_MIGRATION / AGENTS.md**: 런북 STEP 11 데이터 주입이 마이그레이션 문서로, 통합 라우팅이 AGENTS.md 로 위임.
- **LEGACY_DB_MIGRATION ↔ review-naming**: g5_shop_item_use 61건 재처분(→sp_review)이 이관 처분표와 /reviews 노출 페이지 양쪽에 기록.
- **GERBER_PRICE_MODE → pricing-engine-parity**: 엔진(`engine.ts`)은 골든테스트 고정·불변이라는 전제를 공유 — 정규화는 엔진 "밖" 후처리.
- **SEO_MANAGEMENT → review-naming / 슬라이드 이관**: sp-php 가 `sp_*` 를 직접 SELECT 하는 선례(main_reviews.php·reviews.php)와 "관리=sp-vue/소비=sp-php" 패턴을 재사용.
- **GERBER_ORDER_FLOW → pricing-engine-parity**: 기법 #6(가격 이식)이 가격표 동기화·differentDesign 을 상세 문서로 위임.
- **GERBER_ORDER_FLOW ↔ order-notify-gating / LOCAL_MAIL_TESTING**: 5장 ⑬ 상태 전이의 알림이 게이트 정책·로컬 테스트를 두 문서로 위임.
- **DELIVERY_CARRIER_INTEGRATION → GERBER_ORDER_FLOW / order-notify-gating**: 배송 전이 코드(`setOrdersDelivery`·`delivery-excel.ts`)·알림 게이트를 연관 문서로 지목.
- **pricing-engine-parity ↔ samplepcb-pricing-api-body-cases**: 순환 참조 쌍(패리티 fixture 근거 ↔ 운영 절차).
- **AI_WORKFLOW_PLAYBOOK → HANDOFF.md / AGENTS.md**: HANDOFF 는 gitignore 된 로컬 메모(커밋 금지) — 영속 기록은 docs/.
- **LEGACY_SITE / UPSTREAM_SYNC**: 독립 참조 문서. UPSTREAM_SYNC 의 "코어 비수정" 이 GERBER 1장 제약의 전제. 레거시 소스 참조 시 크롤링 대신 로컬 `D:\work\workspace_other\samplepcb_php` 직접 읽기.

## API Surface [coverage: medium — 6 sources]

문서군 자체는 API 를 노출하지 않지만 계약을 정의·기록한다:

- **GERBER_ORDER_FLOW 2·3·5장**: sp-node REST 표면(담기 `/api/pcb-projects` + 관리 `/api/admin/*`)과 브리지 계약(`me.php` mbId·cartId·isAdmin, `order-notify.php` 서비스 JWT)의 정본 서술.
- **MARKET_FLOW**: `routes/market-*.ts`·`admin-market-*.ts` 표면과 코드 사전·한글 라벨 정본(`packages/api-contract/src/schemas/market.ts` `MARKET_*`).
- **AI_DIAGRAM**: 범용 `POST /api/ai/:useCase/run` + `GET /api/ai/jobs/:id` 폴링 계약, 유스케이스 레지스트리(`lib/ai/usecases.ts`)·질문 뱅크(`AI_INTERVIEW_QUESTIONS`) 정본.
- **order-notify-gating**: `AdminNotifyConfigResponse` 계약·라우트(`GET /api/admin/orders/notify-config`) 근거.
- **body-cases**: 레거시 가격 API 의 사실상 요청 스키마 문서.
- 신규 spec 계약은 `@sp/api-contract` KNOWN_SPEC_KEYS — 별칭 표는 pricing-engine-parity 정본.

## Data [coverage: medium — 7 sources]

- **데이터 소유권 / g5 접근 카탈로그** (GERBER 5장): `sp_quote`/`sp_order_spec`/`sp_file`/`sp_member_profile` = sp-node(Prisma) 소유, g5_* 는 접근 카탈로그 ⑤–⑲(민감 컬럼 SELECT 배제, cart↔spec 관계 미저장·조회 파생).
- **마켓 데이터**: `sp_market_*` 6테이블(expert·project·bid·nda_sign·settings·contract) + 첨부는 `sp_file` 폴리모픽 재사용. AI 산출물은 project 의 `diagramHtml`/`diagramSpec`(MEDIUMTEXT).
- **AI 설정**: 연결은 `sp_config`(ai_base_url·ai_api_key — `.env` 우선), 유스케이스별 설정은 `sp_ai_usecase`(lazy 생성). `sp_config` 는 GERBER_PRICE_MODE 가 신설(`gerber_price_mode`)한 sp 소유 key-value.
- **SEO**: 신규 `sp_seo`(`@@unique([scope, refKey])`) — sp-php read-only 참조. canonical 저장 원칙 아님·jsonLd 컬럼 없음($it 자동유도).
- **이관 데이터**: 처분표 정본은 `manifest.ts` TABLE_RULES. 덤프는 리포 밖 `samplepcb_dump/`. 이관 specJson 의 `_legacy` 메타(내부 id·PII)는 응답 직렬화 시 strip 필수.
- **sp_ 테이블은 그누보드 DB(samplepcb) 동거** — `prisma migrate reset`/`migrate dev` 금지(g5_* 드랍). 마이그레이션은 수기 SQL(additive) → `migrate deploy` → `generate`.
- **가격표 데이터**: 정본은 레거시 라이브 `pricing_data.json`, 엔진의 스냅샷은 동기화 대상. LEGACY_SITE 의 가격표는 2026-07-02 스냅샷. 로컬 메일은 Mailpit 인메모리.

## Key Decisions [coverage: high — 12 sources]

- **코어 비수정 + 스냅샷 모델** + **io_price 기법** — 상품은 템플릿 앵커, 주문 실체는 `sp_*`, 견적가는 옵션가 `io_price` 에. 마켓 계약 결제(⑲)도 같은 동형(io_id=contractKey).
- **가격은 서버 재계산만이 진실** · **differentDesign 통일**(2026-07-03) · **거버 가격 해석은 sp_config 전역 스위치**(order|supply, 기본 order — 정규화는 엔진 밖, 2026-07-05).
- **관리 기능은 모노레포로 점진 마이그레이션 + g5 접근 카탈로그**(2026-07-04) — "금지+예외"를 규율된 접근 카탈로그로 재정의, ⑲까지 확장.
- **마켓 상태머신은 cron 없는 lazy**(2026-07-08) — paid 승격=카트 라인 검증 단방향 래칫, 7일 자동확정=조회 시점 스윕, 마감=읽기/쓰기 동일 판정식.
- **AI 는 범용 유스케이스 계층 + 프롬프트는 DB(관리자 소유)**(2026-07-12) — 의미 변경 대신 유스케이스 추가(폴백 유지), 렌더는 sandbox iframe, 첨부 파일 외부 미전송(NDA).
- **SEO 는 신규 sp_seo + 테마 head.sub.php 전역변수 매칭(옵션 B)**(2026-07-10) — `$it` 자동유도 기본·레코드는 오버라이드, cf_add_meta 는 검증 태그 전용.
- **레거시 이관은 게이트+멱등 재실행**(2026-07-06~09) — 전 테이블 처분표 전수 대조·애매하면 중단, 거버 상품은 주문 연결분만 변환, 고아 견적 스킵.
- **위시리스트는 삭제가 아니라 숨김**(2026-07-06) · **후기 명칭 분리**(2026-07-10 — 게시판=고객후기·sp_review=별점후기) · **알림은 PHP 브리지 재사용 + 게이트는 서버 계산**(2026-07-05).
- **제작 8단계는 od_status 재사용·선형 전이**(2026-07-05) · **운영 배포는 nginx 단독(Apache 없음)·sql_mode='' 전제**(2026-07-09).
- **AI 작업 방식은 Fable 자율 결정 + 사용자 원-체크**(2026-07-04) · **택배 연동은 조사만·미결정**(2026-07-06) · **subtree pull 단방향** · **config.php 수정 금지**.

## Gotchas — 기록된 실사고·함정 [coverage: high — 12 sources]

- **differentDesign 누락 → rfq 실사고**(2026-07-03) · **가격표 스냅샷 드리프트**: 패리티 "sha 불일치" = sync 절차 누락.
- **Ollama 비스트림 호출은 undici 헤더 타임아웃(~300s)으로 실패** — `stream:true` 필수(프로빙 실측). AI 잡은 인메모리라 서버 재시작 시 소실. LLM 산출 HTML DOM 직결 = XSS(sandbox iframe 필수).
- **마켓 '부분취소'는 od_status 값이 아니다** — 행 단위 취소라 od 헤더만 보면 paid 오판, 라인 검증이 정본. 계약 취소 시 잔존 '쇼핑' 카트행은 코어 buy 경로 결제 구멍 — 정리 필수.
- **이관은 비엄격 sql_mode 전제** — strict 복귀 시 그누보드 쓰기 실패(운영 영구화 필수). 레거시 덤프 raw 주입 금지(옛 스키마) — 클린 설치 후 마이그레이션 주입. 이관 specJson `_legacy` 메타 → 응답 직렬화 500.
- **`de_tax_flag_use` 는 부가세 on/off 가 아니다**(복합과세 분리 플래그 — 꺼도 역산은 무조건). 면세 품목 추가 시 켜지 않으면 부가세 과다 계상.
- **SEO: `$_GET['it_id']` 의존 금지** — SEO-title rewrite URL 에서 깨짐, item.php 가 정규화한 `$it['it_id']` 사용. 훅 `html_process_add_meta` 는 `<title>` 텍스트를 못 바꿈(예비용만).
- **bo_subject 는 DB 데이터** — 코드 배포로 안 넘어감, 운영 관리자 화면 수동 반영 필요(review-naming).
- **로컬 메일은 Mailpit 필수**(mailtodisk 안 통함) · **알림 "노출됐는데 안 나감"**: 코어 목록은 설정 무시 노출 → 조용히 skip.
- **[선택사항수정] 선형 곱 버그** · **같은 it_id 재담기 시 기존 행 전멸** — 테마 스킨·노출 금지로 차단(기법 #8·#5).
- **파일 삭제 API 무인증** · **hidden 필드도 body 에 실린다** · **panel 과도기 값** · **HANDOFF.md 는 커밋 금지**(gitignore 로컬 메모).
- **위임 지시서 허점은 그대로 구현된다**(AI_WORKFLOW_PLAYBOOK) — 전수 감사·실브라우저 육안 필수.

## Sources [coverage: high — 17 sources]

- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md)
- [../../docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md)
- [../../docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md)
- [../../docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md)
- [../../docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md)
- [../../docs/LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md)
- [../../docs/pricing-engine-parity.md](../../docs/pricing-engine-parity.md)
- [../../docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md)
- [../../docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md)
- [../../docs/order-notify-gating.md](../../docs/order-notify-gating.md)
- [../../docs/wishlist-hidden.md](../../docs/wishlist-hidden.md)
- [../../docs/review-naming.md](../../docs/review-naming.md)
- [../../docs/AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md)
- [../../docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md)
- [../../docs/samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md)
- [../../docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md)
