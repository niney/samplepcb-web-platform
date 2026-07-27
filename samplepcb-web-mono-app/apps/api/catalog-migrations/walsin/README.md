# Walsin R/C 카탈로그 마이그레이션

기술·취급 정본은 `Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx` 한 파일이다.
sp-node가 실행 시 워크북을 검증하고 기존 supplier-search ingest envelope로 결정적으로 변환한다.
공급사 가격은 카탈로그 초기화 전에 한 번 전수 조회한다. DigiKey·Mouser·UniKeyIC 결과인
`prepared-prices/walsin-price-snapshot-v1.json.gz`는 기초 스냅샷으로 보존하고,
Eleparts·ICBanQ 검증 가격을 합친 현재 적용본은
`prepared-prices/v2/walsin-price-snapshot-v2.json.gz`다.

데이터 근거와 판단은 [ANALYSIS.md](ANALYSIS.md)에 있다.

## 데이터 계약

- 기준일: `2026-07-06`
- 원본 SHA-256: `7aa0c323e02e11ec67086546f5dae47d38f83748732dea0eb463b3ef19433e6c`
- 부품: 2,628개 (저항 1,120 · 캐패시터 1,508)
- 제조사 7사: Walsin 572 · Yageo 572 · Samsung 456 · TDK 348 · Murata 232 · Vishay 224 · KOA 224
- 인덕터·페라이트(`LFB_*`) 13시트는 품번이 아니라 자리표시자라 적재하지 않는다
- 가격·재고·MOQ: 원본 근거가 없어 모두 없음
- `normalized_specs.part_type`: `resistor` | `capacitor`

파서는 파일 해시, 대시보드 버전, 26개 시트의 필수 헤더, 행 수(R 364 · C 377), 부품 수 2,628,
사이즈 표기 병합 285, 교차 사이즈 교정 116, 빈 벤더 셀 676, 빈 행 112, 표본 검증 행 4,
검증 등급·자동견적 등급 화이트리스트를 모두 통과해야만 입력을 만든다.
워크북이 바뀌면 승인된 해시와 달라져 적용 전에 중단된다.

## SamplePCB 판매 카탈로그 적재

전 품번의 규칙 생성 여부는 감사 정보로 보존하되, 이 승인본은 SamplePCB가 취급하는
R/C 카탈로그로 사용한다. 가격과 재고는 워크북에서 만들지 않는다.

- `catalog_metadata.catalogOnly=true`, `commercialDataAvailable=false`,
  `autoQuoteEligible=true`, `samplepcbPreferred=true`
- 부품마다 제조사 사실 오퍼 + `samplepcb` 판매 오퍼 2개를 저장한다. 둘 다
  `offer_kind='manufacturer_catalog'`이며 최초 가격대·재고는 없다.
- 제조사 사실 오퍼는 DB의 기술 사실·원본 추적에만 사용한다. 검색 API의 `suppliers`와
  구매 오퍼 상세에는 `samplepcb`만 노출하고, 제조사는 기존 제조사 필드와 삭제 미리보기의
  카탈로그 원본 영역에서 확인한다.
- sp-node는 BOM 외부 검색 전에 엔진이 정규화한 R/C 조건으로 SamplePCB ES 후보를 찾고,
  sp-engine의 `catalog-evaluate-batch`가 `automatic_selected`로 확정한 행만 문의 견적으로 선정한다.
- 미해결 행만 기존 DigiKey·Mouser·UniKeyIC 검색으로 넘긴다.
- AVL 역할은 `samplepcbPreferenceRank`(`primary=0`, `alt1=1`…)로 엔진 정렬에만 반영한다.
- `X5R/X7R` 복합 표기는 어느 한 유전체로 추정하지 않고 원문만 보존한다

## 실행

리포 루트에서 최신 코드를 받은 뒤 실행한다. Git pull만으로 DB·ES 데이터는 바뀌지 않는다.

```bash
cd samplepcb-web-mono-app
pnpm install --frozen-lockfile

pnpm --filter api parts:catalog -- --dry-run --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
pnpm --filter api parts:catalog -- --apply --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
```

`--source`를 생략하면 기존 연호 카탈로그가 대상이다.

dry-run에서 확인할 값:

- `inputParts=2628`
- `generatedMpnParts=2618` (표본 검증 10개 제외)
- `commercialOffers=0`
- `catalogSuppliers`에 `samplepcb` 포함
- `existingParts`: 이미 실공급사 오퍼로 존재하는 부품 수 — 그만큼이 승격 대상

