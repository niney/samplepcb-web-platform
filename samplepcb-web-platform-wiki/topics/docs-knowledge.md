---
topic: docs-knowledge
last_compiled: 2026-09-19
sources_count: 62
status: active
---

# docs-knowledge

## Purpose [coverage: high — 62 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 소스 날짜 범위는 **2026-06-30(UPSTREAM_SYNC 최초) ~ 2026-09-18(BOM_QUOTE·FIGMA_PAGES 최종 커밋)** 이고, `samplepcb-subdomain-nginx.md` 한 편은 2026-09-19 현재 **미커밋(untracked)** 이다. 지난 컴파일(2026-07-27, 22종) 이후 루트 문서 21종 → **47종**, `docs/prompts/` 1종 → **14종**, 회수 자료 `docs/legacy-smartbom/`(README + 3파일)이 신설돼 총 62종이 됐다. 늘어난 축은 넷이다:
- **협력사 트랙 이식**(07-29~08-27) — SMARTBOM_PARTNER_RFQ(1,700줄)·PCB_PARTNER_TRACK(3,283줄)·PARTNER_PORTAL·PARTNER_PARTS·MAIL_LOG·partner-i18n·legacy-smartbom
- **재능마켓 AI 재구성 → 개발의뢰 신설**(08-28~09-11) — AI_DEV_REVIEW(AI_DIAGRAM 대체)·DEVELOP_FLOW·develop-prototypes + 지시서 13종
- **운영 런북 확장**(09-09~09-16) — db-snapshot-rollback·local-mysql-recovery·legacy-production-reimport·subdomain-nginx
- **피그마 페이지 대장**(08-25~09-18) — FIGMA_PAGES·MYPAGE_REDESIGN·CONTACT_INQUIRY

문서는 다섯 층으로 읽는다: ① **정본(단일 설명원본)** — 제목이나 첫 줄에 "정본"이 박힌 문서 ② **구현 기록(여정·P번호)** — 정본 뒤편에 날짜순으로 쌓이는 절 ③ **런북·복구 기록** ④ **정책·결정 메모(결정 대기 포함)** ⑤ **참조 스냅샷·지시서(prompts)**. 이 문서는 각 문서가 무엇을 다루고, 어느 토픽이 정본으로 쓰며, 언제 읽어야 하는지의 안내 지도다. 2026-07-27 판의 내용은 날짜를 붙여 아래에 남겼다.

## Architecture — 문서군 지도 [coverage: high — 62 sources]

열은 `문서 | 요지 | 정본으로 쓰는 토픽 | 최종 커밋`. 굵은 **정본** 표시는 문서 스스로 선언한 것이다.

