# 고객 스마트 BOM 견적 (BOM Quote)

> 정본 설계 문서 (2026-07-19). 레거시 vueline `spSmartBomV2`(고객 BOM 업로드 페이지)의
> **재설계 재구현** — 동일 이식이 아니라 레거시 결함을 교정한 새 구현이다.
> 관련: `docs/PARTS_SEARCH.md`(부품 카탈로그 — 매칭·오퍼의 원천), `AGENTS.md`.

## 한눈에

```
고객(/app/bom, 회원 전용)                sp-node(/api/bom)                sp-engine(:8400)
 업로드(xlsx/xls/csv/…) ───────────▶ POST /quotes(원본 파일서버 보존) ──▶ 전체 시트 파싱 잡
 시트 분석 완료 ──────────────────▶ 분석 원문 JSON을 append-only 스냅샷으로 즉시 박제
 시트 선택(다중 선택) → build ─────▶ 스냅샷에서 안정 ID 라인 + 필요수량 생성
 검토(수량·오퍼·포함) → 1s 자동저장 ─▶ PATCH(draft, ID 기반 수정 명령)
 (버튼 없음 — 조용한 자동 보강) ◀──── 영속 분석으로 독립 검색 실행 ─▶ Mouser/DigiKey/UniKeyIC
   "가격·재고 확인 중…" 라벨만        └ 자동 인제스트 → 엔진 기술·구매조건 판단 반영
 견적요청(제목 입력) ───────────────▶ POST /request(서버 재계산·동결)
관리자(/app/admin/bom-quotes)        상태 전이·확정가·회신 메모·원본 다운로드
```

- **상태**: `draft → requested → reviewing → answered → closed` (+`canceled`). 전이는
  서버 검증(`lib/bom-quote.ts QUOTE_TRANSITIONS`), requested 이후 고객 수정 불가(409).
- **1차 종점 = 견적요청(RFQ)**. 결제 연계(거버식 카트 스냅샷→orderform)는 2차.
- **회원 전용**(비로그인 → 그누보드 로그인 왕복). 데이터 흐름은 sp-node 신규 소유 —
  xpse(sp_estimate_document) 브릿지 안 함(2026-07-19 사용자 결정).

## 데이터 모델 (Prisma, 공유 DB — 추가형 `migrate deploy`만)

- `sp_bom_quote`(SpBomQuote): mbId·title·status·fileName·contentHash(SHA-256)·
  engineJobId(최초 파싱 잡 추적용)·**activeAnalysisRunId(현재 분석 정본)**·
  **activeSupplierSearchRunId(현재 공급사 검색 실행)**·**buildStatus(파싱·선택·계산 생명주기)**·
  setQty/spareQty·
  **예상 스냅샷**(itemsTotal/shippingFee/managementFee/finalTotal/usdKrwRateUsed/uncostedCount)·
  **enrichStatus/enrichedAt(자동 보강 생명주기 — 서버 영속 단일 진실)**·
  customerMemo·adminMemo(내부)·answerNote(고객 노출)·confirmed*(관리자 확정)·requestedAt/answeredAt
- `sp_bom_analysis_run/sheet/component`: 엔진 분석 1회를 append-only로 보존한다. component의
  `payload`는 엔진 `ComponentRecord` JSON을 변환 없이 그대로 박제하고, componentId·시트·원본 행·
  상태·검색 텍스트처럼 정렬/조인에 필요한 안정 필드만 열로 승격한다. 알 수 없는 신규 엔진 필드도
  런타임에서 보존되며, 조회 계층이 늦게 따라가도 원본 데이터는 유실되지 않는다.
- `sp_bom_supplier_search_run`: 어떤 분석 run과 옵션으로 독립 공급사 검색을 실행했는지,
  엔진 jobId·preflight·상태·오류·시각과 완료 시 실제 API 호출·캐시 적중·소요시간·한도 소진
  요약을 영속한다. 엔진 재시작으로 잡이 사라지면 같은 분석 스냅샷에서 새 실행을 만들 수 있다.
- `sp_bom_supplier_search_trace`: 공급사 검색 실행별·엔진 componentId별 `supplier-search-trace-v1`
  원본 JSON을 박제하고 rowIdx·최초/fallback 검색어·시도 수만 열로 승격한다. 후보/오퍼마다 중복하지
  않으며 실행 삭제 시 함께 삭제된다. BOM 목록 폴링에는 compact 요약만 포함하고 전체 시도 이력은
  후보 상세 API에서 지연 조회한다. trace 도입 전 실행은 실제 과정을 역산하지 않고 이력 없음으로 둔다.
- `sp_bom_supplier_daily_usage`: 회원별 KST 일자 검색 횟수. 기존 프로세스 메모리 카운터와 달리
  sp-node 재시작·다중 인스턴스에서도 일일 한도가 유지되며 조건부 원자 증가로 동시 요청을 제한한다.
- `sp_bom_quote_item`(SpBomQuoteItem): **id(영속 행 식별자)**·rowIdx(표시 순서)·
  analysisComponentId(추출 정본 연결)·included·mpn·bomQty·**orderQty(박제 수량 = 단일 진실)**·
  matchStatus(auto|manual|none)·**matchEvidence Json(엔진 판정·안전 후보·선정 정책 스냅샷)**·
  **recommendedCandidateKey/selectedCandidateKey/selectionSource**(자동 추천과 실제 선택 분리)·
  partId(sp_part 느슨한 참조, FK 없음)·
  **selectedOffer Json(오퍼 스냅샷 박제 — 가격구간 사다리 포함·pinned)**·lineTotalKrw·sourceRow(원본 근거)·
  sourceSheetIndex/sourceSheetName
- `sp_bom_quote_candidate`(SpBomQuoteCandidate): quoteItemId로 안정 행에 연결하며 엔진의 `identity_key`가 묶은
  부품 후보의 견적 문맥 스냅샷. 엔진 선택 자격·기술 순위·오퍼/가격구간·검증 근거를 보존해 엔진 인메모리 잡이
  사라져도 고객과 관리자가 동일한 후보를 비교한다. 스펙은 기술 순위 최상 후보를 정본으로 삼고
  공급사별 값의 임의 필드 병합은 하지 않으며, 동일 부품의 공급사 오퍼만 한 후보 아래 통합한다. 신규
  검색은 sp-engine이 기술 판정 후 공급사별 상위 5개 그룹의 합집합으로 제한하므로 3개 공급사 기준
  행당 최대 15개 그룹을 저장한다. sp-node도 구형·과대 응답을 15개로 방어 제한하되 현재 명시 선택,
  엔진 적용·추천·기술 사전선정 후보는 상한 안에서 우선 보존한다.
- `sp_bom_quote_selection_event`(SpBomQuoteSelectionEvent): quoteItemId 기준으로 고객 명시 선택의
  이전/선택 후보·MPN·오퍼·행 금액·이유를 누적한다. 행 갱신과 분리되어 선택 감사 이력이 보존된다.
- `sp_bom_quote_sheet`(SpBomQuoteSheet): 엔진이 분석한 전체 시트의 index/name/status/componentCount·
  failureReason/warnings와 고객의 selected 스냅샷. 견적·관리자 상세에서 동일하게 조회한다.
- 원본 파일: 파일서버(serviceType `bom`) + `sp_file`(refType `sp_bom_quote`) —
  관리자 다운로드는 서버 경유 스트리밍(pathToken 클라 미노출).
