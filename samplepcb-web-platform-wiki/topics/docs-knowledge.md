---
topic: docs-knowledge
last_compiled: 2026-07-20
sources_count: 20
status: active
---

# docs-knowledge

## Purpose [coverage: high — 20 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 2026-07-13 시점 17개에서 **3개 추가**(BOM_QUOTE·PARTS_SEARCH 정본 2종 + BOM 견적 코드리뷰 기록)로 20개가 됐고, AI_DIAGRAM/MARKET_FLOW 는 위저드 v2(AI-우선 4스텝)로, DEPLOY_CENTRAFAB 은 rnd 앱 추가로 갱신됐다. 네 층으로 나뉜다:
- **설계 서사(단일 설명원본)** — GERBER_ORDER_FLOW · MARKET_FLOW · AI_DIAGRAM · **BOM_QUOTE(신규)** · **PARTS_SEARCH(신규)** · SEO_MANAGEMENT · GERBER_PRICE_MODE
- **운영 절차·런북** — DEPLOY_CENTRAFAB · LEGACY_DB_MIGRATION · pricing-engine-parity · UPSTREAM_SYNC · LOCAL_MAIL_TESTING
- **정책·결정 기록** — order-notify-gating · wishlist-hidden · review-naming · AI_WORKFLOW_PLAYBOOK
- **참조 스냅샷·조사·리뷰 기록** — bom-quote-code-review-2026-07-19(신규) · samplepcb-pricing-api-body-cases · LEGACY_SITE · DELIVERY_CARRIER_INTEGRATION

이 문서는 각 문서가 무엇을 다루고 언제 읽어야 하는지의 안내 지도다.

## Architecture — 문서 지도 [coverage: high — 20 sources]

### 설계 서사 (단일 설명원본)

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니→관리자 관리 전체. 코어 무수정 기법 카탈로그 11종, 인증·알림 브리지, **g5 접근 카탈로그 ⑤–⑲**, 데이터 소유권, 관련 파일 색인 | 2026-07-08 | 주문 플로우·cart·`sp_*`·g5 접근·spcb 를 건드리기 전 필독 |
| [BOM_QUOTE.md](../../docs/BOM_QUOTE.md) | **고객 스마트 BOM 견적 정본**(레거시 spSmartBomV2 재설계 재구현). `/app/bom`(회원 전용)→sp-engine 파싱→시트 선택 build→카탈로그 1차 매칭→**조용한 자동 보강**(enrichStatus 상태기계·비용 게이트·완료 반영 3중 경로)→**하이브리드 자동 선정**(engine-hybrid-physical-v3: 기술 1순위 기본+검증·절감 조건 가격 추천)→견적요청(서버 재계산·동결)→관리자 회신. 후보 비교 패널·선택 감사 이력·환율 자동 갱신(수출입은행)·행 격리 렌더 최적화·Figma 셸 이식·검증 기록·2차 로드맵(결제 연계) | 2026-07-20 | `/app/bom`·`sp_bom_quote*`·bom-pricing·자동 보강·후보 선정을 만질 때. "왜 고객에게 공급사 검색이 안 보이나" |
| [PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) | **부품 카탈로그 정본** — sp-engine 발견 부품을 DB(`sp_part*` 진실원본)+ES(sp-parts-v1 파생물) 자동 인제스트. 설계 3원칙(단위 지능은 TS 코드·**스펙 2트랙**(SI range ±0.1%+specVariants prefix)·해석은 should 가산점만), 골든 74케이스=명세, **부품 정본=f(전체 오퍼)**(충돌 다수결→신뢰순위→최신, specConflicts)+samplepcb 파생 오퍼+이미지 정본, 하드 삭제/초기화, PARTS_IT=1 옵트인 | 2026-07-20 | `/app/admin/parts`·spec-units·인제스트·ES 매핑·재색인을 만질 때. "4k7 이 왜 4700 과 매칭되나" |
| [MARKET_FLOW.md](../../docs/MARKET_FLOW.md) | 재능마켓(sp-market) 단일 설명원본. 1차 매칭+2차 거래 완결(계약→결제→검수 7일 자동확정→정산), `sp_market_*` 테이블, lazy 상태머신. **위저드 v2 절 갱신**: AI-우선 4스텝(분야→설명·자료→AI 인터뷰→검토·등록), 구 기술·일정·방식 스텝 삭제, 신규 의뢰 categories·cadTools 항상 빈 배열, Step 컴포넌트+composables 분해(셸 ~170줄), AI 산출물 신선도 서명·provenance·보안 정책 요약 | 2026-07-17 (위저드 v2 동기) | `/market`·`sp_market_*`·계약/정산·위저드를 만질 때 |
| [AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) | AI 연동 정본 — 범용 유스케이스 계층(`sp_config`+`sp_ai_usecase`+`POST /api/ai/:useCase/run` 비동기 잡, stream 필수). **대폭 확장**: §6 인터뷰 파이프라인(질문 뱅크 80문항·5개씩/최대15·`selectAiInterviewQuestions` 단일 판정)+**선분석 v2 `understood` 카드**+첨부 분석 경로(multipart, 비전 `qwen3.5:cloud`, 상한 규정)+결정적 SVG 렌더러(`renderDiagramSpecHtml`, 서버 재생성)+provenance(`aiGenerationMeta` 해시 검증)+고정 보안 정책+동일 입력 캐시+Phase 2 ROC·Phase 3 포스팅 카드 | 2026-07-17 (위저드 v2·첨부 프로빙) | 새 AI 유스케이스 추가·위저드 인터뷰/구성도·첨부 분석·관리자 AI 설정을 만질 때 |
| [SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) | 페이지별 SEO 설계 정본 — 신규 `sp_seo` + 테마 head.sub.php 전역변수 매칭(옵션 B), `$it` 자동유도 기본·레코드는 오버라이드 | 2026-07-10 | SEO 메타·OG·sitemap 작업 전 필독 |
| [GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) | 거버 가격 주문가/공급가(VAT) 해석 설정 — 영카트 부가세 사실관계, 정규화는 엔진 밖, `sp_config` 신설 | 2026-07-05 | 가격이 결제액과 ×1.1 어긋날 때. `sp_config` 다룰 때 |