`--apply` 완료 조건:

- 최상위 `result=true`
- `verification.result=true`
- `inputParts=dbParts=esDocuments=2628`
- `preparedPriceChecks.expectedSupplierOffers=storedSupplierOffers`
- `preparedPriceChecks.pricedParts=samplepcbPricedParts`
- `engineCatalogChecks`가 supplier×category 표본을 모두 반환하고 선정 가능 후보가
  `catalog_selected`임
- `failures=[]`

동일 명령 재실행은 안전하다(fingerprint/upsert 재사용).

검증만 따로:

```bash
pnpm --filter api parts:catalog -- --verify --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
pnpm --filter api parts:catalog -- --verify-search --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
```

## 운영 적용 순서

운영 서버에서는 코드와 데이터 적용을 분리한다. 이 변경은 DB 스키마 마이그레이션이 없으며
`prisma migrate reset/dev`를 실행하지 않는다.

```bash
cd /home/samplepcb/samplepcb-web-platform

# 1. 적용 전 공유 DB 백업
mysqldump --default-character-set=utf8 samplepcb > ~/backup-walsin-$(date +%F-%H%M).sql

# 2. sp-engine 먼저, 이어서 sp-node+sp-vue 배포
./deploy.sh 10
./deploy.sh 5

# 3. 배포 확인
curl -fsS http://127.0.0.1:8400/health
curl -fsS https://centrafab.co.kr/api/health

# 4. 원본과 사전 가격 스냅샷 검증 후 DB·ES 적재
cd samplepcb-web-mono-app
pnpm --filter api parts:catalog -- --dry-run --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
pnpm --filter api parts:catalog -- --apply --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
pnpm --filter api parts:catalog -- --verify-search --source walsin-rlc \
  --price-snapshot catalog-migrations/walsin/prepared-prices/v2/walsin-price-snapshot-v2.json.gz
```

`deploy.sh 5`의 마이그레이션 질문에는 이번 변경이 추가·삭제하는 스키마가 없으므로 파괴적
중단이 필요 없다는 의미로 기본값 `N`을 선택한다. 위 통합 적용 명령이 변경 부품을 ES까지
색인하므로 별도 전체 재색인은 필요 없다.

관리자 `/app/admin/parts`에서는 가격을 찾은 부품에 `SamplePCB`와 실제 외부 공급사가 함께
표시되고, 외부 공급사에는 스냅샷 재고·가격이 보이는지 확인한다. SamplePCB 가격은 같은
가격곡선이지만 재고는 계속 `재고 확인`이어야 한다. 정상 미발견 부품은 기존처럼
`SamplePCB`의 `문의 견적`·`재고 확인`으로 남는다.

## 공급사 가격 사전 스냅샷

가격 조회는 DB 적재 뒤 반복하는 런타임 작업이 아니다. 승인 워크북의 2,628개 identity를
카탈로그 초기화 **전에 한 번 전수 조회**해 Git으로 전달 가능한 압축 스냅샷을 만든다.
정확 MPN+제조사 후보만 남기므로 파라메트릭 대체품이 카탈로그를 불리지 않는다.

```bash
# 대상·경로만 확인 — DB 변경·외부 API 호출 없음
pnpm --filter api parts:catalog-prices

# 최초 전수 생성
pnpm --filter api parts:catalog-prices -- --prepare

# 중단 또는 공급사 오류 뒤 같은 상태에서 재개
pnpm --filter api parts:catalog-prices -- --prepare --resume

# 특정 공급사가 확인된 rate limit 상태면 나머지 공급사 결과부터 완주
pnpm --filter api parts:catalog-prices -- --prepare --resume \
  --suppliers mouser,unikeyic

# 제한 해제 뒤 공급사별 오류가 남은 행만 다시 조회
pnpm --filter api parts:catalog-prices -- --prepare --resume \
  --retry-supplier-errors

# 정상 미발견·가격 없음까지 의도적으로 다시 확인할 때만
pnpm --filter api parts:catalog-prices -- --prepare --resume --retry-misses

# API 호출 없이 원본 2,628개 coverage·exact identity·압축 SHA 검증
pnpm --filter api parts:catalog-prices -- --verify
```

