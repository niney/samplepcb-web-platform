# 협력사 보유 부품 (Partner Parts) — 정본

> 설계·구현 2026-08-23. 협력사가 올린 재고 목록을 저장하고, 고객 BOM 분석에서
> **기존 공급사와 같은 자리에서 뒤순위 후보로** 경쟁시켜 관리자가 견적요청을 걸기 쉽게 한다.
> 관련 정본: [BOM_QUOTE.md](./BOM_QUOTE.md) · [PARTS_SEARCH.md](./PARTS_SEARCH.md) ·
> [SMARTBOM_PARTNER_RFQ.md](./SMARTBOM_PARTNER_RFQ.md) · [PARTNER_PORTAL.md](./PARTNER_PORTAL.md)

## 한눈에

```
협력사 포털 · 관리자 대행
  재고표 업로드 ─▶ sp-engine `inventory` 프로필 ─▶ 미리보기(열 역할 교정) ─▶ 원장 sp_partner_part
                    (열 역할·품번 정리·플래그, 유실 0)      role_overrides 재실행     전체 교체 기본

고객 BOM 분석 (/app/bom)
  preflight ─▶ sp-node 가 정규 품번으로 원장 exact 조회 ─▶ 검색 잡 옵션 `local_products` 로 주입
            ─▶ 엔진이 외부 3사 결과와 **같은 매처·조달 정책**으로 한 번에 판정
            ─▶ 동률이면 소스 순위가 협력사를 뒤로 (실공급사 0 · 로컬 카탈로그 1 · 협력사 2)
            ─▶ 가격이 없으므로 자동 선정 불가 → 행에 "협력사 보유" 배지 → 관리자가 RFQ 발송
```

## 0. 결정 기록 (2026-08-23 확정)

| # | 결정 | 근거 |
|---|------|------|
| P1 | ~~저장은 부품 카탈로그(`sp_part`)와 분리~~ → **2026-08-23 하이브리드로 재결정(§1.5)**: 원장은 정본으로 유지하고 카탈로그에 파생 투영. 원문은 아래 —<br>**저장은 부품 카탈로그(`sp_part`)와 분리** — `sp_partner_part` 별도 원장 | 카탈로그 편입은 로컬-우선 검색·ES 패싯·고객 단일검색·`pickDefaultOffer` 기본 선정까지 다섯 갈래로 새고, 그때마다 "협력사 제외" 분기를 공급사 하드코딩 목록 10여 곳에 심어야 한다. `lib/partner.ts validateSupplierCode` 가 `type='partner'` 조직의 supplierCode 를 금지한 규칙과도 정면 충돌 |
| P2 | **최하위 폴백 티어가 아니라 "같은 자리 · 뒤순위"** | 사용자 결정. 별도 티어(`applyLocalCatalogFallback` 형제)는 트리거 범위 결정·합류 복잡도를 낳는다. 같은 판정에 태우면 "외부에 있지만 재고 0" 같은 실제 유스케이스도 결정 없이 얻는다 |
| P3 | **견적요청 제한 없음** | 사용자 결정. 매칭 협력사에게만 RFQ 를 강제하면 D32(미응답 회수·재배정)와 충돌하고 인센티브 왜곡(품번 대량 업로드로 RFQ 선점)이 생긴다. 대신 표시로 돕는다 |
| P4 | **만료 없음** | 사용자 결정. 값이 판단에 쓰이지 않고(가격 없음·구매 불가·자동 적용 불가) 진짜 검증은 RFQ 회신이 한다. 만료는 조용히 사라지는 실패(13·34호 교훈)라 더 나쁘다. 대신 **나이를 늘 보이게** 하고 관리자 뒤처리 도구를 갖춘다 |
| P5 | 고객에게는 **부분 노출** — 곳 수·기준일까지, 조직 이름·정확 재고는 관리자만 | PCB 여정 43호 "고객 화면에 공급망 미노출"과 같은 결. 중개 이탈 위험 완충 |
| P6 | 브랜드 없는 행은 **자동 선정 금지**(`autoQuoteEligible=false`) | 실측 표본의 57%가 제조사 누락. 품번만으로 자동 선정하면 오매칭이 금액을 만든다 |
| P7 | 단일검색·부품 추가에서도 **검색된다** | 사용자 결정(제한 없음). 단, 저장은 분리 원장이므로 별도 질의·별도 결과 그룹으로 붙인다 |
| P8 | 업로드 기본 모드 = **전체 교체** | 협력사가 올린 표가 그 시점 보유 전량이라는 실무 의미 |
| P9 | capability 는 기존 **`part_sale`** 재사용 | 정의·라벨·관리자 체크박스·시드가 이미 있는데 **어디서도 검사되지 않던** 죽은 능력이었다. 새 어휘 불필요 |

## 1. 왜 별도 원장인가 (A안 vs B안)

| | A. 카탈로그 편입 | B. 별도 원장 (채택) |
|---|---|---|
| 읽는 곳 | 로컬-우선 R/C·커넥터 · ES 패싯·관리자 검색 · 고객 단일검색 · `pickDefaultOffer` · exact 폴백 = **5** | BOM 검색 주입 1곳 (+ 관리자 조회) |
| "뒤순위" 보장 | 필터 10여 곳의 약속(`ENGINE_SUPPLIER_IDENTITIES`·`SUPPLIER_TRUST_ORDER`·`SAMPLEPCB_PRICE_SOURCE_ORDER`…) | 구조 — 다른 경로가 원장을 안 본다 |
| 규칙 충돌 | `validateSupplierCode`(partner 조직에 supplierCode 금지) | 없음 |
| 교체·정지·삭제 | supplier 키 스윕 + ES 유령문서 위험 | `partnerId` 한 컬럼 |
| 잃는 것 | — | `partId`(이미지·상세) — 협력사 데이터엔 원래 없다 |