- xpse 의 `sp_bom_document`/`sp_estimate_document` 는 **별도 DB**(이름 충돌 없음 확인) — 무관.

## 가격·수량 규칙 (@sp/utils bom-pricing — 서버·FE 동일 함수, 골든 테스트 14)

| 규칙 | 레거시 대비 |
|---|---|
| 가격구간: 주문수량 이상 구간 중 최대, 최소구간 미달 시 최소구간 단가 | 보존 |
| 수량 박제: `orderQty = max(BOM수량×(세트+예비), MOQ)` → **주문배수 올림** | 배수 보정 신규(레거시 죽은 필드) |
| 합계: `Σ(단가×orderQty, included 라인) + 운송료 + 관리비`, VAT 별도 | items=합계 기준 통일(레거시 불일치 결함 교정) |
| 현재 엔진 결과: sp-engine이 기술 1순위를 보존하되 해당 후보군에 구매 가능한 오퍼가 없으면 다음 안전 후보군을 실제 적용 후보로 분리한다. 각 후보군 안에서는 **구매 가능성→과다주문 위험→실효 총액→주문수량**으로 오퍼를 정한다. sp-node는 적용 후보 키와 안정 `offer_key`, 주문수량·가격구간·환산단가를 검증 후 그대로 저장 | 신규 — 기술·구매 판단을 엔진으로 일원화 |
| `pickDefaultOffer`: 엔진 후보가 아닌 카탈로그 직접 선택·오퍼 갱신에만 사용 | 추천 판단과 분리 |
| `pinned`(사용자 명시 선택): 수량·환율 변경 시 저장한 엔진 후보를 무호출 재평가 API로 다시 계산하고, 요청 오퍼가 여전히 허용될 때 유지 | 레거시 "선택 pkg 내 탐색" 일반화 |
| 통화: 오퍼 원통화 보존. USD는 한국수출입은행 자동 환율(매매기준율/TTS 선택)+안전계수로 KRW 예상 환산. 장애 시 수동값→마지막 정상 캐시 순 폴백, 모두 없으면 uncosted 경고 | 신규 |
| samplepcb 파생 오퍼는 견적 선정 후보 제외(자기 선택 순환 방지) | — |
| 납기: "확정 시 안내" 문구 | '2주' 하드코딩 제거 |

**서버 재계산 원칙**: 합계는 항상 서버가 스냅샷에서 재계산(클라 금액 불신). 검색 완료 후
스냅샷 오퍼·주문수량·적용 가격은 엔진 결정을 서버가 검증해 저장하며, sp-node는 저장 스냅샷의
라인·견적 합계만 재계산한다. 최종 확정가는 관리자 검토가 결정하는 RFQ 모델.

## 조용한 자동 보강 (2026-07-20 — 고객에게 "공급사 검색" 개념 비노출)

build 직후 서버(`routes/bom-quotes.ts autoEnrichQuote`)가 판단·실행하고 FE 는 상태 라벨만:
- **필요 조건**: 엔진 판정(`matchEvidence`)이 없는 업로드 라인 OR included 미매칭 라인 존재
  OR 오퍼 나이 > `freshnessHours`(기본 24h). 카탈로그가 신선해도 최초 업로드는 반드시 엔진
  검증을 거쳐 느슨한 MPN 존재 여부가 관리자 수준 판정을 대신하지 못하게 한다.
- **비용 게이트**: preflight 예상 호출은 관측·경고용이다. 예상치가 작업 한도를 넘어도
  검색을 시작하고 sp-engine이 실제 호출 시점의 원자적 job budget으로 `max_calls`를 강제한다.
  실제 한도에 도달한 요청은 `job_call_limit_exhausted`로 구분한다. 회원 일일 한도 소진은
  캐시 전용으로 조용히 축퇴하지 않고 검색 실행 실패 사유로 영속한다.
  활성 검색의 실제 `budget_exhausted` 부품 수는 견적 상세에도 전달하며, 1건 이상이면 고객 결과
  상단에 “일부 공급사 확인이 제한됨” 안내를 지속 표시한다. 내부 API 용어는 노출하지 않고 이미
  확인된 후보·금액은 그대로 사용할 수 있게 한다. 구형 요약의 오집계는 영속 search trace로 복구한다.
- **관리자 운영 화면(2026-07-21)**: `/app/admin/settings`의 `BOM 견적` 탭에서 관리자 설정
  `supplierSearchMaxCalls`와 sp-engine `/capabilities`가 알리는 런타임 안전 상한을 함께 보여주고,
  둘 중 작은 값을 실제 적용 한도로 표시한다. 엔진 연결·공급사 자격증명 준비 여부·캐시 모드/건수와
  오늘 회원 검색 횟수, 최근 10개 실행의 예상/실제 호출·캐시·소요시간·실패를 한 화면에서 확인한다.
  엔진 상한을 넘는 설정은 sp-vue와 sp-node 양쪽에서 저장을 차단한다. `/capabilities`에는 키·경로를
  포함하지 않고 비밀이 아닌 운영 메타데이터만 노출한다.
- **품번 미검색 시 스펙 재검색(2026-07-21)**: `identity`/`hybrid` 품번 검색에서 신뢰할 수 있는
  동일 품번 후보가 없고 BOM의 확정 스펙이 충분하면, 엔진이 품번·제조사를 제거한 `parametric`
  질의로 DigiKey·Mouser를 한 번 더 검색한다. 최초 품번 질의와 응답도 결과에 함께 보존하며,
  preflight·실행 집계는 조건부 2차 호출까지 포함한다. sp-engine은 이 전환을
  `identity_fallback=true`로 명시하고 sp-node는 그대로 투영한다. 이 경우에는
  원본 문자열이 있어도 스펙 후보를 안전성 검증 대상으로 포함하되, 충돌·필수값 누락·물리조건
  불일치 후보는 계속 차단한다. 계보가 없는 일반 MPN 행의 다른 MPN 자동선정도 기존대로 금지한다.
- **실제 검색 과정 provenance(2026-07-21)**: sp-engine 1.5는 component마다 최초 검색어와
  조건부 스펙 fallback 검색어, 공급사별 논리 시도 순서·전략·API/캐시 출처·결과 수·HTTP 재시도 수·
  소요시간·fallback 사유를 구조화한다. API 키·헤더·원본 요청 body·URL은 기록하지 않는다.
  sp-node는 이를 실행 스냅샷으로 저장하고 판단을 재구성하지 않으며, sp-vue는 결과 행에 최초 검색어와
  fallback 여부만 한 줄로 표시하고 후보 비교의 접힌 `검색 과정`에서 전체 이력을 보여준다. 오염된
  BOM 셀의 긴 품번도 검색 자체는 바꾸지 않고 trace 표기만 500자로 제한한다. trace 조립·파싱 실패는
  검색 배치나 견적 판정 실패로 승격하지 않으며, sp-node는 componentId와 계약 경로를 경고한 뒤 해당
  trace만 생략한다. 조달 결정 계약의 엄격 검증은 이 관측 데이터 축퇴와 무관하게 그대로 유지한다.
