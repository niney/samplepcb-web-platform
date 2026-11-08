---
topic: docs-knowledge
last_compiled: 2026-11-09
sources_count: 60
status: active
---

# docs-knowledge

## Purpose [coverage: high — 60 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 소스 날짜 범위는 **2026-06-30(UPSTREAM_SYNC 최초) ~ 2026-11-06(DEVELOP_FLOW 최종 커밋 e9ad97ffd)** 이고, 2026-11-09 작업트리에 **미커밋 변경 2편**(DEVELOP_FLOW +11줄 §7.2.9 · FIGMA_PAGES +1줄 공용 헤더 '개발' 링크)이 있다. 10-12 판에 미커밋(untracked)으로 실었던 거버 뷰어 연동 가이드 `GERBER_SUBMIT_GUIDE.html` 은 → 2026-10-21 커밋됐다(1eef681a7). **2026-11-09 실측**: 루트 md 41 + `docs/prompts/` 14 + `docs/legacy-smartbom/` md 2 = **md 57편(10-12 와 같음)**, md 가 아닌 파일 **5개**(`GERBER_SUBMIT_GUIDE.html` · legacy-smartbom 의 UML html·DDL sql · `prototypes/develop-workflow-simple.html` · **신규** `prototypes/develop-menu-questions-plan.html`) — 파일 62, 미추적 0. 10-12 컴파일 이후 60커밋(그중 `docs/` 를 건드린 것 30)에서 md 는 **신규·소멸 0 · 변경 3편**(DEVELOP_FLOW +154/−14 · FIGMA_PAGES +120 · DEPLOY_CENTRAFAB +16), HTML 은 커밋 1·신규 1이다(하루 만에 들어왔다 지워진 자리표시 1편은 Gotchas). (10-12 판 기록: 97커밋·`docs/` 65 에서 신규 2·변경 7·소멸 1. 그 전 09-19 판의 "루트 47종·총 62종"은 과다 집계였다 — 그때 실제는 55편.) 늘어난 축은 여섯이다:
- **협력사 트랙 이식**(07-29~08-27) — SMARTBOM_PARTNER_RFQ(1,700줄)·PCB_PARTNER_TRACK(3,283줄)·PARTNER_PORTAL·PARTNER_PARTS·MAIL_LOG·partner-i18n·legacy-smartbom
- **재능마켓 AI 재구성 → 개발의뢰 신설**(08-28~09-11) — AI_DEV_REVIEW(AI_DIAGRAM 대체)·DEVELOP_FLOW·develop-prototypes + 지시서 13종
- **운영 런북 확장**(09-09~09-16) — db-snapshot-rollback·local-mysql-recovery·legacy-production-reimport·subdomain-nginx
- **피그마 페이지 대장**(08-25~09-18) — FIGMA_PAGES·MYPAGE_REDESIGN·CONTACT_INQUIRY
- **관리자 리뉴얼 · 협력사 트랙 2막**(09-30~10-11) — ADMIN_NEXT_UI(shadcn 컷오버)·PCB_EQ_AI_PROBE + PCB_PARTNER_TRACK D20(EQ 문항형 회차)·SMARTBOM §6.39~6.45(D43~D48: 결제 후 부품 확인·외화 회신·마스터딜러 중개·송금 원장)·PARTNER_PORTAL §5.1~5.2(하위 협력사 직접 관리·관리자 대리 접속)
- **개발의뢰 2막 · 운영 임시 우회**(10-21~11-06) — DEVELOP_FLOW §5.1 견적서 서식·§7.2.3~§7.2.9 위저드 재편(메뉴 6장·AI 맞춤 질문·PCB 설계 자료·시스템개발 범위)·§7.3 연락처 수정·§12 출력물 결정 + FIGMA_PAGES 개발의뢰 4절·시안 요청 + `prototypes/develop-menu-questions-plan.html`(세부 질문 확정본) · DEPLOY_CENTRAFAB STEP 5 (d)(레거시 도메인 쿠키 충돌 우회) · GERBER_SUBMIT_GUIDE.html 커밋. 이 축은 지시서(`prompts/`) 없이 정본 절과 HTML 로만 쌓였다

문서는 다섯 층으로 읽는다: ① **정본(단일 설명원본)** — 제목이나 첫 줄에 "정본"이 박힌 문서 ② **구현 기록(여정·P번호)** — 정본 뒤편에 날짜순으로 쌓이는 절 ③ **런북·복구 기록** ④ **정책·결정 메모(결정 대기 포함)** ⑤ **참조 스냅샷·지시서(prompts)·전달용 HTML**(연동 가이드·검토 요청서→확정본·서식 보관본). 이 문서는 각 문서가 무엇을 다루고, 어느 토픽이 정본으로 쓰며, 언제 읽어야 하는지의 안내 지도다. 2026-07-27 판의 내용은 날짜를 붙여 아래에 남겼다.

## Architecture — 문서군 지도 [coverage: high — 47 sources]

열은 `문서 | 요지 | 정본으로 쓰는 토픽 | 최종 커밋`. 굵은 **정본** 표시는 문서 스스로 선언한 것이다.

