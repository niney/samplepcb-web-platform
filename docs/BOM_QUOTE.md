# 고객 스마트 BOM 견적 (BOM Quote)

> 정본 설계 문서 (2026-07-19). 레거시 vueline `spSmartBomV2`(고객 BOM 업로드 페이지)의
> **재설계 재구현** — 동일 이식이 아니라 레거시 결함을 교정한 새 구현이다.
> 관련: `docs/PARTS_SEARCH.md`(부품 카탈로그 — 매칭·오퍼의 원천), `AGENTS.md`.

## 한눈에

```
고객(/app/bom, 회원 전용)                sp-node(/api/bom)                sp-engine(:8400)
 업로드(xlsx/xls/csv/…) ───────────▶ POST /quotes(원본 파일서버 보존) ──▶ 전체 시트 파싱 잡
 시트 선택(다중 선택) → build ─────▶ 선택 시트만 라인 + 1차 카탈로그 매칭 ◀── sp_part*(DB)+sp-parts(ES)
 검토(수량·오퍼·포함) → 1s 자동저장 ─▶ PATCH(draft, replace-all)
 (버튼 없음 — 조용한 자동 보강) ◀──── build 직후 서버가 판단·검색 실행 ─▶ Mouser/DigiKey/UniKeyIC
   "가격·재고 확인 중…" 라벨만        └ 자동 인제스트 → 엔진 판정+기술·가격 하이브리드 추천 반영
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
  engineJobId(엔진 인메모리 잡 — 재시작 시 소멸)·**buildStatus(파싱·선택·계산 생명주기)**·
  setQty/spareQty·
  **예상 스냅샷**(itemsTotal/shippingFee/managementFee/finalTotal/usdKrwRateUsed/uncostedCount)·
  **enrichStatus/enrichedAt(자동 보강 생명주기 — 서버 영속 단일 진실)**·
  customerMemo·adminMemo(내부)·answerNote(고객 노출)·confirmed*(관리자 확정)·requestedAt/answeredAt
- `sp_bom_quote_item`(SpBomQuoteItem): rowIdx·included·mpn·bomQty·**orderQty(박제 수량 = 단일 진실)**·
  matchStatus(auto|manual|none)·**matchEvidence Json(엔진 판정·안전 후보·선정 정책 스냅샷)**·
  **recommendedCandidateKey/selectedCandidateKey/selectionSource**(자동 추천과 실제 선택 분리)·
  partId(sp_part 느슨한 참조, FK 없음)·
  **selectedOffer Json(오퍼 스냅샷 박제 — 가격구간 사다리 포함·pinned)**·lineTotalKrw·sourceRow(원본 근거)·
  sourceSheetIndex/sourceSheetName
- `sp_bom_quote_candidate`(SpBomQuoteCandidate): 엔진 공급사 행을 **제조사+MPN 부품 후보**로 묶은
  견적 문맥 스냅샷. 기술 순위·안전 판정·오퍼/가격구간·검증 근거를 보존해 엔진 인메모리 잡이
  사라져도 고객과 관리자가 동일한 후보를 비교한다. 스펙은 기술 순위 최상 후보를 정본으로 삼고
  공급사별 값의 임의 필드 병합은 하지 않으며, 동일 부품의 공급사 오퍼만 한 후보 아래 통합한다.
- `sp_bom_quote_selection_event`(SpBomQuoteSelectionEvent): 고객 명시 선택의 이전/선택 후보·MPN·
  오퍼·행 금액·이유를 누적한다. item replace-all 자동저장과 분리되어 선택 감사 이력이 보존된다.
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
| 오퍼 자동 선정 `pickDefaultOffer`: **실효 총비용**(오퍼별 MOQ·배수 반영 실효수량×적용단가, KRW 환산) 최저. 재고 충분→환산 가능 우선, 동률 시 재고↓→PKG(Cut>Digi>Bulk>Tape) | 신규 — 레거시는 단일 부품 pkg 선택뿐 |
| `pinned`(사용자 명시 선택): 수량 변경 시 그 오퍼 안에서 구간만 재계산, 자동 라인은 재선정 허용 | 레거시 "선택 pkg 내 탐색" 일반화 |
| 통화: 오퍼 원통화 보존, USD 는 sp_config 환율로 KRW 환산 예상(미설정 시 미환산=uncosted 경고) | 신규 |
| samplepcb 파생 오퍼는 견적 선정 후보 제외(자기 선택 순환 방지) | — |
| 납기: "확정 시 안내" 문구 | '2주' 하드코딩 제거 |

**서버 재계산 원칙**: 합계는 항상 서버가 스냅샷에서 재계산(클라 금액 불신). 검색 완료 후
스냅샷 단가는 엔진의 안전 후보 오퍼 중 서버가 선택하며, 최종 확정가는 관리자 검토가 결정하는 RFQ 모델.

## 조용한 자동 보강 (2026-07-19 — 고객에게 "공급사 검색" 개념 비노출)

build 직후 서버(`routes/bom-quotes.ts autoEnrichQuote`)가 판단·실행하고 FE 는 상태 라벨만:
- **필요 조건**: 엔진 판정(`matchEvidence`)이 없는 업로드 라인 OR included 미매칭 라인 존재
  OR 오퍼 나이 > `freshnessHours`(기본 24h). 카탈로그가 신선해도 최초 업로드는 반드시 엔진
  검증을 거쳐 느슨한 MPN 존재 여부가 관리자 수준 판정을 대신하지 못하게 한다.
- **비용 게이트**: preflight 예상 호출이 한도 내면 라이브 검색(일일 카운트 1회), 한도
  초과(초대형 BOM)·일일 소진이면 `cache_only`(0콜). 엔진 불가면 조용히 생략(카탈로그 데이터 유지).
- **생명주기 상태 기계(2026-07-19 정석화)**: `sp_bom_quote.enrichStatus`
  (`idle|searching|done|failed`) + `enrichedAt` — **서버 영속 단일 진실**. 전이:
  build 가 보강 필요를 동기 선판정해 **items 와 `searching` 을 함께 커밋**("items 는 있는데
  idle" 창 제거 — 그 창에서 조회되면 전 라인이 빨간 미매칭으로 렌더됐다, 실측 ~1.2s) 후
  검색 개시를 확정(실패 시 failed·불필요 시 idle 로 되돌림) → 반영(`refreshQuoteFromSupplierResult`)이 매칭 라인과
  `done`+`enrichedAt` 을 **한 저장으로 커밋**(상태·데이터 원자성 — "검색 완료 후 빨간
  미매칭 깜빡임"이 불가능해짐) → 시작 실패·잡 소실은 `failed`(최종 판정 표시).
- **완료 반영 경로 3중**: ① 인제스트 폴러 onDone ② 결과 조회 백업 훅 `refreshQuotesForJob`
  (engineJobId 역조회) ③ **게으른 치유** — `searching` 견적의 상세 GET 이 엔진 상태를 확인해
  completed 면 인제스트+엔진 판정 반영을 즉발(고객의 3초 폴링이 곧 치유 트리거 — 갭 단축 겸용),
  잡 소실·엔진 다운이면 `failed` 로 종결. 어떤 재시작 후에도 조회만으로 상태가 수렴한다.
  반영 자체는 `componentId`로 원본 행과 엔진 결과를 조인한다. 수동/pinned 행은 보존하고,
  나머지는 엔진의 안전 후보 판정과 선택 오퍼를 한 저장으로 교체한다.
- **기술·가격·물리 호환 하이브리드 자동 선정(`engine-hybrid-physical-v3`, 2026-07-20)**:
  `verified_exact` → `verified_variant` → `spec_compatible`의 엔진 기술 순위와 현재 필요수량의
  실효 총비용 순위를 분리한다. 원본 MPN이 있는 행은 기술 최상위 부품을 고정하고, 같은
  제조사+MPN 아래에서만 MOQ·주문배수·재고·가격구간·환율 반영 최저 오퍼를 고른다. MPN 없는
  스펙 행도 기본은 기술 1순위다. `valueRaw`·원본 패키지의 `칩전해/SMD/SMT/스루홀`과
  `파이/Ø/Dia` 직경 표현을 공급사 `attributes`·정규 스펙·패키지 설명과 교차 검증한다.
  실장 방식·직경이 다르거나 공급사 간 물리 정보가 충돌하면 후보를 자동선정/고객선택에서
  제외하고, 필요한 물리 속성이 없으면 검증 필요 후보로 분리한다. 한국어·영어 카테고리를
  함께 인식하며 전해 커패시터에는 유전체 코드를 강제하지 않는다. 카테고리별 필수 스펙과
  원본이 요구한 물리 조건이 **전부 검증**되고 충돌·필수값 누락이 없으며 재고가 충분한 후보에 한해, 기술 1순위 대비
  **10% 이상이면서 500원 이상** 절감될 때만 다른 MPN을 가격 추천한다. 기술 1순위가
  NRND/EOL이고 `active|활성` 후보가 있으면 수명주기를, 가격/재고가 없거나 부족하면 구매 가능성을
  우선한다. 그 외에는 낮은 가격만으로 차순위를 자동 선택하지 않는다.
  `ambiguous|input_conflict|spec_partial|insufficient_input`과 충돌/누락 후보는 비교에는 남기되
  고객 선택을 막는다. 세트·예비 수량 변경 시 자동 추천만 현재 가격으로 재평가하고,
  고객이 명시한 후보/공급사 오퍼는 유지한다. 후보 패널의 검증률은 엔진 confidence를 그대로
  `100%`로 표시하지 않고 실제 확인 필수조건 수로 계산하며, 실장 방식·직경 일치와 제외 사유를
  한글로 노출한다. 추천 유형·기술 순위·검증 수·절감액/비율·이유 코드는
  `matchEvidence`에, 전체 후보·오퍼는 `sp_bom_quote_candidate`에 박제한다.
- **접미사 변형 매칭(2026-07-19)**: 카탈로그 매칭은 정확 mpnNorm 우선, 없으면 프리픽스+
  잔여 ≤4자 폴백(길이 ≥6 가드) — 고객이 베이스 품번(TLV70225DBV)만 적고 공급사는
  접미사형(…DBVR/…DBVT)만 파는 관행 대응(엔진 verified_variant 와 정합). 동시성 견고화:
  인제스트 동시 호출은 완료를 공유 대기(부분 카탈로그 재매칭 방지), 견적 재매칭은
  quote 단위 직렬화, FE 는 done 후 8초 정착 refetch.
- **"확인 중" UI**: `enrichStatus==='searching'` 이면 미매칭 라인은 빨간 "미매칭" 대신 파란
  "확인 중"(펄스, 중립 행) — 빨간 미매칭은 `done/failed` 후의 **최종 판정**에만. 진행 배너
  (검색 중엔 엔진 progress %, 엔진 완료 후엔 "결과를 반영하고 있습니다" 100%)·우측 통계
  "확인 중" 카드·합계 노트·견적요청 비활성("가격 확인 중…"). searching 동안 견적 3초 폴링,
  searching→done 전환 토스트. searching 동안 FE와 PATCH를 모두 잠가 replace-all 경합을 막는다.
  done 뒤 카탈로그 재매칭은 엔진의 검토/충돌 판정을 덮어쓰므로 호출하지 않는다.
- 라인 오퍼에 "기준 N일 전" 나이 배지(데이터 정직성 — 방금 조회처럼 보이지 않게).
- 라이브 검증: 카탈로그 미보유 STM32F030F4P6 업로드 → build 미매칭 → 고객 개입 0으로
  자동 검색→적재→실 Mouser 오퍼(₩3,042) 매칭·합계 갱신 확인. 2026-07-19 초기화 상태
  (카탈로그 3건)에서 3부품 CSV 재검증 — 업로드 즉시 "확인 중" 모드, 완료 후 3/3 매칭
  (Mouser·Digikey 실오퍼)·합계 갱신·버튼 활성.

## 비용 정책 (sp_config `bom_quote` — 관리자 설정 승격)

`/app/admin` 설정 → BOM 견적 탭: 기본 운송료(30,000)·기본 관리비(25,000)·USD→KRW 환율
(비우면 미환산 표시)·검색 1회 최대 API 호출(300)·회원별 일일 검색 한도(20)·데이터 신선 임계(24h).
레거시·구 관리자 콘솔 모두 계산 로직 없이 상수/수동 입력이던 것을 설정으로 승격.
고객 화면 표기: **"예상 견적 — 확정 시 변동" + VAT 별도**. 확정가는 관리자 검토(confirmed*)가 정본.

## API

**회원 `/api/bom`** (`routes/bom.ts`·`bom-quotes.ts`, `authenticate`):
- `POST /quotes`(multipart) 업로드→견적+엔진 잡 · `GET /quotes`(내 목록) · `GET/PATCH /quotes/:id`
  (PATCH 는 draft 한정, items **replace-all** — 레거시 문서 자동저장 방식)
- `POST /quotes/:id/prepare`(파싱 결과의 시트별 상태·부품 수 영속) →
  `POST /quotes/:id/build {sheetIndexes}`(선택한 parsed 시트만 라인+카탈로그 매칭, 최대 2,000라인) ·
  `GET /quotes/:id/items/:rowIdx/candidates`(영속 후보·현재 수량 가격·선택 이력) ·
  `POST /quotes/:id/items/:rowIdx/selection {candidateKey,offerKey}`(draft 전용, 가격은 서버 재계산) ·
  `/catalog-match`(onlyUnmatched 기본 — pinned 보존) · `/request`(재계산·동결) · `/cancel` · `DELETE`(draft)
- 잡 프록시: `GET /jobs/:id[/result]`, 공급사 검색 `POST /jobs/:id/supplier-search[/preflight]`
  — **소유 회원만**(타인·미기록 404 은닉), 일일 한도 초과 429 `SEARCH_DAILY_LIMIT`,
  max_calls 는 sp_config 로 클램프. 자동 인제스트(폴러+백업 훅)는 관리자 플로우와 동일.
- 카탈로그: `GET /parts-search`(교체·추가 모달, admin-parts 쿼리 빌더 재사용) · `GET /parts/:id`

**관리자 `/api/admin/bom-quotes`** (`routes/admin-bom-quotes.ts`, `requireAdmin`):
목록(기본 draft 제외)·상세·`PATCH`(상태 전이 검증+확정가+메모)·`GET /:id/file`(원본 스트리밍)·
`GET /:id/items/:rowIdx/candidates`(고객과 같은 후보·선정 근거·이력, 읽기 전용).

## 화면

- 고객: `/app/bom`(업로드+내 견적 이력), `/app/bom/:id`(워크벤치 — 좌 결과 테이블+우 주문
  패널, 레거시 기본 구조). sp-vue 에 **일반(회원) 라우트 그룹 신설** — "sp-vue=관리자 전용"
  전제 공식 변경(router.ts 주석). `meta.requiresMember` 가드 = 그누보드 로그인 왕복.
- 워크북에 BOM으로 인식된 시트가 하나면 자동 선택하고, 둘 이상이면 계산 전 체크박스
  다중 선택 단계를 표시한다. `not_bom`·`error` 시트는 사유와 함께 비활성화한다. 선택값은
  `sp_bom_quote_sheet`, 라인 원본 위치는 `sourceSheetIndex/sourceSheetName`에 영속한다.
  생명주기는 `buildStatus`(`parsing→selecting→building→ready`, 실패=`failed`)로 판정하며
  `items.length===0`을 분석 중 신호로 사용하지 않는다.
- 선택 시트에서 엔진이 컴포넌트로 판정한 행은 MPN 유무와 관계없이 모두 라인으로 보존한다.
  표시·저장 순서는 워크북 시트 순서→Excel 원본 행 번호이며, MPN이 없는 행은 `value_raw`를
  화면 대표값으로만 표시하고 빈 MPN으로 저장해 카탈로그 품번으로 오인하지 않는다. 고객 결과
  표에는 시트명과 1-based Excel 행 번호를 별도 열로 표시한다.
- 공급사 검색에도 선택한 `sheet_indexes`를 전달한다. 따라서 선택되지 않은 시트는 외부 API
  호출·카탈로그 인제스트·견적 합계 모두에서 제외된다. 여러 선택 시트의 동일 품번은 감사 가능한
  원본 라인으로 각각 유지하고, 동일 검색 조건의 공급사 호출만 엔진 배치에서 재사용한다.
- 고객 결과는 `매칭 / 가격 확인 필요 / 검토 필요 / 미매칭`과 함께 적용 단가·선택 출처·선정
  이유·대체 후보 수를 표시한다. 기존 [변경]+[상세]+가격구간 확장을 **[후보 비교] 우측 패널**로
  통합했다. 패널은 현재 선택과 금액, 자동 추천 이유, 기술/가격 순위, 검증 수, 차액, 공급사별
  MOQ·재고·적용 단가·행 총액을 함께 보여주며 안전 후보와 특정 공급사 오퍼를 명시 선택할 수 있다.
  엔진 후보 밖의 카탈로그 직접 검색/오퍼 선택은 같은 패널의 보조 경로로 유지한다.
- 관리자는 견적 라인의 [후보·근거]에서 고객과 동일한 후보 스냅샷·현재 선택·변경 이력을 읽기
  전용으로 확인해, 고객 선택이 자동 추천과 달라진 이유를 추적한다.
- 관리자: `/app/admin/bom-quotes` + 설정 탭. 디자인 고도화는 후속(1차는 기본 구조).

## 검증 기록 (2026-07-20)

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
- **라이브 e2e**: CSV 업로드→파싱→build(카탈로그 자동 매칭, 실 KRW 단가)→공급사 검색
  (preflight 클램프 500→60 확인·202→완료·자동 인제스트)→전체 재매칭(세트 10 → 주문수량
  40/100 박제·가격구간 하락 25→9.4KRW 반영)→견적요청(동결·이후 PATCH 409)→관리자
  목록·회신(answered·확정 45,000·잘못된 전이 409)→고객 회신 확인→원본 다운로드 전부 통과.
  인증 경계: 비로그인 401·회원의 admin 403·타인 잡 404.

## 알려진 한계(1차 허용, 문서화)

> 2026-07-19 코드 리뷰에서 확인한 후속 보완 항목과 재현 근거는
> [`bom-quote-code-review-2026-07-19.md`](./bom-quote-code-review-2026-07-19.md)에 기록한다.

- 엔진 잡·잡 소유·일일 검색 카운터는 인메모리(단일 인스턴스) — 재시작 시 파싱 중 견적은
  "재업로드 안내"로 복구(빌드 완료된 견적은 DB 라 무관).
- 카탈로그 직접 검색의 selectedOffer 스냅샷은 클라 제출값(조작 가능하나 RFQ 모델이라 이득 없음 —
  관리자 확정가가 정본). 엔진 후보 선택은 후보/오퍼 키만 받아 DB 스냅샷으로 서버 재계산한다.
  결제 연계 시 카탈로그 선택도 동일한 서버 선택 API로 통합해야 한다.
- 견적요청 접수 관리자 알림(메일)은 미구현 — `spcb/api/order-notify.php` 확장으로 후속.

## 2차+ 로드맵 (범위 밖 기록)

결제 연계(거버식 `g5_shop_cart` 스냅샷→orderform.php — 확정가 기반) · 관리자 풀 워크벤치
(협력사 RFQ·발주·선적 — sp-smartbom-web/xpse 의 재설계, 이 데이터 모델 위에서) ·
비회원 체험+IP rate limit · 운임 규칙 엔진 · Part Finder 컬렉션 · 환율 자동 갱신(수출입은행) ·
관리자 접수 알림 · 잡 스토어 영속화(다중 인스턴스).

## Parts Eyes 셸 — Figma 업로드 페이지 이식 (2026-07-19)

Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(node 87:9037)를 픽셀 충실도 중심으로 이식.
**다크 배경(상단바·사이드바)은 사용자 결정으로 라이트 모드 치환**, 구조·치수·중앙 콘텐츠는 시안 그대로.

- `layouts/BomLayout.vue`: 상단바(로고·샘플 토글·타이틀·프로필) + 좌측(BOM 분석/단일 검색
  /Recent file=내 견적 최신 4건 실데이터) + 중앙 흰 패널 + 우측 프로모 카드 2종. /bom 라우트
  전용 셸(DefaultLayout에서 분리).
- `pages/bom/BomHome.vue`: 토글 · 드래그&드롭 카드(그라데이션+글로우+로고+Select file,
  선택 즉시 업로드→분석 이동 — 시안에 시작 버튼 없음) · 헤드라인 · 공급사 필 3종
  (사용자 지시: UNIKEY·DigiKey·MOUSER만).
- 에셋: `assets/bom/`(Figma 익스포트 커밋 — 아이콘 SVG는 라이트용 재색상, 로고는 그라데이션
  베이크드 크롭(블렌드모드가 img 내 검은 backdrop과 합성되는 문제 회피), 공급사 필은 합성 렌더 2x).
- 업로드 한도 30MB→50MB(시안 카피 정합, 서버 동기).
- **시안 대비 미구현(표시만) 리스트**: 단일 검색(메뉴·토글) · 샘플 토글 ·
  프로필 메뉴 · 프로모 카드 링크(튜토리얼/Gerber Eyes) — 표시 요소는 존재, 동작은 후속.

### 상세 페이지(87:12875) 이식 (2026-07-19)

Figma "02 BOM 파일 분석_검색 결과" 레이아웃에 기존 기능 병합(사용자 지시: 채팅·가격순 정렬
제외, Found 대신 기존 매칭 배지, 공급사 배지는 vueline 방식 파비콘 정적 커밋):
- 테이블: 공급사 배지(라이트 필+파비콘+이름, 로고·이미지 열 76px 정사각 정렬)·구간가(상위 4+
  가격 상세 확장·활성 파랑)에서 시작했으며, 2026-07-20 하이브리드 개편 후에는 적용 단가·
  기준 나이·패키지·수량/재고·매칭 배지+초록 합계·선택 출처/이유·[후보 비교/제외↔복원]으로
  단순화했다. 전체 가격구간·부품 변경·공급사 오퍼 상세는 후보 비교 패널에서 처리한다.
  미매칭 행 분홍·재고 부족 노랑·제외 흐림은 유지한다.
- 우측 패널: AI 분석결과(TOTAL/MATCHED %/NOSTOCK/UNMATCHED)·주문 정보(세트/예비 스테퍼·
  납기 "확정 시 안내")·예상 견적(최종합계 파랑 강조·VAT 별도·가견적 각주)·[견적요청]
  — BomLayout 프로모 aside 는 홈에서만 표시
- catalogMatchItems 보강: 소스 BOM 에 제조사·설명 열이 없으면 카탈로그 정본으로 채움
- draft 하단 액션(2026-07-19): [견적 삭제] = 하드 삭제(`DELETE /quotes/:id` — 항목 cascade·
  원본 파일 정리, 2단계 인라인 확인) — 사용자 결정으로 작성 취소를 대체. requested 는 [요청 취소] 유지.
- 미구현(디자인만) 추가: 선택 삭제 · 행 정렬 핸들 · 부품 이미지 · 데이터시트 링크

### BOM 비교 모달 (2026-07-19)

상세 헤더 [BOM 비교]: Excel 원본과 공급사 검색 원본 결과를 부품 단위로 대조하는 전체 화면
모달(`components/bom/BomCompareModal.vue`). 결과는 모달을 열 때만 지연 조회
(`GET /api/bom/jobs/:id/supplier-search/result` — `useSupplierSearchResult`, 소유 검증+백업 인제스트 훅).

- 조인: 시트 index까지 포함한 엔진 `component_id`를 우선 사용하고, 기존 견적만 원본 행+REFDES
  시그니처로 폴백(다중 시트의 같은 행·REFDES도 오결합 방지, 빈 시그니처일 때만 인덱스 폴백)
- 판정: 엔진 검증 결과 그대로 — status 요약 카드(검증·호환/확인 필요/결과 없음)+행 칩, 셀 색은
  spec_comparisons·package_comparison state(일치/불일치/확인 불가), relation 칩(정확·별칭·호환·범위 충족 등)
- 열: 항목·Excel 원본(sticky) + 공급사 열(Mouser/DigiKey/UniKeyIC 고정 + 발견 공급사) —
  스펙 비교 외에 재고·MOQ·최저 단가·수명주기(EOL/단종) 표시
- 필터: 검색어·판정·시트·공급사 열 선택, 페이지당 5부품 · 로딩/실패(재시도)/결과 없음/진행 중 상태 패널