기본은 요청당 MPN 100개, 요청 동시성 1, MPN당 호출 상한 12, 배치 제한시간 300초다.
한 요청에서 공급사 클라이언트와 DigiKey OAuth 토큰을 재사용하고 Mouser exact batch를
활용한다. 병렬 요청에서 공급사 403을 실측했으므로 정확한 최초 산출은 기본값을 유지한다.
운영 상황에 따라 `--batch-size 1..100`, `--concurrency 1..8`,
`--max-calls 1..100`, `--job-timeout-seconds 10..300`, 부분 시험은 `--limit N`을 쓴다.
`not_found`는 정상 결과다. 배치 전체 타임아웃처럼 어느 공급사까지 실행됐는지 판정할 수 없는
경고는 완료로 인정하지 않고 다음 `--resume`에서 자동 재시도한다. 반면 확인된 공급사별
`429`·`403`은 다른 공급사의 유효 가격을 버리지 않도록 스냅샷 경고와
`summary.supplierErrorRecords`에 남긴다. `--suppliers`로 제한된 실행도 제외 공급사를
`not_requested_for_snapshot`으로 명시하므로 미조회 사실이 숨겨지지 않는다.
생성 작업 중 제한이 해제되면 로컬 `work-state.json`이 남아 있는 동안 기본 공급사 목록과
`--retry-supplier-errors`를 함께 사용해 교체할 수 있다.

생성물:

- `prepared-prices/walsin-price-snapshot-v1.json.gz`: exact 공급사 product/offer·가격·재고
- `prepared-prices/manifest.json`: 원본 SHA·스냅샷 SHA·coverage 집계
- `prepared-prices/work-state.json`: 생성 중 중단 재개용이며 Git에서 제외; 최종 검증 뒤 삭제 가능

현재 Git 산출물(2026-07-27)은 2,628개 전부를 포함하며 가격 보유 502개,
가격 없는 exact 결과 13개, exact 미발견 2,113개다. 외부 오퍼 1,521개와 가격구간
9,372개를 보존한다. 생성 후반 DigiKey가 `429` 제한에 걸려 371개는
`digikey: not_requested_for_snapshot`으로 명시하고 Mouser·UniKeyIC만 조회했으며,
배치 전체 타임아웃과 Mouser·UniKeyIC 오류는 0개다. 현재 Git 산출물은 이 시점 스냅샷으로
고정하며, DigiKey까지 다시 채우려면 새 버전 스냅샷을 전수 생성한다. 실제 값과 SHA-256은
`prepared-prices/manifest.json`을 단일 원본으로 삼는다.

### 국내 판매처 가격 보강(v2)

Eleparts·ICBanQ 가격은 sp-labs 산출물에 의존하지 않고 sp-node의 공통 수집기로 만든다.
대상은 위 워크북 파서가 확정한 7개 제조사 2,628개이며 CSV를 중간 입력으로 사용하지 않는다.
기본 실행은 네트워크를 호출하지 않는 dry-run이고, `--run`을 지정해야만 사이트를 호출한다.

```bash
# 대상·경로·제조사별 수량 확인
pnpm --filter api parts:catalog-market-prices -- --site eleparts
pnpm --filter api parts:catalog-market-prices -- --site icbanq

# 사이트별 직렬 전수 수집 — 서로 다른 터미널에서 병렬 실행 가능
pnpm --filter api parts:catalog-market-prices -- --run --site eleparts --delay-ms 500
pnpm --filter api parts:catalog-market-prices -- --run --site icbanq --delay-ms 500

# 오류·차단·프로세스 종료 뒤 같은 체크포인트에서 재개
pnpm --filter api parts:catalog-market-prices -- --run --resume \
  --site eleparts --delay-ms 500
pnpm --filter api parts:catalog-market-prices -- --run --resume \
  --site icbanq --delay-ms 500

# 원본 coverage·exact identity·capture/manifest SHA 검증
pnpm --filter api parts:catalog-market-prices -- --verify --site eleparts
pnpm --filter api parts:catalog-market-prices -- --verify --site icbanq

# 두 capture를 기존 v1에 합쳐 재적재 가능한 v2 생성·자체 검증
pnpm --filter api parts:catalog-market-prices -- --merge
```

같은 사이트 안에서는 검색과 상세 페이지를 포함한 모든 요청 시작 간격이 최소 500ms이며
동시 요청은 1개다. 50개마다 1초 냉각하고 HTTP 403·429를 만나면 현재 레코드까지 원자 저장한
뒤 즉시 중단한다. `*-work-state.json`과 로그는 재개용이라 Git에서 제외한다.

