# 두 분석본 비교 · 보완 결과

| 파일 | 정체 |
|---|---|
| `연호전자_커넥터_DB_ES_분석결과.json` | v1 (2026-07-25 16:04 갱신본) — 별도 세션 산출물. **내 선행본(.tmp/yeonho-catalog-out)을 이미 흡수한 상태** |
| `연호전자_커넥터_DB_ES_분석결과.v2.json` | **v2 = 이번 보완본. v1 의 상위 집합** — 인제스트에는 이 파일을 쓴다 |
| `연호전자_커넥터_DB_행_프리뷰.json` | `sp_part`/`sp_part_offer`/`sp_part_price_break` 필드명 그대로의 행 미리보기(820) |
| `연호전자_커넥터_ES_문서_프리뷰.ndjson` | `buildPartDoc` 이 만들 `sp-parts` 문서 미리보기(820줄) |
| `build_v2.py` | v2 재생성 스크립트 |
| `.tmp/yeonho-catalog-out/*` | 내 1차 분석본 — v1·v2 에 흡수됨(참고용으로만 유지) |

## 교차검증 결과 (사실 데이터는 완전 일치)

- 부품 수 **820 = 820**, MPN 집합 차이 0 (양쪽 모두 823행 → 중복 3행 병합)
- `description`·`category`·`datasheet_url`·`image_url`·`manufacturer`·`package`·`lifecycle_status` **전건 동일**
- `normalized_specs`(pin_count·pitch_mm·family_pattern·family_match_key·series_available_pins·product_height_mm) **전건 동일**
- `offers`(가격구간 0, stock/moq null, fetched_at 2026-07-17) **전건 동일**
- 원본 파일 SHA-256 을 다시 계산해 v1 이 기록한 값과 **일치 확인**(`source.sha256Verified: true`)
- 남은 차이는 `catalog_metadata` 3개 키뿐: v2 가 `seriesAvailablePins`·`sourceUrl`·`sourceDatasetSha256` 을 추가

## v1 을 따른 부분 (내 1차본보다 v1 이 옳았던 것)

1. **`IMAGE_STATUS != 수집완료` 26건은 `image_url = null`** — 깨진 이미지를 관리자 화면에 노출하지 않고
   후보 URL 은 `catalog_metadata.originalImageUrl` 에 보존. 내 1차본은 URL 을 그대로 넣었다. v1 채택.
2. **출처 메타(`series_id`·`source_url`·`image_status`)는 `normalized_specs` 가 아니라 `catalog_metadata`** —
   `resolvePartFacts` 가 `normalized_specs` 전 키를 `specsJson` 에 보존하므로, 내 1차본 방식은 스펙 표시란에
   출처 메타가 섞인다. v1 채택. 반대로 BOM 매칭 키(`family_pattern`·`family_match_key`·`series_available_pins`)는
   `specsJson` 에 남을 값이라 `normalized_specs` 에 유지(v1 최신 정책과 동일).
3. **`part_type: "connector"` 축 유지** — 이후 커넥터 필터의 앵커가 된다.
4. **피치 18mm(`90011-H03D`) 는 오류가 아니다.** 내 1차본은 "파싱 오류(1.8mm) 의심"으로 적었으나, v1 이
   제조사 공식 품목 페이지에서 `18mm Pitch` 표기를 실측 확인했다(`officialOutlierChecks`). v2 는 이 근거를
   그대로 싣고 상태를 `verified` 로 정정했다 — 원본값 유지가 정답.

## v2 가 보완한 것 (v1 에 없던 것)

**A. 근거·계약 명시**
- `targetContract.codeAnchors` — 인제스트/정본/ES 문서/정규화 함수의 실제 코드 경로
- `derivedOfferPolicy` — 가격구간이 없으므로 `deriveSamplepcbOffer` 가 null → **samplepcb 파생 오퍼가 생기지 않음**(의도된 결과)
- `specTrustPolicy` — `yeonho` 는 `SUPPLIER_TRUST_ORDER` 미등재 = 최하위 신뢰. 유통사 스펙이 있으면 그쪽이
  정본이 되어 이 카탈로그가 기존 정본을 덮지 않는다

