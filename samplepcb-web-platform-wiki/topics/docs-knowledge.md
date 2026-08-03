---
topic: docs-knowledge
last_compiled: 2026-07-27
sources_count: 22
status: active
---

# docs-knowledge

## Purpose [coverage: high — 22 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 2026-07-20 시점 20개에서 **DB_TUNING.md 1개 추가**로 루트 21개가 됐고, `docs/prompts/` 하위 디렉토리(엔진 계약 지시서 원본)가 신설돼 총 22개다. BOM_QUOTE(+433행)·PARTS_SEARCH(+126행)는 "판단은 sp-engine·저장은 sp-node" 경계 확립과 제조사 카탈로그 편입으로 대폭 갱신됐다. 네 층으로 나뉜다:
- **설계 서사(단일 설명원본)** — GERBER_ORDER_FLOW · MARKET_FLOW · AI_DIAGRAM · BOM_QUOTE · PARTS_SEARCH · SEO_MANAGEMENT · GERBER_PRICE_MODE
- **운영 절차·런북** — DEPLOY_CENTRAFAB · LEGACY_DB_MIGRATION · **DB_TUNING(신규)** · pricing-engine-parity · UPSTREAM_SYNC · LOCAL_MAIL_TESTING
- **정책·결정 기록** — order-notify-gating · wishlist-hidden · review-naming · AI_WORKFLOW_PLAYBOOK
- **참조 스냅샷·조사·리뷰 기록** — bom-quote-code-review-2026-07-19 · prompts/sp-engine-candidate-decision · samplepcb-pricing-api-body-cases · LEGACY_SITE · DELIVERY_CARRIER_INTEGRATION

이 문서는 각 문서가 무엇을 다루고 언제 읽어야 하는지의 안내 지도다.

## Architecture — 문서 지도 [coverage: high — 22 sources]