## 1.5 카탈로그 투영 — P1 재결정 (2026-08-23)

**결정 변경**: P1(별도 원장 · 카탈로그 미편입)을 **하이브리드**로 고친다. 원장은 그대로
정본으로 두고, 반영 시점에 `sp_part`/`sp_part_offer` 로 **파생 투영**한다.
`samplepcb` 파생 구매 조건과 같은 관계다.

바꾼 이유는 일관성이다 — 실공급사 결과는 검색될 때마다 자동으로 카탈로그에 쌓이는데
(`parts-ingest`) 협력사만 밖에 살면 "부품이 어디 있는지"가 소스마다 다르다.

### 무엇이 어디로 가는가

| | 정본 | 파생 |
|---|---|---|
| 업로드 회차·원문(`mpnRaw`)·열 교정·행 수정 이력 | `sp_partner_part*` | — |
| 검색·[부품 추가]가 보는 부품·구매 조건 | — | `sp_part` / `sp_part_offer` |

구매 조건은 `supplier='partner'`, `supplierSku='{partnerId}:{원장 행 id}'` —
**SKU 접두가 곧 소유권**이라 그 협력사 몫만 골라 정리할 수 있다. 조직마다 공급사 코드를
부여하지 않는다(`validateSupplierCode` 가 협력사 조직의 supplierCode 를 금지하고,
발주·정산이 그 코드를 본다).

### 지키는 세 선

1. **정본 오염 금지** — `resolvePartFacts` 의 실공급사 집합에서 협력사를 뺀다. 재고표는
   "최신이 아니어도 된다"가 전제(P4)라 스펙·제조사 다수결에 참여하면 안 된다.
2. **색인 오염 금지** — `buildPartDoc` 이 협력사 구매 조건을 뺀다. 그래서 협력사 offer 를
   넣고 빼도 **ES 문서가 안 바뀌고**, 전체 교체 업로드가 실공급사 부품의 재색인을
   유발하지 않는다(P8 이 매 회차 전량 교체라 이게 없으면 색인이 매번 붓는다).
3. **가격 금지** — 투영 offer 에 priceBreak 을 만들지 않는다. 만드는 순간 자동 선정·합계로
   새는 길이 열린다. 값의 정본은 RFQ 회신이다.

②③ 덕분에 투영은 facts·색인을 아예 건드리지 않는다 — 이게 이 설계의 핵심 단순화다.

### 제조사 없는 행 (실측 57%)

`sp_part` 의 유일 키가 `(mpnNorm, manufacturerNorm)` 이라 제조사를 못 읽은 행은
`manufacturerNorm='unknown'` 으로 앉고 같은 품번의 진짜 부품과 **별개 레코드**가 된다.

해소를 시도하지 않기로 했다. 실측으로 죽은 접근이라서다 — 제조사 없는 6,097 고유 품번 중
로컬 카탈로그로 풀리는 것은 **90개(1.5%)** 뿐이고 5,972개(98%)는 카탈로그에 아예 없다
(브로커 재고표는 단종·희귀품이 많아 겹치지 않는다). 외부 API 로 풀면 업로드마다
6천 회 호출이라 상설 경로로 못 쓴다.

대신 **검색 노출 정책**으로 해결한다(아래 색인 정책) — unknown 껍데기는 색인되되
broad·파라메트릭 결과에서 빠지고, 품번으로는 찾힌다. 나중에 공급사 결과가 붙으면
`partnerOnly` 가 저절로 false 가 되어 정상 검색에 합류한다 — 별도 승격 트리거가 필요 없다.
사람 창구는 이미 있는 **행 수정**이다.

⚠ 실데이터에서 **제조사 표기 차이로 갈리는 경우**도 봤다: `LM2636MX/NOPB` 가 카탈로그엔
`Texas Instruments`, 협력사 재고표엔 `NS`(National Semiconductor)라 두 레코드가 됐다.
이건 unknown 과 다른 문제이고 기존 지렛대가 있다 — `manufacturer-alias.ts` 에 별칭을 넣고
`merge-manufacturer-keys` 로 과거 행을 합친다. 카탈로그 전체에 영향을 주므로 별도 판단.

### 색인 정책 — B안: 색인하되 판단에 쓰이는 자리에서만 뺀다 (2026-08-23 재결정)

처음에는 **색인 제외**로 갔다가 되돌렸다. 근거가 둘 다 틀렸기 때문이다.

- "품번 정확 일치는 색인 없이도 찾힌다" → **틀렸다.** `/bom/parts-search` 는 정확 품번도
  ES `term` 질의로 한다. 색인을 빼면 exact 까지 막혀 P7 이 아예 성립하지 않는다.
- "파라메트릭 결과가 더러워진다" → 실측하니 **자동으로는 안 생긴다.** 협력사 전용 문서는
  `specsSi`·`specVariants`·`packageCode` 가 전부 비어 파라메트릭 절에 매치되지 않는다.

대신 실측이 **다른 위험**을 찾아냈다: 제조사명 한 단어가 broad 질의의 `should` 에 걸린다.
`term manufacturerName.norm = "ti"` → 566건이 전부 협력사 전용이었다. 이건 진짜 오염이다.

그래서 지금 규칙은 이렇다.