### 운영 절차·런북

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) | centrafab.co.kr 운영 배포 런북(Ubuntu 22.04·nginx 단독+php-fpm·Cloudflare Flexible). PHP8.1·`sql_mode=''`·pnpm 빌드·systemd sp-api·nginx 인라인. **갱신: `/rnd/`→`apps/rnd/dist` 연구용 정적 SPA 추가**(pnpm 필터·빌드 결과물·nginx location 3곳) | 2026-07-17 (rnd 앱) | 운영 서버 세우기·배포 절차·nginx/DB 설정 확인 |
| [LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md) | 레거시 실데이터 이관 절차·실증 — 96테이블 처분표(정본 manifest.ts), `migrate:gate/dry/files/run/sync/verify/wipe`, P3 그린(개방=거버 실파일) | 2026-07-09 | 이관 재실행·sync·verify 실패 조사 |
| [pricing-engine-parity.md](../../docs/pricing-engine-parity.md) | TS 가격 엔진 ↔ 레거시 PHP 계산 일치 — 드리프트 대응(`pricing:sync`→`capture`→test), differentDesign 통일 | 2026-07-03 | 가격이 라이브와 어긋날 때 1순위. 패리티 sha 불일치 |
| [LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) | 주문 메일 로컬 확인 = Mailpit 127.0.0.1:25(G5_SMTP 모드라 mailtodisk 불가) | 2026-07-05 | 주문 알림 로컬 확인. 메일이 안 올 때 |
| [UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) | 그누보드 코어 subtree 최신화 — `git subtree pull --squash`, push·config.php 금지 | (절차, 안정) | 보안 패치 수신·새 클론 셋업 |

### 정책·결정 기록

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [order-notify-gating.md](../../docs/order-notify-gating.md) | 주문 메일/SMS 체크박스 노출 게이트 — 실발송 조건(`cf_email_use`/`cf_sms_use==='icode'`)과 정합 | 2026-07-05 | 알림 체크박스. "체크했는데 안 나감" |
| [wishlist-hidden.md](../../docs/wishlist-hidden.md) | 위시 진입점 숨김→견적관리 일원화 — 토글 `SP_USE_WISHLIST`, 코어 코드 보존 | 2026-07-06 | 위시 UI 안 보이는 이유. 되살릴 때 |
| [review-naming.md](../../docs/review-naming.md) | 게시판 "고객후기" 개명(bo_subject DB 데이터) + 별점후기 `/reviews` 신설 + 홈 쇼케이스 | 2026-07-10 | 후기 명칭·`/reviews`·홈 하단 |
| [AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md) | 작업 진행 방식(직접/위임/병렬) 자율 결정 기준 — 위임 품질 게이트·실증 로그 | 2026-07-05 | 규모 있는 작업 방식 결정. 위임 지시서 작성 |