### 설계 서사 (단일 설명원본)

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니→관리자 관리 전체. 코어 무수정 기법 카탈로그 11종, 인증·알림 브리지, **g5 접근 카탈로그 ⑤–⑲**, 데이터 소유권, 관련 파일 색인 | 2026-07-08 | 주문 플로우·cart·`sp_*`·g5 접근·spcb 를 건드리기 전 필독 |
| [BOM_QUOTE.md](../../docs/BOM_QUOTE.md) | **고객 스마트 BOM 견적 정본**(레거시 spSmartBomV2 재설계 재구현). `/app/bom`(회원 전용)→sp-engine 파싱→**분석 원문 append-only 박제**(`sp_bom_analysis_*` 안정 ID)→시트 선택 build→**조용한 자동 보강**(고객에 "공급사 검색" 비노출)→**판단 단일화**(후보 관계·선택 자격·조달 추천 전부 sp-engine — `supplier-candidate-decision-v3`+`engine-procurement-projection-v12`, sp-node 는 키·수량·금액 불변식만 검증)→견적요청(서버 재계산·동결)→관리자 회신. 검색 trace 영속·무인 복구 워커·자체 카탈로그 문의 견적·배치 재평가+행 단위 축퇴·단일 검색 `/bom/search` 하이브리드·BOM 비교 페이지형·Figma 셸·검증 기록·2차 로드맵(결제 연계) | 2026-07-26 | `/app/bom`·`sp_bom_*`·bom-pricing·자동 보강·후보 선정을 만질 때. "왜 고객에게 공급사 검색이 안 보이나" |
| [PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) | **부품 카탈로그 정본** — sp-engine 발견 부품을 DB(`sp_part*` 진실원본)+ES(sp-parts-v1 파생물) 자동 인제스트. 설계 3원칙(단위 지능은 TS 코드·**스펙 2트랙**·해석은 should 가산점만), 골든 74케이스=명세, **부품 정본=f(전체 구매 조건)**, **BOM 유형별 로컬 카탈로그 우선 조회**(R/C·커넥터는 외부 공급사 전에 자체 카탈로그) + 후보 0건 fallback, **제조사 카탈로그 적재**(`parts:catalog` yeonho 1,606·walsin-rlc 2,628 — `offer_kind='manufacturer_catalog'`+`catalogOnly`), fingerprint 증분 인제스트·제조사 키 병합(`parts:merge-mfr`)·삭제 3경로 | 2026-07-26 | `/app/admin/parts`·spec-units·인제스트·ES 매핑·재색인을 만질 때. "4k7 이 왜 4700 과 매칭되나" |
| [MARKET_FLOW.md](../../docs/MARKET_FLOW.md) | 재능마켓(sp-market) 단일 설명원본. 1차 매칭+2차 거래 완결(계약→결제→검수 7일 자동확정→정산), `sp_market_*` 테이블, lazy 상태머신. **위저드 v2 절 갱신**: AI-우선 4스텝(분야→설명·자료→AI 인터뷰→검토·등록), 구 기술·일정·방식 스텝 삭제, 신규 의뢰 categories·cadTools 항상 빈 배열, Step 컴포넌트+composables 분해(셸 ~170줄), AI 산출물 신선도 서명·provenance·보안 정책 요약 | 2026-07-17 (위저드 v2 동기) | `/market`·`sp_market_*`·계약/정산·위저드를 만질 때 |
| [AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) | AI 연동 정본 — 범용 유스케이스 계층(`sp_config`+`sp_ai_usecase`+`POST /api/ai/:useCase/run` 비동기 잡, stream 필수). **대폭 확장**: §6 인터뷰 파이프라인(질문 뱅크 80문항·5개씩/최대15·`selectAiInterviewQuestions` 단일 판정)+**선분석 v2 `understood` 카드**+첨부 분석 경로(multipart, 비전 `qwen3.5:cloud`, 상한 규정)+결정적 SVG 렌더러(`renderDiagramSpecHtml`, 서버 재생성)+provenance(`aiGenerationMeta` 해시 검증)+고정 보안 정책+동일 입력 캐시+Phase 2 ROC·Phase 3 포스팅 카드 | 2026-07-17 (위저드 v2·첨부 프로빙) | 새 AI 유스케이스 추가·위저드 인터뷰/구성도·첨부 분석·관리자 AI 설정을 만질 때 |
| [SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md) | 페이지별 SEO 설계 정본 — 신규 `sp_seo` + 테마 head.sub.php 전역변수 매칭(옵션 B), `$it` 자동유도 기본·레코드는 오버라이드 | 2026-07-10 | SEO 메타·OG·sitemap 작업 전 필독 |
| [GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md) | 거버 가격 주문가/공급가(VAT) 해석 설정 — 영카트 부가세 사실관계, 정규화는 엔진 밖, `sp_config` 신설 | 2026-07-05 | 가격이 결제액과 ×1.1 어긋날 때. `sp_config` 다룰 때 |

### 운영 절차·런북

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) | centrafab.co.kr 운영 배포 런북(Ubuntu 22.04·nginx 단독+php-fpm·Cloudflare Flexible). PHP8.1·`sql_mode=''`·pnpm 빌드·systemd sp-api·nginx 인라인. **갱신: `/rnd/`→`apps/rnd/dist` 연구용 정적 SPA 추가**(pnpm 필터·빌드 결과물·nginx location 3곳) | 2026-07-17 (rnd 앱) | 운영 서버 세우기·배포 절차·nginx/DB 설정 확인 |
| [DB_TUNING.md](../../docs/DB_TUNING.md) | **신규 — InnoDB buffer pool 튜닝 기록**. BOM 삭제 P2028 사건의 후속 인프라 레버: `sp_bom_quote_candidate` 97,985행/1.73GB 대비 XAMPP 기본 16MB 라 삭제·조회가 전부 디스크 바운드(전체 cascade 10.8초). 로컬 `my.ini`(**bin 쪽이 실제 로드 파일**) 16M→1G + `SET GLOBAL` 온라인 리사이즈(재시작 불필요). **운영 체크리스트**: 현재값 확인→사이징(DB 전용 RAM 50~70%·웹 동거면 최소 2G)→chunk_size 배수 제약→설정 파일 영속화 병행→`innodb_log_file_size`(로컬 5M) 는 재시작+클린 셧다운 필요라 보류 | 2026-07-24 | 대량 삭제·인제스트가 느릴 때. 운영 DB 파라미터 배포 전 |
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
| [AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md) | 작업 진행 방식(직접/위임/병렬) 자율 결정 기준 — 위임 품질 게이트·실증 로그. **+2026-07-22 행: 카탈로그 인제스트 최적화 후속 M1~M3 을 Opus 2워커 병렬**(같은 트리, 파일 스코프 상호배타)+감사로 수행 — 충돌 0·결함 0, 워커가 지시서 허점(테스트 파일 배치 관례)을 강행 대신 이탈 보고로 회수 | 2026-07-22 | 규모 있는 작업 방식 결정. 위임 지시서 작성 |