**B. 검증 4종 신설** (`analysis.validation`)

| 검증 | 결과 |
|---|---|
| `bomMatchKeyErrors` | 0 — 엑셀 `BOM_MATCH_KEY` 823건이 `normalizeMpn` 결과와 전건 일치(별도 컬럼 불필요) |
| `seriesPinCoverageErrors` | 0 — 각 품목의 `PINS` 가 시리즈 `AVAILABLE_PINS` 에 전건 포함 |
| `descriptionCategoryMismatch` | 0 — 설명문 1항의 커넥터 종류와 `CATEGORY` 컬럼 전건 정합 |
| `imageUrlNamingVariance` | **96건**(info) — 이미지 stem 이 카탈로그 PDF stem·`FAMILY_PATTERN` 과 모두 다름(예: `05002HR-HNNN2.jpg` vs `05002HR-NNN2.pdf`). `IMAGE_STATUS=수집완료` 라 접근은 기록상 정상이므로 표기 규칙 차이로 판단, 링크 실측은 인제스트 후 별도 |
| `productHeightNonNumeric` | **27건** — 원본 설명문이 수치 대신 `"view drawing"` 인 항목. 파싱 실패가 아니라 원본값이라는 사실을 명시(v1 은 수치 미보유 27건만 집계) |

**C. 검색 커버리지 갭** (`analysis.searchCoverage`) — 이번 비교에서 가장 중요한 보완
- SI 필드 8종(저항·용량·인덕턴스·전압·전류·전력·주파수·톨러런스)에 해당하는 값이 원본에 없고 설명문에도
  정격 전압·전류 표기가 0건 → `specsSi = {}` → `specVariants = []`
- 결과: `docs/PARTS_SEARCH.md` 의 **스펙 검색 2트랙(Track A 범위 · Track B 관행표기)이 이 820건에는 전부 무효**.
  검색은 `mpnNorm`(prefix/infix) + `description`(text) + `category` 패싯으로만 걸리고
  **"1.25mm 피치 8핀" 류 조건 검색은 불가능**하다
- 해소 옵션: (A) `sp-parts` 매핑에 `pitchMm`(double)·`pinCount`(integer) 추가 + `SpPartDoc`/`buildPartDoc` 확장 후
  `parts:reindex` — 필드 추가는 non-breaking, 권장. (B) `specVariants` 직접 주입은 `parts:reindex` 한 번에 소실되므로 비권장

**D. 제조사 별칭 선행 조건 — 해결됨** (`analysis.manufacturerAliasGap`)
- `manufacturer-alias.ts`에 `연호전자`·`연호` → `yeonho` 별칭을 이번 마이그레이션 코드와 함께 반영했다.
- `YEONHO`·`Yeonho Electronics Co., Ltd.`·한글 표기가 모두 같은 DB upsert 키로 수렴함을 단위 테스트한다.

**E. 운영 영향·실행 계획**
- `adminUiEffects` — 전건 `minPrice=null`·`totalStock=0`·`offerCount=1` 이므로 `/app/admin/parts` 가격·재고
  정렬에서 항상 하단, 재고 필터 시 전건 제외. 카테고리 패싯에 커넥터 6종이 새로 노출
- `ingestPlan` — ①별칭 추가 → ②`ingestSupplierSearchResultOnce(v2.search)` 투입(idempotent) →
  ③`/app/admin/parts` 실측 → ④필요 시 옵션 A 로 색인 확장
- `countingBasis` 명시 — `categoryCounts`/`imageStatusCounts` 는 병합 후 820 기준, `sourceCategoryCounts`/
  `sourcePitchCounts` 는 원본 823행 기준(두 통계가 Wire to Board 294 vs 297 로 갈리는 이유)

## 현재 상태

DB·ES 에 아무것도 쓰지 않았다. v2 JSON 의 `search` 블록이 `ingestSupplierSearchResultOnce` 입력 계약에 맞춰져
있고 전 경로 idempotent이며, D의 별칭 조건도 이번 변경에 포함되어 그대로 투입 가능하다.