### 1. 고객 주문 · 거버 · 가격 · 배송

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니→관리자 관리 전체. 코어 무수정 기법 11종, 인증·알림 브리지, **g5 접근 카탈로그 ⑤–⑲**(08월 확장: ⑩ od_memo·주문자 연락처·⑪ SmartBOM 결제 주문 강제삭제·⑮ PCB 취소·다건 결제 단위·09-10 `GET /api/me/contact`) **+09-30 카탈로그 ㉒** SmartBOM 결제 후 차액 정산(D43) — 추가결제 앵커 `sp-bom-extra`·`reduceOrderedBomRowAmount`("주문행 io_price 불변"의 유일한 명시 예외)·`addOrderRefund` | [sp-node-api](sp-node-api.md) · [spcb-bridge](spcb-bridge.md) · [gnuboard-integration](gnuboard-integration.md) | 2026-09-30 |
| [GERBER_SUBMIT_GUIDE.html](../../docs/GERBER_SUBMIT_GUIDE.html) (md 아님) | 업그레이드된 거버 뷰어 담당자에게 넘기는 **연동 가이드 전달물**(10-11 작성) — 브라우저에서 `GET /spcb/api/me` → `POST /api/pcb-projects`(multipart 3파트) 두 번 호출로 담기, 사양 키·값 표, 점검 순서·문제 해결. 서버 쪽 정본은 GERBER_ORDER_FLOW §3. 자족 HTML(라이트·다크 대응, 예시 호스트 입력칸 기본값 `https://new.samplepcb.co.kr` — 다음 날 DEPLOY STEP 5 (d) 쿠키 충돌 우회의 대상 호스트) | [spcb-bridge](spcb-bridge.md) · [sp-node-api](sp-node-api.md) | 2026-10-21 (10-12 판엔 **미커밋** → 1eef681a7) |
| [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) | 거버 가격 주문가/공급가(VAT) 해석 설정, `sp_config` 신설. +08-07 관리자 PCB 상세의 공급가·부가세 역산 표시 | [sp-node-api](sp-node-api.md) | 2026-08-07 |
| [pricing-engine-parity](../../docs/pricing-engine-parity.md) | TS 가격 엔진 ↔ 레거시 PHP 패리티 운영(`pricing:sync→capture→test`). +08-07 **레거시 호환 `POST /api/pcb-pricing`**(거버 뷰어 스위칭 비교, applyGerberPriceMode 미적용, 제출 경로 연동) | [sp-node-api](sp-node-api.md) · [testing](testing.md) | 2026-08-09 |
| [samplepcb-pricing-api-body-cases](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 가격 API request body 실캡처(메뉴 7종+옵션) — 패리티 fixture 근거 | [sp-node-api](sp-node-api.md) | 2026-07-03 |
| [DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md) | **정본**. 배송방법 축(택배/퀵착불/방문수령/직배송) — `od_delivery_method` 신설 컬럼 + `od_delivery_company` 한글 라벨 병용(B안)이라 PHP 0줄. P1 완료, ⚠ 운영 DDL 수동(sync 는 스키마를 안 나른다), P2 는 `od_send_cost2` 함정 | [sp-node-api](sp-node-api.md) · [api-contract](api-contract.md) | 2026-08-17 |
| [order-notify-gating](../../docs/order-notify-gating.md) | 주문 메일/SMS 체크박스 노출 게이트(`cf_email_use`/`cf_sms_use==='icode'`) | [sp-vue-web](sp-vue-web.md) · [spcb-bridge](spcb-bridge.md) | 2026-07-05 |
| [DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md) | 택배(CJ) 연동 조사 — **미결정(보류)** | — | 2026-07-06 |

### 2. 스마트 BOM · 부품 카탈로그 · 엔진 계약

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [BOM_QUOTE](../../docs/BOM_QUOTE.md) | **고객 스마트 BOM 견적 정본**(825줄). 업로드→분석 원문 박제→조용한 자동 보강→**판단 단일화(sp-engine)**→견적요청→관리자 회신. 07-28 이후 추가: 샘플/양산 조달 모드(Reel 우선), 관리자 BOM 작업 화면 독립, 단일 검색=공급사 확인 완료 기준, Any Vendor provenance, 구매 불가 대체품 2차 검색(재고 08-04·혼합 조달 08-19), 회신 확정 vs 견적 마감 분리, 견적서 이미지·전용 담당자, 축퇴 행 필요수량 재도장(08-16), 오류 응답 500 뒤바뀜 교정 **+10-05 「취소와 보존 기간」** — 취소=동결된 기록(고객 삭제는 draft 만), `purgeAfter` 고지(기본 30일·취소 때 찍은 값 고수), 6시간 주기 자동 정리가 관리자 강제 삭제와 같은 경로(`purgeBomCase`·`sp_delete_audit`), `/app/admin/delete-audits` · 10-01 구매 조건·협력사 보유 없는 후보는 목록에서 제외 | [sp-node-api](sp-node-api.md) · [sp-vue-web](sp-vue-web.md) · [parts-engine](parts-engine.md) | 2026-10-05 |
| [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) | **부품 카탈로그 정본** — DB 진실원본+ES 파생물, 스펙 2트랙, 골든 74케이스, 제조사 카탈로그 적재(`offer_kind='manufacturer_catalog'`), 조달→**구매 조건** 용어 통일(08-04), **ES 유령 문서 실측**(08-16, `parts:reindex --recreate` 처방) | [parts-engine](parts-engine.md) · [sp-node-api](sp-node-api.md) | 2026-08-16 |
| [BOM_INGESTED_RC_EXPERIMENT](../../docs/BOM_INGESTED_RC_EXPERIMENT.md) | MPN 없는 R/C 는 저장된 공급사 부품을 먼저 쓰는 실험 — 판정은 여전히 sp-engine(`resistor_minimum`·`capacitor_minimum`), 관리자 토글 `storedPartPrioritySearchEnabled`, 실행 시작 시 스냅샷 | [parts-engine](parts-engine.md) | 2026-08-04 |
| [BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md) | 사내 서비스용 BOM 분석 API `/api/svc` — 업로드→잡 폴링→prepare→build→enrichStatus=done 5단계, 무토큰(네트워크 허용), 응답 봉투 `{result,data\|error}`, 모르는 필드 무시 규칙 | [sp-node-api](sp-node-api.md) · [api-contract](api-contract.md) | 2026-08-27 |
| [PARTNER_PARTS](../../docs/PARTNER_PARTS.md) | **협력사 보유 부품 정본**(627줄) — 재고표 업로드→별도 원장 `sp_partner_part`→BOM 검색 잡 `local_products` 주입(같은 자리·뒤순위). P1 을 **하이브리드(§1.5 카탈로그 파생 투영)로 재결정**, 만료 없음·RFQ 제한 없음, 단일검색 협력사명 노출(08-27) | [partner-tracks](partner-tracks.md) · [parts-engine](parts-engine.md) | 2026-08-27 |
| [bom-quote-code-review-2026-07-19](../../docs/bom-quote-code-review-2026-07-19.md) | BOM 견적 코드 리뷰 고정 스냅샷(P1 6·P2 3) — 상당수 BOM_QUOTE 에 흡수, 잔여는 BOM_QUOTE "알려진 한계"가 정본. 08-04 용어만 갱신 | [sp-node-api](sp-node-api.md) | 2026-08-04 |
| [prompts/sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md) | 엔진 계약 지시서 원본 — `decision` 필드표·판단 불변식·경계(sp-node 복구 금지·sp-vue 재판정 금지)·필수 테스트 12종 | [parts-engine](parts-engine.md) | 2026-07-22 |
| [DB_TUNING](../../docs/DB_TUNING.md) | InnoDB buffer pool 16M→1G 튜닝 기록(P2028 후속), 운영 체크리스트 | [infrastructure](infrastructure.md) | 2026-07-24 |

### 3. 협력사 트랙 (BOM · PCB · 포털)

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) | **BOM 트랙 정본**(1,924줄). D1~D17 결정표, 파트너 조직 모델(계정·조직·자동화 3축), RFQ 레이어, 관리자 모듈 스위처, **§5.1 "구현 중 확정된 정정 — 본문보다 이 절이 우선"**, §6 2차 주문·결제 아래 **§6.1~6.38 이 D18~D42 구현 기록**(선적 핑퐁·상업송장·매직링크·선적 그룹·포털 재구성·워크큐·QR 포장·빠른 메일·국내/국외 분리·미응답 회수·클레임·운송수단·Mouser 카트 인계·바코드 입고·협력사 보유 부품·고객 진행 표시·`/api/svc`·MOQ 동기화) **+§6.39~6.45(09-30~10-09) = D43~D48**: 결제 후 부품 확인 요청(원 주문 그대로·차액만 정산)·유형 확장(11구분)·협력사 외화 회신(링크 통화 배정 순간 박제·견적 단위 고정 환율)·마스터딜러 중개 견적/발주(하위 발주는 별도 표 `sp_bom_md_po`)·송금 원장·상세 여정+흔적 주행 · 10-06 확정가 입력 토글 폐기 · 10-10 §6.13 개정 | [partner-tracks](partner-tracks.md) | 2026-10-10 |
| [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) | **PCB 트랙 조사+설계+구현 기록**(3,794줄). §0~§8 전수 조사·갭·설계·**§6 확정 결정(D1~D8 표 + 표 아래 문단 D12~D20, D9~D11 은 §9 P1 기록 — 사용자 원-체크)**·리스크, **§9 P1~P5 구현 기록 + 완주 여정 1~43호**(결함 추적 단위), §10 조사 자료 색인. **+10-09~10-11**: 하위 협력사 직접 관리·대리 접속(정책 정본은 PARTNER_PORTAL) · **D20 EQ 문항형 회차**(설계 → P1 백엔드·고객 PHP·포털·관리자 4갈래 → P2 승인요청 때 자동 AI 분석 → 후속[승인=자동 전달·협력사 추가 EQ] → P3 회신서 엑셀 → P4 의견 번역) · sp-php 브리지 `addslashes` 오염 교정(`sp_bridge_text`) · 마스터딜러 견적 화면 재편 · Case ID 선적 줄 · 협력사 '선적 완료' 확인(`shipConfirmedAt` — 상태가 아니라 기록). 정본 우선순위 명시: **코드·DDL 헤더 주석 > 레거시 doc/pcb-*.md > 위키** | [partner-tracks](partner-tracks.md) | 2026-10-11 |
| [PCB_EQ_AI_PROBE](../../docs/PCB_EQ_AI_PROBE.md) | **프로빙 기록**(496줄, D20 P2 의 근거) — 공장 EQ 엑셀 → 문항 초안 `PcbEqDraft`. 결론(§2): 추출(셀·병합·그림)은 LLM 불필요(`extractEqWorkbook`, 실샘플 15ms) · 문항 구조·번역은 LLM 전체 분석이 주 경로 · 템플릿 파서는 대조+폴백 · 기본 `kimi-k3`·think `low`·프롬프트 `eq-parse-v3`. 15모델·LLM 작업 633건, 채점식(§3.5)·코퍼스(§4)·실패 유형표(§6)·역할 분담(§7.2 = `analyzeEqFile` 한 함수)·운영 반영 목록(§8)·남은 의문(§10). 설계 정본은 PCB_PARTNER_TRACK 「D20 설계」 | [partner-tracks](partner-tracks.md) · [sp-node-api](sp-node-api.md) | 2026-10-11 |
| [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) | **포털 IA·진입 규칙·셸 정본** — capability(`bom_rfq`/`pcb_rfq`/`part_sale`)가 단일 진실, `/partner` 리졸버, R1·R2(08-10)·R3 사이드바 셸+워크큐 4화면(08-22), 보유 부품 공통 영역(08-23) **+§5.1 하위 협력사 직접 관리(10-09: `/partner/children`·등록 자동 승인·회원은 만들지 않음·초대 링크 `/partner-invite/:token`) · §5.1.1 마스터딜러 지정(10-10: `sp_partner.isMasterDealer` 가 역할 정본) · §5.2 관리자 대리 접속(10-09: `?actAs=`+헤더 `x-sp-act-as-partner`, 쓰기 전량 `sp_partner_act_log`) · §7 이력 10-11 한국어 어휘 `출하`→`선적`** | [partner-tracks](partner-tracks.md) · [sp-vue-web](sp-vue-web.md) | 2026-10-11 |
| [partner-i18n](../../docs/partner-i18n.md) | 포털 한/영/중 간체 — `PartnerLayout` 범위 주입(전역 vue-i18n 무변경), 사용자 원문·코드값 비번역, 한국어 표현 개선안 예외표, e2e `partner-i18n` | [partner-tracks](partner-tracks.md) · [sp-vue-web](sp-vue-web.md) | 2026-09-06 |
| [MAIL_LOG](../../docs/MAIL_LOG.md) | **발송 이력 원장 정본** — `sp_mail_log` 전 채널(email·alimtalk·sms) 공용, 기록은 발송 조건이 아님(`recordMailLog` throw 없음), 래퍼 3종 자동 기록, kind 코드표, P3 재발송(quick_mail 만)·실패 위젯·retention 180일 | [sp-node-api](sp-node-api.md) · [partner-tracks](partner-tracks.md) | 2026-08-07 |
| [legacy-smartbom/README](../../docs/legacy-smartbom/README.md) | 레거시 gitignore(`tmp/`)에만 있던 자료 회수 스냅샷(수정 금지): `currency-link-model-redesign.md`(링크별 결제통화 설계서 — §7 DDL 일부 미구현, **코드가 정본**)·`smartbom-bom-pcb-uml.html`(UML Atlas 40여 개)·`legacy-pcb-ddl.sql`(실 DB SHOW CREATE) | [partner-tracks](partner-tracks.md) | 2026-08-04 |
| [legacy-smartbom/currency-link-model-redesign](../../docs/legacy-smartbom/currency-link-model-redesign.md) | **회수 스냅샷(수정 금지)** — 레거시 PCB 다중통화 "링크별 결제 통화" 전면 재설계 계획서(384줄, 원문 2026-06-20, 대상 `sp-smartbom-web`+`samplepcb_xpse`). 결제 통화는 멤버가 아니라 **관계(링크) 속성** · 환율은 링크↔링크 변환점에서만 등장하고 그때 박제 · 입력 통화≠결제 통화 지원. "USD 단일 정본" 프레임을 폐기한 문서이고 §7 DDL 일부는 미구현 — **코드가 정본**. "링크 하나 = 결제통화 하나" 규칙은 SMARTBOM §6.41(D45)이 "PCB 트랙의 통화 규칙"으로 BOM 에 다시 가져왔다 | [partner-tracks](partner-tracks.md) | 2026-08-04 |