- **생명주기 상태 기계(2026-07-19 정석화)**: `sp_bom_quote.enrichStatus`
  (`idle|searching|done|failed`) + `enrichedAt` — **서버 영속 단일 진실**. 전이:
  build 가 보강 필요를 동기 선판정해 **items 와 `searching` 을 함께 커밋**("items 는 있는데
  idle" 창 제거 — 그 창에서 조회되면 전 라인이 빨간 미매칭으로 렌더됐다, 실측 ~1.2s) 후
  검색 개시를 확정(실패 시 failed·불필요 시 idle 로 되돌림) → 반영(`refreshQuoteFromSupplierResult`)이 매칭 라인과
  `done`+`enrichedAt` 을 **한 저장으로 커밋**(상태·데이터 원자성 — "검색 완료 후 빨간
  미매칭 깜빡임"이 불가능해짐) → 시작 실패·잡 소실은 `failed`(최종 판정 표시).
- **검색 입력과 실행 분리**: build는 원본 파싱 잡을 다시 읽지 않고 `activeAnalysisRunId`의
  선택 시트 JSON으로 `/supplier-jobs`를 생성한다. 검색 실행은 `sp_bom_supplier_search_run`에
  기록되므로 분석 정본과 실행 상태를 혼합하지 않는다.
- **입력 충돌·조달 가능 상태 보존(2026-07-22)**: sp-engine 추출 계약 1.2·검색 계약 1.2는 값·패키지·
  풋프린트·설명의 충돌 대안을 원본 셀 계보와 함께 보존하고, 제한된 분기별로 검색하되 서로 다른 분기의
  검증 근거를 합쳐 자동 선정을 만들지 않는다. DNP·PCB feature·고객지급품은 분석 행을 삭제하지 않고
  `procurement_disposition=excluded`로 남기며, sp-node는 이를 `included=false`로 투영해 검색·합계에서
  제외한다. 참조번호 개수와 선언 수량이 다르거나 수량이 없으면 기술 후보 검색은 가능하지만
  `quantity_confirmation_required`로 자동 구매 추천을 막는다. 이 상태와 사유는 저장 후보 및 무호출
  조달 재평가에도 그대로 전달하며, 응용 계층은 이를 기본 `eligible`로 되돌리거나 자체 추론하지 않는다.
- **정확 MPN 우선 자동 선정(2026-07-22)**: `supplier-candidate-decision-v3`는 정규화 제조사 품번이
  정확히 일치하면 필수조건 불일치와 항목별 기대값·실제값을 그대로 보존한 채 `automatic` 후보로
  선정한다. 견적 금액에 즉시 반영하고 별도의 검토 확인을 요구하지 않으며, 불일치 정보는 후보 비교의
  필수조건 배지·툴팁과 충돌 상세에 계속 표시한다. 포장 접미사 등 변형 품번과 파라메트릭 후보의 실제
  조건 불일치는 계속 차단한다. sp-node는 현재 v3와 저장된 v1·v2 결정을 모두 수신하고 이 정책을
  재추론하지 않는다.
- **완료 반영과 카탈로그 분리(2026-07-21)**: 폴러는 엔진 결과를 한 번 읽어 견적 후보·선정
  오퍼·가격 스냅샷과 `done`을 먼저 커밋한다. 사용자가 기다리지 않아도 되는 전역 카탈로그 DB/ES
  동기화는 그 뒤 백그라운드에서 수행한다. 새 부품의 `partId`는 잠시 null일 수 있지만 후보 비교·
  선정·가격은 엔진 스냅샷만으로 완전하며, 인제스트 완료 뒤 **자동 선정 행의 partId만 조건부
  backfill**한다. 이때 후보·오퍼·가격·사용자 선택은 변경하지 않으며, 제조사가 확인된 행은
  exact(mpn+제조사)만·제조사 미상 행만 mpn 단독으로 연결해 다른 제조사 부품과 교차 연결하지 않는다.
- **완료 반영 경로 3중**: ① 결과 폴러의 견적 우선 반영 ② 결과 조회 카탈로그 백업 훅 ③ **게으른 치유** —
  `searching` 견적의 상세 GET 이 활성 검색 실행과 엔진 상태를 확인해
  completed 면 엔진 판정 반영을 즉발하고 카탈로그는 백그라운드로 넘긴다(고객의 3초 폴링이 곧
  치유 트리거 — 갭 단축 겸용). `done` 상세 조회도 누락 partId를 다시 조건부 보강하며,
  잡 소실이면 기존 실행을 failed로 닫고 **영속 분석에서 새 검색 실행을 생성**한다. 결과를
  견적에 적용할 수 없는 경우도 실행과 견적을 failed로 닫아 `searching` 고착을 막는다.
  반영 자체는 `componentId`로 원본 행과 엔진 결과를 조인한다. 수동/pinned 행은 보존하고,
  나머지는 엔진의 안전 후보 판정과 선택 오퍼를 한 저장으로 교체한다.
- **엔진 조달 판단 투영(`engine-procurement-projection-v10`, 2026-07-21)**:
  sp-node는 실제 필요수량과 환율 스냅샷을 검색 입력에 전달한다. sp-engine은 기술 사전 선정 후보군을
  바꾸지 않은 채 안정 `offer_key`, MOQ·주문배수 반영 주문수량, 가격구간, 환산단가, 재고 부족·과다주문,
  구매 적합 순위와 `automatic|manual_review|none` 추천을 계산한다. 기술 1순위에 구매 가능한 오퍼가 없으면
  차단되지 않은 다음 기술 후보군을 `application_candidate_*`로 지정하고 `technical_fallback_used=true`를
  명시한다. 안전성·기술 근거가 동급인 차순위 후보군끼리는 실효 총액을 tie-break로 사용한다.
  기술 순위·`preselect`는 감사 근거로 그대로 남고 실제 선정·금액만 적용 후보를 따른다.
  sp-node는 1.4 계약의 기술/적용 후보군·오퍼 키·
  수량·금액 불변식을 검증해 그대로 투영하며 자체 가격·재고 정렬로 덮어쓰지 않는다. 수량·환율이 바뀌면
  저장된 원본 엔진 후보를 재평가해 공급사 API·캐시·쿼터 호출 없이 재판정하고 같은 트랜잭션에 후보·라인·
  합계를 갱신한다(자동저장 PATCH가 쓰는 배치 재평가 메커니즘은 아래 항목 참조). 엔진 응답 자체의
  계약 누락·중복 키·수량 불일치는 fail-closed다.
- **저장 후보 재평가 배치화 + 행 단위 축퇴(2026-07-21)**: 자동저장 PATCH(`repriceCandidateSelections`)가
  수량·환율 드리프트로 재평가가 필요한 행을 모아 `POST /supplier-search/procurement/reevaluate-batch`
  (`supplier-procurement-reevaluation-batch-v1`)를 **50컴포넌트 청크**로 순차 호출한다(청크당 타임아웃
  15초, 배치 상한 200 — sp-engine이 초과 시 422). 응답은 컴포넌트별 `ok|error`로 격리되어 한 컴포넌트의
  실패가 배치 전체를 막지 않는다. **서킷브레이커**: 청크 "요청 자체"가 실패(네트워크 예외·타임아웃·
  비200·파싱 실패)하면 엔진이 죽었거나 행업 상태일 가능성이 커 잔여 청크는 호출하지 않고 즉시 전부
  축퇴시킨다(2,000행 상한에서 청크마다 타임아웃을 소진하는 최악 지연을 방지). 컴포넌트별 `error`는
  엔진이 응답한 상태이므로 서킷브레이커를 열지 않고 그 컴포넌트만 격리한 채 다음 청크를 계속 시도한다.
  청크 실패·컴포넌트별 오류·componentId 누락으로 재평가할 수 없는 행은 예외를 던지지 않고 **행 단위
  stale 축퇴**로 빠진다 — `selectedCandidateKey`/`selectedOffer`/`matchStatus`/`selectionSource`는
  그대로 두고(자동 선정·가격이 조용히 소거되던 구결함 재현을 차단), `orderQty`만 새 필요수량으로 로컬
  재도장하며 `matchEvidence.decisionReasonCodes`에 `engine-procurement-unavailable`을 추가한다.
  다음 저장에서 엔진이 살아 있으면 자동으로 재시도된다. 이 덕분에 PATCH는 **엔진이 완전히 죽어 있어도
  항상 200**을 반환한다(이전엔 409로 자동저장 전체를 막았다). `items`/`setQty`/`spareQty`를 하나도
  건드리지 않는 제목·메모 전용 PATCH는 재평가 자체를 건너뛴다(엔진 호출 0회). 후보 스냅샷도 실제로
  재평가에 성공한 행만 `quoteItemId` 단위로 부분 교체한다(`candidateSnapshotScope:'partial'`) —
  공급사 검색 완료 반영(`refreshQuoteFromSupplierResult`)은 전 행이 실제로 갱신되므로 기존처럼
  quoteId 전체 교체를 유지한다.
- **판단 단일 설명 원본(2026-07-21)**: 후보의 관계·선택 자격·기술/검토 순위·사전 선정과
  오퍼의 가격/구매적합 순위·자동/검토 추천은 모두 sp-engine이 결정한다. sp-node는 정책 버전,
  identity/evidence/offer key, 필요수량·금액 불변식을 검증하고 DB·ES에 저장할 뿐 후보를 재정렬하거나
  가격·재고·수명주기로 다른 후보를 고르지 않는다. sp-vue도 엔진 순서를 기본으로 고정하며
  엔진이 기술 1순위와 별도의 실제 적용 후보, `automatic_selected|provisional_selected|not_selected`
  적용 상태와 사용자 확인 필요 여부를
  명시한다. `provisional_selected`도 엔진이 지정한 후보·오퍼를 `selectedCandidateKey`와 예상금액에
  반영하지만 `selectionSource=auto`인 동안은 `선정됨 · 검토 대기`로 표시한다. 사용자가 확인하면
  기존 명시 선택 API가 같은 후보·오퍼를 `selectionSource=customer`로 기록하며, sp-node가
  `manual_review` 조합을 보고 임시 선정을 자체 추론하지 않는다.
  - **후보 shortlist(2026-07-22)**: sp-engine은 공급사 원본을 모두 기술 판정한 뒤 공급사별 상위
    5개 identity/evidence 그룹의 합집합만 순위·조달 판단에 전달한다. 한 공급사가 선택한 동일 그룹의
    타 공급사 오퍼는 함께 남겨 교차 가격 비교를 보존하고, 원본 결과 수는 trace에 유지한다. sp-node의
    행당 15개 영속 상한은 구형·비정상 과대 결과에 대한 저장 안전장치이며 별도 기술 판단은 아니다.
  - **오퍼 키 v2(2026-07-21)**: 검색 스키마 1.6부터 신규 공급사 오퍼는
    `supplier-offer-key-v2`(`ok2:`)를 사용한다. SKU의 점·하이픈을 제거하던 v1은
    `P1.00K`/`P10.0K`/`P100K`처럼 서로 다른 DigiKey SKU를 같은 키로 축약할 수 있었으므로,
    v2는 NFKC·양끝 공백만 정규화하고 대소문자와 식별 구두점을 보존한다. 기존 충돌 없는 v1
    후보는 무호출 재평가 시 v1 계산을 유지하며, v1 내부에 실제 중복 키가 있는 행만 격리한다.
  - **구버전 결과 처리**: 1.3 조달 결정이 없거나 `supplier-selection-application-v1`인 저장 후보는
  sp-node의 옛 구매 규칙으로 복원하지 않는다. 원본 엔진 후보가 있으면 위 배치 재평가로 현재 v2
  적용 후보 정책을 적용하고, 재평가할 수 없으면(청크 실패·컴포넌트별 오류·componentId 누락)
  선택은 그대로 둔 채 stale 축퇴한다. 결정 계약이 없거나
  모순된 후보를 자체 규칙으로 복원하지 않는 fail-closed 원칙은 동일하다.
- **검토 표현**: 엔진의 `automatic_selected`는 바로 선정 완료, `provisional_selected`는 후보·오퍼·
  예상금액까지 적용된 검토 대기 선정, `not_selected`는 미선정이다. 임시 선정을 사용자가 확인하면
  선택 이벤트를 남기고 검토 완료로 전환한다. `candidate_only`는 일반 검토 후보, `exclude`는 선택
  불가로 표시한다. 기술 1순위와 구매 적용 후보가 다르면 후보 패널과 결과 행에
  `기술 1순위 구매 불가 · 구매 가능 차순위`를 함께 표시한다. 후보 패널의 검증률은 confidence를 그대로 `100%`로 표시하지
  않고 실제 확인 필수조건 수로 계산한다. sp-engine은 같은 분모의 항목별 요구값·후보값·판정을
  `requirement_assessments`로 함께 반환하며, sp-node와 sp-vue는 이를 추정 없이 저장·표시한다.
- **접미사 변형 매칭**: 포장 접미사형(…DBVR/…DBVT)의 기술적 동일성은 sp-engine의
  `verified_variant`/결정 계약만 인정한다. sp-node의 프리픽스 카탈로그 자동 매칭 경로는 제거했다.
- **"확인 중" UI**: `enrichStatus==='searching'` 이면 미매칭 라인은 빨간 "미매칭" 대신 파란
  "확인 중"(펄스, 중립 행) — 빨간 미매칭은 `done/failed` 후의 **최종 판정**에만. 진행 배너
  (검색 중엔 엔진 progress %, 엔진 완료 후엔 "결과를 반영하고 있습니다" 100%)·우측 통계
  "확인 중" 카드·합계 노트·견적요청 비활성("가격 확인 중…"). searching 동안 견적 3초 폴링,
  searching→done 전환 토스트. searching 동안 FE와 PATCH를 모두 잠가 검색 결과 적용과 사용자
  수정 명령의 경합을 막는다.
  done 뒤 카탈로그 재매칭은 엔진의 검토/충돌 판정을 덮어쓰므로 호출하지 않는다.
- 라인 오퍼에 "기준 N일 전" 나이 배지(데이터 정직성 — 방금 조회처럼 보이지 않게).
- 라이브 검증: 카탈로그 미보유 STM32F030F4P6 업로드 → build 미매칭 → 고객 개입 0으로
  자동 검색→적재→실 Mouser 오퍼(₩3,042) 매칭·합계 갱신 확인. 2026-07-19 초기화 상태
  (카탈로그 3건)에서 3부품 CSV 재검증 — 업로드 즉시 "확인 중" 모드, 완료 후 3/3 매칭
  (Mouser·Digikey 실오퍼)·합계 갱신·버튼 활성.

## 비용 정책 (sp_config `bom_quote` — 관리자 설정 승격)

`/app/admin` 설정 → BOM 견적 탭: 기본 운송료(30,000)·기본 관리비(25,000)·USD→KRW 적용 방식
(수출입은행 자동/관리자 수동)·자동 기준(매매기준율/TTS)·안전계수(기본 2%)·최대 경과일(7일)·
수동/장애 폴백값·검색 1회 최대 API 호출(300)·회원별 일일 검색 한도(20)·데이터 신선 임계(24h).
레거시·구 관리자 콘솔 모두 계산 로직 없이 상수/수동 입력이던 것을 설정으로 승격.
고객 화면 표기: **"예상 견적 — 확정 시 변동" + VAT 별도**. 확정가는 관리자 검토(confirmed*)가 정본.

자동 환율은 sp-node의 `KOREAEXIM_API_KEY`(공공데이터포털 발급, 서버 환경변수 전용)를 사용해
`oapi.koreaexim.go.kr`에서 서버 시작 시와 매일 12:10 KST에 갱신한다. 당일 고시 전·주말·공휴일은
최근 10일을 역탐색하며 마지막 정상 응답을 `sp_config.bom_quote_exchange_rate_usd`에 캐시한다.
역탐색은 전체 예산 15초(호출당 10초) 내에서만 수행해 API 행업이 관리자 [지금 갱신]을 붙잡지 못하게
하고, 수출입은행 result 코드(2=요청 형식·3=인증 실패·4=일일 한도)는 "고시 없음"으로 오진하지 않고
전용 메시지로 구분한다. 외부 호출 실패는 캐시를 삭제하지 않는다. 관리자는 같은 탭의 **지금 갱신**으로
상태를 확인할 수 있다.
draft는 재계산 시 최신 실효 환율을 적용하고, `sp_bom_quote.usdKrwRateUsed`와
`exchangeRateSnapshot`(출처·기준일·기준 환율·안전계수)을 함께 갱신한다. RFQ 요청 후에는 이 값을
그대로 동결하므로 이후 환율 갱신이 기존 견적 금액을 바꾸지 않는다.

## API

**회원 `/api/bom`** (`routes/bom.ts`·`bom-quotes.ts`, `authenticate`):
- `POST /quotes`(multipart) 업로드→견적+엔진 잡 · `GET /quotes`(내 목록) · `GET/PATCH /quotes/:id`.
  PATCH는 draft 한정이며 `{id,included,orderQty,catalogSelection?}` 수정 명령만 받는다. 기존 행은
  id로 제자리 갱신하고, 서버 소유 추출·판정·후보 필드는 클라이언트 왕복 대상이 아니다.
- `POST /quotes/:id/prepare`: 파싱 결과 전체를 분석 run/sheet/component에 먼저 박제한다. →
  `POST /quotes/:id/build {sheetIndexes}`: 영속 분석의 선택 시트로 라인+필요수량 생성(최대 2,000라인) ·
  `PUT /quotes/:id/sheets {sheetIndexes}`: 계산 완료된 draft의 기존 구성 시트를 제외·복원(최소 1개,
  원본 라인·후보·선택 이력 보존, 복원 시 현재 수량·가격으로 재계산) ·
  `GET /quotes/:id/items/:itemId/candidates`(영속 후보·현재 수량 가격·선택 이력·활성 검색 실행 trace) ·
  `POST /quotes/:id/items/:itemId/selection {candidateKey,offerKey}`(draft 전용, 가격은 서버 재계산) ·
  `GET /quotes/:id/comparison?page&pageSize&search&status&sheet`(원본 추출+후보의 페이지 조회) ·
  `GET /quotes/:id/supplier-search`(이 견적의 활성 검색 실행 상태) ·
  `/request`(재계산·동결) · `/cancel` · `DELETE`(draft)
- 잡 프록시: `GET /jobs/:id[/result]`, 공급사 검색 `POST /jobs/:id/supplier-search[/preflight]`
  — **소유 회원만**(타인·미기록 404 은닉), 일일 한도 초과 429 `SEARCH_DAILY_LIMIT`,
  max_calls 는 sp_config 로 클램프. 자동 인제스트(폴러+백업 훅)는 관리자 플로우와 동일.
- 카탈로그: `GET /parts-search`(교체·추가 모달, admin-parts 쿼리 빌더 재사용) · `GET /parts/:id`

**관리자 `/api/admin/bom-quotes`** (`routes/admin-bom-quotes.ts`, `requireAdmin`):
목록(기본 draft 제외)·상세·`PATCH`(상태 전이 검증+확정가+메모)·`GET /:id/file`(원본 스트리밍)·
`GET /:id/items/:itemId/candidates`(고객과 같은 후보·선정 근거·이력, 읽기 전용) ·
`GET /:id/comparison`(고객과 같은 페이지형 원본 추출+후보 읽기 모델).

## 화면

- 고객: `/app/bom`(업로드), `/app/bom/history`(내 견적 전체 목록), `/app/bom/:id`(워크벤치 —
  좌 결과 테이블+우 주문 패널, 레거시 기본 구조). sp-vue 에 **일반(회원) 라우트 그룹 신설** — "sp-vue=관리자 전용"
  전제 공식 변경(router.ts 주석). `meta.requiresMember` 가드 = 그누보드 로그인 왕복.
- 워크북에 BOM으로 인식된 시트가 하나면 자동 선택하고, 둘 이상이면 계산 전 체크박스
  다중 선택 단계를 표시한다. `not_bom`·`error` 시트는 사유와 함께 비활성화한다. 선택값은
  `sp_bom_quote_sheet`, 전체 추출 정본은 분석 run/sheet/component에 영속한다.
  생명주기는 `buildStatus`(`parsing→selecting→building→ready`, 실패=`failed`)로 판정하며
  `items.length===0`을 분석 중 신호로 사용하지 않는다.
- 결과 화면은 선택 시트가 둘 이상이거나 수동 추가 행이 있으면 `전체 / 시트별 / 직접 추가` 탭을
  표시한다. 탭은 원본 라인의 표시 범위만 바꾸고 매칭·검토·재고 필터와 교차 적용한다. 우측 분석
  통계는 현재 탭 기준으로 계산하지만 예상 금액·미산정·검토 대기·견적요청 가능 여부는 항상 전체
  견적 기준을 유지해 탭 이동이 업무 상태나 합계를 바꾸지 않게 한다.
- 계산을 끝낸 draft에서는 상단의 `시트 N/M` 관리로 이미 구성한 시트를 견적에서 제외하거나
  다시 포함할 수 있다. `sp_bom_quote_sheet.selected`가 활성 시트의 단일 진실이며, 제외한 시트의
  라인·후보·선택 이력은 삭제하지 않는다. 상세·목록 집계·합계·후보 조회·BOM 비교·견적요청은
  활성 시트와 직접 추가 라인만 대상으로 하고, 복원한 시트는 기존 라인 ID를 유지한 채 현재 주문수량과
  가격 기준으로 재계산한다. 공급사 검색 중이거나 견적요청 후에는 구성을 바꾸지 못한다.
- 선택 시트에서 엔진이 컴포넌트로 판정한 행은 MPN 유무와 관계없이 모두 라인으로 보존한다.
  표시·저장 순서는 워크북 시트 순서→Excel 원본 행 번호이며, MPN이 없는 행은 `value_raw`를
  화면 대표값으로만 표시하고 빈 MPN으로 저장해 카탈로그 품번으로 오인하지 않는다. 고객 결과
  표의 별도 `Excel 위치` 열은 제거하고 체크박스 아래에 1-based 행 번호를 작게 표시해 너비를
  절약한다. 정확한 시트·행·근거 셀과 전체 추출 필드는 BOM 비교에서 확인한다.
- 공급사 검색에도 선택한 `sheet_indexes`를 전달한다. 따라서 선택되지 않은 시트는 외부 API
  호출·카탈로그 인제스트·견적 합계 모두에서 제외된다. 여러 선택 시트의 동일 품번은 감사 가능한
  원본 라인으로 각각 유지하고, 동일 검색 조건의 공급사 호출만 엔진 배치에서 재사용한다.
- 고객 결과는 `매칭 / 가격 확인 필요 / 검토 필요 / 미매칭`과 함께 적용 단가·선택 출처·선정
  이유·대체 후보 수를 표시한다. 기존 [변경]+[상세]+가격구간 확장을 **[후보 비교] 우측 패널**로
  통합했다. 패널은 현재 선택과 금액, 자동 추천 이유, 기술/가격 순위, 검증 수, 차액, 공급사별
  MOQ·재고·적용 단가·행 총액을 함께 보여주며 안전 후보와 특정 공급사 오퍼를 명시 선택할 수 있다.
  후보 카드의 검증 수·비율은 단일 배지로 압축하고, 마우스오버·키보드 포커스·터치 시 지연 없이
  항목/BOM 요구값/후보값/판정을 보여주는 커스텀 툴팁을 연다(닫힘만 100ms 유예).
  패널 상단의 **원본 BOM**은 영속 ComponentRecord가 있으면 일부 고정 필드가 아니라 실제로 값이
  추출된 `field_states`·`raw_fields`·`attributes` 전체를 중복 없이 요약한다. 원문을 주값으로,
  공학 단위 정규화값을 보조로 표시하며 필드마다 근거 셀과 `근거 셀 확인/원문 해석/규칙 추론/
  검토 필요`를 붙인다. 기본 화면은 MPN·제조사·원본 값·패키지/풋프린트·설명·핵심 사양만
  컴팩트하게 보여주고, 전체 추출값·정규화값·근거 셀은 명시적 확장 토글로 제공한다. 근거가 확실한
  값은 외곽 색칠 대신 `✓ 확인` 표식과 굵은 값으로 강조하며 검토 신호는 접힌 상태에서도 숨기지 않는다. 구 견적과 수동
  행은 기존 시트·행·MPN/값·제조사·패키지·REFDES로 축퇴한다.
  이로써 `원본 → 현재 선정 → 다른 후보`의 판단 흐름을 보존한다. BOM 비교는 5행씩 서버 페이지네이션하고
  검색·판정·시트 필터를 서버에 적용한다. 후보가 없는 추출 행도 빠뜨리지 않으며, 엔진 payload의
  field_states/raw_fields/attributes를 동적으로 모두 표시한다. 원문 값을 우선하고 정규화 값은
  보조로 사용한다. `col/text/infer/미상` 근거를 구분하고, 근거 셀이 확실한 값은 시각적으로 강조한다.
  엔진 후보 밖의 카탈로그 직접 검색/오퍼 선택은 같은 패널의 보조 경로로 유지한다.
- 관리자는 견적 라인의 [후보·근거]에서 고객과 동일한 후보 스냅샷·현재 선택·변경 이력을 읽기
  전용으로 확인해, 고객 선택이 자동 추천과 달라진 이유를 추적한다.
- 관리자: `/app/admin/bom-quotes` + 설정 탭. 디자인 고도화는 후속(1차는 기본 구조).

## 검증 기록 (2026-07-20)

- **분석 정본·안정 ID 전환**: 실제 엔진 adapter 출력과 공유하는 골든 JSON을 Python에서 생성·
  exact 비교하고 Node에서 strict 파싱한다. 운영 수신은 passthrough로 미래 필드를 보존한다.
  Python 엔진/앱 선택 테스트 13건, Node 관련 테스트 22건과 api/api-contract/sp-vue typecheck 통과.
  기존 DB 273개 견적 행·798개 후보를 `quoteItemId`로 전부 백필했으며 orphan 0, 후보 유실 0을
  마이그레이션 전후 SQL로 확인했다. DB 저장→미래 필드 복원→cascade 정리와 실행 중 엔진의
  `/supplier-jobs` 등록→1개 component cache-only preflight(예상 외부 호출 0)도 통과했다.
- **페이지형 BOM 비교 실화면**: 기존 20행 견적에서 첫 페이지 5행, 2/4 페이지 이동 시 원본 행
  14~18로 교체, `검색 결과 없음` 필터 6건·1/2페이지·표시 5건을 Chrome에서 확인했다.
- **후보 패널 전체 원본 실화면**: 영속 분석 견적 #85의 10행에서 추출값 11개·근거 확인 9개·
  규칙 추론 1개를 표시하고, 원문 정전용량·허용오차·전압과 정규화 공학 단위 및
  F10/G10/C10/E10/I10 근거 셀이 확장 상태에서 함께 노출되는 것을 확인했다. 기본 접힘 상태에서는
  원본 영역을 약 170px로 줄여 현재 선택과 후보 목록이 같은 1080p 화면 안에 들어오는 것도 확인했다.
- API 전체 283/283 통과(통합 환경 플래그 29건 제외) · 신규 BOM 정책 11/11 ·
  api-contract/API/sp-vue typecheck · API lint · 변경 sp-vue 파일 lint · API/sp-vue production build 통과.
- **후보 패널 실데이터 E2E**: `(박용한정렬)EnvMainV5_BOM241209.xlsx` 첫 시트 108행 견적(#63)의
  기존 엔진 결과를 재적용해 제조사+MPN 후보 440건을 DB에 영속했다. 기술 1위와 가격 1위가 다른
  행에서 차순위 부품 선택→현재 선택/차액/이유 갱신→특정 DigiKey 오퍼 고정→동일 부품 최저
  실효가 Mouser 오퍼 복원→선택 이력 누적을 Chrome 실화면으로 확인했다. 콘솔 경고·오류 0건.
  동일 `EEE-1HA221P`의 `Panasonic`/`Panasonic Industry` 표기를 별칭으로 통합해 후보 2개→1개,
  공급사 오퍼 4개가 한 카드에 표시되는 것도 확인했다.
- **대형 후보 저장 내성**: 후보/스펙 JSON 443건의 단일 `createMany`가 MariaDB 패킷 한도로
  연결을 끊는 것을 실측하고 20건 단위 트랜잭션 배치로 교정했다. 같은 데이터 440건 저장 345ms,
  엔진 재반영 뒤 고객 명시 선택 후보 키·오퍼 키가 새 그룹 키로 재연결되는 것까지 확인했다.
- **관리자/고객 판정 일치 실증**: `(박용한정렬)EnvMainV5_BOM241209.xlsx` 첫 시트 108행을
  `componentId`로 대조. `spec_compatible 33 + verified_exact 26 = 자동 선정 59`(오퍼 57,
  가격 없는 정확 일치 2), `ambiguous 15 + input_conflict 6 + insufficient_input 18 = 검토 39`,
  `not_found 10 = 미매칭`으로 엔진 판정과 정확히 일치. 기존 일반 결과(auto 36/none 72)에서
  상단 스펙 기반 33행이 안전 후보를 확보했다. 판정 분포는 v2에서도 같고, 실제 선정은 위의
  하이브리드 정책에 따라 기술 1순위가 기본이며 검증·절감 조건을 만족할 때만 가격 후보로 바뀐다.
- **선택 시트 엔진 실증**: 동일 2시트/216행 파일을 `sheet_indexes:[0]`으로 실행해 preflight와
  supplier result 모두 108행, 판정 분포도 위 첫 시트 수치와 일치(선택 전 전체 검색 결함 교정).
- **라이브 e2e(이전 카탈로그 경로 역사 기록)**: CSV 업로드→파싱→build(카탈로그 자동 매칭,
  실 KRW 단가)→공급사 검색(preflight 클램프 500→60 확인·202→완료·자동 인제스트)→전체 재매칭(세트 10 → 주문수량
  40/100 박제·가격구간 하락 25→9.4KRW 반영)→견적요청(동결·이후 PATCH 409)→관리자
  목록·회신(answered·확정 45,000·잘못된 전이 409)→고객 회신 확인→원본 다운로드 전부 통과.
  인증 경계: 비로그인 401·회원의 admin 403·타인 잡 404. 현재 v6은 build의 카탈로그
  자동매칭·재매칭을 제거했으므로 해당 구간은 현행 동작 증명이 아닌 회귀 역사로만 유지한다.
- **렌더 최적화 실측(2026-07-20, 견적 #66 108행 Chrome)**: 수량 편집 1회의 Vue 패치 비용
  12~16ms(전 행 재렌더) → 행 컴포넌트 격리 후 0.6~3ms. 편집→1s 디바운스 저장→응답 반영
  전 과정에서 DOM 변형이 편집한 행 1개에 국한됨을 MutationObserver 로 확인. 자동저장 PATCH
  후 상세 GET 리페치가 사라진 것을 네트워크로 확인. 세트 수량 변경(전 행 재박제)은 9~11ms.
  수량·제외/복원·후보 드로어·BOM 비교 모달·관리자 목록/상세/읽기 전용 드로어 실화면 확인,
  콘솔 오류 0건.

## 알려진 한계(1차 허용, 문서화)

> 2026-07-19 코드 리뷰에서 확인한 후속 보완 항목과 재현 근거는
> [`bom-quote-code-review-2026-07-19.md`](./bom-quote-code-review-2026-07-19.md)에 기록한다.

- 최초 파일 파싱 잡·잡 소유·일일 검색 카운터는 인메모리(단일 인스턴스) — `prepare` 전에
  재시작한 파싱 중 견적은 "재업로드 안내"가 필요하다. `prepare`가 끝난 분석과 이후 공급사 검색은
  DB 정본에서 복구 가능하다.
- 이 구조 도입 전에 만들어진 견적은 분석 component 정본이 없어 BOM 비교가 기존 `sourceRow`로
  축퇴한다. 원본 파일 재분석과 전 행 componentId 대조가 모두 성공한 견적만 선택적으로 백필해야
  하며, 기존 견적을 자동 재해석하는 데이터 변경은 이번 전환에 포함하지 않는다.
- 카탈로그 직접 검색의 selectedOffer 스냅샷은 클라 제출값(조작 가능하나 RFQ 모델이라 이득 없음 —
  관리자 확정가가 정본). 엔진 후보 선택은 후보/오퍼 키만 받아 DB 스냅샷으로 서버 재계산한다.
  결제 연계 시 카탈로그 선택도 동일한 서버 선택 API로 통합해야 한다.
- 견적요청 접수 관리자 알림(메일)은 미구현 — `spcb/api/order-notify.php` 확장으로 후속.

## 2차+ 로드맵 (범위 밖 기록)

결제 연계(거버식 `g5_shop_cart` 스냅샷→orderform.php — 확정가 기반) · 관리자 풀 워크벤치
(협력사 RFQ·발주·선적 — sp-smartbom-web/xpse 의 재설계, 이 데이터 모델 위에서) ·
비회원 체험+IP rate limit · 운임 규칙 엔진 · Part Finder 컬렉션 ·
관리자 접수 알림 · 잡 스토어 영속화(다중 인스턴스).

## Parts Eyes 셸 — Figma 업로드 페이지 이식 (2026-07-19)

Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(node 87:9037)를 픽셀 충실도 중심으로 이식.
**다크 배경(상단바·사이드바)은 사용자 결정으로 라이트 모드 치환**, 구조·치수·중앙 콘텐츠는 시안 그대로.

- `layouts/BomLayout.vue`: 상단바(로고·샘플 토글·타이틀·프로필) + 좌측(BOM 분석/단일 검색
  /Recent file=남은 브라우저 높이에 맞춘 최신 견적, 데이터 수와 무관하게 [모두 보기] 상시 노출) + 중앙 흰 패널 +
  우측 프로모 카드 2종. /bom 라우트 전용 셸(DefaultLayout에서 분리).
- `pages/bom/BomHistory.vue`: 파일·견적명 검색, 상태 필터, 페이지 이동, 현재 페이지 선택,
  개별/선택/전체 삭제. 삭제는 서버에서도 본인 `draft`로 제한하며 요청·검토·답변 이력은
  전체 삭제에서도 보존한다. `POST /api/bom/quotes/delete`가 최대 200개 선택 또는 전체 범위를 처리한다.
- `pages/bom/BomHome.vue`: 토글 · 드래그&드롭 카드(그라데이션+글로우+로고+Select file,
  선택 즉시 업로드→분석 이동 — 시안에 시작 버튼 없음) · 헤드라인 · 공급사 필 3종
  (사용자 지시: UNIKEY·DigiKey·MOUSER만).
- 에셋: `assets/bom/`(Figma 익스포트 커밋 — 아이콘 SVG는 라이트용 재색상, 로고는 그라데이션
  베이크드 크롭(블렌드모드가 img 내 검은 backdrop과 합성되는 문제 회피), 공급사 필은 합성 렌더 2x).
- 업로드 한도 30MB→50MB(시안 카피 정합, 서버 동기).
- **시안 대비 미구현(표시만) 리스트**: 샘플 토글 · 프로필 메뉴 ·
  프로모 카드 링크(튜토리얼/Gerber Eyes) — 표시 요소는 존재, 동작은 후속.

### 단일 검색 `/bom/search` (2026-07-20)

사이드바 메뉴·홈 토글의 "단일 검색"을 실라우트로 활성화. 결과는 **BOM 분석 결과 표와
같은 시각 언어의 테이블**(사용자 지시 — 카탈로그 열람 전용, `?q=` 초기 질의 지원).

- **서버 보강**: `GET /api/bom/parts-search` 에 `needed`(기본 1) 추가 — ES 검색 후 상위
  20개 partId 오퍼를 DB 일괄 로드해 `pickDefaultOffer`(@sp/utils, FE 동일 함수)로 부품별
  **대표 구매 조건(`applied`: 적용 단가·구간·MOQ 보정 주문수량·가격구간·stockShort)** 을
  계산해 첨부(계약 `BomPartSearchQuery/BomPartHit/BomPartSearchResponse`). ES 문서 슬림
  원칙 유지(오퍼는 DB 에서). 환율 문맥이 없어 KRW 환산 없이 원통화 표시.
- **FE 테이블**: `BomSearch.vue`(풀폭, 검색+필요수량 폼) + `BomSearchRow.vue` — BomQuoteRow
  와 시각 언어 공유(공급사 배지+이미지 76px·가격구간 셀·초록 합계·재고 부족 노랑 행,
  BOM 문맥 배지는 없음). [구매 조건] 클릭 시 행 확장으로 전체 오퍼·공급 포장 비교.
- **공용 조각 추출**(시각 일관성의 구조적 보장): `bom/supplier-meta.ts`(배지 메타),
  `BomPriceBreaks.vue`(가격구간 4행+적용 강조+확장+데이터 나이 — BomQuoteRow 와 공유),
  `bom/format.ts`(fmtAge), `BomPartOfferOptions.vue`(부품 1건 오퍼·포장 비교 —
  BomPartSearchPanel 상세부 추출, browse=열람 전용/select=부품 변경 문맥 공용).
- 후속(범위 밖): 결과 부족 시 공급사 실시간 검색 fallback(엔진 잡 재사용) ·
  "견적에 추가" 액션(서버 선택 API 통합) · 고객 노출 가격 정책(samplepcb 파생 오퍼) 결정.

### 상세 페이지(87:12875) 이식 (2026-07-19)

Figma "02 BOM 파일 분석_검색 결과" 레이아웃에 기존 기능 병합(사용자 지시: 채팅·가격순 정렬
제외, Found 대신 기존 매칭 배지, 공급사 배지는 vueline 방식 파비콘 정적 커밋):
- 테이블: 공급사 배지(라이트 필+파비콘+이름, 로고·이미지 열 76px 정사각 정렬)·구간가(상위 4+
  가격 상세 확장·활성 파랑)에서 시작했으며, 2026-07-20 하이브리드 개편 후에는 적용 단가·
  기준 나이·패키지·수량/재고·매칭 배지+초록 합계·선택 출처/이유·[후보 비교/제외↔복원]으로
  단순화했다. 전체 가격구간·부품 변경·공급사 오퍼 상세는 후보 비교 패널에서 처리한다.
  미매칭 행 분홍·재고 부족 노랑·제외 흐림은 유지한다.
- 우측 패널: AI 분석결과(TOTAL/MATCHED %/NOSTOCK/REVIEW/UNMATCHED)·주문 정보(세트/예비 스테퍼·
  납기 "확정 시 안내")·예상 견적(최종합계 파랑 강조·VAT 별도·가견적 각주)·[견적요청].
  분석 카드는 결과 표 필터로도 동작한다. MATCHED/REVIEW/UNMATCHED는 단일 상태 필터,
  NOSTOCK은 상태와 조합 가능한 독립 재고 필터, TOTAL은 전체 필터 해제다.
  — BomLayout 프로모 aside 는 홈에서만 표시
- 공급사 검색 적용: 엔진이 기술적으로 허용한 후보의 제조사·설명을 선택 스냅샷에 함께 박제
- draft 하단 액션(2026-07-19): [견적 삭제] = 하드 삭제(`DELETE /quotes/:id` — 항목 cascade·
  원본 파일 정리, 2단계 인라인 확인) — 사용자 결정으로 작성 취소를 대체. requested 는 [요청 취소] 유지.
- 부품 이미지(2026-07-20): 라인 `partImageUrl` = 카탈로그 `sp_part.imageUrl` 을 응답 시
  `toDetailDto` 가 일괄 조회해 채움(스냅샷 아님 — 항상 현재 카탈로그, PATCH 왕복 없는
  서버 계산 필드). 행 76px 정사각 `<img>`(no-referrer·onerror 시 플레이스홀더 축퇴),
  부품 검색 모달·관리자 카탈로그 목록에도 표시. 후보 비교 데이터(`BomQuoteCandidate.imageUrl`)
  는 엔진 `image_url` 스냅샷. 상세: docs/PARTS_SEARCH.md 이미지 절.
- 워크벤치 결과 테이블의 미구현(디자인만): 선택 삭제 · 행 정렬 핸들

### 렌더 성능 구조 (2026-07-20)

수백 행에서 수량 타이핑·폴링마다 테이블 전체가 재렌더되는 버벅임을 행 단위 격리로 교정:

- **`BomQuoteRow.vue`**: 행 표시(배지·선정 이유·가격 포맷)를 행별 computed 로 갖는 컴포넌트.
  item 은 부모 소유 객체를 그대로 받고(변경은 emit — `qty-change`/`toggle-include`/
  `open-candidates`), props 참조가 안 바뀐 행은 Vue 가 patch 를 건너뛴다.
- **참조 안정 동기화**: `watch(detail)` 가 vue-query structural sharing 이 유지해 준 서버 항목
  참조를 `lastServerItems` 로 추적해, 내용이 안 바뀐 행은 기존 로컬 클론을 재사용한다.
  폴링(자동 보강 3s)·저장 응답이 와도 실제 바뀐 행만 재렌더된다.
- **자동저장 경로**: `usePatchBomQuote` 는 `['bom']` 전체 무효화 대신 PATCH 응답(서버 재계산
  포함)을 `setQueryData` 로 상세 캐시에 직접 반영 — 저장마다 따라오던 GET 리페치 제거.
  목록·후보 캐시만 무효화(비활성이면 비용 0).
- 통계·합계(`stats`)는 한 번의 순회로 계산(행 속성 변경마다 5~7회 전 행 filter 제거).
- 남은 여지(비병목): 2,000행 상한의 최초 마운트는 여전히 전 행 DOM 생성 — 필요해지면
  가상 스크롤 도입(현 108행 실측에선 불필요 판단).

### BOM 비교 모달 (2026-07-19, 영속 스냅샷 전환 2026-07-20)

상세 헤더 [BOM 비교]: Excel 원본과 공급사 후보를 부품 단위로 대조하는 전체 화면 모달
(`components/bom/BomCompareModal.vue`). 결과는 모달을 열 때 quote 소유권을 검증한 뒤 지연 조회한다
(`GET /api/bom/quotes/:id/comparison` — 분석 component와 후보 payload의 영속 스냅샷).

초기 구현은 `/jobs/:id/supplier-search/result`를 다시 조회해 엔진 재시작으로 인메모리 잡이 사라지면
이미 DB에 후보가 박제된 완료 견적도 비교만 404가 났다. 비교 경로를 quoteId 기반 DB 읽기로 전환해
엔진 가동 여부·잡 생존 여부와 분리했으며, 손상된 구버전 후보는 해당 후보만 격리한다.

- 조인: 분석 component→quoteItem→candidate를 각각 영속 ID로 연결한다. `rowIdx`는 표시 순서일 뿐
  관계 키로 쓰지 않으며, 엔진 component 배열 순서나 원본 행·REFDES의 우연한 일치에 의존하지 않는다.
- 판정: 박제한 엔진 검증 결과 그대로 — status 요약 카드(검증·호환/확인 필요/결과 없음)+행 칩,
  셀 색은 `specComparisons`·`packageComparison` state(일치/불일치/확인 불가), relation 칩
  (정확·별칭·호환·범위 충족 등)
- 열: 항목·Excel 원본(sticky) + 공급사 열(Mouser/DigiKey/UniKeyIC 고정 + 발견 공급사) —
  같은 제조사+MPN 후보 아래 통합한 공급사 오퍼에서 재고·MOQ·최저 단가·수명주기 표시
- 필터: 검색어·판정·시트는 서버 적용, 공급사 열은 현재 페이지 표시 제어. 페이지당 5부품 ·
  로딩/실패(재시도)/결과 없음 상태 패널. 후보가 없어도 분석에서 추출된 행은 모두 반환하며,
  raw value와 전체 동적 필드·근거 셀·추출 방식을 함께 표시한다.