| 자리 | 협력사 |
|---|---|
| ES 문서 생성 | **한다** (`partnerOnly`·`hasPartnerStock` 두 불리언) |
| 정확 품번 질의(라우트 선행 term) | **포함** — "이 품번 있나?"가 실제 용도다 |
| broad 질의의 **품번 절**(정확·접두·인픽스) | **포함** — 사람은 품번 전체를 외워 치지 않는다 |
| broad 질의의 제조사명·설명·스펙 절 | **제외** |
| `suppliers` 패싯 · `totalStock` 집계 · `minPrice` | **제외** — 검증 안 된 주장이 재고 필터를 통과하거나 고객 화면에 공급사로 뜨면 안 된다(P5) |
| 정본(`resolvePartFacts`) | **제외** |

문서에는 들어가되 **문서의 "판단에 쓰이는 부분"에는 안 들어간다**. 그래서 협력사 offer 를
넣고 빼도 실공급사 부품의 검색 순위·패싯·재고가 그대로다.

구현은 `buildSearchQueryInternal` 의 filter 한 줄이다 — **협력사 전용이 아니거나, 품번 절에
걸리거나**:

```
filter: [ { bool: { should: [
    { bool: { must_not: { term: { partnerOnly: true } } } },   // 일반 부품은 그냥 통과
    { bool: { should: mpnShould, minimum_should_match: 1 } },  // 협력사 전용은 품번으로만
], minimum_should_match: 1 } } ]
```

⚠ **처음엔 `must_not partnerOnly` 하나로 막았다가 접두 검색을 통째로 죽였다** — `88PW886`
이 0건이었다(사용자가 재업로드 후 발견). 품번 전체를 외워 치는 사람은 없으므로, MPN 절
(정확·edge·ngram)만 따로 모아 통과 조건으로 쓴다. 제조사명 절은 여기 안 들어가므로
"microchip" 한 단어에 협력사 전용이 쏟아지는 일은 여전히 막힌다(55건 → 0건 실측).

**구매 조건이 하나도 없는 부품은 색인하지 않는다.** 전체 교체로 유일한 offer 가 사라지면
`sp_part` 만 남는데(껍데기), 행은 남기고 **문서는 지우고 `indexedAt` 을 비운다**.
`tryIndexPart`·`indexChangedParts`·`parts-reindex` 세 경로 모두에 같은 규칙을 건다.
⚠ 삭제만 일어난 회차도 `refreshPartsIndex()` 가 필요하다 — 안 하면 지운 문서가 잠깐 더 검색된다.

**투영은 색인까지 책임진다.** 협력사 전용 부품은 색인돼야 품번으로 찾히고, 공존 부품은
`hasPartnerStock` 이 바뀌므로 갱신이 필요하다. 그래서 투영이 바뀐 partId 를 모아
`indexChangedParts` 를 부른다 — 구매 조건이 **빠지는** 부품도 모아야 한다(안 모으면 끈 원장이
검색에 남는다. 실제로 그렇게 한 번 새어 e2e 가 잡았다).

### ⚠ 원장을 우회해 지워지는 경로

`sp_part_offer` 에는 원장으로 향하는 FK 가 없다(대량 교체를 청크로 돌기 위해 일부러 안 걸었다).
그래서 **조직 삭제**처럼 원장이 cascade 로 사라지는 경로는 카탈로그 구매 조건을 고아로 남긴다.
`purgeOrphanPartnerOffers(partnerId?)` 가 SKU 의 원장 행 존재만 보고 치우며, 조직 삭제 라우트가
이를 호출한다. e2e 는 라우트를 안 타므로 `cleanupPartnerCatalog` 헬퍼가 같은 일을 한다 —
없을 때 12,000행짜리 스펙이 개발 DB 카탈로그를 12,000건 부풀렸다.

### 실측 (2026-08-23)

- 백필 12,175행: 33초(투영) · 색인 10,506건은 +1초(bulk 라 사실상 공짜) · 재실행 15초(멱등)
- 카탈로그: `sp_part` 20,232 → 30,622 (협력사 전용 10,390 · 실공급사와 공존 116)
- ES: 30,622 문서 · `partnerOnly` 10,390 · `hasPartnerStock` 10,506
- ⚠ **12,000행 반영이 4초 → 70초**로 늘었다(e2e large). 행마다 `ensureCatalogPart` +
  `upsertPartnerOffer` 두 질의를 돌기 때문 — 식별자 일괄 조회 + `createMany` 로 묶으면
  줄일 수 있다. 아직 안 했다.

### 단일검색 화면 — 협력사 보유 표 (2026-08-24)

⚠ **서버가 찾는 것과 화면이 그리는 것은 다르다.** 색인·질의를 다 고친 뒤에도 사용자에게는
여전히 "검색에 안 나온다"였다 — 단일검색 결과표가 **부품이 아니라 구매 조건 한 줄씩**을
그리기 때문이다. 협력사 부품은 설계상 가격을 만들지 않으니 그릴 줄이 없고, 헤더의
`검색 결과 - 1개 부품`만 바뀐 채 표에는 "가격과 재고가 확인된 공급사 구매 조건이 없습니다"가
떴다. 서버 왕복만 확인하고 화면을 안 본 대가다.

그래서 `BomSearchOfferTable` 에 세 번째 표(`협력사 보유`)를 세웠다 — **부품 단위 한 줄**이고,
`직접견적 가능 공급사` 표와 같은 골격이되 출처가 `offerOptions` 가 아니라 `items` 자체다.

| 칸 | 값 |
|---|---|
| Distributor | `협력사 보유` (+ 2곳 이상이면 곳 수) · 아래줄에 `협력사 재고표 · N일 전 기준` |
| Stock | `21,000개` — 숫자에 꼬리표를 겹치지 않는다. 출처는 바로 옆 `협력사 재고표 · N일 전 기준`이 이미 말한다 |
| Unit price | `견적요청 후 확정` — 가격을 약속하지 않는다 |
| 담기 | `partner_stock` selection 으로 카트에 넣는다 |