### 1. 고객 주문 · 거버 · 가격 · 배송

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니→관리자 관리 전체. 코어 무수정 기법 11종, 인증·알림 브리지, **g5 접근 카탈로그 ⑤–⑲**(08월 확장: ⑩ od_memo·주문자 연락처·⑪ SmartBOM 결제 주문 강제삭제·⑮ PCB 취소·다건 결제 단위·09-10 `GET /api/me/contact`) | [sp-node-api](sp-node-api.md) · [spcb-bridge](spcb-bridge.md) · [gnuboard-integration](gnuboard-integration.md) | 2026-09-10 |
| [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) | 거버 가격 주문가/공급가(VAT) 해석 설정, `sp_config` 신설. +08-07 관리자 PCB 상세의 공급가·부가세 역산 표시 | [sp-node-api](sp-node-api.md) | 2026-08-07 |
| [pricing-engine-parity](../../docs/pricing-engine-parity.md) | TS 가격 엔진 ↔ 레거시 PHP 패리티 운영(`pricing:sync→capture→test`). +08-07 **레거시 호환 `POST /api/pcb-pricing`**(거버 뷰어 스위칭 비교, applyGerberPriceMode 미적용, 제출 경로 연동) | [sp-node-api](sp-node-api.md) · [testing](testing.md) | 2026-08-09 |
| [samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 가격 API request body 실캡처(메뉴 7종+옵션) — 패리티 fixture 근거 | [sp-node-api](sp-node-api.md) | 2026-07-03 |
| [DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md) | **정본**. 배송방법 축(택배/퀵착불/방문수령/직배송) — `od_delivery_method` 신설 컬럼 + `od_delivery_company` 한글 라벨 병용(B안)이라 PHP 0줄. P1 완료, ⚠ 운영 DDL 수동(sync 는 스키마를 안 나른다), P2 는 `od_send_cost2` 함정 | [sp-node-api](sp-node-api.md) · [api-contract](api-contract.md) | 2026-08-17 |
| [order-notify-gating](../../docs/order-notify-gating.md) | 주문 메일/SMS 체크박스 노출 게이트(`cf_email_use`/`cf_sms_use==='icode'`) | [sp-vue-web](sp-vue-web.md) · [spcb-bridge](spcb-bridge.md) | 2026-07-05 |
| [DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md) | 택배(CJ) 연동 조사 — **미결정(보류)** | — | 2026-07-06 |

### 2. 스마트 BOM · 부품 카탈로그 · 엔진 계약

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [BOM_QUOTE](../../docs/BOM_QUOTE.md) | **고객 스마트 BOM 견적 정본**(776줄). 업로드→분석 원문 박제→조용한 자동 보강→**판단 단일화(sp-engine)**→견적요청→관리자 회신. 07-28 이후 추가: 샘플/양산 조달 모드(Reel 우선), 관리자 BOM 작업 화면 독립, 단일 검색=공급사 확인 완료 기준, Any Vendor provenance, 구매 불가 대체품 2차 검색(재고 08-04·혼합 조달 08-19), 회신 확정 vs 견적 마감 분리, 견적서 이미지·전용 담당자, 축퇴 행 필요수량 재도장(08-16), 오류 응답 500 뒤바뀜 교정 | [sp-node-api](sp-node-api.md) · [sp-vue-web](sp-vue-web.md) · [parts-engine](parts-engine.md) | 2026-09-18 |
| [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) | **부품 카탈로그 정본** — DB 진실원본+ES 파생물, 스펙 2트랙, 골든 74케이스, 제조사 카탈로그 적재(`offer_kind='manufacturer_catalog'`), 조달→**구매 조건** 용어 통일(08-04), **ES 유령 문서 실측**(08-16, `parts:reindex --recreate` 처방) | [parts-engine](parts-engine.md) · [sp-node-api](sp-node-api.md) | 2026-08-16 |
| [BOM_INGESTED_RC_EXPERIMENT](../../docs/BOM_INGESTED_RC_EXPERIMENT.md) | MPN 없는 R/C 는 저장된 공급사 부품을 먼저 쓰는 실험 — 판정은 여전히 sp-engine(`resistor_minimum`·`capacitor_minimum`), 관리자 토글 `storedPartPrioritySearchEnabled`, 실행 시작 시 스냅샷 | [parts-engine](parts-engine.md) | 2026-08-04 |
| [BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md) | 사내 서비스용 BOM 분석 API `/api/svc` — 업로드→잡 폴링→prepare→build→enrichStatus=done 5단계, 무토큰(네트워크 허용), 응답 봉투 `{result,data|error}`, 모르는 필드 무시 규칙 | [sp-node-api](sp-node-api.md) · [api-contract](api-contract.md) | 2026-08-27 |
| [PARTNER_PARTS](../../docs/PARTNER_PARTS.md) | **협력사 보유 부품 정본**(627줄) — 재고표 업로드→별도 원장 `sp_partner_part`→BOM 검색 잡 `local_products` 주입(같은 자리·뒤순위). P1 을 **하이브리드(§1.5 카탈로그 파생 투영)로 재결정**, 만료 없음·RFQ 제한 없음, 단일검색 협력사명 노출(08-27) | [partner-tracks](partner-tracks.md) · [parts-engine](parts-engine.md) | 2026-08-27 |
| [bom-quote-code-review-2026-07-19](../../docs/bom-quote-code-review-2026-07-19.md) | BOM 견적 코드 리뷰 고정 스냅샷(P1 6·P2 3) — 상당수 BOM_QUOTE 에 흡수, 잔여는 BOM_QUOTE "알려진 한계"가 정본. 08-04 용어만 갱신 | [sp-node-api](sp-node-api.md) | 2026-08-04 |
| [prompts/sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md) | 엔진 계약 지시서 원본 — `decision` 필드표·판단 불변식·경계(sp-node 복구 금지·sp-vue 재판정 금지)·필수 테스트 12종 | [parts-engine](parts-engine.md) | 2026-07-22 |
| [DB_TUNING](../../docs/DB_TUNING.md) | InnoDB buffer pool 16M→1G 튜닝 기록(P2028 후속), 운영 체크리스트 | [infrastructure](infrastructure.md) | 2026-07-24 |

### 3. 협력사 트랙 (BOM · PCB · 포털)

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) | **BOM 트랙 정본**(1,700줄). D1~D17 결정표, 파트너 조직 모델(계정·조직·자동화 3축), RFQ 레이어, 관리자 모듈 스위처, **§5.1 "구현 중 확정된 정정 — 본문보다 이 절이 우선"**, §6 2차 주문·결제 아래 **§6.1~6.38 이 D18~D42 구현 기록**(선적 핑퐁·상업송장·매직링크·선적 그룹·포털 재구성·워크큐·QR 포장·빠른 메일·국내/국외 분리·미응답 회수·클레임·운송수단·Mouser 카트 인계·바코드 입고·협력사 보유 부품·고객 진행 표시·`/api/svc`·MOQ 동기화) | [partner-tracks](partner-tracks.md) | 2026-09-16 |
| [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) | **PCB 트랙 조사+설계+구현 기록**(3,283줄). §0~§8 전수 조사·갭·설계·**§6 확정 결정(D1~D5, 사용자 원-체크)**·리스크, **§9 P1~P5 구현 기록 + 완주 여정 1~43호**(결함 추적 단위), §10 조사 자료 색인. 정본 우선순위 명시: **코드·DDL 헤더 주석 > 레거시 doc/pcb-*.md > 위키** | [partner-tracks](partner-tracks.md) | 2026-08-26 |
| [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) | **포털 IA·진입 규칙·셸 정본** — capability(`bom_rfq`/`pcb_rfq`/`part_sale`)가 단일 진실, `/partner` 리졸버, R1·R2(08-10)·R3 사이드바 셸+워크큐 4화면(08-22), 보유 부품 공통 영역(08-23) | [partner-tracks](partner-tracks.md) · [sp-vue-web](sp-vue-web.md) | 2026-08-23 |
| [partner-i18n](../../docs/partner-i18n.md) | 포털 한/영/중 간체 — `PartnerLayout` 범위 주입(전역 vue-i18n 무변경), 사용자 원문·코드값 비번역, 한국어 표현 개선안 예외표, e2e `partner-i18n` | [partner-tracks](partner-tracks.md) · [sp-vue-web](sp-vue-web.md) | 2026-09-06 |
| [MAIL_LOG](../../docs/MAIL_LOG.md) | **발송 이력 원장 정본** — `sp_mail_log` 전 채널(email·alimtalk·sms) 공용, 기록은 발송 조건이 아님(`recordMailLog` throw 없음), 래퍼 3종 자동 기록, kind 코드표, P3 재발송(quick_mail 만)·실패 위젯·retention 180일 | [sp-node-api](sp-node-api.md) · [partner-tracks](partner-tracks.md) | 2026-08-07 |
| [legacy-smartbom/README](../../docs/legacy-smartbom/README.md) | 레거시 gitignore(`tmp/`)에만 있던 자료 회수 스냅샷(수정 금지): `currency-link-model-redesign.md`(링크별 결제통화 설계서 — §7 DDL 일부 미구현, **코드가 정본**)·`smartbom-bom-pcb-uml.html`(UML Atlas 40여 개)·`legacy-pcb-ddl.sql`(실 DB SHOW CREATE) | [partner-tracks](partner-tracks.md) | 2026-08-04 |

