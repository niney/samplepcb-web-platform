# BOM 분석 API

BOM 파일을 올리면 부품을 추출하고 공급사 후보를 선정해 **예상 견적**까지 계산해 돌려준다.

- 베이스 URL: `https://<host>/api/svc`
- 별도 인증 토큰은 없다. 허용된 네트워크에서만 접근할 수 있다.
- 업로드만 `multipart/form-data`, 나머지는 JSON.
- 공급사 조회는 실제 유통사 API를 호출하므로 결과까지 수 초~수십 초가 걸린다(부품 수에 비례).

**공통 응답 형태**

```json
성공  { "result": true,  "data": { ... } }
실패  { "result": false, "error": "ERROR_CODE" }
```
없는 견적·잡은 `404`. 이하 각 단계의 에러 코드는 `error` 값이다.

## 흐름

```
1) POST /bom/quotes                 → quoteId, jobId
2) GET  /bom/jobs/{jobId}           → status=completed 까지 폴링(1.5초)
3) POST /bom/quotes/{id}/prepare    → 시트 목록
4) POST /bom/quotes/{id}/build      → 라인·가격 생성 + 공급사 조회 시작
5) GET  /bom/quotes/{id}            → enrichStatus=done 까지 폴링(3초) = 완성
```

---

## 1. 업로드

`POST /bom/quotes` · `multipart/form-data`

| 필드 | 필수 | 값 |
| --- | --- | --- |
| `file` | O | `.xlsx` `.xlsm` `.xls` `.csv` `.tsv` `.bom`, 50MB 이하 |
| `procurementMode` | | `sample`(기본) \| `mass` — 양산은 Reel 포장을 우선한다 |

**201**
```json
{ "result": true, "data": { "quoteId": "1288", "jobId": "abdf2f28f8e2..." } }
```

**400** 지원하지 않는 형식·크기 초과 · **502** `BOM_ENGINE_UNREACHABLE` \| `BOM_ENGINE_ERROR` \| `FILE_SERVER_ERROR`

## 2. 분석 상태

`GET /bom/jobs/{jobId}`

**200**
```json
{ "result": true, "data": {
  "job_id": "abdf2f28f8e2...", "engine": "smartbom", "filename": "bom.csv",
  "status": "completed", "progress": 100, "message": "추출 완료",
  "error": null, "result_available": true
} }
```
`status`: `running` \| `completed` \| `failed`. `running` 이면 1.5초 뒤 재조회.

## 3. 시트 목록

`POST /bom/quotes/{quoteId}/prepare` · 본문 없음