Eleparts는 검색 결과에 제조사와 MPN이 모두 정확히 일치하고 양수인 부가세 포함 대표가격만
사용한다. ICBanQ 자동완성에는 제조사가 없고 가격이 부가세 별도이므로, 후보를 가격순으로
검사해 상세 페이지의 제조사·MPN·`Tax_Sales_Price`를 모두 확인한 첫 상품만 사용한다.
동일 MPN의 타 제조사는 오퍼로 만들지 않는다.

두 판매처 오퍼는 `eleparts`·`icbanq`로 각각 보존한다. 사이트 안의 DigiKey·Mouser 등의
라벨은 원 공급사 오퍼로 승격하지 않고 감사 메타데이터에만 둔다. 재고·MOQ·주문배수는
추정하지 않고 null로 유지하며, SamplePCB 가격 파생에서는 검증된 KRW 최소수량 단가가
낮은 쪽을 쓴다. 같은 가격이면 identity 증거가 검색 응답에 직접 있는 Eleparts가 우선이다.

최종 파일은 `prepared-prices/v2/walsin-price-snapshot-v2.json.gz`와 같은 폴더의
`manifest.json`이다. `prepared-prices/v2/market/`의 사이트별 압축 capture와 manifest는
가격 출처를 재검증하기 위한 근거다. DB·ES 초기화 후에도 외부 사이트를 다시 호출하지 않고
v2 스냅샷을 `parts:catalog -- --price-snapshot ...`에 전달해 같은 데이터를 복원할 수 있다.

2026-07-27 전수 결과:

| 제조사 | 대상 | v1 가격 | Eleparts | ICBanQ | 국내 합집합 | v1에 없던 가격 | v2 가격 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Walsin | 572 | 152 | 136 | 106 | 141 | 10 | 162 |
| Yageo | 572 | 240 | 237 | 228 | 237 | 0 | 240 |
| Samsung | 456 | 33 | 38 | 39 | 43 | 10 | 43 |
| TDK | 348 | 5 | 5 | 5 | 5 | 0 | 5 |
| Murata | 232 | 2 | 2 | 2 | 2 | 0 | 2 |
| Vishay | 224 | 59 | 58 | 53 | 58 | 0 | 59 |
| KOA | 224 | 11 | 11 | 10 | 11 | 0 | 11 |
| **합계** | **2,628** | **502** | **487** | **443** | **497** | **20** | **522** |

두 사이트 공통 가격 대상은 433개다. 부가세 포함 단가 비교 결과 ICBanQ가 더 싼 부품
235개, Eleparts가 더 싼 부품 140개, 동률 58개다. ICBanQ 상세 제조사 검증에서
`samsung:RC0603F220CS`, `samsung:RC2012F220CS`, `walsin:1206B102K500CT`,
`walsin:WR02X4701FTL` 4개는 동일 MPN의 타 제조사 상품이라 제외했다.

v2는 가격 보유 522개, exact product 1,962개, 오퍼 2,451개, 가격구간 10,302개다.
`parts:catalog` dry-run으로 원본 2,628개 coverage, v2 manifest SHA, 가격 스냅샷 ingest
fingerprint를 검증했다. 이 생성 작업에서는 DB·ES 적용을 수행하지 않았다.

초기화 후 `parts:catalog -- --apply ... --price-snapshot ...` 한 번이 제조사 원장과
SamplePCB 취급 오퍼를 먼저 만들고, 스냅샷의 DigiKey·Mouser·UniKeyIC 오퍼를 같은
`sp_part`에 upsert한다. 가격이 있는 외부 오퍼 한 개의 전체 가격곡선을 SamplePCB 오퍼에
복사하고 `samplepcbPricing.derivedFrom`으로 공급사·SKU·수집 시각을 보존한다.
외부 유통사 재고는 SamplePCB 보유 재고가 아니므로 **자체 재고는 계속 null**이다.

DB에는 `(mpnNorm,manufacturerNorm)` 부품이 한 행만 생기고 그 아래 제조사 원장,
외부 공급사, SamplePCB 오퍼가 공존한다. ES도 부품 문서 한 개의 `suppliers`에 외부 공급사와
`samplepcb`를 함께 색인한다. 적용 검증은 공급사 오퍼·가격구간·SamplePCB 파생 출처와
ES 공급사 배열, 색인 큐 0건을 전수 확인한다.

## 제조사 키 병합 (적재 후 1회)