담기 계약에 세 번째 kind `partner_stock` 을 넣었다(`supplier_offer`·`manufacturer_catalog` 옆).
담긴 행은 `selectionSource='partner'` · `selectedOffer=null` · `lineTotalKrw=null` 이라
**문의**로 분류되고(`bomQuoteAdminAttention` 의 마지막 조건), 카트는 `협력사 보유` /
`견적요청 후 확정` 으로 표기한다 — `SamplePCB 재고 확인 필요` 로 뜨면 담당자가 어디에
물어야 할지 모른다.

노출은 P5 그대로다. ES 문서·검색 응답 어디에도 **조직 이름은 없다** —
곳 수·재고 합계·기준일까지만(`partnerStock` 객체). 이름은 관리자 화면에서만 조인한다.

### 백필

`pnpm --dir apps/api backfill:partner-catalog [-- --partner 8]` — 멱등. 투영 도입 전에
올린 원장을 따라잡게 한다. 수치는 위 실측 절 참조.

## 2. 데이터 모델

마이그레이션 `20260823100000_add_partner_parts` (추가 전용).

- **`sp_partner_part_upload`** — 업로드 회차 1건. `status(parsing→preview→applied|failed|superseded)` ·
  `mode(replace|merge)` · `mappingJson`(시트·열 역할 스냅샷 + 사람 교정 `engineOverrides`) ·
  `statsJson` · `previewJson`(**표본 200행만**, 반영 후 비움) · `uploadedBy(PARTNER|ADMIN)` ·
  `uploadedById`. 원본 파일은 파일서버 + `sp_file(refType='sp_partner_part_upload')` — **보관은 필수**다.

  ⚠ **`previewJson` 에 엔진 결과 원문을 통째로 넣으면 안 된다**(2026-08-23 실사용 실패):
  12,175행 재고표의 결과 JSON 이 6.36MB 라 MySQL 패킷 한도에서 **연결이 끊긴다**
  (`Server has closed the connection` → 화면엔 `BOM_ENGINE_ERROR`). BOM 견적의
  "대형 후보 저장 내성"과 같은 계열이며, 표본 크기 픽스처로는 절대 안 잡힌다.
  그래서 미리보기는 표본만 들고, **커밋에 필요한 전량은 보관 원본을 같은 교정으로 다시 돌려**
  얻는다(`rerunUploadFromArchive`). 추출은 결정론적 규칙 엔진이라 결과가 같다.
  원본 보관을 best-effort 로 두면 커밋이 막다른 길이 되므로 실패 시 업로드 자체를 실패시킨다.
- **`sp_partner_part`** — 재고표 1행. `mpn`·**`mpnRaw`(원문 항상 보존)**·`mpnNorm` ·
  `manufacturer`/`manufacturerNorm` · `stockQty`·`dateCode`·`leadTime`·`unitPrice`/`currency`·`moq` ·
  `rawFields`(미분류 열 원문)·`flags`(엔진 검토 플래그) · `isActive`(관리자 수동 스위치) ·
  **`editedAt`/`editedBy`**(마이그레이션 `20260823170000_add_partner_part_edit` — 사람이 고친 행).
- **`sp_partner_part_key`** — 한 행이 만드는 **조회 키 여럿**. `kind=canonical|alternative`.
  "진짜 품번" 하나를 고르면 반드시 틀리기 때문에(`PCA9575PW2, 118` 의 `118` 은 수량이 아니라
  NXP 포장 코드) 고르지 않고 전부 건다. FK 를 두지 않는다 — 전체 교체가 잦아 대량 삭제를
  청크로 돌기 때문(견적 삭제에서 배운 P2028 함정).

## 3. 엔진 — `inventory` 추출 프로필

BOM 추출기(`rule_extractor`)와 **별도 모듈**(`bom_extraction_engine/inventory.py`)이다.
BOM 경로는 의미가 정반대라 모드 분기를 넣으면 회귀 위험만 커진다:

| | BOM 추출기 | inventory 프로필 |
|---|---|---|
| price·단가·재고·stock | `_IGNORE_PAT` 로 **명시 폐기** | `unit_price`·`stock_qty` 역할 |
| 재고 수량 | `_QTY_NEG` 로 강등, 다른 수량 열 없으면 **보드당 수량으로 승격** | 재고 의미 |
| date code·납기 | 개념 없음 | `date_code`·`lead_time` |
| 재고 시트 | `non_bom_sheet_reason` 이 fail-closed 기각 | 정상 입력 |
| 품번 위생 | `DS1307Z+T&R` 를 **플래그 없이 null** (실측 결함) | 원문 항상 보존 + 플래그 |

- **무유실**: `part_number`(정리본) + `part_number_raw`(원문) + `part_number_alternatives`(잡음 제거
  후보) + `raw_fields`(역할 못 정한 열 전부) + `flags`. 품번 없는 행도 검토 대상으로 남긴다.
- **하나를 고르지 않는다**: 브랜드·수량·포장 접미가 섞인 셀은 정본을 원문으로 두고 후보를 함께
  낸다. 두 낱말 브랜드(`ACS725LLCTR-20AB-T Allegro MicroSystems`)까지 회수한다.
- **교정 루프**: 미리보기에서 사람이 열 역할을 바꾸면 `inventory_options.role_overrides` 로
  **엔진을 같은 파일로 다시 돌린다**(응용 계층이 셀을 재해석하지 않는다).
- **로더 교정(BOM 경로도 함께 이득)**: 시트 XML 50MB 초과면 calamine 으로 우회한다.
  서식만 남은 빈 열 잔재(12,176행 × 16,384열, 시트 XML 279MB)에서 openpyxl 은
  **17분 CPU·1.7GB 후에도 미완**이었고 calamine 은 **1.8초에 (12176, 7)** 로 읽었다.
  styles.xml 은 24KB 라 기존 비대 판정에 안 걸리던 구멍.