**200** — [견적 상세](#5-결과-조회)와 같은 스키마. 이 시점 `buildStatus`=`selecting` 이고 `sheets` 가 채워진다.
```json
{ "sheetIndex": 0, "sheetName": "csv", "status": "parsed",
  "componentCount": 3, "selected": true, "hasItems": false,
  "failureReason": null, "warnings": [] }
```
`status`: `parsed`(BOM 으로 인식) \| `not_bom` \| `error`. 다음 단계에는 `parsed` 인 시트만 넘길 수 있다.

**409** `ENGINE_JOB_GONE`(분석 결과 만료 — 재업로드) \| `INVALID_ENGINE_RESULT`

## 4. 계산 실행

`POST /bom/quotes/{quoteId}/build` · `application/json`

```json
{ "sheetIndexes": [0] }
```

**200** 견적 상세. `buildStatus`=`ready`, `enrichStatus`=`searching`(공급사 조회 시작).

**409** `INVALID_SHEET_SELECTION` \| `ANALYSIS_NOT_PERSISTED` \| `NO_COMPONENTS_IN_SELECTED_SHEETS` \| `SELECTED_SHEETS_ITEM_LIMIT`(2,000행 초과)

## 5. 결과 조회

`GET /bom/quotes/{quoteId}`

**완료 판정**: `buildStatus === 'ready' && enrichStatus !== 'searching'`. 아니면 3초 뒤 재조회.

### data

| 필드 | 설명 |
| --- | --- |
| `id` `title` `fileName` | 견적 식별·원본 파일명 |
| `buildStatus` | `parsing` \| `selecting` \| `building` \| `ready` \| `failed` |
| `enrichStatus` | `idle` \| `searching` \| `done` \| `failed` — 공급사 조회 진행 상태 |
| `itemCount` `includedCount` `matchedCount` | 전체·집계 대상·매칭된 라인 수 |
| `itemsTotal` | 부품 합계(KRW, 집계 대상 라인) |
| `shippingFee` `managementFee` `finalTotal` | 예상 운송료·관리비·총액 |
| `uncostedCount` | 집계 대상인데 금액을 내지 못한 라인 수 |
| `usdKrwRateUsed` `exchangeRateSnapshot` | 적용 환율과 출처·기준일·안전계수 |
| `supplierSearchLimitedCount` | 조회 상한 때문에 확인이 제한된 부품 수 |
| `partDataStatus` | 후보 비교 API 준비 상태. `preparing` 이어도 **견적 자체는 완성**이다 |
| `sheets[]` `items[]` | 시트 목록 · 부품 라인 |

### items[]

| 필드 | 설명 |
| --- | --- |
| `id` `rowIdx` | 라인 식별·원본 순번 |
| `mpn` `manufacturerName` `description` | 선정 결과 기준 부품 표기 |
| `bomQty` `orderQty` | BOM 수량 · 실제 주문 수량(MOQ·주문배수 반영) |
| `included` | 합계 집계 대상 여부 |
| `matchStatus` | `auto`(자동 선정) \| `manual`(수동 선택) \| `none`(미선정) |
| `lineTotalKrw` | 라인 금액(KRW) |
| `selectedOffer` | 적용된 구매 조건(아래) |
| `quantityState` | `verified` \| `missing` \| `confirmed` \| `excluded` — 수량 값 자체의 상태 |
| `sourceRow` | 원본 근거: `referenceDesignators` `packageCode` `valueRaw` `inputPartNumber` `inputManufacturer` · `quantityResolution`(`verified` \| `conflict`) · `procurementDisposition`(`eligible` \| `quantity_confirmation_required` …) |
| `matchEvidence` | 선정 근거 전체(후보 수·검색 방식·미선정 사유 등) |
| `partId` `partImageUrl` `partDatasheetUrl` | 부품 식별·이미지·데이터시트 |

### selectedOffer

```json
{ "supplier": "digikey", "supplierSku": "311-10.0KHRCT-ND",
  "packaging": "컷 테이프(CT)", "breakQty": 1,
  "unitPrice": 155, "currency": "KRW", "unitPriceKrw": 155,
  "moq": 1, "orderMultiple": null, "stock": 4030053,
  "priceBreaks": [{ "qty": 1, "price": 155 }, { "qty": 10, "price": 38.7 }],
  "fetchedAt": "2026-08-27T05:41:16.926Z", "pinned": false }
```

---

## 보조 API

| 엔드포인트 | 용도 |
| --- | --- |
| `GET /bom/quotes?page=1&pageSize=20` | 견적 목록 |
| `GET /bom/quotes/{id}/items/{itemId}/candidates` | 라인별 후보 전체와 선정 근거 |
| `POST /bom/quotes/{id}/items/{itemId}/selection` | 후보 수동 선정 |
| `PATCH /bom/quotes/{id}` | `setQty`·`spareQty`·수수료 변경 → 재계산 |
| `GET /bom/quotes/{id}/comparison` | 라인×후보 비교표 |
| `GET /bom/quotes/{id}/file` | 업로드 원본 다운로드 |
| `DELETE /bom/quotes/{id}` | 견적 삭제 |
| `GET /bom/parts-search?q=...&needed=10` | 부품 카탈로그 검색 |

## 주의

- **분석 결과는 오래 보관되지 않는다.** `prepare` 전에 만료되면 `ENGINE_JOB_GONE` 이 나고 재업로드해야 한다. 업로드 직후 이어서 호출할 것.
- **참조번호 개수와 수량이 다르면 자동 선정하지 않는다.** 예: `R1` 하나에 수량 10 → `sourceRow.quantityResolution=conflict`, `procurementDisposition=quantity_confirmation_required`, `matchStatus=none`, `included=false` 로 합계에서 빠진다. 오류가 아니라 사람 확인이 필요하다는 뜻이며, 후보는 `candidates` 로 조회해 수동 선정할 수 있다.
- `partDataStatus=preparing` 은 후보 비교 API 준비 상태다. 견적 완료 판정에 넣지 말 것.
- 응답 필드는 앞으로 추가될 수 있다. **모르는 필드는 무시하도록** 파싱할 것.