이 워크북은 `Samsung`·`KOA`·`Vishay`·`Walsin`처럼 짧은 표기를 쓴다. DB에는 유통사 표기로 들어온
`Samsung Electro-Mechanics`·`KOA Speer`·`Vishay Dale`·`Walsin Technology Corporation` 행이 이미
있어 같은 품번이 둘로 보인다. `manufacturer-alias.ts`에 별칭을 넣어도 **이후 인제스트만** 정규 키로
모이고 기존 행은 그대로 남으므로, 적재 뒤 한 번 병합한다.

```bash
pnpm --filter api parts:merge-mfr -- --supplier walsin,yageo,samsung,murata,tdk,vishay,koa
pnpm --filter api parts:merge-mfr -- --supplier walsin,yageo,samsung,murata,tdk,vishay,koa --apply
```

기준 공급사 오퍼를 가진 **정규 키 부품과 같은 MPN**이면서 표시명을 별칭 해소하면 같은 회사가 되는
과거 행만 대상이다. 오퍼와 견적 `partId`를 정규 키 행으로 옮기고 과거 행을 지운 뒤 facts 재계산과
ES 재색인·삭제까지 한다. 같은 `(supplier, sku)`가 양쪽에 있으면 목적지 값을 정본으로 두고 과거 행
것을 버린다(같은 공급사이므로 다음 수집에서 갱신된다).

`--apply`는 DB 변경 전에 전체 병합 계획과 삭제할 source part ID를
`.tmp/manufacturer-key-merge-*.json`에 기록한다. 중간에 DB·ES·프로세스 오류가 나면 **같은 명령을
다시 실행**한다. 이미 삭제된 DB source도 manifest의 ID로 ES 정리를 재개한다. 다른 경로를 쓰려면
`--manifest <path>`를 명시한다.

2026-07-26 로컬 실행 결과: 부품 60 병합(`walsintechnology→walsin` 10 · `vishaydale→vishay` 20 ·
`vishayintertechnology→vishay` 13 · `samsungelectromechanics→samsung` 9 · `koaspeer→koa` 8),
오퍼 190 이전, 중복 오퍼 24 폐기, 견적 라인 8 재연결, 잔여 0.

**이 병합은 되돌릴 수 없다.** 운영에서는 DB 백업 후 dry-run 결과를 확인하고 실행한다.

## 되돌리기

가격 스냅샷을 함께 적용하면 제조사 원장 오퍼 외에 DigiKey·Mouser·UniKeyIC 오퍼도 생긴다.
기존 manifest 부분 rollback은 이 외부 오퍼까지 제거하는 계약이 아니므로
`--price-snapshot`과 `--rollback` 조합을 금지한다. 이번처럼 카탈로그 전체 초기화 뒤
적용하는 작업은 관리자 카탈로그 초기화를 다시 실행하거나 적용 직전 DB 백업을 복원한다.

가격 스냅샷 없이 원장만 적용한 개발 환경에 한해서 기존 명령을 사용할 수 있다.

```bash
pnpm --filter api parts:catalog -- --rollback --source walsin-rlc
```

다음 개정판에서는 7개 제조사 supplier를 함께 지원하는 교체 경로를 사용한다.

```bash
pnpm --filter api parts:catalog -- --replace --source walsin-rlc \
  --retire-source-sha <이전-원본-SHA256>
```

## 남은 일

- 가격 사전 스냅샷은 공급사에서 정확 MPN+제조사를 반환한 품목만 채운다. `not_found`와
  `found_without_price`도 최종 스냅샷에 남으므로 제조사 원장 확인 대상으로 활용한다.
- 관리자 부품 검색·BOM 후보 화면에서 `verificationStatus=PATTERN_CANDIDATE`를 시각적으로
  구분하는 일은 아직 하지 않았다. 데이터 계약(`catalog_metadata`)에는 값이 들어 있다.
- AVL 축(`avlGroupId`·`avlRole`·`avlSiblings`)은 DB에만 있고 API 응답 스키마에는 없어 화면에
  노출되지 않는다. 대체품 추천에 쓰려면 계약과 라우트에 필드를 추가해야 한다.
- 제조사 키 갈라짐은 이 워크북과 무관한 부품에도 널리 있다(`Vishay` 28갈래, `Murata` 5갈래,
  `Samsung`·`KOA`·`TDK` 각 3갈래). 위 병합은 이 워크북과 같은 MPN인 60건만 처리했다.
  카탈로그 전반 통합은 별칭 표 정확성 검토가 선행돼야 하는 별도 과제다.