### 4. 재능마켓 · AI · 개발의뢰

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [MARKET_FLOW](../../docs/MARKET_FLOW.md) | 재능마켓 **단일 설명원본** — 1차 매칭+2차 거래 완결, `sp_market_*` 7테이블(계약+수정 이력 추가), §5.1 첨부 미리보기(09-04), **§11 의뢰 수정·버전**(09-05: 입찰 유무 무관 수정, `sp_market_project_revision` append-only, 중대/사소, 마감 자동 연장 48h, `devReviewStale`) | [sp-market-web](sp-market-web.md) · [sp-node-api](sp-node-api.md) | 2026-09-04 |
| [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md) | **AI 사전 검토서 정본**(774줄) — AI_DIAGRAM 을 대체(08-28). v1(§0~§11) → **§12 v2 간소화(09-02)가 §1·§2·§5 를 대체** → **§13 v3 재설계(09-04: 분야 레지스트리 5종·3스텝 위저드·정밀 구성도 kimi 비동기·공통 조건 2스텝·분야 맞춤 질문 14·thinking max 09-08)**. 프롬프트=코드 정본(버전 태그), 프로빙 결과 표 다수 | [sp-market-web](sp-market-web.md) · [sp-node-api](sp-node-api.md) · [shared-packages](shared-packages.md) | 2026-09-08 |
| [AI_DIAGRAM](../../docs/AI_DIAGRAM.md) | ⚠ **대체됨(08-28)** — 4산출물·80문항 인터뷰·선분석·provenance 체계는 폐기, 경위·프로빙 근거(07월)로만 남김. `DiagramSpec`·결정적 SVG 렌더러·첨부 추출기는 새 체계가 그대로 씀 | (역사) [sp-market-web](sp-market-web.md) | 2026-08-29 |
| [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) | 개발의뢰(sp-develop) **단일 설명원본** — 마켓과 분리(전문가·입찰·공개 목록 없음, AI 는 관리자가 돌림, 항목별 견적+마일스톤), 결정 19건, `sp_develop_*` 6테이블, 상태 머신, 검토서 3층(초안·작업본·공개본)+버전 원장, **§7.2.1 위저드 v2(09-08)**, §8 API 지도, §12 결정 로그, **§13 문서·업무표(09-11 간소화 — 8종→5종, §13.6 우선)**, **§14 관리자 「개발」 모듈**(09-09) | [sp-develop-web](sp-develop-web.md) · [sp-node-api](sp-node-api.md) | 2026-09-11 |
| [develop-prototypes](../../docs/develop-prototypes.md) | 프로토타입 G 제거·C 승격(09-10) — 경로 원복표, 지운 것, DB 정리(로컬 완료·운영 09-11 실행), `prod-develop-cleanup.sh`, 원복 태그 `proto-gc-coexist-20260910`·`proto-c-original-20260910` | [sp-develop-web](sp-develop-web.md) | 2026-09-11 |

### 5. 운영 · 인프라 · 이관 · 복구

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md) | centrafab.co.kr 운영 배포 런북(514줄). +08-01 **STEP 6 필수 초기 시드**(`db:seed-initial` — 템플릿 5종·사업자정보 11필드·무통장 2필드, 생략 금지) +09-16 admin 이관 정책·재이관 링크·트러블슈팅 3행 | [infrastructure](infrastructure.md) | 2026-09-16 |
| [samplepcb-subdomain-nginx](../../docs/samplepcb-subdomain-nginx.md) | `new.samplepcb.co.kr` 연결 — Cafe24 A 레코드(Cloudflare IP 아님)→HTTP bootstrap conf→certbot webroot→HTTPS conf 교체→`WEB_BASE_URL`·`SPCB_BRIDGE_URL` 전환. 설정 파일은 gitignore `ops/nginx-live` | [infrastructure](infrastructure.md) | **미커밋** |
| [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md) | 레거시 이관 절차·실증(385줄). +08-04 **§5-C 미주문 견적 변환(phase 06)** — `sp_order_spec.ctId=NULL`, 승격 앵커 `uuidV5('cart:'+ct_id)`, ⚠ 앵커 집합을 `ctId IS NULL` 로 좁히면 중복 삽입(08-05 실측) · 08-05 **파일 전면 미이관 확정** · 09-16 admin 도 레거시 정본 | [infrastructure](infrastructure.md) · [sp-node-api](sp-node-api.md) · [gnuboard-integration](gnuboard-integration.md) | 2026-09-16 |
| [legacy-production-reimport](../../docs/legacy-production-reimport.md) | 운영 DB 초기화 후 재이관 — `migrate:reset-data`(기본 미리보기, 설정·앵커 상품 7개 보존, 분류 못 한 테이블은 중단), 정책 정본 `reset-data-policy.ts`, `migrate:wipe` 는 대체 아님, 원복은 `db:snapshot restore` | [infrastructure](infrastructure.md) · [sp-node-api](sp-node-api.md) | 2026-09-16 |
| [db-snapshot-rollback](../../docs/db-snapshot-rollback.md) | DB 스냅샷·원복 도구 `db:snapshot backup|inspect|restore` — 배포·dev 기동 전 자동 스냅샷, 형제 디렉터리 `samplepcb-db-backups`, `--confirm-database`, 복원 직전 자동 재백업, `max_allowed_packet` 사전 검사 | [infrastructure](infrastructure.md) | 2026-09-11 |
| [local-mysql-recovery-2026-09-09](../../docs/local-mysql-recovery-2026-09-09.md) | 로컬 XAMPP MariaDB 복구 기록 — `mysql.db`·`procs_priv` Aria 손상, `aria_chk --recover`, 복제본 덤프 2.1GB→새 데이터 디렉터리 교체, 296 테이블 검증. 강제 복구 모드 없이 종결 | [infrastructure](infrastructure.md) | 2026-09-11 |
| [UPSTREAM_SYNC](../../docs/UPSTREAM_SYNC.md) | 그누보드 subtree 최신화. +08-05 **pull 직후 `check-core-patches.sh` 필수** — 기록된 한 줄 코어 수정이 충돌 없이 조용히 되돌아가는 것을 잡는다 | [gnuboard-integration](gnuboard-integration.md) · [infrastructure](infrastructure.md) | 2026-08-05 |
| [LOCAL_MAIL_TESTING](../../docs/LOCAL_MAIL_TESTING.md) | 로컬 메일 = Mailpit 127.0.0.1:25(G5_SMTP 모드) | [infrastructure](infrastructure.md) | 2026-07-05 |