### 참조 스냅샷·조사·리뷰 기록

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md) | BOM 견적·카탈로그 **코드 리뷰 시점 기록**(`5404af4..851f644`, 구현 변경 없음). P1 6건(검색 완료↔반영 비동기·클라 오퍼 신뢰·자동저장 동시성·MPN 없는 부품 누락·mbId 60자·sp-vue 정책 충돌)+P2 3건(충돌 시 자체 오퍼·스펙 그룹 순서 의존·확정가 없는 answered), 테스트 게이트 결과, 권장 처리 순서 8단계. **P1 상당수는 이후 BOM_QUOTE 에 교정 반영됨**(buildStatus·enrichStatus·서버 선정 API·라우트 정책 공식화) — 잔여는 BOM_QUOTE "알려진 한계"가 정본 | 2026-07-19 (고정 스냅샷) | BOM 견적 후속 개발 전 보완 항목 확인. 리뷰 당시 재현 근거가 필요할 때 |
| [samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 가격 API request body 실캡처 — 메뉴 7종+옵션 매트릭스 | 2026-07-03 | 레거시 body 포맷. 패리티 fixture 근거 |
| [LEGACY_SITE.md](../../docs/LEGACY_SITE.md) | 프로덕션 원본 구조·콘텐츠 스냅샷(2026-07-02) | 2026-07-02 | 현대화 기준점 확인 |
| [DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) | 택배(CJ) 연동 조사 노트 — **미결정(보류)** | 2026-07-06 | 배송처리 자동화 검토 시 |

## Talks To — 문서 간 참조 관계 [coverage: high — 14 sources]

- **BOM_QUOTE ↔ PARTS_SEARCH**: BOM 견적의 매칭·오퍼 원천이 부품 카탈로그. samplepcb 파생 오퍼는 `pickDefaultOffer` 후보에서 제외(자기 선택 순환 방지 — 양쪽 기록), 부품 이미지 정본·카탈로그 초기화 시 견적 라인 partId 만 해제(박제 보존)도 상호 서술.
- **BOM_QUOTE → bom-quote-code-review**: "알려진 한계" 절이 리뷰 기록을 후속 보완 근거로 지목. 리뷰의 P1-4(buildStatus)·P1-1(반영 동기화)·P1-6(sp-vue 정책)은 이후 BOM_QUOTE 본문에 교정으로 흡수됨.
- **MARKET_FLOW ↔ AI_DIAGRAM**: 위저드 v2·선분석·첨부 분석·provenance 가 양쪽에 동기 서술 — 정본은 AI_DIAGRAM(MARKET_FLOW 가 §6 을 명시 지목).
- **GERBER_ORDER_FLOW ↔ MARKET_FLOW**: 카탈로그 ⑲(마켓 계약 결제) 동기 서술 — 마켓 결제는 거버 담기(스냅샷 카트행)와 동형. BOM 2차 결제 연계도 같은 거버식 카트 스냅샷을 로드맵으로 지목.
- **DEPLOY_CENTRAFAB → LEGACY_DB_MIGRATION / AGENTS.md**: STEP 11 데이터 주입·통합 라우팅 위임. rnd 포함 4개 앱(`web`·`market`·`rnd`·`api`) 빌드가 배포 전제.
- **GERBER_PRICE_MODE → pricing-engine-parity**: 엔진 불변 전제 공유(정규화는 엔진 밖). **pricing-engine-parity ↔ body-cases**: 순환 참조 쌍.
- **SEO_MANAGEMENT → review-naming**: sp-php 가 `sp_*` 직접 SELECT 하는 선례·"관리=sp-vue/소비=sp-php" 패턴 재사용.
- **GERBER_ORDER_FLOW ↔ order-notify-gating / LOCAL_MAIL_TESTING**: ⑬ 상태 전이 알림을 두 문서로 위임. BOM 견적요청 접수 알림도 같은 `order-notify.php` 확장으로 후속 예정(BOM_QUOTE).
- **LEGACY_DB_MIGRATION ↔ review-naming**: sp_review 61건 재처분 양쪽 기록. **AI_WORKFLOW_PLAYBOOK → HANDOFF.md**: gitignore 로컬 메모 — 영속 기록은 docs/.
- **UPSTREAM_SYNC**: "코어 비수정"이 GERBER 1장 제약의 전제. 레거시 소스는 로컬 `D:\work\workspace_other\samplepcb_php` 직접 읽기.

## API Surface [coverage: medium — 7 sources]

문서군 자체는 API 를 노출하지 않지만 계약을 정의·기록한다:

- **BOM_QUOTE**: 회원 `/api/bom`(업로드·prepare·build·후보 조회·selection·catalog-match·request·잡 프록시 — 소유 회원만 404 은닉·일일 한도 429) + 관리자 `/api/admin/bom-quotes`(전이 검증·확정가·원본 스트리밍) 정본. 가격·수량 규칙은 `@sp/utils` bom-pricing(서버·FE 동일 함수, 골든 14).
- **PARTS_SEARCH**: `GET /api/admin/parts/search`(다중해석 쿼리 빌더, ES 다운 503)+`/:id`(DB 상세)+`POST /parts/reset`. 계약 `packages/api-contract` parts.ts.
- **AI_DIAGRAM**: 범용 `POST /api/ai/:useCase/run`+잡 폴링, `preanalyze-questions`·`run-with-attachments` multipart 변형, 질문 뱅크 `AI_INTERVIEW_QUESTIONS` 정본.
- **GERBER_ORDER_FLOW 2·3·5장**: sp-node REST 표면·브리지 계약(me.php·order-notify.php) 정본. **MARKET_FLOW**: market 라우트·코드 사전 정본. **order-notify-gating**: notify-config 계약 근거. **body-cases**: 레거시 가격 API 사실상 요청 스키마.

## Data [coverage: high — 9 sources]

- **BOM 견적**: `sp_bom_quote`(+buildStatus·enrichStatus·예상 스냅샷·환율 스냅샷)·`_item`(orderQty 박제=단일 진실·matchEvidence·selectedOffer 박제)·`_candidate`(제조사+MPN 후보 스냅샷 — 엔진 잡 소멸 대비)·`_selection_event`(선택 감사)·`_sheet`. 원본 파일=파일서버 serviceType `bom`+`sp_file`. xpse 의 sp_bom_document 와 무관(별도 DB).
- **부품 카탈로그**: `SpPart`·`SpPartOffer`·`SpPartPriceBreak`·`SpPartIndexQueue`(DB=진실원본) + ES `sp-parts-v1`(alias sp-parts, 재구축 가능). upsert 키 part=(mpnNorm,manufacturerNorm). BOM 매칭 문맥은 저장 안 함(사실 데이터만).
- **sp_config 확장**: `bom_quote` 네임스페이스(운송료·관리비·환율 방식·안전계수·검색 한도·신선 임계)+`bom_quote_exchange_rate_usd` 캐시 — GERBER_PRICE_MODE 가 신설한 key-value 의 재사용.
- **마켓·AI**: `sp_market_*` + AI 산출물(diagramHtml·diagramSpec·rocMd·postings·aiGenerationMeta — provenance 해시). `sp_ai_usecase` lazy 생성, 연결은 `.env` 우선.
- **데이터 소유권**(GERBER 5장): `sp_*`=sp-node(Prisma) 소유, g5_* 는 접근 카탈로그 ⑤–⑲. **SEO**: `sp_seo` — sp-php read-only.
- **이관**: 처분표 정본 manifest.ts, specJson `_legacy` 메타는 직렬화 시 strip 필수.
- **sp_ 테이블은 그누보드 DB 동거** — `prisma migrate reset` 금지(g5_* 드랍), 마이그레이션은 추가형 SQL→`migrate deploy`. BOM·parts 마이그레이션도 전부 additive.

## Key Decisions [coverage: high — 14 sources]

- **2026-07-19~20 (BOM_QUOTE)**: BOM 견적 데이터는 sp-node 신규 소유(xpse 브릿지 안 함) · sp-vue 에 일반(회원) 라우트 그룹 신설 — "sp-vue=관리자 전용" 전제 공식 변경 · 조용한 자동 보강(고객에 "공급사 검색" 개념 비노출, enrichStatus=서버 영속 단일 진실) · 하이브리드 자동 선정(기술 1순위 고정, 10%+500원 절감 시만 가격 추천) · 합계는 서버 재계산만이 진실·확정가는 관리자(RFQ 모델) · 1차 종점=견적요청, 결제 연계는 2차.
- **2026-07-18~20 (PARTS_SEARCH)**: DB=진실원본·ES=파생물 · 단위 지능은 애널라이저가 아니라 TS 코드 · 스펙 2트랙+해석은 should 가산점만 · 부품 정본=f(전체 오퍼)(다수결→신뢰순위→최신, 충돌은 specConflicts 기록) · samplepcb 파생 오퍼는 원천 1개 통째 복사·견적 후보 제외 · 공급사 제품 사진 직링크를 이미지 정본으로.
- **2026-07-17 (DEPLOY)**: 연구용 rnd 앱을 운영 배포에 편입(`/rnd/` 정적 SPA — web·market 과 동일 패턴).
- **2026-07-16 (AI_DIAGRAM·MARKET_FLOW)**: 위저드 v2 = AI-우선 4스텝, technical/schedule/method 스텝 삭제(신규 categories·cadTools 항상 빈 배열) · 선분석 v2 `understood`(명시 근거만 제외·부분 답변 유지) · 첨부 직접 분석(고지 후, 비전 qwen3.5:cloud).
- **2026-07-15 (AI_DIAGRAM)**: DiagramSpec→SVG 를 결정적 렌더러로 교체(서버 저장 전 재생성) · provenance 서버 검증(`aiGenerationMeta`) · 고객 자유 입력=자료(고정 보안 정책) · 동일 입력 캐시.
- **기존 유지**: 코어 비수정+스냅샷 모델+io_price 기법 · g5 접근 카탈로그(2026-07-04) · 마켓 lazy 상태머신(2026-07-08) · SEO 옵션 B(2026-07-10) · 이관 게이트+멱등(2026-07-06~09) · 위시 숨김·후기 명칭 분리 · subtree pull 단방향·config.php 금지.

## Gotchas — 기록된 실사고·함정 [coverage: high — 14 sources]

- **BOM "items 는 있는데 enrichStatus=idle" 창**: 그 창에서 조회되면 전 라인이 빨간 미매칭으로 렌더(실측 ~1.2s) — build 가 items+`searching` 을 함께 커밋해 제거. 빨간 미매칭은 done/failed 후 최종 판정에만.
- **후보 443건 단일 `createMany` 가 MariaDB 패킷 한도로 연결 절단**(실측) — 20건 단위 트랜잭션 배치로 교정. **done 뒤 카탈로그 재매칭 금지** — 엔진 검토/충돌 판정을 덮어씀.
- **카탈로그 직접 검색의 selectedOffer 는 클라 제출값**(조작 가능 — RFQ 라 이득 없음이나 결제 연계 시 서버 선택 API 통합 필수). `SpBomQuote.mbId` 60자 vs 플랫폼 191자(리뷰 P1-5, ALTER 후속). 엔진 잡·일일 검색 카운터는 인메모리(단일 인스턴스·재시작 소실).
- **스펙 오차 그룹은 입력 순서 의존**(상대 오차 비전이성 — 리뷰 P2-8) · 충돌 부품도 samplepcb 오퍼 자동 생성(P2-7 정책 미결) · 확정가 없이 answered 가능(P2-9).
- **"4700" 같은 값-토큰의 패키지 필터 오승격** — `packageVariants(c).length > 1` 게이트로 차단. 저항 무단위 `m` 은 관례상 메가. 부품 이미지는 도입 전 적재분 백필 불가(rawJson 에 없음).
- **Ollama 비스트림 호출은 undici 헤더 타임아웃(~300s) 실패** — `stream:true` 필수. LLM HTML DOM 직결=XSS(sandbox iframe+CSP). AI 잡 인메모리 — 재시작 시 소실. 구 비전 모델 `qwen3-vl:235b-cloud` 는 retired(HTTP 410).
- **differentDesign 누락 → rfq 실사고** · 가격표 스냅샷 드리프트="sha 불일치". **`de_tax_flag_use` 는 부가세 on/off 가 아니다**(꺼도 역산 무조건).
- **마켓 '부분취소'는 od_status 값이 아니다** — 라인 검증이 정본. 계약 취소 시 잔존 카트행=결제 구멍.
- **이관은 `sql_mode=''` 전제**(strict 복귀 시 그누보드 쓰기 실패) · specJson `_legacy` 메타→직렬화 500 · bo_subject 는 DB 데이터(수동 반영).
- **SEO `$_GET['it_id']` 의존 금지**(rewrite URL 에서 깨짐) · 로컬 메일 Mailpit 필수 · 같은 it_id 재담기 시 기존 행 전멸(기법 #8·#5 로 차단) · HANDOFF.md 커밋 금지 · 위임 지시서 허점은 그대로 구현된다.

## Sources [coverage: high — 20 sources]

- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md)
- [../../docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md)
- [../../docs/bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md)
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