### 4. 재능마켓 · AI · 개발의뢰

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [MARKET_FLOW](../../docs/MARKET_FLOW.md) | 재능마켓 **단일 설명원본** — 1차 매칭+2차 거래 완결, `sp_market_*` 7테이블(계약+수정 이력 추가), §5.1 첨부 미리보기(09-04), **§11 의뢰 수정·버전**(09-05: 입찰 유무 무관 수정, `sp_market_project_revision` append-only, 중대/사소, 마감 자동 연장 48h, `devReviewStale`) | [sp-market-web](sp-market-web.md) · [sp-node-api](sp-node-api.md) | 2026-09-04 |
| [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md) | **AI 사전 검토서 정본**(774줄) — AI_DIAGRAM 을 대체(08-28). v1(§0~§11) → **§12 v2 간소화(09-02)가 §1·§2·§5 를 대체** → **§13 v3 재설계(09-04: 분야 레지스트리 5종·3스텝 위저드·정밀 구성도 kimi 비동기·공통 조건 2스텝·분야 맞춤 질문 14·thinking max 09-08)**. 프롬프트=코드 정본(버전 태그), 프로빙 결과 표 다수 | [sp-market-web](sp-market-web.md) · [sp-node-api](sp-node-api.md) · [shared-packages](shared-packages.md) | 2026-09-08 |
| [AI_DIAGRAM](../../docs/AI_DIAGRAM.md) | ⚠ **대체됨(08-28)** — 4산출물·80문항 인터뷰·선분석·provenance 체계는 폐기, 경위·프로빙 근거(07월)로만 남김. `DiagramSpec`·결정적 SVG 렌더러·첨부 추출기는 새 체계가 그대로 씀 | (역사) [sp-market-web](sp-market-web.md) | 2026-08-29 |
| [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) | 개발의뢰(sp-develop) **단일 설명원본**(538줄, 10-12 판 398줄) — 마켓과 분리(전문가·입찰·공개 목록 없음, AI 는 관리자가 돌림, 항목별 견적+마일스톤), 결정 19건, `sp_develop_*` 6테이블, 상태 머신, 검토서 3층(초안·작업본·공개본)+버전 원장, **§7.2.1 위저드 v2(09-08)**, §8 API 지도, §12 결정 로그, **§13 문서·업무표(09-11 간소화 — 8종→5종, §13.6 우선)**, **§14 관리자 「개발」 모듈**(09-09), **§15 프로세스 검토(10-07, 미결)** — 관리자 화면 리뉴얼 중 찾은 23건(A 돈·상태 5 / B 확인 없는 비가역 동작 6 / C 배지·큐·어휘 8 / D 입력 검사 4), **아무것도 고치지 않음·사용자 결정 대기** **+10-22~11-06**: §7.2 화면 표가 피그마 「개발 의뢰」 화면(기록은 FIGMA_PAGES)·`/requests/:id/print` 출력물 · **§7.2.3 메뉴 6장(10-30 — 09-08 "회로·펌웨어는 시스템개발 안에서만"을 뒤집음, 분야 7종·역설계 신설·권리 확인 필수)** · §7.2.4 개별 메뉴 **AI 맞춤 질문**(10-30 시험 운영 — 기본 꺼짐·끄면 롤백) · §7.2.5 디자인 체크리스트(출력물 PPT 4:3) · §7.2.6~§7.2.8 PCB 설계 자료 칸·회로→PCB 연계·PCB 제작 4스텝+사전 견적(11-02~03) · **§7.2.9 시스템개발 범위 — 앱·서버·기구를 AI 검토에서 빼기(11-06, 미커밋)** · **§5·§5.1 견적서 서식(11-04~06 — 인건비 일일 노임비×참여 일수·직접비·간접비→제경비→기업이윤 계단식·인쇄 시트·엑셀·PDF·'통합 견적서' 모양, 내부 원가는 넣었다 같은 날 뺌, 마이그레이션 4본)** · §7.3 관리자 연락처 수정(11-04, 상태 무관) · §12 결정 로그 '출력하기'(10-22 → 11-06 견적서·진행 · 문의 섹션 삭제) | [sp-develop-web](sp-develop-web.md) · [sp-node-api](sp-node-api.md) | 2026-11-06 (+11-09 미커밋 §7.2.9) |
| [develop-prototypes](../../docs/develop-prototypes.md) | 프로토타입 G 제거·C 승격(09-10) — 경로 원복표, 지운 것, DB 정리(로컬 완료·운영 09-11 실행), `prod-develop-cleanup.sh`, 원복 태그 `proto-gc-coexist-20260910`·`proto-c-original-20260910` | [sp-develop-web](sp-develop-web.md) | 2026-09-11 |
| [prototypes/develop-menu-questions-plan.html](../../docs/prototypes/develop-menu-questions-plan.html) (md 아님) | 개발의뢰 1스텝 메뉴 6장의 **세부 질문 확정본**(561줄) — 3511dc041 에서 비개발자 검토 요청서로 냈다가 같은 날 회신을 받아 3b1a596f9 에서 확정본으로 고쳤다: 결정 요약(1번 = 검토자 정리본 + 4곳 수정, 2~8번 = 제안대로)·메뉴 6개 질문 전문 **51문항**(계약 `develop-areas.ts` 와 같은 문구·선택지, 조건부·공통·늘 묻는 질문 표시)·'회신 결과'. 검토자 정리본은 보관하지 않는다(사용자 결정). 계약 `develop-areas.ts` 머리 주석·DEVELOP_FLOW §7.2.3·§7.2.6 이 경로로 가리킨다. 그 뒤 질문이 더 바뀌어(PCB 7 → 9·회로 연계 문항·시스템개발 범위 문항) **11-02 이후의 질문은 계약이 정본**이다 | [sp-develop-web](sp-develop-web.md) · [api-contract](api-contract.md) | 2026-10-30 |
| [prototypes/develop-workflow-simple.html](../../docs/prototypes/develop-workflow-simple.html) (md 아님) | 사용자가 준 「샘플피씨비 개발프로젝트 업무관리 서식」 간소화 6장의 보관본 — DEVELOP_FLOW §13 머리가 "보관본" 경로로 가리키고, §13.1 간편 서식 ↔ 구현 대응표가 이 서식을 장마다 옮긴다 | [sp-develop-web](sp-develop-web.md) | 2026-09-11 |

### 5. 운영 · 인프라 · 이관 · 복구

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md) | centrafab.co.kr 운영 배포 런북(530줄, 10-12 판 514줄). +08-01 **STEP 6 필수 초기 시드**(`db:seed-initial` — 템플릿 5종·사업자정보 11필드·무통장 2필드, 생략 금지) +09-16 admin 이관 정책·재이관 링크·트러블슈팅 3행 **+10-22 STEP 5 (d) (임시) 레거시 도메인 쿠키 충돌 우회** — `new.samplepcb.co.kr` 에서 로그인이 안 붙는 문제(레거시가 `.samplepcb.co.kr` 에 심은 PHPSESSID 가 먼저 읽혀 `/spcb/api/me` 401), `data/dbconfig.php` 의 `?>` 앞에 `spcb/lib/legacy-session-pick.php` include 한 줄 · git 밖이라 STEP 4 재설치 때 다시 · 전제(`files` 세션, Ubuntu `/var/lib/php/sessions`) · 확인 방법 · **걷어내는 때**(레거시 쿠키가 브라우저에서 빠질 때, 자동 로그인 최대 31일) · `ck_auto` 미대응 | [infrastructure](infrastructure.md) · [spcb-bridge](spcb-bridge.md) · [gnuboard-integration](gnuboard-integration.md) | 2026-10-22 |
| samplepcb-subdomain-nginx — **사라짐(2026-10-12 확인)** | `new.samplepcb.co.kr` 연결 — Cafe24 A 레코드(Cloudflare IP 아님)→HTTP bootstrap conf→certbot webroot→HTTPS conf 교체→`WEB_BASE_URL`·`SPCB_BRIDGE_URL` 전환. 설정 파일은 gitignore `ops/nginx-live`. **한 번도 커밋되지 않은 채 파일이 없어졌고(git 이력 없음), 절차를 옮겨 적은 문서도 없다**(`docs`·`ops` 검색 0건) — 남은 것은 gitignore 된 실설정 `ops/nginx-live/bootstrap/new-samplepcb-http.conf`·`sites-enabled/new-samplepcb`(10-05 수정)와 이 행·[infrastructure](infrastructure.md) 토픽의 요약뿐. → 10-22 DEPLOY_CENTRAFAB STEP 5 (d) 가 처음으로 `new.samplepcb.co.kr` 을 운영 중인 호스트로 다루지만(쿠키 충돌), 도메인 연결 절차 자체는 11-09 에도 문서가 없다 | [infrastructure](infrastructure.md) | 없음(09-19 엔 미커밋) |
| [LEGACY_DB_MIGRATION](../../docs/LEGACY_DB_MIGRATION.md) | 레거시 이관 절차·실증(385줄). +08-04 **§5-C 미주문 견적 변환(phase 06)** — `sp_order_spec.ctId=NULL`, 승격 앵커 `uuidV5('cart:'+ct_id)`, ⚠ 앵커 집합을 `ctId IS NULL` 로 좁히면 중복 삽입(08-05 실측) · 08-05 **파일 전면 미이관 확정** · 09-16 admin 도 레거시 정본 | [infrastructure](infrastructure.md) · [sp-node-api](sp-node-api.md) · [gnuboard-integration](gnuboard-integration.md) | 2026-09-16 |
| [legacy-production-reimport](../../docs/legacy-production-reimport.md) | 운영 DB 초기화 후 재이관 — `migrate:reset-data`(기본 미리보기, 설정·앵커 상품 7개 보존, 분류 못 한 테이블은 중단), 정책 정본 `reset-data-policy.ts`, `migrate:wipe` 는 대체 아님, 원복은 `db:snapshot restore` | [infrastructure](infrastructure.md) · [sp-node-api](sp-node-api.md) | 2026-09-16 |
| [db-snapshot-rollback](../../docs/db-snapshot-rollback.md) | DB 스냅샷·원복 도구 `db:snapshot backup\|inspect\|restore` — 배포·dev 기동 전 자동 스냅샷, 형제 디렉터리 `samplepcb-db-backups`, `--confirm-database`, 복원 직전 자동 재백업, `max_allowed_packet` 사전 검사 | [infrastructure](infrastructure.md) | 2026-09-11 |
| [local-mysql-recovery-2026-09-09](../../docs/local-mysql-recovery-2026-09-09.md) | 로컬 XAMPP MariaDB 복구 기록 — `mysql.db`·`procs_priv` Aria 손상, `aria_chk --recover`, 복제본 덤프 2.1GB→새 데이터 디렉터리 교체, 296 테이블 검증. 강제 복구 모드 없이 종결 | [infrastructure](infrastructure.md) | 2026-09-11 |
| [UPSTREAM_SYNC](../../docs/UPSTREAM_SYNC.md) | 그누보드 subtree 최신화. +08-05 **pull 직후 `check-core-patches.sh` 필수** — 기록된 한 줄 코어 수정이 충돌 없이 조용히 되돌아가는 것을 잡는다 | [gnuboard-integration](gnuboard-integration.md) · [infrastructure](infrastructure.md) | 2026-08-05 |
| [LOCAL_MAIL_TESTING](../../docs/LOCAL_MAIL_TESTING.md) | 로컬 메일 = Mailpit 127.0.0.1:25(G5_SMTP 모드) | [infrastructure](infrastructure.md) | 2026-07-05 |