### 실측 (`.tmp/EUREKA-stock parts 8.6.xlsx`, 12,175행)

1.9초 · 열 역할 7/7 정확 · 고유 품번 10,096 · 제조사 있음 5,239(43%) ·
확인 권장 421행(플래그 `mpn_comma_suffix_alternative` 178 · `mpn_brand_suffix_stripped` 58 ·
`mpn_needs_review` 250 · `mpn_quantity_suffix_stripped` 20).
API 왕복 실측: 업로드+미리보기 4.8초 · 커밋 6.0초(원장 12,175행 + 조회 키 12,432건).

### ⚠ CSV `attrs` deepcopy — pandas 셀 접근의 숨은 2차 비용 (2026-08-23 실측)

CSV 로더는 ragged 행 복구를 위해 원본 행 폭을 `frame.attrs["source_row_widths"]` 에 담는다.
그런데 **pandas 는 거의 모든 연산에서 `__finalize__` 로 `attrs` 를 deepcopy** 한다 —
행 수만큼 긴 리스트가 들어 있으면 `df.iat[r, c]` **한 번이 리스트 전체 복사**가 된다.

- 실측: 12,000행 CSV 에서 `iat` 18,246회 → deepcopy **5,480만 회 = 84초**.
  같은 크기 xlsx 는 attrs 가 없어 2.3초였다(원인이 형식이 아니라 attrs 라는 증거).
- 교정 ①: `bom_loader._SharedRowWidths`(list 상속 + `__deepcopy__` 가 self 반환) —
  값이 로드 시점에 확정돼 변하지 않으므로 공유해도 안전하다. 84초 → **0.6초**.
  ⚠ 이건 **BOM 경로의 기존 결함이기도 하다** — `workbook.py`·`serialize.py` 가 `.iat` 를
  다수 쓰므로 **모든 CSV BOM 업로드가 같은 세금을 내고 있었다**. 같은 수정으로 함께 풀린다.
- 교정 ②: inventory 는 시트를 `_to_grid` 로 한 번에 문자열 격자로 바꿔 핫 루프에서 pandas 를
  아예 뺐다. 0.6초 → **0.1초**.

## 4. BOM 검색 주입

- sp-node 가 preflight 응답의 검색 정체성(품번)을 모아 `normalizeMpn` 으로 정규화 →
  `sp_partner_part_key` exact 배치 조회 → 검색 잡 옵션 `local_products`(키 = 정규 품번)로 주입.
  키가 component_id 가 아닌 이유: 엔진이 **같은 질의를 캐시 키로 묶어 한 번만 실행**하므로
  검색 정체성이 올바른 단위다.
- 엔진은 `extra_products` 로 받아 `supplier_results` 에 섞지 않는다 — 호출 수·캐시 상태·trace 를
  오염시키지 않는다. 매처·후보 결정·조달 정책은 외부 후보와 **완전히 같은 것**을 탄다.
- **뒤순위는 정렬 키가 낸다**: `_source_rank`(실공급사 0 · 로컬 카탈로그 1 · 협력사 2)를
  lifecycle 뒤·제조사 앞에 넣었다. 기술 판정이 동률일 때만 발동한다.
  ⚠ 공급사 문자열 알파벳순(`supplier.value`)에 기대면 `'partner' < 'unikeyic'` 이라 앞서 버린다.
- **가격을 만들지 않는다**: 주입 product 는 `offers: []`. 따라서 구매 조건이 없어 어떤 자동
  선정도 금액을 만들 수 없고, 협력사 후보는 검토 후보로만 남는다(가격은 RFQ 회신이 정본).
  재고·D/C·납기는 `catalog_metadata` 에 **표시용 사실**로만 싣는다.
- **exact 품번만**: 품번 없는 파라메트릭 질의에는 주입하지 않는다(스펙 호환 판정을 협력사
  주장에 기대지 않는다).
- **카탈로그 인제스트 제외**: `parts-ingest.parsedGroups` 가 `supplier==='partner'` 를 걸러 낸다.
  안 막으면 `sp_part`·ES 로 편입돼 원장을 분리한 이유가 통째로 무너지는 뒷문이다.
- **즉시 반영되는 배제**: 조직 정지·`part_sale` 회수·`isActive=false` 는 다음 검색부터 바로 빠진다
  (조회가 매번 서버 판정).

### ⚠ 실검색으로만 드러난 결함 둘 (2026-08-23)

원장·주입 payload 까지는 단위 테스트가 다 통과했는데, **고객 경로를 실제로 태우자**
협력사가 화면에 한 줄도 안 잡혔다. 원인이 둘이었고 둘 다 표본 픽스처로는 안 잡힌다.

**① 돌아오는 메타데이터는 snake_case 다.** sp-node 는 `partnerId`·`partnerStockQty` 로
보내고(엔진 pydantic 이 별칭으로 받는다) **읽을 때도 같은 이름일 것으로 기대**했는데,
엔진은 직렬화를 필드명으로 한다 — 돌아오는 것은 `partner_id`·`partner_stock_qty` 다.
후보는 멀쩡히 붙어 있는데 `matchEvidence.partnerStock` 만 조용히 null 이 됐다.
"보낸 이름으로 읽으면 된다"는 가정이 왕복에서 깨지는 자리다.