### 참조 스냅샷·조사·리뷰 기록

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md) | BOM 견적·카탈로그 **코드 리뷰 시점 기록**(`5404af4..851f644`, 구현 변경 없음). P1 6건(검색 완료↔반영 비동기·클라 구매 조건 신뢰·자동저장 동시성·MPN 없는 부품 누락·mbId 60자·sp-vue 정책 충돌)+P2 3건, 테스트 게이트 결과, 권장 처리 순서 8단계. **P1 상당수는 이후 BOM_QUOTE 에 교정 반영됨**(buildStatus·enrichStatus·서버 선정 API·라우트 정책 공식화) — 잔여는 BOM_QUOTE "알려진 한계"가 정본 | 2026-07-19 (고정 스냅샷) | BOM 견적 후속 개발 전 보완 항목 확인. 리뷰 당시 재현 근거가 필요할 때 |
| [prompts/sp-engine-candidate-decision.md](../../docs/prompts/sp-engine-candidate-decision.md) | **엔진 계약 지시서 원본**(`docs/prompts/` 신설) — sp-engine 후보 판단 단일화 구현 프롬프트. `decision` 계약 필드표(`selection_eligibility`·`identity_key`·`technical_evidence_key`·`lifecycle_state`), 판단 불변식(정확 MPN 은 충돌해도 `automatic`·변형/파라메트릭 충돌은 `blocked`·근거 부족은 안전 축퇴), 물리 조건(실장 방식·직경) 추출 규칙, 경계(sp-node 는 `decision` 없는 후보를 자체 규칙으로 복구 금지·sp-vue 는 재판정 금지), 필수 테스트 12종 | 2026-07-22 | `supplier-candidate-decision-v3` 의 문구 그대로의 원 계약을 확인할 때. 엔진 판정 규칙을 바꾸기 전 |
| [samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 가격 API request body 실캡처 — 메뉴 7종+옵션 매트릭스 | 2026-07-03 | 레거시 body 포맷. 패리티 fixture 근거 |
| [LEGACY_SITE.md](../../docs/LEGACY_SITE.md) | 프로덕션 원본 구조·콘텐츠 스냅샷(2026-07-02) | 2026-07-02 | 현대화 기준점 확인 |
| [DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) | 택배(CJ) 연동 조사 노트 — **미결정(보류)** | 2026-07-06 | 배송처리 자동화 검토 시 |

## Talks To — 문서 간 참조 관계 [coverage: high — 16 sources]

- **BOM_QUOTE ↔ PARTS_SEARCH**: BOM 견적의 매칭·구매 조건 원천이 부품 카탈로그. samplepcb 파생 구매 조건은 `pickDefaultOffer` 후보에서 제외(자기 선택 순환 방지 — 양쪽 기록). 카탈로그 전체 초기화는 partId·매칭·구매 조건 스냅샷 관련 BOM 견적을 강제 삭제하고, 단건·필터 삭제는 연결 부품을 보호한다.
- **BOM_QUOTE ↔ PARTS_SEARCH (2026-07-26 신설 축)**: 부품 유형별 자체 카탈로그 **우선 조회**와 `catalog-evaluate-batch` 문의 견적(`catalog_selected`/`catalog_inquiry` — 부품만 선정, 금액 없음)이 양쪽에 동기 서술. 절차·적재는 PARTS_SEARCH, 화면 표기(`선정됨 · 재고/가격 문의`)·provenance 는 BOM_QUOTE 가 정본.
- **BOM_QUOTE → DB_TUNING**: 삭제 무트랜잭션 청크 절이 buffer pool 증설을 인프라 레버로 지목하고, DB_TUNING 은 근본 과제(후보 스냅샷 다이어트)를 BOM_QUOTE 로 되돌려 지목하는 순환 참조 쌍.
- **prompts/sp-engine-candidate-decision → BOM_QUOTE / PARTS_SEARCH**: 지시서가 정한 `decision` 계약이 BOM_QUOTE "판단 단일 설명 원본" 절의 서술 근거. 문서는 요약, 지시서는 원문 계약.
- **BOM_QUOTE → bom-quote-code-review**: "알려진 한계" 절이 리뷰 기록을 후속 보완 근거로 지목. 리뷰의 P1-4(buildStatus)·P1-1(반영 동기화)·P1-6(sp-vue 정책)은 이후 BOM_QUOTE 본문에 교정으로 흡수됨.
- **MARKET_FLOW ↔ AI_DIAGRAM**: 위저드 v2·선분석·첨부 분석·provenance 가 양쪽에 동기 서술 — 정본은 AI_DIAGRAM(MARKET_FLOW 가 §6 을 명시 지목).
- **GERBER_ORDER_FLOW ↔ MARKET_FLOW**: 카탈로그 ⑲(마켓 계약 결제) 동기 서술 — 마켓 결제는 거버 담기(스냅샷 카트행)와 동형. BOM 2차 결제 연계도 같은 거버식 카트 스냅샷을 로드맵으로 지목.
- **DEPLOY_CENTRAFAB → LEGACY_DB_MIGRATION / DB_TUNING / AGENTS.md**: STEP 11 데이터 주입·통합 라우팅 위임. rnd 포함 4개 앱 빌드가 배포 전제이고, DB 파라미터는 DB_TUNING 체크리스트가 담당.
- **GERBER_PRICE_MODE → pricing-engine-parity**: 엔진 불변 전제 공유(정규화는 엔진 밖). **pricing-engine-parity ↔ body-cases**: 순환 참조 쌍.
- **SEO_MANAGEMENT → review-naming**: sp-php 가 `sp_*` 직접 SELECT 하는 선례·"관리=sp-vue/소비=sp-php" 패턴 재사용.
- **GERBER_ORDER_FLOW ↔ order-notify-gating / LOCAL_MAIL_TESTING**: ⑬ 상태 전이 알림을 두 문서로 위임. BOM 견적요청 접수 알림도 같은 `order-notify.php` 확장으로 후속 예정(BOM_QUOTE).
- **LEGACY_DB_MIGRATION ↔ review-naming**: sp_review 61건 재처분 양쪽 기록. **AI_WORKFLOW_PLAYBOOK → HANDOFF.md**: gitignore 로컬 메모 — 영속 기록은 docs/.
- **UPSTREAM_SYNC**: "코어 비수정"이 GERBER 1장 제약의 전제. 레거시 소스는 로컬 `D:\work\workspace_other\samplepcb_php` 직접 읽기.

## API Surface [coverage: medium — 8 sources]

문서군 자체는 API 를 노출하지 않지만 계약을 정의·기록한다:

- **BOM_QUOTE**: 회원 `/api/bom`(업로드·**prepare**(분석 박제)·build·**PUT sheets**(시트 제외·복원)·candidates·selection·**comparison**(페이지형)·**supplier-search**(실행 상태)·**parts-search + /supplement**(단일 검색 하이브리드)·request — 소유 회원만 404 은닉·일일 한도) + 관리자 `/api/admin/bom-quotes`(전이 검증·확정가·원본 스트리밍·읽기 전용 candidates/comparison) 정본. 가격·수량 규칙은 `@sp/utils` bom-pricing(서버·FE 동일 함수, 골든 14).
- **sp-engine 계약(BOM_QUOTE·PARTS_SEARCH·prompts 3중 기록)**: `/supplier-jobs`·`/capabilities`(런타임 안전 상한)·`procurement/reevaluate-batch`(무호출 재평가, 50 청크·상한 200)·`catalog-evaluate-batch`(외부 호출 0, 최대 200행). 버전 문자열이 계약 키 — `supplier-candidate-decision-v3`·`engine-procurement-projection-v12`·`supplier-offer-key-v2`·`supplier-search-trace-v1`.
- **PARTS_SEARCH**: `GET /api/admin/parts/search`(다중해석 쿼리 빌더, ES 다운 503)+`/:id`+`POST /parts/reset`(`confirm:'RESET_WITH_QUOTES'`)+필터 전체 삭제(미리보기 hash+`DELETE N` 확인). CLI 도 계약 표면 — `parts:catalog`·`parts:catalog-prices`·`parts:merge-mfr`·`parts:reindex`. 계약 `packages/api-contract` parts.ts.
- **AI_DIAGRAM**: 범용 `POST /api/ai/:useCase/run`+잡 폴링, `preanalyze-questions`·`run-with-attachments` multipart 변형, 질문 뱅크 `AI_INTERVIEW_QUESTIONS` 정본.
- **GERBER_ORDER_FLOW 2·3·5장**: sp-node REST 표면·브리지 계약(me.php·order-notify.php) 정본. **MARKET_FLOW**: market 라우트·코드 사전 정본. **body-cases**: 레거시 가격 API 사실상 요청 스키마.

## Data [coverage: high — 10 sources]

- **BOM 견적**: `sp_bom_quote`(+buildStatus·enrichStatus·activeAnalysisRunId·activeSupplierSearchRunId)·`_item`(orderQty 박제=단일 진실·search_requirements·selectedOffer 박제)·`_candidate`(엔진 `identity_key` 기준 후보 스냅샷)·`_selection_event`(선택 감사)·`_sheet`(selected=활성 시트 단일 진실).
- **BOM 영속화 확장(2026-07-21~23)**: `sp_bom_analysis_run/sheet/component`(엔진 `ComponentRecord` 를 변환 없이 payload 박제 — 미래 필드 보존)·`sp_bom_supplier_search_run`·`sp_bom_supplier_search_trace`·`sp_bom_supplier_daily_usage`(프로세스 메모리 카운터 → DB, 다중 인스턴스 대응)·`sp_bom_supplier_result_artifact`(공급사 원문 gzip LONGBLOB — 무인 복구 원장).
- **부품 카탈로그**: `SpPart`·`SpPartOffer`·`SpPartPriceBreak`·`SpPartIndexQueue`+`SpPartIngestRun`(fingerprint 중복·동시 실행 방지) + ES `sp-parts-v1`(alias sp-parts, 재구축 가능). upsert 키 part=(mpnNorm,manufacturerNorm)·offer=(partId,supplier,sku). BOM 매칭 문맥은 저장 안 함(사실 데이터만).
- **구매 조건 종류 분리(2026-07-26)**: `offer_kind='manufacturer_catalog'`+`catalogOnly=true` — 가격 근거 없는 제조사 카탈로그는 기술 정본·롤백 추적용이고 **구매 채널이 아니다**(패싯·`PartHit.suppliers`·`PartDetail.offers` 에서 숨김). 같은 원본의 `samplepcb` 문의 견적 채널만 노출.
- **sp_config 확장**: `bom_quote` 네임스페이스(운송료·관리비·환율 방식·안전계수·검색 한도·신선 임계)+`bom_quote_exchange_rate_usd` 캐시 — GERBER_PRICE_MODE 가 신설한 key-value 의 재사용.
- **마켓·AI**: `sp_market_*` + AI 산출물(diagramHtml·diagramSpec·rocMd·postings·aiGenerationMeta). `sp_ai_usecase` lazy 생성, 연결은 `.env` 우선. **데이터 소유권**(GERBER 5장): `sp_*`=sp-node(Prisma) 소유. **SEO**: `sp_seo` — sp-php read-only.
- **sp_ 테이블은 그누보드 DB 동거** — `prisma migrate reset` 금지(g5_* 드랍), 마이그레이션은 추가형 SQL→`migrate deploy`. 이관 처분표 정본은 manifest.ts, specJson `_legacy` 메타는 직렬화 시 strip 필수.

## Key Decisions [coverage: high — 16 sources]

- **2026-07-21~24 (BOM_QUOTE·prompts)**: **판단 단일 설명 원본 = sp-engine** — 후보 관계·선택 자격·기술 순위·조달 추천을 엔진이 결정하고, sp-node 는 정책 버전·키·수량·금액 불변식만 검증해 저장하며 재정렬하지 않는다(sp-vue 도 재판정 금지). 계약 없는/모순 후보는 **fail-closed**(옛 sp-node 규칙으로 복원하지 않음). 정확 MPN 은 필수조건이 충돌해도 `automatic`, 변형·파라메트릭 충돌은 `blocked`. 분석 원문은 append-only 박제 + 안정 ID(rowIdx 는 표시 순서일 뿐 관계 키 아님). 엔진 장애는 PATCH 실패(409)가 아니라 **행 단위 stale 축퇴**로 흡수(항상 200).
- **2026-07-26 (BOM_QUOTE·PARTS_SEARCH)**: 자체 카탈로그 **우선 조회는 공급사명이 아니라 부품 유형 기준**(R/C·connector) — 원장이 늘어도 같은 경로. 가격·재고 없는 카탈로그 부품은 가상 구매 조건을 만들지 않고 **부품 identity 만 선정**(`catalog_selected`+`catalog_inquiry`, 합계에 금액 미포함).
- **2026-07-24 (DB_TUNING)**: 후보 스냅샷 비대(근본)와 buffer pool 증설(즉효 레버)을 분리 — 스키마 변경 없이 인프라부터 적용하고, 온라인 리사이즈 + 설정 파일 영속화를 항상 쌍으로.
- **2026-07-22 (AI_WORKFLOW_PLAYBOOK)**: 같은 트리 **2워커 병렬 위임**의 전제는 파일 화이트리스트 상호배타 — 검증도 스코프 테스트만 시키고 풀 게이트는 감사자가 1회.
- **2026-07-19~20 (BOM_QUOTE)**: BOM 견적 데이터는 sp-node 신규 소유(xpse 브릿지 안 함) · sp-vue 에 일반(회원) 라우트 그룹 신설 — "sp-vue=관리자 전용" 전제 공식 변경 · 조용한 자동 보강(고객에 "공급사 검색" 개념 비노출) · 합계는 서버 재계산만이 진실·확정가는 관리자(RFQ 모델) · 1차 종점=견적요청.
- **2026-07-18~20 (PARTS_SEARCH)**: DB=진실원본·ES=파생물 · 단위 지능은 애널라이저가 아니라 TS 코드 · 스펙 2트랙+해석은 should 가산점만 · 부품 정본=f(전체 구매 조건) · samplepcb 파생 구매 조건은 견적 후보 제외 · 공급사 제품 사진을 이미지 정본으로.
- **기존 유지**: rnd 앱 배포 편입(07-17) · 위저드 v2 AI-우선 4스텝(07-16) · 결정적 SVG 렌더러+provenance(07-15) · 코어 비수정+스냅샷 모델 · g5 접근 카탈로그 · 마켓 lazy 상태머신 · SEO 옵션 B · 이관 게이트+멱등 · subtree pull 단방향.

## Gotchas — 기록된 실사고·함정 [coverage: high — 16 sources]

- **대량 cascade 삭제가 P2028 로 전멸**(견적당 자식 수천 행) — 트랜잭션 없이 20건 청크의 **가드된 DELETE 문장별 autocommit** 으로 교정(status 가드가 WHERE 에 있어 draft→requested 경쟁에 안전, 중단돼도 진행분 보존). 단건 삭제도 같은 이유로 무트랜잭션 가드 문장.
- **buffer pool 16MB 기본값이 공범**(DB_TUNING) — `sp_bom_quote_candidate` 1.73GB 가 전부 디스크 바운드. XAMPP 는 `mysql\bin\my.ini` 가 실제 로드 파일(`data\my.ini` 는 미사용 사본). `SET GLOBAL` 은 재시작하면 증발하고, `innodb_log_file_size` 는 **클린 셧다운 후 변경**해야 기동 실패를 피한다.
- **구매 조건 키 v1 의 SKU 축약 충돌** — 점·하이픈을 지우던 v1 은 `P1.00K`/`P10.0K`/`P100K` 를 한 키로 뭉갰다(v2 는 NFKC+양끝 공백만 정규화).
- **제조사 별칭 추가는 소급되지 않는다** — `manufacturer-alias.ts` 갱신은 이후 인제스트만 정규 키로 모이고 과거 행은 남아 같은 품번이 둘로 보인다(`parts:merge-mfr` 로 정리, 되돌릴 수 없어 dry-run 필수). DB 전반은 아직 갈라져 있다(`Vishay` 28갈래·`Murata` 5갈래).
- **ES 재시도 큐는 DB fingerprint 를 믿지 않는다** — 큐 행 자체가 불신 신호라 드레인은 강제 색인(늦게 도착한 stale bulk 복구). poison 행은 20회 상한에서 dead-letter, 새 인제스트가 오면 `attempts` 0 으로 부활 — 상한 상습 도달은 운영 점검 신호.
- **BOM "items 는 있는데 enrichStatus=idle" 창**: 그 창에서 조회되면 전 라인이 빨간 미매칭으로 렌더 — build 가 items+`searching` 을 함께 커밋해 제거. **후보 443건 단일 `createMany` 가 MariaDB 패킷 한도로 연결 절단** — 배치로 교정. **done 뒤 카탈로그 재매칭 금지**.
- **preflight 예상 호출은 경고용일 뿐 한도가 아니다** — 실제 강제는 엔진의 원자적 job budget(`job_call_limit_exhausted`). 인메모리였던 일일 카운터·잡 소유는 DB 로 옮겼지만 **최초 파일 파싱 잡은 여전히 인메모리**(prepare 전 재시작 = 재업로드 안내).
- **카탈로그 직접 검색의 selectedOffer 는 클라 제출값**(조작 가능 — RFQ 라 이득 없음이나 결제 연계 시 서버 선택 API 통합 필수). `SpBomQuote.mbId` 60자 vs 플랫폼 191자(리뷰 P1-5).
- **"4700" 같은 값-토큰의 패키지 필터 오승격** — `packageVariants(c).length > 1` 게이트로 차단. 저항 무단위 `m` 은 관례상 메가. 부품 이미지는 도입 전 적재분 백필 불가.
- **Ollama 비스트림 호출은 undici 헤더 타임아웃 실패** — `stream:true` 필수. LLM HTML DOM 직결=XSS(sandbox iframe+CSP). 구 비전 모델 `qwen3-vl:235b-cloud` 는 retired(HTTP 410).
- **differentDesign 누락 → rfq 실사고** · 가격표 스냅샷 드리프트="sha 불일치" · **`de_tax_flag_use` 는 부가세 on/off 가 아니다** · 마켓 '부분취소'는 od_status 값이 아니다(라인 검증이 정본).
- **이관은 `sql_mode=''` 전제** · specJson `_legacy` 메타→직렬화 500 · bo_subject 는 DB 데이터 · SEO `$_GET['it_id']` 의존 금지 · 로컬 메일 Mailpit 필수 · HANDOFF.md 커밋 금지 · **위임 지시서 허점은 그대로 구현된다**(워커의 이탈 보고 의무가 역방향 검증으로 작동).

## Sources [coverage: high — 22 sources]

- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md)
- [../../docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md)
- [../../docs/bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md)
- [../../docs/prompts/sp-engine-candidate-decision.md](../../docs/prompts/sp-engine-candidate-decision.md)
- [../../docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md)
- [../../docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md)
- [../../docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md)
- [../../docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md)
- [../../docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md)
- [../../docs/DB_TUNING.md](../../docs/DB_TUNING.md)
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