### 6. 테마 · 피그마 · 정책 메모

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [FIGMA_PAGES](../../docs/FIGMA_PAGES.md) | **피그마→sp-php 페이지 구현 대장** — 원칙(09-06): 피그마와 동일 구현, **피그마 쪽 오류는 고치지 않고 여기에 기록**. 홈 `/`(09-18 「웹 메인」 재구현·히어로 5장·마퀴)·헤더·푸터·about·history·location 표 + 페이지별 미결(라이선스·자리표시 수치·로고 허락) | [theme-sp-lite](theme-sp-lite.md) | 2026-09-18 |
| [MYPAGE_REDESIGN](../../docs/MYPAGE_REDESIGN.md) | 마이페이지·공용 계정 사이드바 피그마 재설계(08-25) + **09-15 카드형 사이드바가 08-25 평면 레이아웃을 대체**, 주문내역 PCB/부품 탭(판별키 it_id), ⚠ `.nav_badge` 는 숫자만(e2e 파싱) | [theme-sp-lite](theme-sp-lite.md) | 2026-09-15 |
| [CONTACT_INQUIRY](../../docs/CONTACT_INQUIRY.md) | 회사 위치+Contact Us 검토 메모 — **결정 대기**(09-06). 접수 경로 A 게시판/B PHP/**C sp-node(추천)** 비교, MVP 범위. `/location` 은 Contact Us 제외로 구현됨 | [theme-sp-lite](theme-sp-lite.md) · [sp-node-api](sp-node-api.md) | 2026-09-06 |
| [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md) | 페이지별 SEO 설계 정본 — `sp_seo`+테마 head 전역변수 매칭(옵션 B) | [theme-sp-lite](theme-sp-lite.md) | 2026-07-10 |
| [review-naming](../../docs/review-naming.md) | "고객후기" 개명 + 별점후기 `/reviews` | [theme-sp-lite](theme-sp-lite.md) | 2026-07-10 |
| [wishlist-hidden](../../docs/wishlist-hidden.md) | 위시 진입점 숨김(`SP_USE_WISHLIST`). 08-27 헤더 아이콘 3개(마이페이지 추가) 문구만 갱신 | [theme-sp-lite](theme-sp-lite.md) | 2026-08-27 |
| [LEGACY_SITE](../../docs/LEGACY_SITE.md) | 프로덕션 원본 구조·콘텐츠 스냅샷(07-02) | [theme-sp-lite](theme-sp-lite.md) | 2026-07-02 |
| [AI_WORKFLOW_PLAYBOOK](../../docs/AI_WORKFLOW_PLAYBOOK.md) | 작업 방식(직접/위임/병렬) 결정 기준·품질 게이트·실증 로그(07-04~07-22). 모든 지시서가 "먼저 읽을 것"으로 지목 | (횡단) [testing](testing.md) | 2026-07-22 |

### 우선순위 규칙 — 같은 주제를 두 곳이 말할 때

- **정본 선언 + "§정정 우선"** — SMARTBOM_PARTNER_RFQ §5.1 > 본문 · AI_DEV_REVIEW §13 > §12 > §1~§11 · DEVELOP_FLOW §13.6(간소화) > §13 본문, §7.2.1(v2) > §7.2 · PARTNER_PARTS §1.5 재결정 > §0 P1 · MYPAGE_REDESIGN 09-15 사이드바 > 08-25.
- **대체 표식** — AI_DIAGRAM 은 헤더에서 AI_DEV_REVIEW 로 넘긴다. bom-quote-code-review 는 BOM_QUOTE "알려진 한계"에 자리를 넘겼다.
- **문서 밖이 정본인 경우** — PCB 레거시 통화 모델은 코드·DDL 헤더 주석(legacy-smartbom README·PCB_PARTNER_TRACK §7 L10) · 프롬프트는 코드 버전 태그(AI_DEV_REVIEW) · 이관 처분표는 `manifest.ts` · 초기화 보존 정책은 `reset-data-policy.ts` · 계약 사전은 `@sp/api-contract`.
- **트랙 간 위임** — PARTNER_PORTAL(IA·셸) ↔ SMARTBOM_PARTNER_RFQ(BOM 업무) ↔ PCB_PARTNER_TRACK(PCB 업무) ↔ PARTNER_PARTS(보유 부품) ↔ MAIL_LOG(발송)가 서로 "정본은 저쪽"으로 가리킨다.

## Talks To — 문서 간 참조 관계 [coverage: high — 40 sources]

- **협력사 트랙 4각**: PCB_PARTNER_TRACK 은 SMARTBOM_PARTNER_RFQ 를 "자매 정본·자산 재사용 전제"로, legacy-smartbom 을 회수 자료로 지목. SMARTBOM §6.19→MAIL_LOG, §6.36→PARTNER_PARTS, §4→PARTNER_PORTAL 로 정본을 넘긴다. PARTNER_PORTAL §7 이력은 PCB 발송 박스 재구성(PCB_PARTNER_TRACK §9)을 선행으로 적는다.
- **BOM_QUOTE ↔ PARTS_SEARCH ↔ PARTNER_PARTS ↔ BOM_INGESTED_RC_EXPERIMENT**: 카탈로그 우선 조회(부품 유형 기준)·`catalog_selected` 문의 견적·협력사 원장 뒤순위 주입이 네 문서에 걸쳐 서술. 판정은 항상 sp-engine — [judgment-single-owner](../concepts/judgment-single-owner.md). BOM_SERVICE_API 는 BOM_QUOTE 의 회원 라우트를 서비스 액터로 재노출한 것(SMARTBOM §6.37).
- **AI 계보**: AI_DIAGRAM(07-12) → AI_DEV_REVIEW(08-28 대체) → DEVELOP_FLOW(마켓 레지스트리 `market-areas.ts`·`market-dev-review.ts` 재사용, `develop.*` 유스케이스 별도 행) → prompts/dev-review-*(마켓 구현)·prompts/develop-*(개발의뢰 구현). MARKET_FLOW §11.4 는 검토서 갱신을 "선택"으로 두며 AI_DEV_REVIEW 를 가리킨다.
- **개발의뢰 3부작**: DEVELOP_FLOW(정본) ← develop-prototypes(G/C 정리, 원복 태그) ← db-snapshot-rollback(같은 원복 절차 공유). DEVELOP_FLOW §12 결정 로그가 둘을 링크한다.
- **운영 런북 사슬**: DEPLOY_CENTRAFAB STEP 6 시드 ↔ LEGACY_DB_MIGRATION 게이트 ⑥(템플릿 5종) ↔ GERBER_ORDER_FLOW 기법 #1(앵커 상품) — 같은 5종 사전을 세 문서가 미러. DEPLOY·LEGACY_DB_MIGRATION 둘 다 legacy-production-reimport 로 재이관을 위임하고, reimport 는 db-snapshot-rollback 의 restore 를 원복으로 쓴다.
- **UPSTREAM_SYNC → LEGACY_DB_MIGRATION §8**: 코어 한 줄 수정(이메일 아이디 로그인)이 subtree pull 로 지워지면 이관 회원 수천 명이 로그인 불가 — 가드 스크립트가 두 문서를 잇는다. DELIVERY_METHOD 도 같은 가드에 주문서 코어 수정 4건을 등록했다.
- **GERBER_ORDER_FLOW ↔ DELIVERY_METHOD / GERBER_PRICE_MODE / MYPAGE_REDESIGN**: g5 접근 카탈로그가 배송방법 컬럼·세액 표시·주문내역 탭의 read/write 근거. **GERBER ↔ MARKET_FLOW ↔ DEVELOP_FLOW §10**: 카탈로그 ⑲ 마켓 결제 패턴을 개발의뢰 앵커 `sp-develop-svc` 가 그대로 재사용 — [snapshot-freeze](../concepts/snapshot-freeze.md).
- **FIGMA_PAGES ↔ CONTACT_INQUIRY ↔ MYPAGE_REDESIGN**: 피그마 대장이 페이지 표를, CONTACT 가 미결 결정을, MYPAGE 가 계정 셸을 맡는다. 셋 다 "코어 비수정, 전부 테마" — [core-nonmodification](../concepts/core-nonmodification.md).
- **이전 컴파일(07-27)에서 유지되는 쌍**: BOM_QUOTE→DB_TUNING 순환 참조 · prompts/sp-engine-candidate-decision→BOM_QUOTE/PARTS_SEARCH · GERBER_PRICE_MODE→pricing-engine-parity↔body-cases · SEO_MANAGEMENT→review-naming · LEGACY_DB_MIGRATION↔review-naming(sp_review 61건) · AI_WORKFLOW_PLAYBOOK→HANDOFF.md(커밋 금지).

## API Surface — 문서 읽기 진입 규칙 [coverage: high — 62 sources]

"어떤 질문에 어떤 문서를 먼저 여는가". 정본을 연 뒤 §정정 우선 절을 확인하고, 구현 기록(여정·P번호)은 날짜 역순으로 읽는다.

| 질문 | 먼저 열 문서 | 그다음 |
|---|---|---|
| 협력사 RFQ·발주·선적·송금이 어떻게 흐르나 | SMARTBOM_PARTNER_RFQ §0 결정표 → §5.1 → §6.x(BOM) / PCB_PARTNER_TRACK §5·§6 → §9 P번호(PCB) | PARTNER_PORTAL(진입·셸), MAIL_LOG(알림) |
| 어떤 결함이 언제 어떻게 고쳐졌나 | PCB_PARTNER_TRACK §9 "완주 여정 N호" · SMARTBOM §6.2x "D3x 완주" · DEVELOP_FLOW §13.6 | 커밋 메시지의 `(§6.15)` 식 절 번호 |
| BOM 견적 후보가 왜 이렇게 선정됐나 | BOM_QUOTE "판단 단일화"·"엔진 조달 판단 투영"·"구매 불가 대체품" | prompts/sp-engine-candidate-decision, PARTS_SEARCH, BOM_INGESTED_RC_EXPERIMENT, PARTNER_PARTS §4 |
| 외부 시스템에서 BOM 견적을 뽑고 싶다 | BOM_SERVICE_API | SMARTBOM §6.37 |
| 주문 상태·배송·취소·세액이 어디서 결정되나 | GERBER_ORDER_FLOW 5장 카탈로그 ⑬~⑯ | DELIVERY_METHOD, GERBER_PRICE_MODE, order-notify-gating |
| 가격이 라이브와 어긋난다 | pricing-engine-parity(가격표 드리프트 1순위) | body-cases, GERBER_PRICE_MODE |
| AI 검토서·구성도를 바꾸려 한다 | AI_DEV_REVIEW §13 → §12 | prompts/dev-review-phase3·4a·4b, DEVELOP_FLOW §6(develop 은 관리자 주도) |
| 개발의뢰(sp-develop)를 만진다 | DEVELOP_FLOW §1~§4 → §8 API 지도 → §13·§14 | prompts/develop-*, develop-prototypes(옛 경로·원복) |
| 마켓 의뢰를 등록 뒤 고칠 수 있나 | MARKET_FLOW §11 | AI_DEV_REVIEW(검토서 stale) |
| 운영 서버를 세우거나 재배포한다 | DEPLOY_CENTRAFAB(STEP 6 시드 생략 금지) | samplepcb-subdomain-nginx(새 도메인), db-snapshot-rollback |
| 운영 DB 를 비우고 다시 이관한다 | legacy-production-reimport | LEGACY_DB_MIGRATION(§5-C·§2.4), db-snapshot-rollback(원복) |
| DB 가 안 열린다·느리다 | local-mysql-recovery(손상)·DB_TUNING(buffer pool) | db-snapshot-rollback |
| 그누보드 코어 패치를 받는다 | UPSTREAM_SYNC(+가드 스크립트) | LEGACY_DB_MIGRATION §8 |
| 피그마 페이지를 옮긴다 / 피그마가 이상하다 | FIGMA_PAGES(원칙+대장) | MYPAGE_REDESIGN, CONTACT_INQUIRY, SEO_MANAGEMENT |
| 포털 문구·언어를 바꾼다 | partner-i18n | PARTNER_PORTAL §3.1 셸 |
| 메일이 안 갔다는 CS | MAIL_LOG §3·§4 | LOCAL_MAIL_TESTING(로컬), order-notify-gating |
| 규모 있는 작업을 위임하려 한다 | AI_WORKFLOW_PLAYBOOK | prompts/ 의 최근 지시서 형식 |
| 레거시 PCB 통화·UML 원문이 필요하다 | legacy-smartbom/README | PCB_PARTNER_TRACK §1.4·§10 |

## Data — prompts/ 지시서 카탈로그 [coverage: high — 14 sources]

`docs/prompts/` 는 **구현 단위 계약**이다. 공통 골격: 먼저 읽을 것(PLAYBOOK·AGENTS·정본 §번호) → 한 줄 요약 → 불변식(파일 스코프·타입 강성·커밋 금지·네이티브 confirm 금지·공유 DB reset 금지) → 이미 있는 것(계약·라우트 "실체 — 추측 금지") → 확정 설계 → 검증(전부 0) → 보고 형식(바꾼 파일·검증·**이탈/계약 갭**). 워커는 지시서가 틀려도 강행하지 않고 이탈 보고한다.

| 지시서 | 대상 워커 · 스코프 | 정본 참조 | 날짜 |
|---|---|---|---|
| [sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md) | sp-engine 후보 판단 단일화 — `decision` 계약·불변식·테스트 12종 | BOM_QUOTE·PARTS_SEARCH | 2026-07-22 |
| [dev-review-phase3-backend](../../docs/prompts/dev-review-phase3-backend.md) | 계약·서버·`20260828120000_market_dev_review` 마이그레이션·`sp_ai_job` DB 잡·관리자 AI API·rnd 삭제. 출하 코드 6파일 수정 금지 | AI_DEV_REVIEW §1~§4·§6~§8·§10 | 2026-08-29 |
| [dev-review-phase4a-market](../../docs/prompts/dev-review-phase4a-market.md) | `apps/market` 위저드 3스텝(describe→9문항→review)·`DevReviewView`·신선도 서명·삭제 목록 | AI_DEV_REVIEW §1·§2·§4·§5 | 2026-08-29 |
| [dev-review-phase4b-admin](../../docs/prompts/dev-review-phase4b-admin.md) | `apps/web` AI 설정 폼 전면 재작성(연결·검토서 생성·실행 이력)·마켓 드로어 | AI_DEV_REVIEW §6 | 2026-08-29 |
| [develop-phase1a-app](../../docs/prompts/develop-phase1a-app.md) | worker A — 고객 앱 `apps/develop` 전부(랜딩·위저드 3스텝·내 의뢰·상세·수정·인쇄). 마켓 디자인 따라하지 않음 | DEVELOP_FLOW | 2026-09-05 |
| [develop-phase1b-admin](../../docs/prompts/develop-phase1b-admin.md) | worker B — 관리자 워크큐·전면 상세(3층 편집·구성도)·설정·AI 블록·배지. 기존 파일 수정 4개만 허용 | DEVELOP_FLOW | 2026-09-05 |
| [develop-phase2a-app](../../docs/prompts/develop-phase2a-app.md) | worker A3 — 견적 수락·거절·마일스톤 checkout·문의·검수·확인 요청 응답(라우트표 포함) | DEVELOP_FLOW §4·§5·§8 | 2026-09-05 |
| [develop-phase2b-admin](../../docs/prompts/develop-phase2b-admin.md) | worker B3 — 견적 편집기(붙여넣기 파싱·마일스톤 비율)·발송·철회·수동 입금 | DEVELOP_FLOW §4.2·§5·§8 | 2026-09-05 |
| [develop-phase3-schedule](../../docs/prompts/develop-phase3-schedule.md) | worker C1 — 검토서 "개발 일정(예상)" 섹션(범위 주만, 합계 재계산, develop 타깃만) · 검토서=예상, 견적서=약속 | DEVELOP_FLOW §6·§7.3·§11.1 | 2026-09-05 |
| [develop-phase3-review-versions](../../docs/prompts/develop-phase3-review-versions.md) | worker C2 — 검토서 버전 원장·구조 비교·복원. **사용자 중단으로 Fable 직접 구현**, 이탈 2건 기록 | DEVELOP_FLOW §6.2 | 2026-09-05 |
| [develop-wizard-v2a-app](../../docs/prompts/develop-wizard-v2a-app.md) | 고객 앱 위저드 3→5스텝(개별 메뉴 4종·시스템개발·제작 계획·예산 사전 분리) — "브리프가 정본보다 우선" 단서 | DEVELOP_FLOW §7.2 | 2026-09-08 |
| [develop-wizard-v2b-admin](../../docs/prompts/develop-wizard-v2b-admin.md) | 관리자 — `DEVELOP_REGISTRY`·`requestMode`·새 컬럼 라벨·`DevReviewView :registry` | DEVELOP_FLOW §7.2.1 | 2026-09-08 |
| [develop-followup-app](../../docs/prompts/develop-followup-app.md) | 고객 앱 — `develop.followup` AI 후속 질문(2→3스텝 잡, 최대 8, 실패 시 고정 3문항 폴백, AI 동의 2스텝으로) | DEVELOP_FLOW §7.2.2 | 2026-09-08 |
| [develop-followup-admin](../../docs/prompts/develop-followup-admin.md) | 관리자 — AI 설정 ⑥ 카드·상세 "AI 추가 질문" 블록 | DEVELOP_FLOW §7.2.2 | 2026-09-08 |

지시서가 정본이 아니라 **정본을 구현 단위로 자른 뷰**라는 점이 중요하다 — 정본은 뒤에 갱신되고(예: wizard-v2a 는 "브리프 작성 시점엔 정본이 v1"), 지시서는 그 시점 계약으로 남는다. 관련 데이터 문서: 문서군이 정의하는 테이블 소유권(`sp_*`=sp-node Prisma, 공유 DB `prisma migrate reset` 금지)은 GERBER_ORDER_FLOW 5장·AGENTS.md 가 정본이고, 07-27 판의 BOM·부품·마켓 데이터 요약은 각 토픽([sp-node-api](sp-node-api.md)·[parts-engine](parts-engine.md))으로 옮겼다.

## Key Decisions — 문서 관례의 변화 [coverage: high — 30 sources]

- **2026-09-16 (LEGACY_DB_MIGRATION·DEPLOY·reimport)**: `admin` 도 레거시 정본으로 이관 — 보호 계정 규칙을 문서 3곳에 같은 문단으로 동기 기록. 전체 초기화는 `migrate:reset-data` 전용 문서로 분리하고, 기존 `migrate:wipe` 는 "대체 아님"을 명시.
- **2026-09-11 (DEVELOP_FLOW §13.6·develop-prototypes)**: 프로토타입 비교는 **태그로 보존하고 main 은 한 줄로 재작성** — 비교 과정 커밋 6개를 커밋 하나로 접고 원복 지점을 태그 2개로 남겼다. 사용자 서식 간소화가 오면 "모순·정책 뒤집힘"을 먼저 표로 세고 결정 3을 받아 문서를 줄인다.
- **2026-09-10 (develop-prototypes)**: 두 프로토타입(G/C)을 같은 DB 에 나란히 두고 비교한 뒤 하나를 승격 — 채택 안 된 쪽의 규칙 7건은 먼저 이식하고 지운다.
- **2026-09-06 (FIGMA_PAGES)**: **피그마와 동일 구현, 피그마 오류는 고치지 않고 대장에 기록** — 페이지별 "다르게 둔 것·이상 징후·미결" 절이 표준 형식이 됐다. CONTACT_INQUIRY 는 "결정 대기" 문서 형식(후보 비교표+추천+결정할 것+구현 순서)의 첫 사례.
- **2026-09-05 (prompts/develop-*)**: 지시서를 **워커 쌍(app ∥ admin)으로 같은 날 발행**하고 파일 스코프를 상호배타로 자르는 관례 확립. 워커가 중단되면 지시서 헤더에 "Fable 직접 구현 + 이탈" 을 기록해 지시서를 사후 계약서로 보존.
- **2026-09-02~04 (AI_DEV_REVIEW §12·§13)**: 재설계를 새 문서로 내지 않고 **같은 문서에 §12 v2·§13 v3 를 덧붙이며 "§12 가 §1·§2·§5 를 대체"** 식 우선순위 문장을 헤더에 박는다. 프로빙 결과(모델×픽스처 표)를 문서에 남겨 모델 선택 근거로 삼는다.
- **2026-08-28 (AI_DIAGRAM 헤더)**: 폐기 문서는 삭제하지 않고 헤더에 **⚠ 대체됨 + 정본 링크 + 살아남은 조각**을 적는다.
- **2026-08-11 (PCB_PARTNER_TRACK §9)**: **"완주 여정 N호"** 가 결함 추적 단위 — 시나리오 주행→화면 관찰→엄선→수정을 한 절에 담고 확정 결함 수를 헤더에 적는다(1~43호). SMARTBOM 은 같은 관례를 "D3x 완주"로 쓴다.
- **2026-08-10 (PARTNER_PORTAL)**: 트랙 업무 정본과 **IA·셸 정본을 분리** — 라우트 맵은 포털 문서, 업무 규칙은 트랙 문서.
- **2026-08-04 (legacy-smartbom)**: 유실 위험 레거시 자료는 **리포에 스냅샷 회수(수정 금지)** 하고 README 에 "왜 회수했나·무엇이 정본인가"를 적는다. PCB_PARTNER_TRACK §7 은 "레거시 문서·위키를 그대로 믿지 말 것 — 코드·DDL 헤더 > doc > 위키" 우선순위를 처음 명문화.
- **2026-08-04 (BOM_QUOTE·PARTS_SEARCH·리뷰 기록)**: 용어 "조달"→**"구매 조건"** 전면 통일 — 고정 스냅샷 문서(리뷰 기록)까지 함께 고쳐 검색 일관성을 유지.
- **2026-07-29 (SMARTBOM_PARTNER_RFQ)**: 문서 첫 줄 원칙 **"레거시 설계를 따르지 않는다 — 돌아가는 프로세스가 정본"** + §0 결정표(D번호)·§5.1 "본문보다 이 절이 우선"·§6.x 구현 기록 누적 — 이후 모든 트랙 문서의 골격이 됐다.
- **2026-07-21~26 (이전 컴파일 기록)**: 판단 단일 설명 원본=sp-engine(fail-closed) · 자체 카탈로그 우선 조회는 부품 유형 기준 · DB_TUNING 인프라 레버 분리 · 2워커 병렬의 전제=파일 화이트리스트 상호배타 · BOM 데이터 sp-node 신규 소유·sp-vue 일반 라우트 그룹 · DB=진실원본·ES=파생물.

## Gotchas — 문서 자체의 함정 [coverage: high — 30 sources]

- **큰 문서는 절 번호가 커밋 메시지의 키다** — `feat(bom): … (§6.15)` 처럼 SMARTBOM·PCB 절 번호가 커밋에 박힌다. 절을 재번호하면 이력이 끊긴다. SMARTBOM 에는 **§6.35·§6.36 이 두 번씩** 있다(바코드 입고/전 구간 상태 실측, 보유 부품/고객 진행 표시) — 절 번호만으로 링크하지 말고 제목을 같이 적을 것.
- **DEVELOP_FLOW §14 가 가리키는 `docs/prompts/develop-workflow-c-module.md` 는 리포에 없다** — 커밋 258407333 에서 추가됐다가 프로토타입 정리·main 재작성(09-11)에서 사라졌다. 태그 `proto-gc-coexist-20260910` 에서만 볼 수 있다.
- **정본 헤더의 "정정 우선" 절을 건너뛰면 옛 설계를 구현하게 된다** — SMARTBOM §3.4 "AdminBomQuote 재사용"은 §5.1 이 부적합 판정, PARTNER_PARTS P1 "카탈로그 분리"는 §1.5 가 하이브리드로 뒤집음, MYPAGE 08-25 사이드바는 09-15 가 대체.
- **지시서는 그 시점의 계약** — develop-wizard-v2a 는 "정본은 아직 v1 서술, 이 브리프가 우선"이라 적고, 뒤에 DEVELOP_FLOW §7.2.1 이 따라왔다. 지시서를 읽을 땐 정본의 같은 § 날짜를 대조할 것.
- **레거시 자료 우선순위(PCB_PARTNER_TRACK §7 L10)** — 레거시 위키는 06-20 이후 30여 커밋이 빠져 "USD 단일 정본"처럼 정반대 서술이 남아 있다. 회수 자료 `currency-link-model-redesign.md` §7 DDL 도 일부 미구현 — 코드가 정본.
- **운영 스키마는 sync 가 나르지 않는다**(DELIVERY_METHOD §4) — 문서에 DDL 이 적힌 컬럼은 운영에 수동 실행, `SET SESSION sql_mode=''` 선행, DDL 먼저·배포 나중.
- **이관 앵커 집합을 `ctId IS NULL` 로 좁히면 라인·spec 중복 삽입**(LEGACY_DB_MIGRATION §5-C, 08-05 실측) — 전 spec 의 quoteId 집합을 실어야 멱등.
- **subtree pull 은 코어 한 줄 수정을 충돌 없이 되돌린다**(UPSTREAM_SYNC) — pull 직후 `check-core-patches.sh` 를 안 돌리면 이관 회원 로그인 불가가 조용히 재발.
- **ES 유령 문서**(PARTS_SEARCH 08-16) — 인제스트는 upsert 만 하고 DB 에서 사라진 문서를 청소하지 않는다. 같은 점수 두 문서 중 유령이 먼저 잡히면 상세 404. 정기 정합 점검은 미착수.
- **`.nav_badge` 안에는 숫자만**(MYPAGE_REDESIGN) — e2e 가 textContent 를 `Number()` 로 파싱한다. 단위는 `.nav_unit` 으로.
- **FIGMA_PAGES 의 자리표시 수치·워터마크 사진·로고 허락**은 운영 전 체크리스트다 — 홈 통계 6,600+·17,000+·70%, Unsplash+ 프리뷰 2장, 로고 20여 종.
- **local-mysql-recovery 의 `mysql-system-before.sql` 은 불완전 덤프** — 복구용으로 쓰지 말 것. 성공 덤프는 `all-databases.sql`(회원·인증 정보 포함, 공유·커밋 금지).
- **db-snapshot restore 는 DB 전체를 되돌린다** — 회원·주문·`_prisma_migrations` 까지. 코드 원복 후 서버를 켜야 migration 이 재적용되지 않는다.
- **MAIL_LOG 재발송은 quick_mail 만** — 자동 알림은 각 트랙의 재발송 수단이 정본(회신 재발송·견적서 버튼·매직링크 재발급).
- **이전 컴파일(07-27)에서 유지**: 대량 cascade 삭제 P2028→무트랜잭션 가드 청크 · buffer pool 은 `mysql\bin\my.ini` 가 실제 로드 파일 · 구매 조건 키 v1 SKU 축약 충돌 · 제조사 별칭은 소급 안 됨(`parts:merge-mfr`) · Ollama 비스트림 타임아웃(`stream:true`) · HANDOFF.md 커밋 금지 · 위임 지시서 허점은 그대로 구현된다(이탈 보고가 역방향 검증).

## Sources [coverage: high — 62 sources]

- [../../docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md)
- [../../docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md)
- [../../docs/AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md)
- [../../docs/BOM_INGESTED_RC_EXPERIMENT.md](../../docs/BOM_INGESTED_RC_EXPERIMENT.md)
- [../../docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md)
- [../../docs/BOM_SERVICE_API.md](../../docs/BOM_SERVICE_API.md)
- [../../docs/bom-quote-code-review-2026-07-19.md](../../docs/bom-quote-code-review-2026-07-19.md)
- [../../docs/CONTACT_INQUIRY.md](../../docs/CONTACT_INQUIRY.md)
- [../../docs/DB_TUNING.md](../../docs/DB_TUNING.md)
- [../../docs/db-snapshot-rollback.md](../../docs/db-snapshot-rollback.md)
- [../../docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md)
- [../../docs/DELIVERY_METHOD.md](../../docs/DELIVERY_METHOD.md)
- [../../docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md)
- [../../docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md)
- [../../docs/develop-prototypes.md](../../docs/develop-prototypes.md)
- [../../docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md)
- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md)
- [../../docs/LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md)
- [../../docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md)
- [../../docs/legacy-production-reimport.md](../../docs/legacy-production-reimport.md)
- [../../docs/legacy-smartbom/README.md](../../docs/legacy-smartbom/README.md) (+ currency-link-model-redesign.md · smartbom-bom-pcb-uml.html · legacy-pcb-ddl.sql)
- [../../docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md)
- [../../docs/local-mysql-recovery-2026-09-09.md](../../docs/local-mysql-recovery-2026-09-09.md)
- [../../docs/MAIL_LOG.md](../../docs/MAIL_LOG.md)
- [../../docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md)
- [../../docs/MYPAGE_REDESIGN.md](../../docs/MYPAGE_REDESIGN.md)
- [../../docs/order-notify-gating.md](../../docs/order-notify-gating.md)
- [../../docs/PARTNER_PARTS.md](../../docs/PARTNER_PARTS.md)
- [../../docs/PARTNER_PORTAL.md](../../docs/PARTNER_PORTAL.md)
- [../../docs/partner-i18n.md](../../docs/partner-i18n.md)
- [../../docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md)
- [../../docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md)
- [../../docs/pricing-engine-parity.md](../../docs/pricing-engine-parity.md)
- [../../docs/review-naming.md](../../docs/review-naming.md)
- [../../docs/samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md)
- [../../docs/samplepcb-subdomain-nginx.md](../../docs/samplepcb-subdomain-nginx.md) (미커밋)
- [../../docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md)
- [../../docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md)
- [../../docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md)
- [../../docs/wishlist-hidden.md](../../docs/wishlist-hidden.md)
- [../../docs/prompts/sp-engine-candidate-decision.md](../../docs/prompts/sp-engine-candidate-decision.md)
- [../../docs/prompts/dev-review-phase3-backend.md](../../docs/prompts/dev-review-phase3-backend.md)
- [../../docs/prompts/dev-review-phase4a-market.md](../../docs/prompts/dev-review-phase4a-market.md)
- [../../docs/prompts/dev-review-phase4b-admin.md](../../docs/prompts/dev-review-phase4b-admin.md)
- [../../docs/prompts/develop-phase1a-app.md](../../docs/prompts/develop-phase1a-app.md)
- [../../docs/prompts/develop-phase1b-admin.md](../../docs/prompts/develop-phase1b-admin.md)
- [../../docs/prompts/develop-phase2a-app.md](../../docs/prompts/develop-phase2a-app.md)
- [../../docs/prompts/develop-phase2b-admin.md](../../docs/prompts/develop-phase2b-admin.md)
- [../../docs/prompts/develop-phase3-schedule.md](../../docs/prompts/develop-phase3-schedule.md)
- [../../docs/prompts/develop-phase3-review-versions.md](../../docs/prompts/develop-phase3-review-versions.md)
- [../../docs/prompts/develop-wizard-v2a-app.md](../../docs/prompts/develop-wizard-v2a-app.md)
- [../../docs/prompts/develop-wizard-v2b-admin.md](../../docs/prompts/develop-wizard-v2b-admin.md)
- [../../docs/prompts/develop-followup-app.md](../../docs/prompts/develop-followup-app.md)
- [../../docs/prompts/develop-followup-admin.md](../../docs/prompts/develop-followup-admin.md)