**② 대체 폴백이 협력사 후보를 지웠다.** 협력사 후보는 **일부러 가격을 만들지 않는다**.
그래서 조달 판정이 늘 `no_offer` 가 되고, 그 순간 엔진이 "구매 가능한 조건이 없다"며
대체 폴백을 켠다. 폴백 병합(`_merge_procurement_replacement_fallback`)은 후보를
`supplier_results` 로 다시 계산하는데 **로컬 소스는 그 바깥에 살아서**(외부 호출·캐시·trace
를 오염시키지 않으려는 바로 그 설계 때문에) 통째로 빠졌다. 결과가 고약하다 —
**아무도 안 가진 희귀 품번, 즉 협력사가 유일한 근거인 자리에서 정확히 사라진다.**
교정은 폴백 재검색과 병합 재평가 양쪽에 `local_products` 를 넘기는 것.
회귀선 `test_replacement_fallback_keeps_the_partner_candidate`.

**정렬은 결함이 아니다**(확인함). 협력사가 DigiKey 보다 앞선 행이 있었는데, 소스 순위는
설계대로 **기술 판정이 완전히 동률일 때만 발동하는 마지막 성향**이다. 앞선 이유는 상대편
후보의 수명주기가 caution 이었기 때문이고, 그건 실공급사끼리도 같은 규칙이다.
지켜야 할 안전선은 순위가 아니라 "가격이 없으니 자동 선정될 수 없다" 쪽이고 그건 유지된다.

## 5. 노출 정책

| | 고객(`/app/bom`) | 관리자 |
|---|---|---|
| 있다는 사실 | 행 배지 `협력사 보유` / `협력사 N곳 보유` | 같음 |
| 보유 곳 수·기준일 | 툴팁으로 노출 | 노출 |
| 조직 이름·정확 재고 | **비노출** (`toItemDto` 가 `partnerIds` 를 지운다 — 기본이 안전한 쪽) | 협력사 보유 부품 화면에서 품번으로 조회 |
| 선정 후 | 기존대로 `selectedOffer.supplier` 에 협력사명 노출 | 같음 |

`matchEvidence.partnerStock = { partnerCount, totalStockQty, latestUploadedAt, partnerIds }` —
`partnerIds` 는 DTO 경계에서 비워 내보낸다.

## 6. 화면

**협력사 포털(공통 영역 — 수금과 같은 자리, 모듈 아님)**
- `/partner/parts` `PartnerParts.vue` — 현황(등록 수·마지막 업로드 나이·신선도) · 드래그&드롭
  업로드 · 원장 검색·삭제 · 최근 업로드 이력. 확인 대기 회차가 있으면 새 업로드 대신 이어서
  확인하도록 유도(서버도 409).
- `/partner/parts/uploads/:uploadId` `PartnerPartUpload.vue` — 읽은 결과 요약 · **열 역할 교정 +
  [다시 분석]** · 표본 200행 미리보기 · 전체 교체/추가 선택 후 반영.
- 노출 조건 `tracks.parts`(= `part_sale`). `PartnerAccessResponse.tracks` 에 필드 추가,
  공통 메뉴 항목이 `requiresTrack` 을 들고 셸이 건다.

**관리자 — SmartBOM Case 상세 (견적요청을 누구에게 보낼지)**

RFQ 제한을 두지 않기로 했으므로(P3) 강제하지 않고 **고르기 쉽게만** 한다:
- 품목 표 행에 `협력사 보유 · <이름들>` — hover 시 재고·D/C·트랙 여부
- 품목 툴바 퀵액션 **`[협력사 보유 N]`** — 보유 행만 한 번에 선택(§6.13 부분 발송과 결합)
- 발송 모달: 보유한 협력사를 **맨 위로 정렬** + `보유 n행` 배지(n = 이번 발송 범위 기준).
  배지를 누르면 **어느 행을 얼마나** 가졌는지 그 자리에서 펼친다 — 품번·재고·D/C·원장 나이.
  "가졌다"와 "쓸 만큼 가졌다"는 다르다: 5개 필요한데 2개 보유인 곳에 견적요청을 거는
  헛발질을 이 목록이 막는다. 기본은 접힘(승인 협력사는 수십 곳인데 대부분 보유 0행이다).
  · 재고는 협력사의 주장이고 만료를 두지 않으므로 **나이를 늘 함께** 보이고, 낡음 기준을
    넘으면 강조한다(기준일은 sp_config 가 정본이라 화면 상수로 박지 않고 요약 API 에서 읽는다).
  · 펼친 목록은 **표시 전용**이다 — 행 선택 창구는 판단 근거가 있는 품목 테이블 하나로
    못박혀 있다(§6.13). 모달에서 행을 편집하게 하면 같은 상태를 두 곳에서 만지게 된다.
  · ⚠ 배지는 체크박스 `<label>` 안에 있다 — `@click.prevent.stop` 이 없으면 펼치려다
    협력사가 선택된다(회귀선이 모달 안 체크 수를 센다).
- 근거는 `GET /api/admin/bom-quotes/:id/partner-stock` 하나 — 품목 표와 모달이 같은 캐시를 본다

**협력사 포털 — RFQ 회신 폼 프리필**

내가 올려 둔 보유 부품과 같은 품번이면 **재고·D/C·납기·MOQ 를 미리 채운다**(`myStock`).
- **아직 회신하지 않은 행에만** 채우고 이미 쓴 값은 절대 덮지 않는다.
- **단가는 채우지 않는다** — 재고표 단가는 견적가가 아니고, 프리필이 곧 제시가로 굳어지면
  협력사가 손해를 본다(수량·환율·시점이 다르다).
- 채운 행에 `보유 목록에서 채움` 배지를 달아 사람이 확인·수정하게 한다.
- 포털·매직링크 둘 다(토큰이 조직을 특정한다). 관리자 대리 입력에는 넘기지 않는다.

**관리자 — 통합 관리 › 협력사 보유 부품 (`/app/admin/partner-parts`)**