### 6. 테마 · 피그마 · 관리자 UI · 정책 메모

| 문서 | 요지 | 토픽 | 최종 커밋 |
|---|---|---|---|
| [FIGMA_PAGES](../../docs/FIGMA_PAGES.md) | **피그마→sp-php 페이지 구현 대장** — 원칙(09-06): 피그마와 동일 구현, **피그마 쪽 오류는 고치지 않고 여기에 기록**. 홈 `/`(09-18 「웹 메인」 재구현·히어로 5장·마퀴)·헤더·푸터·about·history·location 표 + 페이지별 미결(라이선스·자리표시 수치·로고 허락) **+09-21 최신 시안 재반영**(헤더 2331:30387 · about 은 Customer 섹션 제거 · history 는 가로 연혁+인증 자료 10종 · One-Stop 탭 5종+PCB 드롭다운 4종 · 히어로 05 공장 영상·배경 저사양 대응 · 마이페이지 쿠폰) **+10-02** 스크롤 진입 등장·로고 재대조 **+10-04 PCB 견적서(sp-vue 관리자 A4)** — 대장이 처음으로 sp-php 밖 화면을 실었다 **+10-22~11-05 개발의뢰 앱(`apps/develop`, 다른 피그마 파일 「개발 의뢰」 U7VKC9FSkojpDXqZ5qnJQN)** — 표 4행(위저드·의뢰 상세·내 의뢰·랜딩)과 절마다 "피그마와 다르게 둔 것 · 결정(사용자 결정 날짜)" + 10-29 시안 업데이트 · 11-03 앱 셸 확장 · **'시안 요청(디자이너에게)' 절**(④ 메뉴 구성 불일치 · ② 진행 현황·문서 탭 · ③ 명세서 분야 아이콘) · 랜딩 히어로 영상 → 캔버스 프레임 재생(`ops/scripts/hero-frames.mjs`) **+11-09 미커밋 1줄**: 공용 헤더 '개발' → `/develop/`(me_code 10 링크 — DB 값이라 커밋으로 안 간다)(283줄) | [theme-sp-lite](theme-sp-lite.md) · [sp-vue-web](sp-vue-web.md) · [sp-develop-web](sp-develop-web.md) | 2026-11-05 (+11-09 미커밋 1줄) |
| [ADMIN_NEXT_UI](../../docs/ADMIN_NEXT_UI.md) | **관리자 리뉴얼(shadcn-vue) 정본**(186줄, 10-06 최초) — 새 화면은 `apps/web/src/next/` 에만 나란히 짓고 한 번에 넘긴다. **§0 컷오버(10-10)**: 리뉴얼이 정식 `/app/admin/*`, 옛 화면은 지우지 않고 `/app/admin/legacy/*`(`admin-legacy-*`), 견적관리·재능마켓은 옛 셸 그대로. §2 디자인 결정표 · §5 `@shadcn/lint` 0.2.0 고정 · §6 화면 작성 규약 · §7 키트(common·pcb) · §8 통합 때 정한 것(lint 계약·`print/` 예외·배지 색은 모듈마다 한 곳) · §9 `pnpm lint:next`(`next-ui-audit.mjs`) · §10~12 SmartBOM·통합·개발 모듈 + 모듈별 "컷오버 때 e2e 에서 고칠 것" | [sp-vue-web](sp-vue-web.md) · [testing](testing.md) | 2026-10-10 |
| [MYPAGE_REDESIGN](../../docs/MYPAGE_REDESIGN.md) | 마이페이지·공용 계정 사이드바 피그마 재설계(08-25) + **09-15 카드형 사이드바가 08-25 평면 레이아웃을 대체**, 주문내역 PCB/부품 탭(판별키 it_id), ⚠ `.nav_badge` 는 숫자만(e2e 파싱) | [theme-sp-lite](theme-sp-lite.md) | 2026-09-15 |
| [CONTACT_INQUIRY](../../docs/CONTACT_INQUIRY.md) | 회사 위치+Contact Us 검토 메모 — **결정 대기**(09-06). 접수 경로 A 게시판/B PHP/**C sp-node(추천)** 비교, MVP 범위. `/location` 은 Contact Us 제외로 구현됨 | [theme-sp-lite](theme-sp-lite.md) · [sp-node-api](sp-node-api.md) | 2026-09-06 |
| [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md) | 페이지별 SEO 설계 정본 — `sp_seo`+테마 head 전역변수 매칭(옵션 B) | [theme-sp-lite](theme-sp-lite.md) | 2026-07-10 |
| [review-naming](../../docs/review-naming.md) | "고객후기" 개명 + 별점후기 `/reviews` | [theme-sp-lite](theme-sp-lite.md) | 2026-07-10 |
| [wishlist-hidden](../../docs/wishlist-hidden.md) | 위시 진입점 숨김(`SP_USE_WISHLIST`). 08-27 헤더 아이콘 3개(마이페이지 추가) 문구만 갱신 | [theme-sp-lite](theme-sp-lite.md) | 2026-08-27 |
| [LEGACY_SITE](../../docs/LEGACY_SITE.md) | 프로덕션 원본 구조·콘텐츠 스냅샷(07-02) | [theme-sp-lite](theme-sp-lite.md) | 2026-07-02 |
| [AI_WORKFLOW_PLAYBOOK](../../docs/AI_WORKFLOW_PLAYBOOK.md) | 작업 방식(직접/위임/병렬) 결정 기준·품질 게이트·실증 로그(07-04~07-22). 모든 지시서가 "먼저 읽을 것"으로 지목 | (횡단) [testing](testing.md) | 2026-07-22 |

### 우선순위 규칙 — 같은 주제를 두 곳이 말할 때

- **정본 선언 + "§정정 우선"** — SMARTBOM_PARTNER_RFQ §5.1 > 본문 · AI_DEV_REVIEW §13 > §12 > §1~§11 · DEVELOP_FLOW §13.6(간소화) > §13 본문, §7.2.1(v2) > §7.2 · PARTNER_PARTS §1.5 재결정 > §0 P1 · MYPAGE_REDESIGN 09-15 사이드바 > 08-25 · ADMIN_NEXT_UI §0(컷오버 뒤 경로·이름) > §1·§10~§12 의 `/app/admin/next/*`·`admin-next-*` 서술 · PCB_PARTNER_TRACK 「D20 P4」(의견 번역) > P2-9·PCB_EQ_AI_PROBE §10("번역은 넣지 않는다") · SMARTBOM §6.41~6.44 > §0 D7 "KRW 단일"·D4 "마스터딜러는 스키마만"(둘 다 "후속"이라 적어 둔 것의 구현) · **DEVELOP_FLOW §7.2.3(10-30 메뉴 6장·분야 7) > §7.2.1 v2 메뉴(PCB·기구·앱·서버 복수)**, §7.2 안에서도 뒤 절이 앞 절을 고친다(§7.2.6 이 §7.2.3 의 PCB 7문항·§7.2.4 의 "PCB 도 AI 맞춤 질문"을, §7.2.5 가 §12 '출력하기'의 A4 가로를 바꿈) · DEVELOP_FLOW §5.1(11-04~06) > §5 옛 서술(붙여넣기 파싱·VAT '포함'·`getShopEstimateProfile` — 11-04 에 §5 본문도 고쳐 썼다) · §12 '출력하기' 하위 줄은 뒤 줄 > 앞 줄(11-06 견적서 섹션 ① → 같은 날 삭제) · FIGMA_PAGES 개발의뢰 10-29 절·'시안 요청 ④' 10-30 갱신 > 위저드 절 "스텝1 메뉴 = 계약 5개 유지"(10-22, 취소선 없이 남음) · 계약 `develop-areas.ts`(현행) > `prototypes/develop-menu-questions-plan.html`(10-30 스냅샷 — 11-02 이후 바뀐 질문이 없다).
- **대체 표식** — AI_DIAGRAM 은 헤더에서 AI_DEV_REVIEW 로 넘긴다. bom-quote-code-review 는 BOM_QUOTE "알려진 한계"에 자리를 넘겼다.
- **문서 밖이 정본인 경우** — PCB 레거시 통화 모델은 코드·DDL 헤더 주석(legacy-smartbom README·PCB_PARTNER_TRACK §7 L10) · 프롬프트는 코드 버전 태그(AI_DEV_REVIEW · DEVELOP_FLOW §7.2.4 "프롬프트 코드 정본 `develop-area-followup.ts`, `develop-area-followup.v5`") · 이관 처분표는 `manifest.ts` · 초기화 보존 정책은 `reset-data-policy.ts` · 계약 사전은 `@sp/api-contract`(개발의뢰 세부 질문 문구·선택지 포함) · 견적서 발신처는 계약 상수 `DEVELOP_QUOTE_SUPPLIER` · **DB 데이터(헤더 메뉴 링크 `g5_menu`)와 git 밖 파일(`data/dbconfig.php` 한 줄)은 정본이 각 서버에 있다** — 문서(FIGMA_PAGES·DEPLOY STEP 5 (d))는 "무엇을 넣었어야 하는가"의 기록일 뿐이다.
- **트랙 간 위임** — PARTNER_PORTAL(IA·셸) ↔ SMARTBOM_PARTNER_RFQ(BOM 업무) ↔ PCB_PARTNER_TRACK(PCB 업무) ↔ PARTNER_PARTS(보유 부품) ↔ MAIL_LOG(발송)가 서로 "정본은 저쪽"으로 가리킨다.

## Talks To — 문서 간 참조 관계 [coverage: high — 52 sources]

- **개발의뢰 2막(10-22~11-06)**: DEVELOP_FLOW(정본 — 규칙·저장·검증) ↔ FIGMA_PAGES 개발의뢰 4절(화면이 시안과 다른 이유·사용자 결정·디자이너에게 보낼 시안 요청)이 같은 커밋에서 같이 고쳐지고(위저드·랜딩·앱 셸·출력물), DEVELOP_FLOW §7.2 화면 표가 "기록 `docs/FIGMA_PAGES.md`"로 넘긴다. `prototypes/develop-menu-questions-plan.html`(세부 질문 확정본) ← 계약 `develop-areas.ts` 머리 주석·DEVELOP_FLOW §7.2.3·§7.2.6. §5.1 견적서는 PCB 견적서(`EstimateSheet.vue` — FIGMA_PAGES 10-04)·BOM 견적서·상업송장 엑셀(SMARTBOM)을 비교해 정했고, 11-06 '통합 견적서 서식'은 피그마 「통합 견적서」(285:18)를 따른다. ADMIN_NEXT_UI §12 ↔ DEVELOP_FLOW §7.3·§5.1(연락처 수정·견적 편집기가 새·옛 관리자 화면 둘 다). DEVELOP_FLOW §15(10-07 미결 23건)는 이번 기간 어느 절도 해소를 적지 않았다.
- **DEPLOY_CENTRAFAB STEP 5 (d) ↔ `spcb/lib/legacy-session-pick.php` 머리 주석(10-22)**: 코드 머리가 "불러오는 곳 data/dbconfig.php · 걸리는 곳 · 걷어낸다"를, 런북이 넣을 한 줄·전제·확인·걷어내는 때를 적어 서로를 가리킨다. 같은 날 커밋(d870ce057) 하나에 둘이 같이 들어갔다.
- **D20 사슬(10-11)**: PCB_PARTNER_TRACK 「D20 설계」(정본) ← PCB_EQ_AI_PROBE(모델·프롬프트 근거, §8 운영 반영 목록). 형식 선례는 SMARTBOM §6.39 D43(요청 1건 = 문항 N × 선택지 + 대리 회신 + 넓은 오른쪽 패널)이고, 바탕은 PCB D16 원장 `sp_pcb_eq_review` — 상태 머신을 포크하지 않고 원장을 회차로 넓혔다.
- **외화·마스터딜러(10-09)**: legacy-smartbom/currency-link-model-redesign(링크별 통화 원문) → PCB_PARTNER_TRACK D1·D2·D15 → SMARTBOM §6.41~6.44(D45~D48 — "PCB 와 같은 모양·같은 규칙", 다만 하위 발주만 별도 표) ↔ PARTNER_PORTAL §5.1(하위 등록·맡길 트랙, 진행 중 판정이 두 트랙을 함께 센다 — D47-9). PCB_PARTNER_TRACK 「하위 협력사 직접 관리·대리 접속」은 정책 정본을 PARTNER_PORTAL §5.1·§5.2 로 넘긴다.
- **관리자 리뉴얼(10-06~10-10)**: ADMIN_NEXT_UI §12 ↔ DEVELOP_FLOW §15(리뉴얼 중 찾은 프로세스 결함을 도메인 정본에 미결로 넘김) · ADMIN_NEXT_UI §10 → SMARTBOM §6(확정가 입력 방식을 옛 화면에도 같은 날 반영) · BOM_QUOTE 「취소와 보존 기간」의 "삭제 기록" 화면 = ADMIN_NEXT_UI §11 통합 모듈 범위 · FIGMA_PAGES PCB 견적서(`EstimateSheet`) = ADMIN_NEXT_UI §8 이 "그대로 import 해도 되는 유일한 예외"로 둔 옛 인쇄 문서.
- **GERBER_SUBMIT_GUIDE.html → GERBER_ORDER_FLOW §3**: 전달물은 뷰어 쪽 호출 순서·사양 키만, 서버 동작은 정본. 가이드의 예시 호스트가 `new.samplepcb.co.kr` — 사라진 subdomain 문서가 다루던 도메인이고, 가이드 커밋(10-21) 다음 날 DEPLOY STEP 5 (d) 가 바로 그 호스트의 `/spcb/api/me` 401 을 다뤘다. GERBER_ORDER_FLOW ㉒ ↔ SMARTBOM §6.39(D43): 추가결제 앵커 `sp-bom-extra` 는 ⑲ 마켓 계약과 동형.
- **협력사 트랙 4각**: PCB_PARTNER_TRACK 은 SMARTBOM_PARTNER_RFQ 를 "자매 정본·자산 재사용 전제"로, legacy-smartbom 을 회수 자료로 지목. SMARTBOM §6.19→MAIL_LOG, §6.36→PARTNER_PARTS, §4→PARTNER_PORTAL 로 정본을 넘긴다. PARTNER_PORTAL §7 이력은 PCB 발송 박스 재구성(PCB_PARTNER_TRACK §9)을 선행으로 적는다.
- **BOM_QUOTE ↔ PARTS_SEARCH ↔ PARTNER_PARTS ↔ BOM_INGESTED_RC_EXPERIMENT**: 카탈로그 우선 조회(부품 유형 기준)·`catalog_selected` 문의 견적·협력사 원장 뒤순위 주입이 네 문서에 걸쳐 서술. 판정은 항상 sp-engine — [judgment-single-owner](../concepts/judgment-single-owner.md). BOM_SERVICE_API 는 BOM_QUOTE 의 회원 라우트를 서비스 액터로 재노출한 것(SMARTBOM §6.37).
- **AI 계보**: AI_DIAGRAM(07-12) → AI_DEV_REVIEW(08-28 대체) → DEVELOP_FLOW(마켓 레지스트리 `market-areas.ts`·`market-dev-review.ts` 재사용, `develop.*` 유스케이스 별도 행) → prompts/dev-review-*(마켓 구현)·prompts/develop-*(개발의뢰 구현). MARKET_FLOW §11.4 는 검토서 갱신을 "선택"으로 두며 AI_DEV_REVIEW 를 가리킨다.
- **개발의뢰 3부작**: DEVELOP_FLOW(정본) ← develop-prototypes(G/C 정리, 원복 태그) ← db-snapshot-rollback(같은 원복 절차 공유). DEVELOP_FLOW §12 결정 로그가 둘을 링크한다.
- **운영 런북 사슬**: DEPLOY_CENTRAFAB STEP 6 시드 ↔ LEGACY_DB_MIGRATION 게이트 ⑥(템플릿 5종) ↔ GERBER_ORDER_FLOW 기법 #1(앵커 상품) — 같은 5종 사전을 세 문서가 미러. DEPLOY·LEGACY_DB_MIGRATION 둘 다 legacy-production-reimport 로 재이관을 위임하고, reimport 는 db-snapshot-rollback 의 restore 를 원복으로 쓴다.
- **UPSTREAM_SYNC → LEGACY_DB_MIGRATION §8**: 코어 한 줄 수정(이메일 아이디 로그인)이 subtree pull 로 지워지면 이관 회원 수천 명이 로그인 불가 — 가드 스크립트가 두 문서를 잇는다. DELIVERY_METHOD 도 같은 가드에 주문서 코어 수정 4건을 등록했다.
- **GERBER_ORDER_FLOW ↔ DELIVERY_METHOD / GERBER_PRICE_MODE / MYPAGE_REDESIGN**: g5 접근 카탈로그가 배송방법 컬럼·세액 표시·주문내역 탭의 read/write 근거. **GERBER ↔ MARKET_FLOW ↔ DEVELOP_FLOW §10**: 카탈로그 ⑲ 마켓 결제 패턴을 개발의뢰 앵커 `sp-develop-svc` 가 그대로 재사용 — [snapshot-freeze](../concepts/snapshot-freeze.md).
- **FIGMA_PAGES ↔ CONTACT_INQUIRY ↔ MYPAGE_REDESIGN**: 피그마 대장이 페이지 표를, CONTACT 가 미결 결정을, MYPAGE 가 계정 셸을 맡는다. 셋 다 "코어 비수정, 전부 테마" — [core-nonmodification](../concepts/core-nonmodification.md).
- **이전 컴파일(07-27)에서 유지되는 쌍**: BOM_QUOTE→DB_TUNING 순환 참조 · prompts/sp-engine-candidate-decision→BOM_QUOTE/PARTS_SEARCH · GERBER_PRICE_MODE→pricing-engine-parity↔body-cases · SEO_MANAGEMENT→review-naming · LEGACY_DB_MIGRATION↔review-naming(sp_review 61건) · AI_WORKFLOW_PLAYBOOK→HANDOFF.md(커밋 금지).

## API Surface — 문서 읽기 진입 규칙 [coverage: high — 54 sources]

"어떤 질문에 어떤 문서를 먼저 여는가". 정본을 연 뒤 §정정 우선 절을 확인하고, 구현 기록(여정·P번호)은 날짜 역순으로 읽는다.

| 질문 | 먼저 열 문서 | 그다음 |
|---|---|---|
| 협력사 RFQ·발주·선적·송금이 어떻게 흐르나 | SMARTBOM_PARTNER_RFQ §0 결정표 → §5.1 → §6.x(BOM) / PCB_PARTNER_TRACK §5·§6 → §9 P번호(PCB) | PARTNER_PORTAL(진입·셸), MAIL_LOG(알림) |
| 협력사가 외화로 회신·송금한다 / 마스터딜러가 하위에 넘긴다 | SMARTBOM §6.41~6.44(BOM) · PCB_PARTNER_TRACK D1·D2·D15(PCB) | PARTNER_PORTAL §5.1·§5.1.1, legacy-smartbom/currency-link-model-redesign(원문) |
| PCB EQ(제조 확인)를 고객에게 문항으로 묻는다 / AI 초안이 이상하다 | PCB_PARTNER_TRACK 「D20 설계」 → P1~P4·후속 기록 | PCB_EQ_AI_PROBE §2 결론·§6 실패 유형·§7.2 역할 분담 |
| 결제 뒤 부품·금액·납기가 바뀌었다 | SMARTBOM §6.39(D43)·§6.40(D44) | GERBER_ORDER_FLOW 카탈로그 ㉒ |
| 관리자가 협력사 자리에서 포털을 쓴다 | PARTNER_PORTAL §5.2 | PCB_PARTNER_TRACK 「하위 협력사 직접 관리 · 관리자 대리 접속」 |
| 관리자 화면(`/app/admin`)을 만들거나 고친다 | ADMIN_NEXT_UI §0(지금의 경로) → §6 규약·§7 키트 | §9 `pnpm lint:next`, 모듈별 "e2e 에서 고칠 것"(§10·§11·§12) |
| BOM 견적을 취소·삭제하면 어떻게 되나 | BOM_QUOTE 「취소와 보존 기간」 | SMARTBOM §6.14(관리자 Case 영구 삭제) |
| 거버 뷰어에서 플랫폼으로 담기를 붙인다 | GERBER_SUBMIT_GUIDE.html(전달물) | GERBER_ORDER_FLOW §3(서버 정본) |
| 어떤 결함이 언제 어떻게 고쳐졌나 | PCB_PARTNER_TRACK §9 "완주 여정 N호" · SMARTBOM §6.2x "D3x 완주" · DEVELOP_FLOW §13.6 | 커밋 메시지의 `(§6.15)` 식 절 번호 |
| BOM 견적 후보가 왜 이렇게 선정됐나 | BOM_QUOTE "판단 단일화"·"엔진 조달 판단 투영"·"구매 불가 대체품" | prompts/sp-engine-candidate-decision, PARTS_SEARCH, BOM_INGESTED_RC_EXPERIMENT, PARTNER_PARTS §4 |
| 외부 시스템에서 BOM 견적을 뽑고 싶다 | BOM_SERVICE_API | SMARTBOM §6.37 |
| 주문 상태·배송·취소·세액이 어디서 결정되나 | GERBER_ORDER_FLOW 5장 카탈로그 ⑬~⑯ | DELIVERY_METHOD, GERBER_PRICE_MODE, order-notify-gating |
| 가격이 라이브와 어긋난다 | pricing-engine-parity(가격표 드리프트 1순위) | body-cases, GERBER_PRICE_MODE |
| AI 검토서·구성도를 바꾸려 한다 | AI_DEV_REVIEW §13 → §12 | prompts/dev-review-phase3·4a·4b, DEVELOP_FLOW §6(develop 은 관리자 주도) |
| 개발의뢰(sp-develop)를 만진다 | DEVELOP_FLOW §1~§4 → §8 API 지도 → §13·§14 → §15(미결 23건 — 알려진 구멍) · 위저드는 §7.2.1 → §7.2.3~§7.2.9(날짜순 — 뒤 절이 앞 절을 고친다) | prompts/develop-*, develop-prototypes(옛 경로·원복), ADMIN_NEXT_UI §12(관리자 화면), FIGMA_PAGES 개발의뢰 4절(화면) |
| 개발의뢰 견적서(산출 내역·인쇄·엑셀·PDF)를 고친다 | DEVELOP_FLOW §5.1 '견적서 서식'(+§5 본문 — 둘 다 11-04 판) | FIGMA_PAGES 의뢰 상세 '견적서'(고객 카드) · PCB 견적서 대장 행(10-04, 모양 언어) · ADMIN_NEXT_UI §12 |
| 개발의뢰 메뉴·세부 질문·AI 맞춤 질문을 바꾼다 | DEVELOP_FLOW §7.2.3(메뉴·질문 구조) → §7.2.4(AI 맞춤 질문·롤백 스위치) → §7.2.6~§7.2.9(PCB·회로·시스템개발 범위) | 계약 `develop-areas.ts`(문구 정본) · `prototypes/develop-menu-questions-plan.html`(10-30 확정본 — 검토 경위·회신 결과) · 프롬프트 코드 정본 `develop-area-followup.ts` |
| 의뢰 출력물('출력하기')이 이상하다 | DEVELOP_FLOW §12 결정 로그 2026-10-22 '출력하기'(하위 줄 날짜순 — 11-05 쪽 나누기, 11-06 시안 재대조·섹션 삭제) · §7.2.5 8번(PPT 4:3) | FIGMA_PAGES 의뢰 상세 '출력하기' |
| 개발의뢰 화면이 피그마와 다르다 / 디자이너에게 무엇을 요청했나 | FIGMA_PAGES 개발의뢰 4절 '피그마와 다르게 둔 것' | 같은 문서 '시안 요청' 절(④ 메뉴 구성·② 진행 현황 탭·③ 명세서 아이콘) |
| `new.samplepcb.co.kr` 에서 g5 로그인은 됐는데 `/app` 이 익명이다(`/spcb/api/me` 401) | DEPLOY_CENTRAFAB STEP 5 (d) | `spcb/lib/legacy-session-pick.php` 머리 주석 · [spcb-bridge](spcb-bridge.md) Gotchas |
| 마켓 의뢰를 등록 뒤 고칠 수 있나 | MARKET_FLOW §11 | AI_DEV_REVIEW(검토서 stale) |
| 운영 서버를 세우거나 재배포한다 | DEPLOY_CENTRAFAB(STEP 6 시드 생략 금지 · STEP 5 (d) `dbconfig.php` 한 줄 — STEP 4 재설치 뒤 다시) | db-snapshot-rollback · 새 도메인 절차 문서(samplepcb-subdomain-nginx)는 사라짐 — gitignore 된 `ops/nginx-live` 실설정을 볼 것 · 이번 기간 마이그레이션·AI 유스케이스 켜기는 DEVELOP_FLOW §5.1·§7.2.4 에만 있다(Gotchas) |
| 운영 DB 를 비우고 다시 이관한다 | legacy-production-reimport | LEGACY_DB_MIGRATION(§5-C·§2.4), db-snapshot-rollback(원복) |
| DB 가 안 열린다·느리다 | local-mysql-recovery(손상)·DB_TUNING(buffer pool) | db-snapshot-rollback |
| 그누보드 코어 패치를 받는다 | UPSTREAM_SYNC(+가드 스크립트) | LEGACY_DB_MIGRATION §8 |
| 피그마 페이지를 옮긴다 / 피그마가 이상하다 | FIGMA_PAGES(원칙+대장 — 개발의뢰 앱 화면도 같은 대장, 다른 파일 「개발 의뢰」) | MYPAGE_REDESIGN, CONTACT_INQUIRY, SEO_MANAGEMENT |
| 포털 문구·언어를 바꾼다 | partner-i18n | PARTNER_PORTAL §3.1 셸 · §7 이력 10-11 한국어 어휘 규칙(`선적`) |
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

2026-10-12 현재도 14종 그대로다 — 09-19 이후 `docs/prompts/` 에 추가·변경이 없다(이번 기간의 D20·관리자 리뉴얼·외화/마스터딜러는 `docs/prompts/` 에 지시서를 남기지 않았다 — 기록은 정본 문서의 설계 절·구현 기록뿐). → 2026-11-09 현재도 14종이다 — 개발의뢰 2막(10-22~11-06)도 지시서 대신 정본 절(DEVELOP_FLOW §5.1·§7.2.3~§7.2.9)과 검토용 HTML(`prototypes/develop-menu-questions-plan.html`)로만 남겼다. 그래서 `prompts/develop-*` 10종이 적은 위저드(3스텝·v2 5스텝·메뉴 PCB·기구·앱·서버)와 견적 편집기(붙여넣기 파싱)는 지금 코드와 다르다 — 지시서는 그 시점 계약이다.

지시서가 정본이 아니라 **정본을 구현 단위로 자른 뷰**라는 점이 중요하다 — 정본은 뒤에 갱신되고(예: wizard-v2a 는 "브리프 작성 시점엔 정본이 v1"), 지시서는 그 시점 계약으로 남는다. 관련 데이터 문서: 문서군이 정의하는 테이블 소유권(`sp_*`=sp-node Prisma, 공유 DB `prisma migrate reset` 금지)은 GERBER_ORDER_FLOW 5장·AGENTS.md 가 정본이고, 07-27 판의 BOM·부품·마켓 데이터 요약은 각 토픽([sp-node-api](sp-node-api.md)·[parts-engine](parts-engine.md))으로 옮겼다.

## Key Decisions — 문서 관례의 변화 [coverage: high — 34 sources]

- **2026-11-04~06 (DEVELOP_FLOW §5.1·§12)**: 같은 날 넣었다가 뺀 기능도 지우지 않고 절에 **"넣었다가 뺐다"** 로 남긴다 — 내부 원가(`costPrice`·`vendor`·마진)는 추가·삭제 마이그레이션 2본(`20261104150000_develop_quote_item_cost` → `20261104200000_develop_quote_drop_item_cost`, "둘 다 운영 미배포라 운영에선 더했다가 바로 지운다")·라우트 404 까지 적었다. 독립 리뷰는 "6건 중 5건 반영"과 **"고치지 않은 1건(사용자 결정)"** 을 같은 줄에 둔다(마이그레이션 전 옛 견적의 항목별 기간이 '1식'으로 보이는 것 — [exception-ledger](../concepts/exception-ledger.md)). 문서가 스스로 옛 문장의 오류를 밝힌다("예전 문장 '회사 정보는 `getShopEstimateProfile`'은 실제 코드와 달랐다"). 결정 로그 '출력하기'는 항목 하나 아래 하위 줄을 날짜순으로 쌓고 뒤 줄이 앞 줄을 뒤집는다(10-22 A4 가로 → 10-30 PPT 4:3 → 11-05 쪽 나누기 교정 → 11-06 시안 재대조 → 같은 날 견적서·진행 · 문의 섹션 삭제).
- **2026-10-30 (prototypes/develop-menu-questions-plan.html · DEVELOP_FLOW §7.2.4)**: 비개발자 검토는 **HTML 검토 요청서**로 내고, 회신을 받으면 같은 파일을 확정본으로 고쳐 질문 전문(51문항)과 회신 결과를 한 곳에 둔다 — 검토자가 보낸 정리본은 보관하지 않고(사용자 결정), 계약 머리 주석이 확정본을 가리킨다. 시험 운영 기능(§7.2.4 AI 맞춤 질문, 사용자 "일단 해보고 퀄리티 안 나오면 롤백")은 절 끝에 **롤백 방법**(운영 = 관리자 AI 설정 끄기, 코드 = 되돌릴 커밋 3개 해시)을 적는다.
- **2026-10-22~11-05 (FIGMA_PAGES 개발의뢰 절)**: 대장이 **다른 피그마 파일**(「개발 의뢰」)과 테마 밖 앱까지 넓어졌다. 페이지마다 "피그마와 다르게 둔 것 · 결정(사용자 결정 날짜)" + 시안 쪽 실수는 "시안 오류(디자이너 확인)"로, 시안이 없는 곳은 **"시안 요청(디자이너에게)" 절**(위치·지금 모양·실데이터 예시·필요한 요소 — "시안이 오면 이 절을 지우고 위 '피그마와 다르게 둔 것'에 결과를 적는다")로 나눴다. 뒤집힌 결정은 `~~옛 결정~~ → 새 결정(날짜)` 취소선으로 같은 줄에서 넘긴다. 11-09 미커밋 줄은 DB 데이터 변경을 **"DB 데이터라 커밋으로 안 간다 — 운영·dev 도 관리자 > 메뉴설정에서"** 라고 명시한다.
- **2026-10-22 (DEPLOY_CENTRAFAB STEP 5 (d))**: 운영 임시 우회를 런북 단계로 넣을 때 **넣을 한 줄 + 재설치 때 다시 + 전제 + 확인 방법 + 걷어내는 때**를 한 묶음으로 적는다. 코드 머리 주석도 첫 줄이 "임시. 운영 교체 뒤 레거시가 심은 쿠키가 브라우저에서 사라지면 걷어낸다"다 — 우회와 그 퇴장 조건이 같은 커밋에 들어갔다.
- **2026-10-21 (GERBER_SUBMIT_GUIDE.html)**: 외부 담당자에게 넘기는 전달물은 md 가 아니라 **자족 HTML**(라이트·다크 대응, 예시 코드·호스트 입력칸)로 `docs/` 루트에 커밋한다 — 10-12 판이 짚은 "미커밋 전달물 유실 위험"이 해소됐다.
- **2026-10-11 (PARTNER_PORTAL §7 이력)**: 어휘 통일을 **규칙 4줄 + 센 숫자(출하 61·선적 15·발송 17) + "안 바꾼 것"**까지 이력에 적는다 — 바꾼 것은 한국어 표시문만(75곳), 서버 오류 문장의 "발송"은 남겼음을 명시.
- **2026-10-11 (PCB_PARTNER_TRACK D20 · PCB_EQ_AI_PROBE)**: 큰 기능을 **설계 절 → 사용자 결정표(D20-1~5·P2-1~9) → 갈래별 구현 기록(`####`) → 후속 절**로 하루에 한 문서에 쌓고, 모델·프롬프트 선택 근거는 **프로빙 문서로 분리**한다(채점식·코퍼스·실패 유형·"남은 의문"까지). 같은 날 결정이 뒤집히면(P2-9 → P4) 뒤 절이 "뒤집는다"고 적는다. 설계 절은 "상태 머신은 포크하지 않는다 — 원장을 회차로 넓힌다"를 구조 원칙으로 명문화했다.
- **2026-10-10 (ADMIN_NEXT_UI §0)**: 계획 절(§1 "옛 파일을 지운다")을 고쳐 쓰지 않고 **§0 컷오버 절을 맨 앞에 얹어** 실제 결과(옛 화면은 `/admin/legacy` 로 물림)를 적는다. 모듈 절마다 **"컷오버 때 e2e 에서 고칠 것"** 목록을 둔다.
- **2026-10-09 (SMARTBOM §6.41~6.45)**: 결정표가 **D45-1 식 하위 번호 + 근거 열**이 되고 다른 문서가 그 번호로 가리킨다(PARTNER_PORTAL → D47-9). §6.45 는 기능이 아니라 **검증 절** — 화면 동선을 밟는 상세 여정 15/15·칸마다 멈추는 흔적 주행 13/13, API 여정이 통과시킨 결함 3건.
- **2026-10-07 (DEVELOP_FLOW §15)**: 다른 작업(화면 리뉴얼) 중 찾은 프로세스 결함은 **고치지 않고 도메인 정본에 "미결" 절로 남긴다** — 항목마다 「확인」(리더가 코드 확인)·「실측」(e2e 로그)·「보고」(작업 보고, 미검증) 표식.
- **2026-10-05 (BOM_QUOTE 「취소와 보존 기간」)**: 정책이 바뀌면 새 절을 더하면서 **옛 서술 문장도 날짜를 박아 고쳐 쓴다**("취소 제외 2026-10-05") — 절 끝에 검증·알려진 한계를 둔다.
- **2026-10-04 (FIGMA_PAGES)**: 피그마 대장이 sp-php 밖으로 넓어졌다 — sp-vue 관리자 PCB 견적서도 "피그마와 다르게 둔 것(사용자 결정)" 절로 같은 대장에 싣는다.
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

- **DEVELOP_FLOW 는 미커밋 §7.2.9 를 담고 있다(2026-11-09 작업트리)** — 시스템개발 범위(앱·서버·기구를 AI 검토에서 빼기, 11-06 사용자 결정 '권장 진행') 절이 관련 코드(계약 `develop-areas.ts`·`develop-ai-source.ts`·`develop-followup.ts`·위저드 `StepQuestions.vue`·고객/관리자 상세)와 함께 미커밋이다. `git show HEAD:docs/DEVELOP_FLOW.md` 로 읽으면 §7.2.8 에서 끝난다. 절 안의 "옛 시스템개발 의뢰 중 기구설계 '준비됨·다른 업체·필요 없음'은 원천 서명이 바뀌어 검토서·구성도에 '원천 변경' 표시가 뜬다"는 배포하면 운영 데이터에서도 일어난다.
- **DB 데이터·git 밖 파일의 변경은 커밋으로 안 간다** — FIGMA_PAGES 공용 헤더 '개발' → `/develop/`(me_code 10, `g5_menu`)는 운영·dev 메뉴설정에서 각자 바꿔야 하고, 그 기록 줄조차 11-09 현재 미커밋이다. DEPLOY STEP 5 (d) 의 `data/dbconfig.php` 한 줄도 같은 성격(서버마다 손으로, 재설치 때 다시) — 문서는 "넣었어야 하는 것"의 기록이지 넣었다는 증거가 아니다([manual-sync-drift](../concepts/manual-sync-drift.md)).
- **FIGMA_PAGES 머리말이 내용과 다르다** — 제목 "피그마 → sp-php 페이지 구현 대장"·첫 줄 "「Samplepcb_Web」을 sp-lite 테마로 옮긴 페이지"·"링크(버튼·탭·로고)는 전부 비워 두었다" 셋 다 10-04(sp-vue PCB 견적서)·10-22(다른 파일 「개발 의뢰」의 `apps/develop` 화면 — 분야 카드는 위저드를 `?menu=` 로 연다, 헤더 '개발' 링크) 이후 사실이 아니다.
- **FIGMA_PAGES 위저드 절에 뒤집힌 결정이 취소선 없이 남아 있다** — "스텝1 메뉴 = 계약 5개 유지(사용자 결정)"(10-22)는 같은 문서 10-29 절의 `~~01-1 메뉴는 계약 5개 유지~~ → 2026-10-30 시안 6장대로 구현`·DEVELOP_FLOW §7.2.3 이 뒤집었다. '시안 요청 ④'도 머리 "2026-10-30 갱신"(위저드는 6장, 남은 것은 랜딩 카드뿐) 아래에 "(이하 10-29 기록) 세 곳 모두 계약 5개로 구현해 두었다"가 그대로 있다 — 갱신 줄부터 읽을 것.
- **DEVELOP_FLOW §7.2 는 뒤 절이 앞 절의 숫자·범위를 고친다** — §7.2.3 질문 수 "PCB 7(→ 2026-11-02 9, §7.2.6)·회로 8(→ 11-03 9, §7.2.7)", §7.2.4 "PCB 설계는 2026-11-02 부터 빠졌다", §7.2.5 출력물 A4 가로 → PPT 4:3. 한 절만 읽으면 옛 값을 구현하게 된다 — 절 머리 날짜와 괄호 안 "→ 날짜"를 같이 볼 것.
- **`prototypes/develop-menu-questions-plan.html` 은 10-30 스냅샷이다** — 11-02 `pcb.source` 분리(→ `pcb.schematic`·`pcb.bom`·`pcb.original`), 11-03 `circuit.pcb`('회로 설계 후 PCB 설계도 필요한가요?'), 11-06 `system.software`(미커밋)가 없다. 그런데 계약 `develop-areas.ts` 머리 주석은 여전히 "세부 질문은 … 확정본(…html, 2026-10-30)과 같다"고 적는다(11-02 부터 stale).
- **D번호는 문서마다 따로 센다** — "D20" 이 PCB_PARTNER_TRACK 에선 EQ 문항형 회차(10-11), SMARTBOM 에선 §6.3 외부공급사 발주 자동화(07-30)다. PCB_EQ_AI_PROBE 의 "D20 P2"·PARTNER_PORTAL 의 "D11 만능 대행"은 PCB 쪽, "D47-9"는 SMARTBOM 쪽. 문서 이름 없이 D번호만 적지 말 것.
- **PCB_PARTNER_TRACK 구현 기록은 `## 10. 조사 자료 색인` 뒤에도 쌓인다** — 08-15 P5 부터 10-11 '선적 완료' 확인까지 전부 §10 제목 아래에 있다(본문은 계속 "§9 구현 기록"이라 부른다). 절 번호가 아니라 `### 제목 (날짜)` 로 찾을 것. D20 은 §6 의 결정 한 문단과 뒤쪽 「D20 설계」 절 두 곳에 있다.
- **ADMIN_NEXT_UI 는 §0 이 나머지보다 우선** — §1·§10~§12 본문은 컷오버 전 경로(`/app/admin/next/*`·`admin-next-*`)와 "옛 파일을 지운다"는 계획 그대로다. 실제는 정식 경로 + 옛 화면 `/admin/legacy` 잔류이고, 견적관리·재능마켓은 리뉴얼하지 않았다(11-09 그대로 — ADMIN_NEXT_UI 는 10-10 이후 무변경).
- **PCB_EQ_AI_PROBE 는 그날 결정의 스냅샷** — §10 "고객 의견 역번역 = 넣지 않는다(P2-9)"는 같은 날 D20 P4 가 뒤집었는데 프로빙 문서엔 반영되지 않았다. §8-8 이 갱신 대상으로 꼽은 `docs/AI_DIAGRAM.md` 유스케이스 표에도 `pcb.eq-parse` 는 없다(AI_DIAGRAM 은 08-29 이후 무변경, 그 자신이 대체된 문서). 11-09 그대로 — 이번 기간 새 유스케이스 `develop.area-followup` 도 AI_DIAGRAM 표엔 없고 DEVELOP_FLOW §7.2.4 에만 있다.
- **포털 한국어 어휘의 정본은 PARTNER_PORTAL §7 이력(10-11)** — `partner-i18n.md`(09-06) 표현표는 "출하 준비·출하 완료 내역·출하 편성"이고, PCB_PARTNER_TRACK 「선적 완료 확인」 절(같은 날 먼저 커밋)도 `출하 준비`·`출하 완료 내역`으로 남아 있다. 지금 화면은 `선적 관리` — [manual-sync-drift](../concepts/manual-sync-drift.md). (11-09 그대로 — 두 문서 모두 이번 기간 무변경.)
- **GERBER_ORDER_FLOW 카탈로그 번호가 ⑲ 다음 ㉒** — ⑳(메인 슬라이드)·㉑(개발의뢰 앵커)은 이 문서에 없고 `apps/api/src/lib/g5-db.ts` 주석에만 있다(11-09 그대로).
- **이번 기간의 운영 반영 항목이 한 곳에 모여 있지 않다** — 마이그레이션 12본(`20260930120000_add_bom_confirm_request` ~ `20261011150000_pcb_ship_confirm`)과 시드 1회(`smartbom:seed-extra-anchor`)의 이름이 SMARTBOM·PCB_PARTNER_TRACK·PARTNER_PORTAL·BOM_QUOTE·GERBER_ORDER_FLOW 다섯 문서에 흩어져 있고, 런북 DEPLOY_CENTRAFAB(09-16)에는 목록이 없다. → 11-09 에도 그대로이고 더 늘었다 — 10-12 이후 마이그레이션 +4본(`20261104120000_develop_quote_breakdown`·`20261104150000_develop_quote_item_cost`·`20261104200000_develop_quote_drop_item_cost`·`20261104200100_develop_labor_presets`, 이름은 DEVELOP_FLOW §5.1 에만)과 운영에서 켜야 하는 AI 유스케이스 `develop.area-followup`(기본 꺼짐, §7.2.4). DEPLOY_CENTRAFAB 에 새로 들어간 것은 STEP 5 (d) 의 dbconfig 한 줄뿐이고, STEP 5 예시 `SPCB_BRIDGE_URL=https://centrafab.co.kr/spcb/api/me`(sp-node 는 이 값 뒤에 `/spcb/api/order-notify` 를 붙인다 — 09-19 판부터 지적)도 그대로다.
- **FIGMA_PAGES 표의 "커밋" 칸 6행이 `(이번 변경)`/`(이번 커밋)` 그대로** — 해시가 채워지지 않았다(`git log -- <파일>` 로 찾을 것). → 11-09 **10행**(개발의뢰 4행도 `(이번 변경)`으로 추가됐다). 09-21 변경을 10-02 가 되돌린 항목(3 EYES 하단 여백)은 "이전 변경(… 위 복원으로 대체됨)" 줄과 같이 읽는다. 홈 통계 줄이 가리키는 "연혁 페이지 `$sp_stats` 관례"는 09-21 연혁 재편으로 `history.php` 에서 사라졌다.
- **미커밋 문서는 지도에서 먼저 사라진다** — samplepcb-subdomain-nginx 는 미커밋인 채 없어져 git 으로도 되살릴 수 없다. ~~`GERBER_SUBMIT_GUIDE.html` 이 지금 같은 상태다~~ → 10-21 커밋돼 해소(1eef681a7). `docs/prototypes/develop-workflow-simple.html`(09-11 커밋, "개발프로젝트 간편 관리서식")은 ~~어느 md 도 링크하지 않는다~~ → 마크다운 링크는 없지만 DEVELOP_FLOW §13 머리가 "보관본 `docs/prototypes/develop-workflow-simple.html`" 로 경로를 적어 가리킨다(10-12 판 서술 정정 — 09-11 부터 그랬다). 반대 방향의 짧은 생애도 있다 — 검토자 정리본 자리 `prototypes/development_questions_final.html`(8줄)은 3511dc041 에 들어왔다가 같은 날 3b1a596f9 에서 지워졌다(사용자 결정 "보관하지 않는다") — 이력에만 있다.
- **큰 문서는 절 번호가 커밋 메시지의 키다** — `feat(bom): … (§6.15)` 처럼 SMARTBOM·PCB 절 번호가 커밋에 박힌다. 절을 재번호하면 이력이 끊긴다. SMARTBOM 에는 **§6.35·§6.36 이 두 번씩** 있다(바코드 입고/전 구간 상태 실측, 보유 부품/고객 진행 표시) — 절 번호만으로 링크하지 말고 제목을 같이 적을 것.
- **DEVELOP_FLOW §14 가 가리키는 `docs/prompts/develop-workflow-c-module.md` 는 리포에 없다** — 커밋 258407333 에서 추가됐다가 프로토타입 정리·main 재작성(09-11)에서 사라졌다. 태그 `proto-gc-coexist-20260910` 에서만 볼 수 있다(11-09 그대로 — §14·§15 는 이번 기간 무변경).
- **정본 헤더의 "정정 우선" 절을 건너뛰면 옛 설계를 구현하게 된다** — SMARTBOM §3.4 "AdminBomQuote 재사용"은 §5.1 이 부적합 판정, PARTNER_PARTS P1 "카탈로그 분리"는 §1.5 가 하이브리드로 뒤집음, MYPAGE 08-25 사이드바는 09-15 가 대체.
- **지시서는 그 시점의 계약** — develop-wizard-v2a 는 "정본은 아직 v1 서술, 이 브리프가 우선"이라 적고, 뒤에 DEVELOP_FLOW §7.2.1 이 따라왔다. 지시서를 읽을 땐 정본의 같은 § 날짜를 대조할 것.
- **레거시 자료 우선순위(PCB_PARTNER_TRACK §7 L10)** — 레거시 위키는 06-20 이후 30여 커밋이 빠져 "USD 단일 정본"처럼 정반대 서술이 남아 있다. 회수 자료 `currency-link-model-redesign.md` §7 DDL 도 일부 미구현 — 코드가 정본.
- **운영 스키마는 sync 가 나르지 않는다**(DELIVERY_METHOD §4) — 문서에 DDL 이 적힌 컬럼은 운영에 수동 실행, `SET SESSION sql_mode=''` 선행, DDL 먼저·배포 나중.
- **이관 앵커 집합을 `ctId IS NULL` 로 좁히면 라인·spec 중복 삽입**(LEGACY_DB_MIGRATION §5-C, 08-05 실측) — 전 spec 의 quoteId 집합을 실어야 멱등.
- **subtree pull 은 코어 한 줄 수정을 충돌 없이 되돌린다**(UPSTREAM_SYNC) — pull 직후 `check-core-patches.sh` 를 안 돌리면 이관 회원 로그인 불가가 조용히 재발.
- **ES 유령 문서**(PARTS_SEARCH 08-16) — 인제스트는 upsert 만 하고 DB 에서 사라진 문서를 청소하지 않는다. 같은 점수 두 문서 중 유령이 먼저 잡히면 상세 404. 정기 정합 점검은 미착수.
- **`.nav_badge` 안에는 숫자만**(MYPAGE_REDESIGN) — e2e 가 textContent 를 `Number()` 로 파싱한다. 단위는 `.nav_unit` 으로.
- **FIGMA_PAGES 의 자리표시 수치·워터마크 사진·로고 허락**은 운영 전 체크리스트다 — 홈 통계 6,600+·17,000+·70%, Unsplash+ 프리뷰 2장, 로고 20여 종. 개발의뢰 쪽에도 같은 부류가 늘었다 — 아이콘 operational-system·milestone·deal·자물쇠(Flaticon 계열로 보임 — 출처 표기 의무 미결 ③), 역설계 카드 사진(레이어 이름이 화면 캡처 — 구매본 교체 디자이너 확인), 포트폴리오 시안의 근거 없는 통계(다음 단계로 미룸).
- **local-mysql-recovery 의 `mysql-system-before.sql` 은 불완전 덤프** — 복구용으로 쓰지 말 것. 성공 덤프는 `all-databases.sql`(회원·인증 정보 포함, 공유·커밋 금지).
- **db-snapshot restore 는 DB 전체를 되돌린다** — 회원·주문·`_prisma_migrations` 까지. 코드 원복 후 서버를 켜야 migration 이 재적용되지 않는다.
- **MAIL_LOG 재발송은 quick_mail 만** — 자동 알림은 각 트랙의 재발송 수단이 정본(회신 재발송·견적서 버튼·매직링크 재발급).
- **이전 컴파일(07-27)에서 유지**: 대량 cascade 삭제 P2028→무트랜잭션 가드 청크 · buffer pool 은 `mysql\bin\my.ini` 가 실제 로드 파일 · 구매 조건 키 v1 SKU 축약 충돌 · 제조사 별칭은 소급 안 됨(`parts:merge-mfr`) · Ollama 비스트림 타임아웃(`stream:true`) · HANDOFF.md 커밋 금지 · 위임 지시서 허점은 그대로 구현된다(이탈 보고가 역방향 검증).

## Sources [coverage: high — 60 sources]

- [../../docs/ADMIN_NEXT_UI.md](../../docs/ADMIN_NEXT_UI.md)
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
- [../../docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) (2026-10-22 STEP 5 (d))
- [../../docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) (2026-11-06 커밋 + §7.2.9 미커밋 — 2026-11-09 작업트리)
- [../../docs/develop-prototypes.md](../../docs/develop-prototypes.md)
- [../../docs/FIGMA_PAGES.md](../../docs/FIGMA_PAGES.md) (2026-11-05 커밋 + 공용 헤더 1줄 미커밋 — 2026-11-09 작업트리)
- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/GERBER_PRICE_MODE.md](../../docs/GERBER_PRICE_MODE.md)
- [../../docs/GERBER_SUBMIT_GUIDE.html](../../docs/GERBER_SUBMIT_GUIDE.html) (md 아닌 전달물 — 10-12 판엔 미커밋, 2026-10-21 커밋)
- [../../docs/LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md)
- [../../docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md)
- [../../docs/legacy-production-reimport.md](../../docs/legacy-production-reimport.md)
- [../../docs/legacy-smartbom/README.md](../../docs/legacy-smartbom/README.md) (+ smartbom-bom-pcb-uml.html · legacy-pcb-ddl.sql)
- [../../docs/legacy-smartbom/currency-link-model-redesign.md](../../docs/legacy-smartbom/currency-link-model-redesign.md)
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
- [../../docs/PCB_EQ_AI_PROBE.md](../../docs/PCB_EQ_AI_PROBE.md)
- [../../docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md)
- [../../docs/pricing-engine-parity.md](../../docs/pricing-engine-parity.md)
- [../../docs/prototypes/develop-menu-questions-plan.html](../../docs/prototypes/develop-menu-questions-plan.html) (md 아님 — 세부 질문 확정본, 2026-10-30)
- [../../docs/prototypes/develop-workflow-simple.html](../../docs/prototypes/develop-workflow-simple.html) (md 아님 — 업무관리 간편 서식 보관본, 2026-09-11)
- [../../docs/review-naming.md](../../docs/review-naming.md)
- [../../docs/samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md)
- docs/samplepcb-subdomain-nginx.md — 사라짐(2026-10-12 확인, 미커밋이었음 · 파일 수에서 제외)
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