만료·제한을 두지 않기로 한 대신 품질 비용이 전부 관리자에게 온다. 그래서 뒤처리가 1~2클릭:
- 협력사별 요약(사용 중·꺼짐·마지막 업로드 나이) — **낡은 것이 위로**
- 원장 통째 **끄기/켜기**(만료 대신 사람이 끄는 스위치 — 목록은 남고 검색 주입에서만 빠진다)
- 행 검색·선택 일괄 끄기/켜기·행 삭제·**원장 비우기**(청크 삭제)
- **대행 업로드** — 포털 계정 없는 협력사를 대신해 올리고 바로 반영(12호 교훈)

### 원장 목록 정렬 (2026-08-23)

포털·관리자 두 원장 목록 모두 `[{ uploadId: 'desc' }, { sourceRow: 'asc' }, { id: 'asc' }]` —
**최신 회차가 위로, 회차 안에서는 파일 순서 그대로**. 처음엔 품번 사전순이었으나 두 가지를 놓쳤다:

1. 재고표는 **회차 단위로 사는 문서**다. `merge` 로 여러 회차가 섞이면 방금 올린 분이 사전순
   사이에 흩어져 "내가 올린 게 반영됐나"를 확인할 수가 없다.
2. 회차 안까지 사전순으로 흩으면 협력사가 **자기 엑셀과 대조할 수 없다** — `sourceRow` 를 이미
   갖고 있으므로 파일 순서를 그대로 돌려주는 편이 대조 비용이 0 이다.

⚠ **정렬 키 셋은 전부 '수정으로 안 바뀌는 값'이어야 한다.** 사전순일 때는 품번을 고치는 순간
행이 목록의 다른 자리로 튀어(저장 → invalidate → 재조회) 방금 무엇을 고쳤는지 확인할 수 없었다.
`uploadId`·`sourceRow`·`id` 는 수정이 건드리지 않으므로 행이 **제자리에 남는다**. 그 위에
저장 직후 2.5초 배경 하이라이트(`justSaved`)만 얹어 "이 줄이 반영됐다"를 보인다 — 행이 움직이지
않으니 스크롤·포커스 복원 같은 장치가 필요 없다.

관리자 **협력사별 요약**은 다른 목적이라 그대로 `ageDays` 내림차순(**낡은 원장이 위로**) —
행 목록은 "내가 올린 것을 확인하는" 화면이고, 요약은 "뒤처리할 것을 찾는" 화면이다.

⚠ `(partnerId, uploadId, sourceRow)` 복합 인덱스는 두지 않았다(원장 1개가 1만 행대라 filesort 로
충분). 협력사당 수십만 행이 되면 그때 재검토.

### 행 수정 (2026-08-23)

오타 품번·빠진 제조사·바뀐 재고 하나 때문에 재고표 전체를 다시 올리게 하지 않는다.
포털·관리자 **공용 모달** `PartnerPartEditModal.vue` 로 한 줄만 고친다.

- 고치는 것은 **원장 값**뿐이고 **파일 원문 `mpnRaw` 는 절대 안 건드린다** — 둘이 다르면
  화면이 원문을 함께 보여 준다(무유실 원칙이 수정에도 그대로).
- **품번을 고치면 `sp_partner_part_key` 를 갈아 끼운다**(옛 키 전부 삭제 → 새 canonical 1건).
  안 그러면 화면에 보이는 품번과 BOM 검색에 걸리는 키가 어긋나 조용히 틀린다.
  같은 이유로 엔진이 옛 품번에 붙였던 검토 플래그(`mpn_*`)도 함께 지운다 — 더는 그 값이 아니다.
- **빈 문자열은 '지움'(null)** 이다. `??` 로는 빈 문자열이 통과하므로 서버가 `blank()` 로 접는다.
  품번만은 비울 수 없다(400) — 조회 키가 사라진 행은 원장의 유령이 된다.
- 고친 행에 `manually_edited` 플래그와 `수정됨` 배지. 플래그 칩은 배지와 겹치므로
  `partnerPartVisibleFlags()` 가 화면에서만 접는다(데이터에는 남는다).
- 포털은 **자기 조직 행만**(남의 행은 404 — 존재조차 알리지 않는다), 관리자는 아무 행이나.
- ⚠ 모달이 명시적으로 알린다: **다음 전체 교체 업로드는 수정본도 함께 지운다.** 오래 갈 교정은
  원본 파일을 고쳐 다시 올리는 쪽이다.

## 7. API

```
GET    /api/partner/parts/summary                     보유 수·마지막 업로드 나이
GET    /api/partner/parts?q&page&pageSize             내 원장
GET    /api/partner/parts/uploads                     업로드 이력
POST   /api/partner/parts/uploads          (multipart) 업로드 → 미리보기
GET    /api/partner/parts/uploads/:id                 미리보기 상세
POST   /api/partner/parts/uploads/:id/remap           열 역할 교정 → 엔진 재실행
POST   /api/partner/parts/uploads/:id/commit          원장 반영(replace|merge)
DELETE /api/partner/parts/uploads/:id                 확인 대기 회차 취소
PATCH  /api/partner/parts/:partId                     내 원장 행 수정(품번 바꾸면 조회 키 재생성)
DELETE /api/partner/parts/:partId                     내 원장 행 삭제

GET    /api/admin/bom-quotes/:id/partner-stock        품목 × 보유 협력사(발송 대상 근거)
GET    /api/admin/partner-parts/summary               협력사별 요약(낡은 순)
GET    /api/admin/partner-parts?partnerId&q&…         전체 원장 검색
GET    /api/admin/partner-parts/:partnerId/uploads    협력사 업로드 이력
PATCH  /api/admin/partner-parts/:partnerId/active     원장 통째 활성/비활성
PATCH  /api/admin/partner-parts/rows                  행 단위 일괄 활성/비활성
PATCH  /api/admin/partner-parts/row/:partId           행 수정(협력사가 못 고칠 때 대신)
DELETE /api/admin/partner-parts/row/:partId           행 삭제
DELETE /api/admin/partner-parts/:partnerId            원장 비우기
POST   /api/admin/partner-parts/:partnerId/uploads    대행 업로드
POST   /api/admin/partner-parts/uploads/:id/commit    대행 회차 반영
```

**권한 축이 둘**: `requirePartner`(멤버 ∧ 조직 승인)는 auth 플러그인이 보고,
capability `part_sale` 은 **라우트가 매 요청 DB 로 재확인**한다 —
`partnerContext` 에 capabilities 가 없고(13호 교훈: 판정 축은 '멤버 존재 ∧ 조직 승인'),
관리자가 트랙을 회수하면 다음 요청부터 즉시 막혀야 하기 때문.

## 8. 검증

- **엔진**: `pytest` 622 passed / 1 skipped · ruff clean.
  신규 `test_inventory_profile.py` 9케이스(상업 열 보존 · `+T&R` 무유실 · 대체 후보 ·
  미분류 열 보존 · 품번 없는 행 · role_overrides 재실행 · 헤더 없는 표 · 부품 목록 아님 · 행 상한),
  `test_partner_local_products.py` 5케이스(소스 순위 · 주입 키 = `normalizeMpn` · exact 질의만 ·
  같은 매처 + 동률이면 실공급사 우선 · 구매 조건 미생성).
- **sp-node**: `pnpm --filter api test` 960 passed / 29 skipped · typecheck·lint clean.
- **E2E 대형** `e2e/specs/partner-parts-large.e2e.test.ts` — 12,000행 업로드→미리보기→반영.
  **크기 자체가 검사 대상**이다: 미리보기 스냅샷 < 1MB, 표본 행 < 전체, 조회 키 12,120건,
  반영 후 스냅샷 null. 실사용 실패를 표본 픽스처가 못 잡았기에 세운 회귀선(4.0초).
- **E2E** `e2e/specs/partner-parts.e2e.test.ts` 14케이스 ALL PASS(품목×보유 협력사·회신 프리필 포함) —
  tracks 파생 · `part_sale` 없으면 403 · 업로드→미리보기(열 역할·원문 보존·대체 후보·통화 기호) ·
  확인 대기 중 409 · 반영 후 조회 키 색인 · 열 교정 재실행 · 전체 교체(유령 키 0) ·
  관리자 끄기/켜기/행 삭제 · 대행 업로드 · 원장 비우기 ·
  **행 수정**(품번 교체 시 조회 키 재생성·옛 키 0 · `mpnRaw` 불변 · 빈 문자열=지움 ·
  빈 품번 400 · 남의 행 404 · 관리자 대행 수정).
- **E2E 실검색** `e2e/specs/partner-parts-bom-search.e2e.test.ts` 5케이스 — 협력사 재고표를
  올려 원장을 세우고 **고객 BOM 을 실제로 업로드해 공급사 검색을 완주**시킨 뒤 판정한다.
  픽스처 짝은 `partner-stock-eureka-sample.csv`(브로커 서식) + `bom-partner-stock-match.csv`
  이고 품번은 실물 EUREKA 재고표에서 뽑았다. 행마다 묻는 것이 다르다 — 흔한 부품(실공급사와
  공존) · 단종·희귀(협력사가 유일) · 포장 코드 대체 키 · 협력사가 안 가진 대조군 · 아무도 없는 품번.
  이 스펙이 위 결함 둘을 잡았다.
  ⚠ **검색 status 가 completed 여도 견적 행 투영은 한 박자 뒤다** — status 만 보고 바로 읽으면
  근거가 비어 있어 "협력사가 안 잡혔다"로 오독한다(실제로 한 번 속았다). 투영 완료를 따로 기다린다.
  ⚠ 관리자 보유 조회는 `included: true` 행만 본다 — 픽스처의 수량과 Reference 개수가 어긋나면
  그 행이 견적 합계에서 빠지면서 보유 조회에서도 사라진다.
- **실 DB 프로브**: 원장 → 주입 페이로드에서 canonical·alternative 키 모두 매칭,
  브랜드 없는 행 `autoQuoteEligible=false`, `part_sale` 회수 시 즉시 0건 확인.
- **화면 관찰** `e2e/specs/partner-parts-observe.e2e.test.ts` 6케이스 — 포털 목록·**행 수정 모달**·업로드 확인·
  관리자 뒤처리·**Case 보유 퀵액션/행 표시/발송 모달 배지**를 실제로 띄워 pageerror 0 확인,
  캡처는 `e2e/output/`(사람 육안 1회 — 플레이북 "실브라우저 사각").
- **sp-vue**: typecheck(vue-tsc)·lint clean.

## 9. 남은 것 (미착수)

- 대형 원장 반영 지연 — 12,000행 반영이 4초 → 70초. 투영이 행마다 두 질의를 돈다(§1.5 실측).
- 후보 드로어에 협력사 후보 전용 표기(현재는 offers 가 비어 카드가 밋밋하다).
- 관리자 설정에 `오래된 재고표 경고 일수` 노출(현재 env `PARTNER_PART_STALE_AFTER_DAYS`, 기본 90).
- 협력사 파일 2~3본을 더 받아 `local-corpus` 회귀 코퍼스 구성 — **한 파일로 설계한 추출기는
  다음 파일에서 깨진다**. 교정 루프가 1급 기능인 이유이기도 하다.
- 선택: RFQ 회신에 "내 원장도 이 값으로 갱신" 체크(회신이 가장 정확한 최신 정보).
